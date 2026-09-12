#!/bin/bash
# AS-84 mutation battery. One mutant at a time, in place, with a trap-restored
# backup; the FULL host suite runs against each one so a red set wider than the
# plan predicted is visible rather than assumed. The tree is proven clean after
# every mutant.
set -u
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-84
SRC="$WT/apps/chat/watch/advance-watcher.mjs"
PAD=/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-84
OUT="$PAD/mutants.log"
: > "$OUT"

cp "$SRC" "$PAD/advance-watcher.mjs.bak"
trap 'cp "$PAD/advance-watcher.mjs.bak" "$SRC"' EXIT

for id in "$@"; do
  echo "=================== $id ===================" | tee -a "$OUT"
  cp "$PAD/advance-watcher.mjs.bak" "$SRC"
  if ! node "$PAD/mutants.mjs" apply "$id" 2>&1 | tee -a "$OUT"; then
    echo "MUTANT $id COULD NOT BE APPLIED" | tee -a "$OUT"
    continue
  fi
  echo "--- suite ---" | tee -a "$OUT"
  ( cd "$WT" && node --test "$WT/apps/chat/test/"*.test.js 2>&1 ) > "$PAD/run-$id.txt"
  grep -E "^ℹ (tests|pass|fail)" "$PAD/run-$id.txt" | tee -a "$OUT"
  echo "RED SET:" | tee -a "$OUT"
  awk '/^✖ failing tests:/{f=1;next} f && /^✖ /{sub(/^✖ /,"");sub(/ \([0-9].*$/,"");print "  - " $0}' "$PAD/run-$id.txt" | sort -u | tee -a "$OUT"
  cp "$PAD/advance-watcher.mjs.bak" "$SRC"
  if git -C "$WT" diff --exit-code --quiet; then
    echo "TREE CLEAN after $id" | tee -a "$OUT"
  else
    echo "TREE DIRTY after $id -- STOP" | tee -a "$OUT"
    exit 1
  fi
done
echo "all mutants done" | tee -a "$OUT"
