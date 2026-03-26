#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[gate] 安装 server 依赖"
npm --prefix "$ROOT_DIR/server" install

echo "[gate] server 单元+集成测试"
npm --prefix "$ROOT_DIR/server" test

echo "[gate] 安装 h5 依赖"
npm --prefix "$ROOT_DIR/h5" install

echo "[gate] h5 构建验证"
npm --prefix "$ROOT_DIR/h5" run build

echo "[gate] 安装 admin 依赖"
npm --prefix "$ROOT_DIR/admin" install

echo "[gate] admin 构建验证"
npm --prefix "$ROOT_DIR/admin" run build

echo "[gate] 全部门禁通过"
