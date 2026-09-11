# AS-106 — Counted compose review runs leak one docker network per `-p` project; pool exhausts and voids runs

Planner: `agent:cto-owen` (Opus, Fable-limit fallback), tick watcher:86819 loop tick 14, 2026-09-11.
Implementer: **`agent:developer-lena`** — she wrote the AS-87/AS-88 project-isolation and teardown pattern in
`test/watcher-deploy-real.test.js` and `resolveDockerBin`, which this task generalizes; Marcus is the AS-98 →
AS-120 guard chain and the parallel Owen lane is planning AS-120 for him. Reviewer: **`agent:qa-priya`**
(Ruben filed this task and wrote its suggested shape — a reviewer who authored the shape is anchored on it).

## 1. Mechanism (measured, not argued)

`docker compose -p <name> -f apps/chat/compose.yaml run --rm --build test` does three things: builds
`<name>-test:latest`, creates the project's `default` network `<name>_default` (the `test` service has no
`network_mode`, so it attaches to `default`), and runs the container. `run --rm` removes **only the container**.
The network and the image survive until someone runs `down`. Every actor's recipe — `CLAUDE.md` compose
corollary, `docs/engineering/04-glossary.md:83`, `apps/chat/README.md:852`, every scratchpad `compose-run.mjs` —
says `--build` and the `Built` line and stops there. Docker Desktop's default address pool is ~30 `/16`
subnets; at 26–27 `asc-*` networks (Priya's and Ruben's independent counts, loop tick 8) the daemon refused
`failed to create network …: all predefined address pools have been fully subnetted` and voided **three
counted acceptance runs** across two reviewers, plus the orchestrator's own AS-95 merge receipt leaked two.

Measured this tick (`docker network ls`, read-only): **13 `asc-*` networks.** Three are live production
(`asc-chat_default`, `asc-invoicing_default`, `asc-invoicing_stripe-mock`), one is Ruben's in-flight
`asc-review-as102_default` (do not touch), and **nine are leftovers** from finished stages:
`asc-as93-marcus_default`, `asc-as93-mutant_default`, `asc-as94-lena_default`, `asc-as95-qa_default`,
`asc-as95-qa-2_default`, `asc-as95-qa-3_default`, `asc-as95-qa-master_default`, `asc-marcus95_default`,
`asc-chat-qa23_default` (2026-08-30). Note what is *absent*: no `asc-review-as8x`/`asc-impl-as1xx` networks —
lanes that copied the AS-87 `down -v --rmi local --remove-orphans` pattern did not leak networks (they did
leave `-test:latest` images: `asc-review-as115-test`, `asc-impl-as92-test`, … — `down` was run without
`--rmi local`, or not run). So the model works when it is used; the defect is that nothing *makes* it be used.

## 2. Decision: prevent at the source, wrap the run, observe leftovers, clean up once

Three mechanisms plus one attributed sweep. Scope is explicit; anything not listed is out.

**(a) No network at all for the test service.** `apps/chat/compose.yaml` `test` service gains
`network_mode: none` — exactly what `apps/invoicing/compose.yaml:80` already does. The suite is mountless
and self-contained (loopback still exists under `none`, so `api.test.js`/`live.test.js` binding 127.0.0.1 are
unaffected); a service with no network reference gives compose no `default` network to create, so
`run --rm` leaks nothing even when nobody tears down. **This is the load-bearing fix**; (b)–(c) are the
belt for the image and for any project that still uses `default`. Pinned by `test/deploy-shape.test.js`
(which already reads `compose.yaml` as data). *Open measurement (Q1, §7): whether compose v2 still creates
`default` for a project whose only started service is `network_mode: none`.* The implementer measures it
first (AC-1); if compose creates it anyway, (a) stays as documentation of intent and AC-1 is re-pointed at
(b)'s teardown — the plan records which, in a `## Measurement` note.

**(b) One canonical counted-run script, checked in: `apps/chat/bin/compose-run.mjs`**, pure logic in
`apps/chat/lib/compose-run.js` (host-testable without docker, like `lib/watcher.js`). Usage:
`node apps/chat/bin/compose-run.mjs --project asc-review-as106 --cwd <worktree>/apps/chat [--log <file>]`.
Behaviour:
1. **Project-name guard**: refuses (exit 2, no docker call) unless the name matches `^asc-[a-z0-9-]+$` and is
   not a production project name — read from the `name:` line of every `apps/*/compose.yaml` (`asc-chat`,
   `asc-invoicing`) — nor a running project reported by `compose ls` that this invocation did not create.
   Generalizes Priya's AS-28 `refusing: project name must be an AS-28 scratch project`.
