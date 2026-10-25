// 覆盖层的渲染端：透明度从 URL 参数来（src/overlay.js 传进来），再画一个星芒标志。
;(function () {
  'use strict'
  var q = new URLSearchParams(location.search)
  var root = document.documentElement.style
  if (q.get('her')) root.setProperty('--her', q.get('her'))
  if (q.get('brand')) root.setProperty('--brand', q.get('brand'))

  var svg = document.getElementById('spark')
  var ns = 'http://www.w3.org/2000/svg'
  var seed = 7
  var rnd = function () {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (var i = 0; i < 12; i++) {
    var a = (i / 12) * Math.PI * 2 + (rnd() - 0.5) * 0.18
    var len = 62 + rnd() * 30
    var line = document.createElementNS(ns, 'line')
    line.setAttribute('x1', Math.cos(a) * 10)
    line.setAttribute('y1', Math.sin(a) * 10)
    line.setAttribute('x2', Math.cos(a) * len)
    line.setAttribute('y2', Math.sin(a) * len)
    line.setAttribute('stroke-width', 11 + rnd() * 5)
    svg.appendChild(line)
  }
})()
