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
| `advance-watcher.pid` | watcher | single-instance guard + liveness heartbeat (AS-27) |
| `logs/advance-watcher.log` | watcher | lifecycle: fires, skips (with reason), steals, exit codes |
| `logs/tick-<timestamp>.log` | watcher | full stdout+stderr of each fired tick; pruned after 14 days |
| `logs/deploy-<timestamp>.log` | watcher | full output of each unattended rebuild (AS-75); same 14-day pruning |
| `deploy-state.json` | watcher | AS-75: what the last deploy-poll decided — `{desiredId, dirty, reason, desiredReason, runningId, dockerBin, dockerReason, computedAt, lastAttempt}`. The chat server reads it for the sidebar's build line. |
| `logs/launchd.{out,err}.log` | launchd | crashes before our logger exists |
| `logs/lattice-dashboard.out.log` | launchd | Lattice dashboard stdout (AS-94) |
| `logs/lattice-dashboard.err.log` | launchd | Lattice dashboard stderr (AS-94) |

**The board's first stop after a weird unattended run is `apps/chat/data/logs/`.**

## AS-75: the watcher also deploys, and restarts itself

Merged `apps/chat` code used to sit on master until a human ran
`docker compose up -d --build` by hand — five times, over two days. It no
longer does. Every `ADVANCE_DEPLOY_POLL_S` seconds (default 60) the watcher
evaluates a pure predicate over three observable facts and takes **at most one
action**:

1. **desired** — a sha256 over `git ls-tree HEAD` of the nine image inputs
   (`IMAGE_INPUTS`, kept equal to the Dockerfile's `COPY` set by
   `test/deploy-shape.test.js`). Deliberately not the whole `apps/chat`
   directory: `data/export/` is tracked and rewritten by every records export,
   so a directory-wide digest would rebuild the image on chat traffic.
2. **running** — the id the container itself reports at `GET /api/build`, baked
   at build time by the Dockerfile's `ARG BUILD_ID`. The endpoint, not a file
   the deployer wrote: a file records intent, the endpoint records reality.
3. **watcher source** — a digest of `watch/*.mjs` on disk versus the one taken
   at startup.

`desired ≠ running` → rebuild. Container current but this file changed →
**exit for launchd to relaunch**. Otherwise → nothing. It is level-triggered,
so it needs no cooperation from whoever merged and it recovers on its own after
a crash; there is no marker file and no merge-step hook.

**Why the watcher and not a tick.** The permission layer that denies `docker`
belongs to Claude Code and applies to the *tick child*, not to this process —
launchd runs plain node here, and it may spawn anything the user can run. The
only obstacle was `PATH`, and the watcher sidesteps it by resolving the binary
itself: `ADVANCE_DOCKER_BIN` if set (used verbatim; **if it is set and missing
the watcher refuses and says so — it never falls through to a candidate**),
otherwise `/usr/local/bin/docker`, `/opt/homebrew/bin/docker`,
`/Applications/Docker.app/Contents/Resources/bin/docker`. No plist edit is
required for any of this to work.

**The self-restart contract.** The watcher cannot `launchctl kickstart` itself
(it would be killing the process issuing the command) and does not need to:
`RunAtLoad` + `KeepAlive` mean launchd relaunches the job when it exits, from
the on-disk file — i.e. on the new code. It exits with `process.exit(70)`, and
the non-zero status is deliberate: it relaunches under `KeepAlive: true` *and*
under `KeepAlive: {SuccessfulExit: false}`, so the restart does not depend on
which semantics the plist has. **`launchctl print` will therefore show a
non-zero `LastExitStatus` (70) after a self-update. That is expected, not a
crash.** `advance-watcher.pid` is deliberately left in place across the restart:
unlinking it would blink the board's sidebar to `Off · no watcher` on every
watcher update, and a briefly stale heartbeat is the quieter, honest signal.

**Refusals, all of which say so in `deploy-state.json` and in the sidebar:**

