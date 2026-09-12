# AS-75 — Close the merge-to-deploy gap for `apps/chat`

Plan author: `agent:cto-owen`, 2026-09-04. Written for an implementer with **none**
of my context. Everything you need to build this is in this file plus the files it
names; you should not have to reconstruct the reasoning from Lattice comments.

---

## §1 The problem, stated as a fact rather than a complaint

Four chat tasks (AS-34, AS-54, AS-33, AS-32) were merged to master, marked `done`,
and were **not running** for up to two days. AS-27 made five. Each time, a human in a
live session ran the rebuild by hand. That has now happened three times (2026-08-31,
2026-09-03T16:28Z, 2026-09-03T23:11Z), each recorded in this task's comments.

Cause, in one sentence: **nothing between `git merge` and the running container is
automated, and the process that runs almost all of this company's work — a headless
`claude -p` watcher tick — structurally cannot run `docker`.**

Since AS-27 there are **two** deploy artifacts, not one:

| Artifact | Lives | Made current by | Observable |
|---|---|---|---|
| `asc-chat-server-1` (the image) | Docker, port 8347 | `docker compose up -d --build` | HTTP against 8347 |
| the host watcher process | launchd, host pid | restarting the process | `advance-watcher.pid` heartbeat |

A **half-deploy is worse than no deploy**: container rebuilt, watcher not restarted
renders `Off · no watcher` in the sidebar, which reads as a broken feature rather than
as a stale deploy. Before AS-27 a stale deploy showed 404s nobody looked at; now it
shows a confident wrong answer in the one widget the board consults to decide whether
the company is running. Any mechanism this task ships must cover **both** artifacts.

**GOAL.** Merged `apps/chat` code is live on 8347 **and** the host watcher is running
that code, with no human at the keyboard — or the board is told, in the place he
already looks, that it is not and why.

---

## §2 Mechanism decision

I explored the code before deciding, and the exploration changed the shape of the
recommendation in the task description. The description proposed **(a) watcher deploys
+ (c) merged-vs-deployed indicator, with (b)'s `advance.md` wording as the fallback if
(a)'s PATH change is refused**. I am keeping (a)+(c) and **dropping (b) as a
mechanism**, and I am dropping the PATH change from the critical path. Three findings
drove that; each is checkable.

### Finding 1 — the watcher is a plain Node process, not a Claude child

`apps/chat/watch/advance-watcher.mjs` is executed directly by launchd
(`ProgramArguments` = node + the script). The permission system that denies `docker`
belongs to Claude Code and applies to the **tick child** the watcher spawns, not to the
watcher itself. The watcher may `spawn()` anything the user can run. The only real
obstacle is `PATH`.

### Finding 2 — the PATH question is answerable, and does not need a plist change

The installed plist is `~/Library/LaunchAgents/com.american-software.advance-watcher.plist`.
Its rendered `PATH` is:

```
/Users/forrest/.nvm/versions/node/v24.13.1/bin:/Users/forrest/.local/bin:/usr/bin:/bin
```

`docker` is at `/usr/local/bin/docker` (a symlink into `Docker.app`), which is **not**
on that list, so a bare `spawn('docker', …)` from the watcher fails today. But
`/usr/bin/git` **is** reachable, and an absolute-path `spawn` needs no PATH at all.
So the watcher resolves the docker binary itself, from an env override plus a
candidate list, and reports the result. **This removes a host install step from the
critical path**: the feature ships and works without anyone editing a plist, and the
plist PATH change becomes an optional tidy-up rather than a gate. (Re-rendering the
plist is still recorded in §9 as a documentation change, because a future reader will
otherwise wonder.)

### Finding 3 — the watcher can restart itself without `launchctl`

`launchctl kickstart` was used by hand for the third deploy. The watcher cannot
kickstart itself (it would be killing the process issuing the command). It does not
need to: the plist sets `RunAtLoad=true` **and** `KeepAlive=true`, so launchd
relaunches the job when it exits. **The watcher restarts itself by exiting**, and
launchd relaunches it from the on-disk file — i.e. on the new code. No `launchctl`, no
second binary to resolve, nothing for a human to run.

> **This assumption is UNVERIFIED and you must prove it — see AC-8.** I tried to prove
> it this tick with a throwaway LaunchAgent and the sandbox classifier blocked both the
> probe and the `man launchd.plist` read. So I designed around the uncertainty instead:
> the watcher exits with a **non-zero** status (`process.exit(70)`), which relaunches
> under `KeepAlive: true` *and* under `KeepAlive: {SuccessfulExit: false}` semantics.
> If AC-8 shows launchd does **not** relaunch, stop and report — do not silently fall
> back to something else; §2.4 names the fallback and it needs my ruling.

