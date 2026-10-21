'use strict';

/**
 * crldesk Windows 桌面客户端（Electron）
 * - 加载跨平台 Web 客户端（被控端 / 主控端）
 * - 主进程内嵌原生输入注入（复用 agent/platform 模块），被控时真正操控系统
 * - 处理 getDisplayMedia 屏幕捕获
 */
const { app, BrowserWindow, ipcMain, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');

const isPackaged = app.isPackaged;
// 开发时从源码目录读取；打包后从 resources 目录读取
const ROOT = isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const CLIENT_INDEX = path.join(ROOT, 'web', 'index.html');

// ---------------------------------------------------------------------------
// 服务端地址持久化（保存在用户数据目录）
// ---------------------------------------------------------------------------
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// FN Connect 解析：按 FN ID 取回当前可达地址（内网 IP / 公网 IPv4 / 公网 IPv6 / DDNS / 中继）
// 说明：接口为 FN Connect 前端私有接口（签名算法逆向自其前端资源），非官方开放 API，
// 可能因飞牛调整而失效；失效时返回错误，页面会回退到手动地址。
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const https = require('https');
const FNC_PATH = '/api/v1/fn/con';
const FNC_PREFIX = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const FNC_APIKEY = 'zIGtkc3dqZnJpd29qZXJqa2w7c';
const md5hex = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function resolveFnConnect(fnId) {
  return new Promise((resolve, reject) => {
    const ts = Date.now();
    const body = JSON.stringify({ fnId });
    const nonce = String(Math.floor(Math.random() * 9e5) + 1e5).padStart(6, '0');
    const sign = md5hex([FNC_PREFIX, FNC_PATH, nonce, ts, md5hex(body), FNC_APIKEY].join('_'));
    const req = https.request({
      hostname: '5ddd.com', path: FNC_PATH, method: 'POST', timeout: 12000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'fn-sign': sha256hex(`trim_connect\`${fnId}\`${ts}\`anna`),
        'authx': `nonce=${nonce}&timestamp=${ts}&sign=${sign}`,
      },
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          if (j && j.code === 0 && j.data) resolve(j.data);
          else reject(new Error((j && j.msg) || 'FN Connect 解析失败'));
        } catch (e) { reject(new Error('解析响应失败')); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('FN Connect 解析超时')); });
    req.write(body);
    req.end();
  });
}

ipcMain.handle('resolve-fn-connect', async (e, fnId) => {
  const id = String(fnId || '').trim().toLowerCase();
  if (!id) throw new Error('missing fnId');
  return resolveFnConnect(id);
});

ipcMain.on('get-config', (e) => { e.returnValue = loadConfig(); });
ipcMain.on('set-server-url', (e, url) => {
  const cfg = loadConfig();
  cfg.serverUrl = String(url || '');
  saveConfig(cfg);
});

// ---------------------------------------------------------------------------
// 内嵌原生输入注入（复用 agent 的平台注入模块，仅使用 Node 内置模块）
// ---------------------------------------------------------------------------
function startAgent() {
  let platform;
  const p = os.platform();
  if (p === 'win32') platform = require(path.join(ROOT, 'agent', 'platform', 'windows'));
  else if (p === 'darwin') platform = require(path.join(ROOT, 'agent', 'platform', 'macos'));
  else platform = require(path.join(ROOT, 'agent', 'platform', 'linux'));

  const port = parseInt(process.env.AGENT_PORT || '17900', 10);
  const wss = new WebSocket.Server({ host: '127.0.0.1', port });
  wss.on('error', (err) => {
    console.warn('[crldesk] 输入注入端口 ' + port + ' 占用：' + err.message);
  });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      try { platform.inject(m); } catch (e) { console.warn('[crldesk] 注入失败：', e.message); }
    });
  });
  console.log(`[crldesk] 原生输入注入已就绪 (ws://127.0.0.1:${port})`);
}

// ---------------------------------------------------------------------------
// getDisplayMedia 屏幕捕获：使用系统选择器（Windows/macOS 原生，Linux 回退 sources）
// ---------------------------------------------------------------------------
function setupDisplayMedia() {
  try {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] })
        .then((sources) => callback({ video: sources[0] }))
        .catch(() => callback({}));
    }, { useSystemPicker: true });
  } catch (e) {
    console.warn('[crldesk] 屏幕捕获配置失败：', e.message);
  }
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'crldesk 远程控制',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(CLIENT_INDEX);
}

app.whenReady().then(() => {
  setupDisplayMedia();
  startAgent();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
