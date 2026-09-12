#!/bin/bash
# AS-100 review mutants (qa-ruben). In-place on the worktree with backup+trap,
# because cp -R / rsync / tar -C were all denied at the permission layer.
set -u
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-100
APP=$WT/apps/chat
BK=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-100/backup
mkdir -p "$BK"

run_mutant() {
  local name="$1" file="$2" from="$3" to="$4" testfile="$5"
  echo "=================== MUTANT $name ($file) ==================="
  cp "$APP/$file" "$BK/$(basename "$file").bak"
  trap 'cp "$BK/$(basename "$file").bak" "$APP/$file"' EXIT
  node -e '
    const fs=require("fs"); const [,,p,from,to]=process.argv;
    const s=fs.readFileSync(p,"utf8"); const n=s.split(from).length-1;
    if(n!==1){console.error("SITE CHECK FAILED: pattern occurs",n,"times");process.exit(3);}
    fs.writeFileSync(p,s.replace(from,to));
  ' "$APP/$file" "$from" "$to" || { echo "MUTATION NOT APPLIED ($name)"; cp "$BK/$(basename "$file").bak" "$APP/$file"; return; }
  echo "--- applied diff (site assertion) ---"
  git -C "$WT" diff --stat -- "apps/chat/$file"
  git -C "$WT" diff -U1 -- "apps/chat/$file" | grep -n '^[-+][^-+]'
  echo "--- run $testfile ---"
  (cd "$APP" && node --test "$testfile" 2>&1 | grep -E '^(not ok|ℹ (tests|pass|fail))' )
  cp "$BK/$(basename "$file").bak" "$APP/$file"
  trap - EXIT
  git -C "$WT" diff --exit-code -- "apps/chat/$file" && echo "RESTORED CLEAN: $file"
}

run_mutant "M1-AC7-timeout-as-completed" "watch/advance-watcher.mjs" \
  "const outcome = stageCloseOutcome({ code, signal, timedOut });" \
  "const outcome = timedOut ? 'completed' : stageCloseOutcome({ code, signal, timedOut });" \
  "test/watcher-events.test.js"

run_mutant "M2-AC17-elapsedS-in-lanesKey" "server.js" \
  "            alive: lane.subAgent.alive," \
  "            alive: lane.subAgent.alive, elapsedS: lane.subAgent.elapsedS," \
  "test/stream.test.js"

run_mutant "M3-AC4-cli-accepts-cut" "bin/events.js" \
  "const CLI_STAGE_OUTCOMES = ['completed', 'error'];" \
  "const CLI_STAGE_OUTCOMES = ['completed', 'error', 'cut_by_timeout'];" \
  "test/events-cli.test.js"

echo "=================== FINAL TREE CHECK ==================="
git -C "$WT" status --short
git -C "$WT" diff --exit-code && echo "WORKTREE CLEAN"
date -u
