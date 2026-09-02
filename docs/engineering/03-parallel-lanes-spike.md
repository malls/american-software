# Parallel Implementer Lanes (WIP=2) — Spike Result

**Author:** Lena Fischer, Software Engineer (`agent:developer-lena`), phase 3 (write).
**Date:** 2026-09-02. **Task:** AS-60 (spike, high).
**Plan:** `.lattice/plans/task_01M1G81VZBHYQ235ZR18WS01RV.md` (Owen Kessler, CTO, as tech lead).
**Phase actors:** phase 1 build — `agent:developer-lena`; phase 2 trial (orchestrator and sole board writer) — `agent:cto-owen`; lane A — `agent:developer-marcus` (AS-41); lane B — `agent:developer-lena` (AS-34); phase 3 write — `agent:developer-lena`.
**Binding context:** `docs/strategy/11-second-developer-decision.md` §4 (the lever and its sharp edges), §9.7 (why this is high), §9.8 (this document is the next re-decision point), §9.11 (falsifier discipline — binds §8 below).
**Evidence:** `docs/engineering/03-parallel-lanes-spike/evidence/`. **Tooling:** `tools/lanes/` (+ `tools/lanes/README.md`).
**Status:** experiment report. It ships no loop change. §9 is proposed wording, **not applied**.

**Reading order note.** §5 (measurements) is written to be read before §8 (verdict), and §8 applies the plan's §9.2 thresholds mechanically to §5's numbers. The thresholds were fixed on 2026-09-02 before any datum existed (plan §9.2, "chosen now, moved never"); nothing in this document adjusts them, and where a threshold caps the verdict, the cap is stated in the verdict sentence rather than in a footnote.

---

## 1. Header — what this is, and what it is not

AS-60 asked four questions (task description, "WHAT THE SPIKE MUST ANSWER"):

1. Can two tasks hold active stages concurrently with **zero board-state corruption**?
2. What exactly must change in `advance.md`, `CLAUDE.md`, and the Employee Execution Model?
3. Does a fanned tick fit any **watcher budget**, or are lanes live/manual-session-only at first?
4. **Does the fan pay** — fanned wall clock against the same two stages run serially?

This document answers all four: 1 in §4, 2 in §9, 3 in §6, 4 in §5 and §8.

