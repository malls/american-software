#!/bin/bash
# Shared helpers for the AS-57 review battery (qa-ruben). Sourced by each m-*.sh.
set -u
ROOT=/Users/forrest/Code/american-software-company
WT=$ROOT/.worktrees/AS-57
APP=$WT/apps/invoicing
SP=$ROOT/scratchpad/agent-qa-ruben/AS-57
BK=/tmp/asc-qa-as57-backup   # backups live OUTSIDE the scanned tree
mkdir -p "$BK"

run() { # run <project-suffix> <logname>
  (cd "$ROOT" && node apps/chat/bin/compose-run.mjs --project "asc-qa-as57-$1" --cwd "$APP" --log "$SP/$2" 2>&1 | grep -E "built:|tests=|leak check|exit=")
}

clean_check() {
  local p; p=$(git -C "$WT" status --porcelain)
  if [ -z "$p" ] && git -C "$WT" diff --exit-code >/dev/null; then echo "TREE CLEAN after restore"; else echo "TREE DIRTY after restore: $p"; fi
}

reds() { # reds <logname>
  echo "--- red set ($1):"
  grep -nE "^✖|^  ✖|^not ok|^  not ok" "$SP/$1" | grep -v "^.*# subtest" | head -40
}
