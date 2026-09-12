#!/bin/sh
# Counted compose receipts for AS-46 cycle 2, isolated project asc-review-as46-c2.
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-46
OUT=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-46/c2
D=/usr/local/bin/docker
cd "$WT" || exit 99
$D compose -p asc-review-as46-c2 -f apps/invoicing/compose.yaml run --build --rm test > "$OUT/suite-test.log" 2>&1
echo "EXIT=$?" >> "$OUT/suite-test.log"
$D compose -p asc-review-as46-c2 -f apps/invoicing/compose.yaml run --build --rm contract > "$OUT/suite-contract.log" 2>&1
echo "EXIT=$?" >> "$OUT/suite-contract.log"
echo SUITES-DONE >> "$OUT/progress.md"
