#!/bin/bash
# AS-95 AC-7 harness — isolated stack. Never touches apps/chat/data or the live container.
set -u
SP=/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya
WATCHER=/Users/forrest/Code/american-software-company/.worktrees/AS-95/apps/chat/watch/advance-watcher.mjs

# setup <run> <fixture: fresh|inflight>  -> creates $SP/e2e/<run>/{repo,bin}
setup() {
  local run=$1 fixture=$2 E=$SP/e2e/$1
  rm -rf "$E"; mkdir -p "$E/repo/.lattice/tasks" "$E/repo/apps/chat/data" "$E/bin"
  local t1status=backlog
  [ "$fixture" = inflight ] && t1status=in_progress
  cat > "$E/repo/.lattice/tasks/T1.json" <<J
{"id":"task_T1","short_id":"T-1","title":"first","status":"$t1status","priority":"high","relationships_out":[]}
J
  cat > "$E/repo/.lattice/tasks/T2.json" <<J
{"id":"task_T2","short_id":"T-2","title":"Chat: second","status":"backlog","priority":"critical","relationships_out":[{"type":"depends_on","target_task_id":"task_T1"}]}
J
  cat > "$E/repo/.lattice/tasks/T3.json" <<J
{"id":"task_T3","short_id":"T-3","title":"waiting","status":"needs_human","priority":"low","relationships_out":[]}
J
  git -C "$E/repo" init -q -b master
  git -C "$E/repo" -c user.name=qa -c user.email=qa@x add -A
  git -C "$E/repo" -c user.name=qa -c user.email=qa@x commit -q -m "fixture"
  echo advance > "$E/mode"
  # fake claude: reads $E/mode each invocation. Logs every invocation with pid + args to $E/ticks.log
  cat > "$E/bin/claude" <<'C'
#!/bin/bash
E=$(cd "$(dirname "$0")/.." && pwd)
R=$E/repo
mode=$(cat "$E/mode")
echo "$(date +%T) tick-start pid=$$ mode=$mode args=$*" >> "$E/ticks.log"
sleepfor=0
case "$mode" in sleep:*) sleepfor=${mode#sleep:}; mode=advance;; esac
[ "$sleepfor" != 0 ] && sleep "$sleepfor"
step() { # advance the fixture one stage; commit; print what it did
  for t in T1 T2; do
    f=$R/.lattice/tasks/$t.json
    st=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$f','utf8')).status)")
    case "$st" in
      backlog) nst=in_progress;; in_progress) nst=done;; *) continue;;
    esac
    node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$f','utf8'));j.status='$nst';fs.writeFileSync('$f',JSON.stringify(j))"
    git -C "$R" -c user.name=tick -c user.email=t@x commit -q -am "$t -> $nst"
    echo "$(date +%T) tick-step pid=$$ $t -> $nst head=$(git -C "$R" rev-parse --short HEAD)" >> "$E/ticks.log"
    return 0
  done
  echo "$(date +%T) tick-step pid=$$ nothing-left" >> "$E/ticks.log"
}
case "$mode" in
  advance) step;;
  noop) :;;
  fail) exit 3;;
  lockgrab) step; # simulate a manual/session tick winning the lock the instant ours is released
     sleep 30 & fp=$!; disown
     echo "{\"pid\":$fp,\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"manual\",\"nonce\":\"ffff\"}" > "$R/apps/chat/data/advance.lock"
     echo "$(date +%T) tick-lockgrab foreign pid=$fp" >> "$E/ticks.log";;
esac
echo "$(date +%T) tick-end pid=$$" >> "$E/ticks.log"
exit 0
C
  chmod +x "$E/bin/claude"
  echo "setup $run ($fixture) at $E"
}

# start <run> [extra env...]  -> watcher pid in $E/watcher.pid, log at $E/watcher.log
start() {
  local run=$1; shift; local E=$SP/e2e/$run
  env ADVANCE_REPO_ROOT="$E/repo" ADVANCE_CLAUDE_BIN="$E/bin/claude" ADVANCE_POLL_S=1 ADVANCE_DEBOUNCE_S=1 \
      ADVANCE_DOCKER_BIN=/nonexistent ADVANCE_CHAT_URL=http://127.0.0.1:1 "$@" \
      node "$WATCHER" >> "$E/watcher.log" 2>&1 &
  echo $! > "$E/watcher.pid"
  echo "started watcher pid $(cat $E/watcher.pid) for $run"
}
sentinel() { local E=$SP/e2e/$1; echo "{\"messageId\":$2,\"authorId\":\"human:forrest\"}" > "$E/repo/apps/chat/data/last-human-message.json"; echo "sentinel $2 written"; }
wait_for() { # wait_for <run> <regex> <timeout s>
  local E=$SP/e2e/$1 i=0
  while ! grep -qE "$2" "$E/watcher.log" 2>/dev/null; do sleep 1; i=$((i+1)); [ $i -ge $3 ] && { echo "TIMEOUT waiting for /$2/ after $3 s"; return 1; }; done
  echo "saw /$2/ after ${i}s"
}
stop() { local E=$SP/e2e/$1; kill -TERM "$(cat $E/watcher.pid)" 2>/dev/null; sleep 1; echo "stopped $1"; }
show() { local E=$SP/e2e/$1; echo "===== watcher.log ($1)"; sed -E 's/^[0-9T:.Z-]+ //' "$E/watcher.log" | grep -vE '^(DEPLOY-POLL|WARN git ls-tree|WARN permission rules)'; echo "===== ticks.log"; cat "$E/ticks.log" 2>/dev/null; echo "===== advance-loop.json"; cat "$E/repo/apps/chat/data/advance-loop.json" 2>/dev/null; echo; echo "===== highwater"; cat "$E/repo/apps/chat/data/advance-watcher.highwater.json" 2>/dev/null; echo; echo "===== lock present?"; ls "$E/repo/apps/chat/data/advance.lock" 2>&1; echo "===== git log"; git -C "$E/repo" log --oneline; }
