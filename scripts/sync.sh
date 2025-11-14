#!/usr/bin/env bash
set -euo pipefail

MSG="${1:-}"
ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository"
  exit 1
fi

changes=$(git status --porcelain)
if [ -z "$changes" ]; then
  echo "No changes"
else
  git add -A
  if [ -z "$MSG" ]; then
    tz=$(date +%z); tzfmt="${tz:0:3}:${tz:3:2}"
    now="$(date +%Y-%m-%dT%H:%M:%S)${tzfmt}"
    MSG="sync: ${now}"
  fi
  git commit -m "$MSG"
fi

if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  git push
else
  branch=$(git rev-parse --abbrev-ref HEAD)
  git push -u origin "$branch"
fi

echo "Done."