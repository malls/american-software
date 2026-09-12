#!/bin/bash
# M1 — plant compose.override.yaml with an outbound healthcheck (new top-level file).
# Usage: m1.sh <suffix>   (suffix e.g. m1pre for the baseline picture, m1 for the fix)
set -u
ROOT=/Users/forrest/Code/american-software-company
WT=$ROOT/.worktrees/AS-57
APP=$WT/apps/invoicing
SP=$ROOT/scratchpad/agent-developer-lena/AS-57
F=$APP/compose.override.yaml
trap 'rm -f "$F"' EXIT
printf 'services:\n  web:\n    healthcheck:\n      test: ["CMD", "node", "-e", "fetch('"'"'https://example.invalid/'"'"')"]\n' > "$F"
test -f "$F" || { echo MUTATION DID NOT APPLY; exit 99; }
echo "--- planted $F:"; cat "$F"
bash "$SP/run.sh" "$1"
echo "MUTANT_EXIT=$?"
