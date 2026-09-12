#!/bin/bash
cd /Users/forrest/Code/american-software-company/.worktrees/AS-81/apps/chat || exit 1
for i in 1 2 3; do
  echo "== host run $i  $(date -u +%H:%M:%SZ)"
  node --test 2>&1 | grep -E '^ℹ (tests|pass|fail|suites|cancelled|skipped|duration)'
done
