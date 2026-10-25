'use strict'
// 渲染进程只拿到这几个口子，别的（node、文件系统）一概碰不到。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('splashHost', {
  init: () => ipcRenderer.invoke('splash:init'),
  onClaude: (cb) => ipcRenderer.on('splash:claude', (_e, ev) => cb(ev)),
  onGo: (cb) => ipcRenderer.on('splash:go', () => cb()),
  ready: () => ipcRenderer.send('splash:ready'),
  leaving: (reason) => ipcRenderer.send('splash:leaving', reason),
  done: (reason) => ipcRenderer.send('splash:done', reason),
})
