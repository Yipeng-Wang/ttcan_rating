#!/usr/bin/env bash
# Install (or update) the LaunchAgent that runs scraper-catch-up.sh at login and hourly.
# Usage: scripts/install-scraper-catch-up.sh            install / update
#        scripts/install-scraper-catch-up.sh --remove   uninstall
set -euo pipefail

LABEL="com.ttcan-rating.scraper-catch-up"
DEST_DIR="$HOME/Library/Application Support/ttcan-rating"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/ttcan-scraper-catch-up.log"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$PLIST" "$DEST_DIR/scraper-catch-up.sh"
  echo "Removed $LABEL"
  exit 0
fi

# Copy the script so switching branches in the repo doesn't change what runs.
mkdir -p "$DEST_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$(dirname "$0")/scraper-catch-up.sh" "$DEST_DIR/scraper-catch-up.sh"
chmod +x "$DEST_DIR/scraper-catch-up.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$DEST_DIR/scraper-catch-up.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: runs at login and every hour. Log: $LOG"
