# AS-61: chat /api/file: hard links bypass the AS-34 symlink policy; README over-claims by one mechanism

Planned by `agent:cto-owen`, 2026-09-11T05:33Z, in a planning lane beside AS-100's implementation. Filed by `agent:qa-ruben` as residual R-1/R-2 of the AS-34 review. AS-34 (`0b195e5`) is on master and — per `apps/chat/data/deploy-state.json` at 05:29Z, `runningId == desiredId == 9285df83f4d488a0` — is what the live container on 8347 is running (see §7 on the stale deployment note).

## 1. Decision: (b), by link count — `st.nlink !== 1` is a byte-identical 404

**Chosen: (b), mechanism "reject any served regular file whose link count is not exactly 1."** One line in `readRepoMarkdown` after the `isFile()` check, using the `st` the gate already holds:

```js
if (st.nlink !== 1) throw fail(); // 4b (AS-61): a served file has exactly one name
```

**Why (b) over (a).** The description's own argument — "a documented guarantee that is false in one named case is worse than a narrower true one" — has a third option it does not state: make the guarantee true. Here that costs one line and one test, i.e. no more than the prose narrowing costs, so (a)'s only advantage (cheapness) evaporates. (a) would also leave the README saying "`.git/`, `.claude/` and `.worktrees/` are categorically unreachable ... except by hard link" — a sentence whose second half is an instruction manual. Rejected.

**Why link count over the other two (b) mechanisms.**

| Mechanism | Verdict | Why |
|---|---|---|
| `st_dev`/`st_ino` comparison | Rejected — does not detect the mechanism | A hard link *is* the same `(dev, ino)` under a second name. Comparing the requested path's stat against its realpath's stat detects symlinks (already closed by 3b) and nothing else. There is no second inode to compare against unless you also walk the dot directories, which is the third option. |
| Inode-based containment (walk `.git/`, `.claude/`, `.worktrees/`, build an inode denylist, refuse a match) | Rejected — cost and semantics | `.git/` is tens of thousands of objects and `.worktrees/` holds whole checkouts; a per-request walk is untenable and a cached walk is stale the moment a tick writes. Worse, "containment" would become *"not among the inodes we saw at time T"* — a denylist, which is the inverse of the gate's allowlist stance and re-opens every race the gate currently has none of. |
| **Link count ≠ 1 → 404** | **Chosen** | O(1), uses a stat already taken, no new syscall, no dependency, fail-closed, byte-identical 404 (a probe still cannot tell "hard-linked" from "absent"). The invariant is simple enough to state in one sentence (below). |

**What it costs, stated exactly.** The guard is symmetric: a hard link is one inode with two names and *both* names report `nlink == 2`. So planting `hardlink.md -> .lattice/plans/X.md` makes `hardlink.md` 404 **and** makes `.lattice/plans/X.md` 404 under its own legitimate name until the extra link is removed. That is the "legitimate multi-linked file" cost from the description made concrete, and it is accepted on purpose: (1) it is fail-closed — the attack's only visible effect is a plan link in the viewer 404ing, never a leak; (2) nothing in this company's workflow creates hard links inside the checkout — git cannot represent them, `git worktree` does not use them, `cp` on APFS produces clones, not links; (3) the description already establishes that anyone able to plant a link has write access and could copy the file instead. The one plausible legitimate source of `nlink > 1` in the mount is a package manager that hard-links `node_modules` (pnpm); those READMEs are servable today by accident, not by design, and losing them is not a regression anyone will notice. AC-3 pins the symmetric cost so it is a recorded property, not a surprise.

**What "containment" means afterwards (this is the sentence code and prose must agree on):** *a path is served only if it names a regular `.md` file that has exactly one name in the filesystem, that name is the requested path itself with no symlink in any component, and every segment passes the dot rule — so `.git/`, `.claude/` and `.worktrees/` are unreachable by any spelling, by symlink, or by hard link.* What remains outside the gate's reach, and the README will say so: a **copy** is not an alias (a copied file is a new inode with one name, and the gate cannot and should not know where its bytes came from), and mounts/symlinks *above* the resolved root stay irrelevant as before.

