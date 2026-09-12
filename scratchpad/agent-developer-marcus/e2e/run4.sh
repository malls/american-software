#!/bin/bash
source "$(dirname "$0")/lib.sh"
RUN=${1:-fix-run4}
setup $RUN fresh
echo sleep:8 > "$SP/e2e/$RUN/mode"
start $RUN ADVANCE_TICK_TIMEOUT_MIN=1
sleep 2
sentinel $RUN 1
wait_for $RUN 'FIRE messageId 1' 30
echo "--- mirror while tick 1 is still running:"; cat "$SP/e2e/$RUN/repo/apps/chat/data/advance-loop.json"; echo
sleep 1
kill -9 "$(cat $SP/e2e/$RUN/watcher.pid)"
echo "--- kill -9 during TICK 1, relaunch"
sleep 1
start $RUN ADVANCE_TICK_TIMEOUT_MIN=1
wait_for $RUN 'LOOP-STOP' 180
stop $RUN
show $RUN
