#!/bin/bash
# AS-109 review mutation runner — agent:qa-ruben. Scratch worktree only.
# usage: mutate.sh <name> <node-edit-expression> <applied-grep-regex> <expected-line> [test-file-source]
#   node-edit-expression: JS body operating on `lines` (array of favicon lines, 0-based) -> returns new array
#   applied-grep-regex: grep -E pattern that must go 0 -> 1 at <expected-line> (1-based) after mutation
#   test-file-source: 'master' to run against master's api.test.js (control), default branch file
set -u
S=/tmp/AS-109-mutant
F=$S/apps/chat/public/favicon.svg
LOG=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-109/runs
mkdir -p $LOG
name=$1; edit=$2; pat=$3; line=$4; src=${5:-branch}

restore() {
  git -C $S checkout -- . >/dev/null 2>&1
  git -C $S diff --exit-code >/dev/null 2>&1 || { echo "RESTORE FAILED for $name"; exit 9; }
}
trap restore EXIT

before=$(sed -n "${line}p" $F | grep -cE "$pat")
node -e "
const fs=require('fs'); const f='$F';
let lines=fs.readFileSync(f,'utf8').split('\n');
lines=(function(lines){ $edit; return lines; })(lines);
fs.writeFileSync(f, lines.join('\n'));
"
after=$(sed -n "${line}p" $F | grep -cE "$pat")
stat=$(git -C $S diff --stat | sed -n 1p | awk '{print $1}')
if [ "$src" = master ]; then
  git -C $S checkout master -- apps/chat/test/api.test.js
fi
echo "== $name (test file: $src)"
echo "applied: line $line grep '$pat' $before -> $after ; diff --stat names: $stat"
if [ "$before" != 0 ] || [ "$after" != 1 ] || [ "$stat" != "apps/chat/public/favicon.svg" ]; then
  echo "MUTATION NOT APPLIED AS INTENDED — aborting $name"; exit 8
fi
( cd $S/apps/chat && node --test > $LOG/$name.log 2>&1 )
grep -E "^ℹ (tests|pass|fail|skipped)" $LOG/$name.log | tr '\n' ' '; echo
echo "red set:"; grep -E "^✖" $LOG/$name.log || echo "  (none)"
grep -oE "(paint attributes examined[^']*|no style=\"\" attribute|no <style> element|no SMIL animation element, found <[a-zA-Z]*>)" $LOG/$name.log | sort -u | sed 's/^/  msg: /'
