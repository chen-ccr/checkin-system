#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "缺少环境文件: $ENV_FILE"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker 未启动，请先启动 Docker Desktop 或容器引擎"
  exit 1
fi

if ! docker image inspect "checkin-server:rollback" >/dev/null 2>&1; then
  echo "未找到回滚镜像，请先执行一次 deploy.sh"
  exit 1
fi

TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT
cat "$ENV_FILE" > "$TMP_ENV"
if grep -q "^IMAGE_TAG=" "$TMP_ENV"; then
  sed -i '' 's/^IMAGE_TAG=.*/IMAGE_TAG=rollback/' "$TMP_ENV"
else
  echo "IMAGE_TAG=rollback" >> "$TMP_ENV"
fi

docker compose --env-file "$TMP_ENV" -f "$ROOT_DIR/docker-compose.yml" up -d --no-build server h5 admin

echo "已回滚到 rollback 镜像"
