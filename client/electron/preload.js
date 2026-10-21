'use strict';

/**
 * 预加载脚本：向渲染进程暴露最小化接口
 * - getConfig()：读取已保存的服务端地址等配置
 * - setServerUrl(url)：保存服务端地址
 * - resolveFnConnect(fnId)：按 FN ID 解析出当前可达地址（主进程发起，规避浏览器跨域限制）
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crldesk', {
  platform: process.platform,
  getConfig: () => ipcRenderer.sendSync('get-config'),
  setServerUrl: (url) => ipcRenderer.send('set-server-url', url),
  resolveFnConnect: (fnId) => ipcRenderer.invoke('resolve-fn-connect', fnId),
});
