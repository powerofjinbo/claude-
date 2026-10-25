// 端到端：真起 Electron，看它在几种情况下是不是按预期退场。
//
//   node scripts/e2e.mjs
//
// 用一个假的 "Claude" 代替真货：Windows 上是 notepad.exe，其他平台是一个 sleep 的 shell 脚本。
// Linux 没有 DISPLAY 时自动套 xvfb-run。判定靠 %TEMP%/claude-boot-splash.log 里的日志行。
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const electron = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
const logFile = path.join(os.tmpdir(), 'claude-boot-splash.log')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-e2e-'))

let fake
if (win) {
  fake = { file: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe'), name: 'notepad' }
} else if (process.platform === 'darwin') {
  // macOS 上脚本的进程名是解释器（sh），pgrep -x 认不出来：复制一个会一直跑下去的系统程序改个名
  const name = 'fkclaude' + process.pid
  const file = path.join(tmp, name)
  fs.copyFileSync('/usr/bin/caffeinate', file)
  fs.chmodSync(file, 0o755)
  fake = { file, name }
} else {
  const name = 'fkclaude' + process.pid
  const file = path.join(tmp, name)
  fs.writeFileSync(file, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
  fake = { file, name }
}

function killFake() {
  if (win) spawnSync('taskkill', ['/F', '/IM', 'notepad.exe'], { stdio: 'ignore' })
  else spawnSync('pkill', ['-x', fake.name], { stdio: 'ignore' })
}

function writeConfig(name, patch) {
  const file = path.join(tmp, name + '.json')
  fs.writeFileSync(file, JSON.stringify(patch))
  return file
}

function run(extraArgs, timeoutMs = 60000) {
  const args = [root, ...extraArgs]
  let cmd = electron
  if (!win && process.platform === 'linux') {
    args.unshift('--no-sandbox')
    if (!process.env.DISPLAY) {
      args.unshift('-a', '-s', '-screen 0 1920x1080x24', electron)
      cmd = 'xvfb-run'
    }
  }
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(cmd, args, { stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('electron did not exit in time'))
    }, timeoutMs)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, ms: Date.now() - started, log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '' })
    })
  })
}

const failures = []
async function scenario(name, args, expect) {
  process.stdout.write(`- ${name} ... `)
  try {
    const res = await run(args)
    const missing = expect.filter((needle) => !res.log.includes(needle))
    if (res.code !== 0 || missing.length) {
      console.log('FAIL')
      console.log(`  exit=${res.code} missing=${JSON.stringify(missing)}\n` + res.log.replace(/^/gm, '  | '))
      failures.push(name)
    } else {
      console.log(`ok (${res.ms} ms)`)
    }
  } catch (err) {
    console.log('FAIL', err.message)
    failures.push(name)
  }
}

// overlay 关掉：macOS 上动画放完会留下来当覆盖层、等 Claude 退出才退，下面单独测
const fast = { animation: { speed: 4, sound: false }, timing: { maxWaitMs: 15000, fadeMs: 200 }, overlay: { enabled: false } }
const cfg = writeConfig('fake', { ...fast, claude: { target: fake.file, processName: fake.name, windowFallbackMs: 1500 } })
const cfgMissing = writeConfig('missing', { ...fast, claude: { target: path.join(tmp, 'nope.exe'), processName: 'nope-claude' } })

killFake()
// preview 带声音跑：Windows 上顺便确认 TTS 真的开口了（日志里有 "voice: <嗓音名>"）
const cfgVoice = writeConfig('voice', { ...fast, animation: { speed: 4, sound: true }, voice: { enabled: true } })
await scenario('preview', ['--preview', '--config', cfgVoice], ['mode=preview', 'shown', '[splash] animation: video', '"type":"window"', 'quit: done:end', ...(win ? ['[splash] voice:'] : [])])
await scenario('cold start', ['--config', cfg], ['mode=launch', '"type":"launched"', '"type":"proc"', '"type":"window"', 'leaving: end', 'quit: done:end'])
await scenario('already running', ['--config', cfg], ['mode=launch', 'quit: already-running'])
killFake()
await scenario('claude missing', ['--config', cfgMissing], ['"type":"missing"', 'quit: done:missing'])

// attach：先起 splash，再起假 Claude
{
  const p = scenario('attach', ['--attach', '--config', cfg], ['mode=attach', '"type":"attach"', '"type":"proc"', '"type":"window"', 'quit: done:end'])
  setTimeout(() => spawn(fake.file, { stdio: 'ignore', detached: true }).unref(), 1500)
  await p
  killFake()
}

// 动画放着的时候又点了一次快捷方式：第二个实例直接退出，第一个把 Claude 叫到前台，日志也不能被冲掉
{
  const p = scenario('second instance', ['--preview', '--config', cfg], ['mode=preview', 'second instance: bring Claude to front', 'quit: done:end'])
  setTimeout(() => {
    const extra = win || process.platform === 'darwin' ? [] : ['--no-sandbox']
    let cmd = electron
    let argv = [...extra, root]
    if (process.platform === 'linux' && !process.env.DISPLAY) {
      argv = ['-a', electron, ...argv]
      cmd = 'xvfb-run'
    }
    spawn(cmd, argv, { stdio: 'ignore' })
  }, 1200)
  await p
}

// macOS：覆盖层跟着"Claude"活着，Claude 一退它也退
if (process.platform === 'darwin') {
  const cfgOverlay = writeConfig('overlay', { claude: { target: fake.file, processName: fake.name }, overlay: { enabled: true } })
  spawn(fake.file, { stdio: 'ignore', detached: true }).unref()
  const p = scenario('overlay', ['--overlay', '--config', cfgOverlay], ['mode=overlay', 'overlay: started', 'overlay: stop claude-gone'])
  setTimeout(killFake, 4000)
  await p
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failures.length) {
  console.log(`\n${failures.length} scenario(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall e2e scenarios passed')
