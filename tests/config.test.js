'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DEFAULT_CONFIG, merge, loadConfig, resolveAsset } = require('../src/config')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'splash-cfg-'))
}

test('没有 config.json 时就是默认值', () => {
  const cfg = loadConfig(tmpDir())
  assert.deepEqual(cfg, DEFAULT_CONFIG)
})

test('深合并只覆盖给出的键，类型不对的值丢掉', () => {
  const out = merge(DEFAULT_CONFIG, {
    claude: { target: 'C:\\x\\claude.exe' },
    window: { scale: 'big' },
    text: { expressions: ['a', 2] },
    unknown: { whatever: 1 },
  })
  assert.equal(out.claude.target, 'C:\\x\\claude.exe')
  assert.equal(out.claude.processName, 'claude')
  assert.equal(out.window.scale, DEFAULT_CONFIG.window.scale)
  assert.deepEqual(out.text.expressions, DEFAULT_CONFIG.text.expressions)
  assert.equal(out.unknown, undefined)
})

test('数值会被夹到安全范围，mode 只认两个值', () => {
  const dir = tmpDir()
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ window: { mode: 'huge', scale: 5 }, animation: { speed: 100, volume: -1 }, timing: { maxWaitMs: 1e9 } }),
  )
  const cfg = loadConfig(dir)
  assert.equal(cfg.window.mode, 'card')
  assert.equal(cfg.window.scale, 1)
  assert.equal(cfg.animation.speed, 4)
  assert.equal(cfg.animation.volume, 0)
  assert.equal(cfg.timing.maxWaitMs, 120000)
})

test('带 BOM 的 config.json（记事本保存的）照样能读', () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'config.json'), '\uFEFF' + JSON.stringify({ window: { mode: 'fullscreen' } }))
  assert.equal(loadConfig(dir).window.mode, 'fullscreen')
})

test('写坏的 config.json 不会让启动崩掉', () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'config.json'), '{ not json')
  const errors = []
  const orig = console.error
  console.error = (m) => errors.push(m)
  try {
    assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG)
  } finally {
    console.error = orig
  }
  assert.equal(errors.length, 1)
})

test('--config 文件优先于 config.json', () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ animation: { speed: 2 } }))
  const extra = path.join(dir, 'extra.json')
  fs.writeFileSync(extra, JSON.stringify({ animation: { speed: 3 } }))
  assert.equal(loadConfig(dir, extra).animation.speed, 3)
})

test('相对素材路径按应用目录解析', () => {
  assert.equal(resolveAsset('/app', ''), '')
  assert.equal(resolveAsset('/app', 'assets/a.mp4'), path.join('/app', 'assets/a.mp4'))
  const abs = path.resolve('/x/y.mp4')
  assert.equal(resolveAsset('/app', abs), abs)
})
