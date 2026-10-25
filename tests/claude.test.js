'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseHelperLine, startClaude, macLaunchCommand } = require('../src/claude')
const { DEFAULT_CONFIG, merge } = require('../src/config')

test('helper.ps1 的输出行解析', () => {
  assert.deepEqual(parseHelperLine('ALREADY'), { type: 'already' })
  assert.deepEqual(parseHelperLine('LAUNCHED shell:AppsFolder\\Claude_x!Claude'), {
    type: 'launched',
    target: 'shell:AppsFolder\\Claude_x!Claude',
  })
  assert.deepEqual(parseHelperLine('MISSING'), { type: 'missing', reason: 'not-found' })
  assert.deepEqual(parseHelperLine('MISSING access denied'), { type: 'missing', reason: 'access denied' })
  assert.deepEqual(parseHelperLine('PROC 1234\r'), { type: 'proc', pid: 1234 })
  assert.deepEqual(parseHelperLine('  WINDOW 99 '), { type: 'window', pid: 99 })
  assert.deepEqual(parseHelperLine('ATTACH'), { type: 'attach' })
  assert.equal(parseHelperLine('WARNING: something'), null)
  assert.equal(parseHelperLine(''), null)
})

const posix = process.platform !== 'win32' && (() => {
  try {
    execFileSync('pgrep', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** 一个假的 "Claude"：进程名唯一，活 N 秒。 */
function fakeClaude(seconds) {
  const name = 'fk' + Math.random().toString(36).slice(2, 10)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'splash-fake-')), name)
  fs.writeFileSync(file, `#!/bin/sh\nsleep ${seconds}\n`, { mode: 0o755 })
  return { name, file }
}

function collect(opts, until) {
  return new Promise((resolve, reject) => {
    const events = []
    const timer = setTimeout(() => reject(new Error('timeout: ' + JSON.stringify(events))), 8000)
    const ctl = startClaude({
      ...opts,
      onEvent(ev) {
        events.push(ev.type)
        if (until.includes(ev.type)) {
          clearTimeout(timer)
          ctl.stop()
          resolve(events)
        }
      },
    })
  })
}

test('POSIX：冷启动依次报 launched → proc → window', { skip: !posix }, async () => {
  const fake = fakeClaude(5)
  const cfg = merge(DEFAULT_CONFIG, { claude: { target: fake.file, processName: fake.name } })
  const events = await collect({ cfg, launch: true, platform: 'linux' }, ['window', 'missing'])
  assert.deepEqual(events, ['launched', 'proc', 'window'])
  execFileSync('pkill', ['-x', fake.name], { stdio: 'ignore' })
})

test('POSIX：Claude 本来就开着 → already', { skip: !posix }, async () => {
  const fake = fakeClaude(5)
  const cfg = merge(DEFAULT_CONFIG, { claude: { target: fake.file, processName: fake.name } })
  const first = require('node:child_process').spawn(fake.file, { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 200))
  const events = await collect({ cfg, launch: true, platform: 'linux' }, ['already', 'window'])
  assert.deepEqual(events, ['already'])
  first.kill()
  execFileSync('pkill', ['-x', fake.name], { stdio: 'ignore' })
})

test('POSIX：找不到 Claude → missing', { skip: !posix }, async () => {
  const cfg = merge(DEFAULT_CONFIG, { claude: { target: '/nonexistent/claude', processName: 'fk-none' } })
  const events = await collect({ cfg, launch: true, platform: 'linux' }, ['missing', 'window'])
  assert.deepEqual(events, ['missing'])
})

test('POSIX：attach 模式不启动，只等进程', { skip: !posix }, async () => {
  const fake = fakeClaude(5)
  const cfg = merge(DEFAULT_CONFIG, { claude: { target: '/nonexistent', processName: fake.name } })
  const p = collect({ cfg, launch: false, platform: 'linux' }, ['window'])
  setTimeout(() => require('node:child_process').spawn(fake.file, { stdio: 'ignore' }), 300)
  assert.deepEqual(await p, ['attach', 'proc', 'window'])
  execFileSync('pkill', ['-x', fake.name], { stdio: 'ignore' })
})

test('macOS 启动方式：应用名 / .app 走 open -a，可执行文件直接跑', () => {
  assert.deepEqual(macLaunchCommand(''), ['open', ['-a', 'Claude']])
  assert.deepEqual(macLaunchCommand('Claude'), ['open', ['-a', 'Claude']])
  assert.deepEqual(macLaunchCommand('/Applications/Claude.app'), ['open', ['-a', '/Applications/Claude.app']])
  assert.deepEqual(macLaunchCommand('/tmp/fake-claude'), ['/tmp/fake-claude', []])
})

test('覆盖层：跟踪脚本的输出行解析', () => {
  const { parseTrackerLine } = require('../src/overlay')
  assert.deepEqual(parseTrackerLine('{"visible":true,"front":true,"x":10,"y":20,"w":800,"h":600}'), {
    visible: true, front: true, x: 10, y: 20, w: 800, h: 600,
  })
  assert.deepEqual(parseTrackerLine(' {"visible":false}\n'), { visible: false })
  assert.equal(parseTrackerLine('execution error: something'), null)
  assert.equal(parseTrackerLine('{not json'), null)
  assert.equal(parseTrackerLine('{"x":1}'), null)
})
