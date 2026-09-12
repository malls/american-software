#!/bin/bash
# Priya, AS-56 review: host-side falsifiers. Each mutation: backup, trap restore,
# mutate, ASSERT APPLIED AT THE INTENDED SITE, run, restore, prove tree clean.
set -u
W=/Users/forrest/Code/american-software-company/.worktrees/AS-56
OUT=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-56
TOK=$W/docs/design/tokens/tokens.css
BR=$W/BRANDING.md
CHAT=$W/apps/chat/public/tokens.css
cp "$TOK" "$OUT/tokens.css.bak"; cp "$BR" "$OUT/BRANDING.md.bak"; cp "$CHAT" "$OUT/chat-tokens.css.bak"
restore() { cp "$OUT/tokens.css.bak" "$TOK"; cp "$OUT/BRANDING.md.bak" "$BR"; cp "$OUT/chat-tokens.css.bak" "$CHAT"; }
trap restore EXIT

run_tokens() { node --test "$W/docs/design/tokens/tokens.test.mjs" 2>&1 | grep -E '^(not ok|✖|ℹ (tests|pass|fail))|^# (Subtest|tests|pass|fail)' ; }

echo "=========== M1 (AC-1 falsifier): dark danger-solid alias back to danger-500, BOTH dark blocks ==========="
# Intended site: the two dark blocks only. Light block says danger-600, so a global
# replace of 'danger-solid: var(--color-danger-400)' can only hit the dark blocks.
node -e '
const fs=require("fs"); const p=process.argv[1]; let s=fs.readFileSync(p,"utf8");
const before=(s.match(/--color-danger-solid: var\(--color-danger-400\);/g)||[]).length;
s=s.replace(/--color-danger-solid: var\(--color-danger-400\);/g,"--color-danger-solid: var(--color-danger-500);");
fs.writeFileSync(p,s); console.log("M1 replaced", before, "occurrences (expect 2)"); if(before!==2) process.exit(9);
' "$TOK" || exit 9
grep -n "danger-solid: var" "$TOK"
run_tokens
# The test writes tokens.json.contrast idempotently — with the mutant it may rewrite it. Restore json too.
git -C "$W" checkout -- docs/design/tokens/tokens.json
restore
git -C "$W" diff --exit-code --stat && echo "M1 tree clean after restore"

echo "=========== M2 (AC-2 falsifier): BRANDING.md §3.4 new row 3.17 -> 3.99 ==========="
node -e '
const fs=require("fs"); const p=process.argv[1]; let s=fs.readFileSync(p,"utf8");
const needle="| `danger-solid` boundary vs `bg-surface` (non-text) | 3.17:1 | 3:1 | PASS |";
const n=s.split(needle).length-1; console.log("M2 needle occurrences", n, "(expect 1)"); if(n!==1) process.exit(9);
s=s.replace(needle, needle.replace("3.17:1","3.99:1")); fs.writeFileSync(p,s);
' "$BR" || exit 9
grep -n "3.99:1" "$BR"
run_tokens
git -C "$W" checkout -- docs/design/tokens/tokens.json
restore
git -C "$W" diff --exit-code --stat && echo "M2 tree clean after restore"

echo "=========== M3 (extra, chat parity guard): flip one byte in apps/chat/public/tokens.css (the new -400 hex) ==========="
node -e '
const fs=require("fs"); const p=process.argv[1]; let s=fs.readFileSync(p,"utf8");
const n=(s.match(/--color-danger-400: #D62937;/g)||[]).length; console.log("M3 needle occurrences", n, "(expect 1)"); if(n!==1) process.exit(9);
s=s.replace("--color-danger-400: #D62937;","--color-danger-400: #D62938;"); fs.writeFileSync(p,s);
' "$CHAT" || exit 9
grep -n "danger-400" "$CHAT"
node --test "$W/apps/chat/test/tokens-parity.test.js" 2>&1 | grep -E '^(not ok|✖|ℹ (tests|pass|fail))|AssertionError|expected|actual' | head -12
restore
git -C "$W" diff --exit-code --stat && echo "M3 tree clean after restore"

echo "=========== M4 (extra, chat parity guard from the OTHER side): change docs tokens.css only (sha pin) ==========="
node -e '
const fs=require("fs"); const p=process.argv[1]; let s=fs.readFileSync(p,"utf8");
const n=(s.match(/--color-danger-400: #D62937;/g)||[]).length; if(n!==1) process.exit(9);
s=s.replace("--color-danger-400: #D62937;","--color-danger-400: #D62938;"); fs.writeFileSync(p,s); console.log("M4 applied at docs tokens.css danger-400");
' "$TOK" || exit 9
node --test "$W/apps/chat/test/tokens-parity.test.js" 2>&1 | grep -E '^(not ok|✖|ℹ (tests|pass|fail))' | head -12
restore
git -C "$W" diff --exit-code --stat && echo "M4 tree clean after restore"
