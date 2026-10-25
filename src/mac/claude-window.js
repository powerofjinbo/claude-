// claude-window.js -- keep reporting where Claude's main window is (macOS, JXA).
//
//   osascript -l JavaScript src/mac/claude-window.js Claude 80
//
// Every <interval> ms reads CGWindowListCopyWindowInfo (front-to-back order; owner names and
// bounds need no Accessibility / Screen Recording permission) and, when something changed,
// prints one JSON line (console.log goes to stderr in osascript):
//   {"visible":true,"front":true,"x":..,"y":..,"w":..,"h":..}   Claude's largest normal window
//   {"visible":false}                                           no Claude window on screen
// "front" means Claude's window is the topmost normal window, i.e. nothing covers it.
ObjC.import('CoreGraphics')

function snapshot(name) {
  // kCGWindowListOptionOnScreenOnly (1) | kCGWindowListExcludeDesktopElements (16)
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || []
  var frontOwner = null
  var best = null
  for (var i = 0; i < list.length; i++) {
    var w = list[i]
    if (w.kCGWindowLayer !== 0) continue
    var b = w.kCGWindowBounds || {}
    if ((b.Width || 0) < 120 || (b.Height || 0) < 120) continue
    var owner = String(w.kCGWindowOwnerName || '').toLowerCase()
    if (frontOwner === null) frontOwner = owner
    if (owner === name && (!best || b.Width * b.Height > best.Width * best.Height)) best = b
  }
  if (!best) return { visible: false }
  return {
    visible: true,
    front: frontOwner === name,
    x: Math.round(best.X),
    y: Math.round(best.Y),
    w: Math.round(best.Width),
    h: Math.round(best.Height),
  }
}

function run(argv) {
  var name = String(argv[0] || 'Claude').toLowerCase()
  var interval = Math.max(30, Number(argv[1]) || 80) / 1000
  var once = argv[2] === 'once'
  var last = ''
  while (true) {
    var line = JSON.stringify(snapshot(name))
    if (line !== last) {
      console.log(line)
      last = line
    }
    if (once) return ''
    delay(interval)
  }
}
