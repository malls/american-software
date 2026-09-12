#!/bin/bash
# AS-90 planning baseline: counted --build runs of the offline suite and the
# contract suite, under a scratch compose project so the main checkout's web
# and the chat container are untouched. Docker is off PATH: absolute binary.
set -u
S=/Users/forrest/Code/american-software-company/scratchpad/agent-cto-owen/AS-90
cd /Users/forrest/Code/american-software-company/apps/invoicing || exit 2
export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1
/usr/local/bin/docker compose -p asc-inv-as90plan run --rm --build test > "$S/baseline-test.log" 2>&1
echo "exit=$?" >> "$S/baseline-test.log"
/usr/local/bin/docker compose -p asc-inv-as90plan run --rm --build contract > "$S/baseline-contract.log" 2>&1
echo "exit=$?" >> "$S/baseline-contract.log"
/usr/local/bin/docker compose -p asc-inv-as90plan down >> "$S/baseline-contract.log" 2>&1
echo DONE > "$S/baseline.done"
