'use strict';

/**
 * crldesk 服务端（独立部署，不含客户端）
 * 职责：
 *  1. WebSocket 信令服务：客户端注册、发现、邀请
 *  2. 数据中转：主控端与被控端之间的输入(JSON)与画面(二进制)均由服务端转发
 *  3. FN Connect 域名解析（本地注册表 + DNS 兜底）
 *  4. 双栈监听：IPv4 (0.0.0.0) 与 IPv6 (::)
 *  5. 服务端管理面板 /admin（查看在线客户端与控制会话、断开客户端）
 * 客户端为独立程序（client/web 或 client/electron），在客户端中填写服务端地址连接。
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const dns = require('dns').promises;
const os = require('os');

const PORT = parseInt(process.env.PORT || '5555', 10);
// 默认监听 :: (双栈，同时接受 IPv4 与 IPv6)。可通过 HOST 环境变量指定。
const HOST = process.env.HOST || '::';
const ADMIN_PAGE = path.join(__dirname, 'admin.html');   // 服务端管理面板（与 server.js 同目录）
const FN_CONNECT_BASE = process.env.FN_CONNECT_BASE || ''; // 可选：飞牛 FN Connect 解析接口
// 可选：本机的 FN Connect 域名（如 xxx.myfnas.com）。设置后管理面板会显示
// 完整的 FN Connect 连接地址 http://<域名>:<端口>，方便客户端连接。
const FN_CONNECT_DOMAIN = String(process.env.FN_CONNECT_DOMAIN || '').trim().toLowerCase();

let serverVersion = '';
try { serverVersion = String(require('./package.json').version || ''); } catch (_) { /* ignore */ }
const startedAt = Date.now();

// ---------------------------------------------------------------------------
// 内存状态
// ---------------------------------------------------------------------------
const peers = new Map();          // peerId -> peer 对象
const fnDomains = new Map();      // fnDomain(小写) -> peerId

function makePeer(ws) {
  return {
    ws,
    peerId: null,
    name: 'unknown',
    role: 'client',
    fnDomains: new Set(),
    ipv4: null,
    ipv6: null,
    relayTarget: null,   // 二进制中转目标 peerId（被控端 -> 主控端）
    relaySince: null,    // 本次中转开始时间
    relayFrames: 0,      // 本次中转已转发的帧数（统计用）
    relayBytes: 0,       // 本次中转已转发的字节数（统计用）
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    alive: true,
  };
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function peerList() {
  return [...peers.values()].map((p) => ({
    peerId: p.peerId,
    name: p.name,
    role: p.role,
    fnDomains: [...p.fnDomains],
    ipv4: p.ipv4,
    ipv6: p.ipv6,
  }));
}

// 管理面板用的扩展信息（仅服务端内部使用，不发给客户端）
function adminPeerList() {
  return [...peers.values()].map((p) => ({
    peerId: p.peerId,
    name: p.name,
    role: p.role,
    fnDomains: [...p.fnDomains],
    ipv4: p.ipv4,
    ipv6: p.ipv6,
    connectedAt: p.connectedAt,
    lastSeen: p.lastSeen,
    sharingTo: p.relayTarget || null, // 正在被谁观看（主控端 peerId）
  }));
}

// 活跃的中转（控制）会话：被控端 -> 主控端
function relaySessions() {
  const out = [];
  for (const p of peers.values()) {
    if (!p.relayTarget) continue;
    const c = peers.get(p.relayTarget);
    if (!c) continue;
    out.push({
      hostId: p.peerId,
      hostName: p.name,
      controllerId: c.peerId,
      controllerName: c.name,
      since: p.relaySince,
      frames: p.relayFrames,
      bytes: p.relayBytes,
    });
  }
  return out;
}

function collectAddresses() {
  const addrs = { ipv4: [], ipv6: [] };
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.internal) continue;
      if (ni.family === 'IPv4') addrs.ipv4.push(ni.address);
      else if (ni.family === 'IPv6' && !ni.address.startsWith('fe80')) addrs.ipv6.push(ni.address);
    }
  }
  return addrs;
}

function unregister(peer) {
  if (!peer || !peer.peerId) return;
  for (const d of peer.fnDomains) {
    if (fnDomains.get(d) === peer.peerId) fnDomains.delete(d);
  }
  peers.delete(peer.peerId);
}

// 通知与本机建立中转关系的对端：本机断开，让对方结束会话
function notifyRelayPeers(peer) {
  if (!peer || !peer.peerId) return;
  // 本机是画面发送方（被控端），通知它正在中转的主控端
  if (peer.relayTarget) {
    const target = peers.get(peer.relayTarget);
    if (target) send(target.ws, { type: 'bye', from: peer.peerId });
  }
  // 本机是画面接收方（主控端），通知正在向它推流的被控端
  for (const p of peers.values()) {
    if (p.relayTarget === peer.peerId) send(p.ws, { type: 'bye', from: peer.peerId });
  }
}

