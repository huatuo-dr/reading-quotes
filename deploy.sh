#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PID_FILE="logs/app.pid"
LOG_FILE="logs/app.log"

usage() {
  cat <<'USAGE'
用法: ./deploy.sh <command>

命令:
  help      显示本说明
  deploy    安装依赖、构建前端并重启服务（全量部署）
  start     若未运行则启动服务（读 .env 的 PORT）
  stop      停止服务（以监听 PORT 的进程为准）
  restart   先 stop 再 start（不重新 install/build）
  status    显示是否在跑、PID、PORT、监听状态
  log       跟踪 logs/app.log（tail -f）
  push      仅推送已有本地 commit 到远端（不自动 commit；读 .env 的 GIT_*）

无参数或未知命令时等同 help，并以退出码 1 结束。
USAGE
}

load_env() {
  if [[ ! -f .env ]]; then
    echo "缺少 .env，请先: cp .env.example .env 并填写" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
}

ensure_node() {
  if ! command -v node >/dev/null; then
    echo "需要 Node.js 20+" >&2
    exit 1
  fi
  if ! command -v npm >/dev/null; then
    echo "需要 npm" >&2
    exit 1
  fi
}

port_from_env() {
  echo "${PORT:-3005}"
}

pid_from_file() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "$PID_FILE" || true)"
    if [[ -n "${pid}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  return 1
}

pid_listening_on_port() {
  local port="$1"
  if command -v ss >/dev/null; then
    ss -lntp 2>/dev/null | grep -E ":${port}\\b" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n1
  elif command -v lsof >/dev/null; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n1
  fi
}

# 以监听 PORT 的进程为准；pid 文件仅作回退（可能是已退出的壳）
resolve_running_pid() {
  local port pid
  port="$(port_from_env)"
  pid="$(pid_listening_on_port "$port" || true)"
  if [[ -n "${pid:-}" ]]; then
    echo "$pid"
    return 0
  fi
  if pid="$(pid_from_file)"; then
    echo "$pid"
    return 0
  fi
  return 1
}

kill_pid_tree() {
  local pid="$1"
  # 先杀子进程，再杀自身（覆盖 npm/npx 父进程 + node 子进程）
  if command -v pkill >/dev/null; then
    pkill -P "$pid" 2>/dev/null || true
  fi
  kill "$pid" 2>/dev/null || true
}

wait_until_dead() {
  local pid="$1"
  local i
  for i in 1 2 3 4 5 6 7 8; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    if command -v pkill >/dev/null; then
      pkill -9 -P "$pid" 2>/dev/null || true
    fi
    kill -9 "$pid" 2>/dev/null || true
  fi
}

wait_port_free() {
  local port="$1"
  local i listener
  for i in 1 2 3 4 5 6 7 8 9 10; do
    listener="$(pid_listening_on_port "$port" || true)"
    if [[ -z "${listener:-}" ]]; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

wait_port_listen() {
  local port="$1"
  local i listener
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    listener="$(pid_listening_on_port "$port" || true)"
    if [[ -n "${listener:-}" ]]; then
      echo "$listener"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

stop_service() {
  local port pid file_pid
  port="$(port_from_env)"

  pid="$(pid_listening_on_port "$port" || true)"
  file_pid="$(pid_from_file || true)"

  if [[ -z "${pid:-}" && -z "${file_pid:-}" ]]; then
    rm -f "$PID_FILE"
    return 1
  fi

  if [[ -n "${pid:-}" ]]; then
    echo "==> 停止监听 :${port} 的进程 PID=${pid}"
    kill_pid_tree "$pid"
    wait_until_dead "$pid"
  fi

  # pid 文件可能是 npm/npx 父进程，与监听 PID 不同，一并清理
  if [[ -n "${file_pid:-}" && "${file_pid}" != "${pid:-}" ]]; then
    echo "==> 清理 pid 文件中的进程 PID=${file_pid}"
    kill_pid_tree "$file_pid"
    wait_until_dead "$file_pid"
  fi

  # 端口仍被占则再杀一次监听者
  pid="$(pid_listening_on_port "$port" || true)"
  if [[ -n "${pid:-}" ]]; then
    echo "==> 端口仍被占用，强制结束 PID=${pid}"
    kill_pid_tree "$pid"
    wait_until_dead "$pid"
    if command -v fuser >/dev/null; then
      fuser -k "${port}/tcp" 2>/dev/null || true
    fi
  fi

  if ! wait_port_free "$port"; then
    echo "警告: 停止后端口 ${port} 仍被占用" >&2
  fi
  rm -f "$PID_FILE"
  return 0
}

start_service() {
  local port listener tsx_bin
  port="$(port_from_env)"

  if listener="$(pid_listening_on_port "$port")"; then
    echo "$listener" > "$PID_FILE"
    echo "服务已在运行 PID=${listener} PORT=${port}"
    return 0
  fi

  export NODE_ENV="${NODE_ENV:-production}"
  mkdir -p logs

  # 直接跑本地 tsx，避免 npx/npm 多一层父进程导致 pid 错位
  if [[ -x "node_modules/.bin/tsx" ]]; then
    tsx_bin="node_modules/.bin/tsx"
  else
    tsx_bin="npx"
  fi

  echo "==> 启动服务 (PORT=${port})"
  if [[ "$tsx_bin" == "npx" ]]; then
    # 仍可能有父进程；启动后会用监听 PID 覆盖 pid 文件
    nohup npx tsx server/index.ts > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  else
    nohup "$tsx_bin" server/index.ts > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  fi

  if ! listener="$(wait_port_listen "$port")"; then
    echo "启动失败：端口 ${port} 未监听，请查看 ${LOG_FILE}" >&2
    # 清理可能残留的壳进程
    if [[ -f "$PID_FILE" ]]; then
      kill_pid_tree "$(tr -d '[:space:]' < "$PID_FILE")" || true
    fi
    rm -f "$PID_FILE"
    return 1
  fi

  echo "$listener" > "$PID_FILE"
  echo "已启动 PID=${listener} 日志: ${LOG_FILE}"
  return 0
}

cmd_start() {
  load_env
  ensure_node
  mkdir -p logs
  start_service
}

cmd_stop() {
  load_env
  local port
  port="$(port_from_env)"
  if stop_service; then
    echo "已停止"
  else
    echo "服务未在运行 (PORT=${port})"
  fi
}

cmd_restart() {
  load_env
  ensure_node
  mkdir -p logs
  if ! stop_service; then
    echo "服务未在运行，将直接启动"
  fi
  start_service
}

cmd_status() {
  load_env
  local port pid file_pid
  port="$(port_from_env)"
  pid="$(pid_listening_on_port "$port" || true)"
  file_pid="$(pid_from_file || true)"
  if [[ -n "${pid:-}" ]]; then
    echo "状态: 运行中"
    echo "PID:  ${pid}（监听 :${port}）"
    echo "PORT: ${port}"
    if [[ -n "${file_pid:-}" && "$file_pid" != "$pid" ]]; then
      echo "pid文件: ${file_pid}（与监听进程不一致，以监听为准）"
    fi
    if command -v ss >/dev/null; then
      ss -lntp 2>/dev/null | grep -E ":${port}\\b" || true
    fi
  elif [[ -n "${file_pid:-}" ]]; then
    echo "状态: pid 文件进程仍在，但未监听 :${port}"
    echo "PID:  ${file_pid}"
    echo "PORT: ${port}"
  else
    echo "状态: 未运行"
    echo "PORT: ${port}"
  fi
}

cmd_log() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "日志文件不存在: ${LOG_FILE}" >&2
    exit 1
  fi
  exec tail -f "$LOG_FILE"
}

cmd_deploy() {
  load_env
  ensure_node
  # .env 常含 NODE_ENV=production；若带着它跑 npm install，会跳过
  # devDependencies（typescript/vite 等），导致 `tsc: not found`。
  # install/build 强制装齐构建依赖；start/restart 仍按 production 跑进程。
  echo "==> 安装依赖（含构建用开发依赖）"
  npm install --include=dev
  echo "==> 构建前端"
  npm run build
  mkdir -p logs
  cmd_restart
}

cmd_push() {
  load_env
  local token branch remote authed ahead
  token="${GIT_TOKEN:-}"
  token="$(echo -n "$token" | tr -d '[:space:]')"
  branch="${GIT_BRANCH:-main}"
  if [[ -z "$token" ]]; then
    echo "GIT_TOKEN 为空，无法 push" >&2
    exit 1
  fi
  if [[ -n "${GIT_REMOTE_URL:-}" ]]; then
    remote="$GIT_REMOTE_URL"
  else
    remote="$(git remote get-url origin)"
  fi
  if [[ "$remote" != https://* ]]; then
    echo "仅支持 https remote，当前: ${remote%%@*}" >&2
    exit 1
  fi
  remote="${remote#https://}"
  remote="${remote#*@}"
  authed="https://x-access-token:${token}@${remote}"

  ahead="$(git rev-list --count "origin/${branch}..HEAD" 2>/dev/null || echo "?")"
  echo "==> git push HEAD:${branch}（仅推已有 commit，不自动 commit；本地领先约 ${ahead} 个 commit）"
  if ! git -c http.version=HTTP/1.1 push "$authed" "HEAD:${branch}"; then
    echo "push 失败（未打印 token）。可检查 Contents 读写权限、网络。" >&2
    exit 1
  fi
  echo "push 完成"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    help|-h|--help)
      usage
      exit 0
      ;;
    deploy) cmd_deploy ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    log) cmd_log ;;
    push) cmd_push ;;
    ""|*)
      usage
      exit 1
      ;;
  esac
}

main "$@"
