'use strict';

/**
 * 被控端 Host：捕获本机屏幕，逐帧编码为 JPEG 经服务端中转给主控端；
 * 同时接收主控端输入并注入（经本地代理或叠加层）。
 * 画面流与输入流均通过服务端中转（WebSocket），无 P2P。
 */
class Host {
  constructor(signaling, opts = {}) {
    this.sig = signaling;
    this.peerId = null;
    this.pendingFrom = null;
    this.target = null;            // 当前被控连接的主控端 peerId
    this.agentWs = null;           // 本地代理
    this.stream = null;            // 屏幕流
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.frameTimer = null;
    this.fps = 12;                 // 截图推流帧率
    this.quality = 0.6;            // JPEG 质量
    this.maxDim = 1280;            // 编码最大边长（降带宽）
    this.screenW = 0;
    this.screenH = 0;
    this.overlay = opts.overlay || null;     // 预览叠加光标
    this.preview = opts.preview || null;
    this.useAgent = true;
    this.password = '';                       // 连接密码（主控端需提供）
    this.onState = opts.onState || (() => {});
  }

  setPassword(pwd) { this.password = String(pwd || ''); }

  start(peerId, name) {
    this.peerId = peerId;
    this.name = name;
  }

  setUseAgent(v) { this.useAgent = v; }

  // 连接本地代理（真实输入注入）
  connectAgent(port = 17900) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.onopen = () => { this.agentWs = ws; this.onState('agent', '已连接本地代理'); };
      ws.onclose = () => { this.agentWs = null; this.onState('agent', '本地代理未连接（仅叠加层）'); };
      ws.onerror = () => { this.agentWs = null; };
    } catch (_) { this.agentWs = null; }
  }

  handleInvite(from, fromName, password) {
    // 校验连接密码：正确才自动接受（触发屏幕共享）；错误则拒绝
    if (!this.password || String(password || '') !== this.password) {
      this.sig.inviteAck(from, false, 'wrong-password');
      this.onState('share', '拒绝了一个密码错误的连接请求');
      return;
    }
    this.pendingFrom = from;
    this.accept();
  }

  async accept() {
    if (!this.pendingFrom) return false;
    const target = this.pendingFrom;
    this.pendingFrom = null;
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 }, audio: false,
      });
      const track = this.stream.getVideoTracks()[0];
      const s = track.getSettings();
      this.screenW = s.width || 1920;
      this.screenH = s.height || 1080;

      // 本地预览
      if (this.preview) {
        this.preview.srcObject = this.stream;
        this.preview.classList.remove('hidden');
      }

      // 隐藏 video 用于逐帧绘制
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});

      // 编码尺寸（等比缩放，降低带宽）
      const ratio = Math.min(1, this.maxDim / Math.max(this.screenW, this.screenH));
      this.canvas.width = Math.max(1, Math.round(this.screenW * ratio));
      this.canvas.height = Math.max(1, Math.round(this.screenH * ratio));

      this.target = target;
      // 通知主控端：已接受请求（画面流准备就绪）
      this.sig.inviteAck(target, true);
      // 建立服务端二进制中转目标（画面 -> 主控端）
      this.sig.relayTarget(target);

      if (this.useAgent) this.connectAgent();
      this._startCapture();

      track.onended = () => this.stop();
      this.onState('share', '已连接主控端，正在共享');
      return true;
    } catch (e) {
      this.sig.inviteAck(target, false);
      this.onState('share', '共享失败: ' + e.message);
      return false;
    }
  }

  _startCapture() {
    const frame = () => {
      if (!this.stream) return;
      try {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      } catch (_) {
        this._schedule(frame);
        return;
      }
      this.canvas.toBlob((blob) => {
        if (!blob) { this._schedule(frame); return; }
        blob.arrayBuffer()
          .then((buf) => { if (this.stream) this.sig.sendBinary(buf); })
          .catch(() => {})
          .finally(() => this._schedule(frame));
      }, 'image/jpeg', this.quality);
    };
    this._schedule(frame);
  }

  _schedule(fn) {
    if (!this.stream) return;
    this.frameTimer = setTimeout(fn, Math.round(1000 / this.fps));
  }

  _stopCapture() {
    if (this.frameTimer) { clearTimeout(this.frameTimer); this.frameTimer = null; }
  }

  // 接收主控端输入（经服务端中转的输入事件对象）
  onInput(m) {
    // 剪贴板：优先经代理原生写入，否则回退浏览器剪贴板
    if (m.t === 'clipboard') {
      if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
        this.agentWs.send(JSON.stringify({ t: 'clipboard', text: m.text || '' }));
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(m.text || '').catch(() => {});
      }
      return;
    }
    // 画质/编码参数调整（主控端下发）
    if (m.t === 'cfg') { this._applyConfig(m); return; }
    // 延迟探测：回复 pong
    if (m.t === 'ping') { this._replyPong(m); return; }

    if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
      this._toAgent(m);
    } else if (this.overlay && this.preview) {
      this._overlay(m);
    }
  }

  // 动态调整编码参数（画质按钮）
  _applyConfig(cfg) {
    if (cfg.quality != null) this.quality = Math.min(1, Math.max(0.1, +cfg.quality));
    if (cfg.fps != null) this.fps = Math.min(30, Math.max(1, +cfg.fps));
    if (cfg.maxDim != null) {
      this.maxDim = Math.min(2560, Math.max(320, +cfg.maxDim));
      const ratio = Math.min(1, this.maxDim / Math.max(this.screenW, this.screenH));
      this.canvas.width = Math.max(1, Math.round(this.screenW * ratio));
      this.canvas.height = Math.max(1, Math.round(this.screenH * ratio));
    }
  }

  _replyPong(m) {
    if (this.target) this.sig.relay(this.target, { t: 'pong', ts: m.ts });
  }

  // 反向剪贴板：读取本机剪贴板发给主控端
  async sendClipboard() {
    if (!this.target) return false;
    try {
      const text = await navigator.clipboard.readText();
      this.sig.relay(this.target, { t: 'clipboard', text });
      return true;
    } catch (_) { return false; }
  }

  _toAgent(m) {
    const x = Math.round((m.nx || 0) * this.screenW);
    const y = Math.round((m.ny || 0) * this.screenH);
    const a = this.agentWs;
    switch (m.t) {
      case 'm': a.send(JSON.stringify({ t: 'mousemove', x, y })); break;
      case 'b':
        if (m.down) a.send(JSON.stringify({ t: 'mousedown', x, y, button: m.btn }));
        else a.send(JSON.stringify({ t: 'mouseup', x, y, button: m.btn }));
        break;
      case 'w': a.send(JSON.stringify({ t: 'wheel', x, y, dx: m.dx, dy: m.dy })); break;
      case 'k':
        a.send(JSON.stringify({ t: m.down ? 'keydown' : 'keyup', code: m.code, key: m.key }));
        break;
      case 'combo': a.send(JSON.stringify({ t: 'combination', keys: m.keys })); break;
    }
  }

  _overlay(m) {
    const p = this.preview;
    const r = p.getBoundingClientRect();
    const px = (m.nx || 0) * r.width;
    const py = (m.ny || 0) * r.height;
    this.overlay.style.left = px + 'px';
    this.overlay.style.top = py + 'px';
    this.overlay.style.display = 'block';
  }

  stop() {
    this._stopCapture();
    if (this.target) {
      this.sig.relayTarget(null);
      this.sig.bye(this.target);
    }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.target = null;
    if (this.preview) this.preview.classList.add('hidden');
    this.onState('share', '已停止共享');
  }
}
