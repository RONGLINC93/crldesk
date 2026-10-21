'use strict';

/**
 * Windows 输入注入：通过 PowerShell 调用 user32.dll 的 mouse_event / keybd_event
 * 仅依赖系统自带的 PowerShell，无需额外安装软件。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PS_PATH = path.join(os.tmpdir(), 'crldesk-inject.ps1');

const PS_SCRIPT = `
param([string]$json)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, int dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
'@
Add-Type -AssemblyName System.Windows.Forms
$msg = $json | ConvertFrom-Json
$MOVE=0x0001; $ABS=0x8000; $LD=0x0002; $LU=0x0004; $RD=0x0008; $RU=0x0010; $MD=0x0020; $MU=0x0040; $WL=0x0800
$KD=0; $KU=2
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
function Move([double]$x,[double]$y){ $fx=[int]($x*65535/$b.Width); $fy=[int]($y*65535/$b.Height); [WinApi]::mouse_event($MOVE -bor $ABS, $fx, $fy, 0, 0) }
$VK = @{
  ControlLeft=0x11; ControlRight=0x11; AltLeft=0x12; AltRight=0x12; ShiftLeft=0x10; ShiftRight=0x10;
  MetaLeft=0x5B; MetaRight=0x5C; Escape=0x1B; Tab=0x09; Delete=0x2E; Backspace=0x08; Enter=0x0D;
  Space=0x20; ArrowLeft=0x25; ArrowUp=0x26; ArrowRight=0x27; ArrowDown=0x28; Home=0x24; End=0x23;
  F1=0x70;F2=0x71;F3=0x72;F4=0x73;F5=0x74;F6=0x75;F7=0x76;F8=0x77;F9=0x78;F10=0x79;F11=0x7A;F12=0x7B
}
function Vk([string]$code){
  if($VK.ContainsKey($code)){ return $VK[$code] }
  if($code -match '^Key([A-Z])$'){ return [int]($code[3]) }
  if($code -match '^Digit([0-9])$'){ return [int]('0x3' + $code[5]) }
  return 0
}
switch($msg.t){
  'mousemove'{ Move $msg.x $msg.y }
  'mousedown'{
    Move $msg.x $msg.y
    $btn = if($msg.button -eq 2){$RD} elseif($msg.button -eq 1){$MD} else {$LD}
    [WinApi]::mouse_event($btn, 0, 0, 0, 0)
  }
  'mouseup'{
    Move $msg.x $msg.y
    $btn = if($msg.button -eq 2){$RU} elseif($msg.button -eq 1){$MU} else {$LU}
    [WinApi]::mouse_event($btn, 0, 0, 0, 0)
  }
  'wheel'{ [WinApi]::mouse_event($WL, 0, 0, [int](-$msg.dy*1), 0) }
  'keydown'{ $v=[byte](Vk $msg.code); if($v -ne 0){ [WinApi]::keybd_event($v,0,$KD,0) } }
  'keyup'{ $v=[byte](Vk $msg.code); if($v -ne 0){ [WinApi]::keybd_event($v,0,$KU,0) } }
  'combination'{ foreach($k in $msg.keys){ $v=[byte](Vk $k); if($v -ne 0){ [WinApi]::keybd_event($v,0,$KD,0) } }; foreach($k in $msg.keys){ $v=[byte](Vk $k); if($v -ne 0){ [WinApi]::keybd_event($v,0,$KU,0) } } }
}
`;

let ready = false;
function ensure() {
  if (ready) return;
  fs.writeFileSync(PS_PATH, PS_SCRIPT, 'utf8');
  ready = true;
}

let lastMove = 0;
function inject(msg) {
  ensure();
  // 剪贴板写入：走独立 PowerShell（base64 传参，避免特殊字符/换行转义问题）
  if (msg.t === 'clipboard') {
    setClipboard(msg.text || '');
    return;
  }
  // 鼠标移动限频，降低 PowerShell 启动开销
  if (msg.t === 'mousemove') {
    const now = Date.now();
    if (now - lastMove < 16) return;
    lastMove = now;
  }
  const arg = JSON.stringify(msg).replace(/'/g, "''");
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_PATH, arg], (err) => {
    if (err && err.code === 'ENOENT') console.warn('[agent] 未找到 powershell');
  });
}

function setClipboard(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const cmd = `Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`;
  execFile('powershell', ['-NoProfile', '-Command', cmd], (err) => {
    if (err && err.code === 'ENOENT') console.warn('[agent] 未找到 powershell');
  });
}

module.exports = { name: 'windows', inject };
