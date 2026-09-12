# AS-92 — the tick child inherits what the watcher already knows: docker and gh directories on the child PATH

Planner: agent:cto-owen, 2026-09-11 (second lane beside the AS-87 review; ~15-minute planning box). Type: bug, Chat set, critical. Branch `feat/AS-92-tick-path-prepend`, worktree `.worktrees/AS-92`, cut from master `0337a54` (host baseline **530/530/0**, measured this tick with `node --test` in `apps/chat`).

## 0. Facts established at planning time

0.1 `tickChildEnv()` (`advance-watcher.mjs:279–292`) is pure and passes `env.PATH` through verbatim; the spawn site (`:2365–2373`, inside `makeWatcher.fire()`) calls it with `process.env`. The five-key set `{PATH, HOME, USER, LOGNAME, ADVANCE_TICK_PARENT}` is pinned by `test/watcher.test.js:341–383` (AS-14) and the spawn call site is pinned by `test/watcher-main.test.js:355–372` (AS-82: `deepEqual(call.opts.env, tickChildEnv(process.env, WATCHER_PID, nonce))`).

0.2 The watcher already resolves docker by absolute path for its own deploys — `DOCKER_CANDIDATES` + `resolveDockerBin(env, exists)` (`:375–398`, AS-75, `ADVANCE_DOCKER_BIN` override that refuses to fall through when missing). Nothing resolves `gh`; nothing hands either directory to the tick.

0.3 On this host today: docker is `/usr/local/bin/docker`; gh is `/opt/homebrew/bin/gh` (Homebrew symlink into the Cellar). Neither `/usr/local/bin/gh` nor `/opt/homebrew/bin/docker` exists. The permission allowlist (`.claude/settings.json`) carries `Bash(docker *)`, `Bash(gh pr *)`, `Bash(gh auth status)` — bare names, which is what a tick must use once the directories are on PATH.

0.4 The installed plist was hand-edited 2026-09-08 (AS-92 comment 1) to `…:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`, and a headless tick (`watcher:17217`, 2026-09-09, comment 2) ran `docker compose run` and `gh auth status` on the strength of it. **That is the plist route working, and it is the observed-green half of the description's VERIFICATION clause.** It proves nothing about the watcher, and it regresses silently the day the plist is re-rendered from the template (`README.md:302` still renders the four-directory PATH; the template comment at `plist.template:7–9` still says "node and claude").

0.5 `launchctl kickstart -k` does not re-read the plist (comment 1, learned the hard way); a plist edit needs `bootout` + `bootstrap`. The README already says so under "Uninstall / restart" (`:315–321`) and in Permission modes (`:489`), but not in the Install section or the `__PATH__` troubleshooting entry (`:515–516`), which is where someone editing PATH reads.

0.6 Test-file geography, for the seam ruling in §7: AS-87 appends to `watcher.test.js` after `:1377` and touches `watch/README.md` at `:232`; AS-88 (plan `task_01M1SJDVWABEGHB6Q61T1FZ0WJ.md` §7) edits `runDockerCompose`, `makeDeployOps`, `performDeploy`, the `makeDeployOps({...})` wiring at `:2650–2669`, `deployHarness` in `watcher.test.js:839`, `watcher-main.test.js` (one appended test), and README `:272–280` (insert before, and the "Env knobs:" line) and `:323–337`.

## 1. Scope

**In:** the tick child's PATH is computed by the watcher from what the watcher can resolve — the directory of the resolved docker binary, the directory of a resolved `gh` binary (new resolver, same shape as docker's), and an operator knob `ADVANCE_TICK_PATH_EXTRA` — deterministically, de-duplicated, and only for directories the plist PATH does not already carry. The pinned env-set test is edited in the same commit. The plist template comment and the README (prerequisites, install `sed`, troubleshooting) say which directories `__PATH__` must contain and that a PATH edit needs `bootout` + `bootstrap`. A `TICK-PATH` log line per fire says what was added, what was already present, and what could not be resolved — the observability the live check reads.

