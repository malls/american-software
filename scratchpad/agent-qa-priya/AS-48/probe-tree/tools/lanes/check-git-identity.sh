#!/usr/bin/env bash
# tools/lanes/check-git-identity.sh — AS-60 ships-clean criterion (f):
# every commit on a task branch is authored by an expected employee identity.
#
# Convention (CLAUDE.md, Git Methodology; settled 2026-09-01 off AS-53):
# author.name is the employee id exactly as it appears in the Lattice actor id
# (agent:developer-marcus -> developer-marcus) and author.email is
# <name>@agents.american-software.local, so git blame joins the event log on
# one key. The planted falsification for this checker is the exact drift
# AS-53 settled: a commit authored as developer-marcus-webb.
#
# usage: check-git-identity.sh [--repo <path>] <branch> <trial-config.json>
# The expected-author set is the "expected_authors" of the config task whose
# "branch" field matches <branch> (schema: tools/lanes/README.md).
#
# Output contract (plan §7): line 1 cardinality, line 2 PASS/FAIL, then
# "  - <sha7>: <reason>" per violation. A commit with a wrong name AND a
# non-canonical email yields two violation lines. Exit 0 pass, 1 fail,
# 2 usage/environment error.

set -euo pipefail

usage() { echo "usage: check-git-identity.sh [--repo <path>] <branch> <config>" >&2; exit 2; }

REPO="$PWD"
if [ "${1:-}" = "--repo" ]; then
  [ $# -ge 2 ] || usage
  REPO="$2"; shift 2
fi
[ $# -eq 2 ] || usage
BRANCH="$1"
CONFIG="$2"

[ -f "$CONFIG" ] || { echo "error: config not found: $CONFIG" >&2; exit 2; }
git -C "$REPO" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null \
  || { echo "error: branch not found: $BRANCH" >&2; exit 2; }

# Expected author names for this branch, one per line (zero-dep: host node).
EXPECTED="$(node -e '
const fs = require("fs");
const config = process.argv[1], branch = process.argv[2];
let cfg;
try { cfg = JSON.parse(fs.readFileSync(config, "utf8")); }
catch (e) { console.error("error: unreadable config: " + e.message); process.exit(2); }
const entry = Object.entries(cfg.tasks || {}).find(function (kv) { return kv[1].branch === branch; });
if (!entry) { console.error("error: no task in config with branch: " + branch); process.exit(2); }
const authors = entry[1].expected_authors || [];
if (!authors.length) { console.error("error: task " + entry[0] + " has no expected_authors"); process.exit(2); }
for (const a of authors) console.log(a);
' "$CONFIG" "$BRANCH")" || exit 2

EXPECTED_CSV="$(printf '%s\n' "$EXPECTED" | paste -sd, - | sed 's/,/, /g')"

LOG="$(git -C "$REPO" log --format='%H%x09%an%x09%ae' "master..$BRANCH")"

N=0
K=0
VIOLATIONS=""
while IFS="$(printf '\t')" read -r sha an ae; do
  [ -n "$sha" ] || continue
  N=$((N + 1))
  short="$(printf '%s' "$sha" | cut -c1-7)"
  inset=0
  while IFS= read -r exp; do
    [ -n "$exp" ] || continue
    [ "$an" = "$exp" ] && inset=1
  done <<EOF2
$EXPECTED
EOF2
  if [ "$inset" -eq 0 ]; then
    K=$((K + 1))
    VIOLATIONS="${VIOLATIONS}  - ${short}: author.name '${an}' not in expected set (${EXPECTED_CSV})
"
  fi
  if [ "$ae" != "${an}@agents.american-software.local" ]; then
    K=$((K + 1))
    VIOLATIONS="${VIOLATIONS}  - ${short}: author.email '${ae}' != '${an}@agents.american-software.local'
"
  fi
done <<EOF
$LOG
EOF

echo "examined $N commit(s) on $BRANCH (master..$BRANCH)"
if [ "$K" -eq 0 ]; then
  echo "PASS: all commit identities in expected set with canonical emails"
  exit 0
fi
echo "FAIL: $K violation(s)"
printf '%s' "$VIOLATIONS"
exit 1