| Reason | Meaning |
|---|---|
| `busy` | any fresh `advance.lock` — a rebuild restarts the server, and must never land under a tick mid-write to the chat API |
| `inputs-dirty` | uncommitted changes under the nine paths. "Merged code is live" means *committed* code; baking uncommitted bytes under a label claiming to be `HEAD` is worse than being stale |
| `no-git` / short input set | the digest could not be computed. A digest over 8 of 9 inputs would be stable, wrong, and would stop triggering rebuilds forever, so a short `ls-tree` is a refusal, not a shorter digest |
| `no-docker` | the binary did not resolve; set `ADVANCE_DOCKER_BIN` in the plist |
| `cooldown` | the last attempt at *this same id* failed less than `ADVANCE_DEPLOY_COOLDOWN_MIN` (30) ago. A new merge changes the id and retries immediately |

**A deploy is "ok" only when the thing that is RUNNING changed.** After the
build exits the watcher re-probes `/api/build`; exit code 0 with a mismatched id
is recorded as `outcome: 'fail'`, reason `id-mismatch`. A command's exit status
is not evidence of a deployment.

**Known failure mode (accepted):** new watcher code that crashes at startup
makes launchd crash-loop, and there is then no watcher at all. The AS-27
indicator reports `Off · no watcher`, which is the honest signal and exactly
what it was built for. First stop is `logs/launchd.err.log`.

**Known limit (accepted):** a `/loop` session holding the lock nearly
continuously delays the deploy. A loop releases the lock between ticks
(`advance.md` step 6) and the poll is level-triggered, so the deploy lands in
the first gap. While it runs, the sidebar reads `Tick in flight · deploy`
(~1 s when the layer cache is warm; minutes for a cold emulated build).

Env knobs: `ADVANCE_DEPLOY_POLL_S` (60), `ADVANCE_DEPLOY_TIMEOUT_MIN` (15),
`ADVANCE_DEPLOY_COOLDOWN_MIN` (30), `ADVANCE_DOCKER_BIN`, `ADVANCE_GIT_BIN`,
`ADVANCE_CHAT_URL` (`http://127.0.0.1:8347`).

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

### After any change to this watcher: restart it

The watcher is a long-lived host process; editing this file changes nothing
until it is restarted. **AS-27 in particular:** `advance-watcher.pid` now
carries a `heartbeatAt` timestamp, rewritten at the top of every poll, and the
chat app's loop-status indicator uses its age to decide whether a watcher is
listening (the container cannot check a host pid for liveness). A watcher still
running pre-AS-27 code writes no `heartbeatAt`, so the indicator reads
`Off · no watcher` even while that watcher is happily firing ticks. Restarting
it on the new code is the fix, and it is a **host action for the board or a
live session** — a headless tick has no `docker`/`launchctl` reach and cannot
do it for you. The indicator corrects itself within 60s of the restart.

`pid` and `startedAt` keep their meaning; the single-instance check reads `pid`
only and is unaffected by the added key.

## Lattice dashboard (AS-94) — the second launchd job in this directory

AS-93 made every `AS-n` reference in chat a deep link into the Lattice
dashboard, and those links resolve only while something is listening on
`127.0.0.1:8799`. Until AS-94 that "something" was a process somebody started
by hand inside a Claude Code session: it died with the session, and the board's
links died with it. The category decision is AS-10's and it has not changed —
the dashboard is vendor tooling shipped with the pipx Lattice CLI, the same
category as `git`, so it does not belong in compose. The supervision answer is
therefore the watcher's: a launchd user agent, from a template in this
directory.

**This job is the ONE owner of `127.0.0.1:8799`. Do not run `lattice dashboard`
beside it** — the second copy fails to bind (`Address already in use`), and if
it is the *first* copy that is stray, the launchd job crash-loops behind it at
launchd's default throttle. The bind is loopback only; the tailnet reaches it
through Tailscale serve, which is Tailscale-authenticated. **Never change the
host to `0.0.0.0`** — `test/launchd-plist.test.js` goes red if you do.

