#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"

bash "$ROOT_DIR/scripts/init-env.sh" "$ENV_FILE"
bash "$ROOT_DIR/scripts/quality-gate.sh"
bash "$ROOT_DIR/scripts/deploy.sh" "$ENV_FILE"
