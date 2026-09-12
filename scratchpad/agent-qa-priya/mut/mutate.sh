#!/bin/bash
# mutate.sh <name> <file-relative> <perl-expr> <assert-grep-must-be-ABSENT-or-PRESENT: "absent:<re>"|"present:<re>">
# Scratch copy only. Prints: applied?, then failing test names.
SP=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya
name=$1; file=$2; expr=$3; assert=$4
D=$SP/mut/$name; rm -rf "$D"; cp -R "$SP/mut/base" "$D"
perl -0pi -e "$expr" "$D/$file"
if cmp -s "$SP/mut/base/$file" "$D/$file"; then echo "[$name] MUTATION NOT APPLIED — void"; exit 2; fi
kind=${assert%%:*}; re=${assert#*:}
if [ "$kind" = absent ]; then grep -qE "$re" "$D/$file" && { echo "[$name] ASSERT FAILED: /$re/ still present — void"; exit 2; }; fi
if [ "$kind" = present ]; then grep -qE "$re" "$D/$file" || { echo "[$name] ASSERT FAILED: /$re/ not present — void"; exit 2; }; fi
echo "[$name] mutation applied ($(diff "$SP/mut/base/$file" "$D/$file" | grep -c '^[<>]') changed lines)"
cd "$D" && node --test > "$D/out.log" 2>&1
echo "[$name] $(grep -E '^ℹ (tests|pass|fail) ' "$D/out.log" | tr '\n' ' ')"
echo "[$name] RED SET:"; grep -E '^✖ ' "$D/out.log" | sed 's/^✖ /    /' | sed -E 's/ \([0-9.]+ms\)$//'
