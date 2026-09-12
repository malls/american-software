#!/bin/bash
# mutant.sh <name> <file-relative-to-worktree> <node-mutation-script> [expected-marker-count-cmd]
# Backs up the file, traps restore on EXIT, applies the mutation via a node script,
# asserts it applied at the intended site, runs the compose suite with --build,
# logs to the scratchpad, then the trap restores and proves the tree clean.
set -u
NAME="$1"; REL="$2"; MUT="$3"
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-71
SP=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-71
FILE="$WT/$REL"
BAK="$SP/$NAME.backup"
LOG="$SP/run-$NAME.log"
cp "$FILE" "$BAK"
BEFORE=$(shasum -a 256 "$FILE" | cut -d' ' -f1)
restore() {
  cp "$BAK" "$FILE"
  AFTER=$(shasum -a 256 "$FILE" | cut -d' ' -f1)
  echo "restore: sha before=$BEFORE after=$AFTER $([ "$BEFORE" = "$AFTER" ] && echo MATCH || echo MISMATCH)"
  git -C "$WT" diff --exit-code -- "$REL" && echo "restore: git diff --exit-code clean on $REL"
  git -C "$WT" status --porcelain
}
trap restore EXIT
node "$MUT" "$FILE" || { echo "MUTATION FAILED TO APPLY"; exit 2; }
echo "mutation applied: $(git -C "$WT" diff --stat -- "$REL" | tail -1)"
git -C "$WT" diff -- "$REL" > "$SP/$NAME.mutant.diff"
node -e "const {spawnSync}=require('child_process');const fs=require('fs');const r=spawnSync('/usr/local/bin/docker',['compose','-p','asc-review-as71','run','--rm','--build','test'],{cwd:'$WT/apps/invoicing',encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,DOCKER_BUILDKIT:'1',COMPOSE_DOCKER_CLI_BUILD:'1'}});fs.writeFileSync('$LOG',(r.stdout||'')+'\n--- STDERR ---\n'+(r.stderr||'')+'\nexit='+r.status+'\n');console.log('compose exit',r.status)"
grep -n "Image asc-review-as71-test Built" "$LOG" | head -1
grep -n "^ℹ tests\|^ℹ pass\|^ℹ fail\|^ℹ skipped" "$LOG"
echo "--- red set (top-level not ok) ---"
grep -n "^not ok\|^✖" "$LOG" | grep -v "^\s" | head -40
