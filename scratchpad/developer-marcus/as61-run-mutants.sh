#!/bin/bash
# AS-61 mutant battery. In-place, trap-restored, one mutant at a time.
set -u
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-61
SRV=$WT/apps/chat/server.js
PAD=/Users/forrest/Code/american-software-company/scratchpad/developer-marcus
BAK=$PAD/server.js.bak

run_suite() {
  node --test --test-reporter=tap "$WT"/apps/chat/test/*.test.js 2>&1 \
    | grep -E "^(not ok [0-9]+ - |# (tests|pass|fail) )"
}

for M in M-A M-B M-C M-D; do
  echo "==================== $M ===================="
  cp "$SRV" "$BAK"
  trap 'cp "$BAK" "$SRV"' EXIT
  if ! node "$PAD/as61-mutate.mjs" "$SRV" "$M"; then
    echo "$M: MUTATION FAILED TO APPLY — skipping (not a survivor, a driver bug)"
    cp "$BAK" "$SRV"
    continue
  fi
  echo "--- git diff --stat (must name only apps/chat/server.js) ---"
  git -C "$WT" diff --stat
  echo "--- observed red set ---"
  run_suite
  cp "$BAK" "$SRV"
  trap - EXIT
  echo "--- tree restored? (git diff --exit-code) ---"
  git -C "$WT" diff --exit-code >/dev/null && echo "clean" || echo "DIRTY — STOP"
done
rm -f "$BAK"
echo "==================== post-battery green re-run ===================="
run_suite
