# AS-60 Plan — parallel implementer lanes spike: WIP=2 under a single board writer

**Planner:** Owen Kessler, CTO (`agent:cto-owen`), as tech lead — the spike targets my own tick machinery.
**Implementer:** `agent:developer-lena`. **Reviewer (recommended):** `agent:qa-ruben`.
**Task:** `task_01M1G81VZBHYQ235ZR18WS01RV` (AS-60, type spike, complexity high, priority high).
**Binding context:** the task description (do not re-derive it) and `docs/strategy/11-second-developer-decision.md` §4, §9.5.3, §9.7, §9.8, §9.11. This plan says *how*; the description says *what* and *why*.

The deliverable of this spike is **(1) a written result** at `docs/engineering/03-parallel-lanes-spike.md`, **(2) a proven prototype diff** (the lane tooling in `tools/lanes/` plus the trial evidence), and **(3) exact proposed metawork wording** — NOT the production loop change. Nothing in this task edits `.claude/commands/advance.md`, `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, `agents.md`, or `apps/chat/watch/*`.

---

## §1 Architecture decision: lanes live INSIDE one tick (decided)

**Chosen: one lock-holding tick, one orchestrator, two implementer sub-agents in two worktrees. The orchestrator in the main checkout is the sole board writer. The single-flight lock, the watcher, and the lock/nonce contract are untouched.**

**Rejected alternative — two concurrent ticks, one lane each.** Two ticks means two board writers by construction: each tick's orchestrator transitions its own task in the main checkout and commits to master. Making that safe requires either (i) a second lock tier around every `.lattice/` mutation + master commit — a new locking protocol on the hot path, which converts the lock from etiquette into a load-bearing correctness mechanism, exactly what the watcher README forbids ("do not 'fix' it into something load-bearing") — or (ii) tolerating interleaved git index/commit races between two processes in one checkout, which is the AS-24 two-writers-one-store shape and the 2026-08-31 duplicate-scoring-pass shape with a git index in the blast radius. Both lived incidents in the description are two-writer incidents. The in-tick fan **removes the two-writer class instead of mitigating it**: there is still exactly one process that runs `lattice`, one process that commits to master, one lock, one nonce, one `settle()`. Correctness continues to live where it lives today — Lattice claims plus main-checkout serialization — and the spike's checkers prove that it does.

**Consequences the chosen architecture must own (and this plan does):**

1. **The one-task-per-tick bound in `advance.md` Bounds is deliberately breached by the trial tick, once, supervised.** That breach *is* the experiment the description authorizes ("two tasks occupying active stages concurrently … under ONE tick"). The production wording change is proposed in the result doc (§10), applied by nobody within this task.
2. **Tick duration grows to ≈ max(lane durations) + orchestration.** A fanned tick containing a D1-scale implementation lane cannot fit the watcher's 30-minute SIGTERM budget — that is arithmetic on recorded constants (70–381 min observed D1 implementation stages vs `tickTimeoutMin` 30), not a measurement. Therefore **the trial runs as a manual, supervised, live-session tick** (lock `source: "manual"`), never watcher-fired, with the heartbeat obligation honored (§6 step T1.4). What the *production* recommendation should be for watcher-fired ticks is question 3 of the description and is answered in the result doc from the §9.4 query — the plan does not pre-write that answer.
3. **One orchestrator supervises two lanes.** Mitigations: lanes return structured reports (relay contract, §5.3), every lane's work is still independently reviewed by its own task's QA stage later, and the trial is instrumented (ledger, §6) so supervision failures are detectable after the fact rather than silent.
4. **The board-write relay changes the Employee Execution Model for lanes.** Design in §5.3; validated by checker (c) plus the write-fence (§7), not assumed.

## §2 What the prototype changes — files and functions

**New, committed on `feat/AS-60-parallel-lanes` (this is the "proven prototype diff"):**

- `tools/lanes/check-branch-clean.sh` — ships-clean (a)
- `tools/lanes/check-confinement.sh` — ships-clean (b)
- `tools/lanes/check-disjoint.sh` — the pair file-disjointness gate (b-adjacent; also the standing gate the description requires before any future D1+D1 pair)
- `tools/lanes/check-event-integrity.mjs` — ships-clean (c), including the write-fence ledger cross-check
- `tools/lanes/check-resume-preconditions.sh` — the executable core of (d)
- `tools/lanes/compute-lane-metrics.mjs` — ships-clean (e)
- `tools/lanes/check-git-identity.sh` — ships-clean (f)
- `tools/lanes/test/` — fixture generator + `node --test` suites; the falsification harness (§8)
- `tools/lanes/README.md` — run instructions + the falsification recipe index
- `docs/engineering/03-parallel-lanes-spike.md` + `docs/engineering/03-parallel-lanes-spike/evidence/` — the written result and its evidence (ledger copies, checker outputs, trial-config, archived prompts)

`tools/` is a new top-level directory: repo-level operating-loop tooling, not a product app (`apps/*` is products; `.claude/commands/` is procedure; this is the executable support for procedure). Zero-dependency: `bash` + `node:*` builtins, host node ≥ 20, matching the watcher's own constraint. Test runner: `node --test`, matching both apps.

**Deliberately NOT changed by this task:** `advance.md` (lock protocol unchanged — assert, don't edit), the watcher (no config, no plist, no code), `CLAUDE.md` and all top-level markdown (proposed wording only, §10), the chat app, the invoicing app (AS-41's changes belong to AS-41, not to this spike).

**Trial-time mechanism that leaves no diff anywhere:** `chmod -R a-w <worktree>/.lattice` on every trial worktree (AS-41's, AS-34's, AS-60's) at setup. Git tracks only the executable bit, so this is invisible to every diff — and it converts the AS-26 silent-redirect hazard into a loud `EACCES` failure inside any lane that tries to write board state from its worktree. Reverted (`chmod -R u+w`) at teardown, before `git worktree remove` (which needs writable directories). This fence is a production candidate; it goes in the proposed wording (§10), not into any file now.

## §3 Roles and phases (who does what — the manager rule resolved)

Lena is an IC: she cannot spawn sub-agents, so she cannot conduct the fan herself. The trial's orchestrator is the manager running the tick — `agent:cto-owen` — which is also the honest shape: under lanes, the orchestrator role IS the manager role. Sequential handoffs on one task are normal (planner → implementer → QA already is one); "one agent per task at a time" is preserved throughout.

- **Phase 1 — build (Lena, implementer sub-agent, inside `.worktrees/AS-60/`).** Build everything in §2's tools list, including fixtures and tests. Run the falsification suite (§8); commit tooling + falsification evidence on the spike branch. No board writes; her breadcrumbs are relayed per §5.3 (the spike eats its own dog food one lane early).
- **Gate (orchestrator).** Verify: falsification evidence exists, every checker has been seen failing with its predicted output, suite green on clean fixtures, real tree untouched by the suite. Only then schedule the trial.
- **Phase 2 — trial (orchestrator `agent:cto-owen`, main checkout + observation).** Preconditions §6.0, tick T1 (the fan + kill) §6.1, tick T2 (the resume) §6.2, teardown §6.3. Evidence lands in the spike worktree between phases (the worktree is quiescent — Lena is not running) and is committed on the spike branch under cto-owen's git identity.
- **Phase 3 — write (Lena, fresh sub-agent, inside `.worktrees/AS-60/`).** Write `03-parallel-lanes-spike.md` per §10 from the evidence directory and this plan. She applies the §9 pre-committed thresholds mechanically; the verdict is whatever the rulers read.
- **Review (Ruben, cold).** Tasking per the §12 template — criteria and paths, never numbers or verdicts.

Git identities: phase 1/3 commits as `developer-lena`; phase-2 evidence commits as `cto-owen`; lane commits as `developer-marcus` / `developer-lena` respectively — checker (f)'s expected-author sets per branch reflect exactly this.

## §4 Trial preconditions (normal loop work, before the trial tick)

1. **AS-41 and AS-34 each get a normal planning stage** (own ticks, own planners, plan to master, branch + worktree created per `advance.md`). Their plans must state their file scope; trial setup copies those scopes into `trial-config.json` (§6.0.4).
2. **Reassign AS-34 → `agent:developer-lena`** at its planning tick (stale item: the board still shows Marcus from before the pair hire; record §9.5.3 pre-agrees Lena). AS-41 → `agent:developer-marcus`.
3. **Substitution invariant** (binding, from the description): if either task closes or is claimed before the trial runs, substitute an equivalent — one D1 + one chat, maximally disjoint. The plan's ids are the current instance, not the invariant.
4. **Run the whole block — two planning ticks then the trial tick — consecutively in one supervised session**, minimizing the window in which an unattended tick could legitimately pull one of the pair's implementation stages (risk R6).

## §5 Trial design — the three load-bearing mechanisms

### §5.1 Lock discipline for a long manual tick

- Lock body `{pid, startedAt, source: "manual"}` written with `wx` from the main checkout, per `advance.md` step 0.
- **The pid must outlive individual Bash calls** or a mid-trial human message makes the watcher read dead-pid staleness and fire a second tick INTO the fan — the exact interleaving the lock exists to prevent. Setup step §6.0.6 verifies an ancestor pid (the session process, via `ps -o ppid= -p $$`) is stable across two calls and alive (`kill -0`); fallback: a `sleep 14400` background sentinel's pid, killed at teardown (degradation if orphaned: lock stays pid-alive but goes age-stale at 45 min — bounded by design).
- **Heartbeat:** rewrite the lock with fresh `startedAt` (same pid/source) whenever its age exceeds 25 min, from the orchestrator's wait loop — in-band only, never a detached background rewriter (a zombie heartbeater would keep a dead tick's lock fresh forever, defeating staleness; this anti-pattern is named here because it is the obvious wrong implementation).
- The watcher needs no accommodation: a fresh foreign (`manual`) lock is `skip-locked` by `decide()`, and a human message arriving mid-trial is served by the first post-trial tick. That behavior is expected, not a bug.

### §5.2 Sole board writer + write-fence (detection, not just discipline)

During T1, only the orchestrator runs `lattice` or `git` against the main checkout. Every board mutation it executes is appended to a **ledger** (`{ts, actor, cmd, note}` JSONL, one entry per `lattice` call / master commit / lock op / spawn / kill / checker run), written to an absolute scratch path *outside the repo* during the trial and copied into `evidence/` at each tick end. Prompt discipline alone is not evidence, so two independent detectors back it:

1. **The chmod fence (§2)** makes an in-worktree board write fail loudly inside the lane.
2. **The ledger cross-check** (part of checker (c)): every event whose `ts` falls inside the trial window must correspond to a ledger entry within 60s. An event the orchestrator cannot account for is a fence trip — the checker fails, cardinality reported.

### §5.3 The relay (Employee Execution Model under lanes — designed, then validated)

Lane sub-agents are forbidden to touch `.lattice/` entirely and never run the `lattice` CLI. The lane tasking prompt (§13 template) requires each lane to return, in its final report: **(i)** breadcrumb comment texts it authored, **(ii)** a status recommendation (stage complete / blocked / needs_human + reason), **(iii)** the list of files it touched, **(iv)** commits it made. The orchestrator posts the breadcrumbs **verbatim** with `--actor agent:<authoring-employee>` — correct under the existing attribution rule (authorship of the decision, not the keystroke) — and executes the transitions itself. Trial instrumentation comments (spawn/kill/return markers, prefix `lanes-trial:`) are orchestrator-authored and carry `--actor agent:cto-owen`. Checker (c) validates attribution against exactly this expected-actor map (in `trial-config.json`). The relay's fidelity (verbatim text, no markers injected into employee breadcrumbs) is asserted by Ruben in review against the archived lane reports.

## §6 Trial protocol (numbered; every step ledgered)

### §6.0 Setup

1. Main checkout on master, clean; `lattice list` confirms AS-41 and AS-34 `planned`, assigned per §4, worktrees exist; AS-60 `in_progress`.
2. Take the manual lock (§5.1). Record fan window start candidate.
3. `chmod -R a-w` the `.lattice/` copy in all three worktrees; verify with a probe write that fails (`touch` expecting EACCES; ledger the probe).
4. Write `evidence/trial-config.json`: per-task allowed path prefixes (from the two plans; expected shape AS-41 → `apps/invoicing/`, AS-34 → `apps/chat/`, AS-60 → `tools/lanes/` + `docs/engineering/`), expected-actor map (§5.3), branch names, expected git identities, window placeholders.
5. Run `check-disjoint.sh` on the pair's prefix sets — must pass BEFORE the fan (this is the standing pair gate); ledger output.
6. Verify lock-pid stability (§5.1). Snapshot `.lattice/events/` file sizes (fence baseline).
7. Post one-line FYI to `#board` as `agent:cto-owen` ("lanes trial T1 starting under AS-60; supervised manual tick; board writes serialized through me"). An employee post writes no sentinel, so this cannot fire the watcher. This is notice, not an approval gate — the veto gate (§11) is unchanged.

### §6.1 Tick T1 — the fan and the kill

1. Transition both tasks `planned → in_progress` (two `lattice status` calls + one board commit `AS-41/AS-34: board — lanes trial fan start`), ledgered. Statuses move BEFORE lanes spawn, per the cardinal rule.
2. Spawn both lanes in the same instant (single message, two background sub-agents): Marcus ← AS-41 lane prompt, Lena ← AS-34 lane prompt (§13; prompts archived verbatim into `evidence/`). Post `lanes-trial: lane spawned …` comment on each task at spawn; ledger.
3. **Concurrency probe (open question Q1's empirical check):** within the first 10 minutes, both worktrees must show independent progress (new files/mtimes or commits). If activity is strictly serialized — one lane provably idle until the other returns — ABORT per §14.A1: the harness cannot fan, which is itself a decision-grade finding.
4. **Wait loop** (poll ≤ every 5 min): heartbeat when lock age > 25 min (§5.1); scan `git -C <lane-wt> status --porcelain -- .lattice` (belt for the fence); poll lane A's branch for its first new commit (kill rule); ledger each pass tersely.
5. **Kill rule (pre-committed clock — falsifier discipline §9.11):** kill lane A (AS-41, the D1 lane) at *first observed new commit on its branch + one wait-loop pass (≤ 5 min)*, via the harness agent-stop (TaskStop). Backstop: if no commit by *fan start + 45 min*, kill at 45 min regardless. Do not warn the lane (representative behavior matters; leaking the manipulation to the subject is the AS-36 failure in experimental clothing). Post `lanes-trial: lane killed` comment; ledger; record worktree residue (`git status --porcelain` of wtA: dirty vs clean — say which case was exercised) and verify quiescence: two polls 60s apart with identical status + stable mtimes; if a surviving child process keeps writing wtA > 10 min after the kill, §14.A3.
6. Lane B runs to completion; relay her breadcrumbs (§5.3), post `lanes-trial: lane returned`, transition AS-34 `in_progress → review` + board commit.
7. Lane A stays `in_progress` — the board must tell the truth: the stage did not complete. Relay any breadcrumbs already returned… there are none (killed agents return nothing) — instead the orchestrator posts the kill breadcrumb itself, `--actor agent:cto-owen`: what was killed, when, at which commit, what residue; that comment is T2's discovery surface.
8. Run checkers: (a) + (f) on both branches (A in its partial state — a partial branch must already be clean), (b) on lane B's branch + wtB + main checkout, (c) over the T1 window with the ledger. Outputs → `evidence/checks/T1/`.
9. End T1 clean: copy ledger into the spike worktree `evidence/`, commit evidence on the spike branch (`cto-owen` identity), release the lock (`rm` own lock only), record window end in `trial-config.json`.

### §6.2 Tick T2 — the resume (a separate, later, normal tick)

1. A **new lock cycle, fresh context**. T2 is a normal WIP=1 tick under CURRENT rules — deliberately: resumability must not require the lanes machinery.
2. Discovery from durable state alone: `lattice list` (AS-41 `in_progress`), `lattice show AS-41` (branch-link), `git worktree list` (wtA exists), the plan file, the kill breadcrumb. Run `check-resume-preconditions.sh AS-41` — it asserts exactly this set exists; output → evidence.
3. Spawn a **fresh** Marcus with the §13 resume prompt — constructed ONLY from durable-state pointers (task id, plan path, worktree path, branch name); archived into `evidence/` so Ruben can verify no in-memory carryover leaked in. He completes the stage under current-rules discipline; `lanes-trial: lane spawned/returned` markers again.
4. Transition AS-41 → `review`; run (a), (b), (f) on the final branch, plus the sha-stability assertion: every pre-kill commit sha is an unchanged ancestor of the final head (no rewrite, no duplicate re-application). (c) over the combined windows. Outputs → `evidence/checks/T2/`.
5. **"Resumed correctly" means, precisely:** resume ran from durable state alone (archived prompt proves it); the stage reached its normal completion handback; pre-kill shas unchanged; (a)/(b)/(f) pass on the final branch; the surviving lane's artifacts untouched by the resume (wtB/branch B diffs unchanged between T1-end and T2-end). "Surviving lane unharmed" = its (a)/(b)/(f) results at T1 end, unchanged at T2 end, and AS-34's lifecycle undisturbed.

### §6.3 Teardown and aftermath

1. `chmod -R u+w` the fenced `.lattice` copies. Worktrees for AS-41/AS-34 stay (their tasks are in `review`; normal lifecycle owns them from here — their QA stages are NOT spike scope; reviewer assignment respects implementer ≠ reviewer: Priya/Ruben split across the pair).
2. No scratch artifacts inside the repo (ledger scratch dir is outside; verify). Main checkout clean.
3. AS-60 continues: phase 3 (doc), then review, then normal merge. **At the merge tick, per the fulfillment-check rule: post the written result to `#board`** — that post starts the veto window (§11).

## §7 Ships-clean criteria as executable checks

House output contract for every checker: first line reports cardinality ("examined N commits / M events / K files"), then PASS/FAIL with the failing items; exit 0 pass, 1 fail, 2 usage error. All run from the main checkout with explicit `-C`/absolute paths (AS-26 discipline). Trial outputs recorded under `evidence/checks/T1/` and `/T2/`, committed on the spike branch.

| # | Criterion | Check (command) | Pass is defined as | Planted violation that must fail first (§8) |
|---|---|---|---|---|
| a | zero `.lattice/` on task branches | `check-branch-clean.sh <branch>` | `git diff --name-only master...<branch>` contains no path under `.lattice/` (count printed) | fixture branch with a committed `.lattice/events/` touch |
| b | diff confinement + clean trees | `check-confinement.sh <branch> <config>` | every diff path matches the task's allowed prefixes; named worktree `status --porcelain` empty; main checkout porcelain empty | fixture branch with one out-of-prefix file; fixture dirty worktree |
| b′ | pair disjointness (gate, pre-fan + post-trial) | `check-disjoint.sh <config>` | allowed-prefix sets pairwise disjoint AND actual diff path sets pairwise disjoint | fixture config with overlapping prefixes; fixture branches touching one shared file |
| c | event-log integrity + write-fence | `check-event-integrity.mjs [--window a..b --ledger f --config f]` | per task: every `status_changed.from` equals the previous state (seeded by `task_created`); no overlapping duplicate assignment; window comments attributed per expected-actor map; every in-window event matches a ledger entry ±60s | three separate fixtures: corrupted from-state; duplicate claim; injected unledgered event in-window |
| d | resume preconditions (procedure core) | `check-resume-preconditions.sh <task>` | status `in_progress` + branch-link event exists + worktree exists + plan file non-scaffold — the full durable set a cold tick needs | fixture with the branch-link event removed |
| e | measurement integrity | `compute-lane-metrics.mjs --config f --ledger f` | emits dA1, dA2, dB, W_T1, overlap, savings, R, overhead with the source event id cited per number; event-vs-ledger divergence > 60s is a hard error | fixture ledger with a missing spawn marker (must error, never fabricate); two synthetic fixtures with hand-computed R (one above, one below 0.5) that the script must reproduce exactly |
| f | per-employee git identity | `check-git-identity.sh <branch> <config>` | every commit in `master..<branch>` has `author.name` in the branch's expected set and email `<name>@agents.american-software.local` | fixture commit authored as `developer-marcus-webb` (the exact drift AS-53 settled) |

(d) as a whole is procedural — §6.2.5 defines "resumed correctly"; the table row is its executable core, and its remaining teeth are re-runs of (a)/(b)/(f) plus the sha-stability assertion, all recorded.

## §8 Falsification recipes (house style, applied to the spike's own checkers)

All falsification runs live in `tools/lanes/test/` as `node --test` suites against **generated scratch fixtures** (`mktemp -d` git repos with synthetic `.lattice/events/*.jsonl`, branches, and worktrees) — never the real repo, never the task worktrees, no in-place mutation anywhere, hence no trap/restore machinery by construction. Per checker, each test:

1. builds the fixture and **asserts the planted violation is present** (grep/git-log proves the mutation applied — an unapplied mutation looks exactly like a passing checker);
2. **predicts the exact failing set** (which items, which message, exit code 1) in the test's assertion, then runs the checker and matches prediction to observation — a wider or narrower failing set than predicted fails the test and is itself a finding;
3. runs the checker's clean twin fixture and asserts PASS with the expected cardinality line;
4. the suite runner asserts the real tree was untouched: `git status --porcelain` captured before and after the whole suite must be byte-identical.

The suite is the standing, re-runnable falsification evidence: `node --test tools/lanes/test/` output from phase 1 is committed at `evidence/falsification/` and re-run by Ruben in review. Order is binding: **falsification (phase 1) completes before any checker's trial-time green is trusted (phase 2 gate, §3).** A checker modified after phase 1 re-runs its falsification before the trial.

## §9 Measurement spec — pre-committed before the data exists

### §9.1 Instrumented quantities (all from `.lattice/events/task_*.jsonl` timestamps, cross-checked ±60s against the ledger)

From `lanes-trial:` comment markers: `tA_spawn`, `tA_kill` (T1, lane A); `tB_spawn`, `tB_return` (T1, lane B); `tA2_spawn`, `tA2_return` (T2 resume). Then:

- `dA1 = tA_kill − tA_spawn`, `dB = tB_return − tB_spawn`, `dA2 = tA2_return − tA2_spawn`
- `W_T1 = max(tA_kill, tB_return) − min(tA_spawn, tB_spawn)` (the fan window)
- `overlap = max(0, min(tA_kill, tB_return) − max(tA_spawn, tB_spawn))` (reported)
- **savings** `= dA1 + dB − W_T1` (minutes — the wall-clock the fan actually bought vs zero-gap serial)
- **R** `= savings / min(dA1, dB)` (fraction of the theoretically available parallelism captured; the available maximum is exactly `min(dA1, dB)`)
- **overhead** `= W_T1 − max(dA1, dB)` (orchestration cost: spawn serialization, board writes, waits)

Serial baselines, both reported: **S0** `= dA1 + dA2 + dB` (zero-gap serial — deliberately generous to serial; kill+resume cost appears identically on both sides of the comparison), against fanned campaign cost `W_T1 + dA2`; their difference equals `savings` (arithmetic identity — the metrics script asserts it as a self-check). **S_real** (context only, never the verdict input): `S0` plus the median inter-transition gap over the last 24h of loop-time — gaps between consecutive `status_changed` events company-wide, excluding gaps ≥ 60 min (dead cadence is not serial cost). The script prints the exact filter it applied.

### §9.2 Pre-committed verdict thresholds (the rulers; chosen now, moved never)

1. **"The fan pays" iff R ≥ 0.5.** R < 0.5 means more than half of the only wall-clock the fan could possibly buy was eaten by serialization/overhead — at that efficiency the complexity is not justified at this scale, and criterion (e)'s verdict is **no**.
2. **Power floor:** if `min(dA1, dB) < 15 min`, the trial is underpowered for question 4 (marker skew and boundary board-writes are seconds-to-minutes scale) and the (e) verdict is at most **qualified — remeasure on a pair with both lanes ≥ 30 min** — regardless of which side of 0.5 R lands on. Decided now so neither direction can be rescued post-hoc.
3. **Overhead flag:** overhead > 10 min is a lanes finding (something structural is serializing) even if R passes.
4. Clock discipline (§9.11 of the record): every quantity above is wall-time within named tick windows, whose start/end timestamps are recorded in `trial-config.json`; no cross-tick gaps are counted in any fan number.

### §9.3 What the plan does not predict

This plan fixes rulers, not readings. Nothing here states an expected R, expected checker outcomes, or the verdict — and no stage tasking message may either (AS-36; templates in §13 exist precisely so nobody improvises an anchored one).

### §9.4 Question-3 budget analysis (spec, not answer)

The result doc must answer question 3 with the arithmetic shown: per-app implementation- and review-stage duration distributions (p50/p75/max) from the full event log — the query: for each task, pair `status_changed` into stage windows (`in_progress→review` = implementation, `review→done|rework` = review), group by app prefix from the task's branch/diff — set against the recorded constants `tickTimeoutMin=30`, `lockStaleMin=45`, heartbeat 30 (and the fan's own T1 wall clock as the first fanned data point). The doc states explicitly whether a fanned tick fits any watcher budget, and if a config change would be required, names it as watcher config + launchd plist — a board-visible ops change this spike does not make.

## §10 The written result — home and shape

`docs/engineering/03-parallel-lanes-spike.md`, required sections:

1. **Header** — task, dates, actors, links (record 11 §4/§9.7/§9.8/§9.11, this plan).
2. **Architecture** — §1's decision and consequences, as validated/amended by the trial.
3. **Trial narrative** — what ran, when, what was killed, what resumed; the pair actually used (substitution noted if it fired).
4. **Ships-clean scoreboard** — (a)–(f), PASS/FAIL each, with evidence paths and cardinalities; falsification evidence pointer per checker.
5. **Measurements** — every §9.1 number with event-id citations; thresholds applied verbatim from §9.2; S0 and S_real.
6. **Question-3 answer** — per §9.4.
7. **The relay design** — as validated: what the lanes returned, what the orchestrator executed, attribution results; the lock-pid liveness wrinkle (§5.1) and its disposition.
8. **VERDICT** — yes / no / qualified, in one bold sentence, followed by *exactly what observation would change it* (falsifier discipline, §9.11 of the record: state the window and clock of any forward-looking condition).
9. **Proposed metawork wording — NOT APPLIED** — exact replacement text for: `advance.md` Bounds + step 2 (the lanes carve-out; supervised/live-session scoping per the question-3 answer; the disjointness gate; sole-board-writer rule), step 0 (expected: "unchanged" — assert it), `CLAUDE.md` Operating Modes, Git Methodology (worktree rules + chmod fence + lane `lattice` prohibition), Employee Execution Model (the relay). Seed for the Bounds line, to be finalized against what the trial actually validated: *"One tick advances one task by one lifecycle stage, or performs one org-level action — except a supervised lanes tick (live/manual session only), which may advance up to two mutually file-disjoint tasks by one implementation stage each, under a single orchestrator who is the sole board writer; lanes never share an agent, never share files (disjointness check at fan start), and never write board state."*
10. **§9.8 obligation, carried forward verbatim** — the post-ship overlap query must go non-zero within one day OF RUNNING LOOP (loop-time clock), a zero must be attributed (cadence finding vs lanes finding) and returns to record 11 as a dated addendum. **Explicitly distinguish:** the trial itself makes the *historical* overlap count non-zero for the first time; that does NOT satisfy §9.8, which measures post-ship production use.
11. **Follow-up task paragraph** (§11) + the veto-window gate statement.
12. **Residuals and stale items** — including §16's findings and anything the trial surfaced but did not resolve (e.g., a production `lattice`-wrapper guard for worktree cwd; AS-27's dependency on this result).

## §11 The follow-up implementation task (scoped now, filed later, maybe)

> **Title:** advance loop: ship parallel implementer lanes (WIP=2) per AS-60's written result. **Scope:** apply the AS-60 proposed wording to `advance.md` (metawork layer applies `CLAUDE.md` edits); promote the trial's operational practice to procedure — sole-board-writer relay, `chmod` fence at `git worktree add`, `check-disjoint.sh` gate at fan start, ledgered board writes, heartbeat rule for long ticks, lock-pid liveness rule for manual ticks; wire `tools/lanes/` checkers into the lanes tick's end-of-tick checklist; leave watcher-fired ticks at WIP=1 unless the question-3 answer in the result doc says otherwise (in which case watcher config + plist change is its own board-approved line item). **Acceptance:** carries the §9.8 obligation verbatim (overlap query non-zero within one day of running loop, loop-time clock, attributed zero → dated addendum to record 11); lanes ticks run the six checkers green; first production fan is supervised.
>
> **Filing gate:** filed only if the verdict is **yes** AND the board has explicitly green-lit in `#board` after the result post — a reply, not silence; silence parks the item as an open board ask. Filed by the CTO, referencing the result doc. It does not exist before then.

## §12 Review protocol (AS-36-safe, binding on the eventual orchestrator)

Ruben's tasking message may contain: the plan path, the doc path, the evidence directory, the diff target (`git diff master...feat/AS-60-parallel-lanes`), the acceptance criteria list (§15), and the instruction ordering below. It may NOT contain: any measured number, any checker outcome, R, the verdict, or a characterization of the result ("clean", "successful"). Template:

> Review AS-60 cold. (1) Re-run `node --test tools/lanes/test/` and confirm every checker has committed falsification evidence showing a predicted failure. (2) Recompute the §9.1 metrics yourself from `.lattice/events/` + the committed ledger — before reading the doc's §5/§8 — and only then compare against the doc. (3) Re-run checkers (a), (b), (b′), (f) against both lane branches and the spike branch; (c) against the recorded windows. (4) Verify the doc's verdict follows mechanically from the plan §9.2 thresholds and that §10's required sections exist, including the NOT-APPLIED wording and the §9.8 carry-forward. (5) Verify the archived lane/resume prompts contain no board-write instructions and no leaked conclusions, and that relayed breadcrumbs match the archived lane reports verbatim. (6) Confirm the spike branch touches only `tools/lanes/**` and `docs/engineering/**`, and that `advance.md`, `CLAUDE.md`, watcher files are untouched. Record findings with `--role review`.

## §13 Lane tasking templates (archived verbatim into evidence when used)

**Lane prompt (T1, per lane):** identity ("You are `<employee>`; commit as `git -c user.name="<id>" -c user.email="<id>@agents.american-software.local"`"), the task id + plan path + worktree absolute path + branch name; the boundary rules: work ONLY inside your worktree, `git -C <path>` always, never `cd` elsewhere, NEVER run `lattice` or touch any `.lattice/` path (yours is read-only and write-fenced; a permission error on it means stop and report), no pushes; the relay contract (§5.3: return breadcrumb texts, status recommendation, files touched, commits). Contains nothing about the other lane's content, the kill test, or any expected measurement.

**Resume prompt (T2):** identity as above; then ONLY durable-state pointers: task id, plan path, branch name (from `lattice show`'s branch-link), worktree path, plus "read the task's Lattice comments and the git log of your branch/worktree, then complete the implementation stage per the plan." Nothing from T1's session memory.

## §14 Risks and abort conditions

**Abort = freeze board writes, TaskStop running lanes, capture state into the ledger, end the tick clean (truthful statuses, breadcrumb comment on AS-60 saying exactly where it stopped), lock released. Aborts route AS-60 back to me (tech lead) — `needs_human` only if a board decision is genuinely required.**

- **A1 — no real concurrency** (§6.1.3 probe fails): abort; the finding is decision-grade on its own (lanes are unavailable in this harness) and goes in the doc.
- **A2 — fence trip mid-fan** (unattributable board event or `.lattice` modification in any worktree): stop the offending lane, complete the other, run checkers, end clean. Not silently continued past — but also not discarded: a caught trip is exactly what the spike exists to observe. Repair per §14.R below before anything else proceeds.
- **A3 — zombie writer after kill** (§6.1.5): if wtA keeps changing > 10 min post-kill, do not start T2 against a moving tree; wait for quiescence or abort T2 and record.
- **A4 — T1 hard cap 3h** (pre-committed clock: ≈ 2× the longest observed non-AS-37 implementation stage, 88 min, plus margin): stop remaining lanes, end clean; both tasks resume later under normal rules; (e) reported as not-measured, resumability evidence still valid.
- **A5 — lock integrity lost** (lock file vanishes or shows a foreign pid mid-trial): freeze immediately, investigate before any further board write.
- **R — real-board damage repair (the rollback story).** The trial runs against the real `.lattice/` — decided: a sandbox board would validate a sandbox, and the follow-up would still need a real-board trial before shipping; pay the supervised cost once. The blast-radius controls: events are append-only JSONL (nothing destructive exists in the CLI), every board mutation is a master commit (visible, attributable, revertable), the fence turns the silent failure loud, and the ledger makes any stray event provable. Repair recipes: stray `.lattice` writes in a worktree → `git -C <worktree> checkout -- .lattice`, then re-issue correct transitions from the main checkout (the recorded AS-26 fix — never hand-copy JSONL); a wrong event in the real log → corrective event + comment (event-sourced record: correct forward, never edit history); a polluted board commit on master → `git revert` (never reset; master may be pushed).
- **R6 — pair consumed by an unattended tick** between planning and trial (watcher fire in a gap): do not fight it — substitution invariant (§4.3) or reschedule; if a watcher tick picks up AS-41 mid-campaign (between T1 and T2), its tick log + board trail become resume evidence (a watcher tick is the coldest possible resumer); evaluate, adopt what is valid, never kill a legitimate tick.
- **R7 — board message mid-trial:** expected; served by the first post-trial tick (§5.1). If the board explicitly says stop, that is A-class: stop lanes, end clean — both tasks left resumable, which is itself (d)-adjacent evidence.

## §15 Acceptance criteria (each independently checkable)

1. `tools/lanes/` exists on the spike branch with the seven §7 checkers + `test/` + README; zero external dependencies; `node --test tools/lanes/test/` green; the suite proves the real tree untouched (before/after porcelain byte-identical, asserted inside the suite).
2. Falsification evidence committed under `evidence/falsification/`: per checker, the planted violation (asserted applied), the predicted failing set, the observed match, and the clean-twin pass — per the §8 recipe; produced BEFORE the trial (phase-1 timestamps precede T1's window).
3. The trial executed per §6 against the real board: one manual lock-held tick fanning two lanes (one D1 + one chat, maximally disjoint — AS-41 + AS-34 or §4.3 substitutes), orchestrator as sole board writer, ledger + `lanes-trial:` instrumentation recorded, lane prompts archived.
4. Lock discipline proven in evidence: pid stable and alive across the tick, heartbeat rewrites at ≤ 30-min gaps visible in the ledger, lock released at each tick end.
5. The kill executed per the §6.1.5 pre-committed rule (first-commit + one poll, 45-min backstop), via agent-stop; kill moment, branch state, and residue case (dirty/clean) recorded.
6. The resume ran in a separate later tick from durable state alone: `check-resume-preconditions.sh` output committed; the archived resume prompt contains only §13's durable-state pointers; the killed task's stage completed; every pre-kill sha an unchanged ancestor of the final head.
7. Checkers (a), (b), (b′), (f) outputs committed for both lane branches (lane A at T1-end partial AND T2-end final) and (c) for the full windows with ledger cross-check — with cardinalities; whatever they show, shown.
8. Metrics computed by `compute-lane-metrics.mjs` from event timestamps with per-number event-id citations; R, savings, overhead, S0, S_real all reported; the §9.2 thresholds applied verbatim and unmoved; the fixture tests pin the formulas.
9. `docs/engineering/03-parallel-lanes-spike.md` exists with all twelve §10 sections, including a one-sentence bold verdict (yes/no/qualified) plus what would change it, and the question-3 answer with arithmetic shown per §9.4.
10. The §9.8 obligation appears in the doc verbatim-equivalent (loop-time clock, attributed zero, dated addendum to record 11) AND inside the §11 follow-up paragraph — and the doc distinguishes trial overlap from post-ship §9.8 overlap.
11. Proposed metawork wording section present and marked NOT APPLIED; the spike branch's own diff is confined to `tools/lanes/**` and `docs/engineering/**` (checked with `check-confinement.sh` against AS-60's own config row); `advance.md`, `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, `agents.md`, `apps/chat/watch/**` untouched.
12. The follow-up task is NOT filed within AS-60; the doc states the §11 filing gate (verdict yes + explicit board green-light in `#board`; silence is not consent).
13. AS-41 and AS-34 (or substitutes) end the spike with truthful statuses and intact lifecycles: no spike artifacts on their branches, their reviews proceeding under normal rules outside spike scope; AS-34's assignee corrected to Lena on the board.
14. Teardown clean: fences reverted, no scratch artifacts inside the repo, main checkout porcelain-clean, every board mutation committed to master as `AS-<n>: board — <what>`; `#board` FYI posted at trial start and the result posted to `#board` at the merge tick (the veto-window clock's start).

## §16 Stale items found while planning (metawork-layer FYI; employees do not edit these)

1. **AS-34 assignee** is `agent:developer-marcus` on the board; record §9.5.3 pre-agrees Lena. Corrected at its planning tick (§4.2).
2. **CLAUDE.md Operating Modes "known residual" paragraph** still instructs ticks to avoid the chat CLI for reads and writes and use raw HTTP; `advance.md` step 1 (post-AS-24) says the CLI self-routes and is the preferred path. The two contradict; the CLAUDE.md paragraph looks pre-AS-24-stale. Metawork call, not mine — flagged.
3. **Watcher README's one-paragraph summary** (line ~22) still describes the spawn as bare `claude -p '/advance' --permission-mode acceptEdits`, omitting the nonce marker and AS-21 grants that its own later sections document. Cosmetic staleness in a file this spike must not touch — noting for a future watcher task.
4. **AS-27** (loop-status UI) renders a single-tick-in-flight model; its implementer should read this spike's result first (already in the filing comment; restated so it lands in the result doc §12).

## §17 Size, complexity, open questions

**Complexity:** high (set at filing; confirmed — the risk is operational, not algorithmic). **Size estimate:** tooling + tests ≈ 600–900 lines across seven small scripts + suites; result doc ≈ 300–500 lines; evidence directory; trial wall clock dominated by lane A (expect a multi-hour supervised block for T1 + a shorter T2).

Open questions, each with a default and a time-box (my rule: expired box = default wins):

- **Q1 — do two background sub-agent lanes actually run concurrently in this harness?** Default: yes (documented harness behavior; the AS-30-planning-concurrent-with-board-reply precedent, record 11 §4). Empirically checked at §6.1.3 within 10 minutes of fan start; failure = abort A1 and a decision-grade finding.
- **Q2 — what does agent-stop leave behind (orphaned shell children writing the worktree)?** Default: assume possible, handle via the §6.1.5 quiescence check and A3. Resolved by observation at the kill; the answer goes in doc §7.
- **Q3 — is the session-ancestor pid stable enough to be the manual lock's pid?** Default: yes, verified at §6.0.6; fallback sentinel process defined in §5.1. Resolved at setup.
- **Q4 — will AS-34's lane clear the 15-min power floor?** Default: run the pair as pre-agreed regardless (disjointness, not throughput, is trial one's point — description's words); if the floor trips, the (e) verdict is capped at "qualified" per §9.2.2 and that is the honest answer. Resolved by the trial itself.
