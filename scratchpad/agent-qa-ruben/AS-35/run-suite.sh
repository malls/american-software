#!/bin/bash
# AS-35 review runner (qa-ruben). Usage: run-suite.sh <label> [test-glob]
# Runs the token suite from the AS-35 worktree, logs to this scratchpad,
# prints counts and the exact failing-test names, then proves the tree clean.
set -u
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-35
SP=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-35
LABEL="$1"
GLOB="${2:-$WT/docs/design/tokens/*.test.mjs}"
LOG="$SP/$LABEL.log"
node --test "$GLOB" > "$LOG" 2>&1
EXIT=$?
echo "== $LABEL  (node $(node --version), exit=$EXIT, log=$LOG)"
grep -E '^# (tests|pass|fail)' "$LOG" | tr '\n' ' '; echo
echo "-- failing tests (exact set):"
grep -E '^not ok' "$LOG" | sed -E 's/^not ok [0-9]+ - //' || true
echo "-- first error line per failure:"
grep -E '^\s+error:' "$LOG" | head -20 || true