**Out, with rulings on the four comments:**
- **Comment 3 (Ruben's recurrence note — "the `--allowedTools` grant set must also match the absolute docker path"): out of scope, and not needed.** The description excludes allowlist widening explicitly; `.claude/settings.json` is metawork-owned (CLAUDE.md, applied from live sessions); and once the directory is on PATH the bare name is what a tick types and `Bash(docker *)` matches it — comment 2 observed exactly that. The 2026-09-11 recurrence (`watcher:17217:95e1c0c2…`) happened with the fat plist in place and both forms denied, which means the tick was reaching for the absolute path — the live criterion AC-9 below uses bare names deliberately, and the tick procedure's guidance to use `/usr/local/bin/docker` via `spawnSync` for sub-agents (CLAUDE.md "Headless ticks: run lanes as FOREGROUND…") should be revisited by the orchestrator once this lands: with PATH correct, `docker` by name is the allowlisted form. Recorded here; not this task's edit (CLAUDE.md is metawork).
- **Comment 4 (chat CLI refused when the message body arrives via `"$(cat file)"`): separate concern, not this task.** It is the harness's command-substitution permission heuristic, not PATH — no watcher change can reach it, and the raw-API fallback (`node -e` + `fetch`) is already the documented workaround in CLAUDE.md. Ruling: accepted with the workaround, observed once; per the recurring-observation rule it becomes its own task (`Chat:` set, low) on a second observation. Not filed now.
- The operational plist edit (comment 1) is history, not a deliverable (description item 3).
- Anything about what ticks do with docker or gh once they have them; the compose-receipt procedure; `tickArgv`.

## 2. Approach (code) — all in `apps/chat/watch/advance-watcher.mjs`

2.1 **`GH_CANDIDATES` and `resolveGhBin(env, exists)`**, inserted directly after `resolveDockerBin` (after `:398`, before `resolveGitBin` at `:400`):
```js
export const GH_CANDIDATES = Object.freeze(['/opt/homebrew/bin/gh', '/usr/local/bin/gh']);
export function resolveGhBin(env, exists) { /* ADVANCE_GH_BIN override; override-missing never falls through; candidates in order; not-found */ }
```
Same return shape as docker's: `{ bin, reason: 'override'|'candidate'|'override-missing'|'not-found' }`. Homebrew first because that is where gh lives on an Apple-silicon Mac and `/usr/local/bin` is docker's home, not gh's (0.3).

2.2 **`tickPathPrepend(env, exists)`**, same insertion block, pure over its two inputs:
```js
// -> { add: string[], present: string[], unresolved: string[] }
```
- Candidates, in this order: every entry of `env.ADVANCE_TICK_PATH_EXTRA` split on `:` (trimmed, empties dropped — the operator's explicit list goes first), then `dirname(resolveDockerBin(env, exists).bin)`, then `dirname(resolveGhBin(env, exists).bin)`. A resolver that returns `null` contributes nothing to the list and its name+reason goes to `unresolved` (`'docker:not-found'`, `'gh:override-missing'`). Extra entries are never existence-checked (they are directories the operator named, not binaries) and never appear in `unresolved`.
- De-duplicate preserving first occurrence.
- Partition against `(env.PATH ?? '').split(':')`: a directory already on PATH goes to `present`, the rest to `add`, order preserved. **Presence is the property this bug is about; the order of a directory the plist already carries is the plist's business** — the watcher does not reorder the operator's PATH.

2.3 **`tickChildEnv(env, watcherPid, nonce, pathPrepend = [])`** — fourth argument, defaulted so every existing caller and test is unchanged:
```js
PATH: pathPrepend.length === 0 ? env.PATH : [...pathPrepend, ...(env.PATH ? [env.PATH] : [])].join(':'),
```
Empty prepend ⇒ `env.PATH` byte-for-byte, including `undefined` staying `undefined` (the launchd thin-env case the AS-14 pin covers). Non-empty ⇒ the prepend directories, then the untouched original as a suffix. The key set stays exactly five; the comment above the function gains one sentence naming AS-92.

2.4 **`makeWatcher` gains two injections**, `env = process.env` and `exists = existsSync`, added to the destructured options (`:2207–2224`) and the JSDoc list (`:2204`). The spawn site (`:2365–2373`) becomes:
```js
const tickPath = tickPathPrepend(env, exists);
log(`TICK-PATH add ${fmt(tickPath.add)} present ${fmt(tickPath.present)} unresolved ${fmt(tickPath.unresolved)}`); // fmt: comma-joined, or '-' when empty
const proc = spawnFn(config.claudeBin, tickArgv(...), { cwd: config.repoRoot, env: tickChildEnv(env, pid, nonce, tickPath.add), stdio: [...] });
```
Resolved **per fire**, not once at `start()`: two `existsSync` calls per tick is nothing, and a `gh` installed after the watcher started is picked up by the next tick without a restart (the AS-21 settings-reload argument, applied to binaries). The PATH line in the spawn-site comment block (`:2332`) is rewritten to say "the plist sets it; AS-92 prepends the docker/gh directories the watcher resolved and `ADVANCE_TICK_PATH_EXTRA`".

2.5 Nothing else in the file changes. `tickArgv`, `loadPermissionRules`, `resolveDockerBin`, `DOCKER_CANDIDATES`, the deploy code, `settle()`: untouched.

## 3. Approach (prose)

3.1 **`com.american-software.advance-watcher.plist.template`** header comment, lines 7–9, becomes: `__PATH__` is the PATH for the watcher AND its claude child; it must contain the directories holding `node` and `claude`, and should contain those holding `docker` and `gh` (`/usr/local/bin`, `/opt/homebrew/bin`) — the watcher prepends the docker/gh directories it can resolve itself (AS-92), so a thin PATH degrades to "what the watcher found", not to a broken tick. The optional-overrides comment (`:38–42`) gains `ADVANCE_GH_BIN` and `ADVANCE_TICK_PATH_EXTRA=<dir:dir>`.

3.2 **`watch/README.md`** — three hunks, none touching AS-87's (`:232`) or AS-88's (`:272–280`, `:323–337`) lines:
- Prerequisites (`:288`): `command -v node claude docker gh` — "all four should resolve; note the directories for `__PATH__`. docker and gh are optional at install: the watcher prepends whatever it resolves (AS-92), but a plist that names them is the honest configuration."
- Install (`:302`): the `sed` renders `__PATH__` as `$(dirname "$NODE_BIN"):$(dirname "$(command -v claude)"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`. New short paragraph after the code block (before `:311`): what the watcher adds on top and why (0.1–0.4 in two sentences), the `TICK-PATH` log line and how to read it, the two knobs, and: **a PATH edit to an installed plist takes effect only after `bootout` + `bootstrap` — `kickstart -k` relaunches on the old environment** (0.5, cite the 2026-09-08 pid 16931 relaunch).
- Troubleshooting (`:515–516`): the `spawn error` entry adds `docker`/`gh` "command not found" inside a tick as a sibling symptom, points at the `TICK-PATH` line of that fire in `advance-watcher.log`, and repeats the bootout/bootstrap rule in one clause.
- **Not touched:** the "Env knobs:" line (`:278–280`) — AS-88 appends to it; the two new knobs are documented in the Install paragraph and the plist comment instead, so the two branches cannot conflict there.

## 4. Tests (seven new, one edited)

All in `apps/chat/test/`. New tests go **immediately after the AS-14 pin** (`watcher.test.js:383`, before the AS-20 argv pin) — away from AS-87's append at `:1377+` and AS-88's harness edit at `:839`.

| # | File | Test |
|---|---|---|
| T1 | `watcher.test.js` (edit) | AS-14 pin: unchanged assertions (empty prepend ⇒ byte-identical `PATH`, five keys), plus one `deepEqual` with `pathPrepend: ['/usr/local/bin', '/opt/homebrew/bin']` showing `PATH: '/usr/local/bin:/opt/homebrew/bin:/opt/bin:/usr/bin'` and the same five keys. |
| T2 | `watcher.test.js` | `AS-92 tickPathPrepend: a thin PATH gains the docker and gh directories, docker first` — env `{PATH: '/Users/x/.nvm/versions/node/v24.13.1/bin:/Users/x/.local/bin:/usr/bin:/bin'}` (the 2026-09-07 string), `exists` true for exactly `/usr/local/bin/docker` and `/opt/homebrew/bin/gh` ⇒ `add: ['/usr/local/bin','/opt/homebrew/bin']`, `present: []`, `unresolved: []`. |
| T3 | `watcher.test.js` | `AS-92 tickPathPrepend: directories already on PATH are reported present, never repeated, and PATH is not reordered` — the fat 2026-09-08 PATH ⇒ `add: []`, `present: [both]`; and `tickChildEnv(env, 1, NONCE, add).PATH === env.PATH`. |
| T4 | `watcher.test.js` | `AS-92 tickPathPrepend: ADVANCE_TICK_PATH_EXTRA goes first, splits on ':', drops empties, de-duplicates` — `ADVANCE_TICK_PATH_EXTRA=':/opt/tools::/usr/local/bin:'` with docker at `/usr/local/bin` ⇒ `add: ['/opt/tools','/usr/local/bin', …gh dir]` (docker's dir once, in the extra position). |
| T5 | `watcher.test.js` | `AS-92 tickPathPrepend / tickChildEnv: nothing resolvable passes PATH through verbatim` — `exists: () => false`, no extra ⇒ `add: []`, `unresolved: ['docker:not-found','gh:not-found']`; `tickChildEnv({}, 1, NONCE, []).PATH === undefined` (not `''`, not `'undefined'`); with `ADVANCE_DOCKER_BIN=/nope` ⇒ `unresolved` carries `docker:override-missing` and `add` has no docker dir. |
| T6 | `watcher.test.js` | `AS-92 resolveGhBin: override, override-missing (no fall-through), candidates in order, not-found; GH_CANDIDATES pinned` — mirrors the AS-75 `resolveDockerBin` test; pins `GH_CANDIDATES` to the exact two-element array. |
| T7 | `watcher-main.test.js` | `AS-92 makeWatcher: fire() spawns the tick with the prepended PATH and logs TICK-PATH` — harness gains `env` and `exists` injections (defaults: `env: process.env`, `exists: () => false`, so the AS-82 test at `:355` keeps passing **unchanged** — with an empty prepend the 4-arg call equals the 3-arg one). This test injects the thin PATH + an `exists` that finds both binaries, asserts `call.opts.env.PATH` starts with `/usr/local/bin:/opt/homebrew/bin:` and ends with the thin PATH, that the other four keys equal the injected env's, and that a log line matches `/^TICK-PATH add \/usr\/local\/bin,\/opt\/homebrew\/bin present - unresolved -$/`. |
| T8 | `watcher-process.test.js` | `AS-92 real process: a child given the thin PATH plus the watcher's prepend can run docker and gh; without the prepend it cannot` — host-only, **counted skip** (`t.skip`) when `resolveDockerBin(process.env, existsSync).bin` or `resolveGhBin(…)` is null (the compose container has neither). Spawns `process.execPath -e` twice with `env = tickChildEnv({PATH:'/usr/bin:/bin', HOME, USER, LOGNAME}, 1, NONCE, add)`: the child runs `spawnSync('docker',['--version'])` and `spawnSync('gh',['--version'])` (client-only, no daemon) and exits 0 iff both status 0. Negative control first: the same child with `pathPrepend: []` must exit non-zero (`ENOENT`). Positive: with `tickPathPrepend(thinEnv, existsSync).add` it exits 0. **This is the process-level proof that the watcher's prepend, not the plist, is what makes a thin-PATH tick work** — the live check in AC-9 cannot show that any more because the plist is already fat (0.4). |

Delta: **+7 host** (T2–T8; T1 is an edit). Compose: **+6 pass, +1 skipped** (T8). Stated relative to the **measured** baseline of whatever master the branch sits on at review time: 530 today ⇒ 537/537/0 host, 537/536/1 compose; 535 after AS-87 ⇒ 542; 543 after AS-88 ⇒ 550. The implementer records the baseline from `node --test` in the worktree before the first change and reports the delta against that number — the AS-88 "537" prediction is a different base and a coincidence, not a target.

## 5. Acceptance criteria (M4: each property names its falsifier; met by an observed red, never by argument)

Mutants run on a scratch `git archive` copy, asserted applied **at the intended site** (anchor: the enclosing function name in the pattern; grep-count transition), restored, tree proven clean with `git diff --exit-code`, then rebuilt before any compose number is quoted.

| # | Criterion | Falsifier (mutant, anchored) | Predicted exact red set |
|---|---|---|---|
| AC-1 | A thin PATH gains the resolved docker directory and the resolved gh directory, docker before gh. | **M1**: in `tickPathPrepend`, delete the docker `dirname` push. **M2**: delete the gh `dirname` push. | M1 → {T2, T4 (docker's dir missing from `add`), T7, T8 (docker ENOENT in the positive run)}. M2 → {T2, T7, T8}. Two runs, two sets recorded; a wider or narrower set is a finding. |
| AC-2 | A directory already on PATH is reported `present` and not repeated; the original PATH is the untouched suffix. | **M3**: in `tickPathPrepend`, remove the partition against `env.PATH` (everything goes to `add`). | M3 → {T3} only (T7's thin PATH contains neither dir, so it stays green — say so). |
| AC-3 | `ADVANCE_TICK_PATH_EXTRA` entries come first, split on `:`, empties dropped, de-duplicated against each other and against the resolved dirs. | **M4**: delete the `ADVANCE_TICK_PATH_EXTRA` read. **M5**: delete the de-duplication step. | M4 → {T4}. M5 → {T4} (docker's dir appears twice). Same red set from two mutants is expected and must be stated, not hidden. |
| AC-4 | Nothing resolvable ⇒ `PATH` passes through verbatim: `undefined` stays `undefined`; the key set is exactly five. | **M6**: in `tickChildEnv`, make the join unconditional (`[...pathPrepend, env.PATH ?? ''].join(':')`). | M6 → {T5} (T1's five-key/verbatim assertions stay green because `'/opt/bin:/usr/bin'` joins to itself — the `undefined` case is the only witness, which is why T5 asserts it). |
| AC-5 | `resolveGhBin`: `ADVANCE_GH_BIN` that does not exist returns `override-missing` and never falls through; candidates tried in `GH_CANDIDATES` order. | **M7**: in `resolveGhBin`, replace the override-missing return with fall-through to the candidate loop. | M7 → {T6}. |
| AC-6 | The production spawn site passes the computed prepend and logs `TICK-PATH`. | **M8**: at the spawn site, drop the fourth argument (`tickChildEnv(env, pid, nonce)`). **M9**: delete the `TICK-PATH` log line. | M8 → {T7} — and **the AS-82 pin at `watcher-main.test.js:355` stays green under M8 by construction** (empty prepend ⇒ identical env), which is the reason T7 exists; record both facts. M9 → {T7}. |
| AC-7 | Process-level proof: with the 2026-09-07-shaped thin PATH, a child cannot run `docker`/`gh` without the prepend and can with it (T8, host). | Covered by M1/M2 (T8 in their red sets); the negative control inside T8 is the falsifier for "the test would pass without the prepend" — if the negative control ever passes, T8 fails. | Reported in AC-1's runs. On the compose run T8 is **1 skipped**, counted. |
| AC-8 | Prose (§3): each claim re-derived by the reviewer independently — the four-directory render (`git show master:apps/chat/watch/README.md:302`), the kickstart-vs-bootout fact (AS-92 comment 1; `launchctl` man page), the candidate paths (`DOCKER_CANDIDATES`/`GH_CANDIDATES`), the log-line format (T7). A claim that fails re-derivation is a finding against the prose, not a pass. | — | — |
| AC-9 | **Live**: after merge and the watcher's self-restart on the new source, a headless tick runs `docker version` and `gh auth status` **by bare name** successfully; the reviewer or the merging tick records the tick id and quotes that fire's `TICK-PATH` line from `advance-watcher.log`. With today's fat plist the honest expectation is `add - present /usr/local/bin,/opt/homebrew/bin unresolved -` — the resolver found both and judged them present. That line is the watcher-side evidence; the prepend mechanism itself is proven by T8/AC-7, not by this tick. State both plainly in the record. | — (a live observation; the falsifier is a tick whose log has no `TICK-PATH` line or whose bare-name `docker version` is refused) | — |
| AC-10 | Conventions: commits `AS-92: <imperative>` as `developer-marcus`; zero `.lattice/` paths on the branch; no top-level markdown touched; `package.json` unchanged; `git merge-tree` against master clean at review time. | — | — |
| AC-11 | Cardinality before pass rate: host `node --test` N/N/0 with N = baseline + 7 (§4, against the **measured** baseline); compose `docker compose -p asc-review-as92 run --build --rm test` from the worktree's `apps/chat` with the `Image … Built` line quoted, N = baseline + 7 with exactly 1 skipped (T8) beyond whatever the base skips. No build line, no valid number. | — | — |

**Mutant count: 9** (M1–M9). Reviewer probes past the list (M6 rule); candidates I would try and have deliberately not tested for the implementer: `ADVANCE_TICK_PATH_EXTRA` containing a relative path or `~` (the watcher must not expand it — it is passed through, and the README should say "absolute directories"); a docker override pointing at a *directory* rather than a file (`existsSync` is true — is `dirname` then the parent, and is that wrong? probably acceptable, but say which); `env.PATH` with a trailing `:` (empty entry) — does `present` partitioning treat `''` sanely; and whether `TICK-PATH` is logged **before** the spawn so a spawn error still leaves the line (it should — the line is the diagnostic for exactly that failure).

## 6. Live-verification recipe (AC-9)

1. Merge lands on master; the watcher's self-restart (AS-75 digest over `watch/*.mjs`) relaunches it within `ADVANCE_DEPLOY_POLL_S` — confirm a new `START` line and pid in `advance-watcher.log`.
2. Next board message fires a tick. In that tick, the orchestrator (not a sub-agent) runs `docker version` and `gh auth status` by bare name via the Bash tool and quotes the first line of each in its report.
3. From `advance-watcher.log`, quote the `TICK-PATH …` line for that `FIRE`, with the tick id (`watcher:<pid>:<nonce>`).
4. Record all three on AS-92 as a comment. If the tick cannot see `docker` by bare name **and** the `TICK-PATH` line shows `add -` / `present …`, the plist route is doing the work and the fix is inert on this host — not a failure, but AC-9 then rests on T8 alone and the comment must say so.

## 7. Seams — file scope and disjointness ruling

**Files AS-92 touches:** `apps/chat/watch/advance-watcher.mjs`, `apps/chat/watch/com.american-software.advance-watcher.plist.template`, `apps/chat/watch/README.md`, `apps/chat/test/watcher.test.js`, `apps/chat/test/watcher-main.test.js`, `apps/chat/test/watcher-process.test.js`. Nothing else.

**`advance-watcher.mjs` hunks, by master line:** (a) `:273–292` `tickChildEnv` + its comment; (b) insertion after `:398` (new `GH_CANDIDATES`, `resolveGhBin`, `tickPathPrepend`); (c) `:2204` JSDoc and `:2207–2224` `makeWatcher` options (`env`, `exists`); (d) `:2328–2373` spawn-site comment, `TICK-PATH` log, `tickChildEnv(env, pid, nonce, add)`.
- **AS-87** (in review) edits `:412` (the ls-tree doc comment — ten lines below my insertion at `:398`; three-way merge context does not overlap), `:734`, `:852`, `:964`, `:1035`, `:1088–1098`. **Disjoint.**
- **AS-88** (planned, gated on the AS-87 merge) edits `runDockerCompose`, `makeDeployOps`, `performDeploy`, the `makeDeployOps({...})` wiring `:2650–2669` and its comment `:2643–2649`. My (c) ends at `:2224`, my (d) ends at `:2373`. **Disjoint.**
- Tests: AS-87 appends `watcher.test.js` after `:1377`; AS-88 edits `deployHarness` `:839` and appends to `watcher-main.test.js`. AS-92 edits `watcher.test.js:341–383` and inserts after it; edits the `watcherHarness` factory in `watcher-main.test.js` (`:68–120`, two defaulted injections) and appends one test; appends to `watcher-process.test.js`. AS-84 added git-probe code in `watcher-process.test.js` — merged, on master, no live branch. **Disjoint** from both, though `watcher-main.test.js` will carry one appended test from each of AS-88 and AS-92: two appends at the same end-of-file conflict textually if both are unmerged when the second rebases. Rule below covers it.
- README: AS-87 `:232`; AS-88 before `:278`, the `:278–280` line, `:323–337`; AS-92 `:284–289`, `:300–309` (+ a paragraph after), `:515–516`. **Disjoint**, by construction (§3.2's "not touched" rule).

**Merge order: none required.** AS-92 may merge before or after either sibling. Rebase rule: the AS-92 branch rebases onto master at the start of the review stage if master has moved (AS-87 will have merged by then in the likely case), the implementer re-measures the host baseline after the rebase, and the reported delta is against the re-measured number. The only foreseeable textual conflict is the end-of-file append in `watcher-main.test.js` if AS-88 lands first — resolution is "keep both tests, either order". No shared line is edited by two branches.

## 8. Key files

- `apps/chat/watch/advance-watcher.mjs` — §2.
- `apps/chat/watch/com.american-software.advance-watcher.plist.template` — §3.1.
- `apps/chat/watch/README.md` — §3.2.
- `apps/chat/test/watcher.test.js` — T1–T6.
- `apps/chat/test/watcher-main.test.js` — harness injections, T7.
- `apps/chat/test/watcher-process.test.js` — T8.

## 9. People, size, branch

- **Implementer: `developer-marcus`.** Lena is reserved for AS-88 (its plan §9; her branch waits on the AS-87 merge). Marcus's AS-87 is in review under Priya, so he is free unless rework returns; he is also the author of the spawn-site lineage this task extends (AS-14 env pin, AS-20/AS-21 argv, AS-82 `makeWatcher` and its call-site test), so the pins he must edit are his own. If AS-87 rework arrives while he is mid-AS-92, the orchestrator sequences the two in ticks — one agent per task per tick — and AS-92 resumes from its branch; commit early, keep a progress note in `scratchpad/agent-developer-marcus/`.
- **Reviewer: `qa-ruben`.** Priya holds AS-87 now and is named on AS-88 next; Ruben is free after the AS-84 cycle-3 pass. He is also one of the two who observed the bug on AS-45 cycle 4 and the author of comment 3 — the plan overrules his allowlist note in §1, and I want the person who held that belief to be the one who tests whether bare-name `docker` is really enough (AC-9). That is a prior, not an anchor: he has seen no implementation and no numbers. Priya is the fallback if Ruben is on the AS-87 rework.
- **Complexity: low.** Roughly 60 lines of production code (two resolvers, one partition, two injections, one log line), seven tests, three prose hunks. One implementation tick, one review tick.
- **Branch `feat/AS-92-tick-path-prepend`, worktree `.worktrees/AS-92`, created this tick from master `0337a54`** — no seam blocks it (§7).

## 10. Open questions (time-boxed; defaults apply when the box expires)

- Should `tickPathPrepend` also carry the directory of the resolved `git` (`resolveGitBin`)? Default **no**: `/usr/bin` is on every plist PATH ever rendered and `git` was never observed missing. Record only.
- Should the `TICK-PATH` line also be emitted as an AS-100 company event? Default **no** for this task — it is per-fire diagnostics, and the events stream is stage-level state; the log line is what the README points at. If the foreman view wants it later, that is an AS-103-shaped ephemeral frame, not a persisted event.
- Once this lands, does the CLAUDE.md guidance to reach docker via `spawnSync('/usr/local/bin/docker', …)` for sub-agents still hold? Default: the orchestrator tests bare-name `docker` from a sub-agent in the first tick after the merge and, if it works, records the simplification as metawork. Not this task's edit.
