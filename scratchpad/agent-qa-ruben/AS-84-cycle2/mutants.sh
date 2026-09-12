#!/bin/bash
# AS-84 cycle-2 falsifiers M14/M15/M16, in place with trap restore. Backup lives outside the scanned tree.
W=/Users/forrest/Code/american-software-company/.worktrees/AS-84
SRC=$W/apps/chat/watch/advance-watcher.mjs
BK=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-84-cycle2/advance-watcher.mjs.bak
cp "$SRC" "$BK"
trap 'cp "$BK" "$SRC"' EXIT
run() { (cd $W/apps/chat && node --test test/watcher.test.js test/watcher-main.test.js test/watcher-process.test.js 2>&1 | grep -E "^✖|^ℹ (tests|pass|fail)" ); }

echo "=== M14: remove void deployOps.abort(SIGKILL) inside finish() (expected red {AC-16, AC-18})"
cp "$BK" "$SRC"
perl -0pi -e "s/(function finish\(dying\) \{.*?)      void deployOps\.abort\('SIGKILL'\);\n/\1/s" "$SRC"
echo "applied? hits of abort(SIGKILL) inside finish (expect 0):"
awk '/function finish\(dying\)/,/^  }$/' "$SRC" | grep -c "abort('SIGKILL')"
echo "SIGTERM abort in shutdown still present (expect 1):"
grep -c "deployOps.abort('SIGTERM')" "$SRC"
run

echo "=== M15: drop the SIGKILL-path lock.releaseLock() in abort() (expected red {AC-18})"
cp "$BK" "$SRC"
perl -0pi -e "s/(async function abort\(signal = 'SIGTERM'\) \{.*?)    if \(signal === 'SIGKILL'\) lock\.releaseLock\(\);\n/\1/s" "$SRC"
echo "applied? hits inside abort (expect 0):"
awk '/async function abort\(signal/,/^  }$/' "$SRC" | grep -c "signal === 'SIGKILL'"
run

echo "=== M16: remove the log-stream error listener in runDockerCompose (expected red {AC-17})"
cp "$BK" "$SRC"
perl -0pi -e "s/    out\.on\('error', \(err\) => log\(.*?\)\);\n//" "$SRC"
echo "applied? hits of out.on(error) (expect 0):"
grep -c "out.on('error'" "$SRC"
run
