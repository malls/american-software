# AS-7 Plan — Message-triggered /advance (chat app becomes the board member's primary interface)

Planner: Owen Kessler (`agent:cto-owen`), 2026-08-30. Complexity: medium.
Charter: CLAUDE.md "Operating Modes → Target interface: the chat app". Task description carries the board-decided constraints; this plan turns them into a buildable design. Terms are defined before use (sentinel, high-water mark, lock, tick) — see §2.

## 1. Scope

**In scope (repo artifacts, implementable by a developer):**
1. Sentinel write in `apps/chat/lib/store.js` — on insert of any message authored by `human:*`.
2. Host-side watcher script `apps/chat/watch/advance-watcher.mjs` (zero-dep Node, house style) + launchd plist template + ops README under `apps/chat/watch/`.
3. Lock protocol documentation + tick-side lock steps in `.claude/commands/advance.md` (exact wording in §10 — advance.md is not one of the four protected top-level markdown files, so the implementer edits it directly; wording is recorded here anyway in case the board reclassifies).
4. Tests: sentinel behavior in the existing `node --test` suite; watcher decision logic as pure-function unit tests.

**Out of scope / explicitly board-assisted (host steps, §9):** installing the launchd agent, granting/widening headless permission config, and the first live claude-fired tick. The watcher is company tooling but its installation touches the host outside the repo; the board performs those steps with the CTO's runbook.

**Non-goals (deliberate):** the watcher never parses message content, never filters by conversation, never queues N ticks for N messages (one pending fire max), never touches `chat.db` (it reads only the sentinel and its own state files), never triggers on `agent:*`/`system:*` authors. Any `human:*` message anywhere (channel, DM, thread reply) triggers — if that proves too chatty, the board narrows it in a follow-up task; we do not pre-build filtering.

## 2. Definitions

- **Tick** — one headless `claude -p '/advance'` run from the repo root; contract in `.claude/commands/advance.md`.
- **Sentinel** — a small JSON file the *container* writes into the bind-mounted data dir when a human posts; the only signal that crosses the container/host boundary.
- **High-water mark** — the last sentinel `messageId` the *watcher* has already fired for; persisted so restarts don't refire or miss.
- **Lock** — a single-flight lockfile; whoever holds it is "the currently running tick". Watcher, loop ticks, and manual ticks all respect it.

## 3. Sentinel design (container side, `lib/store.js`)

- **Path:** `<data dir>/last-human-message.json` where data dir = `dirname(dbPath)` — i.e. `apps/chat/data/last-human-message.json` on the host, `/app/data/...` in the container. Falls under the existing `.gitignore` rule `apps/chat/data/*` (never committed).
- **Trigger point:** end of `postMessage()` in `store.js`, after the insert tx commits, iff `author.startsWith('human:')`. The identity-id regex in `registerIdentity` guarantees the kind prefix matches the stored kind, so the prefix test is authoritative — no extra query. Covers both the HTTP server and the CLI (both go through `store.postMessage`), and thread replies (any human message counts).
- **Content** (not a bare touch — content beats mtime because it makes missed-while-down recovery and debounce-collapse testable and exact):
  ```json
  { "messageId": 123, "authorId": "human:forrest", "conversationId": 7, "createdAt": "..." }
  ```
- **Write semantics:** write to `last-human-message.json.tmp` then `renameSync` (atomic on the same filesystem — the watcher can never read a torn file). Wrapped in try/catch: a sentinel write failure must NEVER fail the post — chat keeps working if the data dir is unwritable. Skip entirely when `dbPath === ':memory:'`.
- **Placement note:** this is a deliberate, tiny impurity in the otherwise fs-free store module; it lives in `postMessage` (not the server) so the CLI path is covered. Comment it as the AS-7 signal seam.
- **Ownership caveat:** on macOS Docker Desktop, bind-mount writes appear host-owned (VirtioFS mapping) — fine here. On a Linux deployment the container user would own the file; note in the ops README, do not solve now.

## 4. Watcher design (host side, `apps/chat/watch/advance-watcher.mjs`)

