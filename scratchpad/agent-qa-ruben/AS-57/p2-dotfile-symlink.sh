#!/bin/bash
# P2 (past the list): two independent plants, both predicted LOUD, disambiguated by message:
#  (a) dotfile manifest apps/invoicing/.probe.yaml with an outbound healthcheck
#      -> DP#3 "expected 3 manifests, found 4: ... .probe.yaml" + DP#5 ".probe.yaml:4: fetch"
#  (b) symlinked directory apps/invoicing/lib/alias -> ../demo (COPY preserves the link; statSync follows)
#      -> DP#3 source-list mismatch naming lib/alias/... (+ DP#5 hits on demo's fetch via lib/alias/)
source "$(dirname "$0")/lib.sh"
Y=$APP/.probe.yaml
L=$APP/lib/alias
trap 'rm -f "$Y" "$L"' EXIT
cat > "$Y" <<'EOF'
services:
  web:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('https://example.invalid/')"]
EOF
ln -s ../demo "$L"
echo "applied: $(git -C "$WT" status --porcelain | tr '\n' ' ')"; ls -la "$L"
run 12 run12-P2-dotfile-symlink.log
rm -f "$Y" "$L"; trap - EXIT
clean_check
reds run12-P2-dotfile-symlink.log
grep -nE "found 4: |\.probe\.yaml:[0-9]+: fetch|lib/alias" "$SP/run12-P2-dotfile-symlink.log" | head -6