### Prerequisites

- `command -v lattice` resolves (the pipx symlink, e.g.
  `/Users/<you>/.local/bin/lattice` — use the symlink, not the venv path
  inside `~/.local/pipx/venvs/`, so a pipx upgrade does not orphan the job).
  The venv script carries an absolute python shebang, so the job needs no
  `python` on `PATH`, and no `node` at all.
- The **main checkout** is on `master`: the dashboard finds `.lattice/` by
  walking up from `WorkingDirectory`, which the recipe sets to the repo root.

### Install (launchd)

```sh
REPO_ROOT="$(git rev-parse --show-toplevel)"   # run from inside the MAIN checkout (master)
LATTICE_BIN="$(command -v lattice)"            # e.g. /Users/<you>/.local/bin/lattice (pipx symlink)
LABEL=com.american-software.lattice-dashboard

# 1. Nothing else may hold 127.0.0.1:8799 — a live-session dashboard here makes the job crash-loop.
lsof -nP -iTCP:8799 -sTCP:LISTEN               # if it lists a PID, that is the process to stop
pgrep -fl 'lattice dashboard'                  # all dashboards, on ANY port — kill only the :8799 owner
# kill <pid-from-lsof>                         # then re-run lsof: it must print nothing

# 2. Render, lint, install.
mkdir -p "$REPO_ROOT/apps/chat/data/logs"
sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
    -e "s|__LATTICE_BIN__|$LATTICE_BIN|g" \
    -e "s|__PATH__|$(dirname "$LATTICE_BIN"):/usr/bin:/bin|g" \
    "$REPO_ROOT/apps/chat/watch/$LABEL.plist.template" \
    > ~/Library/LaunchAgents/$LABEL.plist
plutil -lint ~/Library/LaunchAgents/$LABEL.plist   # must print "OK"

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$LABEL.plist
launchctl print gui/$(id -u)/$LABEL | head -20      # state = running
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8799/   # 200
```

`plutil -lint` is the host half of the well-formedness check; the in-suite half
is `test/launchd-plist.test.js`, which renders every template here with fixed
values and parses the result with its own strict reader (`plutil` is macOS-only
and not in the tick allowlist, so no test can call it).

The `sed` recipe uses `|` as its delimiter: a `REPO_ROOT` containing a literal
`|` would corrupt the render on the host while the node guard (a plain string
replace) stays green. No sane checkout path contains one — but if yours does,
change the delimiter rather than debugging launchd.

### Uninstall / restart

```sh
launchctl bootout gui/$(id -u)/com.american-software.lattice-dashboard   # stop + unload
rm ~/Library/LaunchAgents/com.american-software.lattice-dashboard.plist  # uninstall
# restart = bootout, then bootstrap again
```

Unlike the watcher, you rarely need `bootout` to bounce this one: `lattice
restart` (run from the repo root; it defaults to :8799) restarts the dashboard
in place, and if the process exits instead of reloading, `KeepAlive` brings it
straight back. `launchctl kickstart -k gui/$(id -u)/$LABEL` is the
launchd-native equivalent.

### After any change to the dashboard: `lattice restart`

The dashboard is a long-lived host process, so a Lattice CLI upgrade (`pipx
upgrade lattice-tracker`) changes nothing in the running job until it restarts
— `lattice restart` is enough for that. A change to the **template** is
different: re-render it into `~/Library/LaunchAgents/` and `bootout` +
`bootstrap`, because launchd read the old copy at load time. Both are **host
actions for the board or a live session** — a headless tick has no `launchctl`
reach, exactly as with the watcher.

### Troubleshooting

- **`launchctl print` shows repeated non-zero exits within seconds** — something
  else already holds 8799. `lsof -nP -iTCP:8799 -sTCP:LISTEN`, stop that
  process, and the job recovers on its own (KeepAlive).
