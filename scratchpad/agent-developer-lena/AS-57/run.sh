#!/bin/bash
# AS-57 counted run helper (Lena). Usage: run.sh <suffix>
# Runs the compose suite in the AS-57 worktree with project asc-impl-as57-<suffix>,
# node --test output to <suffix>.log, receipt to <suffix>.receipt, in this directory.
set -u
ROOT=/Users/forrest/Code/american-software-company
WT=$ROOT/.worktrees/AS-57
APP=$WT/apps/invoicing
SP=$ROOT/scratchpad/agent-developer-lena/AS-57
name=$1
cd "$ROOT" || exit 2
node apps/chat/bin/compose-run.mjs --project "asc-impl-as57-$name" --cwd "$APP" --log "$SP/$name.log" > "$SP/$name.receipt" 2>&1
exit_code=$?
echo "RUN_EXIT=$exit_code" >> "$SP/$name.receipt"
cat "$SP/$name.receipt"
echo "--- failing tests:"
grep -E '^✖|^not ok' "$SP/$name.log" | head -40
echo "--- porcelain (apps/invoicing .dockerignore .gitignore):"
git -C "$WT" status --porcelain -- apps/invoicing .dockerignore .gitignore
exit $exit_code
