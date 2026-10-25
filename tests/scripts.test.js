'use strict'
// Windows PowerShell 5.1 按系统 ANSI 代码页读不带 BOM 的脚本，里面有中文就会把字符串拆坏。
// 所以 .ps1 / .vbs 必须是纯 ASCII。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const files = [
  'src/win/helper.ps1', 'scripts/install.ps1', 'scripts/uninstall.ps1', 'scripts/watch-claude.ps1', 'scripts/watch-claude.vbs',
  'scripts/install-mac.sh', 'scripts/uninstall-mac.sh', 'scripts/watch-claude-mac.sh', 'src/mac/window-count.js', 'src/mac/claude-window.js',
]

for (const rel of files) {
  test(`${rel} 是纯 ASCII`, () => {
    const buf = fs.readFileSync(path.join(root, rel))
    const bad = buf.findIndex((b) => b > 0x7e || (b < 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09))
    assert.equal(bad, -1, `non-ASCII byte at offset ${bad}`)
  })
}

const { spawnSync } = require('node:child_process')
const hasBash = spawnSync('bash', ['--version']).status === 0

for (const rel of ['scripts/install-mac.sh', 'scripts/uninstall-mac.sh', 'scripts/watch-claude-mac.sh']) {
  test(`${rel} 语法正确、可执行`, { skip: !hasBash }, () => {
    const file = path.join(root, rel)
    const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    if (process.platform !== 'win32') assert.ok(fs.statSync(file).mode & 0o111, 'not executable')
  })
}
