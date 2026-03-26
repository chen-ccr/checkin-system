#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"
MODE_INPUT="${2:-${SMOKE_MODE:-auto}}"

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

SERVER_PORT="${SERVER_PORT:-3001}"
H5_PORT="${H5_PORT:-8091}"
ADMIN_PORT="${ADMIN_PORT:-8090}"
EVIDENCE_DIR="${SMOKE_EVIDENCE_DIR:-$ROOT_DIR/smoke-evidence}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
EVIDENCE_FILE="${SMOKE_EVIDENCE_FILE:-$EVIDENCE_DIR/smoke-${STAMP}.json}"

if [ "$MODE_INPUT" = "auto" ]; then
  if docker info >/dev/null 2>&1; then
    MODE="docker"
  else
    MODE="local"
  fi
else
  MODE="$MODE_INPUT"
fi

if [ "$MODE" = "local" ]; then
  echo "[smoke] 本地模式：确保前端构建产物存在"
  if [ ! -f "$ROOT_DIR/h5/dist/index.html" ]; then
    npm --prefix "$ROOT_DIR/h5" install
    npm --prefix "$ROOT_DIR/h5" run build
  fi
  if [ ! -f "$ROOT_DIR/admin/dist/index.html" ]; then
    npm --prefix "$ROOT_DIR/admin" install
    npm --prefix "$ROOT_DIR/admin" run build
  fi
fi

echo "[smoke] 执行冒烟模式: $MODE"
node "$ROOT_DIR/scripts/smoke-runner.js" \
  --mode="$MODE" \
  --rootDir="$ROOT_DIR" \
  --evidenceFile="$EVIDENCE_FILE" \
  --serverPort="$SERVER_PORT" \
  --h5Port="$H5_PORT" \
  --adminPort="$ADMIN_PORT"
echo "[smoke] 冒烟验证通过，证据: $EVIDENCE_FILE"
