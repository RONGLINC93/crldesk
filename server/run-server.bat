@echo off
REM 启动 crldesk 服务端（信令/中转 + 管理面板；客户端为独立程序，见 ..\client 文件夹）
cd /d "%~dp0"
if not exist node_modules ( call npm install )
node server.js
