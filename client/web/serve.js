'use strict';

/**
 * crldesk Web 客户端独立静态服务器（零依赖，Node >= 14）
 * 用途：客户端与服务端分离部署后，用本脚本托管本目录（client/web）的静态文件。
 * 用法：node serve.js   （可用环境变量 PORT 覆盖端口，默认 5560）
 * 打开页面后，在「服务端地址」中填入 crldesk 服务端地址（如 http://192.168.1.10:5555）连接。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '5560', 10);
const HOST = process.env.HOST || '::'; // 双栈监听，与 crldesk 服务端一致
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // 仅处理 GET/HEAD，忽略查询串
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('405 Method Not Allowed');
  }
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (_) { p = '/'; }
  if (p === '/' || p === '') p = '/index.html';

  const file = path.normalize(path.join(ROOT, p));
  // 防目录穿越
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[crldesk-client] 端口冲突：${PORT} 已被占用。可用 PORT 环境变量换端口，例如 set PORT=5561`);
  } else {
    console.error(`[crldesk-client] 监听失败：`, err && err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const via = HOST === '::' ? 'IPv4+IPv6 (双栈)' : HOST;
  console.log(`[crldesk-client] Web 客户端已启动`);
  console.log(`[crldesk-client] 监听地址: ${via}  端口: ${PORT}`);
  console.log(`[crldesk-client] 打开:       http://localhost:${PORT}/`);
  console.log(`[crldesk-client] 请在页面「服务端地址」中填入 crldesk 服务端地址（如 http://192.168.1.10:5555）`);
});
