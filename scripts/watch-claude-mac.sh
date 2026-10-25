#!/bin/bash
# watch-claude-mac.sh -- play the splash whenever Claude Desktop is cold-started (macOS).
#
# Run at login by the LaunchAgent that install-mac.sh sets up. Checks every 0.4 s whether a
# process named exactly "Claude" exists (pgrep is a few ms of CPU); on the not-running ->
# running edge it starts `Electron <app> --attach`, which shows the animation over Claude.
# If the splash was started from Claude Splash.app instead, the second copy exits at once
# (Electron single-instance lock).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
NAME="${CLAUDE_SPLASH_PROCESS:-Claude}"

running() { pgrep -x "$NAME" >/dev/null 2>&1; }

was=0
running && was=1
echo "$(date '+%F %T') watching for $NAME (running=$was)"
while true; do
  if running; then
    if [ "$was" = 0 ] && [ -x "$ELECTRON" ]; then
      echo "$(date '+%F %T') $NAME started -> splash"
      "$ELECTRON" "$ROOT" --attach >/dev/null 2>&1 &
    fi
    was=1
  else
    was=0
  fi
  sleep 0.4
done
