'use strict'
/**
 * Claude 开机动画 —— Electron 主进程。
 *
 * 用法：
 *   electron .              发起启动 Claude Desktop，同时放动画（桌面/开始菜单快捷方式走这个）
 *   electron . --attach     Claude 已经被别人启动了，只放动画（scripts/watch-claude.ps1 走这个）
 *   electron . --preview    不碰 Claude，模拟一遍启动进度（看效果用）
 *   --config <file>         额外的配置文件，覆盖 config.json
 *
 * 动画窗口：无边框、透明、置顶、不进任务栏。渲染进程只拿到 preload 里那几个 IPC 口子。
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { loadConfig, resolveAsset } = require('./config')
const { startClaude } = require('./claude')

const APP_DIR = path.join(__dirname, '..')
const SHADOW_INSET = 28
const ANIMATION_MS = 9500

function parseArgs(argv) {
  const out = { attach: false, preview: false, config: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--attach') out.attach = true
    else if (argv[i] === '--preview') out.preview = true
    else if (argv[i] === '--config') out.config = argv[++i] || ''
  }
  return out
}

const args = parseArgs(process.argv.slice(1))

// 日志：GUI 程序没有控制台，排查问题看 %TEMP%\claude-boot-splash.log
const logFile = path.join(os.tmpdir(), 'claude-boot-splash.log')
const t0 = Date.now()
try { fs.writeFileSync(logFile, '') } catch {}
function log(...parts) {
  const line = `[+${String(Date.now() - t0).padStart(5)}ms] ${parts.join(' ')}`
  console.log(line)
  try { fs.appendFileSync(logFile, line + '\n') } catch {}
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (!app.requestSingleInstanceLock()) {
  // 已经有一个动画在放了（例如快捷方式启动 + 后台 watcher 同时触发）
  app.quit()
} else {
  app.whenReady().then(main)
}

function windowBounds(cfg) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  if (cfg.window.mode === 'fullscreen') {
    return { bounds: { ...display.bounds }, inset: 0, fullscreen: true }
  }
  let w = Math.round(wa.width * cfg.window.scale)
  let h = Math.round((w * 9) / 16)
  if (h > wa.height * 0.9) {
    h = Math.round(wa.height * 0.9)
    w = Math.round((h * 16) / 9)
  }
  const W = w + SHADOW_INSET * 2
  const H = h + SHADOW_INSET * 2
  return {
    bounds: {
      x: Math.round(wa.x + (wa.width - W) / 2),
      y: Math.round(wa.y + (wa.height - H) / 2),
      width: W,
      height: H,
    },
    inset: SHADOW_INSET,
    fullscreen: false,
  }
}

function main() {
  const cfg = loadConfig(APP_DIR, args.config)
  const mode = args.preview ? 'preview' : args.attach ? 'attach' : 'launch'
  log('mode=' + mode, 'platform=' + process.platform, 'window=' + cfg.window.mode)

  const layout = windowBounds(cfg)
  const win = new BrowserWindow({
    ...layout.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Claude',
    icon: path.join(APP_DIR, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setMenu(null)

  let claude = null
  let firstStatus = mode !== 'launch' // 只有 launch 模式要先确认"Claude 是不是本来就开着"
  let rendererReady = false
  let shown = false
  let quitting = false
  const pending = []

  function send(ev) {
    log('claude:', JSON.stringify(ev))
    if (rendererReady) win.webContents.send('splash:claude', ev)
    else pending.push(ev)
  }

  function quit(reason) {
    if (quitting) return
    quitting = true
    log('quit:', reason)
    if (claude) claude.stop()
    if (!win.isDestroyed()) win.destroy()
    app.quit()
  }

  function maybeShow() {
    if (shown || !rendererReady || !firstStatus) return
    shown = true
    if (mode === 'attach') win.showInactive() // Claude 已经在前台了，别抢焦点
    else win.show()
    win.webContents.send('splash:go')
    log('shown')
    // 兜底：渲染进程卡死也不能挡住屏幕
    const hardMs = ANIMATION_MS / cfg.animation.speed + cfg.timing.maxWaitMs + 8000
    setTimeout(() => quit('hard-timeout'), hardMs).unref()
  }

  ipcMain.handle('splash:init', () => {
    const video = resolveAsset(APP_DIR, cfg.animation.video)
    const voice = resolveAsset(APP_DIR, cfg.voice.file)
    return {
      config: cfg,
      inset: layout.inset,
      fullscreen: layout.fullscreen,
      sheetUrl: pathToFileURL(resolveAsset(APP_DIR, cfg.animation.sheet)).href,
      videoUrl: video && fs.existsSync(video) ? pathToFileURL(video).href : '',
      voiceUrl: voice && fs.existsSync(voice) ? pathToFileURL(voice).href : '',
    }
  })
  ipcMain.on('splash:ready', () => {
    rendererReady = true
    for (const ev of pending.splice(0)) win.webContents.send('splash:claude', ev)
    maybeShow()
  })
  ipcMain.on('splash:leaving', (_e, reason) => {
    log('leaving:', reason)
    if (claude) claude.focus()
  })
  ipcMain.on('splash:done', (_e, reason) => quit('done:' + reason))

  win.webContents.on('console-message', (e, _level, message) => log('renderer:', e.message ?? message))
  win.webContents.on('render-process-gone', (_e, d) => quit('renderer-gone:' + d.reason))
  win.loadFile(path.join(__dirname, 'splash', 'index.html'))

  if (mode === 'preview') {
    // 模拟一次正常的冷启动
    const fake = [[0, { type: 'launched', target: 'preview' }], [1600, { type: 'proc', pid: 0 }], [3800, { type: 'window', pid: 0 }]]
    for (const [ms, ev] of fake) setTimeout(() => send(ev), ms)
    return
  }

  claude = startClaude({
    cfg,
    launch: mode === 'launch',
    onEvent(ev) {
      if (ev.type === 'already') {
        // Claude 本来就开着：helper 已经把它叫到前台了，不放动画
        if (!shown) return quit('already-running')
        return send({ type: 'window', pid: 0 })
      }
      if (ev.type === 'focused') return log('focused')
      send(ev)
      if (!firstStatus) {
        firstStatus = true
        maybeShow()
      }
    },
  })
  // helper 迟迟不回话（PowerShell 冷启动慢、被杀毒拦了……）也照样放动画
  setTimeout(() => {
    if (!firstStatus) {
      log('no status from helper yet, showing anyway')
      firstStatus = true
      maybeShow()
    }
  }, 2500)
}

app.on('window-all-closed', () => app.quit())
