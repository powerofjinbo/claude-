#!/bin/bash
# install-mac.sh -- set up the Claude boot splash on macOS.
#
#   bash scripts/install-mac.sh [--target /Applications/Claude.app] [--no-watcher] [--skip-npm]
#
# What it does:
#   1. npm install (downloads Electron, ~100 MB, once)
#   2. finds Claude Desktop and writes it into config.json
#   3. ~/Applications/Claude Splash.app -> splash + Claude (drag it into the Dock in place of Claude)
#   4. a LaunchAgent that runs scripts/watch-claude-mac.sh at login: plays the splash whenever
#      Claude is cold-started any other way (Dock, Spotlight, claude:// links ...). Skip with --no-watcher.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
APP="$HOME/Applications/Claude Splash.app"
LABEL="com.powerofjinbo.claude-splash.watcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

TARGET=""
WATCHER=1
SKIP_NPM=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift ;;
    --no-watcher) WATCHER=0 ;;
    --skip-npm) SKIP_NPM=1 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33mwarning: %s\033[0m\n' "$1"; }

# Background jobs started by launchd cannot read ~/Desktop, ~/Documents or ~/Downloads
# without a privacy prompt, so the watcher would silently do nothing from there.
case "$ROOT" in
  "$HOME/Desktop"*|"$HOME/Documents"*|"$HOME/Downloads"*)
    warn "this folder is under Desktop/Documents/Downloads; macOS blocks background jobs there."
    warn "move it first, e.g.: mv \"$ROOT\" ~/claude-splash && cd ~/claude-splash"
    [ $WATCHER = 1 ] && exit 1
    ;;
esac

# --- 1. dependencies --------------------------------------------------------
if [ $SKIP_NPM = 0 ]; then
  step 'npm install (Electron)'
  if ! command -v npm >/dev/null 2>&1; then
    echo 'Node.js not found. Install the LTS from https://nodejs.org (or: brew install node) and run this again.' >&2
    exit 1
  fi
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund)
fi
if [ ! -x "$ELECTRON" ]; then
  (cd "$ROOT" && node node_modules/electron/install.js)
fi
[ -x "$ELECTRON" ] || { echo "Electron is missing: $ELECTRON" >&2; exit 1; }

# --- 2. find Claude Desktop ---------------------------------------------------
step 'Looking for Claude Desktop'
if [ -z "$TARGET" ]; then
  for p in "/Applications/Claude.app" "$HOME/Applications/Claude.app"; do
    if [ -d "$p" ]; then TARGET="$p"; break; fi
  done
fi
if [ -z "$TARGET" ]; then
  TARGET="$(mdfind "kMDItemCFBundleIdentifier == 'com.anthropic.claudefordesktop'" 2>/dev/null | head -n 1 || true)"
fi
if [ -z "$TARGET" ]; then
  warn 'Claude Desktop not found. Install it from https://claude.ai/download, then run this again (or pass --target).'
else
  echo "    $TARGET"
fi

node -e '
const fs = require("fs")
const [file, target] = process.argv.slice(1)
let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) } catch {}
cfg.claude = Object.assign({}, cfg.claude, { target, processName: "Claude" })
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n")
' "$ROOT/config.json" "$TARGET"

# --- 3. Claude Splash.app -------------------------------------------------
step 'App: ~/Applications/Claude Splash.app'
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/Info.plist" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Claude Splash</string>
  <key>CFBundleDisplayName</key><string>Claude Splash</string>
  <key>CFBundleIdentifier</key><string>com.powerofjinbo.claude-splash.launcher</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLISTEOF
cat > "$APP/Contents/MacOS/launcher" <<LAUNCHEOF
#!/bin/bash
exec "$ELECTRON" "$ROOT" "\$@"
LAUNCHEOF
chmod +x "$APP/Contents/MacOS/launcher"
# icon: assets/icon.png -> icon.icns (sips + iconutil ship with macOS)
if command -v iconutil >/dev/null 2>&1; then
  ICONSET="$(mktemp -d)/icon.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ROOT/assets/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
    d=$((s * 2))
    sips -z $d $d "$ROOT/assets/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns" 2>/dev/null || true
fi
echo "    $APP"

# --- 4. background watcher ------------------------------------------------
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
if [ $WATCHER = 1 ]; then
  step 'Background watcher (LaunchAgent, runs at login)'
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<AGENTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/watch-claude-mac.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>/tmp/claude-splash-watcher.log</string>
  <key>StandardErrorPath</key><string>/tmp/claude-splash-watcher.log</string>
</dict>
</plist>
AGENTEOF
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "    $PLIST"
else
  rm -f "$PLIST"
fi

echo
printf '\033[32mDone.\033[0m Quit Claude completely (Cmd+Q) and open it again to see the splash.\n'
echo 'Dock: you can also drag ~/Applications/Claude Splash.app into the Dock in place of Claude.'
echo "Preview without starting Claude:  \"$ELECTRON\" \"$ROOT\" --preview"
