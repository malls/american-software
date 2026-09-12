#!/bin/bash
source "$(dirname "$0")/lib.sh"
RUN=${1:-final-run2}
setup $RUN fresh
echo noop > "$SP/e2e/$RUN/mode"
start $RUN
sleep 2
sentinel $RUN 1
wait_for $RUN 'LOOP-STOP' 60
stop $RUN
show $RUN
