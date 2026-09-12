# AS-88 — AS-75 F7/F8: the bootstrap rule, and a deploy that names its compose target

Planner: agent:cto-owen, 2026-09-11 (tick watcher:92536 loop tick 4; ~25-minute planning box). Parent: AS-75. Source: Ruben's AS-75 review comment (2026-09-05), findings F7 and F8; his proposed wording is the base for every README paragraph below, corrected for what has changed since and for one factual error I measured (§0.1). Siblings that touch the same code and the same README section: AS-84 (in review, head e551a18) and AS-87 (planned). Agreed merge order **AS-84 → AS-87 → AS-88**; this plan is written against post-AS-87 master (§7).

## 0. Facts established at planning time (each one is cited, not remembered)

0.1 **Compose project-name precedence, measured** against the real `apps/chat/compose.yaml`, Docker Compose v5.3.0, via `docker compose config` (no daemon needed; recipe in §5 AC-10 so the reviewer can repeat it):

| invocation | resolved `name:` |
|---|---|
| default | `asc-chat` |
| `COMPOSE_PROJECT_NAME=foo` | `foo` |
| `-p bar` | `bar` |
| `COMPOSE_PROJECT_NAME=foo` **and** `-p bar` | `bar` |
| `COMPOSE_PROJECT_NAME=` (empty) | `asc-chat` |

So Ruben's sentence "`name: asc-chat` in compose.yaml always wins" is **false as a compose fact** (`-p` > env > `name:` > directory) and **true as a watcher fact**, for two reasons that are both in our code: `runDockerCompose` (`advance-watcher.mjs:697–700`) passes no `-p`, and `performDeploy` (`:897–905`) builds a seven-key environment that does not include `COMPOSE_PROJECT_NAME`. The README must state the cause, not the folklore — a reader who believes `name:` beats `-p` will mis-isolate a hand `docker compose` run next. Empty string counts as unset; the guard in §3 mirrors that.

0.2 **The scrub already has a falsifier.** `test/watcher.test.js:934` pins the deploy env key set to exactly `['CHAT_BUILD_ID','COMPOSE_DOCKER_CLI_BUILD','DOCKER_BUILDKIT','HOME','LOGNAME','PATH','USER']`. AS-88 names it as the falsifier for the prose claim "`COMPOSE_PROJECT_NAME` is scrubbed" rather than writing a second one (§5 AC-6).

0.3 **The F7 bootstrap has happened.** AS-75 merged 2026-09-07 (a0cfb0b); the one-time `kickstart -k` was asked of the board the same day (AS-75 comment "MERGED", dafec10); the first unattended live deploy was observed the same evening (31a934e, AC-9 on the live stack); the first unattended **self-restart** was observed end to end 2026-09-11 (5d7c5f8, pid 67350 → 93997, loop state intact). Ruben's wording "at the moment AS-75 merges, someone must…" is therefore a past-tense instruction.

0.4 **The self-restart digest covers `watch/*.mjs` only** (`readWatchSources`, `:655–659`). The plist template, its rendered copy under `~/Library/LaunchAgents/`, every `ADVANCE_*` knob (they live in the plist), the compose file, and both READMEs are outside it.

0.5 **`watch/README.md` § "After any change to this watcher: restart it" (`:297–311`) is now wrong** in its first sentence ("editing this file changes nothing until it is restarted") and in its remedy ("a host action for the board or a live session") — since AS-75 a `watch/*.mjs` change on master restarts the watcher unattended. It still describes a real symptom (a watcher on old code, `Off · no watcher`), so it is rewritten, not deleted.

0.6 **`makeWatcher` exposes the deploy ops it built** (`ops().deploy`, `:2467`), and `main()` passes nothing deploy-specific to it (`:2508–2514`), so a production-wiring criterion can be a real test rather than a source grep (§5 AC-8).

0.7 **The AS-84 fake docker ignores its argv** (`watcher-process.test.js:123–133` on the branch: records `$$`, traps, sleeps), so an added `-p <name>` token cannot change those real-process tests. AS-87's argv pin (its AC-6, exact list) **will** change; AS-88 edits it (§7).

## 1. Scope

