'use strict';

/**
 * 主控端 Controller：连接被控端，显示经服务端中转过来的画面，
 * 并回传鼠标/键盘输入（输入同样经服务端中转）。
 */
class Controller {
  constructor(signaling, opts = {}) {
    this.sig = signaling;
    this.peerId = null;
    this.target = null;        // 被控端 peerId
    this.img = opts.video || null;   // 显示远程画面的 <img> 元素
    this.overlay = opts.overlay || null;
    this.waiting = opts.waiting || null;
    this.onState = opts.onState || (() => {});
    this.onLatency = opts.onLatency || (() => {});
    this._bound = false;
    this._lastUrl = null;
    this._pingTimer = null;
    this._latency = null;
  }

  start(peerId, name) {
    this.peerId = peerId;
    this.name = name;
  }

  // target 可为 peerId 或 FN Connect 域名
  async connect(targetRaw, password) {
    this.target = (targetRaw || '').trim();
    if (!this.target) { this.onState('输入对方 ID 或域名'); return false; }

    // 若像域名，先解析
    if (this.target.includes('.')) {
      const r = await this._resolve(this.target);
      if (r && r.peerId) this.target = r.peerId;
      else if (r && (r.ipv4 || r.ipv6)) {
        this.onState('已解析到 IP，但需对方 ID 才能连接（请让对方提供 ID）');
        return false;
      } else {
        this.onState('域名解析失败，请确认对方已上线并注册该域名');
        return false;
      }
    }

    this.onState('正在请求控制…');
    this.sig.invite(this.target, password);
    return true;
  }

  _resolve(domain) {
    return new Promise((resolve) => {
      const h = (msg) => {
        if (msg.type === 'resolved' && msg.domain === domain) {
          this.sig.off('resolved', h);
          resolve(msg);
        }
      };
      this.sig.on('resolved', h);
      this.sig.resolve(domain);
      setTimeout(() => { this.sig.off('resolved', h); resolve(null); }, 4000);
    });
  }

  handleInviteAck(from, accept, reason) {
    if (from !== this.target) return;
    if (!accept) {
      this.onState(reason === 'wrong-password' ? '密码错误，对方拒绝了请求' : '对方拒绝了请求');
      return;
    }
    this.onState('已连接，可以操作了');
    if (this.waiting) this.waiting.classList.add('hidden');
    if (this.overlay) this.overlay.classList.remove('hidden');
    this._bindInput();
    this._startPing();
  }

  // 收到被控端反向中转数据（pong / 反向剪贴板等）
  onRelay(payload) {
    if (!payload) return;
    if (payload.t === 'pong') {
      this._latency = Math.round((Date.now() - payload.ts) / 2);
      this.onLatency(this._latency);
    } else if (payload.t === 'clipboard') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload.text || '').catch(() => {});
      }
    }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.target) this.sendInput({ t: 'ping', ts: Date.now() });
    }, 2000);
  }

  _stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  // 收到经服务端中转的画面帧（JPEG 二进制）
  onFrame(buf) {
    if (!this.img) return;
    const blob = new Blob([buf], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    if (this._lastUrl) URL.revokeObjectURL(this._lastUrl);
    this._lastUrl = url;
    this.img.src = url;
  }

  sendInput(m) {
    if (this.target) this.sig.relay(this.target, m);
  }

  _bindInput() {
    if (this._bound || !this.img) return;
    this._bound = true;
    const v = this.img;

    const norm = (e) => {
      const r = v.getBoundingClientRect();
      return {
        nx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        ny: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
    };

    v.addEventListener('mousemove', (e) => {
      const p = norm(e);
      this.sendInput({ t: 'm', nx: p.nx, ny: p.ny });
      // 叠加光标跟随
      if (this.overlay) {
        const r = v.getBoundingClientRect();
        this.overlay.style.left = (e.clientX - r.left) + 'px';
        this.overlay.style.top = (e.clientY - r.top) + 'px';
      }
    });
    v.addEventListener('mousedown', (e) => {
      const p = norm(e); this.sendInput({ t: 'b', nx: p.nx, ny: p.ny, btn: e.button, down: true });
      if (e.button === 2) e.preventDefault();
    });
    v.addEventListener('mouseup', (e) => { const p = norm(e); this.sendInput({ t: 'b', nx: p.nx, ny: p.ny, btn: e.button, down: false }); });
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = norm(e); this.sendInput({ t: 'w', nx: p.nx, ny: p.ny, dx: e.deltaX, dy: e.deltaY });
    }, { passive: false });

    // 键盘（在视频聚焦/页面范围内）
    window.addEventListener('keydown', (e) => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      this.sendInput({ t: 'k', key: e.key, code: e.code, down: true });
    });
    window.addEventListener('keyup', (e) => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      this.sendInput({ t: 'k', key: e.key, code: e.code, down: false });
    });
  }

  sendCombo(keys) { this.sendInput({ t: 'combo', keys }); }

  // 下发编码参数（画质按钮）
  sendConfig(cfg) { this.sendInput({ t: 'cfg', quality: cfg.quality, fps: cfg.fps, maxDim: cfg.maxDim }); }

  disconnect() {
    this._stopPing();
    if (this.target) this.sig.bye(this.target);
    this.target = null;
    this._bound = false;
    if (this._lastUrl) { URL.revokeObjectURL(this._lastUrl); this._lastUrl = null; }
    if (this.img) this.img.src = '';
    if (this.waiting) this.waiting.classList.remove('hidden');
    if (this.overlay) this.overlay.classList.add('hidden');
    this.onLatency(null);
    this.onState('已断开');
  }
}
