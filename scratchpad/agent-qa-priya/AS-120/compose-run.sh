#!/bin/bash
# AS-120 review runner (qa-priya). Usage: compose-run.sh <apps/chat dir> <project> [test file...]
# Always --build; prints the Built receipt line and the TAP summary + any not-ok lines.
set -u
DIR="$1"; PROJ="$2"; shift 2
export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1
/usr/local/bin/docker compose -f "$DIR/compose.yaml" --project-directory "$DIR" -p "$PROJ" \
  run --build --rm test node --test --test-reporter=tap "$@" 2>&1 \
  | grep -E 'Built|^# (tests|pass|fail|skipped|cancelled|todo)|^not ok'
echo "pipestatus=${PIPESTATUS[0]}"
