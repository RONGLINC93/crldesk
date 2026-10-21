# 把根目录 server/package.json 的 version 同步写入 fnos 包 manifest (key=value 格式)
param(
  [string]$PkgDir = (Join-Path $PSScriptRoot "crldesk")
)

$root = Split-Path $PSScriptRoot -Parent
$pkg = Join-Path (Join-Path $root "server") "package.json"
$manifest = Join-Path $PkgDir "manifest"

if (-not (Test-Path $pkg)) { Write-Error "cannot find $pkg"; exit 1 }
if (-not (Test-Path $manifest)) { Write-Error "cannot find $manifest"; exit 1 }

$ver = (Get-Content -Encoding UTF8 $pkg -Raw | ConvertFrom-Json).version

$lines = Get-Content -Encoding UTF8 $manifest
$out = $lines | ForEach-Object {
  if ($_ -match '^version=') { "version=$ver" } else { $_ }
}
$out | Set-Content -Encoding UTF8 $manifest
Write-Host "sync version -> $ver"
