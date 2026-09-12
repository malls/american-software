#!/bin/bash
source "$(dirname "$0")/lib.sh"
RUN=${1:-run4b}
setup $RUN fresh
echo sleep:8 > "$SP/e2e/$RUN/mode"
start $RUN
sleep 2
sentinel $RUN 1
# wait for the SECOND tick to start (loop tick 2), then kill -9 the watcher mid-tick
wait_for $RUN 'LOOP-FIRE tick 2' 40
sleep 2
kill -9 "$(cat $SP/e2e/$RUN/watcher.pid)"
echo "--- kill -9 watcher, relaunch"
sleep 1
start $RUN
sleep 8
echo "--- concurrency check: claude processes alive"
pgrep -fl "$SP/e2e/$RUN/bin/claude" | head
sleep 14
stop $RUN
show $RUN