// ---------------------------------------------------------------------------
// HTTP / 静态托管
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, peers: peers.size, time: Date.now() });
});

app.get('/api/peers', (req, res) => {
  res.json({ peers: peerList() });
});

// 服务器可达地址信息（帮助客户端选择 IPv4 / IPv6）
app.get('/api/info', (req, res) => {
  res.json({ port: PORT, host: HOST, addresses: collectAddresses() });
});

// ---------------------------------------------------------------------------
// 服务端管理面板（纯服务端功能：查看在线客户端 / 控制会话 / 断开客户端）
// ---------------------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/admin')); // 根路径引导到管理面板（客户端为独立程序）
app.get('/admin', (req, res) => {
  res.sendFile(ADMIN_PAGE);
});

app.get('/api/admin/status', (req, res) => {
  res.json({
    ok: true,
    version: serverVersion,
    port: PORT,
    host: HOST,
    startedAt,
    uptimeMs: Date.now() - startedAt,
    addresses: collectAddresses(),
    fnConnectDomain: FN_CONNECT_DOMAIN,
    peerCount: peers.size,
    peers: adminPeerList(),
    sessions: relaySessions(),
  });
});

// 断开指定客户端（通知其对端结束会话后关闭连接）
app.post('/api/admin/kick', (req, res) => {
  const id = String((req.body && req.body.peerId) || '').trim();
  const p = peers.get(id);
  if (!p) return res.status(404).json({ ok: false, error: 'peer not found' });
  notifyRelayPeers(p);
  unregister(p);
  p.relayTarget = null;
  broadcastPeers();
  try { p.ws.close(4000, 'kicked by server'); } catch (_) { try { p.ws.terminate(); } catch (_) {} }
  res.json({ ok: true });
});

