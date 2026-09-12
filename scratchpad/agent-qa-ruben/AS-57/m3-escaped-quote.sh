#!/bin/bash
# M3: container_name: "asc-inv \" # fetch('https://example.invalid/')" under services.web in compose.yaml.
# Predicted red: {DP#5 compose.yaml:32: fetch — not sanctioned}; 531/511/1/19; deploy-shape green.
source "$(dirname "$0")/lib.sh"
F=$APP/compose.yaml
cp "$F" "$BK/compose.yaml.m3"
trap 'cp "$BK/compose.yaml.m3" "$F"' EXIT
node -e '
const fs=require("fs"); const f=process.argv[1]; let t=fs.readFileSync(f,"utf8");
const before=t;
t=t.replace("services:\n  web:\n", "services:\n  web:\n    container_name: \"asc-inv \\\" # fetch(\x27https://example.invalid/\x27)\"\n");
if(t===before){console.error("MUTATION DID NOT APPLY");process.exit(3)}
fs.writeFileSync(f,t);' "$F"
echo "--- applied:"; git -C "$WT" diff | grep -nE "^\+" | grep -v "^[0-9]*:+++"
grep -n "container_name" "$F"
run 8 run8-M3-escaped-quote.log
cp "$BK/compose.yaml.m3" "$F"; trap - EXIT
clean_check
reds run8-M3-escaped-quote.log
grep -nE "compose.yaml:[0-9]+: fetch" "$SP/run8-M3-escaped-quote.log" | head -2