- **Language:** zero-dependency Node (ESM, `node:` builtins only) — matches the house style; requires host `node >= 20` (documented; the ops README includes a version check).
- **Detection: cheap polling, not fswatch.** Poll interval 5s (stat + read of one ~120-byte JSON file). Rationale: macOS FSEvents does not reliably deliver events for files written *by the container* into a bind mount, and polling removes a host dependency (fswatch) and a whole class of edge cases. 5s poll + 15s debounce is far below human latency expectations for "the company noticed my message".
- **State files** (all under `apps/chat/data/`, all gitignored by the existing rule):
  - `advance-watcher.highwater.json` — `{ "messageId": N, "firedAt": "..." }`, written by the watcher only.
  - `advance.lock` — see §5.
  - `logs/` — see §7.
- **Core loop (each poll):**
  1. Read sentinel. Missing/unparsable → no-op (unparsable is logged once per content change).
  2. If `sentinel.messageId <= highwater.messageId` → no-op.
  3. Else arm/refresh the debounce timer (§6). When the timer expires: re-read sentinel (collapse everything that arrived during the window), check the lock (§5) — held & fresh → skip (the running tick's inbox pull delivers the message; the sentinel stays > highwater, so we re-check after the lock clears); free/stale → fire.
  4. **Fire:** acquire lock (`wx`), set highwater to the sentinel `messageId` just read, spawn the tick (§8) with a hard timeout, stream output to a tick log, release lock on child exit, log exit status.
- **Missed-while-down recovery:** the sentinel and high-water files persist. On startup the watcher runs the same step 2/3 comparison — a message sent while the watcher (or the whole machine) was down fires exactly one tick on the next start. No DB access needed; the sentinel *is* the durable "latest human message" record.
- **High-water advances at fire time, not at tick success.** A failed/timed-out tick does not refire in a loop (that would burn tokens unboundedly on a persistent failure); failure is logged loudly (§7) and the next human message retries naturally. This is the deliberate at-most-once-per-message choice; the board reads `logs/` when a tick misbehaves.
- **Single instance:** launchd `KeepAlive` guarantees one supervised instance; the watcher additionally refuses to start if another live watcher holds `advance-watcher.pid` (same pid-liveness check as the lock) — belt for the "someone runs it manually while launchd has it" case.
- **Configuration:** env-overridable constants, defaults in-script: `ADVANCE_POLL_S=5`, `ADVANCE_DEBOUNCE_S=15`, `ADVANCE_TICK_TIMEOUT_MIN=30`, `ADVANCE_LOCK_STALE_MIN=45`, `ADVANCE_REPO_ROOT` (default: resolved from the script's own path), `ADVANCE_CLAUDE_BIN` (default `claude`, resolved via PATH set in the plist).
- **Testability requirement:** the fire/skip decision is a pure exported function — `decide({ sentinel, highwater, lock, now, config }) -> { action: 'noop'|'debounce'|'skip-locked'|'fire', reason }` — with all fs/spawn effects kept in a thin shell around it. Unit tests drive `decide` directly.

## 5. Lock protocol (single-flight, shared with the loop)

- **Path (canonical, name it everywhere):** `apps/chat/data/advance.lock`.
- **Content:** JSON `{ "pid": 12345, "startedAt": "<ISO>", "source": "watcher" | "loop" | "manual" }`.
- **Acquire:** create with `{ flag: 'wx' }` (O_EXCL — atomic, no TOCTOU). Exists → read it and evaluate staleness.
- **Staleness (a crashed tick must not wedge the company):** stale iff (a) `pid` is not alive (`process.kill(pid, 0)` → ESRCH), or (b) `startedAt` older than `ADVANCE_LOCK_STALE_MIN` (45 min — deliberately > tick timeout of 30 min so the watcher's own child is always reaped by the timeout before its lock can be stolen). Stale → log, remove, retry acquire once. Fresh → skip.
- **Writers/readers:**
  - *Watcher-fired ticks:* the watcher owns the lock for the child's lifetime (pid = watcher pid; the child is reliably reaped by the watcher, so watcher liveness ⇒ lock validity). The tick itself does nothing extra.
  - *Loop/manual ticks:* the tick contract (`advance.md`, wording in §10) acquires the lock as step 0 and removes it at tick end. The watcher then correctly no-ops while a `/loop /advance` session is mid-tick. Between loop ticks the lock is free — if a loop is idle-waiting and the watcher fires, that is acceptable double coverage, not double work: the fired tick and the next loop tick both start with `lattice list` + inbox sweep, and the second finds the work already claimed/read.
  - Model-noncompliance risk (a loop tick forgetting the lock) degrades to the same benign case: two ticks race, Lattice claims and `BEGIN IMMEDIATE` serialize the real state, one of them finds nothing to do. The lock is an efficiency/etiquette device, not a correctness invariant — correctness lives in Lattice claims and SQLite. Say this in the README so nobody "fixes" it into something load-bearing.

## 6. Debounce

Fixed trailing window, default 15s (inside the board's 10–30s band): first sentinel advance arms a timer; further advances within the window do NOT extend it (no livelock under a steady message stream — a chatty board member still gets a tick at most 15s after his first message, and the fire-time re-read collapses everything since). One pending fire max; messages that land after the fire-time read simply leave sentinel > highwater and trigger the next cycle.

## 7. Logging (the board must be able to inspect a failed unattended run)

- `apps/chat/data/logs/advance-watcher.log` — watcher lifecycle: start/stop, fires (with messageId), skips (with reason: locked/debounce/below-highwater), lock steals, tick exit codes. Single append-only file, size-capped by simple self-truncation check at startup.
- `apps/chat/data/logs/tick-<UTC timestamp>.log` — full stdout+stderr of each fired tick (`claude -p` text output). Pruned at each fire: delete tick logs older than 14 days.
- launchd `StandardOutPath`/`StandardErrorPath` also point at `logs/` (captures crashes before our logger exists).
- Ops README: "the board's first stop after a weird unattended run is `apps/chat/data/logs/`."

## 8. Tick invocation & permission reality

```
cd "$ADVANCE_REPO_ROOT" && claude -p '/advance' --permission-mode acceptEdits --output-format text
```

- Verified on this host: `claude` 2.1.237; `-p/--print` non-interactive mode exists; `--permission-mode` choices include `acceptEdits`, `dontAsk`, `bypassPermissions`. (Not run — flags read from `--help` only.)
- **Reality check documented in the README:** in `-p` mode there is no prompt UI — a tool call not covered by settings allowlists/permission mode is *denied*, not *waited on*. So a tick cannot hang on a permission prompt, but it can be quietly unable to commit/push/run tests if the host's allowlist is too narrow. Mitigations, in order: (1) start with `acceptEdits` + the project/local settings allowlist, (2) the first live fire is board-assisted (§9) precisely to observe denials in the tick log and widen the allowlist, (3) `--permission-mode bypassPermissions` is the full-autonomy option and is a **board decision** recorded in CLAUDE.md if taken — the watcher reads the mode from `ADVANCE_PERMISSION_MODE` env (default `acceptEdits`) so changing policy is a plist edit, not a code change.
- **Hung/failed tick handling (watcher side, independent of permission mode):** hard timeout `ADVANCE_TICK_TIMEOUT_MIN` (30 min) → SIGTERM, 15s grace, SIGKILL; log `TIMEOUT`; release lock; highwater already advanced, so no refire storm; next human message retries.
- The watcher sets a minimal env for the child: `PATH` from the plist (must include the claude binary and node), `HOME`, and nothing else exotic — documented so launchd's thin default env doesn't produce "works in my shell, dies under launchd" mysteries.

## 9. Repo artifacts vs. host steps (the honesty boundary)

**Repo (implementer builds, QA verifies in the container test suite):**
| Artifact | Path |
|---|---|
| Sentinel write | `apps/chat/lib/store.js` (postMessage) |
| Sentinel tests | `apps/chat/test/store.test.js` (extend) |
| Watcher script (pure `decide` + thin shell) | `apps/chat/watch/advance-watcher.mjs` |
| Watcher unit tests | `apps/chat/test/watcher.test.js` (imports `decide` + staleness helpers; no spawning, no fs side effects — keeps the mountless-test invariant) |
| launchd template | `apps/chat/watch/com.american-software.advance-watcher.plist.template` (placeholders: `__REPO_ROOT__`, `__NODE_BIN__`, `__PATH__`; `RunAtLoad=true`, `KeepAlive=true` → survives reboot and crashes) |
| Ops runbook | `apps/chat/watch/README.md` (install/uninstall via `launchctl bootstrap gui/$(id -u)` / `bootout`, log locations, permission-mode config, troubleshooting, Linux-ownership caveat) |
| Tick lock contract | `.claude/commands/advance.md` (§10 wording) |

**Host (board-assisted — the board grants the harness permission context; these are acceptance steps, not repo code):**
1. Render the plist template, place in `~/Library/LaunchAgents/`, `launchctl bootstrap`.
2. Confirm/adjust headless permission config (settings allowlist; decide if/when `bypassPermissions`).
3. **First live fire:** with nothing running, send a DM from the browser UI; observe exactly one tick in `logs/`, inbox read, action taken. Watch the tick log for permission denials; widen allowlist as needed.
4. Reboot test (or accept `RunAtLoad` on faith + `launchctl print` check).

## 10. Proposed `advance.md` wording (implementer applies; recorded here for the board)

Insert as step 0 of "Tick procedure" and a closing line in step 5:

> **0. Take the single-flight lock.** Atomically create `apps/chat/data/advance.lock` (write `{"pid": <your shell pid>, "startedAt": "<ISO now>", "source": "loop"|"manual"}` with the `wx` flag, e.g. `node -e '...'` or `set -C` in bash). If it already exists and is fresh (owner pid alive AND `startedAt` < 45 min old), **end the tick immediately as a no-op** — another tick is running and its inbox sweep will deliver any pending messages. If it is stale (dead pid or > 45 min), delete it, log the steal in your tick output, and take it. Ticks fired by the message watcher (AS-7) skip this step — the watcher holds the lock for them.

> *(append to step 5)* Remove `apps/chat/data/advance.lock` if this tick created it — releasing the lock is part of ending the tick clean.

And under "Running continuously", one added bullet:

> - Message-triggered: the host watcher (`apps/chat/watch/`, AS-7) fires one tick when the board member posts in the chat app and no tick holds `apps/chat/data/advance.lock`.

## 11. Acceptance criteria

**Node-testable (must pass in the mountless container suite):**
1. `postMessage` by a `human:*` author writes `<datadir>/last-human-message.json` with the exact `{messageId, authorId, conversationId, createdAt}` of the inserted row; a second human post overwrites it with the higher id.
2. `postMessage` by `agent:*` and `system:*` authors (including `ingestEvent`) leaves the sentinel absent/unchanged.
3. A human *thread reply* updates the sentinel (any human message counts).
4. `:memory:` store never attempts the write; an unwritable data dir does not fail the post.
5. `decide()` unit coverage: below-highwater → noop; fresh foreign lock → skip-locked; stale lock by dead pid → fire; stale lock by age → fire; startup with persisted highwater < sentinel (missed-while-down) → fire exactly once; two sentinel advances inside one debounce window → one fire at the latest messageId.
6. Full existing suite stays green (`docker compose run test` semantics unchanged — watcher tests import pure logic only).

**Hand-walk, board-assisted (recorded as a lattice comment when performed):**
7. launchd agent installed; survives `launchctl bootout`/reboot per the runbook.
8. With nothing running, one browser DM → exactly one tick fires, reads the inbox, acts.
9. With a `/loop /advance` tick mid-flight (lock held), a DM fires no extra tick; the message is handled by the running/next loop tick.
10. A tick killed mid-run leaves: a `TIMEOUT`/exit-code line in the watcher log, a tick log, and a *removed* lock; the next DM fires normally.

## 12. Test plan

Extend `store.test.js` (temp-dir DBs already the pattern there) for criteria 1–4; new `test/watcher.test.js` for criterion 5 using injected clocks/fixture objects — zero child processes, zero real locks. QA reviews `git diff master...feat/AS-7-message-trigger` and runs the container suite; the hand-walk items are QA-scripted (runbook steps) but board-executed, and QA's review comment records which of 7–10 were witnessed vs. deferred to the board.

## 13. Risks & open questions (time-boxed, with defaults)

- **Host node availability** for the watcher — default: require it, README documents `node --version` check. (Box expires at implementation; if absent, fallback is rewriting the shell in bash with `plutil`-style JSON hacks — avoid.)
- **Every human message fires a tick** may be too chatty once traffic grows — default: ship as specified; board narrows later (explicit non-goal now).
- **Permission allowlist breadth** for unattended pushes (`git push` to github.com) — surfaced at the board-assisted first fire; not solvable from inside the repo.
- **advance.md classification:** treated as employee-editable (not in the protected four). If the board disagrees, §10 is copy-paste-ready.
