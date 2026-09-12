#!/usr/bin/env bash
# tools/lanes/check-disjoint.sh — AS-60 criterion (b'): the pair
# file-disjointness gate, run BEFORE the fan (plan §6.0.5) and again
# post-trial. Also the standing gate required before any future D1+D1 pair.
#
# Two properties, both required, over every unordered pair of tasks in the
# config:
#   1. allowed-prefix sets pairwise disjoint — no prefix of one task equals,
#      contains, or is contained by a prefix of the other (plain string-prefix
#      logic: "apps/" overlaps "apps/invoicing/" even though string-unequal);
#   2. actual diff path sets pairwise disjoint — the branches' changed-path
#      sets (git diff --name-only master...<branch>) share no path.
# Checking ALL pairs in the config (not just the two lanes) is deliberate:
# the orchestrator's own spike branch participates in the campaign, and
# disjointness is the property that keeps every anomaly attributable.
#
# usage: check-disjoint.sh [--repo <path>] <trial-config.json>
# Config schema: tools/lanes/README.md. Every listed task needs "branch" and
# "allowed_prefixes"; every branch must exist (exit 2 otherwise — the gate
# runs after planning has created the branches).
#
# Output contract (plan §7): line 1 cardinality, line 2 PASS/FAIL, then
# "  - <item>: <reason>" per violation. Exit 0 pass, 1 fail, 2 usage error.

set -euo pipefail

usage() { echo "usage: check-disjoint.sh [--repo <path>] <config>" >&2; exit 2; }

REPO="$PWD"
if [ "${1:-}" = "--repo" ]; then
  [ $# -ge 2 ] || usage
  REPO="$2"; shift 2
fi
[ $# -eq 1 ] || usage
CONFIG="$1"
[ -f "$CONFIG" ] || { echo "error: config not found: $CONFIG" >&2; exit 2; }
git -C "$REPO" rev-parse --verify --quiet "refs/heads/master" >/dev/null \
  || { echo "error: no master branch in $REPO" >&2; exit 2; }

# One line per task: <key>\t<branch>\t<prefix>[\t<prefix>...]
TASKLIST="$(node -e '
const fs = require("fs");
let cfg;
try { cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("error: unreadable config: " + e.message); process.exit(2); }
const tasks = Object.entries(cfg.tasks || {});
if (tasks.length < 2) { console.error("error: config must list at least 2 tasks"); process.exit(2); }
for (const kv of tasks) {
  const k = kv[0], t = kv[1];
  if (!t.branch) { console.error("error: task " + k + " has no branch"); process.exit(2); }
  const pres = t.allowed_prefixes || [];
  if (!pres.length) { console.error("error: task " + k + " has no allowed_prefixes"); process.exit(2); }
  console.log([k, t.branch].concat(pres).join("\t"));
}
' "$CONFIG")" || exit 2

KEYS=()
BRANCHES=()
PREFIXLISTS=()
while IFS= read -r line; do
  [ -n "$line" ] || continue
  KEYS+=("$(printf '%s\n' "$line" | cut -f1)")
  BRANCHES+=("$(printf '%s\n' "$line" | cut -f2)")
  PREFIXLISTS+=("$(printf '%s\n' "$line" | cut -f3- | tr '\t' '\n')")
done <<EOF
$TASKLIST
EOF

# Per-task changed-path sets (sorted unique), and the total path count.
N=0
DIFFS=()
i=0
while [ $i -lt ${#KEYS[@]} ]; do
  b="${BRANCHES[$i]}"
  git -C "$REPO" rev-parse --verify --quiet "refs/heads/$b" >/dev/null \
    || { echo "error: branch not found: $b (task ${KEYS[$i]})" >&2; exit 2; }
  d="$(git -C "$REPO" diff --name-only "master...$b" | sed '/^$/d' | sort -u)"
  DIFFS+=("$d")
  if [ -n "$d" ]; then
    c="$(printf '%s\n' "$d" | wc -l | tr -d ' ')"
    N=$((N + c))
  fi
  i=$((i + 1))
done

K=0
PAIRS=0
VIOLATIONS=""
i=0
while [ $i -lt ${#KEYS[@]} ]; do
  j=$((i + 1))
  while [ $j -lt ${#KEYS[@]} ]; do
    PAIRS=$((PAIRS + 1))
    # 1. prefix-set disjointness
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      while IFS= read -r q; do
        [ -n "$q" ] || continue
        hit=0
        if [ "$p" = "$q" ]; then
          hit=1
        else
          case "$p" in "$q"*) hit=1 ;; esac
          case "$q" in "$p"*) hit=1 ;; esac
        fi
        if [ "$hit" -eq 1 ]; then
          K=$((K + 1))
          VIOLATIONS="${VIOLATIONS}  - prefix overlap ${KEYS[$i]}/${KEYS[$j]}: '${p}' vs '${q}'
"
        fi
      done <<EOFQ
${PREFIXLISTS[$j]}
EOFQ
    done <<EOFP
${PREFIXLISTS[$i]}
EOFP
    # 2. diff-path-set disjointness
    SHARED="$(comm -12 <(printf '%s\n' "${DIFFS[$i]}") <(printf '%s\n' "${DIFFS[$j]}") | sed '/^$/d')"
    if [ -n "$SHARED" ]; then
      while IFS= read -r sp; do
        [ -n "$sp" ] || continue
        K=$((K + 1))
        VIOLATIONS="${VIOLATIONS}  - shared path ${KEYS[$i]}/${KEYS[$j]}: ${sp}
"
      done <<EOFS
$SHARED
EOFS
    fi
    j=$((j + 1))
  done
  i=$((i + 1))
done

echo "examined ${#KEYS[@]} task(s) / $PAIRS pair(s) / $N diff path(s)"
if [ "$K" -eq 0 ]; then
  echo "PASS: allowed-prefix sets and branch diff sets pairwise disjoint"
  exit 0
fi
echo "FAIL: $K violation(s)"
printf '%s' "$VIOLATIONS"
exit 1
