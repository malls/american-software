#!/bin/bash
# AS-130 review AC-9: in-place mutation of the worktree's compose.yaml — a
# `ports:` entry on the demo service must turn deploy-shape red
# ('the demo publishes nothing to the host'). Backup outside the scanned tree,
# restore under trap, assert the mutation applied, observe, restore, prove the
# tree clean, rebuild, re-run.
set -u
W=/Users/forrest/Code/american-software-company/.worktrees/AS-130
S=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130/c2
F=$W/apps/invoicing/compose.yaml
BK=$(mktemp -d /tmp/asc-ruben-as130-XXXXXX)/compose.yaml.bak
cp "$F" "$BK"
restore() { cp "$BK" "$F"; echo "[restore] compose.yaml restored from $BK"; }
trap restore EXIT

# mutation: insert `    ports:\n      - "127.0.0.1:8349:8348"` right after the demo service's `platform: linux/amd64` line
node -e '
const fs=require("fs");const f=process.argv[1];const t=fs.readFileSync(f,"utf8");
const anchor="  demo:\n    build:\n      context: ../..\n      dockerfile: apps/invoicing/Dockerfile\n      platforms:\n        - linux/amd64\n    platform: linux/amd64\n";
if(!t.includes(anchor)) {console.error("anchor missing");process.exit(1);}
fs.writeFileSync(f,t.replace(anchor,anchor+"    ports:\n      - \"127.0.0.1:8349:8348\"\n"));
' "$F" || exit 1
echo "[assert] mutation applied — diff of the worktree file:"
git -C "$W" diff --stat -- apps/invoicing/compose.yaml
git -C "$W" diff -- apps/invoicing/compose.yaml | grep -E '^\+' | grep -v '^+++'
echo "[observe] counted test run with --build against the mutated compose.yaml (project asc-c2-m9):"
node "$S/compose.mjs" asc-c2-m9 "$S/compose-test-m9.log" -- run --rm --build test > /dev/null 2>&1
echo "exit $?"
grep -E "Image asc-c2-m9-test +Built" "$S/compose-test-m9.log" && echo "[receipt] present"
grep -E "^ℹ (tests|pass|fail|skipped)" "$S/compose-test-m9.log"
echo "[red set]"
grep -E "^not ok" "$S/compose-test-m9.log"
grep -E "publishes nothing to the host" "$S/compose-test-m9.log" | head -3

restore
trap - EXIT
git -C "$W" diff --exit-code -- apps/invoicing/compose.yaml && echo "[clean] git diff --exit-code: tree clean"
echo "[rebuild+rerun] counted test run with --build after restore:"
node "$S/compose.mjs" asc-c2-m9 "$S/compose-test-m9-restored.log" -- run --rm --build test > /dev/null 2>&1
echo "exit $?"
grep -E "Image asc-c2-m9-test +Built" "$S/compose-test-m9-restored.log" && echo "[receipt] present"
grep -E "^ℹ (tests|pass|fail|skipped)" "$S/compose-test-m9-restored.log"
rm -rf "$(dirname "$BK")"
