'use strict'
/**
 * 「背景」覆盖层（macOS）：一个透明、点击穿透的窗口，跟着 Claude 的主窗口走，
 * 右边淡淡地画着她，左边是星芒标志 + 花体 "Claude"。
 *
 * Claude Desktop 带调试开关就拒绝启动（"refusing to start — a debugging or network-override
 * switch is present"），所以没法往它的页面里注入真正的背景；这里退而求其次：盖在上面、压得很淡、
 * 鼠标直接穿过去。Claude 不在最前面（被别的窗口挡住、切到别的应用、最小化）时就藏起来。
 *
 * 位置来自 src/mac/claude-window.js（常驻的 osascript，CGWindowList 轮询，不需要任何权限）。
 * Claude 退出后覆盖层自己退出。
 */
const { BrowserWindow } = require('electron')
const { execFile, spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')
const { posixProcessName } = require('./claude')

function parseTrackerLine(line) {
  const s = String(line).trim()
  if (!s.startsWith('{')) return null
  try {
    const v = JSON.parse(s)
    return typeof v.visible === 'boolean' ? v : null
  } catch {
    return null
  }
}

/**
 * @param {{ cfg: object, log: (...a: any[]) => void, onExit: (reason: string) => void }} opts
 */
function startOverlay({ cfg, log, onExit }) {
  const o = cfg.overlay
  const name = posixProcessName(cfg, 'darwin')
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, 'overlay', 'index.html'), {
    query: { her: String(o.opacity), brand: String(o.brandOpacity) },
  })

  let shown = false
  let last = ''
  let stopped = false
  const apply = (st) => {
    if (stopped || win.isDestroyed()) return
    if (st.visible && st.front) {
      const key = `${st.x},${st.y},${st.w},${st.h}`
      if (key !== last) {
        win.setBounds({ x: st.x, y: st.y, width: st.w, height: st.h })
        last = key
      }
      if (!shown) {
        win.showInactive()
        shown = true
      }
    } else if (shown) {
      win.hide()
      shown = false
    }
  }

  const tracker = spawn('osascript', ['-l', 'JavaScript', path.join(__dirname, 'mac', 'claude-window.js'), name, String(o.intervalMs)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [tracker.stdout, tracker.stderr]) {
    readline.createInterface({ input: stream }).on('line', (line) => {
      const st = parseTrackerLine(line)
      if (st) apply(st)
      else if (line.trim()) log('overlay tracker:', line.trim())
    })
  }
  tracker.on('exit', (code) => {
    if (!stopped) stop('tracker-exit:' + code)
  })

  // Claude 退出了就收工
  const alive = setInterval(() => {
    execFile('pgrep', ['-x', name], (err) => {
      if (err) stop('claude-gone')
    })
  }, 2000)

  function stop(reason) {
    if (stopped) return
    stopped = true
    clearInterval(alive)
    try { tracker.kill() } catch {}
    if (!win.isDestroyed()) win.destroy()
    log('overlay: stop', reason)
    onExit(reason)
  }

  log('overlay: started', `opacity=${o.opacity}`)
  return { stop }
}

module.exports = { startOverlay, parseTrackerLine }
