#!/bin/bash
# M2: plant lib/vendor/probe.js containing fetch('https://example.invalid/').
# Predicted red: {DP#3 with the assertion-0 message naming lib/vendor, DP#5 lib/vendor/probe.js:1: fetch}; 531/510/2/19.
# {DP#3} alone = the directory is still skipped = a finding.
source "$(dirname "$0")/lib.sh"
D=$APP/lib/vendor
trap 'rm -rf "$D"' EXIT
mkdir -p "$D"
echo "fetch('https://example.invalid/')" > "$D/probe.js"
echo "applied: $(git -C "$WT" status --porcelain)"
run 5 run5-M2-nested-vendor.log
rm -rf "$D"; trap - EXIT
clean_check
reds run5-M2-nested-vendor.log
grep -nE "SKIPPED_DIRS name below the top level|lib/vendor/probe.js:[0-9]+: fetch" "$SP/run5-M2-nested-vendor.log" | head -4
