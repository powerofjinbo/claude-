#!/bin/bash
# uninstall-mac.sh -- remove what install-mac.sh set up (node_modules and config.json stay).
#
#   bash scripts/uninstall-mac.sh
LABEL="com.powerofjinbo.claude-splash.watcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/Applications/Claude Splash.app"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "stopped watcher"
if [ -f "$PLIST" ]; then rm -f "$PLIST"; echo "removed $PLIST"; fi
if [ -d "$APP" ]; then rm -rf "$APP"; echo "removed $APP"; fi
echo 'Uninstalled. Delete this folder to remove the rest.'
