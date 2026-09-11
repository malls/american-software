Lattice-Reviewed-Commit: 44428ba08a66138f53bedfe5803ad7aba85f940e

# Code Review: AS-94 — supervise the Lattice dashboard under launchd

Reviewer: Lattice auto-review daemon (generic actor). Per `CLAUDE.md` § "Lattice's auto-fired review is NOT the company's review gate", this document is third-party tooling output. The company's gate for AS-94 is Ruben's `--role review` comment of 2026-09-10 (PASS on the code half) plus the board's host observations of 2026-09-11. Nothing here changes the task's `done` status.

**What was actually reviewed.** The diff embedded in the prompt is not the AS-94 change: it is master's working tree (uncommitted `.lattice/` board state, an uncommitted `.gitignore` hunk, 559 KB, truncated) because the task branch was deleted after the board's GitHub squash-merge. The AS-94 change is squash commit `f4af258` on master, four files under `apps/chat/`: the plist template, `test/launchd-plist.test.js`, `watch/README.md`, and `README.md`. That commit is what this review reads. The `.gitignore` hunk in the prompt (`.lattice/locks/`, `tmp-prompts/`, `review_state/`) is unrelated metawork sitting uncommitted on master and is out of scope here.

---

### 1. Verdict

**PASS**

---

### 2. Summary

The four deliverables match plan §2–§4 line for line: the template declares `--host 127.0.0.1 --port 8799` explicitly, the guard renders every template under `watch/` with fixed values and parses it with a strict reader, and both READMEs carry the mirrored sections and the three-legged port block. The guard is green on the host (4/4) and inside a freshly built image (367/367, receipt below); two mutants driven on a scratch copy went red as predicted, and the parser rejected every malformed input I fed it outside the test's own list, including duplicate keys. Findings are all minor and all documentary or housekeeping: one README string the CLI never emits (already recorded by the board), a label-rule assertion that is weaker than its message claims, and two leftover Docker networks from this task that, together with 27 others, have exhausted Docker's address pools and now block any fresh counted compose run.

---

### 3. Issues

Findings first (M5); the acceptance-criteria sweep follows as a floor check.

**[minor] apps/chat/watch/README.md:321 — quoted bind error is not what the CLI emits**
The section says the second copy "fails to bind (`Address already in use`)". The board's host record on the task (2026-09-11) quotes the real output: `Error: Port 8799 is already in use — is another dashboard running?` followed by the `--port 8800` suggestion. Behaviour is correct; the string is wrong, so someone grepping logs for the documented phrase finds nothing. The board already flagged this as a breadcrumb.
**Fix:** replace the parenthetical with the observed line, e.g. ``(`Port 8799 is already in use — is another dashboard running?`)``.

**[minor] apps/chat/test/launchd-plist.test.js:246 — the "Label = prefix + basename" rule is tautological for a file that lacks the prefix**
`const label = LABEL_PREFIX + file.replace(/\.plist\.template$/, '').replace(LABEL_PREFIX, '')` strips the prefix from the basename and re-adds it, so a template named `lattice-dashboard.plist.template` with Label `com.american-software.lattice-dashboard` satisfies the assertion. I confirmed on a scratch copy: the plan's M-ENUM rename mutant does go red on {T1, T2, T3} exactly as §5 predicts, but T1's red comes from the hard-coded two-filename cardinality list, not from the label assertion the plan credits. The failing set matches; the mechanism does not. Harmless today because the filename list is exact, but the assertion message ("Label must equal prefix + the template basename") promises something the code does not check.
**Fix:** `const label = file.replace(/\.plist\.template$/, ''); assert.ok(label.startsWith(LABEL_PREFIX), ...); assert.equal(plist.Label, label, ...)`.

**[minor] AC-8 "nothing left behind" — this task's compose networks survived, and the accumulated pile now blocks counted runs**
`docker compose run --rm` removes the container, not the project network. `asc-as94-lena_default` and `asc-as94-ruben_default` still exist, beside 27 other stale `asc-*` project networks from AS-93/AS-95/AS-75/AS-28 runs. Docker's default address pools are now fully subnetted: my own counted run under `-p asc-as94-autoreview` failed at network creation with `all predefined address pools have been fully subnetted` before building anything. Every future `--build` receipt in a fresh project name will fail the same way until someone with authority over those networks runs `docker compose -p <project> down` (or `docker network prune`) — I did not, because they are other actors' state. Also housekeeping: the stale remote-tracking ref `refs/remotes/origin/feat/AS-94-dashboard-launchd` remains until `git fetch --prune` (Owen noted this on the task).
**Fix:** (a) remove the two AS-94 networks; (b) amend the plan-template cleanup line and the `CLAUDE.md` `--build` receipt rule so close-out is `docker compose -p <proj> down --rmi local` rather than `docker image rm` alone; (c) a live session prunes the other 27 after checking no lane is mid-run.

