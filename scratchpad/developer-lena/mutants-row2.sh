#!/bin/sh
# AS-100 cycle 3 — mutation battery for the two new /api/events guards.
# Runs against a SCRATCH COPY of apps/chat; the task worktree is never mutated.
set -u
SRC=/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat
DST=/Users/forrest/Code/american-software-company/scratchpad/developer-lena/mut-row2/chat
rm -rf "$(dirname "$DST")"
mkdir -p "$(dirname "$DST")"
cp -R "$SRC" "$DST"
rm -rf "$DST/data"

run() { # $1 = label
  ( cd "$DST" && node --test 2>&1 ) > "/tmp/mut-$1.out" 2>&1
  echo "--- $1 ---"
  grep -E "^ℹ (tests|pass|fail)" "/tmp/mut-$1.out" | tr '\n' ' '
  echo
  echo "RED SET:"
  awk '/^✖ failing tests:/{f=1;next} f && /^✖ /{print "  " $0}' "/tmp/mut-$1.out" | sed 's/ ([0-9.]*ms)//' | sort -u
}

restore() { cp "$SRC/$1" "$DST/$1"; }

# M-A: `since` becomes INCLUSIVE. Anchored to the one slice in readEvents.
perl -0pi -e 's/events = at === -1 \? \[\] : events\.slice\(at \+ 1\);/events = at === -1 ? [] : events.slice(at);/' "$DST/server.js"
grep -q 'events.slice(at);' "$DST/server.js" || { echo "M-A DID NOT APPLY"; exit 1; }
grep -c 'events.slice(at)' "$DST/server.js"
run since-inclusive
restore server.js

# M-B: the /api/events door stops projecting — raw lines straight to the reader.
perl -0pi -e 's/events: events\.slice\(0, capped\)\.map\(projectEvent\)\.filter\(Boolean\),/events: events.slice(0, capped),/' "$DST/server.js"
grep -q 'events: events.slice(0, capped),' "$DST/server.js" || { echo "M-B DID NOT APPLY"; exit 1; }
run key-whitelist
restore server.js

# M-C: the fold's fallback match goes back to comparing a field it never stores
# — the defect this cycle FOUND. Proves the new guard catches it.
perl -0pi -e 's/  return open\.stage === ev\.data\?\.stage && open\.actor === ev\.data\?\.actor;/  return open.task === ev.data?.task \&\& open.stage === ev.data?.stage \&\& open.actor === ev.data?.actor;/' "$DST/lib/events.js"
grep -q 'open.task === ev.data?.task' "$DST/lib/events.js" || { echo "M-C DID NOT APPLY"; exit 1; }
run fold-fallback
restore lib/events.js

echo "=== tree proof (scratch restored to source) ==="
diff -r "$SRC/server.js" "$DST/server.js" && diff -r "$SRC/lib/events.js" "$DST/lib/events.js" && echo "scratch clean"
