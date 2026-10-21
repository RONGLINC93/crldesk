@echo off
setlocal
REM crldesk Windows 客户端打包脚本（生成 exe）
cd /d "%~dp0electron"

if not exist node_modules (
  echo [1/3] 安装 Electron 依赖（首次较慢，需联网）...
  call npm install
) else (
  echo [1/3] 依赖已存在，跳过安装
)

echo [2/3] 打包 Windows exe（首次会下载打包工具，请耐心等待）...
call npm run dist
if errorlevel 1 (
  echo 打包失败，请查看上方错误信息。
  exit /b 1
)

echo [3/3] 完成，产物在 electron\dist 目录：
dir /b "%~dp0electron\dist\*.exe" 2>nul
endlocal
