#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "缺少环境文件: $ENV_FILE"
  echo "请先执行 scripts/init-env.sh"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if ! docker info >/dev/null 2>&1; then
  echo "Docker 未启动，请先启动 Docker Desktop 或容器引擎"
  exit 1
fi

for svc in server h5 admin; do
  if docker image inspect "checkin-${svc}:latest" >/dev/null 2>&1; then
    docker tag "checkin-${svc}:latest" "checkin-${svc}:rollback"
  fi
done

docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" up -d --build
"$ROOT_DIR/scripts/smoke-test.sh" "$ENV_FILE" docker

echo "部署完成"
