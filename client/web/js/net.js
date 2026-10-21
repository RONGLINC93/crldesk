'use strict';

/**
 * 信令客户端：封装 WebSocket 与服务端协议
 * 事件通过回调分发：onOpen / onClose / onMessage(type, msg)
 */
class Signaling {
  constructor() {
    this.ws = null;
    this.handlers = {};   // type -> [fn]
    this.connected = false;
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  off(type, fn) {
    if (!this.handlers[type]) return;
    this.handlers[type] = this.handlers[type].filter((f) => f !== fn);
  }
  _emit(type, msg) { (this.handlers[type] || []).forEach((fn) => fn(msg)); }

  connect(url) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (e) { return reject(e); }
      // 二进制帧以 ArrayBuffer 形式接收（画面流）
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.connected = true;
        this._emit('open');
        resolve();
      };
      this.ws.onclose = () => { this.connected = false; this._emit('close'); };
      this.ws.onerror = (e) => { if (!this.connected) reject(e); this._emit('error', e); };
      this.ws.onmessage = (ev) => {
        // 二进制帧（画面流）单独分发
        if (ev.data instanceof ArrayBuffer) {
          this._emit('binary', ev.data);
          return;
        }
        let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
        this._emit(msg.type, msg);
      };
    });
  }

  send(obj) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }

  // 发送二进制帧（画面流）
  sendBinary(buf) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(buf); }

  register(peerId, name, role, fnDomains) {
    this.send({ type: 'register', peerId, name, role, fnDomains: fnDomains || [] });
  }
  list() { this.send({ type: 'list' }); }
  resolve(domain) { this.send({ type: 'resolve', domain }); }
  invite(to, password) { this.send({ type: 'invite', to, password }); }
  inviteAck(to, accept, reason) { this.send({ type: 'invite-ack', to, accept, reason }); }
  relayTarget(to) { this.send({ type: 'relay-target', to }); }
  relay(to, payload) { this.send({ type: 'relay', to, payload }); }
  bye(to) { this.send({ type: 'bye', to }); }
}