- **`state = running` but 8799 refuses** — wrong `__REPO_ROOT__` or a bad
  binary path in the rendered plist. Read
  `data/logs/lattice-dashboard.err.log`.
- **Deep links work on the Mac but not the phone** — that is the tailnet leg,
  not this job: `tailscale serve status` should show
  `:8443 -> http://127.0.0.1:8799`. That mapping is host state, not a repo
  artifact (see the three-legged block below).
- **`lattice restart` says nothing is listening** — the job is down. `launchctl
  print gui/$(id -u)/com.american-software.lattice-dashboard`.

### The port is a three-legged coupling

`8799` appears in three places that must agree, and only one of them is in this
repo's launchd job:

| Leg | Where | Owned by |
|---|---|---|
| L1 | `--port 8799` in `com.american-software.lattice-dashboard.plist.template` (this job) | this repo; guarded by `test/launchd-plist.test.js` |
| L2 | Tailscale serve `:8443 -> http://127.0.0.1:8799` | tailscaled's state on the host — **not** a repo artifact, and chat cannot observe it |
| L3 | `LOOPBACK_PORT = 8799` / `REMOTE_PORT = 8443` in `apps/chat/public/dashboard-link.js` (AS-93) | this repo |

Moving one leg alone breaks a surface: **L1 alone** kills the phone *and* the
Mac; **L1 + L2** kills the Mac; **L1 + L3 without L2** kills the phone.
`LATTICE_DASHBOARD_URL` does not rescue any of these — it is one verbatim base,
so it can say "this URL everywhere" but never "port X on loopback, port Y over
the tailnet"; pointing it at a non-8799 loopback URL fixes the Mac and
re-breaks the phone. The dashboard port question itself moved upstream to the
Lattice project by board decision on 2026-09-10 (DM msg 632; AS-96 cancelled) —
until that lands, `8799` is the CLI default and the declared value here.

## Permission modes (unattended reality)

In `-p` (headless) mode there is **no prompt UI**: a tool call not covered by
the settings allowlist / permission mode is **denied, not waited on**. A tick
cannot hang on a prompt, but it can be quietly unable to commit, push, or run
tests if the allowlist is too narrow — denials show up in the tick log.

1. ~~Start with the default `acceptEdits` + the repo's settings allowlists.~~
   **Disproven for headless children (AS-21):** project-scope
   `.claude/settings.json` allowlists never load for a headless `claude -p`
   child — workspace trust is granted interactively and a headless child
   never sees the dialog, so it logs "Ignoring N permissions.allow entries
   from .claude/settings.json: this workspace has not been trusted" and
   denies commands the file explicitly allows (evidence: tick log
   `apps/chat/data/logs/tick-2026-08-30T19-14-54.450Z.log`, four allowed
   commands all denied). The **operative rung**: the watcher re-reads
   `.claude/settings.json` at every fire and passes its allow/deny lists
   explicitly as `--allowedTools` / `--disallowedTools` on the spawn argv
   (`loadPermissionRules` + `tickArgv`, AS-21). Settings edits take effect
   on the next tick, no restart. If the file is missing or unparsable the
   watcher logs a WARN and fires without grants — degraded, never a
   hardcoded fallback list.
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
- **A merge to `apps/chat` did not go live** → read `data/deploy-state.json`.
  Its `reason` names the refusal and the table above says what each one means;
  `logs/deploy-*.log` has the build output. `dockerBin: null` with
  `dockerReason: "override-missing"` means `ADVANCE_DOCKER_BIN` points at
  nothing.
- **`launchctl print` shows `LastExitStatus = 70`** → not a crash. That is the
  watcher having self-updated after its own source changed; see the
  self-restart contract above.

## Linux deployment caveat

On macOS Docker Desktop, container writes to the bind mount appear
host-owned (VirtioFS mapping), so the watcher can read/replace the sentinel
freely. On a Linux host the container user would own those files — revisit
ownership/permissions (or move the sentinel dir) before deploying this
pattern there. Not solved now, deliberately.
