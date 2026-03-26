#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_FILE="${1:-$ROOT_DIR/.env}"

if [ -f "$TARGET_FILE" ]; then
  echo "环境文件已存在: $TARGET_FILE"
  exit 0
fi

cp "$ROOT_DIR/.env.example" "$TARGET_FILE"
echo "已创建环境文件: $TARGET_FILE"
