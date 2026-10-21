@echo off
REM crldesk Windows Web 客户端启动脚本（独立于服务端）
cd /d "%~dp0web"
where node >nul 2>&1
if errorlevel 1 (
  echo [crldesk-client] 未找到 node，请先安装 Node.js
  pause
  exit /b 1
)
echo [crldesk-client] Web 客户端启动中（默认端口 5560，可用 PORT 环境变量覆盖）...
node serve.js
pause
