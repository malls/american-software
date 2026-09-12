#!/bin/bash
# AS-72 finding 1 mutation battery. In-place on the worktree's public/app.js
# (the server serves that exact file, so a scratch copy is not reachable by
# the test), with backup + EXIT trap restore + content-hash proof.
set -u
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-72
APP=$WT/apps/chat/public/app.js
LOG=/Users/forrest/Code/american-software-company/scratchpad/developer-marcus/as72-f1-mutants.log
BAK=/Users/forrest/Code/american-software-company/scratchpad/developer-marcus/app.js.bak

cp "$APP" "$BAK"
BEFORE=$(shasum -a 256 "$APP" | cut -d' ' -f1)
trap 'cp "$BAK" "$APP"' EXIT

run_mutant () {
  local name="$1"
  echo "=== $name ===" | tee -a "$LOG"
  node "$WT/../../scratchpad/developer-marcus/as72-mutate-f1.mjs" "$name" 2>&1 | tee -a "$LOG"
  if [ "${PIPESTATUS[0]}" != "0" ]; then echo "MUTATION DID NOT APPLY AT INTENDED SITE — aborting $name" | tee -a "$LOG"; cp "$BAK" "$APP"; return; fi
  node --test "$WT/apps/chat/test/"*.test.js 2>&1 | grep -E "^(not ok|✖|ℹ (tests|pass|fail)) " | tee -a "$LOG"
  cp "$BAK" "$APP"
  local after
  after=$(shasum -a 256 "$APP" | cut -d' ' -f1)
  echo "restored-hash-match: $([ "$after" = "$BEFORE" ] && echo YES || echo NO)" | tee -a "$LOG"
}

echo "baseline sha256 $BEFORE" | tee -a "$LOG"
run_mutant M1
run_mutant M2
run_mutant M3
echo "worktree status after battery:" | tee -a "$LOG"
git -C "$WT" status --porcelain | tee -a "$LOG"
