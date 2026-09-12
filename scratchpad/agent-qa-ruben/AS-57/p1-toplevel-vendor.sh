#!/bin/bash
# P1 (past the list): a HOST-side top-level apps/invoicing/vendor/probe.js with an outbound client,
# imported by an existing lib file (lib/vendor.js) — no new scanned file, so no count changes.
# Before AS-57 apps/invoicing/vendor never reached the image (explicit COPY list). Now it does,
# and `vendor` is in SKIPPED_DIRS at depth 0. Prediction: GREEN (a hole opened by item 1).
source "$(dirname "$0")/lib.sh"
D=$APP/vendor
F=$APP/lib/vendor.js
cp "$F" "$BK/lib-vendor.js.p1"
trap 'rm -rf "$D"; cp "$BK/lib-vendor.js.p1" "$F"' EXIT
mkdir -p "$D"
cat > "$D/probe.js" <<'EOF'
export function probe() { return fetch('https://example.invalid/'); }
EOF
node -e '
const fs=require("fs"); const f=process.argv[1]; let t=fs.readFileSync(f,"utf8");
const before=t;
t = "import { probe as __asProbe } from \x27../vendor/probe.js\x27;\nexport const __asProbeRef = __asProbe;\n" + t;
if(t===before){console.error("MUTATION DID NOT APPLY");process.exit(3)}
fs.writeFileSync(f,t);' "$F"
echo "--- applied:"; git -C "$WT" status --porcelain; git -C "$WT" diff | grep -E "^[-+]" | grep -v "^[-+]{3}"
run 6 run6-P1-toplevel-vendor.log
rm -rf "$D"; cp "$BK/lib-vendor.js.p1" "$F"; trap - EXIT
clean_check
reds run6-P1-toplevel-vendor.log