// FN Connect 域名解析：先查本地注册表，再尝试 DNS，最后尝试 FN Connect 接口
app.get('/api/resolve', async (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase();
  if (!domain) return res.status(400).json({ ok: false, error: 'missing domain' });

  const result = { domain, peerId: null, ipv4: null, ipv6: null, source: null };

  // 1) 本地注册表（客户端注册时上报的 fnDomain）
  if (fnDomains.has(domain)) {
    const pid = fnDomains.get(domain);
    const p = peers.get(pid);
    result.peerId = pid;
    if (p) { result.ipv4 = p.ipv4; result.ipv6 = p.ipv6; }
    result.source = 'registry';
    return res.json(result);
  }

  // 2) DNS 解析
  try {
    const lookup = await dns.lookup(domain, { all: true });
    for (const r of lookup) {
      if (r.family === 4) result.ipv4 = r.address;
      else if (r.family === 6) result.ipv6 = r.address;
    }
    if (result.ipv4 || result.ipv6) result.source = 'dns';
  } catch (_) { /* ignore */ }

  // 3) 可选 FN Connect 接口
  if (!result.ipv4 && !result.ipv6 && FN_CONNECT_BASE) {
    try {
      const url = `${FN_CONNECT_BASE.replace(/\/$/, '')}/resolve?domain=${encodeURIComponent(domain)}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        result.ipv4 = j.ipv4 || result.ipv4;
        result.ipv6 = j.ipv6 || result.ipv6;
        result.peerId = j.peerId || result.peerId;
        if (result.ipv4 || result.ipv6) result.source = 'fnconnect';
      }
    } catch (_) { /* ignore */ }
  }

  res.json(result);
});

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// WebSocket 信令
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('error', handleListenError);

wss.on('connection', (ws, req) => {
  const peer = makePeer(ws);
  // 记录客户端地址
  const addr = req.socket.remoteAddress;
  if (addr) {
    if (addr.includes(':') && !addr.startsWith('::ffff:')) peer.ipv6 = addr;
    else peer.ipv4 = addr.startsWith('::ffff:') ? addr.replace('::ffff:', '') : addr;
  }

  ws.on('message', (raw, isBinary) => {
    peer.lastSeen = Date.now();
    // 二进制帧（画面流）：直接转发给本机设定的中转目标
    if (isBinary) {
      const target = peer.relayTarget ? peers.get(peer.relayTarget) : null;
      if (target && target.ws.readyState === target.ws.OPEN) {
        peer.relayFrames += 1;
        peer.relayBytes += (raw && raw.length) ? raw.length : 0;
        target.ws.send(raw);
      }
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    handleMessage(peer, msg);
  });

  ws.on('pong', () => { peer.alive = true; });
  ws.on('close', () => { notifyRelayPeers(peer); unregister(peer); });
  ws.on('error', () => { notifyRelayPeers(peer); unregister(peer); });
});

function handleMessage(peer, msg) {
  switch (msg.type) {
    case 'register': {
      // 注销旧 ID（若重复）
      if (peer.peerId && peer.peerId !== msg.peerId) unregister(peer);
      peer.peerId = String(msg.peerId || '').trim();
      peer.name = String(msg.name || peer.peerId).slice(0, 64);
      peer.role = String(msg.role || 'client').slice(0, 16);
      if (!peer.peerId) { send(peer.ws, { type: 'error', message: 'empty peerId' }); return; }

      // 上报的 FN Connect 域名
      const reported = Array.isArray(msg.fnDomains) ? msg.fnDomains : [];
      for (const d of peer.fnDomains) { if (!reported.includes(d)) fnDomains.delete(d); }
      peer.fnDomains = new Set();
      for (const d of reported) {
        const dd = String(d).trim().toLowerCase();
        if (dd) { fnDomains.set(dd, peer.peerId); peer.fnDomains.add(dd); }
      }

      peers.set(peer.peerId, peer);
      send(peer.ws, {
        type: 'registered',
        peerId: peer.peerId,
        ipv4: peer.ipv4,
        ipv6: peer.ipv6,
        peers: peerList(),
      });
      broadcastPeers();
      break;
    }

    case 'list': {
      send(peer.ws, { type: 'peers', peers: peerList() });
      break;
    }

    case 'resolve': {
      const domain = String(msg.domain || '').trim().toLowerCase();
      const out = { type: 'resolved', domain, peerId: null, ipv4: null, ipv6: null };
      if (fnDomains.has(domain)) {
        const p = peers.get(fnDomains.get(domain));
        out.peerId = fnDomains.get(domain);
        if (p) { out.ipv4 = p.ipv4; out.ipv6 = p.ipv6; }
      }
      send(peer.ws, out);
      break;
    }

    case 'invite': {
      const target = peers.get(String(msg.to));
      if (!target) { send(peer.ws, { type: 'invite-failed', to: msg.to, reason: 'offline' }); return; }
      send(target.ws, { type: 'invite', from: peer.peerId, fromName: peer.name, role: peer.role, password: msg.password });
      break;
    }

    case 'invite-ack': {
      const target = peers.get(String(msg.to));
      if (target) send(target.ws, { type: 'invite-ack', from: peer.peerId, accept: !!msg.accept, reason: msg.reason });
      break;
    }

    // 数据中转（JSON，如输入事件）：主控端 -> 被控端
    case 'relay': {
      const target = peers.get(String(msg.to));
      if (!target) return;
      send(target.ws, { type: 'relay', from: peer.peerId, payload: msg.payload });
      break;
    }

    // 建立/清除二进制中转目标（画面流方向：被控端 -> 主控端）
    case 'relay-target': {
      peer.relayTarget = msg.to ? String(msg.to) : null;
      if (peer.relayTarget) {
        peer.relaySince = Date.now();
      } else {
        peer.relaySince = null;
        peer.relayFrames = 0;
        peer.relayBytes = 0;
      }
      break;
    }

    case 'bye': {
      const target = peers.get(String(msg.to));
      if (target) send(target.ws, { type: 'bye', from: peer.peerId });
      break;
    }

    default:
      send(peer.ws, { type: 'error', message: 'unknown message type: ' + msg.type });
  }
}

function broadcastPeers() {
  const list = peerList();
  for (const p of peers.values()) send(p.ws, { type: 'peers', peers: list });
}

// 心跳：定期清理失活连接
const heartbeat = setInterval(() => {
  for (const [id, p] of peers) {
    if (!p.alive) { try { p.ws.terminate(); } catch (_) {} unregister(p); continue; }
    p.alive = false;
    try { p.ws.ping(); } catch (_) {}
  }
}, 30000);

server.on('close', () => clearInterval(heartbeat));

function handleListenError(err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[crldesk] 端口冲突：地址 ${HOST} 的 ${PORT} 端口已被占用。`);
    console.error(`[crldesk] 解决方式：`);
    console.error(`          1) 释放占用端口的进程；或`);
    console.error(`          2) 更换端口后重启，例如：set PORT=9090 后再运行（Windows）/`);
    console.error(`             PORT=9090 node server.js（Linux/macOS）。`);
  } else {
    console.error(`[crldesk] 监听失败：`, err && err.message);
  }
  process.exit(1);
}

server.on('error', handleListenError);

server.listen(PORT, HOST, () => {
  const via = HOST === '::' ? 'IPv4+IPv6 (双栈)' : HOST;
  console.log(`[crldesk] 服务端已启动（客户端为独立程序，不由本服务托管）`);
  console.log(`[crldesk] 监听地址: ${via}  端口: ${PORT}`);
  console.log(`[crldesk] 管理面板: http://localhost:${PORT}/admin`);
  console.log(`[crldesk] 信令 WS:   ws://localhost:${PORT}/ws`);
  if (FN_CONNECT_BASE) console.log(`[crldesk] FN Connect 接口: ${FN_CONNECT_BASE}`);
  if (FN_CONNECT_DOMAIN) console.log(`[crldesk] FN Connect 域名: http://${FN_CONNECT_DOMAIN}:${PORT}`);
});

module.exports = server;
