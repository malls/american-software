#!/bin/bash
# AS-85 mutant runner. Usage: run-mutant.sh <label> <file> <find> <replace>
# Backs up, restores under trap, asserts the mutation applied at the intended
# site, runs the counted host suite, records the exact failing set.
set -u
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-85
PAD=/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-85
LABEL="$1"; FILE="$2"; FIND="$3"; REPL="$4"
BAK="$PAD/$LABEL.bak"

cp "$FILE" "$BAK"
restore() { cp "$BAK" "$FILE"; rm -f "$BAK"; }
trap restore EXIT

echo "=== $LABEL ==="
echo "--- anchor grep -c (before) ---"
grep -F -c -- "$FIND" "$FILE"
node "$PAD/mutate.mjs" "$FILE" "$FIND" "$REPL" || exit 2
echo "--- anchor grep -c (after mutation) / mutant grep -c (after) ---"
grep -F -c -- "$FIND" "$FILE"
grep -F -c -- "$REPL" "$FILE"
echo "--- mutated site, in context ---"
grep -F -n -- "$REPL" "$FILE"

node --test "$WT"/apps/chat/test/*.test.js > "$PAD/$LABEL.out" 2>&1
echo "--- exit=$? tallies ---"
grep -E '^. (tests|pass|fail) ' "$PAD/$LABEL.out"
echo "--- failing test names ---"
grep -E '^✖ ' "$PAD/$LABEL.out" | sed 's/ ([0-9.]*ms)$//'
