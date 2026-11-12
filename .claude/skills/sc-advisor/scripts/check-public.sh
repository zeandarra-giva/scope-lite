#!/usr/bin/env bash
# Check a doc before it goes into a possibly public repo.
# Usage: bash check-public.sh [file ...]   (default: docs/PRD.md)
#   1. Prints the GitHub visibility of this repo (PUBLIC / PRIVATE / UNKNOWN).
#   2. Lists lines that look like internal identifiers: IPv4 addresses
#      (except 127.0.0.1 / 0.0.0.0), UNC share paths, drive-letter paths, emails, SOEID-like IDs.
# Exit code 1 if anything is flagged, so a hit is hard to miss.
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

vis=$(gh repo view --json visibility -q .visibility 2>/dev/null || true)
echo "repo visibility: ${vis:-UNKNOWN}"

[ $# -eq 0 ] && set -- docs/PRD.md
hits=0
for f in "$@"; do
  [ -f "$f" ] || { echo "missing: $f"; continue; }
  out=$(grep -nE \
      -e '([0-9]{1,3}\.){3}[0-9]{1,3}' \
      -e '\\\\[A-Za-z0-9._$-]+\\' \
      -e '(^|[^A-Za-z])[A-Za-z]:\\' \
      -e '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
      -e '(^|[^A-Za-z0-9])[A-Z]{2}[0-9]{5}([^0-9]|$)' \
      "$f" | grep -vE '(^|[^0-9])(127\.0\.0\.1|0\.0\.0\.0)([^0-9]|$)' || true)
  if [ -n "$out" ]; then
    hits=1
    echo "--- $f: review these lines"
    echo "$out"
  fi
done
[ $hits -eq 0 ] && echo "no internal identifiers found (names and system names still need a human look)"
exit $hits
