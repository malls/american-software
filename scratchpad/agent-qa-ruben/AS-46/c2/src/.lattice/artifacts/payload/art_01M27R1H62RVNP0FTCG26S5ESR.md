Lattice-Reviewed-Commit: fa8445d0d32cd5c0abd18b696cbcdcd28700d7bd

# AS-73 — auto-fired review (Lattice `code-review` daemon, generic actor)

> Standing note for the company: this document is the daemon's output, not the company's review gate (CLAUDE.md § The Review Gate). It does not satisfy the gate, does not justify a move to `done`, and QA (`qa-ruben`) should form findings before reading it. Nothing below was written to `.lattice/`, the worktree, or the chat app; the mutations ran on copies under `/tmp` and the worktree stayed clean (`git status --porcelain` empty before and after).

Reviewed: branch `feat/AS-73-org-gate-predicates`, HEAD `3f96ab2` (two commits on master `fa8445d`), worktree `.worktrees/AS-73`, plan `.lattice/plans/task_01M1K4EVS9RAFCZ6Q588FNAS31.md`.

## 1. Verdict

**PASS**

## 2. Summary

Reviewed the six-file diff (personnel predicate + examined count, check-org cardinality line, validateOrg null tolerance + orphan wording, three test files) against the plan's 13 criteria, then probed past the list. The implementation matches the plan's approach exactly, all three mutation batteries reproduce the predicted red sets with no survivors, the pinned `--json` / `/api/org` surface is byte-identical to master, and a twelve-input probe of fence malformations the plan did not name finds zero parser/classifier disagreements. Two criteria (AC-1, AC-12) are mis-worded or mis-computed in the plan rather than unmet by the code; nothing blocks.

## 3. Issues

**[minor] .lattice/plans/task_01M1K4EVS9RAFCZ6Q588FNAS31.md §5 AC-1 — criterion wording does not match the property it states**
`grep -n -- "'---'" apps/chat/lib/personnel.js` returns two code lines: line 40 (inside `hasLeadingFence`) and line 54 (`if (line.trim() === '---') return out;`, the *closing*-fence test inside the parse loop). The plan predicted one. The property F1 is about — one *leading*-fence test shared by parser and classifier — holds: line 40 is the only leading-fence test, and no `^---` regex survives outside a doc comment (line 38). The implementer flagged this in the completion comment and correctly did not reshape code to satisfy a grep. Ruben should record AC-1 as "property met, wording wrong" rather than partial.
**Fix:** none to the code. Amend the criterion text in the plan to "exactly one *leading*-fence test", or leave as-is with the note recorded in the review comment.

**[minor] .lattice/plans/task_01M1K4EVS9RAFCZ6Q588FNAS31.md §5 AC-12 — the expected compose count (470, "host-minus-compose delta 4") was miscomputed at planning time; the branch is right, the number is not**
Observed compose count is 474/474, equal to the host count. The plan derived 470 by adding 6 to the AS-100 receipt (464 on b0763ad) and then asserting master carries a standing host-minus-compose gap of 4 (468 − 464). That gap is not a host/compose difference: 464/464 was b0763ad's host *and* compose count, and master reached 468 afterwards when AS-72 merged its tests. Every counted receipt on master shows compose equal to host (424/424, 464/464, 470/470 for AS-81, 478/478 for AS-82), so the correct expectation for this branch is 468 + 6 = 474 with delta 0 — exactly what was observed. AC-12 says "any other delta is a finding, not noise", so it is recorded here as a finding against the criterion's arithmetic, not the implementation.
**Fix:** none to the code. QA should record AC-12 as met at 474/474 with the corrected baseline and note the plan's stale arithmetic so nobody chases a phantom 4-test gap.

**[minor] apps/chat/test/roster-parity.test.js:97,100,116,117 — a CLI failure surfaces as a `JSON.parse` SyntaxError, not the CLI's stderr**
`JSON.parse((await run(...)).stdout)` discards `status` and `stderr`. If the child exits non-zero (probe refusal, missing DB, AS-24 refusal), the test fails with `Unexpected end of JSON input` and the diagnostic is lost. The guard still fails (it does not go green), so this is a diagnosability nit, not a correctness hole.
**Fix:** capture the result, `assert.equal(r.status, 0, r.stderr)` before parsing. Safe to do inline in QA or leave for a follow-up.

No other issues found.

## 4. Verification performed

Cardinality first, then results.