2. **Pre-flight leftover check** (same as `--check`, below): counts `asc-*` networks; at or above
   `ASC_NETWORK_CEILING` (default **20**) it refuses (exit 3) and prints the leftover list with owners, so the
   failure arrives as a named refusal before the run, not a subnet error inside it (Ruben's shape).
3. Runs `docker compose -p <project> run --rm --build test` with `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1`
   via `resolveDockerBin` (absolute path; docker is off PATH in ticks), tees output to `--log`.
4. **Always** runs `docker compose -p <project> down -v --rmi local --remove-orphans` — registered before the
   run starts, on normal exit, on run failure, and on SIGINT/SIGTERM (the `trap … EXIT` of the shell
   recipe, in node). The run's exit status is preserved; teardown failure is reported separately.
5. **Post-teardown leak assertion**: `docker network ls --filter name=^<project>_` must be empty and
   `docker images <project>-*` must be empty; otherwise exit 4 with `LEAK: <names>`. A run that leaks is
   not a valid receipt.
6. Prints a one-block **receipt**: the `Built` line (verbatim; its absence is `BUILT: missing` and exit 5 —
   the `--build` corollary made executable), `tests/pass/fail/skipped`, `down` exit, leak check result.
   The receipt is what reviewers paste into their comment.

**(c) `node apps/chat/bin/compose-run.mjs --check`**: lists every `asc-*` network, classifying each as
`production` (compose `name:` values), `live` (a project `compose ls` reports running), or **`leftover`**,
with the owner/task inferred from the name (`asc-review-as102` → AS-102 reviewer; `asc-as94-lena` → Lena).
Exit 1 when any leftover exists, 0 otherwise. Reports only — **removes nothing**. This is the guard that
turns "the pool is leaking" from an argument into an observation, and the tick can run it in a report.

**(d) One-time attributed cleanup of the nine leftovers — post-merge, not in the branch.** They are
attributable from their names and from Ruben's/Priya's comments (AS-93 Marcus impl + mutant run; AS-94 Lena;
AS-95 QA projects ×4 + `asc-marcus95` Marcus impl; `asc-chat-qa23` the AS-23 QA run). The orchestrator
(`agent:cto-owen`, manager of every lane that created them) removes exactly those nine with
`down -v --rmi local --remove-orphans` per project in the merge tick, lists each with its attribution in a
Lattice comment on AS-106, and proves it with a `--check` run showing zero leftovers (excluding any live
lane). Never `network prune`; never a name that `compose ls` shows running; never the three production
networks. Their stale `<name>-test:latest` images go with them (`--rmi local`). The orphan images without
networks (`asc-review-as115-test`, `asc-impl-as92-test`, etc., §1) are listed in the same comment and removed
the same way — same attribution basis.

**Docs**: replace the `apps/chat/README.md:852` recipe with the script invocation and the receipt format;
update `docs/engineering/04-glossary.md` "compose receipt" entry (teardown + leak check are part of the
receipt); `watch/README.md` gets a one-paragraph "counted runs" pointer. **Metawork (not in the branch):**
proposed CLAUDE.md corollary sentence for the orchestrator to apply — *"A counted run is made with
`node apps/chat/bin/compose-run.mjs --project asc-<stage>-as<n>`, which tears its project down in the same
step and refuses to start when the daemon carries leftover `asc-*` networks; a receipt that lacks the
teardown and leak-check lines is not a receipt."* — and the matching line in `.claude/commands/advance.md`.

Out of scope: the invoicing app's compose (already `network_mode: none` on `test`); any watcher-side
periodic network check (the pre-flight in (b) is where the run happens); changing the address pool size.

## 3. Key files

- `apps/chat/compose.yaml` (`test` service: `network_mode: none`)
- `apps/chat/bin/compose-run.mjs` (new, thin CLI), `apps/chat/lib/compose-run.js` (new, pure logic:
  `isAllowedProject`, `buildRunArgs`, `buildDownArgs`, `classifyNetworks`, `parseReceipt`, `runCounted(exec)`)
- `apps/chat/test/compose-run.test.js` (new), `apps/chat/test/deploy-shape.test.js` (+1 pin)
- `apps/chat/README.md`, `apps/chat/watch/README.md`, `docs/engineering/04-glossary.md`
- Model to copy: `test/watcher-deploy-real.test.js:49-55` (teardown + `t.after`), `lib/watcher.js`
  `resolveDockerBin`, Priya's `scratchpad/agent-qa-priya/AS-28/cycle2/compose-run.mjs` (the seed).

## 4. Acceptance criteria (M4: every property names its falsifier; satisfied only by an observed red)

| # | Criterion | Falsifier (mutant) | Predicted red set |
|---|-----------|--------------------|-------------------|
| AC-1 | With `network_mode: none`, a real `compose -p asc-as106-probe run --rm --build test` leaves **no** `asc-as106-probe_default` network (measured with the real docker at `/usr/local/bin/docker`, then the project downed; the observation goes in a `## Measurement` note with the exact `network ls` output). | M1: remove the `network_mode: none` line, repeat the run → the network appears in `network ls`. Observed, then downed. | Not a test — an observed difference in `network ls`. If M1 shows *no* difference, Q1 resolved "compose creates it anyway": record it, keep the line, AC-1 becomes "the script's teardown removes it" (covered by AC-6). |
| AC-2 | `deploy-shape.test.js` pins `test.network_mode == none`. | M2: delete the line in a scratch copy of compose.yaml. | `{deploy-shape: network_mode pin}` only. |
| AC-3 | `isAllowedProject` rejects `asc-chat`, `asc-invoicing`, any name not starting `asc-`, any name with `/` or whitespace; accepts `asc-review-as106`. | M3: return `true` unconditionally. | `{T1 rejects production names, T2 rejects non-asc}`; T3 (accepts) stays green — narrower than T1–T3 by design. |
| AC-4 | `buildDownArgs` is exactly `['compose','-p',<p>,'down','-v','--rmi','local','--remove-orphans']`; `buildRunArgs` exactly `['compose','-p',<p>,'run','--rm','--build','test']`. | M4: drop `--rmi local` from down. | `{T4 down argv}` only. |
| AC-5 | `runCounted(exec)` calls `down` after `run` **whether run exits 0, exits 1, or throws**, and returns run's status. | M5: guard the down call with `if (runStatus === 0)`. | `{T5b down-after-failure, T5c down-after-throw}`; T5a (success path) stays green. |
| AC-6 | After `down`, `runCounted` queries `network ls` for `^<p>_` and `images` for `<p>-*`; a non-empty answer → exit 4 with `LEAK:` naming them. | M6: skip the post-check (always report clean). | `{T6 leak reported}` only. |
| AC-7 | Receipt parsing: `Built` line present → `built: true` with the line verbatim; absent → `built: false` and exit 5 even when tests pass. Counts `tests/pass/fail/skipped` parsed from node's summary. | M7: default `built` to `true`. | `{T7b missing-Built is exit 5}`; T7a stays green. |
| AC-8 | `classifyNetworks(networkLs, composeLs, productionNames)`: production names → `production`; running projects → `live`; the rest of `asc-*` → `leftover` with an owner guess; non-`asc-` names ignored. Fixture: this tick's 13-network listing from §1 → exactly 3/1/9. | M8: classify everything `asc-*` as `leftover`. | `{T8 classify fixture}` (asserts the 3/1/9 split, so M8's 0/0/13 is red). |
| AC-9 | Pre-flight refusal: `asc-*` count ≥ `ASC_NETWORK_CEILING` (default 20) → exit 3, no `run` call, leftover list printed. | M9: `>=` → `>` on the ceiling comparison with the fixture pinned at exactly 20 (Ruben's "N pre-created networks" input, realized as a 20-name stub listing). | `{T9 refuses at ceiling}` only. T9b (19 → proceeds) stays green. |
| AC-10 | `--check` exits 1 when any leftover exists and 0 when the listing is production+live only; it never invokes `down`, `rm`, or `prune` (the stub exec records every argv). | M10: call `down` on each leftover inside `--check`. | `{T10b check-is-read-only}`; T10a exit codes stay green. |
| AC-11 | Opt-in real run (`AS106_REAL=1`, skip otherwise, same shape as AS-87's): the script against a temp compose dir with a `-p asc-as106-real-<pid>` project ends with zero networks and zero images for that project and a receipt with a `Built` line. | M11: in a scratch copy of the script, replace the `down` argv with `['compose','-p',p,'stop']`. | `{T11 real run}` red on the leak assertion — **observed red, torn down by hand afterwards with the correct `down`, named in the comment.** |
| AC-12 | Cardinality: host `node --test` from **554/553/1 skipped** (measured this tick on master `d2d6608`) → **565 tests / 563 pass / 0 fail / 2 skipped** (+10 in `compose-run.test.js`: T1–T10 as one test each except T5 = 3 subtests counted as 1 top-level, T7 = 1, T9 = 1, T10 = 1 → the implementer states the exact split; +1 `deploy-shape` pin; +1 skipped real test). Compose (`--build`, `Built` line quoted, via the new script itself) from **554/547/7 skipped** (AS-98 review receipt) → **565/556/9 skipped/0 fail** (the real test and AS-87's skip in the container). A different total is a finding to explain, not to accept. | — (counts are the falsifier of the other rows: fewer tests than predicted means a mutant's red set was never exercised) | — |
| AC-13 | Every counted run in this task's own implementation and review is made **with the new script**, its receipt pasted, and `--check` run before and after showing the leftover count unchanged (9, or fewer if (d) has run) — the branch must not add to the debris it fixes. | M12: (no mutant) — a receipt without the teardown/leak lines fails this row by inspection. | — |

Predicted red sets are exact; a wider or narrower set is a finding (CLAUDE.md mutation rule). Mutants M3–M10
are applied to scratch copies or with backup + `trap`-restore and an "assert the mutation applied at the
intended site" check (AS-95 cycle-1 lesson: anchor the pattern to the enclosing function).

## 5. Test design notes

- `runCounted` takes an injected `exec(argv, opts) → {status, stdout, stderr}` so T5/T6/T9/T10 run on the
  host with a scripted stub; the stub records every argv, which is how "never calls down/prune" is asserted
  (T10b) and "down called after failing run" (T5b) — no docker on the host test path, no docker in the
  compose image (the image has none; those tests stay green there).
- The `--check` fixture is the verbatim 13-line `network ls` output from §1 plus a 5-line `compose ls`
  JSON; the expected classification is 3 production / 1 live / 9 leftover with the leftover names listed.
- Signal handling (SIGINT/SIGTERM → down) is exercised by T5c through the `exec` stub throwing; a real-signal
  test is not attempted (flaky on CI, not load-bearing).

## 6. Sequence

1. Measure Q1 first (AC-1) with a throwaway project, torn down; write the `## Measurement` note.
2. `lib/compose-run.js` + tests (red first, then green), `bin/compose-run.mjs`, compose pin, docs.
3. Commit early on the branch; progress note in `scratchpad/agent-developer-lena/AS-106/`.
4. Host run, then a compose run **through the new script** (`--project asc-impl-as106`), receipt in the
   Lattice comment; `--check` before and after.
5. Review (Priya): mutants per §4, her own compose run via the script (`--project asc-review-as106`),
   probing past the list (M6) — e.g. a project name that is a prefix of a live one (`asc-review-as10`
   vs `asc-review-as102`: the `^<p>_` network filter must not match the live lane's network).
6. Merge tick: orchestrator performs (d), records the attributed list and the post-sweep `--check`.

## 7. Open questions (time-boxed to the implementation stage; defaults stated)

- **Q1** — does compose v2 create `<p>_default` when the only started service is `network_mode: none`?
  Default answer: no (that is compose's documented behaviour for unreferenced networks). Measured in AC-1.
- **Q2** — ceiling value. Default 20 (pool observed ~30; production + up to three live lanes = 6; 20 leaves
  headroom for a leak to be *noticed* before it *bites*). Env-overridable; not a design axis.
- **Q3** — should the watcher run `--check` per tick and post the count? Default no (out of scope); if the
  reviewer thinks it earns its keep, file it as a follow-up, do not widen this branch.

## 8. Wording for the orchestrator (metawork, not in the branch)

CLAUDE.md compose corollary — append: *"A counted run is made with `node apps/chat/bin/compose-run.mjs
--project asc-<stage>-as<n> --cwd <worktree>/apps/chat`, which tears its project down in the same step
(`down -v --rmi local --remove-orphans`), asserts nothing of that project survives, and refuses to start
when the daemon already carries ≥20 `asc-*` networks (`--check` lists them with owners, removes nothing). A
receipt without the teardown and leak-check lines is not a receipt. Leftovers are removed only by their owner
or by the orchestrator naming each one and its owner in a Lattice comment — never by `network prune`."*
`.claude/commands/advance.md` step 3: the same sentence, one line.
