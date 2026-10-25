'use strict'
/**
 * 启动 Claude Desktop，并报告它的启动进度。
 *
 * 事件（onEvent({ type, ... })）按发生顺序：
 *   already            Claude 本来就开着（只是把它叫到前台）—— 这时不放动画
 *   launched | attach  已经发起启动 / 只旁观（watcher 模式，Claude 是别人启动的）
 *   missing            找不到 Claude
 *   proc               进程起来了
 *   window             窗口出来了
 *
 * Windows 上所有细节都在 src/win/helper.ps1 里（一个常驻的 PowerShell，避免每 200ms 起一次进程）。
 * macOS：open -a 启动，pgrep 看进程，CGWindowList 看窗口（src/mac/window-count.js）。
 * Linux（只有测试用得到）：只看进程，进程出现后稍等一下就当窗口出来了。
 */
const { spawn, execFile } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')

/** helper.ps1 的一行输出 → 事件；不认识的行返回 null。 */
function parseHelperLine(line) {
  const m = /^(ALREADY|LAUNCHED|MISSING|ATTACH|PROC|WINDOW|FOCUSED)\b\s*(.*)$/.exec(String(line).trim())
  if (!m) return null
  const type = m[1].toLowerCase()
  const rest = m[2]
  if (type === 'proc' || type === 'window') return { type, pid: Number(rest) || 0 }
  if (type === 'launched') return { type, target: rest }
  if (type === 'missing') return { type, reason: rest || 'not-found' }
  return { type }
}

function startWindows({ cfg, launch, onEvent }) {
  const script = path.join(__dirname, 'win', 'helper.ps1')
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-ProcessName', cfg.claude.processName,
    '-ParentPid', String(process.pid),
  ]
  if (cfg.claude.target) args.push('-Target', cfg.claude.target)
  if (launch) args.push('-Launch')
  const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const ev = parseHelperLine(line)
    if (ev) onEvent(ev)
  })
  child.stderr.on('data', (d) => console.error('[splash] helper:', String(d).trim()))
  child.on('error', (err) => onEvent({ type: 'missing', reason: err.message }))
  return {
    focus() {
      if (child.stdin.writable) child.stdin.write('FOCUS\n')
    },
    stop() {
      try { child.stdin.end() } catch {}
      child.kill()
    },
  }
}

/**
 * 要找的进程名，**区分大小写**。macOS 上 Claude Desktop 的进程叫 "Claude"，而 Claude Code 命令行叫 "claude"：
 * 早先用 pgrep -i 不分大小写，开着 Claude Code 时就会把它当成 Claude Desktop（覆盖层以为 Claude 没退出、一直占着锁，
 * 下次打开 Claude 的开机动画就被挡掉了）。
 */
function posixProcessName(cfg, platform) {
  const n = cfg.claude.processName || 'claude'
  return platform === 'darwin' && n === 'claude' ? 'Claude' : n
}

/** macOS 上 cfg.claude.target 怎么启动：应用名 / .app 路径走 open -a，可执行文件路径直接跑（测试用）。 */
function macLaunchCommand(target) {
  const t = target || 'Claude'
  if (t.endsWith('.app') || !t.includes('/')) return ['open', ['-a', t]]
  return [t, []]
}

/**
 * macOS / Linux：轮询进程名。
 * macOS 上再用 src/mac/window-count.js（CGWindowList，不需要辅助功能权限）确认窗口真的出来了；
 * 一直数不到窗口（比如测试里的假 Claude 根本没有窗口）就在 windowFallbackMs 之后当它出来了。
 * Linux 只看进程，进程出现后 1.5 秒当窗口出来了。
 */
function startPosix({ cfg, launch, onEvent, platform }) {
  const name = posixProcessName(cfg, platform)
  let timer = null
  let stopped = false
  const pgrep = (cb) => execFile('pgrep', ['-x', name], (err, out) => cb(!err && String(out).trim() !== ''))
  const probe = path.join(__dirname, 'mac', 'window-count.js')
  const countWindows = (cb) =>
    execFile('osascript', ['-l', 'JavaScript', probe, name], { timeout: 3000 }, (err, out) => cb(err ? 0 : Number(String(out).trim()) || 0))

  const windowReady = () => !stopped && onEvent({ type: 'window', pid: 0 })

  const waitWindow = () => {
    if (platform !== 'darwin') {
      timer = setTimeout(windowReady, 1500)
      return
    }
    const deadline = Date.now() + (cfg.claude.windowFallbackMs || 8000)
    const poll = () => {
      if (stopped) return
      countWindows((n) => {
        if (stopped) return
        if (n > 0 || Date.now() >= deadline) return windowReady()
        timer = setTimeout(poll, 300)
      })
    }
    poll()
  }

  const watch = () => {
    let sawProc = false
    const tick = () => {
      if (stopped) return
      pgrep((alive) => {
        if (stopped) return
        if (alive && !sawProc) {
          sawProc = true
          onEvent({ type: 'proc', pid: 0 })
          return waitWindow()
        }
        if (!sawProc) timer = setTimeout(tick, 250)
      })
    }
    tick()
  }

  if (!launch) {
    onEvent({ type: 'attach' })
    watch()
  } else {
    pgrep((running) => {
      const target = cfg.claude.target
      const cmd = platform === 'darwin' ? macLaunchCommand(target) : target ? [target, []] : null
      if (!cmd) return onEvent({ type: 'missing', reason: 'not-found' })
      const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' })
      let failed = false
      child.on('error', (err) => {
        failed = true
        onEvent({ type: 'missing', reason: err.message })
      })
      // open -a 找不到应用时会以非 0 退出
      child.on('exit', (code) => {
        if (code && cmd[0] === 'open' && !failed) onEvent({ type: 'missing', reason: 'open exited ' + code })
      })
      child.on('spawn', () => {
        child.unref()
        if (running) return onEvent({ type: 'already' })
        onEvent({ type: 'launched', target: target || 'Claude' })
        watch()
      })
    })
  }
  return {
    focus() {
      if (platform !== 'darwin') return
      const cmd = macLaunchCommand(cfg.claude.target)
      if (cmd[0] === 'open') spawn(cmd[0], cmd[1], { stdio: 'ignore' }).on('error', () => {})
    },
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

/**
 * @param {{ cfg: object, launch: boolean, onEvent: (ev: object) => void, platform?: string }} opts
 * @returns {{ focus(): void, stop(): void }}
 */
function startClaude(opts) {
  const platform = opts.platform || process.platform
  if (platform === 'win32') return startWindows(opts)
  return startPosix({ ...opts, platform })
}

module.exports = { startClaude, parseHelperLine, macLaunchCommand, posixProcessName }
