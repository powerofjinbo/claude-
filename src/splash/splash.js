/* Claude 开机动画（渲染进程）。
 *
 * 默认放 assets/boot.mp4（tools/render_boot.py 渲染：光线勾勒轮廓 → 过曝 → 上色 → 睁眼），
 * 画面上不加字，睁眼那一刻用 TTS 说 "Welcome back!"；视频缺失或解码失败时退回下面这套纯 CSS 动画。
 *
 * CSS 动画时间轴（speed = 1，单位 ms）：
 *    0 ─ 1150  A 星芒：射线从中心长出来，转半圈定住，闪白转场
 * 1150 ─ 3000  B 表情集：六张卡片依次飞入，镜头横移，放大虚化退场
 * 2950 ─ 4450  C 全身设定：正/侧/背三视图自下而上揭开，扫光
 * 4350 ─ 7900  D 主视觉：立绘 + 台词逐字浮现 + 花体 "Claude" 落款
 * 7900         动画结束；Claude 窗口也出来了就淡出，没出来就停在 D 上等
 *
 * 退场条件（谁先满足谁算）：
 *   - 点击 / Esc / 空格 / 回车：立刻跳过（skipFadeMs）
 *   - 动画放完 且 Claude 窗口已出现：正常淡出（fadeMs）
 *   - 动画放完后又等了 maxWaitMs：超时淡出
 *   - 找不到 Claude：动画放完后提示 2.5 秒再淡出
 */
