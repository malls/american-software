#!/bin/sh
# AS-61 mutation battery (agent:qa-priya). In-place, trap-restored, site-asserted.
# usage: mutate.sh <M-A|M-B|M-C|M-D>
set -u
W=/Users/forrest/Code/american-software-company/.worktrees/AS-61
SRV=$W/apps/chat/server.js
OUT=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-61
M=$1
cp "$SRV" "$OUT/server.js.bak"
trap 'cp "$OUT/server.js.bak" "$SRV"; echo "[restored]"' EXIT

# Locate the enclosing function and the target line INSIDE it.
FN_START=$(grep -n '^function readRepoMarkdown' "$SRV" | cut -d: -f1)
FN_END=$(awk -v s="$FN_START" 'NR>s && /^}/ {print NR; exit}' "$SRV")
echo "readRepoMarkdown spans L$FN_START-L$FN_END"

case "$M" in
  M-A) PAT='st.nlink !== 1' ; NEW='';;
  M-B) PAT='st.nlink !== 1' ; NEW='st.nlink === 1';;
  M-C) PAT="!(i === 0 \&\& s === '.lattice')" ; NEW="!(i === 0 \&\& (s === '.lattice' || s === '.claude'))";;
  M-D) PAT="if (st.nlink !== 1) throw fail();" ; NEW="if (st.nlink !== 1) throw new StoreError('hard link', 'not_found');";;
esac
LINE=$(awk -v s="$FN_START" -v e="$FN_END" -v p="$PAT" 'NR>s && NR<e && index($0,p) {print NR}' "$SRV")
COUNT=$(printf '%s\n' "$LINE" | grep -c .)
echo "matches inside function: $COUNT at line(s): $LINE"
[ "$COUNT" -eq 1 ] || { echo "ABORT: pattern not unique inside function"; exit 2; }

if [ "$M" = "M-A" ]; then
  sed -i.tmp "${LINE}d" "$SRV"
else
  # escape for sed
  ESC_PAT=$(printf '%s' "$PAT" | sed 's/[][\/.*^$&|()]/\\&/g')
  ESC_NEW=$(printf '%s' "$NEW" | sed 's/[\/&|]/\\&/g')
  sed -i.tmp "${LINE}s/${ESC_PAT}/${ESC_NEW}/" "$SRV"
fi
rm -f "$SRV.tmp"
echo "--- mutated diff (must touch only L$LINE of server.js):"
git -C "$W" diff --stat -- apps/chat/server.js
git -C "$W" diff -U0 -- apps/chat/server.js | grep '^[-+][^-+]'
APPLIED=$(git -C "$W" diff -U0 -- apps/chat/server.js | grep -c '^[-+][^-+]')
[ "$APPLIED" -ge 1 ] || { echo "ABORT: mutation did not apply"; exit 3; }
echo "--- running full suite:"
node --test "$W/apps/chat/test/*.test.js" 2>&1 > "$OUT/$M.log"
grep -E '^ℹ (tests|pass|fail)' "$OUT/$M.log"
echo "--- failing set:"
grep -E '^✖' "$OUT/$M.log" | sed 's/ ([0-9.]*ms)$//' | sort -u
