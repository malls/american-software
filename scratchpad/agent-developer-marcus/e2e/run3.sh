#!/bin/bash
source "$(dirname "$0")/lib.sh"
setup run3 fresh
echo lockgrab > "$SP/e2e/run3/mode"
start run3
sleep 2
sentinel run3 1
wait_for run3 'SKIP fire aborted' 40
sleep 15
stop run3
show run3
