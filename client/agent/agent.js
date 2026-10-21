'use strict';

/**
 * crldesk 原生 Host 代理
 * 监听本机 127.0.0.1:17900，接收 Web 客户端（被控端）转发的输入事件，
 * 调用对应平台的输入注入模块，真正操控本机鼠标/键盘。
 *
 * 仅本机访问，不暴露到网络，安全性由服务端信令鉴权保证。
 */
const WebSocket = require('ws');
const os = require('os');

const PORT = parseInt(process.env.AGENT_PORT || '17900', 10);

let platform;
const platformName = os.platform();
if (platformName === 'win32') platform = require('./platform/windows');
else if (platformName === 'darwin') platform = require('./platform/macos');
else platform = require('./platform/linux');

const wss = new WebSocket.Server({ host: '127.0.0.1', port: PORT });

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[crldesk-agent] 端口冲突：127.0.0.1:${PORT} 已被占用。`);
    console.error(`[crldesk-agent] 请先关闭占用该端口的进程，或用 AGENT_PORT 环境变量更换端口后重试。`);
    process.exit(1);
  } else {
    console.error(`[crldesk-agent] 监听失败：`, err.message);
    process.exit(1);
  }
});

wss.on('connection', (ws) => {
  console.log('[agent] Web 客户端已连接，开始接收输入注入');
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
    try { platform.inject(m); } catch (e) { console.warn('[agent] 注入失败:', e.message); }
  });
  ws.on('close', () => console.log('[agent] Web 客户端断开'));
});

console.log(`[crldesk-agent] 平台: ${platform.name}`);
console.log(`[crldesk-agent] 监听本机 ws://127.0.0.1:${PORT}`);
console.log('[crldesk-agent] 等待被控端 Web 客户端连接…');
