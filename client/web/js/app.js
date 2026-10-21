'use strict';

/**
 * 应用入口：单页左右分栏（主流远程工具风格）。
 * 左栏 = 本机被控信息（设备码 + 密码）；右栏 = 连接对方（远程控制）。
 * 打开后自动连接服务端，一个客户端同时具备「被控」与「主控」两种能力。
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const sig = new Signaling();

  // ---- 状态 ----
  let host = null;
  let controller = null;

  // ---- 工具 ----
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  const SERVER_URL_KEY = 'crldesk.serverUrl';

  // 已保存的服务端地址：Electron 配置优先，其次浏览器 localStorage
  function savedServerUrl() {
    try {
      if (window.crldesk && window.crldesk.getConfig) {
        const u = window.crldesk.getConfig().serverUrl || '';
        if (u) return u;
      }
    } catch (_) {}
    try { return localStorage.getItem(SERVER_URL_KEY) || ''; } catch (_) {}
    return '';
  }

  // 服务端默认端口：用户只需填 IPv4 / IPv6 / FN Connect 域名，不用写端口
  const DEFAULT_SERVER_PORT = 5555;

  // 是否显式写了端口（host:port 或 [v6]:port）
  function hasExplicitPort(s) {
    const host = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0];
    if (host.startsWith('[')) return /^\[[^\]]+\]:\d+$/.test(host);
    return (host.match(/:/g) || []).length === 1;
  }

  // 飞牛 FN Connect 中，应用的远程访问域名为三级域名：<应用名>.<FN ID>.5ddd.com
  const FN_CONNECT_SUFFIX = '.5ddd.com';

  // 生成候选连接地址（按顺序尝试，第一个连通即止）：
  //   显式写了协议/端口 -> 只用它；
  //   FN Connect 三级域名 -> 先 https:443，失败再 http:5555；
  //   只填了 FN ID（如 chenronglin）-> 先试 crldesk.<FN ID>.5ddd.com(443)，再试 <FN ID>:5555（内网）；
  //   IP / IPv6 -> 直接用 5555。
  function candidateUrls(raw) {
    const s = (raw || '').trim();
    if (!s) return [];
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
    if (hasScheme || hasExplicitPort(s)) return [normalizeServerUrl(s)];

    const bare = s.replace(/\/+$/, '');
    // 域名（含点）：FN Connect / DDNS 域名
    if (/[a-z]/i.test(bare) && bare.includes('.')) {
      return [normalizeServerUrl('https://' + bare), normalizeServerUrl(bare)];
    }
    // 仅 FN ID：自动补成应用三级域名，同时保留内网主机直连
    if (/^[a-z][a-z0-9-]{2,31}$/i.test(bare)) {
      return [
        normalizeServerUrl('https://crldesk.' + bare + FN_CONNECT_SUFFIX),
        normalizeServerUrl(bare),
      ];
    }
    return [normalizeServerUrl(bare)];
  }

  // 归一化：
  //   输入 192.168.1.10 或 desk.myfnas.com 或 [240e::1] 或 240e:3b2::1  -> 补默认端口
  //   输入含端口（192.168.1.10:8080 / [240e::1]:8080）                -> 用指定端口
  //   允许带协议 http(s):// 或 ws(s)://
  function normalizeServerUrl(raw) {
    let s = (raw || '').trim().replace(/\/+$/, '');
    if (!s) return '';

    // 拆协议
    let scheme = 'http';
    const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
    if (m) { scheme = m[1].toLowerCase(); s = m[2]; }

    // 拆路径
    let path = '';
    const slash = s.indexOf('/');
    if (slash >= 0) { path = s.slice(slash); s = s.slice(0, slash); }

    let host = s;
    // 未指定端口时：https/wss 用 443（如 FN Connect 域名），否则用服务端默认端口 5555
    const defaultPort = (scheme === 'https' || scheme === 'wss') ? 443 : DEFAULT_SERVER_PORT;
    const v6WithPort = /^\[[^\]]+\]:\d+$/.test(host);
    const v6NoPort = /^\[[^\]]+\]$/.test(host);
    const v4OrHostWithPort = /^[^:]+:\d+$/.test(host);
    if (!v6WithPort && !v4OrHostWithPort) {
      // 未指定端口：补默认端口（裸 IPv6 需加方括号）
      if (host.includes(':')) host = '[' + host.replace(/^\[|\]$/g, '') + ']';
      host += ':' + defaultPort;
    } else if (v6NoPort) {
      host += ':' + defaultPort;
    }

    const wsScheme = (scheme === 'https' || scheme === 'wss') ? 'wss' : 'ws';
    const p = (!path || path === '/') ? '/ws' : path;
    return `${wsScheme}://${host}${p}`;
  }

  const PEER_ID_KEY = 'crldesk.peerId';
  const PASSWORD_KEY = 'crldesk.password';

  // 生成 8 位数字设备码（首位 1-9）
  function generateId() {
    let id = String(1 + Math.floor(Math.random() * 9));
    for (let i = 0; i < 7; i++) id += Math.floor(Math.random() * 10);
    return id;
  }

  // 生成 6 位随机数字密码
  function generatePassword() {
    let pwd = '';
    for (let i = 0; i < 6; i++) pwd += Math.floor(Math.random() * 10);
    return pwd;
  }

  function ensurePeerId() {
    let id = '';
    try { id = localStorage.getItem(PEER_ID_KEY) || ''; } catch (_) {}
    if (!id) {
      id = generateId();
      try { localStorage.setItem(PEER_ID_KEY, id); } catch (_) {}
    }
    $('peerId').textContent = id;
  }

  function ensurePassword() {
    let pwd = '';
    try { pwd = localStorage.getItem(PASSWORD_KEY) || ''; } catch (_) {}
    if (!pwd) {
      pwd = generatePassword();
      try { localStorage.setItem(PASSWORD_KEY, pwd); } catch (_) {}
    }
    $('hostPassword').value = pwd;
  }

  // ---- 状态展示 ----
  function setStatus(state) {
    const s = $('status');
    if (state === true) { s.textContent = '已连接'; s.className = 'status on'; }
    else if (state === false) { s.textContent = '未连接'; s.className = 'status off'; }
    else { s.textContent = '连接中…'; s.className = 'status off'; }
  }

  function setHostState(v) {
    const el = $('hostState');
    el.textContent = v;
    el.className = 'badge ' + (v.includes('已连接') ? 'on' : 'off');
  }

  function setCtrlState(v) {
    const el = $('ctrlState');
    el.textContent = v;
    el.className = 'badge ' + (v.includes('已连接') ? 'on' : 'off');
  }

  function reRegister() {
    if (!sig.connected) return;
    const peerId = $('peerId').textContent;
    const name = ($('displayName').value || '').trim() || peerId;
    const fnDomains = ($('hostFnDomain').value || '').trim() ? [($('hostFnDomain').value || '').trim().toLowerCase()] : [];
    sig.register(peerId, name, 'host', fnDomains);
  }

  // ---- 连接成功后初始化 ----
  function onConnected() {
    setStatus(true);
    toast('已连接到服务端');

    const peerId = $('peerId').textContent;
    const name = ($('displayName').value || '').trim() || peerId;

    // 注册（一个客户端同时可被控、可主控）
    reRegister();

    // 被控端
    if (!host) {
      host = new Host(sig, {
        overlay: null,
        preview: null,
        onState: (k, v) => {
          if (k === 'share') setHostState(v);
          else if (k === 'agent') toast(v);
        },
      });
    }
    host.start(peerId, name);
    host.setPassword($('hostPassword').value);

    // 主控端
    if (!controller) {
      controller = new Controller(sig, {
        video: $('remoteVideo'),
        overlay: $('overlay'),
        waiting: $('waiting'),
        onState: setCtrlState,
        onLatency: (ms) => { $('statLatency').textContent = (ms == null) ? '' : ('延迟 ' + ms + 'ms'); },
      });
    }
    controller.start(peerId, name);
  }

  // ---- 连接服务端 ----
  // 是否像 FN ID（纯字母数字连字符、不含点，如 chenronglin）
  function looksLikeFnId(s) { return /^[a-z][a-z0-9-]{2,31}$/i.test(s); }

  // FN ID -> 实际地址：借 FN Connect 解析当前公网 IPv6/IPv4 与内网 IP（动态 IP 也能连上）
  // 说明：浏览器端受跨域限制无法直接调用，仅 Electron 客户端（主进程发起）可用；
  // 不可用时回退到 candidateUrls 的常规候选。
  function resolveFnCandidates(input) {
    const fnId = input.trim();
    if (!looksLikeFnId(fnId)) return Promise.resolve(null);
    if (!(window.crldesk && window.crldesk.resolveFnConnect)) return Promise.resolve(null);
    return window.crldesk.resolveFnConnect(fnId).then((d) => {
      const hosts = [].concat(d.publicIpv6 || [], d.publicIpv4 || [], d.ddns ? [d.ddns] : [], d.ipv4 || []);
      const urls = hosts.map((h) => normalizeServerUrl(h)).filter(Boolean);
      return urls.length ? urls : null;
    }).catch(() => Promise.resolve(null));
  }

  function connect() {
    // 用户只需填地址（IP / 域名 / FN ID），端口自动（5555，https 域名走 443）
    const input = ($('serverUrl').value || savedServerUrl()).trim();
    setStatus(null);

    // 填了 FN ID 时先借 FN Connect 解析当前 IP（动态 IP 也能连上）
    resolveFnCandidates(input).then((fnUrls) => {
      const urls = (fnUrls && fnUrls.length) ? fnUrls : candidateUrls(input);
      if (!urls.length) { setStatus(false); toast('请填写服务端地址，如 192.168.1.10 或你的FNID'); return; }
      if (window.crldesk && window.crldesk.setServerUrl) window.crldesk.setServerUrl(urls[0]);

      let idx = 0;
      const tryNext = () => {
        if (idx >= urls.length) { setStatus(false); toast('连接失败，请检查服务端地址与 5555 端口是否可达'); return; }
        const url = urls[idx++];
        sig.connect(url)
          .then(() => {
            // 连接成功后记住用户填的地址（下次自动连接）
            try { localStorage.setItem(SERVER_URL_KEY, input || url); } catch (_) {}
            onConnected();
          })
          .catch(() => setTimeout(tryNext, 150));
      };
      tryNext();
    });
  }

  $('btnConnect').addEventListener('click', connect);

  // ---- 服务端事件 ----
  sig.on('registered', (m) => {
    $('hostPeerList').textContent = (m.peers || []).map((p) => `${p.name}(${p.peerId})`).join('、') || '-';
  });
  sig.on('peers', (m) => {
    $('hostPeerList').textContent = (m.peers || []).map((p) => `${p.name}(${p.peerId})`).join('、') || '-';
  });

  sig.on('invite', (m) => { if (host) host.handleInvite(m.from, m.fromName, m.password); });
  sig.on('relay', (m) => {
    if (host && host.target === m.from) host.onInput(m.payload);
    if (controller && controller.target === m.from) controller.onRelay(m.payload);
  });
  sig.on('bye', (m) => {
    if (host && m.from === host.target) host.stop();
    if (controller && m.from === controller.target) controller.disconnect();
  });

  sig.on('invite-ack', (m) => { if (controller) controller.handleInviteAck(m.from, m.accept, m.reason); });
  sig.on('binary', (buf) => { if (controller) controller.onFrame(buf); });

  // ---- 左栏（本机）绑定 ----
  $('btnCopyId').addEventListener('click', () => {
    navigator.clipboard.writeText($('peerId').textContent).then(() => toast('设备码已复制')).catch(() => toast($('peerId').textContent));
  });
  $('btnCopyPassword').addEventListener('click', () => {
    navigator.clipboard.writeText($('hostPassword').value).then(() => toast('密码已复制')).catch(() => toast($('hostPassword').value));
  });
  $('btnRandomPassword').addEventListener('click', () => {
    const pwd = generatePassword();
    $('hostPassword').value = pwd;
    try { localStorage.setItem(PASSWORD_KEY, pwd); } catch (_) {}
    if (host) host.setPassword(pwd);
    toast('已生成新密码');
  });
  $('hostPassword').addEventListener('change', () => {
    const pwd = $('hostPassword').value;
    try { localStorage.setItem(PASSWORD_KEY, pwd); } catch (_) {}
    if (host) host.setPassword(pwd);
  });
  $('btnStopShare').addEventListener('click', () => { if (host) host.stop(); });
  $('useAgent').addEventListener('change', (e) => { if (host) host.setUseAgent(e.target.checked); });
  $('btnHostClipboard').addEventListener('click', async () => {
    if (!host) return;
    const ok = await host.sendClipboard();
    toast(ok ? '已发送剪贴板内容' : '读取剪贴板失败');
  });
  $('hostFnDomain').addEventListener('change', reRegister);
  $('displayName').addEventListener('change', reRegister);

  // ---- 右栏（远程控制）绑定 ----
  $('btnInvite').addEventListener('click', () => {
    if (!sig.connected) { toast('请先连接服务端'); return; }
    if (controller) controller.connect($('targetId').value, $('targetPassword').value);
  });
  $('btnDisconnect').addEventListener('click', () => { if (controller) controller.disconnect(); });

  $('btnFull').addEventListener('click', () => {
    const w = $('videoWrap');
    if (!document.fullscreenElement) w.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  const QUALITY_LEVELS = [
    { label: '自动', quality: 0.6, fps: 12, maxDim: 1280 },
    { label: '流畅', quality: 0.4, fps: 15, maxDim: 960 },
    { label: '高清', quality: 0.8, fps: 8, maxDim: 1920 },
  ];
  let qIdx = 0;
  $('btnQuality').addEventListener('click', () => {
    qIdx = (qIdx + 1) % QUALITY_LEVELS.length;
    const q = QUALITY_LEVELS[qIdx];
    $('btnQuality').textContent = '画质: ' + q.label;
    if (controller) controller.sendConfig(q);
    toast('已切换画质：' + q.label);
  });

  $('btnClipboard').addEventListener('click', async () => {
    try {
      const txt = await navigator.clipboard.readText();
      controller && controller.sendInput({ t: 'clipboard', text: txt });
      toast('已发送剪贴板内容');
    } catch (e) { toast('读取剪贴板失败'); }
  });

  $('btnKeyboard').addEventListener('click', () => $('softKeyboard').classList.toggle('hidden'));
  document.querySelectorAll('#softKeyboard button').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.k;
      const codeMap = { Ctrl: 'ControlLeft', Alt: 'AltLeft', Shift: 'ShiftLeft', Win: 'MetaLeft', Esc: 'Escape', Tab: 'Tab', Del: 'Delete', Backspace: 'Backspace', Enter: 'Enter' };
      controller && controller.sendInput({ t: 'k', key: k, code: codeMap[k] || k, down: true });
      setTimeout(() => controller && controller.sendInput({ t: 'k', key: k, code: codeMap[k] || k, down: false }), 60);
    });
  });

  $('btnCtrlAltDel').addEventListener('click', () => {
    controller && controller.sendCombo(['Control', 'Alt', 'Delete']);
  });

  // ---- 初始化 ----
  (function init() {
    const u = savedServerUrl();
    if (u) $('serverUrl').value = u;
    ensurePeerId();
    ensurePassword();

    // 从 URL 自动填充对方设备码
    const params = new URLSearchParams(location.search);
    const peer = params.get('peer');
    if (peer) { $('targetId').value = peer; }

    // 自动连接服务端
    connect();
  })();
})();
