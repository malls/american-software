#!/usr/bin/env bash
# tools/lanes/check-resume-preconditions.sh — AS-60 criterion (d), executable
# core: the full durable set a cold tick needs to resume a killed lane.
#
# "Resumed correctly" is defined procedurally in plan §6.2.5; this script is
# the checkable core of its discovery step: a resumer that knows only the
# task code must be able to find, from durable state alone,
#   1. status    — the board says in_progress (the stage did not complete);
#   2. branch-link — a branch_linked event names the task branch;
#   3. worktree  — a git worktree has that branch checked out;
#   4. plan      — the plan file exists and is a real plan, not scaffold.
# All four are evaluated independently: a missing branch-link also fails the
# worktree precondition (there is no linked branch to match a worktree
# against), because the resumer genuinely lacks both facts.
#
# The scaffold test mirrors the lattice CLI's is_scaffold_plan exactly
# (lattice/cli/helpers.py) — the CLI is what gates the real resume, so this
# checker must agree with it, quirks included: scaffold = "# <title>" heading
# plus (optionally) the task description verbatim; structural markdown
# (##, -, *, ```, numbered lists) or any other body text = real plan.
#
# usage: check-resume-preconditions.sh [--repo <path>] <task>
#   <task>  a short id (AS-41) or a full task id (task_01...). Resolved by
#           scanning .lattice/events/task_*.jsonl task_created events.
#
# Output contract (plan §7): line 1 cardinality, line 2 PASS/FAIL, then
# "  - <precondition>: <reason>" per violation. Exit 0 pass, 1 fail, 2 error.

set -euo pipefail

usage() { echo "usage: check-resume-preconditions.sh [--repo <path>] <task>" >&2; exit 2; }

REPO="$PWD"
if [ "${1:-}" = "--repo" ]; then
  [ $# -ge 2 ] || usage
  REPO="$2"; shift 2
fi
[ $# -eq 1 ] || usage
TASK="$1"

# Durable facts from the event log + plan file (zero-dep: host node).
# Emits: TASK_ID, CODE, STATUS, BRANCH (empty if never linked),
#        PLAN (real|scaffold|missing), one per line, tab-separated.
FACTS="$(node -e '
const fs = require("fs"), path = require("path");
const repo = process.argv[1], want = process.argv[2];
const dir = path.join(repo, ".lattice", "events");
let files;
try { files = fs.readdirSync(dir).filter(function (f) { return /^task_.*\.jsonl$/.test(f); }).sort(); }
catch (e) { console.error("error: cannot read events dir: " + dir); process.exit(2); }
let found = null;
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(function (l) { return l.trim(); });
  let events;
  try { events = lines.map(function (l) { return JSON.parse(l); }); }
  catch (e) { console.error("error: bad JSONL in " + f + ": " + e.message); process.exit(2); }
  const created = events.find(function (e) { return e.type === "task_created"; });
  const tid = f.replace(/\.jsonl$/, "");
  const sid = created && created.data ? created.data.short_id : null;
  if (tid === want || sid === want) { found = { tid: tid, sid: sid, events: events, created: created }; break; }
}
if (!found) { console.error("error: task not found in " + dir + ": " + want); process.exit(2); }

let status = found.created && found.created.data ? found.created.data.status : null;
let branch = null;
for (const e of found.events) {
  if (e.type === "status_changed") status = e.data.to;
  if (e.type === "branch_linked") branch = e.data.branch;
}

// Mirror of lattice/cli/helpers.py is_scaffold_plan (see header). Python
// isdigit() accepts unicode digits; [0-9] is the ASCII subset, which is what
// short-id numbered lists actually contain.
function isScaffold(content, description) {
  const stripped = content.trim();
  if (!stripped) return true;
  const lines = stripped.split(/\r?\n/);
  if (!lines[0].startsWith("# ")) return false;
  const body = lines.slice(1).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!body.length) return true;
  for (const lt of body) {
    if (lt.startsWith("## ") || lt.startsWith("### ") || lt.startsWith("- ") || lt.startsWith("* ") || lt.startsWith("```")) return false;
    if (lt.length > 2 && /[0-9]/.test(lt[0]) && lt.slice(0, 5).includes(". ")) return false;
  }
  if (description) {
    const bodyText = body.join("\n");
    const descText = description.trim().split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).join("\n");
    if (bodyText === descText) return true;
  }
  return false;
}

const planPath = path.join(repo, ".lattice", "plans", found.tid + ".md");
let plan = "missing";
if (fs.existsSync(planPath)) {
  const content = fs.readFileSync(planPath, "utf8");
  const desc = found.created && found.created.data ? (found.created.data.description || null) : null;
  plan = isScaffold(content, desc) ? "scaffold" : "real";
}

console.log("TASK_ID\t" + found.tid);
console.log("CODE\t" + (found.sid || found.tid));
console.log("STATUS\t" + (status || ""));
console.log("BRANCH\t" + (branch || ""));
console.log("PLAN\t" + plan);
' "$REPO" "$TASK")" || exit 2

fact() { printf '%s\n' "$FACTS" | grep "^$1$(printf '\t')" | cut -f2-; }
TASK_ID="$(fact TASK_ID)"
CODE="$(fact CODE)"
STATUS="$(fact STATUS)"
BRANCH="$(fact BRANCH)"
PLAN="$(fact PLAN)"

K=0
VIOLATIONS=""

# 1. status
if [ "$STATUS" != "in_progress" ]; then
  K=$((K + 1))
  VIOLATIONS="${VIOLATIONS}  - status: '${STATUS}' != 'in_progress'
"
fi

# 2. branch-link
if [ -z "$BRANCH" ]; then
  K=$((K + 1))
  VIOLATIONS="${VIOLATIONS}  - branch-link: no branch_linked event
"
fi

# 3. worktree — a worktree of this repo has the linked branch checked out.
if [ -n "$BRANCH" ]; then
  if git -C "$REPO" worktree list --porcelain | grep -Fxq "branch refs/heads/$BRANCH"; then
    :
  else
    K=$((K + 1))
    VIOLATIONS="${VIOLATIONS}  - worktree: no worktree checked out on ${BRANCH}
"
  fi
else
  K=$((K + 1))
  VIOLATIONS="${VIOLATIONS}  - worktree: no branch-link to match
"
fi

# 4. plan
if [ "$PLAN" != "real" ]; then
  K=$((K + 1))
  if [ "$PLAN" = "missing" ]; then
    VIOLATIONS="${VIOLATIONS}  - plan: missing
"
  else
    VIOLATIONS="${VIOLATIONS}  - plan: still scaffold
"
  fi
fi

echo "examined 4 precondition(s) for $CODE ($TASK_ID)"
if [ "$K" -eq 0 ]; then
  echo "PASS: durable resume set complete (status=in_progress, branch=$BRANCH, worktree present, plan real)"
  exit 0
fi
echo "FAIL: $K violation(s)"
printf '%s' "$VIOLATIONS"
exit 1
