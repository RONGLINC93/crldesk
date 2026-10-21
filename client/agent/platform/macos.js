'use strict';

/**
 * macOS 输入注入：依赖 cliclick（brew install cliclick）
 * 左键点击 / 移动 / 键盘可用；右键与滚轮受限于 cliclick，已尽量兼容。
 * 剪贴板写入：依赖 pbcopy（系统自带）。
 */
const { execFile, spawn } = require('child_process');

function run(args) {
  execFile('cliclick', args, (err) => {
    if (err && err.code === 'ENOENT') console.warn('[agent] 未找到 cliclick，请执行: brew install cliclick');
  });
}

function setClipboard(text) {
  const p = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
  p.on('error', () => console.warn('[agent] 未找到 pbcopy'));
  p.stdin.write(text);
  p.stdin.end();
}

const KEY = {
  ControlLeft: 'ctrl', ControlRight: 'ctrl', AltLeft: 'alt', AltRight: 'alt',
  ShiftLeft: 'shift', ShiftRight: 'shift', MetaLeft: 'cmd', MetaRight: 'cmd',
  Escape: 'esc', Tab: 'tab', Delete: 'delete', Backspace: 'delete', Enter: 'return',
  Space: 'space', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright', ArrowUp: 'arrowup', ArrowDown: 'arrowdown',
};

function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code[5];
  return KEY[code] || code.toLowerCase();
}

function inject(msg) {
  switch (msg.t) {
    case 'mousemove': run(['m:' + Math.round(msg.x) + ',' + Math.round(msg.y)]); break;
    case 'mousedown':
      run(['m:' + Math.round(msg.x) + ',' + Math.round(msg.y)]);
      if (msg.button === 2) run(['rc:' + Math.round(msg.x) + ',' + Math.round(msg.y)]); // cliclick 右键（部分版本）
      break;
    case 'mouseup':
      if (msg.button !== 2) run(['c:' + Math.round(msg.x) + ',' + Math.round(msg.y)]);
      break;
    case 'wheel': run(['w:' + (msg.dy < 0 ? 'up' : 'down')]); break;
    case 'keydown': run(['kd:' + keyName(msg.code)]); break;
    case 'keyup': run(['ku:' + keyName(msg.code)]); break;
    case 'combination': msg.keys.forEach((k) => run(['kd:' + keyName('Key' + k[0] + k.slice(1).toLowerCase())])); msg.keys.slice().reverse().forEach((k) => run(['ku:' + keyName('Key' + k[0] + k.slice(1).toLowerCase())])); break;
    case 'clipboard': setClipboard(msg.text || ''); break;
  }
}

module.exports = { name: 'macos', inject };
