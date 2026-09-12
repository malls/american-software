#!/bin/bash
# M1 before-picture: the same compose.override.yaml plant on MASTER (detached worktree in /tmp).
# Predicted: green 530/511/0/19 — the blind spot the task is about.
source "$(dirname "$0")/lib.sh"
MW=/tmp/asc-qa-as57-master
git -C "$ROOT" worktree add --detach "$MW" master >/dev/null 2>&1 || { echo "worktree add failed"; exit 2; }
trap 'git -C "$ROOT" worktree remove --force "$MW"; git -C "$ROOT" worktree prune' EXIT
echo "master worktree at $(git -C "$MW" rev-parse --short HEAD)"
cat > "$MW/apps/invoicing/compose.override.yaml" <<'EOF'
services:
  web:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('https://example.invalid/')"]
EOF
echo "applied: $(git -C "$MW" status --porcelain)"
(cd "$ROOT" && node apps/chat/bin/compose-run.mjs --project asc-qa-as57-3 --cwd "$MW/apps/invoicing" --log "$SP/run3-M1-before-master.log" 2>&1 | grep -E "built:|tests=|leak check|exit=")
