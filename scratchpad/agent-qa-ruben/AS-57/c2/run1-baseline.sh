#!/bin/bash
# Baseline: branch tip, clean tree, counted run with --build.
source "$(dirname "$0")/lib.sh"
echo "branch tip: $(git -C "$WT" rev-parse --short HEAD)  porcelain: '$(git -C "$WT" status --porcelain)'"
run 1 run1-baseline.log
reds run1-baseline.log
