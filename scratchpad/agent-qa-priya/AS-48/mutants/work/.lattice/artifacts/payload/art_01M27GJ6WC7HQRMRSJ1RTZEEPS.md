Lattice-Reviewed-Commit: 0424a2e3db1afed796fe8e59016772fc07c13d51

# Code Review: AS-61 — chat /api/file hard-link gate (4b) + README R-1/R-2

Reviewed: `feat/AS-61-hardlink-gate` at `4e7c55f` (3 commits: 6b14c38, ce651e6, 4e7c55f), diff `master...feat/AS-61-hardlink-gate`, in worktree `.worktrees/AS-61`. Tree was clean before and after every step below (`git diff --exit-code`).

> Note on provenance: this is the Lattice daemon's auto-fired review, run as the generic `claude` actor. Per `CLAUDE.md` it is third-party tooling output and does **not** satisfy the company's review gate; a named `qa-*` employee's `--role review` comment does. The QA employee should form their own findings before reading this.

### 1. Verdict

**PASS**

### 2. Summary

One-line guard (`st.nlink !== 1 → fail()`) added after the `isFile()` check in `readRepoMarkdown`, one new test (T61), docblock and README updated to enumerate 3b/4b and replace the over-claiming sentence. Implementation matches the plan exactly; I independently reproduced the mutant battery (M-A, M-B, M-D) with the predicted failing sets and zero survivors, ran six probes past the criteria list (all fail-closed and byte-identical), and took the compose `--build` receipt the plan lists as a merge precondition (424/424 with the `Built` line). No blocking or non-blocking code defects found. The one thing this diff structurally cannot prove — that Docker Desktop's bind mount reports `st_nlink` faithfully for `/repo` — is already named in the plan (§4/§8 Q1) with a post-deploy probe as its falsifier, and remains owed after merge.

### 3. Issues

Findings first (M5), sweep second.

**Findings outside the criteria list: 0 blocking, 0 non-blocking code defects. Two observations, neither requiring a change:**

**[minor / observation] apps/chat/server.js:175 — deployment falsifier is still open by construction**
The unit suite injects a scratch root on the host (or the container's overlay), so it cannot observe whether the virtiofs bind mount passes `nlink` through. If it reported `nlink ≠ 1` for ordinary files, 4b would 404 every `.md` in production while 424/424 stayed green. The plan already names this (§4 deployment falsifier, §8 Q1) and prescribes a read-only `GET /api/file?path=README.md` → 200 probe against the live container after the watcher deploys. Not a defect in the diff; recorded so the merge tick does not skip the probe.
**Fix:** none in this diff. Merge tick runs the §4 probe; a 404 reopens at `needs_human`.

**[minor / observation] apps/chat/test/api.test.js:868 — test name says `nlink > 1`, code rejects `nlink !== 1`**
The two are equivalent for any path that `realpathSync` + `statSync` just resolved by name (such a file has ≥ 1 link), so there is no behavioural gap. Purely a wording asymmetry between the test title and the guard.
**Fix:** optional; leave as-is or retitle to "link count ≠ 1". Not worth a cycle.

**Acceptance-criteria sweep (floor check, not the review):**

| AC | Result | Evidence (my own run, host unless stated) |
|---|---|---|
| AC-1 | pass | `hardlink.md` → 404, body `{"error":"No such file."}` identical to reference. M-A (delete 4b line; asserted `grep -c st.nlink` 1→0, `git diff --stat` = server.js 1 deletion) → failing set exactly `{T61}`. |
| AC-2 | pass | `README.md` (nlink 1) → 200. M-B (invert to `=== 1`; asserted at line 175) → failing set exactly `{T61, AS-26 /api/file test}`, as predicted. |
| AC-3 | pass | `.lattice/plans/task_HL.md` 404 while linked, 200 after `unlinkSync` — covered by M-A red. |
| AC-4 | pass | `hl-servable.md` and `docs/ok2.md` both 404, both 200 after unlink — covered by M-A red. |
| AC-5 | pass | `.claude/agents/x.md` → 404 byte-identical. (M-C not re-run by me; it targets the pre-existing L154 dot rule, not this diff's line, and the implementer's note records `{T61}`.) |
| AC-6 | pass | M-D (`throw new StoreError('hard link','not_found')`; asserted 1 match) → failing set exactly `{T61}` — the byte-identity assertion is the only thing that kills it, as the plan predicted. |
| AC-7 | pass | Docblock lists (1)–(5) with 3b and 4b and the symmetric-cost clause; README §"Repo file links" carries the §1 sentence verbatim including "by hard link (4b, AS-61)" and the "a copy is not an alias" clause. Every check in the code appears in the prose; every claim in the prose is a check in the code. |
| AC-8 | pass | README L108–112 now enumerates: charset, segment rules, realpath-prefix containment, realpath equality (3b), regular file with exactly one link (4b), 512 KB cap — "five checks" is gone. |
| AC-9 | pass | Host `node --test` in `apps/chat`: **424/424** (baseline 423 + 1). Compose: `docker compose -p as61-review run --rm --build test` → `Image as61-review-test Built`, **424 tests, 424 pass, 0 fail**. Isolated project name; `asc-chat-server-1` untouched. |

9/9 pass, stated alongside 0 findings outside the list.

**M6 adversarial probes (scratch root under `mkdtemp`, never the real repo):**

| Probe | nlink | Result |
|---|---|---|
| Hard link whose *other* name is outside the root (`outlinked.md` ↔ `$tmp/elsewhere.md`) | 2 | 404, body == reference |
| Symlink → hard-linked file (`sym-to-hl.md -> hl.md`, `hl.md` ↔ `.lattice/plans/p.md`) | 2 | 404, body == reference (3b fires first; still byte-identical) |
| Hard-linked *directory* attempt (`link(docs, docs2)`) | — | refused by APFS with `EPERM`; `docs2/d.md` → 404 identical |
| Plain file, nlink 1 (`plain.md`, `docs/d.md`) | 1 | 200 (positive controls) |
| `.lattice/plans/q.md` real name, nlink 1 | 1 | 200 (no regression for legitimate plan links) |
| Census of the real checkout for `*.md` with `-links +1` (excluding `.git`, `node_modules`) | — | zero files — nothing on disk today would start 404ing |

### 4. Positive Observations

- **Red-first discipline is real, not narrated.** The test landed in its own commit (6b14c38) before the fix (ce651e6), so the "shown red against unfixed code" requirement is visible in history, not just in a note.
- **Mutation targeting is precise.** M-A/M-B/M-D each touch exactly line 175 and nothing else; the failing sets match the plan's predictions to the name, including M-B's widening to the AS-26 test, which is the right signal that the inverted guard breaks legitimate serving.
- **AC-6 / M-D is the criterion that earns the test its keep.** A status-only assertion would pass M-D; the `JSON.stringify` body comparison against a same-server reference 404 is what makes "byte-identical" a checked property rather than a claim.
- **The symmetric cost is pinned, not hidden.** The test asserts the hard link's *target* also 404s and then proves recovery after unlink — the plan's accepted trade-off is now a recorded, falsifiable property.
- **Prose and code agree at the end, which was the task's stated success condition.** The README no longer says "regardless of how the tree is aliased"; it names the three mechanisms it closes and the one (copying) it cannot.
- **Plan §7 correctly retired the stale restart note** rather than carrying an unnecessary running-service action into the task.
