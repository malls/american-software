#!/bin/bash
# Priya's counted suite run for AS-48 review. $1 = service (test|contract), $2 = source dir, $3 = project name
SVC="${1:-test}"
SRC="${2:-/Users/forrest/Code/american-software-company/.worktrees/AS-48/apps/invoicing}"
PROJ="${3:-asc-review-as48-priya}"
LOG="/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-48/${PROJ}-${SVC}.log"
cd "$SRC" || exit 99
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 /usr/local/bin/docker compose -p "$PROJ" run --rm --build "$SVC" > "$LOG" 2>&1
echo "EXIT=$?" >> "$LOG"
