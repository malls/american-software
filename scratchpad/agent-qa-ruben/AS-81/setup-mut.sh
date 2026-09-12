#!/bin/bash
set -e
ROOT=/Users/forrest/Code/american-software-company
SP=$ROOT/scratchpad/agent-qa-ruben/AS-81
WT=$ROOT/.worktrees/AS-81/apps/chat
shasum -a 256 "$WT/server.js" "$WT/test/stream.test.js" | tee "$SP/hashes-before.txt"
rm -rf "$SP/mut" "$SP/ctl" "$SP/ac4"
mkdir -p "$SP/mut" "$SP/ctl" "$SP/ac4"
cp -R "$WT/." "$SP/mut/" && rm -rf "$SP/mut/data"
cp -R "$WT/." "$SP/ctl/" && rm -rf "$SP/ctl/data"
cp -R "$WT/." "$SP/ac4/" && rm -rf "$SP/ac4/data"
git -C "$ROOT" show master:apps/chat/test/stream.test.js > "$SP/ctl/test/stream.test.js"
echo "== ctl harness vs master:"
git -C "$ROOT" show master:apps/chat/test/stream.test.js | shasum -a 256
shasum -a 256 "$SP/ctl/test/stream.test.js"
for d in mut ctl; do
  echo "== $d before:"
  grep -c 'readLoopStatus())}' "$SP/$d/server.js" || true
  grep -c 'readLanes() })}' "$SP/$d/server.js" || true
  grep -n 'readLoopStatus())}\|readLanes() })}' "$SP/$d/server.js"
  node -e "
const fs=require('fs');const p=process.argv[1];let s=fs.readFileSync(p,'utf8');
const before=s.split('\n').length;
s=s.split('\n').filter(l=>!(l.includes('readLoopStatus())}')||l.includes('readLanes() })}'))).join('\n');
fs.writeFileSync(p,s);console.log('lines',before,'->',s.split('\n').length);" "$SP/$d/server.js"
  echo "== $d after (expect 0 / 0):"
  grep -c 'readLoopStatus())}' "$SP/$d/server.js" || true
  grep -c 'readLanes() })}' "$SP/$d/server.js" || true
  diff -U5 "$WT/server.js" "$SP/$d/server.js" || true
done
# AC-4: delete ctrl.abort() from the catch in the branch harness
echo "== ac4 before ctrl.abort() count:"
grep -c 'ctrl.abort()' "$SP/ac4/test/stream.test.js"
node -e "
const fs=require('fs');const p=process.argv[1];let s=fs.readFileSync(p,'utf8');
const needle='      ctrl.abort();\n      throw e;';
if(!s.includes(needle)) { console.log('NEEDLE NOT FOUND'); process.exit(2); }
s=s.replace(needle,'      throw e;');
fs.writeFileSync(p,s);" "$SP/ac4/test/stream.test.js"
echo "== ac4 after ctrl.abort() count (expect 1):"
grep -c 'ctrl.abort()' "$SP/ac4/test/stream.test.js"
grep -n 'ctrl.abort()' "$SP/ac4/test/stream.test.js"
diff -U3 "$WT/test/stream.test.js" "$SP/ac4/test/stream.test.js" || true
ls -d "$SP/mut/node_modules" 2>/dev/null || echo "no node_modules in scratch (check whether tests need it)"
date -u