**F7 — not moot; rewritten.** The instruction is stale but the rule that produced it is durable and recurs: *a deploy mechanism cannot deploy the first version of itself, and any change that alters what the mechanism is — rather than what it deploys — is installed by the old copy, so it needs a hand once if the old copy cannot do it.* F7 becomes (a) one sentence of history with dates, (b) that rule, (c) the **current** list of what still needs a hand (derived from 0.4), and (d) the rewrite of the stale §297 section (0.5). Dropping F7 as moot would leave §297 contradicting AS-75 and leave the next mechanism change (a plist knob, a renamed compose project) to rediscover the rule the expensive way. Keeping Ruben's wording verbatim would tell the reader to run a bootstrap that already ran. Neither is acceptable; the rewrite is ~12 lines.

**F8 — guard *and* prose.** Two small production changes in `advance-watcher.mjs`, both of the "explicit, or refuse" kind, plus the README paragraphs. Weighed honestly in §2.

**Non-goals, with reasons:**
- No `COMPOSE_PROJECT_NAME` pass-through in `performDeploy`'s env allowlist. This overrules AS-87 §8's default ("add it, harmless when unset") — amended there this tick. A pass-through makes an environment variable a silent steering input of the production deploy, which is precisely what the scrub exists to exclude; AS-87's scratch project has no `name:` and is isolated by the explicit `composeProject` this task adds (§7).
- No heuristic that tries to recognise "a scratch copy" from `appDir`/`repoRoot`. Ruben's copy was a whole-tree copy, so `appDir === join(repoRoot,'apps','chat')` held there too; there is no observable that separates it from production. Say so in the README; do not pretend a guard covers it.
- No env knob for the compose project (`ADVANCE_COMPOSE_PROJECT` or similar). Same reason as the first non-goal; the project is a constructor argument, chosen in code by whoever constructs the ops.
- No new key in `deploy-state.json` (the `:1089` key-set pin and AS-87 AC-9 both say the key set is frozen). The project name goes in the `DEPLOY building …` log line instead.
- No change to `apps/chat/chat` (the wrapper), to the scrub's key set, to `decideDeploy`, or to the AS-84 shutdown/abort shape.

## 2. Guard or prose — the weighing

Ruben's acceptance: "prefer a guard over prose if one is cheap." The orchestrator's tasking asks whether *any* production change is worth it on a documentation task. My answer is yes, for a narrow guard, and here is the reasoning rather than the conclusion.

What the prose-only option removes: nothing mechanical. It relies on the next person who drives the real `makeDeployOps` having read a paragraph in a 500-line runbook. The person it already bit was the reviewer of the feature — the most careful reader that code will ever have — and he was bitten before the paragraph existed but *would have been bitten by a hand `docker compose` run just the same* (0.1: the compose file names the live stack from any directory). Prose is necessary; it is not sufficient.

What the guard option removes: the two silent paths from a test harness to the live stack.
1. **The forgotten path** — a harness constructs `makeDeployOps` without thinking about the project at all. Removed by making `composeProject` a **required** constructor argument (no default): the omission is a throw before any `docker` spawns. `makeWatcher` supplies `PRODUCTION_COMPOSE_PROJECT`; every harness must choose.
2. **The expressed-but-discarded path** — Ruben's exact case: the harness *did* express isolation, through `COMPOSE_PROJECT_NAME`, and the scrub threw it away. Removed by **refusing at construction** when a non-empty `COMPOSE_PROJECT_NAME` in the ops' env differs from `composeProject`. Honouring it (pass-through) was the alternative; refusal wins because it keeps the env out of the deploy's inputs and forces the intent into the one place it is visible — the call site, which is exactly what F8 complained was invisible.

And `runDockerCompose` always passes `-p <composeProject>`, so the target is explicit in argv and in the log line, and `composeProject` actually *does* something for a scratch harness (without `-p` the option would be documentation).

Cost: ~15 lines of production code across three functions AS-84/AS-87 just touched (§7 has the exact seams), eight tests, one edited pin. Behaviour change in production: none — `-p asc-chat` against a file whose `name:` is `asc-chat` resolves identically (0.1, row 3 with `bar` := `asc-chat`), and the refusal cannot fire under launchd unless someone puts `COMPOSE_PROJECT_NAME` in the plist, in which case a crash-loop with the reason in `logs/launchd.err.log` is the README's already-accepted honest signal.

