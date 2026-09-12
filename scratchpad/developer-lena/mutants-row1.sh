#!/bin/bash
# AS-100 row-1 mutation battery. Scratch copy only — the task worktree is never
# mutated. Each mutant: copy, apply, ASSERT IT LANDED AT THE INTENDED SITE
# (grep the exact replaced text in the mutated file), run, record the red set.
set -u
SRC=/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat
OUT=/Users/forrest/Code/american-software-company/scratchpad/developer-lena/mutants-row1.log
: > "$OUT"

run_mutant() {
  local n="$1" file="$2" from="$3" to="$4" expect="$5"
  local dir="/tmp/as100-mutant-$n"
  rm -rf "$dir"
  cp -R "$SRC" "$dir"
  python3 - "$dir/$file" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
n = s.count(frm)
if n != 1:
    print(f"MUTATION-SITE-ERROR: pattern found {n} times (need exactly 1)", file=sys.stderr)
    sys.exit(3)
open(path, 'w').write(s.replace(frm, to))
PY
  if [ $? -ne 0 ]; then
    echo "M$n: MUTATION DID NOT APPLY UNIQUELY — not a guard result" >> "$OUT"
    return
  fi
  if ! grep -qF "$to" "$dir/$file"; then
    echo "M$n: MUTATION NOT PRESENT AFTER EDIT — not a guard result" >> "$OUT"
    return
  fi
  echo "M$n ($file): expect red = $expect" >> "$OUT"
  echo "M$n mutated line(s):" >> "$OUT"
  grep -nF "$to" "$dir/$file" >> "$OUT"
  ( cd "$dir" && node --test 2>&1 ) > "/tmp/as100-mutant-$n.out"
  grep -E '^✖ ' "/tmp/as100-mutant-$n.out" | sed 's/^/  RED: /' >> "$OUT"
  grep -E '^ℹ (tests|pass|fail) ' "/tmp/as100-mutant-$n.out" | sed 's/^/  /' >> "$OUT"
  echo >> "$OUT"
  rm -rf "$dir"
}

# M1 (AC-1): drop schema_version from the envelope.
run_mutant 1 lib/events.js "    schema_version: SCHEMA_VERSION,
" "" "events-envelope-keys"

# M2 (AC-1): readTaskEvents keeps a private parse loop instead of parseJsonl.
run_mutant 2 lib/lattice.js "    for (const ev of parseJsonl(text).events) events.push(ev);" "    for (const line of text.split('\\n')) { if (!line.trim()) continue; try { const ev = JSON.parse(line); if (ev && ev.id) events.push(ev); } catch {} }" "lattice-events-share-parser"

# M3 (AC-2): no same-ms increment — fresh random bits on a collision instead.
run_mutant 3 lib/events.js "    lastRand = lastRand >= RAND_MAX ? 0n : lastRand + 1n;" "    lastRand = lastRand;" "events-id-monotonic"

# M4a (AC-3): the writer stops terminating its own line, so line 1 is no longer
# byte-identical after a second append.
run_mutant 4 lib/events.js "  const line = \`\${serialiseEvent(ev)}\\n\`;" "  const line = \`\${serialiseEvent(ev)}\`;" "events-append-only"

# M4b (AC-3): a truncating writer appears in the module at all.
run_mutant 5 lib/events.js "  mkdir(dirname(path), { recursive: true });" "  if (false) writeFileSync(path, line);
  mkdir(dirname(path), { recursive: true });" "events-no-truncating-path"

# M6 (AC-6): a timeout reported as an error.
run_mutant 6 lib/events.js "  if (timedOut) return 'timeout';" "  if (timedOut) return 'error';" "watcher-events-outcome-timeout"

# M7 (AC-15): the liveness bound is two tick boxes instead of one.
run_mutant 7 lib/events.js "    const alive = open && (tickLive || ageMs < tickTimeoutMs);" "    const alive = open && (tickLive || ageMs < 2 * tickTimeoutMs);" "events-liveness-bound"

# M8 (AC-15): the reducer ignores the spawned sub-agent and reports the stage's
# own employee/clock instead.
run_mutant 8 lib/events.js "    const startedAt = sub ? sub.ts : lane.stage.ts;" "    const startedAt = lane.stage.ts;" "events-liveness-shapes"

cat "$OUT"
