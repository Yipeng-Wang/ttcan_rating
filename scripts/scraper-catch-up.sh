#!/usr/bin/env bash
# Start today's "Update ratings data" run if it hasn't happened yet.
#
# The scraper runs on a self-hosted runner on a computer that isn't always on, and GitHub's
# own schedule can be skipped. A LaunchAgent runs this script at login and every hour, so the
# first time the computer is awake each day, the run happens. Safe to run often: it does
# nothing if a run already succeeded (or is running) today, and gives up after 3 runs a day.
set -uo pipefail

REPO="${TTCAN_REPO:-Yipeng-Wang/ttcan_rating}"
WORKFLOW="update-data.yml"
MAX_RUNS_PER_DAY=3
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
GH="${GH:-gh}"  # override for testing

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

command -v "$GH" >/dev/null || { log "gh not found; skipping"; exit 0; }

# Start of today in local time, as UTC, for GitHub's search syntax.
today=$(date +%Y-%m-%d)
midnight_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "$today 00:00:00" +%s)
since=$(date -u -r "$midnight_epoch" +%Y-%m-%dT%H:%M:%SZ)

if ! runs=$("$GH" run list --repo "$REPO" --workflow "$WORKFLOW" --created ">=$since" --limit 20 \
    --json status,conclusion --jq '[.[] | {status, conclusion}]' 2>&1); then
  log "couldn't reach GitHub ($runs); will try again later"
  exit 0
fi

succeeded=$(jq '[.[] | select(.conclusion == "success")] | length' <<<"$runs")
active=$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")
total=$(jq 'length' <<<"$runs")

if [ "$succeeded" -gt 0 ]; then
  log "already ran today ($total run(s) since $since); nothing to do"
elif [ "$active" -gt 0 ]; then
  log "a run is already in progress; nothing to do"
elif [ "$total" -ge "$MAX_RUNS_PER_DAY" ]; then
  log "$total runs failed today; not retrying again until tomorrow"
else
  if "$GH" workflow run "$WORKFLOW" --repo "$REPO" --ref main >/dev/null 2>&1; then
    log "no successful run today; started one"
  else
    log "couldn't start the workflow; will try again later"
  fi
fi