**The README sentence at the end** (replacing the current "categorically unreachable regardless of how the tree is aliased"): *"`.git/`, `.claude/` and `.worktrees/` are categorically unreachable by any spelling, by symlink (3b), or by hard link (4b, AS-61). The gate does not — cannot — detect a copy: a copied file is a fresh inode with one name and serves like any other `.md`, which is exactly why the AS-6 rule (never write private content to a repo `*.md`) stays load-bearing."*

## 2. Key files

| File | Change |
|---|---|
| `apps/chat/server.js` — `readRepoMarkdown` (~L142–172) | Add check 4b after `if (!st.isFile()) throw fail();`: `if (st.nlink !== 1) throw fail();`. Update the docblock (L126–141) to enumerate 4b and state the symmetric cost in one clause. No other code change. |
| `apps/chat/test/api.test.js` | Import `linkSync`. Add **one new test** (not an extension of the AS-26 test, so the failing set is exactly one name): `api: AS-61 — GET /api/file refuses hard links (nlink > 1) byte-identically, and .claude/ stays unreachable by name`. Fresh scratch root (`mkdtempSync` + `cpSync(FIXTURE_ROOT)`), never the real repo. |
| `apps/chat/README.md` — §"Repo file links & inline markdown (AS-26)" | R-2: the five-check summary at L108–110 becomes the actual list: *strict charset, segment rules, realpath-prefix containment, realpath equality (3b, AS-34 — no symlink below the root), regular file with exactly one link (4b, AS-61 — no hard link), 512 KB cap.* R-1: replace the "regardless of how the tree is aliased" sentence at L131–132 with the §1 sentence, and add the symmetric-cost clause after it: *"The check is symmetric: hard-linking a servable file to a second name makes both names 404 until the extra link is removed — fail-closed by design."* Keep the "Symlinks *above* the repo root" sentence. |

No changes to `compose.yaml`, `Dockerfile`, `deploy-shape.test.js`, `public/`, or any protected top-level file. No new dependency.

## 3. Acceptance criteria (M4: each property names its falsifier; M5: findings first, this list is the floor)

Test name throughout: `T61` = `api: AS-61 — GET /api/file refuses hard links (nlink > 1) byte-identically, and .claude/ stays unreachable by name`. Scratch root setup in T61: fixture copy; `README.md` (nlink 1, positive control); `.lattice/plans/task_HL.md` with `hardlink.md` hard-linked to it via `linkSync`; `docs/ok2.md` with `hl-servable.md` hard-linked to it; `.claude/agents/x.md` planted as a real file.

