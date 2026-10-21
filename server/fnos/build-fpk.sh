#!/bin/bash
# crldesk fpk 打包脚本（Linux / macOS）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FNOS="$ROOT/fnos"
APP=crldesk
PKG="$FNOS/$APP"
BUILD="$PKG/app/server"
OUT="$ROOT/fpk"

echo "[1/5] 复制运行文件到 $BUILD"
# 服务端与客户端分离：fpk 包内不包含 client-web（客户端独立部署）
rm -rf "$PKG/app/client-web"
rm -rf "$BUILD"
mkdir -p "$BUILD"
cp "$ROOT/server.js" "$BUILD/server.js"
cp "$ROOT/package.json" "$BUILD/package.json"
cp "$ROOT/admin.html" "$BUILD/admin.html"

echo "[2/5] 复制依赖"
if [ -d "$ROOT/node_modules" ]; then
  cp -r "$ROOT/node_modules" "$BUILD/node_modules"
else
  echo "  node_modules 缺失，执行 npm install --omit=dev"
  ( cd "$BUILD" && npm install --omit=dev )
fi

echo "[3/5] 同步版本号"
pwsh -NoProfile -ExecutionPolicy Bypass -File "$FNOS/sync-version.ps1" "$PKG" 2>/dev/null || \
powershell -NoProfile -ExecutionPolicy Bypass -File "$FNOS/sync-version.ps1" "$PKG" 2>/dev/null || \
echo "  (跳过版本同步，请手动确认 manifest version)"

echo "[4/5] 文本归一化为 LF"
pwsh -NoProfile -ExecutionPolicy Bypass -File "$FNOS/normalize-lf.ps1" "$PKG" 2>/dev/null || \
powershell -NoProfile -ExecutionPolicy Bypass -File "$FNOS/normalize-lf.ps1" "$PKG" 2>/dev/null || true

echo "[5/5] 定位 fnpack 并执行构建"
FNPACK=""
[ -f "$FNOS/fnpack" ] && FNPACK="$FNOS/fnpack"
[ -z "$FNPACK" ] && [ -f "$ROOT/fnpack" ] && FNPACK="$ROOT/fnpack"
command -v fnpack >/dev/null 2>&1 && FNPACK="fnpack"

if [ -z "$FNPACK" ]; then
  echo "  未找到 fnpack（应放在 fnos/ 或项目根或 PATH）"
  echo "  已生成可打包目录：$PKG"
  exit 0
fi

( cd "$PKG" && "$FNPACK" build )

mkdir -p "$OUT"
VER="$(grep -o '^version=[^[:space:]]*' "$PKG/manifest" | head -1 | cut -d= -f2)"
for f in "$PKG"/*.fpk; do
  [ -e "$f" ] || continue
  mv -f "$f" "$OUT/$APP-$VER.fpk"
  echo "产物已生成：$OUT/$APP-$VER.fpk"
done
