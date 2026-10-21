#!/bin/bash
# 启动 crldesk Web 客户端 + 原生代理（Linux / macOS）
# 服务端为独立程序，位于 ../server 文件夹（用 server/start.sh 启动）
set -e
cd "$(dirname "$0")"

( cd web   && node serve.js ) &
( cd agent && [ -d node_modules ] || npm install && node agent.js ) &

echo "crldesk 客户端已启动：Web 客户端 http://localhost:5560/  代理 ws://127.0.0.1:17900"
echo "请在 Web 客户端「服务端设置」中填入服务端地址（如 http://192.168.1.10:5555）"
wait
