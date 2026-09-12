#!/bin/bash
set -u
W=/Users/forrest/Code/american-software-company/.worktrees/AS-80/apps/chat
S=/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-80
F="$W/server.js"

cp "$F" "$F.orig"
trap 'cp "$F.orig" "$F"; rm -f "$F.orig"' EXIT

echo "== hash BEFORE =="
shasum -a 256 "$F.orig"

echo "== mutate =="
node "$S/m1-mutate.mjs" || { echo "MUTATION ASSERT FAILED"; exit 1; }

echo "== observe (whole suite) =="
node --test "$W"/test/*.test.js > "$S/m1-observed.txt" 2>&1
grep -E '^✖ ' "$S/m1-observed.txt" | sed 's/ ([0-9].*//'
echo "-- failing-set cardinality --"
grep -cE '^✖ ' "$S/m1-observed.txt"
grep -E '^ℹ (tests|pass|fail) ' "$S/m1-observed.txt"
echo "-- T1 failure message --"
grep -A2 'close() left' "$S/m1-observed.txt" | head -6

trap - EXIT
cp "$F.orig" "$F"; rm -f "$F.orig"

echo "== hash AFTER =="
shasum -a 256 "$F"
echo "== worktree status (must be only the committed test file, i.e. empty) =="
git -C /Users/forrest/Code/american-software-company/.worktrees/AS-80 status --porcelain
echo "== re-run green =="
node --test "$W"/test/*.test.js 2>&1 | grep -E '^ℹ (tests|pass|fail) '
