#!/usr/bin/env bash
# Copies the static files (badge, stats page, map) into the site repo.
# Review and push the site repo yourself; GitHub Pages publishes a minute later.
#   PAGES_DIR defaults to ~/personal/daplein.github.io
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
pages="${PAGES_DIR:-$HOME/personal/daplein.github.io}"
[ -d "$pages/.git" ] || { echo "Not a git repo: $pages (set PAGES_DIR)" >&2; exit 1; }
cp "$here/site/visitors.js" "$here/site/stats.html" "$here/site/world.svg" "$pages/"
echo "Copied visitors.js, stats.html, world.svg to $pages"
git -C "$pages" status --short -- visitors.js stats.html world.svg
