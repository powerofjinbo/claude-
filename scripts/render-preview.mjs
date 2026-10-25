// 把开机动画录成预览：docs/preview.mp4、docs/preview.gif 和几张关键帧截图。
// 不经过 Electron：直接用 Playwright 打开 src/splash/index.html，往页面里塞一份初始化数据。
//
//   node scripts/render-preview.mjs [--width 1280] [--height 720] [--no-video] [--montage]
//
// 默认录的是 boot.mp4（Playwright 的 Chromium 不带 H.264，先临时转成 VP9 webm）；
// --montage 录的是视频缺失时的 CSS 备用动画。
//
// 需要：playwright（带 chromium）、ffmpeg。
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const { loadConfig } = require('../src/config.js')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : def
}
const width = Number(opt('--width', 1280))
const height = Number(opt('--height', 720))
const withVideo = !argv.includes('--no-video')
const montage = argv.includes('--montage')
const docs = path.join(root, 'docs')
fs.mkdirSync(docs, { recursive: true })

const cfg = loadConfig(root, opt('--config', ''))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'splash-rec-'))
let videoUrl = ''
const bootVideo = cfg.animation.video && path.resolve(root, cfg.animation.video)
if (!montage && bootVideo && fs.existsSync(bootVideo)) {
  const webm = path.join(tmp, 'boot.webm')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', bootVideo, '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-s', `${width}x${height}`, '-c:a', 'libopus', webm])
  videoUrl = pathToFileURL(webm).href
}
const init = {
  config: cfg,
  inset: 0,
  fullscreen: true,
  sheetUrl: pathToFileURL(path.join(root, cfg.animation.sheet)).href,
  videoUrl,
  voiceUrl: '',
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({
  viewport: { width, height },
  ...(withVideo ? { recordVideo: { dir: tmp, size: { width, height } } } : {}),
})
const page = await context.newPage()
page.on('console', (m) => console.log('[page]', m.text()))
page.on('pageerror', (e) => {
  console.error('[pageerror]', e)
  process.exitCode = 1
})
await page.addInitScript((data) => {
  window.__SPLASH_INIT__ = data
}, init)
await page.goto(pathToFileURL(path.join(root, 'src/splash/index.html')).href)

// 模拟 Claude 启动进度
await page.evaluate(() => {
  window.__splashClaude({ type: 'launched' })
  setTimeout(() => window.__splashClaude({ type: 'proc' }), 1600)
  setTimeout(() => window.__splashClaude({ type: 'window' }), 3800)
})

const shots = videoUrl
  ? [
      [1300, 'boot-1-neon'],
      [2700, 'boot-2-flare'],
      [5000, 'boot-3-eyes-closed'],
      [8600, 'boot-4-awake'],
    ]
  : [
      [700, 'montage-1-spark'],
      [2350, 'montage-2-expressions'],
      [3900, 'montage-3-views'],
      [5900, 'montage-4-hero'],
      [7700, 'montage-5-title'],
    ]
const prefix = videoUrl ? 'preview' : 'montage'
const start = Date.now()
for (const [ms, name] of shots) {
  const wait = ms / cfg.animation.speed - (Date.now() - start)
  if (wait > 0) await page.waitForTimeout(wait)
  await page.screenshot({ path: path.join(docs, name + '.jpg'), type: 'jpeg', quality: 86 })
  console.log('shot', name, Date.now() - start, 'ms')
}
await page.waitForFunction(() => document.documentElement.hasAttribute('data-done'), null, { timeout: 30000 })
const reason = await page.evaluate(() => document.documentElement.getAttribute('data-done'))
console.log('done:', reason, Date.now() - start, 'ms')
await context.close()
await browser.close()

if (withVideo) {
  const webm = fs.readdirSync(tmp).find((f) => f.endsWith('.webm'))
  const src = path.join(tmp, webm)
  const mp4 = path.join(docs, prefix + '.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.3', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', mp4])
  const gif = path.join(docs, prefix + '.gif')
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', '0.3', '-i', src,
    '-vf', 'fps=10,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    gif,
  ])
  console.log('wrote', path.relative(root, mp4), path.relative(root, gif))
}
fs.rmSync(tmp, { recursive: true, force: true })
