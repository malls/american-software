#!/bin/bash
# M1: plant compose.override.yaml with an outbound healthcheck (the record's reproducer).
# Predicted red: {DP#3 "found 4 manifests", DP#5 compose.override.yaml:4: fetch}; 531/510/2/19.
source "$(dirname "$0")/lib.sh"
PLANT=$APP/compose.override.yaml
trap 'rm -f "$PLANT"' EXIT
cat > "$PLANT" <<'EOF'
services:
  web:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('https://example.invalid/')"]
EOF
echo "applied: $(git -C "$WT" status --porcelain)"
run 2 run2-M1-override.log
rm -f "$PLANT"; trap - EXIT
clean_check
reds run2-M1-override.log
grep -nE "found 4 manifests|compose.override.yaml:[0-9]+:" "$SP/run2-M1-override.log" | head -5
