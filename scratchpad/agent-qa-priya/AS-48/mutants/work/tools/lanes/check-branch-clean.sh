#!/usr/bin/env bash
# tools/lanes/check-branch-clean.sh — AS-60 ships-clean criterion (a):
# zero .lattice/ paths in a task branch's diff against master.
#
# The two-plane rule (CLAUDE.md, Git Methodology) puts board state on master
# only; task branches carry code. The lived failure this guards is AS-26: a
# cd into a worktree silently redirected lattice writes onto the task branch,
# and every read afterward looked correct. This checker makes that failure
# loud after the fact: any .lattice/ path in master...<branch> is a FAIL.
#
# usage: check-branch-clean.sh [--repo <path>] <branch>
#   --repo   repository to examine (default: current directory). Must come
#            before the positional argument.
#
# Output contract (plan §7, house rule: cardinality before quantification):
#   line 1: examined N changed file(s) on <branch> (master...<branch>)
#   line 2: PASS: ...  |  FAIL: K violation(s)
#   then one "  - <path>: <reason>" line per violation.
# Exit codes: 0 pass, 1 fail, 2 usage/environment error.

set -euo pipefail

usage() { echo "usage: check-branch-clean.sh [--repo <path>] <branch>" >&2; exit 2; }

REPO="$PWD"
if [ "${1:-}" = "--repo" ]; then
  [ $# -ge 2 ] || usage
  REPO="$2"; shift 2
fi
[ $# -eq 1 ] || usage
BRANCH="$1"

git -C "$REPO" rev-parse --verify --quiet "refs/heads/master" >/dev/null \
  || { echo "error: no master branch in $REPO" >&2; exit 2; }
git -C "$REPO" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null \
  || { echo "error: branch not found: $BRANCH" >&2; exit 2; }

DIFF="$(git -C "$REPO" diff --name-only "master...$BRANCH")"

N=0
K=0
VIOLATIONS=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  N=$((N + 1))
  case "$path" in
    .lattice/*)
      K=$((K + 1))
      VIOLATIONS="${VIOLATIONS}  - ${path}: .lattice/ path committed on task branch
"
      ;;
  esac
done <<EOF
$DIFF
EOF

echo "examined $N changed file(s) on $BRANCH (master...$BRANCH)"
if [ "$K" -eq 0 ]; then
  echo "PASS: no .lattice/ paths in branch diff"
  exit 0
fi
echo "FAIL: $K violation(s)"
printf '%s' "$VIOLATIONS"
exit 1
