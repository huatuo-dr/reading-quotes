#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "缺少 .env，请先: cp .env.example .env 并填写"
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "需要 Node.js 20+"
  exit 1
fi
if ! command -v npm >/dev/null; then
  echo "需要 npm"
  exit 1
fi

echo "==> 安装依赖"
npm install

echo "==> 构建前端"
npm run build

mkdir -p logs
export NODE_ENV=production

if [[ -f logs/app.pid ]] && kill -0 "$(cat logs/app.pid)" 2>/dev/null; then
  echo "==> 停止旧进程 $(cat logs/app.pid)"
  kill "$(cat logs/app.pid)" || true
  sleep 1
fi

echo "==> 启动服务"
nohup npx tsx server/index.ts > logs/app.log 2>&1 &
echo $! > logs/app.pid
echo "已启动 PID=$(cat logs/app.pid) 日志: logs/app.log"
echo "默认端口见 .env 中 PORT（默认 3005）。域名请用 Nginx 反代到该端口，详见 docs/02-部署指导.md"
