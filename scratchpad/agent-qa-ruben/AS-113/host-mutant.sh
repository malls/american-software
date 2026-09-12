#!/bin/bash
# One indivisible host mutant step: mutate, assert applied (diff shown), run
# test/mode.test.js, restore under trap, prove the tree clean.
# Usage: host-mutant.sh M2|M3
set -u
S=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-113
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-113
M="$1"
trap 'node "$S/mutate.mjs" restore; echo "--- restore: git diff --exit-code ---"; git -C "$WT" diff --exit-code && echo "TREE CLEAN"' EXIT
node "$S/mutate.mjs" "$M" || exit 9
echo "--- mutated diff ---"
git -C "$WT" diff -- apps/chat/bin/chat.js
echo "--- host node --test test/mode.test.js under $M ---"
cd "$WT/apps/chat" && node --test test/mode.test.js 2>&1 | grep -E "^(✔|✖|ℹ (tests|pass|fail))|not ok|AssertionError|expected|actual|the refusal names" | head -40
