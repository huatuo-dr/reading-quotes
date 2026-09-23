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
  stop      停止服务（优先 pid 文件，否则按 PORT 查找）
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

resolve_running_pid() {
  local port pid
  port="$(port_from_env)"
  if pid="$(pid_from_file)"; then
    echo "$pid"
    return 0
  fi
  pid="$(pid_listening_on_port "$port" || true)"
  if [[ -n "${pid:-}" ]]; then
    echo "$pid"
    return 0
  fi
  return 1
}

cmd_start() {
  load_env
  ensure_node
  mkdir -p logs
  local port pid
  port="$(port_from_env)"
  if pid="$(resolve_running_pid)"; then
    echo "服务已在运行 PID=${pid} PORT=${port}"
    exit 0
  fi
  export NODE_ENV=production
  echo "==> 启动服务 (PORT=${port})"
  nohup npx tsx server/index.ts > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "启动失败，请查看 ${LOG_FILE}" >&2
    exit 1
  fi
  echo "已启动 PID=$(cat "$PID_FILE") 日志: ${LOG_FILE}"
}

cmd_stop() {
  load_env
  local port pid
  port="$(port_from_env)"
  if ! pid="$(resolve_running_pid)"; then
    echo "服务未在运行 (PORT=${port})"
    rm -f "$PID_FILE"
    exit 0
  fi
  echo "==> 停止进程 PID=${pid}"
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "进程未退出，发送 SIGKILL" >&2
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "已停止"
}

cmd_restart() {
  load_env
  ensure_node
  mkdir -p logs
  # stop without exiting early when already stopped
  local port pid
  port="$(port_from_env)"
  if pid="$(resolve_running_pid)"; then
    echo "==> 停止进程 PID=${pid}"
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  else
    echo "服务未在运行，将直接启动"
    rm -f "$PID_FILE"
  fi
  export NODE_ENV=production
  echo "==> 启动服务 (PORT=${port})"
  nohup npx tsx server/index.ts > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "启动失败，请查看 ${LOG_FILE}" >&2
    exit 1
  fi
  echo "已重启 PID=$(cat "$PID_FILE") 日志: ${LOG_FILE}"
}

cmd_status() {
  load_env
  local port pid
  port="$(port_from_env)"
  if pid="$(resolve_running_pid)"; then
    echo "状态: 运行中"
    echo "PID:  ${pid}"
    echo "PORT: ${port}"
    if command -v ss >/dev/null; then
      ss -lntp 2>/dev/null | grep -E ":${port}\\b" || echo "监听: 未在 ss 中看到 :${port}（进程仍在）"
    fi
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
  echo "==> 安装依赖"
  npm install
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
  # strip credentials if any, then inject token (never echo token)
  remote="${remote#https://}"
  remote="${remote#*@}"
  authed="https://x-access-token:${token}@${remote}"

  ahead="$(git rev-list --count "origin/${branch}..HEAD" 2>/dev/null || echo "?")"
  echo "==> git push HEAD:${branch}（仅推已有 commit，不自动 commit；本地领先约 ${ahead} 个 commit）"
  if ! git -c http.version=HTTP/1.1 push "$authed" "HEAD:${branch}"; then
    echo "push 失败（未打印 token）。可检查 Contents 读写权限、网络，或：git -c http.version=HTTP/1.1 push …" >&2
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
