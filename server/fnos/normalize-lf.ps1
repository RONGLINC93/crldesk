# 把包内文本文件统一为 LF 换行
param(
  [string]$Dir = (Join-Path $PSScriptRoot "crldesk")
)

$exts = @('.sh','.ps1','.bat','.cmd','.json','.js','.html','.css','.md','.txt','.yml','.yaml')
Get-ChildItem -Path $Dir -Recurse -File | Where-Object {
  $exts -contains $_.Extension
} | ForEach-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($text -match "`r`n") {
    $text = $text -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($_.FullName, $text, (New-Object System.Text.UTF8Encoding($false)))
  }
}
Write-Host "normalize line endings -> LF done"