Residual the guard does not cover, stated in the README: a hand `docker compose up` in a copied tree, and a harness that passes `composeProject: 'asc-chat'` on purpose. Both are the operator saying what they mean; no guard should second-guess that.

Default answer if the orchestrator or the board disagrees with the production change: land the README paragraphs (§4) alone, and file the guard as its own small task with §3/§5 as its plan. I would rather not — it splits one finding across two records — but the prose is independently correct under either outcome.

## 3. Approach (code)

All in `apps/chat/watch/advance-watcher.mjs`, on top of post-AS-87 master.

3.1 `export const PRODUCTION_COMPOSE_PROJECT = 'asc-chat';` next to `IMAGE_INPUTS` (the other compose-shape constant `deploy-shape.test.js` pins).

3.2 `runDockerCompose({ dockerBin, cwd, env, logPath, timeoutMs, log, composeProject, spawnFn, createLog, onSpawn })`:
- First line: `if (typeof composeProject !== 'string' || composeProject.trim() === '') throw new Error('runDockerCompose: composeProject is required — the deploy names its compose project explicitly (AS-88)');` — before `createLog`, so a refused call opens no log file and spawns nothing.
- argv becomes `['compose', '-p', composeProject, '--progress', 'plain', 'up', '-d', '--build']` (`plain` is AS-87's; `-p` goes first because compose's global flags precede the subcommand).
- Nothing else changes: AS-84's `onSpawn` and log-stream `'error'` listener, the timeout shape, the pipe wiring all stay.

3.3 `makeDeployOps({ …, composeProject })`:
- No default. At the top of the factory, after `resolveDockerBin`:
  ```js
  if (typeof composeProject !== 'string' || composeProject.trim() === '') {
    throw new Error('makeDeployOps: composeProject is required (production passes PRODUCTION_COMPOSE_PROJECT; a test harness passes its own scratch project) — AS-88');
  }
  const envIntent = (env.COMPOSE_PROJECT_NAME ?? '').trim();
  if (envIntent !== '' && envIntent !== composeProject) {
    throw new Error(
      `makeDeployOps: COMPOSE_PROJECT_NAME=${envIntent} is set but the deploy scrubs its environment and would target '${composeProject}'; ` +
      `pass composeProject: '${envIntent}' explicitly or unset the variable (AS-88, AS-75 review F8)`,
    );
  }
  ```
  Empty/whitespace is "unset" (0.1 last row); equal is fine (an operator exporting the production name is not expressing a different intent).
- `performDeploy` passes `composeProject` into `deploy({...})` and the log line becomes `` `DEPLOY building ${desiredId} (project ${composeProject}) -> ${logPath}` ``.
- The returned object gains `composeProject` (beside `dockerBin`, `gitBin`) for assertions.

3.4 `makeWatcher`: the `makeDeployOps({...})` wiring at `:2392` gains `composeProject: PRODUCTION_COMPOSE_PROJECT,`. Update the adjacent comment's "these six lines" count to seven — that comment is a reviewer's checklist and must stay true.

3.5 Tests (eight new, one edited; file placement in §5):
- `watcher.test.js`, AS-75 `makeDeployOps` block: `deployHarness` (`:839`) gains `composeProject: 'asc-test'` so the existing ~15 harness tests keep constructing (they never reach a real compose). New tests per AC-2/3/4/7 below.
- `watcher.test.js` (or wherever AS-87 put its AC-6 argv pin — find it by the `'--progress', 'plain'` literal): the exact-list pin gains `'-p', <project>`; a second new test passes a custom project and asserts it appears in argv, so "dropped `-p`" and "hard-coded `asc-chat`" are distinguishable mutants.
- `deploy-shape.test.js`: beside the existing `assert.match(COMPOSE, /^name: asc-chat$/m)` (`:267`), assert the parsed `name:` value `=== PRODUCTION_COMPOSE_PROJECT`.
- `watcher-main.test.js`: one test that builds `makeWatcher` **without** injecting deploy ops (env with an unresolvable docker so no deploy can fire), calls `start()`, asserts `ops().deploy.composeProject === PRODUCTION_COMPOSE_PROJECT`, then `shutdown()`.
- AS-87's opt-in real-build test (`watcher-deploy-real.test.js`, skipped unless `AS87_REAL_BUILD=1`): it now **must** pass `composeProject: <its scratch project name>` — after AS-88 a `makeDeployOps` without one throws, and a harness that passed `'asc-chat'` would run `docker compose -p asc-chat up` on a foreign compose file inside the live project. This is the guard doing its job on our own test; note it in the implementation comment.

