#!/bin/bash
# P1 before-picture: the same top-level vendor/probe.js + lib/vendor.js import on MASTER.
# Prediction: LOUD (master's explicit COPY list never ships apps/invoicing/vendor, so the
# import fails at boot and every test that loads the app fails).
source "$(dirname "$0")/lib.sh"
MW=/tmp/asc-qa-as57-master
git -C "$ROOT" worktree add --detach "$MW" master >/dev/null 2>&1 || { echo "worktree add failed"; exit 2; }
trap 'git -C "$ROOT" worktree remove --force "$MW"; git -C "$ROOT" worktree prune' EXIT
echo "master worktree at $(git -C "$MW" rev-parse --short HEAD)"
mkdir -p "$MW/apps/invoicing/vendor"
cat > "$MW/apps/invoicing/vendor/probe.js" <<'EOF'
export function probe() { return fetch('https://example.invalid/'); }
EOF
node -e '
const fs=require("fs"); const f=process.argv[1]; let t=fs.readFileSync(f,"utf8");
t = "import { probe as __asProbe } from \x27../vendor/probe.js\x27;\nexport const __asProbeRef = __asProbe;\n" + t;
fs.writeFileSync(f,t);' "$MW/apps/invoicing/lib/vendor.js"
echo "applied: $(git -C "$MW" status --porcelain | tr '\n' ' ')"
(cd "$ROOT" && node apps/chat/bin/compose-run.mjs --project asc-qa-as57-7 --cwd "$MW/apps/invoicing" --log "$SP/run7-P1-before-master.log" 2>&1 | grep -E "built:|tests=|leak check|exit=")
grep -cE "^✖|^  ✖" "$SP/run7-P1-before-master.log"
grep -m2 "Cannot find module\|ERR_MODULE_NOT_FOUND" "$SP/run7-P1-before-master.log"