**Observation, not an issue — parser permissiveness the plan asked to be probed (§9 M6).** `parseFlatPlist` accepts `ProgramArguments` as a `<dict>`, `WorkingDirectory` as `<true/>`, attributes on `<string>`/`<key>`, and a `<plist>` tag with no version attribute. For the dashboard template T2's exact `deepEqual`/`equal` assertions catch all of these, and T1 pins `WorkingDirectory` for both templates, so nothing stays green that matters. The one gap is that T1 never looks at the watcher's `ProgramArguments` at all, which the plan chose deliberately (§5 M-AC2a row). Duplicate `<key>` throws, as the plan required. CDATA throws, which is fine since neither template uses it.

**Acceptance-criteria sweep (floor check, 9 criteria):**

| AC | Result | Evidence |
|---|---|---|
| AC-1 | pass | T1, T3 green on the host and in the image; `plutil -lint` OK quoted by the board on 2026-09-11. |
| AC-2 | pass | T2 asserts the exact six-element array; M-AC2a (`0.0.0.0`) observed red on exactly {T2} on a scratch copy, applied-count 1, scratch copy deleted afterwards, main tree untouched. |
| AC-3 | pass | Board record: `state = running`, pid 15362; GET 200; kill at 01:04:32 → `200 after 1s`, new pid 15551, `runs = 2`. I re-checked live: pid 15551 still owns `127.0.0.1:8799`, `state = running`, `runs = 2`. |
| AC-4 | pass with the doc nit above | Second copy exited 1 without stealing or moving the port (board record). README carries "one owner", "do not run beside it", and the `lsof` + `pgrep` pre-step. |
| AC-5 | pass | Six mirrored subsection headings present in order (`Prerequisites`, `Install (launchd)`, `Uninstall / restart`, `After any change…`, `Troubleshooting`, plus the three-legged block); nested at `###` under the AS-94 `##` where the watcher's are top-level `##` — a structural difference, not a wording one. Install blocks side by side: the dashboard block adds the `LATTICE_BIN` variable, the two-step stop/lint pre-amble, `mkdir -p`, `plutil -lint`, and a `curl` probe in place of the watcher's `tail -f`; the `sed` skeleton is identical. `apps/chat/README.md` diff is the single §4.2 paragraph; the env-table row is untouched. |
| AC-6 | pass, with a caveat | Compose itself could not run (network exhaustion, above). Receipt obtained by building the same Dockerfile directly and running the image with `--network none`: `writing image sha256:9c584d1b…` / `naming to docker.io/library/asc-as94-autoreview-test`, then `tests 367, pass 367, fail 0`, the four `launchd: AS-94` tests among them; image removed afterwards. 367 is master today (AS-95's tests landed after Ruben's 297 on the branch). |
| AC-7 | pass | Two of nine mutants re-driven here (M-AC2a, M-ENUM), both red, one with a mechanism discrepancy reported above. Ruben recorded 9/9 in his review. |
| AC-8 | partial | No `/tmp/AS-94-*`, no `asc-as94-*` images, worktree and branch gone, no launchd job installed by a tick (the board installed it from their own shell). Two `asc-as94-*` networks remain. |
| AC-9 | pass | The handoff block Ruben posted to PR #1 is the README Install block; the board's record says it ran "exactly per plan §7 / README recipe" and the rendered plist had zero unrendered placeholders. |

---

### 4. Positive Observations

- **The template is the policy, and the guard reads it as data.** `--host 127.0.0.1 --port 8799` are declared even though both are CLI defaults, and T2's assertion message names the CTO decision, so a red reads as a policy violation rather than a typo.
- **The strict parser earns its keep.** It throws on everything the plan listed plus duplicate keys, orphan values, stray close tags, and content outside the root dict, and T4 closes with a positive parse so "everything throws" cannot be what passes.
- **Recipe and template cannot drift silently.** T3 finds each label's install block by its `LABEL=` assignment rather than by position, so reordering the README does not confuse it, and a missing block throws instead of reading as zero placeholders.
- **The three-legged port table is the right shape of documentation**: it states which surface each leg breaks in one line each and points at the upstream decision instead of promising a unification this repo does not own.
- **The host record is exemplary.** The board quoted every command's output verbatim, corrected the stale pid from planning, checked the unrelated :8805 dashboard after every step, and filed the one discrepancy as a finding instead of fixing it silently.
