'use strict'
/**
 * 配置：默认值 + 用户覆盖（深合并）+ 数值夹紧。
 *
 * 覆盖来源（后者优先）：
 *   1. DEFAULT_CONFIG
 *   2. <应用目录>/config.json            —— install.ps1 会把探测到的 Claude 启动方式写进这里
 *   3. 命令行 --config <path>            —— 测试 / CI 用
 *
 * 这里不碰 electron，纯 node，方便单测。
 */
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_CONFIG = {
  claude: {
    // '' = 自动探测。也可以写：
    //   - exe 路径：C:\Users\you\AppData\Local\AnthropicClaude\claude.exe
    //   - 应用 ID：shell:AppsFolder\Claude_xxxxx!Claude（Microsoft Store / MSIX 版）
    //   - macOS：应用名 Claude
    target: '',
    // 用来判断"Claude 的窗口出来了没有"的进程名（不带 .exe）
    processName: 'claude',
  },
  window: {
    // 'fullscreen'：铺满当前屏幕（默认，和 dsh-video-skin 一样的横版全屏）；'card'：屏幕中间一张 16:9 卡片
    mode: 'fullscreen',
    // card 模式下卡片宽度占屏幕工作区宽度的比例
    scale: 0.62,
  },
  animation: {
    // 开机视频（相对应用目录或绝对路径）。tools/render_boot.py 渲染的那段；
    // 换成你自己的 mp4 也行。留空或文件坏了就放内置的 CSS 动画
    video: 'assets/boot.mp4',
    // 角色设定图；换图时布局要和原图一致（裁切框按比例取）
    sheet: 'assets/claude-sheet.webp',
    sound: true,
    volume: 0.9,
    // 播放速度：1 ≈ 9 秒；1.5 ≈ 6 秒
    speed: 1,
  },
  voice: {
    // 启动器用系统 TTS 再说一句话。默认关：现在的 boot.mp4（可灵生成）里已经有对好口型的 "Welcome back!"，
    // 换成没有人声的视频时再打开
    enabled: false,
    text: 'Welcome back!',
    // 在动画第几毫秒开口（按 speed 缩放）
    atMs: 7150,
    // 非空时播这段录音（mp3/wav/ogg，相对应用目录或绝对路径），不用系统 TTS
    file: '',
    lang: 'en-US',
    // 系统 TTS 嗓音的偏好顺序（按名字包含匹配，找不到就用该语言的第一个）
    prefer: ['Aria', 'Jenny', 'Ava', 'Emma', 'Zira', 'Samantha', 'Google US English'],
    rate: 1,
    pitch: 1.15,
    volume: 1,
  },
  timing: {
    fadeMs: 700,
    skipFadeMs: 260,
    // 动画放完了 Claude 窗口还没出来，最多再等这么久就退场
    maxWaitMs: 20000,
  },
  // 启动画面上的文字。开机视频上不叠字；tag/quote/title/subtitle/expressions/views 只在
  // 视频缺失、退回 CSS 备用动画时出现。hint/ready 留空 = 不显示左下角状态
  text: {
    tag: 'A SECRET RENDEZVOUS',
    quote: '“Welcome back!”',
    title: 'Claude',
    subtitle: 'Always elegant. Always composed.',
    expressionsTag: 'EXPRESSIONS',
    expressions: ['Tsundere', 'Gentle', 'Shy', 'Smile', 'Serious', 'Profile'],
    viewsTag: 'CHARACTER',
    views: ['Front', 'Side', 'Back'],
    hint: '',
    ready: '',
    missing: 'Claude Desktop not found — set claude.target in config.json',
    skip: 'Click to skip',
  },
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 深合并：只合并 base 里已有的键，类型不对的覆盖值丢掉（防手滑写坏配置把整个启动搞崩）。 */
function merge(base, patch) {
  if (!isObject(patch)) return base
  const out = {}
  for (const key of Object.keys(base)) {
    const b = base[key]
    const p = patch[key]
    if (p === undefined) out[key] = b
    else if (isObject(b)) out[key] = merge(b, p)
    else if (Array.isArray(b)) out[key] = Array.isArray(p) && p.every((x) => typeof x === 'string') ? p : b
    else out[key] = typeof p === typeof b ? p : b
  }
  return out
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

function normalize(cfg) {
  cfg.window.mode = cfg.window.mode === 'card' ? 'card' : 'fullscreen'
  cfg.window.scale = clamp(Number(cfg.window.scale) || 0.62, 0.3, 1)
  cfg.animation.volume = clamp(Number(cfg.animation.volume), 0, 1)
  cfg.animation.speed = clamp(Number(cfg.animation.speed) || 1, 0.5, 4)
  cfg.voice.atMs = clamp(Number(cfg.voice.atMs) || 0, 0, 20000)
  cfg.voice.rate = clamp(Number(cfg.voice.rate) || 1, 0.5, 2)
  cfg.voice.pitch = clamp(Number(cfg.voice.pitch) || 1, 0, 2)
  cfg.voice.volume = clamp(Number(cfg.voice.volume), 0, 1)
  cfg.timing.fadeMs = clamp(Number(cfg.timing.fadeMs) || 0, 80, 4000)
  cfg.timing.skipFadeMs = clamp(Number(cfg.timing.skipFadeMs) || 0, 0, 2000)
  cfg.timing.maxWaitMs = clamp(Number(cfg.timing.maxWaitMs) || 0, 0, 120000)
  return cfg
}

function readJson(file) {
  try {
    // 记事本存的 UTF-8 会带 BOM
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[splash] 配置读不了，忽略：${file}: ${err.message}`)
    return null
  }
}

function loadConfig(appDir, extraFile) {
  let cfg = merge(DEFAULT_CONFIG, readJson(path.join(appDir, 'config.json')))
  if (extraFile) cfg = merge(cfg, readJson(path.resolve(extraFile)))
  return normalize(cfg)
}

/** 相对路径按应用目录解析。 */
function resolveAsset(appDir, p) {
  if (!p) return ''
  return path.isAbsolute(p) ? p : path.join(appDir, p)
}

module.exports = { DEFAULT_CONFIG, merge, normalize, loadConfig, resolveAsset }
