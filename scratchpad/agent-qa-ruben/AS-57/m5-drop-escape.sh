#!/bin/bash
# M5: delete the helper's escape line. Predicted red: {DP#2 (manifest stripper test), DS-parse}; 531/510/2/19.
source "$(dirname "$0")/lib.sh"
F=$APP/test/helpers/hash-comment.js
cp "$F" "$BK/hash-comment.js.m5"
trap 'cp "$BK/hash-comment.js.m5" "$F"' EXIT
node -e '
const fs=require("fs"); const f=process.argv[1]; let t=fs.readFileSync(f,"utf8");
const before=t;
t=t.replace("      if (quote === \x27\"\x27 && ch === \x27\\\\\x27) { i += 1; continue; }\n", "");
if(t===before){console.error("MUTATION DID NOT APPLY");process.exit(3)}
fs.writeFileSync(f,t);' "$F"
echo "--- applied:"; git -C "$WT" diff | grep -E "^[-+]" | grep -v "^[-+]{3}"
run 9 run9-M5-drop-escape.log
cp "$BK/hash-comment.js.m5" "$F"; trap - EXIT
clean_check
reds run9-M5-drop-escape.log
