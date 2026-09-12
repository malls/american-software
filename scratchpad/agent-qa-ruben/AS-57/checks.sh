#!/bin/bash
# Mechanical checks: AC6, AC11 line cap, AC1 COPY count, vendor/ ignore status, stale comments, commit authors.
source "$(dirname "$0")/lib.sh"
cd "$WT" || exit 2
echo "AC6 quote = null in dependency-policy: $(grep -c 'quote = null' apps/invoicing/test/dependency-policy.test.js)"
echo "AC6 quote = null in deploy-shape:      $(grep -c 'quote = null' apps/invoicing/test/deploy-shape.test.js)"
echo "AC11 line count: $(wc -l < apps/invoicing/test/dependency-policy.test.js)"
echo "AC1 COPY count: $(grep -c '^COPY' apps/invoicing/Dockerfile)"
mkdir -p apps/invoicing/vendor && touch apps/invoicing/vendor/x.js
if git check-ignore -q apps/invoicing/vendor/x.js; then echo "host vendor/x.js: IGNORED"; else echo "host vendor/x.js: NOT ignored (committable)"; fi
rm -rf apps/invoicing/vendor
echo "porcelain after: '$(git status --porcelain)'"
echo "--- stale-comment candidates:"
grep -n "both places" apps/invoicing/test/dependency-policy.test.js
grep -n "bounded by VENDOR_ASSETS\|exists only inside the image" apps/invoicing/test/dependency-policy.test.js
echo "--- commit authors master..HEAD:"
git log --format='%an <%ae>' master..HEAD | sort | uniq -c
echo "--- .lattice on branch:"; git diff --stat master...HEAD -- .lattice | wc -l
