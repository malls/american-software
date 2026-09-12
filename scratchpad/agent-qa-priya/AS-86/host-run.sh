#!/bin/bash
# AS-86 review: host counted run inside the worktree (cwd change is local to this script).
cd /Users/forrest/Code/american-software-company/.worktrees/AS-86/apps/chat || exit 99
node --test test/*.test.js > /Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-86/host-run.log 2>&1
echo "HOST EXIT $?" >> /Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-86/host-run.log
