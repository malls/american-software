#!/bin/bash
# M1b: replace the whole-directory COPY with the eight-line explicit list (master's shape).
# Predicted red: {DS-1 (COPY count), DS-demo, DS-ride}; 531/509/3/19; dependency-policy green.
source "$(dirname "$0")/lib.sh"
F=$APP/Dockerfile
cp "$F" "$BK/Dockerfile.m1b"
trap 'cp "$BK/Dockerfile.m1b" "$F"' EXIT
node -e '
const fs=require("fs"); const f=process.argv[1]; let t=fs.readFileSync(f,"utf8");
const before=t;
t=t.replace("COPY apps/invoicing ./\n",
`COPY apps/invoicing/app.js apps/invoicing/server.js ./
COPY apps/invoicing/lib ./lib
COPY apps/invoicing/routes ./routes
COPY apps/invoicing/views ./views
COPY apps/invoicing/public ./public
COPY apps/invoicing/test ./test
COPY apps/invoicing/demo ./demo
COPY apps/invoicing/compose.yaml apps/invoicing/Dockerfile ./
`);
if(t===before){console.error("MUTATION DID NOT APPLY");process.exit(3)}
fs.writeFileSync(f,t);' "$F"
echo "--- applied diff:"; git -C "$WT" diff --stat; git -C "$WT" diff | grep -E "^[-+]COPY"
run 4 run4-M1b-explicit-list.log
cp "$BK/Dockerfile.m1b" "$F"; trap - EXIT
clean_check
reds run4-M1b-explicit-list.log
