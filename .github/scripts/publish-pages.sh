#!/usr/bin/env bash
# Publish a build folder as the whole content of the gh-pages branch.
#
# Every deploy is a fresh single commit force-pushed to gh-pages, so the branch always
# holds exactly the build: nothing left over from earlier deploys or from main (a stray
# .gitignore once hid every data file), and it works even if gh-pages was deleted.
#
# Usage: publish-pages.sh <build dir>   (needs GITHUB_TOKEN and GITHUB_REPOSITORY)
set -euo pipefail

build_dir=$(cd "$1" && pwd)
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
source_sha=$(git -C "$build_dir" rev-parse --short HEAD 2>/dev/null || echo unknown)

[ -f "$build_dir/index.html" ] || { echo "No index.html in $build_dir; refusing to publish" >&2; exit 1; }
[ -f "$build_dir/data/players.json" ] || { echo "No data/players.json in $build_dir; refusing to publish" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$build_dir/." "$work/"
touch "$work/.nojekyll"   # serve files exactly as built

cd "$work"
git init -q -b gh-pages
git config user.name "github-actions"
git config user.email "41898282+github-actions@users.noreply.github.com"
git add -A
git commit -q -m "Deploy ${source_sha}"
echo "Publishing $(git ls-files | wc -l | tr -d ' ') files, $(git ls-files data | wc -l | tr -d ' ') of them data"
remote=${PAGES_REMOTE:-"https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"}  # override for testing
git push -q --force "$remote" gh-pages
