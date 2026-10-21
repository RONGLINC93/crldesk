@echo off
setlocal EnableDelayedExpansion
REM === crldesk fpk 打包脚本（纯 ASCII，以脚本目录为基准） ===
set "ROOT=%~dp0"
set "FNOS=%ROOT%fnos"
set "APP=crldesk"
set "PKG=%FNOS%\%APP%"
set "BUILD=%PKG%\app\server"
set "OUT=%ROOT%fpk"

echo [1/5] 复制运行文件到 %BUILD%
rem 服务端与客户端分离：fpk 包内不包含 client-web（客户端独立部署）
if exist "%PKG%\app\client-web" rmdir /s /q "%PKG%\app\client-web"
if exist "%BUILD%" rmdir /s /q "%BUILD%"
mkdir "%BUILD%"
copy /Y "%ROOT%server.js" "%BUILD%\server.js" >nul
copy /Y "%ROOT%package.json" "%BUILD%\package.json" >nul
copy /Y "%ROOT%admin.html" "%BUILD%\admin.html" >nul

echo [2/5] 复制依赖（优先 node_modules，缺失则自动安装）
if exist "%ROOT%node_modules" (
  xcopy "%ROOT%node_modules" "%BUILD%\node_modules\" /E /I /Y /Q >nul
) else (
  echo    node_modules 缺失，执行 npm install --omit=dev
  pushd "%BUILD%"
  npm install --omit=dev
  if errorlevel 1 ( echo    依赖安装失败，无法打包 & popd & exit /b 1 )
  popd
)
if not exist "%BUILD%\node_modules" ( echo    依赖不可用，打包中止 & exit /b 1 )

echo [3/5] 同步版本号
powershell -NoProfile -ExecutionPolicy Bypass -File "%FNOS%\sync-version.ps1" "%PKG%"

echo [4/5] 文本归一化为 LF
powershell -NoProfile -ExecutionPolicy Bypass -File "%FNOS%\normalize-lf.ps1" "%PKG%"

echo [5/5] 定位 fnpack 并执行构建
set "FNPACK="
if exist "%FNOS%\fnpack.exe" set "FNPACK=%FNOS%\fnpack.exe"
if not defined FNPACK if exist "%ROOT%fnpack.exe" set "FNPACK=%ROOT%fnpack.exe"
where fnpack.exe >nul 2>&1 && set "FNPACK=fnpack.exe"

if not defined FNPACK (
  echo    未找到 fnpack.exe（应放在 fnos\ 或项目根或 PATH）
  echo    已生成可打包目录：%PKG%
  echo    请放置 fnpack.exe 后重新运行本脚本。
  exit /b 0
)

pushd "%PKG%"
"%FNPACK%" build
popd

REM 重命名产物为 <appname>-<version>.fpk 并输出到 fpk/
if not exist "%OUT%" mkdir "%OUT%"
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content -Encoding UTF8 '%PKG%\manifest' | Where-Object { $_ -match '^version=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })"') do set "VER=%%v"
set "VER=%VER: =%"
for %%f in ("%PKG%\*.fpk") do (
  move /Y "%%f" "%OUT%\%APP%-%VER%.fpk" >nul
  echo 产物已生成：%OUT%\%APP%-%VER%.fpk
  explorer /select,"%OUT%\%APP%-%VER%.fpk"
)
endlocal