### §2.1 Chosen mechanism

**The watcher owns the deploy, on a poll, with no marker file and no merge-step hook.**
Every `ADVANCE_DEPLOY_POLL_S` seconds (default 60), when no tick is running, the
watcher evaluates a pure predicate over three observable facts and takes at most one
action:

1. **desired build id** — a digest of the image's git-committed inputs at `HEAD`.
2. **running build id** — what the container itself reports at `GET /api/build`.
3. **watcher source digest** — a digest of `watch/*.mjs` on disk, versus the digest
   captured at startup.

`desired ≠ running` → rebuild the container. Container current but watcher source
changed → exit and let launchd relaunch. Otherwise → nothing.

The container also **publishes its own staleness** so the board can see the gap
regardless of whether the mechanism acted (that is half (c)).

### §2.2 What each rejected option removes — and what rejecting it costs

| Option | What it removes | Why not chosen |
|---|---|---|
| **(b) merge step deploys when it can** (`advance.md` wording) | The silent divergence — a live session would deploy at merge time and a headless one would tell the board. | Rejected **as the mechanism**, for three reasons. (i) It only ever works in a live session, and since 2026-09-01 the company runs almost entirely on headless ticks — so the mechanism would be absent exactly when it is needed. (ii) It couples deployment to one code path; a deploy that only happens if a particular tick reaches a particular step is a deploy that stops happening the first time a tick dies at step 4. (iii) `advance.md` is metawork: employees cannot edit it, so the mechanism's correctness would live in a file this task cannot test. **Polling removes all three** — it is level-triggered, it does not care who merged or how, and it recovers on its own after any crash. A small (b)-shaped *wording* change survives, but only for the honesty half (§9.1), never as the mechanism. |
| **A marker file the merge step writes** (the description's variant of (a)) | The need for the watcher to compute anything. | Rejected: edge-triggered. A marker written by a tick that then dies, or a merge done by a human with `git merge` directly, both leave the marker wrong. The polled predicate needs no cooperation from the merger and is self-correcting. It also costs one file, one write protocol and one more thing to be stale. |
| **`launchctl kickstart` from the watcher** | Nothing the exit path does not also remove. | Rejected: it needs a second binary resolved off a thin PATH, needs the correct `gui/<uid>` domain string, and asks a process to kill itself. `process.exit` + `KeepAlive` is strictly less machinery. |
| **Re-rendering the plist PATH as a prerequisite** | The candidate-list probe (≈15 lines). | Rejected as a *gate*: it makes shipping depend on a host action by the board or a live session, which is the exact dependency this task exists to delete. Kept as optional documentation (§9.2). |
| **Deploy as a Lattice lifecycle stage** | Ambiguity about who deploys. | Rejected per the description, and I agree: deployment is an operational act like the records export, not a status the board should have to read. It has no plan, no review, and no artifact. |
| **Watching the filesystem (fswatch/FSEvents) instead of polling** | The 60 s worst-case latency. | Rejected: the watcher's own header already records FSEvents as unreliable for bind-mount files, and 60 s is far below the human threshold for "did my merge ship". |

### §2.3 What the chosen mechanism removes

- The human from the loop, for both artifacts.
- The `advance.md` dependency for the mechanism (a metawork file this task cannot test).
- The plist edit from the critical path.
- The whole class of "the deploy did not happen because the tick died before step N".
- The `launchctl` invocation and its PATH/domain requirements.

### §2.4 Fallback if AC-8 fails (launchd does not relaunch on exit)

Stop and report to `agent:cto-owen`. Do **not** improvise. The container half of this
plan is independent and can ship alone; the watcher half would then need either the
plist gaining `KeepAlive: {SuccessfulExit: false}` (a host change, board-gated) or a
`launchctl kickstart` spawn (which reintroduces the PATH problem). That is my ruling to
make, not yours.

---

## §3 Design in detail

Everything below lives in **`apps/chat/watch/advance-watcher.mjs`** (pure/injectable
exports at module scope), **`apps/chat/server.js`**, **`apps/chat/Dockerfile`**,
**`apps/chat/public/loop-status.js`**, and their tests.

### §3.1 The image-inputs manifest — and the guard that keeps it honest

The digest must cover exactly what goes into the image. The `Dockerfile` COPYs, in
order: `package.json`, `server.js`, `lib`, `bin`, `public`, `watch`, `test`,
`compose.yaml`, `Dockerfile`.

**Do not use `git rev-parse HEAD:apps/chat`.** `apps/chat/data/export/` is tracked
(18 files) and changes on every records export, so a whole-directory digest would
trigger a rebuild on every chat export — a rebuild loop driven by chat traffic.

Add to the watcher, exported:

```js
export const IMAGE_INPUTS = Object.freeze([
  'package.json', 'server.js', 'lib', 'bin', 'public', 'watch', 'test',
  'compose.yaml', 'Dockerfile',
]);
```

This list is a hand-maintained copy of a fact that lives in the Dockerfile, which is
exactly the kind of copy this company keeps getting burned by. **So it gets a guard**:
extend `apps/chat/test/deploy-shape.test.js` (which already parses the Dockerfile as
data, and exists for precisely this class of bug) with a `COPY`-line parser and assert

```
set(paths COPY'd by the Dockerfile, excluding the destination arg) === set(IMAGE_INPUTS)
```

The parser must **throw** on a `COPY` form it does not recognise (`--from=`, a
glob, a heredoc) rather than skipping it — a skipped line makes the assertion vacuous,
which is the exact trap `deploy-shape.test.js`'s own header warns about. Assert the
parsed cardinality (currently **9** COPY source paths across 6 `COPY` lines) before
comparing sets.

### §3.2 Desired build id (host side, effectful, injectable)

```js
export function parseLsTree(stdout, expectedPaths) // pure
export function makeDeployOps({ repoRoot, run, fetchJson, log, now, ... }) // effects
```

`run(bin, args, opts) -> { code, stdout, stderr }` and `fetchJson(url, timeoutMs)` are
**injected**, so every branch below is unit-testable without git, docker or a network.

Desired id is computed from two `git` calls, both with `cwd: repoRoot`, both using the
absolute `/usr/bin/git` if present else `git` (env override `ADVANCE_GIT_BIN`):

1. `git ls-tree HEAD -- apps/chat/package.json apps/chat/server.js apps/chat/lib apps/chat/bin apps/chat/public apps/chat/watch apps/chat/test apps/chat/compose.yaml apps/chat/Dockerfile`
2. `git status --porcelain -- <the same nine paths>`

Rules — each is a test case:

- **Cardinality first.** `ls-tree` prints one line per existing path. If the line count
  ≠ `IMAGE_INPUTS.length`, return `null` with reason `inputs-missing` and log a WARN.
  A silently-short digest is the vacuous-pass failure mode here: it would be stable,
  wrong, and would stop triggering rebuilds forever.
- **Digest.** `sha256` over the sorted `ls-tree` lines, joined with `\n`; take the
  first 16 hex chars. Sorting makes the id independent of git's output order.
- **Dirty ⇒ refuse.** Non-empty `git status --porcelain` over those paths ⇒ return
  `{ id, dirty: true }` and **never deploy**. "Merged code is live" means *committed*
  code; deploying a dirty tree would bake uncommitted bytes under a label that claims
  to be `HEAD`. This is a refusal, not a failure: log it once per digest change and
  surface it (§3.6).
- **git unavailable / non-zero exit** ⇒ `null`, reason `no-git`, WARN once.

### §3.3 Running build id (what is actually serving)

`Dockerfile`, **after every `COPY`** so the build cache is not invalidated:

```dockerfile
# AS-75: the build id the deployer computed for this image's inputs. Placed
# after every COPY on purpose — an ARG/ENV earlier in the file would invalidate
# the layer cache for every rebuild. `unknown` is the honest value for an image
# built by hand without --build-arg; the watcher treats it as "not current" and
# redeploys once with a real id, which is the self-healing behaviour we want.
ARG BUILD_ID=unknown
ENV CHAT_BUILD_ID=$BUILD_ID
```

`server.js` gains:

```
GET /api/build -> { build: { id: process.env.CHAT_BUILD_ID || null, startedAt } }
```

`startedAt` is the server process start time (captured once at `createChatServer`),
so the endpoint answers both "what code" and "since when". No `me`, no visibility
filter — the same reasoning as `/api/loop-status` (C4).

The watcher reads the **running** id from this endpoint, not from a file the deployer
wrote. A file records intent; the endpoint records reality, and the difference is the
entire subject of this task. Endpoint unreachable, non-200, or 404 (a pre-AS-75 image)
⇒ `running = null` ⇒ treated as not-current ⇒ deploy. `docker compose up -d --build`
is also the correct recovery for "the server is down", so this conflation is
deliberate; the cooldown in §3.4 bounds it.

### §3.4 The decision function (pure — this is the unit under test)

```js
export function decideDeploy({
  desired,              // { id, dirty } | null
  running,              // { id } | null
  watcherSourceChanged, // boolean
  busy,                 // boolean: our own tick child, our own in-flight deploy,
                        //          or ANY fresh advance.lock
  dockerBin,            // absolute path | null
  lastAttempt,          // { id, at: msEpoch, outcome: 'ok'|'fail' } | null
  now, cooldownMs,
}) -> { action: 'noop' | 'deploy' | 'restart-watcher', reason }
```

Rules, in order (the order is the specification — assert it):

| # | Condition | action | reason |
|---|---|---|---|
| 1 | `busy` | `noop` | `busy` |
| 2 | `desired === null` | `noop` | `no-git` |
| 3 | `desired.dirty` | `noop` | `inputs-dirty` |
| 4 | `running && running.id === desired.id` **and** `watcherSourceChanged` | `restart-watcher` | `watcher-source-changed` |
| 5 | `running && running.id === desired.id` | `noop` | `current` |
| 6 | `dockerBin === null` | `noop` | `no-docker` |
| 7 | `lastAttempt.id === desired.id && lastAttempt.outcome === 'fail' && now - lastAttempt.at < cooldownMs` | `noop` | `cooldown` |
| 8 | otherwise | `deploy` | `stale-build` |

Notes the implementer must not "simplify" away:

- **Container before watcher.** When both are stale, rule 8 wins this cycle and rule 4
  fires on a later cycle. One action per evaluation, deterministic, no interleaving.
- **The cooldown only suppresses a repeat of a FAILED attempt at the SAME id.** A new
  merge changes `desired.id` and retries immediately. Default `ADVANCE_DEPLOY_COOLDOWN_MIN=30`.
- **Rule 1 covers a foreign lock**, not just our own child: a `/loop` session mid-tick
  may be writing to the chat API, and rebuilding under it would restart the server
  mid-write. Reuse `readLock()` + `isLockStale` — do not write a second staleness rule
  (`lib/loop-status.js`'s header explains why that copy would drift).

### §3.5 Executing a deploy (effectful, in `makeDeployOps`)

1. **Acquire `advance.lock` with `source: 'deploy'`** via the existing `makeLockOps`
   (add a `source` parameter, defaulting to `'watcher'` so no existing call site
   changes). Real mutual exclusion against loop/manual ticks, using the mechanism
   already in place. Bonus, already correct with no UI change: `describeLoopStatus`
   interpolates the source, so the sidebar reads **`Tick in flight · deploy`** and the
   tone stays `tick`. Verify this in `loop-label.test.js` rather than assuming it.
2. `spawn(dockerBin, ['compose', '--progress', 'quiet', 'up', '-d', '--build', '--build-arg' …])`
   — **careful**: `docker compose up` has **no** `--build-arg`. Pass the build arg
   through the environment instead by declaring it in `compose.yaml`:

   ```yaml
   build:
     context: .
     args:
       BUILD_ID: ${CHAT_BUILD_ID:-unknown}
   ```

   and set `CHAT_BUILD_ID=<desired.id>` in the spawn env. This changes `build: .` to
   the long form — **`deploy-shape.test.js` parses `compose.yaml` with a strict YAML
   subset and will throw on the new nesting.** Teach the parser the shape; do not
   loosen it into shrugging (its header says so explicitly). This is a real, expected
   test change; call it out in your implementation report.
3. Env: `{ PATH, HOME, USER, LOGNAME, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1', CHAT_BUILD_ID }`.
   The two BuildKit toggles are **mandatory** — `compose.yaml`'s own header records
   that the host shell exports the legacy toggles, under which the `platform:
   linux/amd64` pin is ignored at build time and the resulting native image refuses to
   start. Mirror `apps/chat/chat`'s comment.
4. `cwd: join(repoRoot, 'apps', 'chat')`. Output to `logs/deploy-<timestamp>.log`,
   pruned by the existing `pruneTickLogs` (widen it to `deploy-*.log`; keep the same
   14-day retention).
5. Timeout `ADVANCE_DEPLOY_TIMEOUT_MIN` (default 15): SIGTERM, 15 s grace, SIGKILL —
   copy the tick's shape exactly.
6. On exit: release the lock, write `lastAttempt`, and **re-probe `/api/build`** with a
   short retry budget (the container needs a second to come up). Record
   `outcome: 'ok'` only when the re-probed id equals `desired.id`; an exit code of 0
   with a mismatched id is `outcome: 'fail'` with reason `id-mismatch`. **A deploy is
   not "successful" because a command exited 0 — it is successful because the thing
   that is running changed.**
7. Never run two deploys at once (`deploying` flag, mirroring `child`).

### §3.5.1 Restarting the watcher (effectful)

When `decideDeploy` returns `restart-watcher`: log
`RESTART watcher source changed (<old> -> <new>); exiting for launchd relaunch`,
release any lock we hold, **leave `advance-watcher.pid` in place** (do *not* unlink it
the way `shutdown()` does — a deliberate two-second gap where the pid file is absent
would make the board's indicator flash `Off · no watcher` on every watcher update; the
heartbeat going briefly stale is the honest and quieter signal), then `process.exit(70)`.

Non-zero is deliberate: it relaunches under `KeepAlive: true` *and* under
`KeepAlive: {SuccessfulExit: false}`, so the restart does not depend on which semantics
apply. Document that `launchctl print` will show a non-zero `LastExitStatus` after a
self-update and that this is expected, not a crash.

The source digest is `sha256` over the sorted `name\0content` pairs of
`watch/*.mjs` (only `.mjs`: a README or plist-template edit must not restart the
watcher). Captured once at startup, recomputed each deploy-poll. Pure function
`watchSourceDigest(files)`; the shell does the `readdirSync`/`readFileSync`.

### §3.6 Publishing staleness (option (c))

The watcher writes `apps/chat/data/deploy-state.json` (gitignored by
`apps/chat/data/*`) atomically via tmp+rename, on **every** deploy-poll:

```json
{ "desiredId": "…|null", "dirty": false, "reason": "current|stale-build|no-docker|inputs-dirty|no-git|cooldown|busy",
  "dockerBin": "/usr/local/bin/docker|null", "computedAt": "ISO",
  "lastAttempt": { "id": "…", "at": "ISO", "outcome": "ok|fail", "detail": "…" } }
```

`server.js` reads it with the existing `readLoopFile` degradation contract (absent →
`null`; unparsable → `{error}`; **never a throw**) and adds a `build` key to the
`/api/loop-status` payload inside `readLoopStatus()`:

```js
build: { id: CHAT_BUILD_ID || null, desiredId, current: <bool|null>, reason, checkedAt }
```

**`current` is `null`, not `false`, whenever we cannot know** — no `deploy-state.json`,
a stale `computedAt`, or the watcher not listening. An indicator that says "behind"
because the reporter is dead is the same class of confident wrong answer this task was
widened to prevent.

`lib/loop-status.js` (`deriveLoopStatus`) is **not** modified: it stays pure and its
four states are unchanged. The `build` key is composed in `server.js`, exactly as
`lastTick` already is. Add `build.current` + `build.id` + `build.desiredId` to
`loopStateKey` so a staleness change pushes an SSE frame; **do not** add `checkedAt`
(it moves every poll and would emit a frame per poll to every connection forever —
that is the documented reason the age fields are excluded today).

`public/loop-status.js` (`describeLoopStatus`) gains **exactly one** sentence, three
cases:

- `current === true` → nothing (silence is the good case; do not add noise).
- `current === false` → `Live build is behind master (running <id>, master <desiredId>) — <plain-English reason>.`
- `current === null` → `Deploy freshness unknown: <reason>.`

Reason strings get a lookup table beside `WATCHER_REASONS`, same style, written for
the board and naming the remedy where there is one (e.g. `no-docker` →
"the watcher cannot find the docker binary — set ADVANCE_DOCKER_BIN in the launchd plist").

### §3.7 Docker resolution (pure + a thin probe)

```js
export const DOCKER_CANDIDATES = Object.freeze([
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker',
]);
export function resolveDockerBin(env, exists) // -> { bin: string|null, reason }
```

Order: `env.ADVANCE_DOCKER_BIN` (used verbatim if `exists`; if set and missing, return
`null` with reason `override-missing` — **never** silently fall through, a typo in an
override must be loud), then the candidates in order, then `null` with reason
`not-found`. Resolved once at startup and recorded in `deploy-state.json`. `exists` is
injected, so all four branches are unit tests with no filesystem.

### §3.8 Wiring in `main()` — deliberately minimal, and why

`AS-82` (filed 2026-09-03 from Priya's AS-27 review) records that `main()` is never
executed by the suite: deleting the `writeWatcherPid()` call from `poll()` left all 255
tests green. **Every call site inside `main()` is unguarded, and that includes anything
you add.**

I am **not** sequencing AS-82 first. Reasons, so you can check my work rather than
take it on faith: (i) AS-82's own fix direction is open and would itself need planning,
review and a mutation proof — it is a task, not a step; (ii) the architecture below
shrinks the unguarded surface to a size where the live run in AC-3 is adequate cover;
(iii) AS-82 stays medium and lands next in the chat cluster, and it will inherit a
larger, better-shaped `main()` to bring under test if this ships first.

What that obliges **you** to do:

- **Every line of new logic is an export at module scope**, tested directly. `main()`
  gains only: one `resolveDockerBin` call, one `watchSourceDigest` capture, one
  `makeDeployOps({...})` construction, one `setInterval`, one `deploying` gate in
  `poll()`, and the `deployOps.evaluate()` call. Target ≤ 12 unguarded lines. Follow
  the `makeLockOps` precedent (AS-13 lifted the lock ops out of `main()` for exactly
  this reason) — `makeDeployOps` is its twin.
- **State the unguarded set explicitly in your implementation report**, line by line.
  A reviewer must be able to check that list against the diff rather than re-derive it.
- AC-3's observed live run is the only evidence that the wiring is connected. Do not
  claim otherwise, and do not let a green suite stand in for it.

---

## §4 Key files

| File | Change |
|---|---|
| `apps/chat/watch/advance-watcher.mjs` | New exports: `IMAGE_INPUTS`, `DOCKER_CANDIDATES`, `resolveDockerBin`, `parseLsTree`, `watchSourceDigest`, `decideDeploy`, `makeDeployOps`. `makeLockOps` gains a `source` param (default `'watcher'`). `loadConfig` gains `deployPollS`, `deployTimeoutMin`, `deployCooldownMin`, `dockerBin`, `gitBin`. `pruneTickLogs` widens to `deploy-*.log`. `main()` wiring per §3.8. |
| `apps/chat/Dockerfile` | `ARG BUILD_ID` / `ENV CHAT_BUILD_ID`, after every `COPY`. |
| `apps/chat/compose.yaml` | `build:` long form with `args: { BUILD_ID: ${CHAT_BUILD_ID:-unknown} }`. |
| `apps/chat/server.js` | `GET /api/build`; `DEPLOY_STATE_PATH` read via `readLoopFile`; `build` key in `readLoopStatus()`; three fields added to `loopStateKey`. |
| `apps/chat/public/loop-status.js` | One sentence, three cases; a `BUILD_REASONS` table. |
| `apps/chat/test/watcher.test.js` | Unit tests for every new export + the mutation proofs. |
| `apps/chat/test/deploy-shape.test.js` | `COPY` parser + `IMAGE_INPUTS` equality; compose parser taught the long `build:` form. |
| `apps/chat/test/api.test.js` | `/api/build`; `build` key in `/api/loop-status`; `build.current === null` degradation. |
| `apps/chat/test/loop-label.test.js` | The three build sentences; `Tick in flight · deploy`. |
| `apps/chat/watch/README.md` | New files table rows, the self-restart contract, the docker-resolution rules, the non-zero `LastExitStatus` note. |
| `apps/chat/README.md` | "You no longer rebuild by hand" + how to tell when it did not happen. |

**Do not touch**: `apps/chat/lib/loop-status.js` (pure, unchanged), `.worktrees/AS-45`,
`.worktrees/AS-27`, anything under `apps/invoicing/`, and any top-level markdown file
(§9).

**Literals that move** — state each one's before/after in your implementation report;
a moved literal nobody mentioned is a finding: the chat test count (currently **255**),
`deploy-shape.test.js`'s service list, and the `parseComposeServices` shape assertions.

---

## §5 Acceptance criteria

Numbered, so the reviewer can cite them. Per the standing rule this list is a **floor**,
not the review.

1. `decideDeploy` is pure — no `fs`, no clock, no process — and every one of the 8 rules
   in §3.4 has at least one test, including the ordering property that rule 4 beats
   rule 5 and rule 8 beats rule 4 when both are eligible.
2. `resolveDockerBin` has a test for each of: override present, override set-but-missing
   (→ `null`, reason `override-missing`, **not** fall-through), first candidate, none found.
3. `parseLsTree` returns `null` with reason `inputs-missing` when the line count ≠
   `IMAGE_INPUTS.length`, and the digest is invariant under reordered `ls-tree` output.
4. `GET /api/build` returns the baked `CHAT_BUILD_ID`, and `unknown`/absent is reported
   as such rather than as a valid id.
5. `/api/loop-status` carries `build`, with `current === null` (not `false`) for each of:
   missing `deploy-state.json`, unparsable `deploy-state.json`, watcher not listening.
   A malformed `deploy-state.json` does not throw and does not change `state`.
6. `describeLoopStatus` emits exactly one build sentence, distinct per case, empty when
   `current === true`; and a `source: 'deploy'` lock renders `Tick in flight · deploy`.
7. `deploy-shape.test.js` asserts `IMAGE_INPUTS` equals the Dockerfile's COPY set, with
   the parsed COPY-path cardinality asserted first, and throws on an unrecognised COPY form.
8. **The self-restart assumption is proven live** (§2, Finding 3): with the watcher
   running under launchd, touch a `watch/*.mjs` file so the digest changes, observe the
   log line, observe the process exit, and observe a **new pid** in
   `advance-watcher.pid` with a fresh `heartbeatAt` within 30 s. Record both pids. If
   launchd does not relaunch, **stop and report** (§2.4).
9. **One observed end-to-end run, no human command**: from a state where the container
   is running a stale image, the watcher rebuilds it unattended, and afterwards
   `GET /api/build` reports the id the watcher computed, `/api/loop-status`'s
   `build.current` is `true`, and the sidebar's build sentence is gone. Record the
   before/after ids, the `deploy-*.log` filename, and the elapsed time.
10. A deploy never runs while a tick is running: a fresh foreign `advance.lock` yields
    `noop/busy` (unit), and the deploy takes `advance.lock` with `source: 'deploy'` for
    the duration (unit, via `makeLockOps`).
11. A dirty `apps/chat` image-input tree yields `noop/inputs-dirty` and no spawn.
12. A failed deploy is not recorded as `ok`: exit code 0 with a mismatched re-probed id
    records `outcome: 'fail'`, reason `id-mismatch`.
13. Zero new dependencies (`package.json` unchanged; the watcher stays `node:*` builtins
    only). Zero files touched outside `apps/chat/`. Zero `.lattice/` paths in the branch
    diff. No top-level markdown file modified.
14. The full suite is green in the sanctioned runner
    (`DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test`),
    and the new test count is stated against the current 255.
15. Every guard in §6 has been **proven by breaking it**, with the observed failing-test
    set recorded exactly.

---

## §6 Falsification recipes — prove each guard by breaking it

House rule, and it is not optional: **a checker that has only ever been seen passing
has proven nothing.** This company has logged more than ten vacuous passes where a
green guard was examining an empty set or a neighbouring file. Before you report, run
every recipe below.

Method, in this order, every time: prefer a **scratch copy** (`git archive <sha>` into
your own scratchpad subdirectory) — never mutate the task worktree to falsify a
checker. Where an in-place mutation is unavoidable: back up, `trap` the restore on
`EXIT`, mutate, **assert the mutation applied** (`grep -c` going 0 → 1; an unapplied
mutation is indistinguishable from a passing checker, and a BSD-vs-GNU `sed` address
has "passed" a check this way here before), observe, let the trap restore, prove the
tree with `git diff --exit-code`, then **rebuild and re-run** (a restored tree with a
stale mutant image produced phantom failures here once already). Report **cardinality
before quantification**: how many cases were examined, then how many passed.

| # | Mutation | Must turn RED |
|---|---|---|
| R1 | Delete the last `COPY` line's path from `IMAGE_INPUTS` | `deploy-shape.test.js` COPY-set equality |
| R2 | Add a `COPY docs ./docs` line to the Dockerfile | same test (the guard must catch a *new* input, not only a removed one) |
| R3 | Change a `COPY` to `COPY --from=builder x ./x` | the COPY parser **throws** (it must not shrug) |
| R4 | Reorder rules 4 and 5 in `decideDeploy` | the ordering test |
| R5 | Make `resolveDockerBin` fall through on a missing override | AC-2's override-missing case |
| R6 | Drop the cardinality check in `parseLsTree` and feed it 8 of 9 paths | AC-3's `inputs-missing` case |
| R7 | Return `current: false` instead of `null` when `deploy-state.json` is absent | AC-5 |
| R8 | Record `outcome: 'ok'` on exit code 0 without re-probing | AC-12 |
| R9 | Remove `busy` (rule 1) | AC-10's foreign-lock case |
| R10 | Add `checkedAt` to `loopStateKey` | the existing AS-27 frame-count test in `api.test.js` (it counts frames over ten polls — confirm it actually goes red; if it does not, say so, because that is a finding about *that* test) |

For each: record the exact failing test names and the count. **A wider or narrower
failing set than expected is itself a finding** — report it rather than adjusting the
expectation.

**Docker hygiene** (Ruben's AS-45 standard, adopt it): use your own isolated compose
project name for any throwaway build; never touch `asc-chat-server-1` (8347) or
`asc-invoicing-web-1` (8348) except in the AC-9 run, which is *about* 8347; publish no
new host ports; remove every image you build; no global prune.

---

## §7 Risks and open questions, each with a default

| # | Risk | Default / mitigation | Deadline |
|---|---|---|---|
| Q1 | launchd does not relaunch on exit (AC-8 fails) | Stop and report; §2.4. Do not improvise. | at AC-8 |
| Q2 | A `/loop` session holds the lock nearly continuously, so the deploy never gets a window | Accept. A loop releases between ticks (`advance.md` step 6) and the poll is level-triggered, so it lands in the first gap. Note it in the README. | ship |
| Q3 | A long emulated build blocks tick firing for minutes | Accept and make it visible: the sidebar reads `Tick in flight · deploy` for the duration. README records ~1 s when cached. Revisit only if an observed deploy exceeds 5 min. | ship |
| Q4 | New watcher code crashes at startup → launchd crash-loops → no watcher | Accept: the AS-27 indicator reports `Off · no watcher`, which is the honest signal and exactly what it was built for. Record it as a known failure mode in `watch/README.md`, with `logs/launchd.err.log` named as the first stop. | ship |
| Q5 | The deploy restarts the server under an open SSE client | Already handled: AS-25 clients reconnect natively and the DB is on the bind mount. Confirm once during AC-9 rather than assuming. | AC-9 |
| Q6 | `docker compose up -d --build` also starting `cli`/`test` | It does not — both are behind the `tools` profile. Assert it once in `deploy-shape.test.js` while you are in there. | ship |

---

## §8 Size

Estimated ~450–600 changed lines (watcher ~200, server ~40, client ~30, tests ~250,
docs ~60). Under the 900-line split line. **Pre-agreed split trigger**: if
`git diff --stat master...feat/AS-75-deploy-gap` exceeds **900 changed lines** at the
moment the container half (§3.1–§3.6, minus the watcher self-restart) is complete and
green, stop, land that half, and file the watcher self-restart (§3.5.1) as its own
task. The seam is clean — the two artifacts are independent — and setting the line in
advance is the point, so it is not decided under pressure.

---

## §9 Proposed metawork wording — RECORD ONLY, DO NOT APPLY

`CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, `agents.md` and `.claude/commands/advance.md`
are owned by the metawork layer. **Employees never edit them.** The exact wording is
recorded here for the orchestrator or the board to apply, amend, or reject. Nothing
below is a decision, and nothing in this task depends on it landing.

### §9.1 `.claude/commands/advance.md` — the honesty half only

Append to step 1's merge sentence, after `move to \`done\``:

> — then, if the merge touched `apps/chat/` image inputs, read
> `apps/chat/data/deploy-state.json`: the watcher deploys within ~60 s on its own
> (AS-75), so say nothing when `dockerBin` is non-null and the watcher heartbeat is
> fresh. If either is false, tell the board in the merge reply that the chat deploy
> will **not** happen unattended and name the reason from that file.

Deliberately not a deploy step: the mechanism is the watcher's, and a step that
duplicates it would deploy twice or claim a deploy that did not happen.

### §9.2 `CLAUDE.md` — replace the "Known residual" paragraph

Current text (in "Operating Modes: Chat vs. Loop") begins *"Known residual (not a
blocker): the `./apps/chat/chat` wrapper shells out to `docker`, which is not on PATH
in the headless tick environment."* Proposed replacement for that first sentence:

> **Known residual (narrowed by AS-75, 2026-09-04):** the `./apps/chat/chat` wrapper
> shells out to `docker`, which is not on PATH in the headless tick environment, so a
> tick still cannot run chat CLI commands or rebuild the container itself. It no longer
> needs to: **the host watcher deploys `apps/chat` on its own** — it resolves the docker
> binary by absolute path (`ADVANCE_DOCKER_BIN`, else a candidate list) rather than via
> PATH, rebuilds when master's image-input digest differs from the id the running
> container reports at `/api/build`, and restarts *itself* by exiting for launchd to
> relaunch when its own source changes. Merged chat code goes live unattended within
> ~60 s. When it cannot act (no docker binary, dirty tree, watcher down) it says so in
> `apps/chat/data/deploy-state.json` and the chat sidebar's build line. The rest of the
> paragraph below still holds.

### §9.3 Root `README.md`

If a Status section names the chat deploy as manual, it should say the chat app
self-deploys from master as of AS-75. Exact wording is the orchestrator's call — the
fact to convey is: *merged `apps/chat` code goes live unattended; the sidebar says so
when it has not.*

---

## §10 What to hand the reviewer

Your implementation report states, in this order: the unguarded `main()` lines (§3.8),
the literals that moved with before/after (§4), the R1–R10 results with exact failing
test names and counts, the AC-8 pids, and the AC-9 before/after build ids with elapsed
time. **Findings first, sweep second** — never the acceptance-criteria pass rate on its
own, and never without the adjacent count of anything you found *outside* the list.
