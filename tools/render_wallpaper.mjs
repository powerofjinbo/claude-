// 渲染 Claude Desktop 的背景图 assets/wallpaper.jpg：右边是她（托腮侧脸微笑），左边是星芒标志 + 花体 "Claude"。
//
//   node tools/render_wallpaper.mjs [--width 2560] [--height 1600]
//
// 立绘是 assets/claude-portraits.webp 右上那张经 Real-ESRGAN 4× 放大的结果（tools/.cache/wallpaper-x4.png，
// 没有就先跑 python tools/upscale.py）。用 Playwright 排版截图，这样字体和页面里用的是同一套。
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const W = Number(opt('--width', 2560))
const H = Number(opt('--height', 1600))
const portrait = pathToFileURL(path.join(root, 'tools', '.cache', 'wallpaper-x4.png')).href
const font = pathToFileURL(path.join(root, 'assets', 'fonts', 'great-vibes.woff2')).href

// Claude 风格的星芒：12 条长短不一的圆头射线
let rays = ''
let seed = 7
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2 + (rnd() - 0.5) * 0.18
  const len = 62 + rnd() * 30
  rays += `<line x1="${Math.cos(a) * 10}" y1="${Math.sin(a) * 10}" x2="${Math.cos(a) * len}" y2="${Math.sin(a) * len}" stroke-width="${11 + rnd() * 5}"/>`
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Great Vibes'; src: url('${font}') format('woff2'); }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #160b07; }
.bg { position: absolute; inset: -80px; background: url('${portrait}') center/cover; filter: blur(60px) brightness(.42) saturate(1.2); }
.shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(14,7,4,.92) 0%, rgba(14,7,4,.70) 32%, rgba(14,7,4,.15) 55%, rgba(14,7,4,0) 70%); }
.her { position: absolute; right: 0; top: 0; height: 100%; aspect-ratio: 2056 / 2040;
  background: url('${portrait}') center/cover;
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 30%), linear-gradient(0deg, transparent 0%, #000 12%);
  -webkit-mask-composite: source-in; }
.brand { position: absolute; left: ${Math.round(W * 0.085)}px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: ${Math.round(H * 0.03)}px; }
svg { width: ${Math.round(H * 0.16)}px; height: ${Math.round(H * 0.16)}px; overflow: visible; filter: drop-shadow(0 0 ${Math.round(H * 0.02)}px rgba(217,119,87,.8)); }
svg line { stroke: #d97757; stroke-linecap: round; }
.name { font-family: 'Great Vibes', cursive; font-size: ${Math.round(H * 0.2)}px; line-height: 1; padding: 0 .25em .1em .1em;
  background: linear-gradient(100deg, #ffe2c2 0%, #f3a676 45%, #d97757 75%, #ffd6ad 100%); -webkit-background-clip: text; color: transparent;
  filter: drop-shadow(0 0 ${Math.round(H * 0.022)}px rgba(217,119,87,.6)); }
.vignette { position: absolute; inset: 0; background: radial-gradient(ellipse 90% 85% at 60% 50%, transparent 55%, rgba(0,0,0,.55) 100%); }
</style></head><body>
<div class="bg"></div><div class="her"></div><div class="shade"></div><div class="vignette"></div>
<div class="brand"><svg viewBox="-100 -100 200 200">${rays}</svg><div class="name">Claude</div></div>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
// setContent 的页面是 about:blank，读不了 file:// 的图和字体：写成临时文件再打开
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallpaper-')), 'index.html')
fs.writeFileSync(tmp, html)
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
const out = path.join(root, 'assets', 'wallpaper.jpg')
await page.screenshot({ path: out, type: 'jpeg', quality: 90 })
await browser.close()
console.log('wrote', path.relative(root, out), fs.statSync(out).size, 'bytes')
