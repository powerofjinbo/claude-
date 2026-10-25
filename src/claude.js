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
 * macOS / 其他平台是尽力而为：只看进程，进程出现后稍等一下就当窗口出来了。
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

/** macOS / Linux：轮询进程名。 */
function startPosix({ cfg, launch, onEvent, platform }) {
  const name = cfg.claude.processName || 'claude'
  let timer = null
  let stopped = false
  const pgrep = (cb) => execFile('pgrep', ['-i', '-x', name], (err, out) => cb(!err && String(out).trim() !== ''))

  const watch = () => {
    let sawProc = false
    const tick = () => {
      if (stopped) return
      pgrep((alive) => {
        if (stopped) return
        if (alive && !sawProc) {
          sawProc = true
          onEvent({ type: 'proc', pid: 0 })
          // 不去查窗口（macOS 要辅助功能权限），进程起来后给它一点时间建窗口
          timer = setTimeout(() => !stopped && onEvent({ type: 'window', pid: 0 }), 1500)
          return
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
      const cmd = platform === 'darwin' ? ['open', ['-a', target || 'Claude']] : target ? [target, []] : null
      if (!cmd) return onEvent({ type: 'missing', reason: 'not-found' })
      const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' })
      child.on('error', (err) => onEvent({ type: 'missing', reason: err.message }))
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
      if (platform === 'darwin') spawn('open', ['-a', cfg.claude.target || 'Claude'], { stdio: 'ignore' }).on('error', () => {})
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

module.exports = { startClaude, parseHelperLine }
