#!/bin/bash
source "$(dirname "$0")/lib.sh"
RUN=${1:-run1}
setup $RUN fresh
start $RUN
sleep 2
sentinel $RUN 1
wait_for $RUN 'LOOP-STOP' 60
stop $RUN
show $RUN
