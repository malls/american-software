#!/bin/bash
# M4(i): plant lib/.DS_Store -> predicted green 531/512/0/19 and `git check-ignore -q` exits 0.
# M4(ii): same plant with the **/.DS_Store .dockerignore line removed -> predicted red
#         {DS-1 (7 patterns), DS-ign (member), DP#3 lib/.DS_Store unknown}; 531/509/3/19.
source "$(dirname "$0")/lib.sh"
P=$APP/lib/.DS_Store
IG=$WT/.dockerignore
cp "$IG" "$BK/dockerignore.m4"
trap 'rm -f "$P"; cp "$BK/dockerignore.m4" "$IG"' EXIT
printf 'Bud1\0\0\0\0finder junk\n' > "$P"
echo "applied(i): porcelain='$(git -C "$WT" status --porcelain --ignored | grep DS_Store)'"
if git -C "$WT" check-ignore -q "$P"; then echo "check-ignore: exit 0 (ignored)"; else echo "check-ignore: NOT ignored"; fi
run 10 run10-M4i-dsstore-ignored.log
reds run10-M4i-dsstore-ignored.log
echo "=== M4(ii) ==="
node -e '
const fs=require("fs"); const f=process.argv[1]; let t=fs.readFileSync(f,"utf8");
const before=t; t=t.replace("**/.DS_Store\n","");
if(t===before){console.error("MUTATION DID NOT APPLY");process.exit(3)}
fs.writeFileSync(f,t);' "$IG"
echo "applied(ii):"; git -C "$WT" diff | grep -E "^[-+]" | grep -v "^[-+]{3}"
run 11 run11-M4ii-dsstore-unignored.log
rm -f "$P"; cp "$BK/dockerignore.m4" "$IG"; trap - EXIT
clean_check
reds run11-M4ii-dsstore-unignored.log
grep -nE "lib/.DS_Store is neither|expected 7 .dockerignore|must exclude every .DS_Store" "$SP/run11-M4ii-dsstore-unignored.log" | head -4
