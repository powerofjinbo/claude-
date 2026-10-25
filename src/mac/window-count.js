// window-count.js -- print how many on-screen app windows a process owns (macOS, JXA).
//
//   osascript -l JavaScript src/mac/window-count.js Claude
//
// Uses CGWindowListCopyWindowInfo: owner names and bounds need no Accessibility or Screen
// Recording permission (only window titles would). Counts normal-level windows larger than
// 200x200, so menu-bar extras and tooltips do not count.
ObjC.import('CoreGraphics')

function run(argv) {
  var name = String(argv[0] || 'Claude').toLowerCase()
  // kCGWindowListOptionOnScreenOnly (1) | kCGWindowListExcludeDesktopElements (16)
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || []
  var n = 0
  for (var i = 0; i < list.length; i++) {
    var w = list[i]
    if (String(w.kCGWindowOwnerName || '').toLowerCase() !== name) continue
    if (w.kCGWindowLayer !== 0) continue
    var b = w.kCGWindowBounds || {}
    if ((b.Width || 0) > 200 && (b.Height || 0) > 200) n++
  }
  return String(n)
}