;(function () {
  'use strict'

  // 设定图里的裁切框，按 1536×1024 原图的像素写、按比例用（换更高清的同版式原图也对得上）
  var SHEET_W = 1536
  var SHEET_H = 1024
  var RECT = {
    expressions: [
      [18, 741, 147, 220],
      [178, 741, 149, 220],
      [340, 741, 150, 220],
      [503, 741, 154, 220],
      [670, 741, 152, 220],
      [836, 741, 160, 220],
    ],
    views: [
      [600, 50, 278, 582],
      [862, 50, 166, 582],
      [1003, 50, 193, 582],
    ],
    portrait: [252, 0, 360, 640],
    scene: [1023, 692, 255, 140],
    city: [1284, 692, 239, 140],
  }

  var STAGE_W = 1600
  var STAGE_H = 900
  var END_MS = 7900

  var $ = function (sel) { return document.querySelector(sel) }
  var frame = $('#frame')
  var stage = $('#stage')
  var hud = $('.hud')
  var fill = $('.fill')
  var hintText = $('.hint-text')

  var host = window.splashHost || null
  var cfg = null
  var speed = 1
  var T = function (ms) { return ms / speed }

  var state = {
    started: false,
    animDone: false,
    animDoneAt: 0,
    claude: 'pending', // pending | launched | proc | window | missing
    leaving: false,
    progress: 0,
  }
  var sound = null
  var voice = null

  // ------------------------------------------------------------------ 工具

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  // 入场动画 fill 'both'（延迟期间停在第一帧）；退场动画必须只 fill 'forwards'，
  // 否则它的第一帧（opacity: 1）会在延迟期间盖掉入场动画，场景一开始就全叠在一起。
  function anim(node, keyframes, delay, duration, easing, fill) {
    return node.animate(keyframes, {
      delay: T(delay),
      duration: T(duration),
      easing: easing || 'cubic-bezier(.2,.8,.2,1)',
      fill: fill || 'both',
    })
  }
  function out(node, keyframes, delay, duration, easing) {
    return anim(node, keyframes, delay, duration, easing, 'forwards')
  }
  function sweepAcross(node, from, to, delay, duration) {
    anim(node, [
      { opacity: 0, transform: 'translateX(' + from + 'px) rotate(14deg)' },
      { opacity: 1, offset: 0.2 },
      { opacity: 1, offset: 0.8 },
      { opacity: 0, transform: 'translateX(' + to + 'px) rotate(14deg)' },
    ], delay, duration, 'ease-in-out')
  }

  /** 把设定图的一块铺进 node（cover 方式：框的比例和 node 不同时以中心为准裁掉多余）。 */
  function paintCrop(node, rect, w, h, img) {
    var kx = img.naturalWidth / SHEET_W
    var ky = img.naturalHeight / SHEET_H
    var sx = rect[0] * kx
    var sy = rect[1] * ky
    var sw = rect[2] * kx
    var sh = rect[3] * ky
    var want = w / h
    if (sw / sh > want) {
      var nw = sh * want
      sx += (sw - nw) / 2
      sw = nw
    } else {
      var nh = sw / want
      sy += (sh - nh) / 2
      sh = nh
    }
    var scale = w / sw
    node.style.width = w + 'px'
    node.style.height = h + 'px'
    node.style.backgroundImage = 'url("' + img.src + '")'
    node.style.backgroundSize = img.naturalWidth * scale + 'px ' + img.naturalHeight * scale + 'px'
    node.style.backgroundPosition = -sx * scale + 'px ' + -sy * scale + 'px'
  }

  function sparkLines(svg, rays, seed) {
    var ns = 'http://www.w3.org/2000/svg'
    var lines = []
    var rnd = seed
    var next = function () {
      rnd = (rnd * 9301 + 49297) % 233280
      return rnd / 233280
    }
    for (var i = 0; i < rays; i++) {
      var a = (i / rays) * Math.PI * 2 + (next() - 0.5) * 0.18
      var len = 62 + next() * 30
      var line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', String(Math.cos(a) * 10))
      line.setAttribute('y1', String(Math.sin(a) * 10))
      line.setAttribute('x2', String(Math.cos(a) * len))
      line.setAttribute('y2', String(Math.sin(a) * len))
      line.setAttribute('stroke-width', String(11 + next() * 5))
      line.setAttribute('pathLength', '1')
      line.style.strokeDasharray = '1'
      svg.appendChild(line)
      lines.push(line)
    }
    return lines
  }

  function fit() {
    var r = frame.getBoundingClientRect()
    var s = Math.min(r.width / STAGE_W, r.height / STAGE_H)
    stage.style.transform = 'scale(' + s + ') translate(-50%, -50%)'
    dust.resize(r.width, r.height)
    fitBackground()
  }

  var sheet = null
  function fitBackground() {
    if (!sheet) return
    var r = frame.getBoundingClientRect()
    paintCrop($('#bgimg'), RECT.city, Math.round(r.width * 1.12), Math.round(r.height * 1.12), sheet)
  }

  // ------------------------------------------------------------------ 浮尘粒子

  var dust = (function () {
    var canvas = $('#dust')
    var ctx = canvas.getContext('2d')
    var dots = []
    var w = 0
    var h = 0
    var dpr = 1
    var running = false
    function resize(nw, nh) {
      dpr = window.devicePixelRatio || 1
      w = nw
      h = nh
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      if (!dots.length) {
        for (var i = 0; i < 70; i++) dots.push(spawn(true))
      }
    }
    function spawn(anywhere) {
      return {
        x: Math.random(),
        y: anywhere ? Math.random() : 1.05,
        r: 1 + Math.random() * 3.5,
        vy: 0.00006 + Math.random() * 0.00012,
        vx: (Math.random() - 0.5) * 0.00004,
        tw: Math.random() * Math.PI * 2,
        hue: 18 + Math.random() * 24,
      }
    }
    function frameLoop(t) {
      if (!running) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i]
        d.y -= d.vy * 16
        d.x += d.vx * 16
        if (d.y < -0.05) dots[i] = d = spawn(false)
        var a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t / 700 + d.tw))
        var px = d.x * w
        var py = d.y * h
        var rr = d.r * (h / 700) * 3
        var g = ctx.createRadialGradient(px, py, 0, px, py, rr)
        g.addColorStop(0, 'hsla(' + d.hue + ',100%,78%,' + a + ')')
        g.addColorStop(1, 'hsla(' + d.hue + ',100%,60%,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(px, py, rr, 0, Math.PI * 2)
        ctx.fill()
      }
      requestAnimationFrame(frameLoop)
    }
    return {
      resize: resize,
      start: function () {
        if (running) return
        running = true
        requestAnimationFrame(frameLoop)
      },
      stop: function () { running = false },
    }
  })()

  // ------------------------------------------------------------------ 声音（WebAudio 现场合成，不带音频文件）

  function createSound(volume) {
    var AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    var ctx = new AC()
    var master = ctx.createGain()
    master.gain.value = volume
    master.connect(ctx.destination)
    var bus = ctx.createGain()
    bus.connect(master)
    // 简易混响：衰减白噪声当冲激响应
    var conv = ctx.createConvolver()
    var len = Math.round(ctx.sampleRate * 2.6)
    var ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (var ch = 0; ch < 2; ch++) {
      var data = ir.getChannelData(ch)
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4)
    }
    conv.buffer = ir
    var wet = ctx.createGain()
    wet.gain.value = 0.42
    bus.connect(conv)
    conv.connect(wet)
    wet.connect(master)

    var t0 = 0
    var at = function (ms) { return t0 + T(ms) / 1000 }
    var hz = function (n) { return 440 * Math.pow(2, (n - 69) / 12) }

    function bell(ms, note, gain, dur) {
      var t = at(ms)
      var f = hz(note)
      ;[[1, 1], [2.0, 0.35], [3.01, 0.12]].forEach(function (p) {
        var o = ctx.createOscillator()
        var g = ctx.createGain()
        o.type = 'sine'
        o.frequency.value = f * p[0]
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(gain * p[1], t + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 1.8) / p[0])
        o.connect(g)
        g.connect(bus)
        o.start(t)
        o.stop(t + (dur || 1.8) + 0.1)
      })
    }

    function pad(ms, notes, gain, dur) {
      var t = at(ms)
      var d = T(dur) / 1000
      var lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      var g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(gain, t + 1.2)
      g.gain.setValueAtTime(gain, t + Math.max(1.3, d - 1.5))
      g.gain.exponentialRampToValueAtTime(0.0001, t + d)
      lp.connect(g)
      g.connect(bus)
      notes.forEach(function (n, i) {
        var o = ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.value = hz(n)
        o.detune.value = i % 2 ? 6 : -6
        o.connect(lp)
        o.start(t)
        o.stop(t + d + 0.1)
      })
    }

    function whoosh(ms, gain) {
      var t = at(ms)
      var n = Math.round(ctx.sampleRate * 0.7)
      var buf = ctx.createBuffer(1, n, ctx.sampleRate)
      var data = buf.getChannelData(0)
      for (var i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
      var src = ctx.createBufferSource()
      src.buffer = buf
      var bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 1.4
      bp.frequency.setValueAtTime(320, t)
      bp.frequency.exponentialRampToValueAtTime(3600, t + 0.45)
      var g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(gain, t + 0.25)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65)
      src.connect(bp)
      bp.connect(g)
      g.connect(bus)
      src.start(t)
    }

    function boom(ms, gain) {
      var t = at(ms)
      var o = ctx.createOscillator()
      var g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(90, t)
      o.frequency.exponentialRampToValueAtTime(42, t + 0.6)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
      o.connect(g)
      g.connect(master)
      o.start(t)
      o.stop(t + 1.2)
    }

    return {
      play: function () {
        if (ctx.state === 'suspended') ctx.resume()
        t0 = ctx.currentTime + 0.05
        // A 大调：A2 E3 A3 C#4 的垫底
        pad(0, [45, 52, 57, 61], 0.05, END_MS + 1500)
        ;[81, 85, 88, 93].forEach(function (n, i) { bell(80 + i * 170, n, 0.16, 2.2) })
        whoosh(1000, 0.22)
        bell(1150, 88, 0.1, 2)
        ;[81, 83, 85, 88, 90, 93].forEach(function (n, i) { bell(1300 + i * 110, n, 0.07, 1.4) })
        whoosh(2850, 0.24)
        boom(3000, 0.5)
        bell(3050, 69, 0.12, 2.6)
        bell(3200, 76, 0.1, 2.6)
        whoosh(4250, 0.24)
        boom(4400, 0.45)
        bell(4450, 73, 0.1, 3)
        pad(4400, [50, 57, 62, 66], 0.035, END_MS - 4400 + 2500)
        ;[85, 88, 93, 97, 100].forEach(function (n, i) { bell(6250 + i * 70, n, 0.11, 2.6) })
        bell(6250, 57, 0.12, 3.5)
        bell(6250, 64, 0.08, 3.5)
      },
      fadeOut: function (ms) {
        var t = ctx.currentTime
        master.gain.cancelScheduledValues(t)
        master.gain.setValueAtTime(master.gain.value, t)
        master.gain.linearRampToValueAtTime(0, t + ms / 1000)
      },
    }
  }

  // ------------------------------------------------------------------ 开口说话："Welcome back!"

  function createVoice(init) {
    var v = cfg.voice
    if (!v.enabled || !cfg.animation.sound || v.volume <= 0) return null
    if (init.voiceUrl) {
      var audio = new Audio(init.voiceUrl)
      audio.preload = 'auto'
      audio.volume = v.volume
      return {
        speak: function () { audio.play().catch(function (err) { console.error('[splash] voice file', err) }) },
        stop: function () { audio.pause() },
      }
    }
    var synth = window.speechSynthesis
    if (!v.text || !synth || typeof SpeechSynthesisUtterance === 'undefined') return null
    var chosen = null
    // getVoices() 第一次常常是空的，要等 voiceschanged
    var pick = function () {
      var lang = String(v.lang || 'en-US').toLowerCase()
      var base = lang.split('-')[0]
      var same = (synth.getVoices() || []).filter(function (x) {
        return String(x.lang || '').toLowerCase().replace('_', '-').indexOf(base) === 0
      })
      chosen = null
      for (var i = 0; i < v.prefer.length && !chosen; i++) {
        for (var j = 0; j < same.length; j++) {
          if (same[j].name.indexOf(v.prefer[i]) >= 0) { chosen = same[j]; break }
        }
      }
      if (!chosen) {
        chosen = same.filter(function (x) { return String(x.lang).toLowerCase().replace('_', '-') === lang })[0] || same[0] || null
      }
    }
    pick()
    if (synth.addEventListener) synth.addEventListener('voiceschanged', pick)
    return {
      speak: function () {
        var u = new SpeechSynthesisUtterance(v.text)
        u.lang = v.lang
        if (chosen) u.voice = chosen
        u.rate = v.rate * Math.min(speed, 1.4)
        u.pitch = v.pitch
        u.volume = v.volume
        synth.cancel()
        synth.speak(u)
        console.log('[splash] voice: ' + (chosen ? chosen.name : 'default'))
      },
      stop: function () { synth.cancel() },
    }
  }

  // ------------------------------------------------------------------ 搭场景

  function build(img) {
    var text = cfg.text

    // 背景（#bgimg 跟窗口走，尺寸在 fit() 里算）
    sheet = img
    fitBackground()
    paintCrop($('#heroBg'), RECT.scene, STAGE_W + 80, STAGE_H + 80, img)

    $('#strip .tag').textContent = text.expressionsTag
    $('#views .tag').textContent = text.viewsTag

    // A
    var rays = sparkLines($('#spark'), 12, 7)
    var mini = sparkLines($('.mini-spark'), 10, 3)

    // B
    var cards = $('.cards')
    RECT.expressions.forEach(function (r, i) {
      var card = el('div', 'card')
      var c = el('div', 'crop')
      paintCrop(c, r, 210, 318, img)
      card.appendChild(c)
      card.appendChild(el('div', 'label', text.expressions[i] || ''))
      cards.appendChild(card)
    })

    // C
    var panels = $('.panels')
    RECT.views.forEach(function (r, i) {
      var p = el('div', 'panel')
      var c = el('div', 'crop')
      paintCrop(c, r, Math.round((r[2] / r[3]) * 640), 640, img)
      p.appendChild(c)
      p.appendChild(el('div', 'label', text.views[i] || ''))
      panels.appendChild(p)
    })
    var sweep = el('div', 'sweep')
    $('#views').appendChild(sweep)

    // D
    paintCrop($('#portrait'), RECT.portrait, 560, 900, img)
    $('#tag').textContent = text.tag
    var quote = $('#quote')
    Array.from(text.quote).forEach(function (ch) { quote.appendChild(el('span', null, ch)) })
    $('.title-text').textContent = text.title
    $('#subtitle').textContent = text.subtitle
    var titleSweep = el('div', 'sweep')
    $('#title').appendChild(titleSweep)

    return { rays: rays, mini: mini, sweep: sweep, titleSweep: titleSweep }
  }

  function play(parts) {
    var EASE_IN = 'cubic-bezier(.6,0,.8,.3)'

    anim($('#bgimg'), [{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 0.55, transform: 'scale(1)' }], 0, 3000)

    // ---- A 星芒
    var logo = $('#logo')
    anim(logo, [{ opacity: 0 }, { opacity: 1 }], 0, 200, 'linear')
    anim($('#spark'), [
      { transform: 'rotate(-120deg) scale(0.4)' },
      { transform: 'rotate(0deg) scale(1)', offset: 0.75 },
      { transform: 'rotate(8deg) scale(1.04)' },
    ], 0, 1100)
    parts.rays.forEach(function (line, i) {
      anim(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 60 + i * 45, 420)
    })
    out(logo, [{ opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(2.4)', filter: 'blur(10px)' }], 1000, 280, EASE_IN)

    flash(1050)

    // ---- B 表情集
    var strip = $('#strip')
    anim(strip, [{ opacity: 0 }, { opacity: 1 }], 1150, 200, 'linear')
    anim($('.cards'), [{ transform: 'translateX(180px)' }, { transform: 'translateX(-60px)' }], 1150, 1900, 'cubic-bezier(.25,.6,.4,1)')
    Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card, i) {
      var rot = i % 2 ? 3 : -3
      anim(card, [
        { opacity: 0, transform: 'translateY(90px) rotate(' + rot * 3 + 'deg) scale(.9)' },
        { opacity: 1, transform: 'translateY(0) rotate(' + rot / 2 + 'deg) scale(1)' },
      ], 1200 + i * 95, 620)
    })
    out(strip, [
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' },
      { opacity: 0, transform: 'scale(1.18)', filter: 'blur(14px)' },
    ], 2700, 380, EASE_IN)
    leak(2650)
    flash(2900)

    // ---- C 三视图
    var views = $('#views')
    anim(views, [{ opacity: 0 }, { opacity: 1 }], 2950, 150, 'linear')
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p, i) {
      anim(p, [
        { clipPath: 'inset(100% -60px -60px -60px)', transform: 'translateY(50px)' },
        { clipPath: 'inset(-60px -60px -60px -60px)', transform: 'translateY(0)' },
      ], 3000 + i * 150, 760)
    })
    sweepAcross(parts.sweep, -300, 1900, 3500, 900)
    out(views, [
      { opacity: 1, transform: 'translateX(0)', filter: 'blur(0)' },
      { opacity: 0, transform: 'translateX(-140px)', filter: 'blur(8px)' },
    ], 4150, 380, EASE_IN)
    flash(4330)

    // ---- D 主视觉
    var hero = $('#hero')
    anim(hero, [{ opacity: 0 }, { opacity: 1 }], 4380, 300, 'linear')
    anim($('#heroBg'), [{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], 4380, 6000, 'ease-out')
    anim($('#portrait'), [
      { opacity: 0, transform: 'translateX(80px) scale(1.06)' },
      { opacity: 1, transform: 'translateX(0) scale(1)', offset: 0.25 },
      { opacity: 1, transform: 'translateX(-10px) scale(1.045)' },
    ], 4400, 6000, 'ease-out')
    playCopy(parts, 4750, 1450)

    leak(4300)
  }

  /** 台词 + 花体落款。base：标签出现的时刻；gap：台词到落款的间隔。 */
  function playCopy(parts, base, gap) {
    anim($('#tag'), [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'translateX(0)' }], base, 600)
    var chars = document.querySelectorAll('#quote span')
    var per = Math.min(85, 1100 / Math.max(1, chars.length))
    Array.prototype.forEach.call(chars, function (span, i) {
      anim(span, [
        { opacity: 0, transform: 'translateY(10px)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
      ], base + 250 + i * per, 420)
    })
    var title = base + gap
    anim($('.title-text'), [
      { clipPath: 'inset(-60px 100% -60px -60px)', filter: 'blur(10px) drop-shadow(0 0 22px rgba(217,119,87,.75))' },
      { clipPath: 'inset(-60px -60px -60px -60px)', filter: 'blur(0) drop-shadow(0 0 22px rgba(217,119,87,.75))' },
    ], title, 950, 'cubic-bezier(.3,.7,.3,1)')
    var mini = $('.mini-spark')
    anim(mini, [{ opacity: 0, transform: 'scale(0) rotate(-90deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }], title + 800, 500)
    parts.mini.forEach(function (line, i) {
      anim(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], title + 800 + i * 30, 300)
    })
    mini.animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 9000, iterations: Infinity, delay: T(title + 1300) })
    sweepAcross(parts.titleSweep, -260, 900, title + 950, 800)
    anim($('#subtitle'), [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], title + 600, 700)
  }

  function flash(ms) {
    anim($('.flash'), [{ opacity: 0 }, { opacity: 0.85, offset: 0.35 }, { opacity: 0 }], ms - 80, 420, 'ease-out')
  }
  function leak(ms) {
    anim($('.leak'), [
      { opacity: 0, transform: 'translateX(-15%)' },
      { opacity: 0.8, transform: 'translateX(0)', offset: 0.4 },
      { opacity: 0, transform: 'translateX(15%)' },
    ], ms, 1300, 'ease-in-out')
  }

  // ------------------------------------------------------------------ 进度 / 状态

  var TARGET = { pending: 0.08, launched: 0.22, attach: 0.3, proc: 0.55, window: 1, missing: 1 }
  var CREEP = { pending: 0.18, launched: 0.48, attach: 0.5, proc: 0.92, window: 1, missing: 1 }

  function progressLoop() {
    if (state.leaving) return
    var floor = TARGET[state.claude] || 0
    var cap = CREEP[state.claude] || floor
    var p = state.progress
    if (p < floor) p += (floor - p) * 0.12
    else if (p < cap) p += (cap - p) * 0.004
    state.progress = p
    fill.style.transform = 'scaleX(' + p.toFixed(4) + ')'
    requestAnimationFrame(progressLoop)
  }

  /** 左下角状态文字；空字符串就整条藏起来。 */
  function setHint(text) {
    hintText.textContent = text || ''
    $('.hint').hidden = !text
  }

  function onClaude(ev) {
    if (!ev || !ev.type) return
    if (ev.type === 'window') {
      state.claude = 'window'
      hud.classList.add('ready')
      setHint(cfg.text.ready)
    } else if (ev.type === 'missing') {
      state.claude = 'missing'
      hud.classList.add('missing')
      setHint(cfg.text.missing)
    } else if (ev.type === 'proc' && state.claude !== 'window') {
      state.claude = 'proc'
    } else if ((ev.type === 'launched' || ev.type === 'attach') && state.claude === 'pending') {
      state.claude = ev.type
    }
    check()
  }

  function check() {
    if (!state.animDone || state.leaving) return
    if (state.claude === 'window') return leave('end', cfg.timing.fadeMs)
    if (state.claude === 'missing') {
      setTimeout(function () { leave('missing', cfg.timing.fadeMs) }, 2500)
      return
    }
    var waited = performance.now() - state.animDoneAt
    if (waited >= cfg.timing.maxWaitMs) return leave('timeout', cfg.timing.fadeMs)
    setTimeout(check, Math.min(500, cfg.timing.maxWaitMs - waited + 10))
  }

  function finishAnimation() {
    if (state.animDone) return
    state.animDone = true
    state.animDoneAt = performance.now()
    check()
  }

  function leave(reason, ms) {
    if (state.leaving) return
    state.leaving = true
    if (host) host.leaving(reason)
    fill.style.transform = 'scaleX(1)'
    frame.style.setProperty('--fade', ms + 'ms')
    frame.classList.add('leaving')
    if (sound) sound.fadeOut(ms)
    if (voice && reason === 'skip') voice.stop()
    var v = $('#video')
    if (!v.hidden) fadeVideo(v, ms)
    setTimeout(function () {
      dust.stop()
      if (host) host.done(reason)
      else document.documentElement.setAttribute('data-done', reason)
    }, ms + 40)
  }

  function fadeVideo(v, ms) {
    var from = v.volume
    var t0 = performance.now()
    ;(function step(now) {
      var k = Math.min(1, (now - t0) / ms)
      v.volume = from * (1 - k)
      if (k < 1) requestAnimationFrame(step)
    })(t0)
  }

  function skip() {
    if (!state.started) return
    leave('skip', cfg.timing.skipFadeMs)
  }

  // ------------------------------------------------------------------ 自定义视频

  function playVideo(url) {
    var v = $('#video')
    // 视频模式：CSS 动画的舞台和光效全部不要
    var hide = ['#stage', '.leak', '.flash', '.vignette', '.bg', '#dust']
    return new Promise(function (resolve) {
      v.src = url
      v.muted = !cfg.animation.sound
      v.volume = cfg.animation.volume
      // load() 会把 playbackRate 重置成 defaultPlaybackRate，两个都要设
      v.defaultPlaybackRate = speed
      v.addEventListener('loadeddata', function () {
        v.playbackRate = speed
        resolve(true)
      }, { once: true })
      v.addEventListener('error', function () { resolve(false) }, { once: true })
      v.addEventListener('ended', finishAnimation)
      setTimeout(function () { resolve(false) }, 4000)
      v.load()
    }).then(function (ok) {
      if (!ok) return false
      hide.forEach(function (sel) { $(sel).hidden = true })
      v.hidden = false
      return true
    })
  }

  // ------------------------------------------------------------------ 入口

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image()
      img.onload = function () { resolve(img) }
      img.onerror = function () { reject(new Error('sheet not found: ' + src)) }
      img.src = src
    })
  }

  function start(init) {
    cfg = init.config
    speed = cfg.animation.speed || 1
    frame.style.setProperty('--inset', (init.inset || 0) + 'px')
    if (init.fullscreen) frame.classList.add('fullscreen')
    setHint(cfg.text.hint)
    $('.skip-text').textContent = cfg.text.skip
    $('.skip').hidden = !cfg.text.skip
    fit()
    window.addEventListener('resize', fit)

    var useVideo = init.videoUrl ? playVideo(init.videoUrl) : Promise.resolve(false)
    var assets = Promise.all([
      loadImage(init.sheetUrl),
      document.fonts && document.fonts.load ? Promise.all([
        document.fonts.load('210px "Great Vibes"'),
        document.fonts.load('500 30px "Cormorant Garamond"'),
        document.fonts.load('italic 500 30px "Cormorant Garamond"'),
      ]).catch(function () {}) : null,
    ])

    try {
      voice = createVoice(init)
    } catch (err) {
      console.error('[splash] voice failed', err)
    }

    Promise.all([useVideo, assets]).then(function (res) {
      var video = res[0]
      console.log('[splash] animation: ' + (video ? 'video' : 'css'))
      var parts = build(res[1][0])
      var go = function () {
        if (state.started) return
        state.started = true
        frame.classList.remove('loading')
        if (!video) dust.start()
        requestAnimationFrame(progressLoop)
        if (voice) setTimeout(function () { if (!state.leaving) voice.speak() }, T(cfg.voice.atMs))
        if (video) {
          // 和 dsh-video-skin 一样：画面上不加字，只在睁眼那一刻用语音说 "Welcome back!"
          $('#video').play().catch(function () { finishAnimation() })
        } else {
          if (cfg.animation.sound && cfg.animation.volume > 0) {
            try {
              sound = createSound(cfg.animation.volume)
              if (sound) sound.play()
            } catch (err) {
              console.error('[splash] sound failed', err)
            }
          }
          play(parts)
          setTimeout(finishAnimation, T(END_MS))
        }
      }
      if (host) {
        host.onGo(go)
        host.ready()
      } else {
        go()
      }
    }).catch(function (err) {
      console.error('[splash]', err)
      // 素材坏了也别挡着用户：直接放行
      if (host) {
        host.ready()
        host.done('error')
      }
    })
  }

  document.addEventListener('mousedown', skip)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') skip()
  })

  if (host) {
    host.onClaude(onClaude)
    host.init().then(start)
  } else {
    // 纯浏览器预览（scripts/render-preview.mjs）：由页面外注入 window.__SPLASH_INIT__
    window.__splashClaude = onClaude
    if (window.__SPLASH_INIT__) start(window.__SPLASH_INIT__)
  }
})()