## 4. README edits — exact sections and wording

Ruben's two paragraphs are the base; corrections are marked in the text of this section only, not in the README. The implementer may tighten sentences but must not drop a claim, because every claim below is tied to an AC-10 verification.

### 4.1 `apps/chat/watch/README.md`

**(a) § "AS-75: the watcher also deploys, and restarts itself"** — insert two paragraphs **after** the "Known limit (accepted)" paragraph and **before** the "Env knobs:" line. (AS-84 inserted its shutdown paragraph earlier in the section, after the refusal table; AS-87 adds a table row. Neither touches this insertion point.)

> **The deploy names its target and scrubs its environment (AS-88).** `performDeploy` hands `docker compose` a seven-variable environment — `PATH`, `HOME`, `USER`, `LOGNAME`, `DOCKER_BUILDKIT`, `COMPOSE_DOCKER_CLI_BUILD`, `CHAT_BUILD_ID` — and nothing else (`test/watcher.test.js` pins the set), so the rebuild cannot be steered by whatever the watcher's own environment contains. One consequence is a trap: `COMPOSE_PROJECT_NAME` is scrubbed with the rest, so exporting it does **not** isolate a run of this code — compose never sees it, and `compose.yaml`'s `name: asc-chat` decides the project. Compose itself honours `-p`, then `COMPOSE_PROJECT_NAME`, then `name:` (measured against this file, Compose v5.3.0); the variable loses *here* only because the deploy drops it. That is how a harness run of the real `makeDeployOps` against a scratch copy of this tree recreated the **live** `asc-chat-server-1` from the copy — without the port map or the `/repo` mount — and took 8347 down until someone rebuilt from master (AS-75 review, F8). Two things now make that loud instead of silent. The project is an explicit argument: `runDockerCompose` always passes `-p <composeProject>`, `makeDeployOps({ composeProject })` **requires** it (the watcher passes `PRODUCTION_COMPOSE_PROJECT`, `'asc-chat'`, pinned to `compose.yaml` by `test/deploy-shape.test.js`), and the `DEPLOY building …` log line names it. And an intent the scrub would discard is refused: if `COMPOSE_PROJECT_NAME` is set to anything other than `composeProject` when `makeDeployOps` is constructed, construction throws — in a test, before any `docker` is spawned; under launchd, a crash-loop with the reason in `logs/launchd.err.log`, which is the accepted honest signal for bad watcher config. There is deliberately no env knob for the project: an environment variable is exactly the steering the scrub exists to exclude. **To exercise the deploy against a scratch stack, pass `composeProject: '<scratch-name>'` and a scratch `compose.yaml` that publishes no host port.** What no guard covers, because nothing observable distinguishes it: a copied tree run by hand with `docker compose up` and `name: asc-chat` intact is the live stack, wherever the copy lives — pass `-p` or edit the copy's `name:`.

> **Bootstrapping, once — and the rule behind it.** A deploy mechanism cannot deploy the first version of itself. When AS-75 merged (2026-09-07) the running watcher had no deploy poll and the running container answered 404 at `/api/build`, so a human ran `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up -d --build` in `apps/chat` and `launchctl kickstart -k gui/$(id -u)/com.american-software.advance-watcher`, one time. The first unattended deploy was observed that evening and the first unattended self-restart on 2026-09-11 (AS-75 and AS-82 records). That is history; the rule recurs: **a change that alters what this mechanism *is* — rather than what it deploys — is installed by the old copy of the mechanism, and needs a hand once if the old copy cannot do it.** The self-restart covers `watch/*.mjs` only (`readWatchSources`), so the hand list today is: the plist template and its rendered copy under `~/Library/LaunchAgents/` (every `ADVANCE_*` knob lives there — re-render, `bootout`, `bootstrap`, § below); `compose.yaml`'s `name:` or port map (a renamed project is a *second* stack beside the old one, not a replacement — `down` the old one first); and a watcher that crash-loops on its own new code (launchd keeps trying; fix master and it heals). The self-restart also assumes launchd: a watcher started by hand exits 70 when its source changes and **nothing relaunches it**.

