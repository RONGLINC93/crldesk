'use strict';

/**
 * Linux 输入注入：依赖 xdotool（sudo apt install xdotool）
 * 剪贴板写入：依赖 xclip（sudo apt install xclip）
 */
const { execFile, spawn } = require('child_process');

function run(args) {
  execFile('xdotool', args, (err) => {
    if (err && err.code === 'ENOENT') console.warn('[agent] 未找到 xdotool，请执行: sudo apt install xdotool');
  });
}

function setClipboard(text) {
  const p = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
  p.on('error', () => console.warn('[agent] 未找到 xclip，请执行: sudo apt install xclip'));
  p.stdin.write(text);
  p.stdin.end();
}

const BTN = { 0: '1', 1: '2', 2: '3' };

function inject(msg) {
  switch (msg.t) {
    case 'mousemove': run(['mousemove', String(Math.round(msg.x)), String(Math.round(msg.y))]); break;
    case 'mousedown': run(['mousemove', String(Math.round(msg.x)), String(Math.round(msg.y)), 'mousedown', BTN[msg.button] || '1']); break;
    case 'mouseup': run(['mouseup', BTN[msg.button] || '1']); break;
    case 'wheel': run(['click', msg.dy < 0 ? '4' : '5']); break;
    case 'keydown': run(['keydown', toKeysym(msg.code)]); break;
    case 'keyup': run(['keyup', toKeysym(msg.code)]); break;
    case 'combination': msg.keys.forEach((k) => run(['keydown', toKeysym('Key' + k[0] + k.slice(1).toLowerCase())])); msg.keys.slice().reverse().forEach((k) => run(['keyup', toKeysym('Key' + k[0] + k.slice(1).toLowerCase())])); break;
    case 'clipboard': setClipboard(msg.text || ''); break;
  }
}

function toKeysym(code) {
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code[5];
  const m = { ControlLeft: 'ctrl', AltLeft: 'alt', ShiftLeft: 'shift', MetaLeft: 'super', Escape: 'Escape', Tab: 'Tab', Delete: 'Delete', Backspace: 'BackSpace', Enter: 'Return', Space: 'space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
  return m[code] || code;
}

module.exports = { name: 'linux', inject };
