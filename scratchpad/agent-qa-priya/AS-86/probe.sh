#!/bin/bash
W=/Users/forrest/Code/american-software-company/.worktrees/AS-86
echo "--- ls-tree (criterion 2) ---"
git -C $W ls-tree HEAD -- apps/chat/lib apps/chat/bin apps/chat/public apps/chat/server.js apps/chat/package.json apps/chat/test apps/chat/compose.yaml apps/chat/Dockerfile apps/chat/.dockerignore apps/chat/watch 2>&1
echo "--- IMAGE_INPUTS as written ---"
sed -n '/export const IMAGE_INPUTS/,/\]);/p' $W/apps/chat/watch/advance-watcher.mjs
echo "--- ls-files apps/chat ---"
git -C $W ls-files apps/chat | wc -l
git -C $W ls-files apps/chat | grep -v '^apps/chat/data/export/'
echo "--- stale strings ---"
grep -n -E '8 of 9|nine image|9 image inputs|nine paths|9 paths' $W/apps/chat/watch/advance-watcher.mjs $W/apps/chat/watch/README.md $W/apps/chat/README.md $W/apps/chat/Dockerfile $W/apps/chat/compose.yaml 2>/dev/null
echo "--- line 358 ctx ---"
sed -n '352,362p' $W/apps/chat/watch/advance-watcher.mjs
echo "--- test service ---"
grep -n -A14 '^  test:' $W/apps/chat/compose.yaml
echo "--- worktree status ---"
git -C $W status --short