**(b) § "### After any change to this watcher: restart it"** (`:297–311`) — replace heading and body with:

> ### After any change to this watcher
>
> Since AS-75 the watcher restarts itself: a change to any `watch/*.mjs` on master is noticed by the running process within `ADVANCE_DEPLOY_POLL_S` and it exits 70 for launchd to relaunch on the new code (§ "AS-75", *the self-restart contract*). Restart it by hand only for what the source digest does not cover — the plist and its env knobs — with `bootout` then `bootstrap` (§ "Uninstall / restart"), or `launchctl kickstart -k gui/$(id -u)/com.american-software.advance-watcher` when the rendered plist is unchanged. That is a host action for the board or a live session; a headless tick has no `launchctl` reach.
>
> History, kept because the symptom recurs: before AS-75 every watcher change needed that hand restart, and AS-27's indicator made the omission visible — a watcher on pre-AS-27 code writes no `heartbeatAt` into `advance-watcher.pid`, so the sidebar read `Off · no watcher` while ticks were firing. The same shape today means the running watcher is on old code: check `launchctl print … | grep LastExitStatus` and `logs/launchd.err.log` before assuming the indicator is wrong. `pid` and `startedAt` keep their meaning; the single-instance check reads `pid` only.

**(c) "Env knobs:" line** — append the clause: `. There is no knob for the compose project (see AS-88 above).`

### 4.2 `apps/chat/README.md`

**(a) § "### AS-75: you no longer rebuild this by hand"** — append one paragraph at the end (after "…has the build output of each attempt."):

> **Exercising the deploy path yourself.** The watcher's rebuild is built to be immune to its environment: it scrubs everything but seven variables before spawning `docker compose`, and `COMPOSE_PROJECT_NAME` is among the scrubbed — so exporting it does not point a test run at a different stack; `compose.yaml`'s `name: asc-chat` does, and that is the live server. Since AS-88 the project is a required argument (`makeDeployOps({ composeProject })`, always passed to compose as `-p`), and a `COMPOSE_PROJECT_NAME` that disagrees with it is refused at construction rather than silently dropped. A hand `docker compose up` in a *copied* tree has the same property and no guard: unless you pass `-p` or edit the copy's `name:`, you are rebuilding `asc-chat-server-1` from the copy. The rule for bootstrapping the mechanism itself (it cannot deploy its own first version; the one-time bootstrap after AS-75 happened 2026-09-07) and the current list of changes that still need a hand are in `watch/README.md` § "the watcher also deploys".

**(b) § "## Tests (in-container, no mounts)"** — append one paragraph at the end:

> Nothing in the suite spawns a real `docker`: every test that drives `makeDeployOps` injects `deploy`, and the one opt-in real-build test (AS-87, `AS87_REAL_BUILD=1`) builds a scratch project whose `compose.yaml` has no `name:` and passes its own `composeProject`. If you write a test that reaches the real `runDockerCompose`, you must pass `composeProject` (both it and `makeDeployOps` throw without one) — the deploy scrubs `COMPOSE_PROJECT_NAME`, so the variable is not isolation, and this directory's compose file names the live stack (AS-88; `watch/README.md`).

## 5. Acceptance criteria (M4: each property names its falsifier; met by an observed red, never by argument)

