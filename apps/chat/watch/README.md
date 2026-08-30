# advance-watcher — ops runbook (AS-7)

Host-side watcher that turns a human message in the chat app into one
`claude -p '/advance'` tick. The chat store (container) writes a sentinel file
into the bind-mounted data dir on every `human:*` post; this watcher (host)
polls it and fires a tick when no other tick is running.

This directory is **host tooling**. It never runs inside the container (a
container cannot spawn a claude session on the host); it is copied into the
image only so the mountless test suite can import its pure decision logic.

## How it decides (one paragraph)

Every 5s the watcher reads `apps/chat/data/last-human-message.json`. A
`messageId` above its high-water mark arms a **15s non-extending debounce**
(a burst of messages = one tick, at most 15s after the first). When the
window expires it re-reads the sentinel (collapsing the burst), checks the
single-flight lock `apps/chat/data/advance.lock` — held-and-fresh means a
loop/manual tick is running, so it skips (that tick's inbox sweep delivers
the message; the watcher re-checks when the lock clears) — then acquires the
lock, advances the high-water mark, and spawns
`claude -p '/advance' --permission-mode acceptEdits` from the repo root with
a 30-minute hard timeout (SIGTERM, 15s grace, SIGKILL).

**High-water advances at fire time, not tick success**: a failed tick is
logged loudly, never retried in a loop; the next human message retries
naturally. **The lock is etiquette, not a correctness invariant** —
correctness lives in Lattice claims and SQLite (`BEGIN IMMEDIATE`); two
racing ticks degrade to one of them finding no work. Do not "fix" the lock
into something load-bearing.

## Files (all under `apps/chat/data/`, all gitignored)

| File | Written by | Purpose |
|---|---|---|
| `last-human-message.json` | container (`lib/store.js`) | latest human message: `{messageId, authorId, conversationId, createdAt}` |
| `advance-watcher.highwater.json` | watcher | last messageId fired for |
| `advance.lock` | watcher / loop / manual ticks | single-flight: `{pid, startedAt, source}` |
| `advance-watcher.pid` | watcher | single-instance guard |
| `logs/advance-watcher.log` | watcher | lifecycle: fires, skips (with reason), steals, exit codes |
| `logs/tick-<timestamp>.log` | watcher | full stdout+stderr of each fired tick; pruned after 14 days |
| `logs/launchd.{out,err}.log` | launchd | crashes before our logger exists |

**The board's first stop after a weird unattended run is `apps/chat/data/logs/`.**

## Prerequisites

- Host `node >= 20` (the watcher is zero-dependency ESM using `node:` builtins):

  ```sh
  node --version   # must print v20.x or later
  command -v node claude   # both must resolve; note the directories for __PATH__
  ```

- The `claude` CLI logged in and working from this repo root.

## Install (launchd)

```sh
REPO_ROOT="$(git rev-parse --show-toplevel)"   # run from inside the repo
NODE_BIN="$(command -v node)"
LABEL=com.american-software.advance-watcher

sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    -e "s|__PATH__|$(dirname "$NODE_BIN"):$(dirname "$(command -v claude)"):/usr/bin:/bin|g" \
    "$REPO_ROOT/apps/chat/watch/$LABEL.plist.template" \
    > ~/Library/LaunchAgents/$LABEL.plist

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$LABEL.plist
launchctl print gui/$(id -u)/$LABEL | head -20   # state = running
tail -f "$REPO_ROOT/apps/chat/data/logs/advance-watcher.log"   # expect a START line
```

`RunAtLoad=true` + `KeepAlive=true` mean it starts at login/reboot and is
restarted if it crashes. The watcher also refuses to start beside another
live instance (pid file), so a stray manual run cannot double-fire.

## Uninstall / restart

```sh
launchctl bootout gui/$(id -u)/com.american-software.advance-watcher   # stop + unload
rm ~/Library/LaunchAgents/com.american-software.advance-watcher.plist  # uninstall
# restart = bootout, then bootstrap again
```

## Permission modes (unattended reality)

In `-p` (headless) mode there is **no prompt UI**: a tool call not covered by
the settings allowlist / permission mode is **denied, not waited on**. A tick
cannot hang on a prompt, but it can be quietly unable to commit, push, or run
tests if the allowlist is too narrow — denials show up in the tick log.

1. Start with the default `acceptEdits` + the repo's settings allowlists.
2. The **first live fire is board-assisted** precisely to watch the tick log
   for permission denials and widen the allowlist.
3. `ADVANCE_PERMISSION_MODE=bypassPermissions` is the full-autonomy option and
   is a **board decision recorded in CLAUDE.md** if taken. Changing mode is a
   plist edit (`EnvironmentVariables`), then bootout/bootstrap — not a code change.

## First-fire checklist (board-assisted; record results as a lattice comment on AS-7)

1. Install per above; `launchctl print` shows `state = running`; watcher log
   has a `START` line. Optionally reboot (or take `RunAtLoad` on faith) and
   re-check. *(plan §11 crit. 7)*
2. With **nothing else running** (no `/loop`, no manual tick, no
   `advance.lock` present), send yourself a DM from the browser UI. Within
   ~20s (5s poll + 15s debounce) the watcher log shows `DEBOUNCE` then `FIRE`,
   and exactly one `tick-*.log` appears. Verify the tick read the inbox and
   acted; scan its log for permission denials. *(crit. 8)*
3. Start a `/loop /advance` tick (or hand-create a fresh `advance.lock` with a
   live pid), send another DM: the watcher log shows `SKIP lock-fresh-*` and
   no new tick log. The running/next loop tick handles the message. *(crit. 9)*
4. Kill a fired tick mid-run (or let one time out): watcher log shows the
   `EXIT`/`TIMEOUT` line, the tick log exists, `advance.lock` is gone, and the
   next DM fires normally. *(crit. 10)*

## Troubleshooting

- **No START line ever appears** → `logs/launchd.err.log` (bad node path,
  syntax error, wrong plist paths). `launchctl print gui/$(id -u)/…` shows
  last exit status.
- **`FATAL another watcher is alive`** → a manual instance is running;
  kill it or bootout the launchd one. Pid is in `advance-watcher.pid`.
- **FIRE but tick log is empty / `spawn error`** → `claude` not on the
  plist `__PATH__`. Remember launchd does not read your shell profile.
- **Tick ran but did nothing useful** → read `tick-*.log` for permission
  denials (see Permission modes above).
- **Messages ignored** → is the sentinel updating? `cat
  apps/chat/data/last-human-message.json` after posting; if not, the post
  didn't come from a `human:*` author or the container can't write the bind
  mount. Compare with `advance-watcher.highwater.json`.
- **Watcher fires while a loop is running** → the loop tick forgot the lock
  (step 0 of `advance.md`). Benign — the second tick finds no work — but
  worth a nudge; see the lock-etiquette note above.

## Linux deployment caveat

On macOS Docker Desktop, container writes to the bind mount appear
host-owned (VirtioFS mapping), so the watcher can read/replace the sentinel
freely. On a Linux host the container user would own those files — revisit
ownership/permissions (or move the sentinel dir) before deploying this
pattern there. Not solved now, deliberately.