| Check | Observed |
|---|---|
| Host suite, worktree (`node --test`) | 474 tests, 474 pass, 0 fail (master baseline 468, +6 as planned) |
| Compose, counted, `--build` | `Image asc-chat-test Built` (line 59 of the log), 474 tests, 474 pass, 0 fail, exit 0 — run from `.worktrees/AS-73/apps/chat` via `/usr/local/bin/docker compose run --build --rm test`; log at `/tmp/AS-73-compose-review.txt` |
| Diff scope (AC-13) | 6 files, all in plan §3; no `.lattice/`, `personnel/`, fixtures, `package.json`, or top-level markdown |
| Commit identity | both commits `developer-lena <developer-lena@agents.american-software.local>` |
| AC-11 `--json` byte-identity vs master | `test/fixtures/repo`: identical (exit 1 both); `test/fixtures/org-clean`: identical, 661 bytes (exit 0 both). Note the plan names the clean root loosely; the directory is `org-clean`, not `repo-clean` — a nonexistent root yields 42 bytes of empty JSON on both sides, which is a vacuous match, so make sure the comparison names the real directory. |
| Real root, read-only (`check-org --root <main checkout>`) | `Examined 11 .md files in …/personnel` / `10 active of 10 dossiers parsed, 0 unparsed` / `No violations.` — 11 = 10 dossiers + README.md; first time the gate states its own cardinality on live data |

Mutations, run on three independent `cp -R` copies of the worktree under `/tmp` (worktree never edited), applied-at-site asserted by occurrence count via `split().length-1`:

| Mutation | Applied-at-site proof | Predicted red | Observed red |
|---|---|---|---|
| M1 — classifier back to `/^---\r?\n/` | regex occurrences 0→1; `hasLeadingFence(text)) skipped` 1→0 | {T1, T3} | {T1, T3}; 2 fail / 472 pass; dirty-fixture case green (control held) |
| M2 — `examined` = classified count | `examined++` 1→0; `examined = roster.length + skipped.length` 0→1 before the sole return | {T1, T2, T3, exits-0-clean, exits-1-dirty} | exactly that set; 5 fail / 469 pass; bare-root case green (control held) |
| M3 — drop `reportsTo` from direct-mode `rosterRows` | occurrence 1→0 in `bin/chat.js`; `rosterRows(me) {`…`registerIdentity:` slice no longer contains `reportsTo` | {T4} | {T4}; 1 fail / 473 pass; `cli: roster prints the active company roster …` green — Priya's AS-33 survivor is now caught |

Zero survivors. The observed sets match the implementer's comment independently (I ran mine before reading hers).

M6 probe past the list — twelve fence malformations the plan did not name, planted in a scratch root and checked for the property "parsed ⇒ classified as a dossier" and "has-fence ⇒ never silently absent": `---\r\n` alone, full CRLF dossier, blank line before the fence, `----`, leading space, trailing tab, CR-only line endings, BOM-only file, empty file, NBSP-prefixed fence, double BOM, `--- # comment`. Result: 12 examined, 2 to roster, 4 skipped as `malformed_frontmatter`, 6 with no leading fence (absent by contract), invariant `examined === roster + skipped + noFence` true, **0 disagreements**. Agreement, not acceptance, is the property, and it holds at every edge tried.

Other things checked and found sound:
- `/api/org` (`server.js:801`) destructures nothing from `examined` and builds `{ employees, violations }` explicitly, so the new key does not leak onto the pinned surface; `check-org --json` likewise. The §1 "does not change" clause is real, not asserted.
- Direct-mode CLI in T4 relies on resolution rule 4 (`CHAT_DB` set, no `CHAT_API` ⇒ direct, no probe), confirmed in `bin/chat.js` header and `resolveBackend`; a container on 8347 cannot affect the test. `work.url` on both sides derives from `LATTICE_DASHBOARD_URL || default` read from `process.env`, which the child inherits, so the three-way compare cannot drift on that field. T4's rows are non-trivial (Ada carries a real `work` object and `moreTasks: 2` from the fixture `.lattice`).
- `validateOrg` after `.filter(Boolean)`: no remaining per-entry `e &&` guard, and every later loop (`active`, `anyId`, `invalid_status`) assumes an object — one rule, as the plan asked. `known.status ?? ''` handles a missing status the same way the `invalid_status` rule already does.
- `spawn` instead of the plan's `spawnSync` in T4 is a justified deviation (the server shares the test process's event loop; `spawnSync` would deadlock), documented in the file header.
- Zero new dependencies; scratch roots via `mkdtempSync` with `t.after` cleanup; ephemeral port via `listen(0)`; real `personnel/` untouched.

## 5. Positive Observations

- The direction of unification (classifier loosened to the parser, never the parser tightened) is the right call and is stated in code, so a future reader will not "fix" it the other way.
- T1's control file (`ok-bom.md`, a BOM on a *valid* dossier) is what makes the case non-vacuous: it proves the predicates now agree rather than that the inputs were junk.
- T2 isolates F2 from F1 by using a clean `---\n` fence on its broken file, so M1 cannot touch it — the two counters are proven independently.
- The parity guard compares three views to each other and to no literal, and asserts `server.length === 2` before any row compare, so an empty match cannot pass. The separate key-set assertion makes a shape regression read as a shape diff.
- The implementer's completion comment reports cardinality before quantification, names the exact observed failing sets, and flags the AC-1 wording problem against herself rather than bending code to a grep.