The deliverable is three things and no more: this written result, the proven prototype diff (`tools/lanes/` plus the trial evidence), and the exact proposed metawork wording in §9. **No production loop change is made by AS-60.** `.claude/commands/advance.md`, `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, `agents.md`, and `apps/chat/watch/**` are untouched by this task's branch; the spike branch's own diff is confined to `tools/lanes/**` and `docs/engineering/**`.

---

## 2. Architecture — the decision, and what the trial did to it

**The decision (plan §1), unchanged by the trial:** lanes live *inside* one tick. One lock-holding tick, one orchestrator, two implementer sub-agents in two worktrees. The orchestrator in the main checkout is the **sole board writer**. The single-flight lock, the watcher, and the lock/nonce contract are untouched.

The rejected alternative was two concurrent ticks with one lane each, which is two board writers by construction and requires either a second locking tier on the hot path or tolerance of git index races in one checkout — the AS-24 two-writers-one-store shape. The in-tick fan **removes** that class rather than mitigating it: one process runs `lattice`, one process commits to master, one lock, one nonce.

**What the trial validated.**

- **Genuine concurrency exists in this harness** (open question Q1, plan §17). Confirmed at the §6.1.3 probe, 07:03:47Z, and the confirmation is worth recording because the obvious measurement failed: *worktree-write evidence alone was insufficient* — lane A wrote no files at all in its first eight minutes (`poll-T1.log` lines 1–8: `A[head=5eb6302 dirty=0 … recent=0]` at every poll from 06:56:34Z to 07:03:34Z). Lane A was reading a 12-file task, not blocked. The discriminating measurement was sub-agent transcript growth with overlapping write windows (ledger `ledger-T2.jsonl` line 23). **A future lanes tick that probes for concurrency by watching worktrees will conclude "no concurrency" on a reading-heavy lane and abort a healthy fan.** This is the trial's first correction to its own plan: §6.1.3 as written specifies "new files/mtimes or commits", which would have fired the A1 abort here.
- **The sole-board-writer relay works** — §7, and the checker evidence in §4 criterion (c).
- **The chmod write-fence is invisible to git and loud at runtime.** Applied to all three worktrees at 06:53:44Z; each probe write refused as expected (`ledger-T2.jsonl` lines 3–8, three fence applications and three refused probes). No trial-time fence trip occurred: checker (c) accounted for every in-window event against the ledger.

**What the trial amended.**

- **Consequence 2 of plan §1 (tick duration) is now measured, not arithmetic — and it is worse than the plan's framing implied.** The plan reasoned that a fan containing a D1-scale lane cannot fit the 30-minute watcher budget. The trial shows that *this* fan did not fit either, and its D1 lane was killed at 27.8 min rather than completing: the T1 tick held the lock for **33.16 min** (06:53:33Z → 07:26:43Z), and the recorded T1 window alone was **31.12 min**. See §6.
- **Consequence 3 (one orchestrator supervises two lanes) has its first failure datum.** The orchestrator's own poll cadence was interrupted and the pre-committed kill fired ≈13.5 min late (deviation D2, §3). That is exactly the supervision-attention risk record 11 §4 named — observed on the first fan, on a two-lane campaign, with one lane already finished.

---

## 3. Trial narrative

**The pair.** The pre-agreed pair ran; the substitution invariant (plan §4.3) did not fire. Lane A = **AS-41** (D1, Stripe Connect onboarding, `apps/invoicing/`, `agent:developer-marcus`). Lane B = **AS-34** (chat, `/api/file` symlink dot-check, `apps/chat/`, `agent:developer-lena`). AS-34's stale assignee was corrected Marcus → Lena at its planning tick (06:36:28Z), closing plan §16 item 1.

**Setup (06:53:33Z – 06:54:38Z).** Preconditions checked; lock pid 5285 sampled alive twice; `chmod -R a-w` applied to the `.lattice/` copy in all three worktrees with a refused probe write each; event-file sizes snapshotted; `trial-config.json` written; the pair disjointness gate run **before** the fan; `#board` FYI posted. T1 window opened 06:54:38Z.

**T1 — the fan (06:54:51Z – 07:25:45Z).** Both tasks transitioned `planned → in_progress` and both `lanes-trial: lane spawned` markers were posted in one batch (06:54:51.618Z and 06:54:51.781Z), then one board commit. Both lanes were spawned in a single message at 06:56:28Z. The concurrency probe passed at 07:03:47Z.

Lane B returned at ≈07:02Z; its breadcrumb was relayed verbatim under `agent:developer-lena` at 07:04:18Z, the return marker posted, AS-34 moved to `review`, one board commit. Lane B's work: 3 files, +35/−10, one commit `bc7a39f`, `api.test.js` 25/25 and the full chat suite 194/194, both falsification recipes run with the mutation asserted applied and the observed failing set exactly as predicted (1 of 25 in both cases).

Lane A ran on. Its first new commit appeared at the 07:07:35Z poll (`8094944`); the pre-committed kill point was that plus one wait-loop pass = **07:08:35Z**. The actual `TaskStop` landed at ≈07:22:0xZ — **≈13.5 min late** (deviation D2). Residue captured at 07:22:40Z: worktree A **clean**, 0 porcelain entries, 3 commits on the branch (`8094944`, `58c017c`, `26a8dfa`), no `as41` containers surviving, the live containers on 8347/8348 untouched. The kill breadcrumb was posted by the orchestrator under `agent:cto-owen` (a killed agent returns nothing), AS-41 deliberately left `in_progress`, one board commit. Checkers (a), (b), (b′), (f) run at T1 end; ledger and evidence committed on the spike branch; master pushed; lock released 07:26:43Z.

**Between the ticks (07:21:45Z).** The board issued a session-scoped directive in Claude Code chat: all agents on Opus for this loop. **This is a recorded confound** (`ledger-T2.jsonl` line 28): T1's lanes ran on their dossier models (both `fable`); the T2 resume and everything after ran on Opus. Its blast radius is bounded — T2's criterion is durable-state resumption, not output equivalence — but it means the T1 and T2 lane durations are **not drawn from the same population** and `dA2` must never be compared to `dA1` as if they were. §5 does not make that comparison; `S0` is unaffected because `dA2` appears identically on both sides of the serial/fanned identity (plan §9.1).

**T2 — the resume (07:30:26Z – 07:46:57Z).** A separate, later, **normal WIP=1 tick under current rules** — deliberately, so that resumability does not depend on the lanes machinery. `check-resume-preconditions.sh AS-41` examined 4 preconditions and passed. A fresh Marcus was spawned from a prompt built only from durable-state pointers (archived at `evidence/prompts/T2-resume-prompt.txt`), with the kill breadcrumb as the discovery surface and an explicit instruction to treat it "as a pointer, not as a verdict". He completed the stage, the breadcrumb was relayed verbatim under `agent:developer-marcus`, AS-41 moved to `review`.

**The resume's outcome is itself the trial's largest finding.** The resumer added **zero commits**: he found the killed stage's implementation already complete against all 16 acceptance criteria and spent the stage verifying it — 215 tests offline (200 pass / 15 mock-gated skips) and 215/215 against stripe-mock, six falsification recipes, and bisect-hygiene checks on both intermediate commits. The kill landed *after* implementation, during the lane's container teardown. What was exercised was therefore **resume-by-discovery-and-verification**, not resume-by-continuation. §5 and §12 say precisely what that does and does not license.

**Teardown (07:47:55Z).** Fences reverted (`chmod -R u+w`) on all three worktree `.lattice/` copies. AS-41 and AS-34 both sit at `review` with intact lifecycles; their QA stages are outside spike scope. Main checkout clean.

### 3.1 Deviations, each with its consequence

Four deviations are on the record. Each is listed with **what it invalidates** and **what it leaves intact** — the distinction is the point.

**D1 — `trial-config.json` shape (06:54:17Z).** Plan §6.0.4 describes one config shape; `tools/lanes/README.md` documents another. The README won, on the correct ground that it is the coupling contract the checkers actually parse. *Invalidates:* nothing measured. *Leaves intact:* everything. *Consequence:* plan §6.0.4 is stale text; the README is the schema of record. Cost: one rewrite, 20 s.

**D2 — the kill fired ≈13.5 min late (07:22:0xZ vs a pre-committed 07:08:35Z).** Cause: the orchestrator's poll cadence was interrupted. Recorded rather than re-run, per §9.11's rule that rulers are not moved after the fact.

*Invalidates:* (i) **the kill-timing datum** — this trial did not measure "kill at first commit"; (ii) **the residue-case sample**. The poll log settles the second point concretely: at the on-time kill point (07:08:35Z) lane A's worktree read `dirty=1`, and it read `dirty=4`, `dirty=6`, `dirty=6` at the three following polls. **The pre-committed clock would have sampled the dirty-residue case; the late kill sampled the clean case** (`poll-T1.log` lines 13–16 vs the 07:22:40Z residue capture). The dirty-residue path — the AS-26 rework-cycle-2 shape, a half-applied change on disk — **was not exercised at all.** (iii) It also invalidates the *strength* of the resumability datum: at 07:08:35Z lane A had **1** of its eventual 3 commits and an incomplete implementation, so an on-time kill would have forced resume-by-continuation. The late kill produced resume-by-verification instead.

*Leaves intact:* (i) **the throughput measurement.** The ledger states this as a robustness argument; I verified it against the numbers rather than repeating it. R is `savings / min(dA1, dB)` with `savings = dA1 + dB − W_T1` and `W_T1 = max(end) − min(start)`. Because both spawn markers carry the same timestamp, `W_T1 = max(dA1, dB)`, hence `savings = min(dA1, dB)` and **R = 1 exactly**, for any lane durations in which one window nests inside the other. Under the on-time clock `dA1` would have been 13.73 min (07:08:35Z − 06:54:51Z), still greater than `dB` = 9.45 min, so lane B still nests, and R, savings and overlap are numerically identical under both clocks. The ledger's stated on-time `dA1` of ≈13.95 min differs from my 13.73 min by the marker-posting latency; the conclusion is the same under either figure. (ii) **The resumability datum in the narrow form plan §6.2.5 defines it** — all five of its clauses hold (§4 criterion d). (iii) The kill *mechanism* — agent-stop — was exercised, and Q2 (what agent-stop leaves behind) is answered in §7.

*What it does not invalidate, contra a loose reading:* it does not invalidate criteria (a), (b), (b′), (c) or (f), which are state checks over the branches, worktrees and event log and are indifferent to when the kill landed.

**D3 — checker invoked with `--repo` where the `.mjs` checkers take `--events` (07:26:17Z).** Plan §7 overstates a uniform `--repo` first argument; `tools/lanes/README.md` line 29 documents the actual split. The checker **exited 2 with a usage message rather than guessing** — fail-closed, which is the behaviour we want and is itself a small piece of evidence about the tooling. *Invalidates:* nothing. *Leaves intact:* everything; the re-invocation with `--events` produced the committed output. *Consequence:* plan §7's argument description is stale; the README is correct.

**D4 — the mid-trial model directive (07:21:45Z).** Recorded in §3. *Invalidates:* any comparison of `dA2` against `dA1`/`dB` as same-population samples, and any claim that the resume's *output* is what the killed lane would have produced. *Leaves intact:* every §6.2.5 resumability clause (durable-state briefing, normal completion handback, sha stability, (a)/(b)/(f) green, surviving lane untouched), and the `S0`/fanned identity, in which `dA2` appears on both sides.

### 3.2 Deviations against the plan found in the *evidence*, not declared in the ledger

Two obligations the plan set were not met, and the honest place for them is here rather than §12.

- **The lock heartbeat was never performed.** Plan §5.1 requires a lock rewrite whenever its age exceeds 25 min; `advance.md` step 0 requires one at least every 30 min; acceptance criterion §15.4 requires the rewrites to be "visible in the ledger". Cardinality: **0 heartbeat entries in 50 ledger lines.** The lock was held **33.16 min** — past both the 25-min plan trigger and the 30-min `advance.md` obligation, and released 11.8 min before the 45-min staleness bound. No harm resulted, and no second tick contended for the lock. But the heartbeat rule is exactly the machinery that makes long fanned ticks safe, and this trial did not demonstrate it. **Acceptance criterion §15.4 is NOT met.**
- **Lock operations are under-ledgered.** Cardinality: **1** explicit lock operation in the ledger (`release advance.lock`, 07:26:43Z) against at least four expected (T1 take, T1 release, T2 take, T2 release). T1's take is only *implied*, by the two `kill -0 5285` liveness samples at 06:53:33Z and 06:53:45Z. Those two samples are 12 s apart and both sit in setup, so **pid liveness was sampled at setup, not "across the tick"** as §15.4 requires either.
- **Criterion (b′) was not re-run after T2.** Plan §7's table row says the disjointness gate runs "pre-fan + post-trial"; plan §6.2.4's step list asks only for (a), (b), (f) at T2 end. The evidence follows §6.2.4: `evidence/checks/T2/` contains no `bprime.txt`. Since neither branch changed between T1 end and T2 end (the resume added zero commits, and lane B's branch is byte-identical), a post-T2 b′ run would have examined the same 34 paths — but it was not run, and "would have passed" is not evidence.

---

## 4. Ships-clean scoreboard

**Cardinality first.** Six ships-clean criteria (a)–(f), covered by **seven checkers** (b′, the pair-disjointness gate, is the seventh). **19 evidence files committed** across two windows — `evidence/checks/T1/` 8, `evidence/checks/T2/` 11 — carrying **18 verdicts: 17 checker runs plus the sha-stability assertion. 18 of 18 PASS, zero FAIL.** (The nineteenth file, `checks/T2/prekill-shas.txt`, is the three-sha input the assertion consumes, not a verdict.) Every checker was shown failing against a planted violation in phase 1 **before** the trial ran (24/24 falsification tests, `evidence/falsification/node-test-phase1.txt`, node v24.13.1, tree at commit `1744077`; gate verified independently by the orchestrator at 06:16:46Z with an independent re-run of the suite). Re-running that suite cold is the reviewer's step, not phase 3's; what is asserted here is what the committed outputs say.

| # | criterion | runs | result | cardinality (as printed) | evidence | falsification |
|---|---|---|---|---|---|---|
| **a** | zero `.lattice/` on task branches | 4 (A and B, at T1 end and T2 end) | **PASS** ×4 | A: 12 changed files; B: 3 changed files (identical at both windows) | `checks/T1/a-lane{A,B}.txt`, `checks/T2/a-lane{A,B}.txt` | `test/check-branch-clean.test.mjs` — planted committed `.lattice/events/` file on a task branch, failed with exactly that path |
| **b** | diff confinement + clean trees | 4 | **PASS** ×4 | A: 12 files / 2 working trees; B: 3 files / 2 working trees | `checks/T{1,2}/b-lane{A,B}.txt` | `test/check-confinement.test.mjs` — out-of-prefix commit; dirty worktree; dirty main checkout; each failed with exactly its one item |
| **b′** | pair disjointness (gate) | 3 executed (2 pre-fan, 1 at T1 end); **1 output committed**; **0 post-T2** | **PASS** (committed run) | 3 tasks / 3 pairs / 34 diff paths (12 + 3 + 19) | `checks/T1/bprime.txt`; runs ledgered at 06:53:57Z, 06:54:17Z, 07:25:58Z | `test/check-disjoint.test.mjs` — overlapping prefix sets; one file in both branch diffs |
| **c** | event-log integrity + write-fence | 2 (T1 window; T1+T2 combined) | **PASS** ×2 | T1: 597 events / 60 tasks / 8 in-window / 3 attributed tasks. Combined: 601 events / 60 tasks / 12 in-window / 3 attributed tasks | `checks/T1/c.txt`, `checks/T2/c-combined.txt` | `test/check-event-integrity.test.mjs` — corrupted from-state; duplicate claim; unledgered in-window event; mis-attributed in-window comment |
| **d** | kill-one-lane resumability | 1 precondition run + 1 sha-stability assertion (+ the (a)/(b)/(f) re-runs above) | **PASS** | 4 preconditions for AS-41; 3 pre-kill shas vs final head `26a8dfa` | `checks/T2/d-preconditions.txt`, `checks/T2/prekill-shas.txt`, `checks/T2/sha-stability.txt` | `test/check-resume-preconditions.test.mjs` — branch-link removed (predicted 2-item set {branch-link, worktree}); scaffold plan |
| **e** | measurement integrity | 1 | **PASS as a measurement** — see §5 for the ruler it feeds | 601 events / 60 tasks / 48 ledger lines / 39 `status_changed` in the S_real window | `checks/T2/e-metrics.txt` | `test/compute-lane-metrics.test.mjs` — missing spawn marker (hard fail, no fabricated metric); ledger divergence 90 s; two hand-computed fixtures at R = 0.6 and R = 0.4 reproduced exactly |
| **f** | per-employee git identity | 4 | **PASS** ×4 | A: 3 commits; B: 1 commit (identical at both windows) | `checks/T{1,2}/f-lane{A,B}.txt` | `test/check-git-identity.test.mjs` — commit authored `developer-marcus-webb` (the AS-53 drift); canonical name with non-canonical email |

**Reading the scoreboard.**

- **Criterion (c) is the one that answers question 1**, and it answers it cleanly: over the full 601-event log, every `status_changed.from` replays correctly, there is no overlapping duplicate assignment, every in-window comment on the three configured tasks is attributed to an expected actor, and **every one of the 12 in-window events matched a ledger entry within 60 s**. Zero unaccounted board events means zero fence trips. The phase-1 baseline (574 events / 60 tasks / 0 in-window, PASS, recorded before the trial) makes this non-vacuous: a trial-time FAIL would have been trial-caused.
- **Criterion (d) passed in the narrow sense the plan defined**, and §3.1/D2 states what that sense excludes. All five §6.2.5 clauses hold: the resume ran from durable state alone (archived prompt), the stage reached its normal completion handback, the 3 pre-kill shas are unchanged ancestors of the final head, (a)/(b)/(f) pass on the final branch, and the surviving lane's artifacts are byte-identical between T1 end and T2 end (`bc7a39f`, 3 files, +35/−10, with AS-34's lifecycle undisturbed).
- **Criterion (e) passed as a measurement and does not carry a "yes" verdict.** The script emits every §9.1 quantity with a per-number event-id citation, the ledger cross-check holds within 60 s, and the arithmetic identity `S0 − fanned = savings` self-checks green. What the numbers then mean, under thresholds fixed before they existed, is §5 and §8.
- **(b′)'s missing post-T2 run and §3.2's heartbeat gap are the two places this scoreboard is thinner than the plan asked for.** Neither is a failure; both are absences, and they are named rather than smoothed over.

---

## 5. Measurements

Every number below is quoted from `evidence/checks/T2/e-metrics.txt` unless marked **[derived]**, in which case the derivation and its inputs are shown. Nothing here is estimated. All quantities are wall-time inside the windows recorded in `evidence/trial-config.json` (T1: 06:54:38Z – 07:25:45Z; T2: 07:30:26Z – 07:46:57Z); the 3.72-min gap between the ticks is counted in no fan number, satisfying §9.2.4.

### 5.1 The instrumented quantities (plan §9.1)

| quantity | value | source event id(s) |
|---|---|---|
| `tA_spawn` | 2026-09-02T06:54:51Z | `ev_01M1GECA4RE5Y135R35CFS8Z0B` |
| `tA_kill` | 2026-09-02T07:22:40Z | `ev_01M1GFZ82QNBPK2XWJDWZR44RR` |
| `tB_spawn` | 2026-09-02T06:54:51Z | `ev_01M1GECAAMG46JDRPZ1P0K3B04` |
| `tB_return` | 2026-09-02T07:04:18Z | `ev_01M1GEXKE9Y7VQZ2YFASHWRR88` |
| `tA2_spawn` | 2026-09-02T07:30:26Z | `ev_01M1GGDEWXSV2M5AJYPH94VJZX` |
| `tA2_return` | 2026-09-02T07:46:46Z | `ev_01M1GHBC2KZ8J0DTWGVAZWNSAR` |
| `dA1` | **27.82 min** | `tA_kill − tA_spawn` |
| `dB` | **9.45 min** | `tB_return − tB_spawn` |
| `dA2` | **16.33 min** | `tA2_return − tA2_spawn` |
| `W_T1` (fan window) | **27.82 min** | `max(tA_kill, tB_return) − min(tA_spawn, tB_spawn)` |
| `overlap` | **9.45 min** | `min(tA_kill, tB_return) − max(tA_spawn, tB_spawn)`, floored at 0 |
| `savings` | **9.45 min** | `dA1 + dB − W_T1` |
| **R** | **1.0000** | `savings / min(dA1, dB)`; available parallelism = 9.45 min |
| `overhead` | **0.00 min** | `W_T1 − max(dA1, dB)` |
| `S0` (zero-gap serial) | **53.60 min** | `dA1 + dA2 + dB` |
| fanned campaign cost | **44.15 min** | `W_T1 + dA2` |
| identity self-check | **OK** | `S0 − fanned = 9.45 min = savings` |
| `S_real` (context only) | **72.09 min** | `S0 +` median gap 18.49 min; 34 gaps used, 4 excluded at ≥ 60 min; filter: company-wide `status_changed`, 2026-09-01T07:46:57Z – 2026-09-02T07:46:57Z, consecutive gaps, median |

### 5.2 What these numbers do and do not measure — three defects, stated before the thresholds are applied

**(i) R = 1.0000 is structurally pinned, not measured. [derived]** With `W_T1 = max(end) − min(start)`, if `tA_spawn = tB_spawn` then `W_T1 = max(dA1, dB)`, so `savings = dA1 + dB − max(dA1, dB) = min(dA1, dB)` and `R ≡ 1` **algebraically**, for every possible pair of lane durations. R can only read below 1.0 when the spawn markers are *staggered*. In this trial the two markers were written 163 ms apart in one board-write batch (`ledger-T2.jsonl` lines 19–20) and round to the same second. So R = 1.0000 records one fact — the two spawn markers landed in the same second — and carries no information about orchestration efficiency. The same identity forces `overhead = W_T1 − max(dA1, dB) = 0.00` for the same reason. **Both of the plan's two efficiency metrics are degenerate under simultaneous starts.** This is a defect in the §9.1 metric definition, discovered by running it, and §12 carries it forward.

**(ii) The informative orchestration cost is outside the marker window. [derived]** The marker-defined fan window is 27.82 min; the tick that contained it held the lock for **33.16 min** (06:53:33.371Z → 07:26:43.201Z). The difference, **5.34 min**, is the real orchestration cost — setup, fence application, the disjointness gate, the board FYI, the pre-fan transitions and commits, the T1-end checker runs, evidence commit, push and lock release. It is **under** the plan's 10-min flag, but it is emphatically **not** the pre-committed `overhead` metric and is not substituted for it in §8. It is reported here because a reader who sees `overhead = 0.00` and stops has learned nothing true.

**(iii) Marker skew inflates both lane durations. [derived]** The spawn markers were posted at 06:54:51.6/.8Z but the sub-agents were actually launched at 06:56:28.087Z — a **1.61 min** skew, applied identically to both lanes. On the return side, the orchestrator's own comment records lane B completing at ≈07:02Z against a return marker at 07:04:18Z, a **2.30 min** lag. So lane B's measured `dB` of 9.45 min contains ≈3.9 min of marker skew against a true agent runtime of ≈**5.53 min** — **41% of the measured shorter-lane duration is instrumentation, not work.** This does not move R (the identity in (i) is skew-invariant), but it makes the power floor bite harder, not softer: the true `min(lane duration)` is ≈5.5 min, further below the 15-min floor than the measured 9.45 min.

### 5.3 Serial baselines

- **`S0` = 53.60 min** — the zero-gap serial baseline, deliberately generous to serial: kill-and-resume cost (`dA2`) appears identically on both sides, so the comparison never credits the fan for the interruption it caused. Fanned campaign cost is 44.15 min. The difference is 9.45 min, which is `savings` by the arithmetic identity the script asserts.
- **`S_real` = 72.09 min** — context only, never a verdict input, per plan §9.1. It adds the median inter-transition gap of real loop time (18.49 min, from 34 qualifying gaps in the 24 h ending at T2's end, with 4 gaps ≥ 60 min excluded as dead cadence) to `S0`.

**Read honestly, the campaign saved 9.45 measured minutes on a 53.60-minute serial baseline — 17.6%** — and every one of those minutes is the shorter lane nesting inside the longer one, on a shorter lane whose true runtime was ≈5.5 min.

### 5.4 The thresholds, applied verbatim (plan §9.2)

| # | ruler, as written on 2026-09-02 before any data existed | measured | result |
|---|---|---|---|
| 1 | "**The fan pays** iff R ≥ 0.5." | R = **1.0000** | **PASSES** — but see §5.2(i): R is algebraically pinned at 1 by simultaneous spawn markers, so this pass is uninformative |
| 2 | "**Power floor:** if `min(dA1, dB) < 15 min`, the trial is underpowered for question 4 … and the (e) verdict is at most **qualified — remeasure on a pair with both lanes ≥ 30 min** — regardless of which side of 0.5 R lands on." | `min(dA1, dB)` = `dB` = **9.45 min** < 15 min (true runtime ≈5.53 min, further below) | **TRIPS — the (e) verdict is capped at *qualified*** |
| 3 | "**Overhead flag:** overhead > 10 min is a lanes finding … even if R passes." | overhead = **0.00 min** | **no flag** (and see §5.2(i)–(ii): 0.00 is structural; the informative 5.34 min is also under 10) |
| 4 | Clock discipline: every quantity is wall-time within named windows recorded in `trial-config.json`; no cross-tick gaps in any fan number. | windows recorded; the 3.72-min inter-tick gap excluded from all fan numbers | **holds** |

Threshold 2 was written to be un-rescuable in either direction, and it does its job here: it caps a result that threshold 1 would otherwise have waved through. Plan open question Q4 asked exactly this ("will AS-34's lane clear the 15-min power floor?") with the pre-agreed answer *run the pair anyway and take the honest cap*. **The floor tripped; the cap is taken.**

### 5.5 Not measured

- **The dirty-residue kill case** (§3.1/D2): not exercised.
- **Resume-by-continuation from a partial implementation** (§3.1/D2): not exercised.
- **A staggered-start fan**, the only shape in which R and `overhead` are non-degenerate (§5.2(i)): not exercised.
- **A D1+D1 fan** with its known route-registration contention: out of scope for trial one by design (the description's disjointness-first rule) and not exercised.
- **Heartbeat behaviour on a long lock** (§3.2): not exercised.
- **A watcher-fired fan**: not attempted, and §6 explains why it must not be.

---

## 6. Question-3 answer — the tick-duration budget

**The question (task description item 3):** watcher-fired ticks are SIGTERMed at `tickTimeoutMin = 30`; the heartbeat obligation is a rewrite every 30 min; staleness is `lockStaleMin = 45`. Does a fanned tick fit any watcher budget?

**Method (plan §9.4).** For every task stream in `.lattice/events/` I paired `status_changed` events into stage windows — `in_progress → review` = implementation, `review → done|in_progress|in_planning` = review — and grouped them by the app prefix of the task's own non-board commits across all refs. **Cardinality: 60 task streams examined, 41 implementation windows and 35 review windows recovered, across 4 app groups plus one task with no code commits.** (Query is read-only; it is reproducible from the event log and `git log --all --name-only`.)

**Implementation stages (`in_progress → review`), minutes:**

| group | n | p50 | p75 | max | min | over 30 min |
|---|---|---|---|---|---|---|
| `apps/chat/` | 27 | 6.4 | 9.8 | 81.0 | 2.3 | 2 |
| `docs/` | 7 | 40.1 | 46.7 | 74.2 | 28.8 | 6 |
| `apps/invoicing/` (D1) | 5 | **70.2** | **88.4** | **381.3** | 23.6 | 4 |
| `personnel/` | 1 | 3.1 | 3.1 | 3.1 | 3.1 | 0 |
| all | 41 | 9.4 | 31.0 | 381.3 | 2.3 | 12 |

**Review stages (`review → done|rework`), minutes:**

| group | n | p50 | p75 | max | min | over 30 min |
|---|---|---|---|---|---|---|
| `apps/chat/` | 24 | 5.9 | 9.2 | 38.9 | 3.0 | 1 |
| `docs/` | 5 | 37.4 | 43.8 | 65.3 | 19.6 | 3 |
| `apps/invoicing/` (D1) | 4 | **51.4** | **89.3** | **176.8** | 30.4 | 4 |
| `personnel/` | 1 | 1.5 | 1.5 | 1.5 | 1.5 | 0 |
| all | 35 | 6.8 | 24.2 | 176.8 | 1.5 | 8 |

Every one of the five D1 implementation stages: 381.3, 88.4, 70.2, 51.9 (AS-41 itself, T1+T2 combined), 23.6 min. **Four of five exceed the entire watcher tick budget on their own**, and all four D1 review stages do too.

**The arithmetic.** A fanned tick costs `max(lane durations) + orchestration`. This trial measured orchestration at **5.34 min** (§5.2(ii)) — a floor, not a ceiling, since it was measured on a fan where one lane was killed rather than handed back and reviewed.

- **D1 + D1:** p50 lane 70.2 min ⇒ tick ≈ **75.5 min**. Against a 30-min SIGTERM: **2.5× over**. Even the single fastest D1 implementation stage ever recorded (23.6 min, AS-53) gives 23.6 + 5.34 = **28.9 min** — inside 30 by 1.1 minutes, on the best draw in company history. Not a budget; a coin flip.
- **D1 + chat (this trial's shape):** the killed-lane fan already ran **33.16 min** of held lock and a **31.12 min** recorded window. It did not fit, with its D1 lane terminated at 27.8 min rather than completing. Had lane A run to its natural handback, AS-41's implementation stage totalled 51.9 min of board time; the tick would have been far past 30.
- **chat + chat:** p75 lane 9.8 min ⇒ tick ≈ **15.1 min**, comfortably inside 30. But 2 of 27 chat implementation stages exceeded 30 min alone (81.0 and 30.8), an empirical per-lane rate of 7.4%, so a two-lane chat fan has a **≈14.3% chance** that at least one lane alone blows the whole tick budget — `1 − (25/27)² = 0.1427`. **[derived]**

**Answer, explicitly.** **No fanned tick fits the watcher budget today, and lanes must be live-loop / supervised-manual-session only.** The one shape that fits on paper — chat + chat — carries a ~1-in-7 per-fan risk of SIGTERM mid-fan, which is the worst possible failure for lanes specifically: a watcher SIGTERM at 30 min kills the orchestrator and leaves **two** half-states with **two** board rows that may not have been transitioned, which is precisely the "a tick that dies mid-fan leaves two half-states instead of one" risk record 11 §4 named. WIP=1 watcher ticks have one.

**If the numbers were ever to change, the change is named and is not ours to make silently.** Raising `tickTimeoutMin` past a D1-scale fan means editing `apps/chat/watch/advance-watcher.mjs` config **and** the launchd plist that runs it — a **board-visible ops change**, requiring board approval, and explicitly out of scope for AS-60 (the task description says so, and this spike does not touch a watcher file). Note that raising the SIGTERM budget alone is not sufficient: `lockStaleMin = 45` and the 30-min heartbeat obligation are the other two constants in the same budget, and a 75-min fan needs a working heartbeat — which §3.2 records this trial did not demonstrate. All three constants move together or none do.

---

## 7. The relay design, as validated

**The design (plan §5.3).** Lane sub-agents are forbidden to touch `.lattice/` and never run the `lattice` CLI. Each lane returns, in its final report: (i) breadcrumb comment texts it authored, (ii) a status recommendation, (iii) files touched, (iv) commits made. The orchestrator posts the breadcrumbs **verbatim** under `--actor agent:<authoring-employee>` — correct under the standing attribution rule, "attribution follows authorship of the decision, not the keystroke" — and executes the transitions itself. Trial markers (`lanes-trial:` prefix) are orchestrator-authored under `agent:cto-owen`.

**What actually ran.** Both archived lane prompts (`evidence/prompts/lane-A-prompt.txt`, `lane-B-prompt.txt`) carry the prohibition in identical form — *"you do not touch `.lattice/` at all and you never run the `lattice` CLI. Not to read, not to comment, not to transition."* — plus the handback contract, and neither contains any board-write instruction, any mention of the other lane's content, the kill test, or any expected measurement. Two relayed breadcrumbs were posted: lane B's under `agent:developer-lena` at 07:04:18Z, the T2 resume's under `agent:developer-marcus` at 07:46:46Z. Checker (c) validated attribution of all 12 in-window events against the expected-actor map: **PASS, 3 attributed tasks**. Relay fidelity — that the posted text matches the archived lane report verbatim with no markers injected into employee breadcrumbs — is Ruben's to assert in review; what I can confirm from the record is that the two employee breadcrumbs and the four `lanes-trial:` markers are **separate comments with separate actors**, never merged.

**Four findings about the relay, from running it.**

1. **The total prohibition (no reads either) is only viable when the orchestrator can hand the lane everything it needs at spawn.** T1's prompts forbade even `lattice show`, and that worked because the orchestrator briefed each lane with its plan path and context. T2's resume prompt deliberately relaxes it to **write-only** — *"you do not touch `.lattice/` and you never run the `lattice` CLI **to write**. Reading with `lattice show` is expected and required"* — because a cold resumer's entire discovery surface is the task's comment stream. The proposed wording in §9 encodes this split: **lanes are write-fenced, not read-fenced, and a T1-style total fence is an optional tightening for lanes whose context is fully briefed.**
2. **Durable state carried the work but not the operational guardrails.** Found by `agent:developer-marcus` in the T2 resume: a resumer working from durable state alone had no way to learn that running `docker compose down` in the default project would stop the **live** web container on 8348. The guardrails reached him only through his tasking message. He declined to add the missing README note himself rather than expand his task's scope unilaterally, and the CTO filed his exact proposed wording into AS-59 at 07:48:10Z. This is a genuine hole in "resume from durable state alone": durable state is sufficient for *what to build* and insufficient for *what not to break*.
3. **The relay does not preserve authorship of a killed lane — by construction.** A terminated sub-agent returns nothing, so the orchestrator authored the kill breadcrumb under `agent:cto-owen`. That is the correct attribution (it *is* the orchestrator's decision and observation), and it is also the reason the kill comment is scrupulously hedged: *"Unknown to the orchestrator: whether the suite passed, which acceptance criteria are met, and what remains."* The resume prompt then instructs the resumer to treat it as a pointer, not a verdict — AS-36 anchoring discipline applied to a resumer. Marcus confirmed he did: *"I treated the kill comment as a pointer, not a verdict — nothing below is inherited, all of it re-derived."* **The lanes protocol must keep that hedge mandatory:** a kill breadcrumb that asserted the work was fine would have contaminated the only independent check the resume provides.
4. **The relay was breached once, in phase 1, and the breach was self-reported.** Plan §3 says phase 1's breadcrumbs are relayed; the orchestrator's phase-1 tasking instead told me to post directly, and I flagged the mismatch rather than resolving it silently (AS-60 comment, phase-1 deviation 8). Consequence: the relay's first live exercise was T1, not phase 1. No board-state harm — the write came from the main checkout under my own actor id, which is the normal rule.

**Q2 — what agent-stop leaves behind (plan §17).** Answered by observation: **nothing that kept writing.** Residue at 07:22:40Z was a clean worktree (0 porcelain entries), 3 commits on the branch, and no surviving `as41` containers; the live containers on 8347 and 8348 were untouched and healthy. Notably the lane's final action was tearing down its isolated compose project and its last line reported *retrying* a stripe-mock teardown — **the kill landed during that retry, so container cleanup completed by luck rather than by the lane finishing it.** No A3 zombie-writer condition arose (poll log shows lane A's head and porcelain static from 07:17:36Z onward, five polls before the kill). The honest generalization is narrow: agent-stop left no zombie writer *in this instance*, and a kill during a container teardown is a case where it easily could have. The §6.1.5 quiescence check stays mandatory.

**Q3 — the lock-pid liveness wrinkle (plan §5.1).** The session-ancestor pid (5285) was verified alive at 06:53:33Z and 06:53:45Z and no fallback sentinel was needed. Disposition: **partially validated.** The two samples are 12 s apart and both in setup, so the trial demonstrates the pid *exists and is checkable*, not that it is *stable across a long tick* — acceptance §15.4's actual wording. Combined with the missing heartbeat (§3.2), the long-manual-tick lock discipline is the least-evidenced part of this spike, and §9's proposed wording makes both obligations explicit and ledger-visible rather than assumed.

---

## 8. VERDICT

**QUALIFIED — the mechanism ships clean, the payoff does not yet count: 18 of 18 committed verdicts passed across the six ships-clean criteria with zero board-state corruption and a clean kill-and-resume, but the plan's pre-committed power floor (§9.2.2) tripped at `min(dA1, dB) = 9.45 min < 15 min`, so the "does the fan pay" verdict is capped at *qualified — remeasure on a pair with both lanes ≥ 30 min*, and the R = 1.0000 that would otherwise carry it is algebraically pinned at 1 by simultaneous spawn markers rather than measured, so it is not evidence of anything.**

Restated as the four questions:

1. **Concurrent active stages without board-state corruption — YES.** 601 events replay clean, 12 of 12 in-window events ledger-accounted, zero `.lattice/` paths on either branch, both worktrees and the main checkout clean, correct per-employee identities on all 4 commits. Every checker behind this was seen red first.
2. **What must change — delivered** as exact proposed wording in §9, unapplied.
3. **Watcher budget — NO, at any pairing that matters** (§6). Lanes are live-loop / supervised-manual only. Changing that is a board-visible watcher-config + launchd-plist change this spike does not make.
4. **Does the fan pay — UNPROVEN, capped at qualified.** 9.45 min saved on a 53.60 min serial baseline (17.6%), on a trial whose shorter lane was 9.45 measured / ≈5.53 true minutes, using two efficiency metrics that are degenerate under simultaneous starts.

### What observation would change this verdict

Stated with its window and its clock, per record 11 §9.11 rider 1 (an unstated window is an argument scheduled for the worst possible moment) and feasibility-checked per rider 2.

**Upgrade to YES** — all four conditions on one supervised fan, measured with the same `tools/lanes/` checkers and the same §9.2 rulers, unmoved:

- **(U1)** both lanes ≥ 30 min from spawn marker to return/kill marker, so `min(dA1, dB) ≥ 15 min` clears the power floor with margin;
- **(U2)** spawn markers deliberately **staggered by ≥ 60 s**, so R is free to read below 1.0 and the number means something (this is a change to the *procedure*, not to the ruler);
- **(U3)** R ≥ 0.5 and overhead ≤ 10 min under the unchanged §9.2 thresholds;
- **(U4)** criteria (a), (b), (b′), (c), (d), (f) green on both lanes, with the ledger accounting for every in-window event.

**Window and clock:** the **first three supervised lanes ticks that actually fire**, measured in **loop-time** (ticks that fire, not calendar days) — the same clock record 11 §9.11 specifies for the §9.8 obligation. Feasibility check, per rider 2: is that window reachable? `apps/invoicing/` implementation stages have p50 70.2 min and 4 of 5 over 30 min, so a D1+D1 fan satisfies U1 on the first attempt by the distribution's own shape; the constraint is supervised-session availability, not stage length. This falsifier can fire inside the horizon of the decision it guards.

**Downgrade to NO** — any **one** of these on any single supervised fan, in the same window and clock (labelled N1–N4 to keep them distinct from §3.1's deviations D1–D4):

- **(N1)** any of criteria (a), (b), (b′), (c), (f) FAIL, or any in-window board event that the ledger cannot account for within 60 s (a fence trip);
- **(N2)** R < 0.5 on a fan that satisfies U1 and U2;
- **(N3)** a fan that dies mid-flight and cannot be resumed from `.lattice/` state plus `lattice branch-link` alone — the two-half-states failure record 11 §4 named;
- **(N4)** overhead > 10 min under the §9.2.3 flag.

**What would NOT change it:** another underpowered fan, in either direction. A second R = 1.0000 on a pair with a sub-15-minute lane is the same non-measurement twice, and §9.2.2 caps it identically. A repeat is not evidence.

---

## 9. Proposed metawork wording — **NOT APPLIED**

Employees never edit `.claude/commands/advance.md`, `CLAUDE.md`, `README.md`, `PHILOSOPHY.md`, or `agents.md`. Everything in this section is **exact replacement text for the metawork layer to apply, or not**, and **none of it is applied by AS-60**. All of it is gated on §11's filing gate: verdict *yes* plus an explicit `#board` green-light. **The current verdict is *qualified*, not *yes*, so on today's evidence none of this should be applied yet** — it is written now so the follow-up task is mechanical when and if the gate opens, and so the board can veto specific wording rather than a summary of it.

### 9.1 `advance.md` — step 0 (lock protocol): **UNCHANGED — asserted, not edited**

The task description made the lock/nonce contract an invariant: *"The single-flight lock stays. Lanes live UNDER one lock-holding tick. The watcher's lock/nonce contract … is unchanged unless the spike names the change precisely and argues why it is safe."*

**Assertion: this spike names no change to step 0.** The trial took a `source: "manual"` lock with the existing `wx` protocol, held it across the fan, and released it at tick end. `decide()` treats a fresh foreign manual lock as `skip-locked` with no accommodation, which is the desired behaviour and was not modified. The nonce adoption rules, the staleness rule, and the watcher's `settle()` release are untouched by lanes, because a lanes tick is one tick holding one lock. **Step 0 is to be left byte-identical.**

One *observed* gap sits inside step 0's existing text rather than requiring new text: the heartbeat obligation it already states ("MUST rewrite the lock with a fresh `startedAt` at least every 30 minutes") was **not honoured by this trial** (§3.2). The fix is enforcement and evidence, proposed in §9.2's Bounds text, not a change to step 0's rule.

### 9.2 `advance.md` — Bounds, first bullet

**Replace:**

> - One tick advances one task by one lifecycle stage, or performs one org-level action. Do not marathon multiple tasks in a single tick.

**With:**

> - One tick advances one task by one lifecycle stage, or performs one org-level action. Do not marathon multiple tasks in a single tick. **Single exception — a supervised lanes tick (live `/loop` or manual session only; NEVER watcher-fired), which may advance up to two mutually file-disjoint tasks by one implementation stage each, under a single orchestrator who is the sole board writer.** Lanes never share an agent, never share files, and never write board state. Five conditions, all of them checkable, all of them required before the fan and recorded in the tick output: (1) `tools/lanes/check-disjoint.sh` passes on the pair's declared file scopes at fan start — a fan whose lanes can touch the same file is not a lanes tick, it is a merge conflict with extra steps; (2) each lane's `.lattice/` copy is write-fenced (`chmod -R a-w .worktrees/AS-<n>/.lattice`, reverted at teardown) so a stray board write fails loudly instead of silently landing on a task branch; (3) every board mutation the orchestrator makes is appended to a ledger, and `tools/lanes/check-event-integrity.mjs` accounts for every in-window event against it at tick end; (4) the lock is heartbeated on the schedule step 0 already requires, and **each rewrite is ledgered** — an unledgered heartbeat is an unproven one; (5) the seven `tools/lanes/` checkers — the six ships-clean criteria plus the b′ disjointness gate — run green at tick end, outputs recorded. **Watcher-fired ticks stay at WIP=1**, unconditionally: no observed pairing of implementation stages fits the 30-minute `tickTimeoutMin` budget (`docs/engineering/03-parallel-lanes-spike.md` §6), and raising that budget is a watcher-config plus launchd-plist change requiring board approval, together with `lockStaleMin` and the heartbeat interval, which move as one set or not at all.

### 9.3 `advance.md` — step 2, the `planned`/`in_progress` bullet

**Replace:**

> - A task `planned` or `in_progress` → run or continue the implementation stage: code + tests commit on the task branch INSIDE its worktree (`.worktrees/AS-<n>/`); board state (status, comments) commits to master from the main checkout.

**With:**

> - A task `planned` or `in_progress` → run or continue the implementation stage: code + tests commit on the task branch INSIDE its worktree (`.worktrees/AS-<n>/`); board state (status, comments) commits to master from the main checkout. **In a supervised lanes tick (Bounds), up to two such tasks may run as concurrent implementer sub-agents in their own worktrees, provided the Bounds conditions are met.** Under lanes the implementer sub-agent is **write-fenced from board state**: it never runs `lattice` to write and never modifies any `.lattice/` path. It returns its breadcrumb text, a status recommendation, the files it touched, and the commits it made; the orchestrator posts each breadcrumb **verbatim** with `--actor agent:<the authoring employee>` and executes every transition itself. Reads (`lattice show`) stay available to a lane and are required for a cold resume; a tightened read-and-write fence is appropriate only for a lane the orchestrator has fully briefed at spawn. **Statuses move before the lanes spawn, not after**, per the cardinal rule. If a lane is killed or dies, its task **stays** in `in_progress` and the orchestrator posts the kill breadcrumb itself under its own actor id — stating what was killed, when, at which commit, and what residue was left, and **explicitly disclaiming any judgment about whether the work is sound**, so the resumer treats it as a pointer rather than a verdict.

### 9.4 `CLAUDE.md` — Operating Modes, new paragraph after "**The loop is the company (target state).**"

**Insert:**

> **Parallel implementer lanes — supervised only (spike result 2026-09-02, AS-60).** A tick may fan into **two** implementer sub-agents in two worktrees, on two mutually file-disjoint tasks, under one orchestrator who is the **sole board writer**. This raises WIP from 1 to 2; it does not add a second lock, a second tick, or a second board writer, and the watcher's lock/nonce contract is unchanged. **Lanes are live-session / supervised-manual only.** Watcher-fired ticks stay at WIP=1: measured stage durations (`docs/engineering/03-parallel-lanes-spike.md` §6) put every D1-scale fan far past the watcher's 30-minute SIGTERM, and a SIGTERM mid-fan leaves *two* half-states instead of one. The spike's verdict was **qualified**, not unconditional: board-state safety was demonstrated (17 of 17 checker runs green, every checker seen red first), the throughput payoff was not — the measured pair was underpowered against the spike's own pre-committed floor. Lanes are therefore a supervised capability with a standing obligation to remeasure on a properly powered pair, not a settled default.

### 9.5 `CLAUDE.md` — Git Methodology, Concurrency section

**Replace the opening sentence:**

> One worktree per in-flight task; one agent per task per product at a time (board policy). Task claims and status transitions happen ONLY in the main checkout, so two agents can never claim the same task.

**With:**

> One worktree per in-flight task; one agent per task at a time (board policy) — **lanes mean more tasks in flight, never more agents on one task**. Task claims and status transitions happen ONLY in the main checkout, so two agents can never claim the same task.

**And append to that section:**

> **Lane worktrees are write-fenced (AS-60).** When a worktree is created for a lane in a supervised lanes tick, `chmod -R a-w .worktrees/AS-<n>/.lattice` at `git worktree add` time and `chmod -R u+w` at teardown (before `git worktree remove`, which needs writable directories). Git tracks only the executable bit, so the fence is invisible to every diff. Its purpose is to convert the AS-26 silent-redirect hazard — a `cd` into a worktree silently redirecting `lattice` writes onto the task branch, with every read afterward *looking correct* — into a loud `EACCES` inside the lane. Prompt discipline is not a control; the fence is. Pair it with the ledger cross-check (`tools/lanes/check-event-integrity.mjs`): every board event inside the tick's window must match a ledger entry within 60 s, and an event nobody can account for is a fence trip. **Lane sub-agents never run `lattice` to write and never modify any `.lattice/` path.** They may read (`lattice show`); a cold resumer's entire discovery surface is the task's comment stream.

### 9.6 `CLAUDE.md` — Employee Execution Model, new paragraph after the three-roles table

**Insert:**

> **Under lanes, the orchestrator is the sole board writer and relays breadcrumbs (AS-60, validated 2026-09-02).** Normally an employee posts their own Lattice comments. In a supervised lanes tick they cannot: two concurrent sub-agents double the AS-26 silent-redirect exposure, so lane sub-agents are write-fenced from `.lattice/` entirely. Each lane returns, in its final report: (i) the breadcrumb comment text it authored, ready to post verbatim; (ii) a status recommendation (stage complete / blocked / needs_human, with a one-line reason); (iii) the files it touched; (iv) the commits it made. The orchestrator posts each breadcrumb **verbatim** with `--actor agent:<the authoring employee>` — correct under the attribution rule, which follows authorship of the decision, not the keystroke — and executes the transitions itself. Orchestrator-authored instrumentation (spawn/kill/return markers) carries the orchestrator's own actor id and is a **separate comment**, never merged into an employee's breadcrumb. Two rules make this honest rather than a laundering mechanism: the relayed text is posted **unedited**, and the review gate is unaffected — every lane's work still goes through its own task's independent QA stage.

---

## 10. The §9.8 measurement obligation, carried forward verbatim

Carried from AS-60's task description, which carries it from `docs/strategy/11-second-developer-decision.md` §9.8 as sharpened by §9.11:

> **§9.8 MEASUREMENT OBLIGATION (carried here so it cannot get lost):** after lanes ship, the record-11 §3 overlap query must show a non-zero overlapping-pair count within one day OF RUNNING LOOP — and a count that stays 0 is itself a finding, returned to `docs/strategy/11-second-developer-decision.md` as a dated addendum. Clock discipline (the unstated-window defect is the §9.4(a) class; we are not writing another one): the one-day clock runs in loop-time, and a zero must be attributed — machinery-unused-at-dead-cadence is a cadence finding (rider §9.6.1), machinery-unused-despite-ticks is a lanes finding.

**Explicit distinction, because this trial makes it easy to get wrong.** The trial itself pushed the historical overlapping-pair count above zero for the first time in the company's life: between 06:54:51Z and 07:04:18Z on 2026-09-02, AS-41 and AS-34 both held `in_progress` (`overlap` = 9.45 min, §5.1). **That does NOT satisfy §9.8.** §9.8 measures **post-ship production use** — lanes running as a normal capability in ordinary ticks, after the follow-up task ships the loop change. A supervised experiment deliberately constructed to produce an overlap is not evidence that the shipped machinery gets used. Anyone reading the overlap query after this date must **exclude the AS-60 trial window** before judging §9.8, or the obligation self-satisfies on the very artifact it was written to check.

Two further notes for whoever discharges it:

- The clock is **loop-time** — one day in which ticks actually fire, not one calendar day.
- A zero must be **attributed before it is reported**: zero-at-dead-cadence is a cadence finding; zero-despite-ticks is a lanes finding. On this spike's own §6 answer, a third attribution is now possible and must be checked first: **zero-because-lanes-are-supervised-only** — if lanes never fire because no supervised session ran, that is neither a cadence finding nor a lanes finding but a consequence of the scoping this document recommends.

---

## 11. The follow-up implementation task, and the veto-window gate

**Not filed by AS-60.** It does not exist until the gate below opens. Scoped here (plan §11) so filing is mechanical:

> **Title:** advance loop: ship parallel implementer lanes (WIP=2) per AS-60's written result.
> **Scope:** apply the AS-60 §9 proposed wording to `.claude/commands/advance.md` (the metawork layer applies the `CLAUDE.md` edits); promote the trial's operational practice to procedure — sole-board-writer relay, `chmod` fence at `git worktree add`, `check-disjoint.sh` gate at fan start, ledgered board writes, **ledgered** heartbeat rewrites for long ticks, lock-pid liveness sampling across the tick rather than only at setup; wire the `tools/lanes/` checkers into the lanes tick's end-of-tick checklist; leave watcher-fired ticks at WIP=1 — AS-60 §6 answers question 3 as "no fanned tick fits the watcher budget", so any change there is a separate, board-approved watcher-config + launchd-plist line item.
> **Acceptance:** carries the §9.8 obligation verbatim (overlap query non-zero within one day of running loop, loop-time clock, attributed zero → dated addendum to record 11, AS-60 trial window excluded); lanes ticks run the seven `tools/lanes/` checkers green (plan §11 says "six" — it counts the six ships-clean criteria and omits the b′ gate, which is also a checker); the first production fan is supervised; and the first production fan is **staggered and properly powered** per AS-60 §8's U1/U2 so it discharges the remeasurement the qualified verdict owes.

**Filing gate — unchanged and not met today.** Filed only if the verdict is **yes** AND the board has explicitly green-lit in `#board` after this document is posted there. **A reply, not silence; silence parks the item as an open board ask** (record 11 §4: "I will not treat silence as enthusiasm"). Filed by the CTO, referencing this document.

**Today the verdict is *qualified*, not *yes*.** The first clause of the gate is therefore not satisfied on this evidence. Three courses are open to the board and the CTO, and it is not this document's place to choose among them: (a) treat *qualified* as insufficient and run the remeasurement fan (§8 U1–U4) under the current WIP=1 rules before filing anything; (b) file a narrowed follow-up that ships only the **safety** half — the fence, the disjointness gate, the ledger, the relay, the checkers — while leaving the Bounds WIP=1 line untouched, on the grounds that question 1 was answered *yes* outright; or (c) hold everything until a properly powered fan exists.

**Veto-window mechanics.** The clock starts when this document is posted to `#board` at AS-60's merge tick, per the fulfillment-check rule (plan §6.3.3). Until then no wording in §9 is applied and no follow-up exists.

---

## 12. Residuals and stale items

**From the trial (new).**

1. **The `R` and `overhead` metrics are degenerate under simultaneous starts** (§5.2(i)). `R ≡ 1` and `overhead ≡ 0` algebraically whenever both spawn markers share a timestamp. Any future lanes measurement must either stagger spawn markers by ≥ 60 s (§8 U2) or replace the metric with one that is not identity-pinned. This is a defect in plan §9.1's definitions, found by running them.
2. **Marker skew is unmeasured overhead inside every lane duration** (§5.2(iii)): 1.61 min on the spawn side, 2.30 min on lane B's return side — 41% of the measured shorter-lane duration. A future trial should ledger the marker *and* the actual spawn and report the skew as a first-class number.
3. **The dirty-residue kill case and resume-by-continuation were never exercised** (§3.1/D2, §5.5). The AS-26 rework-cycle-2 failure shape — a half-applied change on disk — remains untested under lanes. A future kill should fire on the pre-committed clock or be re-aimed deliberately at a mid-edit moment.
4. **Heartbeat and lock-op ledgering are unproven** (§3.2): 0 heartbeat entries in 50 ledger lines on a 33.16-min lock; 1 of ≥4 lock operations ledgered; pid liveness sampled twice, 12 s apart, both in setup. Acceptance criterion §15.4 is not met. §9.2's proposed Bounds text makes both obligations explicit.
5. **Criterion (b′) was not re-run post-T2** (§3.2). Plan §7's table and §6.2.4's step list disagree about whether it should have been; §6.2.4 won by default. Reconcile in the follow-up.
6. **The concurrency probe as specified would have aborted a healthy fan** (§2). Plan §6.1.3 specifies worktree file/commit activity; lane A produced none for its first eight minutes while reading. Any production probe must use sub-agent liveness, not worktree writes.
7. **A production `lattice` wrapper guard for worktree cwd** remains unbuilt. The `chmod` fence catches the AS-26 hazard at the filesystem; a wrapper that refuses to run when cwd resolves to a worktree's `.lattice/` would catch it at the CLI. Not in scope here; worth a task.
8. **The mid-trial model directive is a permanent confound on `dA2`** (§3.1/D4). Any future comparison of T1 and T2 lane durations from this trial is invalid.

**From the lanes themselves (attributed).**

9. **`agent:developer-marcus` (AS-41, T2 resume) — two findings against AS-41's own plan §7 predictions**, both filed in his relayed breadcrumb and neither this spike's to fix. Recipe F1's predicted failing set `{R3, R12}` was **narrower than observed** `{R3, R10, R11, R12}` — because the custody guard sits upstream of both the transport and `requireKey`, so a custody refusal pre-empts the 502 and 503 assertions. Recipe F2's predicted set was likewise narrow, and its stated *rationale* is wrong: R6 trips on the due-list mapping at `connect.test.js:267`, not on the readiness flag, because the fixture's `charges_enabled:false` keeps `ready` false regardless. His own note on the remedy is the right one and is repeated here so it is not lost: **fix the predictions, do not narrow the tests to match them.** He also added a sixth recipe (F6) unprompted, on the correct ground that a guard introduced by the diff and only ever seen passing proves nothing.
10. **`agent:developer-marcus` — the durable-state guardrails gap** (§7 finding 2), now carried in AS-59 with his exact proposed `apps/invoicing/README.md` wording.
11. **`agent:developer-lena` (AS-34, lane B) — two conventions future editors can break silently**: the 3b code line carries no trailing comment because the falsification recipe's anchor requires `fail();\n` immediately after the semicolon, and the docblock deliberately avoids the literal substring `real !== join` so it appears exactly once in `server.js`, keeping the assert-applied grep valid for future re-runs. Both are recorded in her breadcrumb; both are the kind of thing a reformatting pass destroys.
12. **`agent:developer-lena` (phase 1) — the plan's literal test-runner command does not run.** `node --test tools/lanes/test/` is a no-op on host node ≥ 23 (24.13.1 here); the canonical invocation is `node --test 'tools/lanes/test/*.test.mjs'`, quoted. Plan §8, §12 and §15.1 all carry the stale form, and §12's review template needs the substitution before Ruben runs it.

**From plan §16 (metawork FYI, unresolved, employees do not edit these).**

13. **AS-34's assignee** — resolved 2026-09-02 at its planning tick (Marcus → Lena). Closed.
14. **`CLAUDE.md` Operating Modes "known residual" paragraph** still tells ticks to avoid the chat CLI for reads and writes and use raw HTTP, while `advance.md` step 1 (post-AS-24) says the CLI self-routes and is the preferred path. The two contradict; the `CLAUDE.md` paragraph looks pre-AS-24-stale. Metawork call. **Still open.**
15. **The watcher README's one-paragraph summary** (≈line 22) still describes the spawn as a bare `claude -p '/advance' --permission-mode acceptEdits`, omitting the nonce marker and the AS-21 grants its own later sections document. Cosmetic staleness in a file this spike must not touch. **Still open.**
16. **AS-27** (loop-status UI) renders a single-tick-in-flight model. Its implementer should read this document first — specifically §6 (lanes are supervised-session only, so a watcher-driven status view stays single-tick) and §7 (a lanes tick has one board writer but two active tasks, which is the shape the UI would need to render). Restated here per plan §10.12 so it lands where AS-27's planner will find it.

**Plan text that is now stale** (for the tech lead to correct or annotate; the plan is board state and I do not write to `.lattice/`): §6.0.4's `trial-config.json` shape (D1), §7's uniform `--repo` argument description (D3), §6.1.3's concurrency-probe definition (residual 6), §7-vs-§6.2.4 on the post-trial b′ run (residual 5), and §8/§12/§15.1's test-runner command (residual 12).
