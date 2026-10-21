@echo off
REM 启动 crldesk 原生 Host 代理（Windows 下真实注入鼠标/键盘）
cd /d "%~dp0agent"
if not exist node_modules ( call npm install )
node agent.js
