#!/bin/bash
source "$(dirname "$0")/lib.sh"
RUN=${1:-fix-run3}
setup $RUN fresh
echo lockgrab > "$SP/e2e/$RUN/mode"
start $RUN
sleep 2
sentinel $RUN 1
wait_for $RUN 'LOOP-WAIT lock' 40
sleep 40
stop $RUN
show $RUN
