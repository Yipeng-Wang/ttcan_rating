#!/usr/bin/env bash
# Install (or update) the LaunchAgent that runs scraper-catch-up.sh at login and hourly, and
# make both it and the GitHub runner service run as low-priority background work, so macOS
# keeps them out of the way of whatever you're doing on the computer.
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
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: runs at login and every hour. Log: $LOG"

# The runner service (installed by svc.sh) and every job it starts: background priority too.
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-ttcan}"
RUNNER_PLIST=$(ls "$HOME/Library/LaunchAgents/"actions.runner.*.plist 2>/dev/null | head -1 || true)
if [ -n "$RUNNER_PLIST" ]; then
  pb=/usr/libexec/PlistBuddy
  for entry in "ProcessType string Background" "LowPriorityIO bool true" "Nice integer 10"; do
    set -- $entry
    "$pb" -c "Delete :$1" "$RUNNER_PLIST" 2>/dev/null || true
    "$pb" -c "Add :$1 $2 $3" "$RUNNER_PLIST"
  done
  if [ -x "$RUNNER_DIR/svc.sh" ]; then
    (cd "$RUNNER_DIR" && ./svc.sh stop >/dev/null && ./svc.sh start >/dev/null)
  fi
  echo "Runner service set to background priority: $(basename "$RUNNER_PLIST")"
fi