Host baseline: **post-AS-87 master**, recorded by the implementer from `node --test` in the worktree before the first change (AS-84's cycle-2 host run was 522 on its branch; AS-87 predicts +7 → 529; AS-88 predicts **+8** → 537. Report deltas against the measured baseline, not against these predictions). All eight new tests are docker-free, so the compose count moves by the same +8; the skipped set is unchanged from post-AS-87 (AS-84's git-dependent real-process tests + AS-87's opt-in file).

| # | Criterion | Falsifier (mutant, anchored to the site) | Must go red |
|---|---|---|---|
| AC-1 | `runDockerCompose` argv is exactly `['compose','-p',composeProject,'--progress','plain','up','-d','--build']`, with the caller's project, not a literal. | M1: delete `'-p', composeProject` from the argv array. M1b: replace `composeProject` in argv with the literal `'asc-chat'`. | M1 → AS-87's argv pin (edited to the new exact list) **and** new `AS-88 runDockerCompose names the caller's project` (custom `'asc-scratch-1'`, spawnFn fake captures argv). M1b → the new test only. Two reds recorded. |
| AC-2 | `runDockerCompose` without a non-empty `composeProject` throws before opening the log or spawning. | M2: delete the guard at the top of `runDockerCompose`. | new `AS-88 runDockerCompose refuses an implicit project` (spawnFn and createLog fakes assert zero calls; `assert.throws(/composeProject is required/)`). |
| AC-3 | `performDeploy` passes `composeProject` through to `deploy(opts)` and logs `project <name>`. | M3: hard-code `composeProject: 'asc-chat'` in the `deploy({...})` call inside `performDeploy` (anchor: the object that also carries `logPath`). | new `AS-88 performDeploy passes composeProject through` (harness with `composeProject: 'asc-scratch-1'`; `calls.deploy[0].composeProject === 'asc-scratch-1'`; a log line matches `/DEPLOY building .* \(project asc-scratch-1\)/`). |
| **AC-4 (F8 headline)** | `makeDeployOps` **throws** when `env.COMPOSE_PROJECT_NAME` is non-empty and `!== composeProject`; the message names both values and says `pass composeProject`. **The concrete input is Ruben's:** `env: { …, COMPOSE_PROJECT_NAME: 'asc-scratch-1' }` with `composeProject: 'asc-chat'` → the violation is the throw, observed before any `deploy` call. | M4: delete the `envIntent` block in `makeDeployOps`. | new `AS-88 makeDeployOps refuses a COMPOSE_PROJECT_NAME the scrub would discard` (`assert.throws` with `/COMPOSE_PROJECT_NAME=asc-scratch-1/`, `/'asc-chat'/`, `/pass composeProject/`; `calls.deploy.length === 0`). |
| AC-5 | The refusal is not over-broad: unset, `''`, `'  '`, and an equal value all construct normally; `COMPOSE_PROJECT_NAME='asc-scratch-1'` with `composeProject: 'asc-scratch-1'` constructs normally. | M5: change the condition to `envIntent !== ''` (drop the equality clause) — anchor on the `envIntent !== composeProject` literal. | new `AS-88 makeDeployOps accepts an agreeing or empty COMPOSE_PROJECT_NAME` (five constructions, none throw). |
| AC-6 | The deploy env key set is still exactly the seven keys — **no** `COMPOSE_PROJECT_NAME` pass-through (overrules AS-87 §8's default). | M6: add `COMPOSE_PROJECT_NAME: env.COMPOSE_PROJECT_NAME` to the allowlist object in `performDeploy`. | **existing** `watcher.test.js:934` key-set pin (no new test — AS-88 names the falsifier that already exists; the run is still required and recorded). |
| AC-7 | `makeDeployOps` without a non-empty `composeProject` throws at construction (no default). | M7: give the destructured `composeProject` a default of `PRODUCTION_COMPOSE_PROJECT`. | new `AS-88 makeDeployOps requires composeProject` (`assert.throws(/composeProject is required/)`). |
| AC-8 | Production wiring passes `PRODUCTION_COMPOSE_PROJECT`: `makeWatcher` built without injected deploy ops exposes `ops().deploy.composeProject === 'asc-chat'`. | M8: delete the `composeProject:` line from the `makeDeployOps({...})` call in `makeWatcher`. | new `AS-88 makeWatcher deploys to the production project` in `watcher-main.test.js` (with M8, `start()` throws AC-7's error — red). |
| AC-9 | `PRODUCTION_COMPOSE_PROJECT` equals the `name:` in `compose.yaml`. | M9: change the constant to `'asc-chat2'`. | new assertion in `deploy-shape.test.js` beside `:267` (and AC-8's test, which compares to the literal — record both). |
| AC-10 | **Prose criteria** (README §4.1a/b/c, §4.2a/b). Each factual claim is re-derived by the reviewer, independently of this plan's §0: (i) the seven-key set → run the `:934` pin and read its list; (ii) the precedence sentence → repeat the `docker compose config` matrix (`node -e` + `spawnSync('/usr/local/bin/docker', ['compose', …, 'config'])` in `apps/chat` with `env` limited to `PATH`/`HOME` plus the variable under test; read the `name:` line) and get `asc-chat` / `foo` / `bar` / `bar` / `asc-chat`; (iii) "`-p` always" → AC-1; (iv) the refusal → AC-4; (v) the bootstrap dates → `lattice show AS-75` / `AS-82` commit lines; (vi) "`watch/*.mjs` only" → `readWatchSources`; (vii) exit 70 with no launchd → `restartWatcher` (`exit(70)`) and the absence of any launchd check in it. A claim the reviewer cannot re-derive is a finding against the prose, not a pass. | — (prose; the falsifier is a claim that fails re-derivation) | — |
| AC-11 | Conventions: commits `AS-88: <imperative>` as `developer-lena`; zero `.lattice/` paths on the branch; no top-level markdown touched; `package.json` unchanged. | — | — |
| AC-12 | AS-84's real-process tests (`watcher-process.test.js`) pass unchanged on the host with `-p` in argv (0.7); AS-87's opt-in real-build test passes with `AS87_REAL_BUILD=1 ADVANCE_DOCKER_BIN=/usr/local/bin/docker` **if** the reviewer chooses to run it (optional — it builds a real image; record the run either way). | — | — |
| AC-13 | Full host suite green; compose suite green **with `--build`** and the `Image … Built` line quoted; cardinality before pass rate (CLAUDE.md compose-receipt rule). | — | — |

Mutant count: 10 named (M1, M1b, M2–M9). Every mutant is run on a scratch `git archive` copy, asserted applied at the intended site (grep-count transition on an anchor that can only match there — §3 names the anchors), then restored and the tree proven clean. Reviewer probes past the list (M6 rule); candidates I would try: `COMPOSE_PROJECT_NAME` set to the production name with a *different* `composeProject` (should refuse — it is a disagreement); a `composeProject` with a space or a leading `-` (compose will reject it, and `runDockerCompose` should not have opened a log first); whether the AS-84 `abort()` path still records `aborted` with `-p` present; and whether the README's "under launchd, a crash-loop" claim is actually what `makeWatcher`'s `start()` does with a thrown `makeDeployOps` (does it propagate to `main()` and exit non-zero, or is it swallowed?). That last one may be a real finding — if `start()` catches it, the refusal is silent in production and the paragraph is wrong; the reviewer should read `start()` and say which.

## 6. Compose receipt

Every counted run: `docker compose -p asc-review-as88 run --build --rm test` from the worktree's `apps/chat`, absolute docker path via `node -e` + `spawnSync` for sub-agents; void without the `Image … Built` line. Report host N and compose N with the skipped count stated (expected: unchanged from post-AS-87 master).

## 7. Seams — what AS-88 assumes is on master, and where it rebases

**Assumed on master before implementation starts** (do not branch earlier):
- AS-84 (merge pending its cycle-2 review): `runDockerCompose` has `onSpawn` and the log-stream `'error'` listener; `performDeploy(desiredId, stateFields)` persists `started` before spawn; `abort()`/`deployChild`/`abortSignal` exist; `watch/README.md` has the shutdown paragraph and `error` table row after the refusal table.
- AS-87: argv is `--progress plain`; `evaluate()` heartbeats while deploying; the `deploying` table row; `watcher-deploy-real.test.js` exists (opt-in); an exact argv pin test exists (its AC-6).

**Exact overlap sites** (the implementer rebases here; nobody else should be editing them once AS-87 has merged):
1. `runDockerCompose` signature and argv line — AS-84 (onSpawn) → AS-87 (`plain`) → AS-88 (`composeProject`, `-p`). One line, three tasks, sequential.
2. `makeDeployOps` destructured options — AS-88 adds `composeProject` (no default). Put it after `lockOps` so the diff is additive.
3. `performDeploy`'s `deploy({...})` object — AS-84 added `onSpawn`; AS-88 adds `composeProject`.
4. `makeWatcher`'s `makeDeployOps({...})` call and its "six lines" comment.
5. `watch/README.md` § AS-75 — AS-84 inserted after the table; AS-87 adds a row; AS-88 inserts after "Known limit (accepted)". Disjoint hunks in one section.
6. AS-87's argv pin test — **AS-88 edits it** (exact list gains `-p`). This is the one test another task owns that this task changes; say so in the implementation comment.
7. AS-87's opt-in real-build test — gains `composeProject: <scratch name>` (§3.5).
8. `deployHarness` in `watcher.test.js` — gains `composeProject: 'asc-test'`; AS-84 and AS-87 both added tests that use the harness and will keep passing.

**AS-87 §8 amended this tick** (same planner): its default "add a `COMPOSE_PROJECT_NAME` pass-through" is withdrawn in favour of this plan's non-goal; its scratch project has no `name:` and is isolated by directory name until AS-88 lands, and by `composeProject` after.

**If the orchestrator wants Lena's idle capacity before AS-87 merges:** she may branch from post-AS-84 master and rebase over AS-87 later; sites 1, 6 and 7 are the conflicts she will hit, and site 6 is the one where the resolution is "keep AS-87's test, add `-p`". Default is to wait: two rebases on one argv line for a task this size is more risk than the idle time is worth.

## 8. Key files

- `apps/chat/watch/advance-watcher.mjs` — `PRODUCTION_COMPOSE_PROJECT`, `runDockerCompose` (guard + argv), `makeDeployOps` (required option, refusal, pass-through, log line, returned field), `makeWatcher` wiring + comment.
- `apps/chat/test/watcher.test.js` — harness option; AC-1/2/3/4/5/7 tests; AC-6 existing pin (run, not edited).
- `apps/chat/test/watcher-main.test.js` — AC-8.
- `apps/chat/test/deploy-shape.test.js` — AC-9.
- `apps/chat/test/watcher-deploy-real.test.js` (AS-87's) — `composeProject` added.
- `apps/chat/watch/README.md` — §4.1 a/b/c.
- `apps/chat/README.md` — §4.2 a/b.

## 9. People, size, branch

- **Implementer: `developer-lena`.** Free now (AS-89 merged); Marcus is carrying AS-84's rework and is named on AS-87. Lena implemented AS-75 itself, so the scrub and `runDockerCompose` are hers originally — the right hands for a change to their contract.
- **Reviewer: `qa-priya`.** Ruben filed F7/F8 and wrote the base wording; a reviewer checking prose he authored is anchored on his own text (the AS-36 class of failure, through the record rather than the prompt). Priya comes cold. She is also AS-87's reviewer, which is fine sequentially and gives her the argv seam in recent memory. The M6 probe list in §5 is hers to extend, not to copy.
- **Complexity: low-medium.** One implementation tick, one review tick. The code is ~15 lines and eight small tests; the prose is the larger half and the AC-10 re-derivation is where the review time goes.
- **Branch slug: `feat/AS-88-deploy-names-its-project`.** Worktree `.worktrees/AS-88`, created by the orchestrator after this plan lands, from master **after the AS-87 merge**.

## 10. Open questions (time-boxed; defaults apply when the box expires)

- Should the refusal in `makeDeployOps` also fire on `COMPOSE_FILE` or `COMPOSE_PROJECT_DIRECTORY` in the env (same scrub, same class of discarded intent)? Default **no** for this task — F8 is about the project name; widening the refusal to every scrubbed `COMPOSE_*` variable is a design choice for a follow-up if anyone is ever bitten by it. Record only.
- Does a thrown `makeDeployOps` inside `makeWatcher.start()` actually take the process down under launchd (the README paragraph asserts a crash-loop)? Default: the reviewer answers it in AC-10(vii)/the M6 probe; if `start()` swallows it, the implementer changes the README sentence to what is true and files nothing new — the guard still protects tests, which is the scenario that bit.