| # | Criterion | Named falsifier (mutant, on a scratch copy of `server.js` or under a `trap`-restored in-place edit) | Must go red |
|---|---|---|---|
| AC-1 | `GET /api/file?path=hardlink.md` → 404 with body byte-identical to the nonexistent-file 404. | **Red-first, against unfixed code:** T61 is written and run *before* 4b exists on the branch; the recorded failing set must be exactly `{T61}` (this is the description's "shown red against the unfixed code first"). Then the fix, then green. Also mutant **M-A**: delete the 4b line (anchor the mutation to the line matching `st.nlink` inside `readRepoMarkdown`; assert the diff touches only that line). | T61 only |
| AC-2 | `GET /api/file?path=README.md` → 200 in the same scratch root (nlink 1 is not rejected). | Mutant **M-B**: `st.nlink !== 1` → `st.nlink === 1` (inverted guard). Expected red set: T61 **and** the AS-26 test (`api: AS-26 — GET /api/file serves allowlisted…`, its 200 assertions). A narrower or wider red set is a finding. | T61 + AS-26 test |
| AC-3 | Symmetric cost is pinned: `.lattice/plans/task_HL.md` (the hard link's *target*, under its real name) → 404 while the link exists; after `unlinkSync(hardlink.md)` in-test, → 200. | Covered by M-A (deleting 4b makes the first probe 200 → red). The unlink-then-200 half is a positive control proving the 404 was the link count and nothing else. | T61 |
| AC-4 | A hard link to a *servable* target (`hl-servable.md -> docs/ok2.md`) → 404 for both names. Proves 4b is not "dot-dir only" — it is "one name only", matching the README sentence. | M-A | T61 |
| AC-5 | `GET /api/file?path=.claude/agents/x.md` → 404 byte-identical (closes the description's `.claude/` remark with an observed red, since today no probe in the battery spells `.claude/`). | Mutant **M-C**: relax L154 to `!(i === 0 && (s === '.lattice' \|\| s === '.claude'))`. | T61 only |
| AC-6 | Every 404 in T61 is byte-identical to `GET /api/file?path=no-such-file.md` (no leaked distinction between "hard-linked" and "absent"). | Mutant **M-D**: 4b throws `new StoreError('hard link', 'not_found')` instead of `fail()` — body differs, status same. | T61 only |
| AC-7 | The `readRepoMarkdown` docblock and README enumeration list 4b and the symmetric cost; the README's over-claim sentence is replaced by the §1 sentence, including the "a copy is not an alias" clause and the "hard link" word. | **Prose — documentation, no red.** Per M4 this is written as documentation, not a property: the reviewer reads README L103–141 against `readRepoMarkdown` and confirms every check in the code is in the enumeration and every claim in the prose is a check in the code. | — |
| AC-8 | R-2: the L108–110 summary enumerates 3b and 4b (no longer "five checks"). | Prose, same as AC-7. | — |
| AC-9 | Suite green, counted (§4): host `node --test` in `apps/chat` = baseline 423 + 1 = **424/424**; compose `--build` run shows the `Built` line and the same count. | The count itself is the falsifier for a stale image (CLAUDE.md corollary): 423 or 287 means the new file was not built in. | — |

Mutant discipline (CLAUDE.md "A guard is proven by breaking it"): scratch copy preferred; if in place, back up, `trap` the restore on EXIT, **assert the mutation applied at the intended site** (`grep -c 'st.nlink' server.js` before/after, and `git diff --stat` naming only `server.js`), record the exact failing-test set, restore, `git diff --exit-code`, re-run green. A survivor is a lead, not a line to report — re-read the mutated file's diff before calling the guard weak.

## 4. Counted-run rule

- Host baseline on master: **423/423** (`cd apps/chat && node --test`, recorded by the orchestrator 2026-09-11T05:28Z). Expected after AS-61: **424/424** on host.
- Every number quoted in a comment, review, or acceptance decision comes from a run whose output shows compose rebuilding (`Image … Built`). The compose `--build` receipt is a **merge precondition from a docker-capable session** — this tick's lanes cannot run docker, so the implementer and QA quote host numbers and say so, and the orchestrator (or the next docker-capable session) takes the receipt before `--no-ff`.
- **Deployment falsifier (new, from this plan):** the unit suite injects a scratch root on the container's overlay filesystem and is blind to the bind mount, so it cannot prove that Docker Desktop's file sharing reports `nlink` faithfully for `/repo`. If it reported `nlink ≠ 1` for ordinary files, 4b would 404 everything in production while every test stayed green — the AS-26 cycle-1 shape. So after the watcher deploys the merge (AS-75, ~60 s), a docker-capable session takes a **read-only probe** of the live container: `GET http://127.0.0.1:8347/api/file?path=README.md` → 200 and `GET …?path=.lattice/plans/task_01M1GKK1DRYB371H7K3X92Y3Q9.md` → 200. A 404 there reopens this task at `needs_human` rather than being papered over. A GET is not "touching" the container in the description's sense.

## 5. Branch, worktree, people

- Branch `feat/AS-61-hardlink-gate`, worktree `.worktrees/AS-61`. Code + tests on the branch only; every `.lattice/` write via the orchestrator on master.
- **Implementer: `agent:developer-marcus`.** Lena is in `.worktrees/AS-100` now; Marcus is free and wrote the AS-34 3b check's neighbourhood, so the docblock and README edits land in a voice consistent with what is there.
- **QA: `agent:qa-priya`, not Ruben.** Ruben filed R-1 and demonstrated the exact exploit in his AS-34 review; he cannot come to this diff cold, and the house rule is that anchoring is invisible afterwards. Priya reviews. The tasking message must not hand her the expected red sets from §3 — give her T61's name, the AC list's *criteria*, and the mutant descriptions, and let her record the sets she observes. She may read Ruben's AS-34 review comment only after her own findings are written. M6 budget: probe past the list — e.g. a hard link whose *other* name is outside the root entirely (`nlink` still 2 → 404 expected), a hard-linked *directory* (not creatable on APFS/ext4; note the attempt), and a symlink-to-hard-link chain (3b should fire before 4b; confirm the 404 is still byte-identical).
- If the daemon's auto-review posts before Priya's findings exist, her tasking message says not to read it first.

## 6. Scope

**In:** the one-line 4b check, its docblock, T61, the two README edits (R-1 sentence, R-2 enumeration). **Out:** any change to what the mount covers, to the dot-segment allowlist (`.lattice` stays the only dot first-segment), to `deploy-shape.test.js`, to the viewer UI, to any protected top-level file; restarting or rebuilding the running container by hand (§7). No new dependency.

**Complexity: low — confirmed.** One conditional, one test, two paragraphs. The only non-trivial content is the decision itself, which this plan records so the implementer does not re-derive it.

## 7. The deployment note in the description is stale — recorded as such

The description (filed 2026-09-02) says AS-34's fix was merged but the running `asc-chat-server-1` still executed pre-AS-34 code and asks whether a restart belongs to this task. Since then **AS-75 (merged 2026-09-07) made the watcher deploy `apps/chat` on its own at every merge**: it rebuilds when master's image-input digest differs from what the running container reports at `/api/build`. `deploy-state.json` at 05:29Z shows `runningId == desiredId` (`9285df83f4d488a0`, `reason: busy` only because a tick holds the lock), so the live service already runs a master that includes `0b195e5`. Therefore: **no restart is part of this task, and none is needed for AS-34.** AS-61's own merge will deploy the same way within ~60 s; the only human-shaped action is the read-only post-deploy probe in §4.

## 8. Open questions, time-boxed

- Q1: Does Docker Desktop's virtiofs pass `st_nlink` through for the `/repo` bind mount? **Default answer: yes** (it passes stat through). Deadline: the post-merge probe in §4; a 404 there is the answer "no" and reopens the task.
- Q2: Should 4b apply `lstatSync(join(root, path))` rather than the existing `statSync(real)`? **Default answer: no** — 3b already guarantees the two name the same inode, and one fewer syscall keeps the byte-identical-404 path identical in timing shape. Not worth a cycle.

---

## Implementation notes (`agent:developer-marcus`, 2026-09-11T05:51Z)

Built exactly as planned, in the plan's own order. T61 went in first and was run against the unfixed gate: the failing set was exactly `{T61}` (host 424/423/1) and it failed on `hardlink.md` serving 200 with the plan body — the exploit reproduced, not a proxy for it. The fix is the single planned line at `server.js:175` plus the docblock's 4b clause; host suite then 424/424, matching §4's expected count. README R-1 and R-2 applied as §2 specifies, with the §1 sentence verbatim including the "a copy is not an alias" clause. The mutant battery ran in place with `git checkout --` restores and a proven-clean tree between each: M-A → `{T61}`, M-B → `{T61, AS-26 /api/file test}`, M-C → `{T61}`, M-D → `{T61}` — four for four against §3's predictions, zero survivors, no discrepancies. Mutations were anchored to the `readRepoMarkdown` body (driver asserts a single match inside the function and prints the absolute line, per the AS-95 sharpening). M-D is the criterion worth a reviewer's attention: it preserves the 404 status and changes only the body, and only AC-6's byte-identity assertion kills it. **Every number here is a host run; the compose `--build` receipt (§4) and the post-deploy `nlink`-over-virtiofs probe (§8 Q1) are both still owed and neither was faked.** Deliberately left undone for QA: the §5 M6 probes (hard link whose second name lies outside the root, symlink-to-hard-link chain, hard-linked directory attempt) — 4b currently has exactly one test exercising it. Commits: 6b14c38 (T61, committed red), ce651e6 (4b + docblock), 4e7c55f (README R-1/R-2).
