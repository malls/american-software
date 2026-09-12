#!/bin/bash
source "$(dirname "$0")/lib.sh"
RUN=${1:-fix-run4c}
setup $RUN fresh
echo sleep:8 > "$SP/e2e/$RUN/mode"
start $RUN ADVANCE_TICK_TIMEOUT_MIN=1
sleep 2
sentinel $RUN 1
wait_for $RUN 'LOOP-FIRE tick 2' 40
sleep 2
kill -9 "$(cat $SP/e2e/$RUN/watcher.pid)"
echo "--- kill -9 watcher, relaunch with a 1-minute tick timeout (so the grace is 1 min, not 30)"
sleep 1
start $RUN ADVANCE_TICK_TIMEOUT_MIN=1
wait_for $RUN 'LOOP-STOP' 150
stop $RUN
show $RUN
