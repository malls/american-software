#!/usr/bin/env bash
# tools/lanes/check-confinement.sh — AS-60 ships-clean criterion (b):
# a task branch's diff is confined to the task's allowed path prefixes, the
# task's worktree is porcelain-clean, and the main checkout is porcelain-clean.
#
# Under lanes, two implementer sub-agents work concurrently in two worktrees;
# confinement is what keeps an anomaly attributable to a lane instead of a
# merge seam (plan §1, task description "each worktree's diff confined to its
# own task's files"). Dirty trees at check time are equally a failure: a lane
# that ships must leave nothing uncommitted behind.
#
# usage: check-confinement.sh [--repo <path>] <branch> <trial-config.json>
# The allowed prefixes and worktree path come from the config task whose
# "branch" field matches <branch> (schema: tools/lanes/README.md). Prefix
# matching is plain string-prefix; by convention prefixes end with "/".
# A worktree path is resolved relative to --repo unless absolute.
#
# Output contract (plan §7): line 1 cardinality, line 2 PASS/FAIL, then
# "  - <item>: <reason>" per violation. Dirty-tree violations quote the raw
# porcelain line, one violation per entry. Exit 0 pass, 1 fail, 2 usage error.

set -euo pipefail

usage() { echo "usage: check-confinement.sh [--repo <path>] <branch> <config>" >&2; exit 2; }

REPO="$PWD"
if [ "${1:-}" = "--repo" ]; then
  [ $# -ge 2 ] || usage
  REPO="$2"; shift 2
fi
[ $# -eq 2 ] || usage
BRANCH="$1"
CONFIG="$2"

[ -f "$CONFIG" ] || { echo "error: config not found: $CONFIG" >&2; exit 2; }
git -C "$REPO" rev-parse --verify --quiet "refs/heads/master" >/dev/null \
  || { echo "error: no master branch in $REPO" >&2; exit 2; }
git -C "$REPO" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null \
  || { echo "error: branch not found: $BRANCH" >&2; exit 2; }

# Worktree path (line 1) and allowed prefixes (rest), from the config.
CFG="$(node -e '
const fs = require("fs");
const config = process.argv[1], branch = process.argv[2];
let cfg;
try { cfg = JSON.parse(fs.readFileSync(config, "utf8")); }
catch (e) { console.error("error: unreadable config: " + e.message); process.exit(2); }
const entry = Object.entries(cfg.tasks || {}).find(function (kv) { return kv[1].branch === branch; });
if (!entry) { console.error("error: no task in config with branch: " + branch); process.exit(2); }
const t = entry[1];
if (!t.worktree) { console.error("error: task " + entry[0] + " has no worktree"); process.exit(2); }
const pres = t.allowed_prefixes || [];
if (!pres.length) { console.error("error: task " + entry[0] + " has no allowed_prefixes"); process.exit(2); }
console.log(t.worktree);
for (const p of pres) console.log(p);
' "$CONFIG" "$BRANCH")" || exit 2

WT="$(printf '%s\n' "$CFG" | sed -n 1p)"
PREFIXES="$(printf '%s\n' "$CFG" | sed 1d)"
PREFIX_CSV="$(printf '%s\n' "$PREFIXES" | paste -sd, - | sed 's/,/, /g')"
case "$WT" in
  /*) WT_ABS="$WT" ;;
  *) WT_ABS="$REPO/$WT" ;;
esac

DIFF="$(git -C "$REPO" diff --name-only "master...$BRANCH")"

N=0
K=0
VIOLATIONS=""

# 1. Every diff path inside an allowed prefix.
while IFS= read -r path; do
  [ -n "$path" ] || continue
  N=$((N + 1))
  ok=0
  while IFS= read -r pre; do
    [ -n "$pre" ] || continue
    case "$path" in "$pre"*) ok=1 ;; esac
  done <<EOF2
$PREFIXES
EOF2
  if [ "$ok" -eq 0 ]; then
    K=$((K + 1))
    VIOLATIONS="${VIOLATIONS}  - ${path}: outside allowed prefixes (${PREFIX_CSV})
"
  fi
done <<EOF
$DIFF
EOF

# 2. The task's worktree is porcelain-clean.
if [ -d "$WT_ABS" ]; then
  WTP="$(git -C "$WT_ABS" status --porcelain)"
  if [ -n "$WTP" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      K=$((K + 1))
      VIOLATIONS="${VIOLATIONS}  - worktree ${WT}: dirty: \"${line}\"
"
    done <<EOF3
$WTP
EOF3
  fi
else
  K=$((K + 1))
  VIOLATIONS="${VIOLATIONS}  - worktree ${WT}: missing
"
fi

# 3. The main checkout is porcelain-clean.
MP="$(git -C "$REPO" status --porcelain)"
if [ -n "$MP" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    K=$((K + 1))
    VIOLATIONS="${VIOLATIONS}  - main checkout: dirty: \"${line}\"
"
  done <<EOF4
$MP
EOF4
fi

echo "examined $N changed file(s) on $BRANCH / 2 working tree(s)"
if [ "$K" -eq 0 ]; then
  echo "PASS: diff confined to allowed prefixes; worktree and main checkout clean"
  exit 0
fi
echo "FAIL: $K violation(s)"
printf '%s' "$VIOLATIONS"
exit 1
