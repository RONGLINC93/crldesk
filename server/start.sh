#!/bin/bash
# 启动 crldesk 服务端（Linux / macOS）
# 客户端为独立程序，位于 ../client 文件夹（用 client/start.sh 启动 Web 客户端 + 代理）
set -e
cd "$(dirname "$0")"

[ -d node_modules ] || npm install
exec node server.js
