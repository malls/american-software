# AS-73: Chat: the org gate cannot see a person it never classified, and reports no examined count

Planner: agent:cto-owen (tech lead), 2026-09-11, against master b1bba80. Complexity: low.
Source: four findings from Priya's AS-33 cycle-1 review (task description). All in `apps/chat`.

## 1. Scope

**Changes** (four findings, one branch, one PR-sized diff):

1. `lib/personnel.js` — one exported "is this a dossier?" predicate, used by both the parser and the unparsed-dossier classifier. Plus an `examined` count in `readPersonnel`'s return.
2. `bin/check-org.js` — print the examined-file count (cardinality) before the parsed/unparsed line (quantification).
3. A new parity guard: the CLI's roster row shape is derived from the server's, never asserted alone.
4. `public/org-chart.js` — `validateOrg` tolerates a null roster entry the way `buildOrgTree` already does; the orphan message says "invalid status" when that is the reason, and "departed" only when it is.

**Does not change:** the roster's membership (no file's roster fate moves — finding 1 loosens the *classifier* to match the *parser*, never the reverse; tightening the parser would drop real people who parse today); `--json` output of `check-org` (it is pinned to `/api/org`'s shape and the examined count is not on that surface — recorded as a deliberate omission, see §9); `test/fixtures/**` (both fixture roots carry load-bearing file counts asserted by name — new cardinality comes from scratch roots); the one pre-AS-33 vacuous case (`readRoster: missing personnel/ directory yields []`) — recorded in the task as not-work, left alone.

## 2. Approach per finding

### F1 — one predicate

Today (`lib/personnel.js`): `parseFrontmatter` accepts a file when `lines[0].trim() === '---'` (line 40); the classifier in `readPersonnel` reports a parse-null file as `malformed_frontmatter` only when `/^---\r?\n/.test(text)` (line 102). `trim()` tolerates leading whitespace, trailing whitespace, and U+FEFF (a BOM is in `trim`'s whitespace set); the regex tolerates none of them and also rejects a fence with no trailing newline. A file whose first line is `--- ` / `\t---` / `﻿---` and whose closing fence is missing is accepted by the parser as a dossier, yields null, fails the regex, and is silently dropped — a person the gate never classified.

Change:

```js
/** The single "is this text a dossier?" test. Both the parser and the
 *  unparsed-dossier classifier ask it, so a file cannot be a dossier to
 *  one and not the other (AS-73 F1). Matches parseFrontmatter's historic
 *  acceptance exactly: first line, trimmed, is the fence. */
export function hasLeadingFence(text) {
  return String(text).split(/\r?\n/, 1)[0].trim() === '---';
}
```

- `parseFrontmatter`: replace `if (lines[0].trim() !== '---') return null;` with `if (!hasLeadingFence(text)) return null;`.
- `readPersonnel`: replace `if (/^---\r?\n/.test(text))` with `if (hasLeadingFence(text))`. Update the comment above it (it currently says "the fence test below").
- Update the `skipped` doc comment: "files that LOOK like dossiers (`hasLeadingFence`)".

### F2 — examined count

- `readPersonnel` returns `{ roster, skipped, sources, examined }` where `examined` is the number of `.md` entries the loop attempted to read (README included; unreadable included; non-`.md` entries excluded — they were never examined). Missing directory ⇒ `examined: 0`. Invariant every consumer can check: `examined === roster.length + skipped.length + (files with no leading fence)`.
- `bin/check-org.js`, non-JSON path only: print, **before** the degradation message and before the existing parsed line, exactly

  `Examined ${data.examined} .md files in ${root}/personnel\n`

  The existing `N active of M dossiers parsed, K unparsed, in …` line is unchanged (three existing assertions match it). The `No personnel records found` branch keeps its wording; the Examined line precedes it (`Examined 0 .md files …` on a bare root). `--json` is unchanged (§1).
- `validateOrg` ignores the extra key (it destructures three named fields) — no change needed, but the F4a test below passes the four-key shape through to prove it.

### F3 — CLI/server roster parity guard

New file `test/roster-parity.test.js` (own file: it imports `createChatServer` *and* spawns `bin/chat.js`; neither `cli.test.js` nor `api.test.js` does both). Harness: copy `bootServer` from `test/mode.test.js` (ephemeral port via `listen(0)`, temp `chat.db`, `repoRoot` = `test/fixtures/repo`, env scrubbed of `CHAT_MODE/CHAT_API/CHAT_DB/CHAT_ME`). Seed a registration and one DM with a message through the API (same three `post` calls as `api.test.js` lines 429–433) so `registered`, `dmConversationId`, `unread`, `work`, `moreTasks` are all non-trivial.

One test, three views of the same DB, compared to each other — never to a literal:

1. **server** — `GET /api/roster?me=human:forrest` → `rows.map(({ self, ...row }) => row)` (the documented web-UI-only field is the only permitted difference).
2. **CLI direct** — `spawnSync(node, [BIN, 'roster', '--json', '--me', 'human:forrest'])` with env `{ CHAT_DB: <same dbPath>, CHAT_REPO_ROOT: FIXTURE_ROOT }` and no `CHAT_API` (resolution rule 4: explicit alternate store ⇒ direct, no probe — the `cli.test.js` pattern; this is not a `CHAT_MODE=direct` override).
3. **CLI api** — same argv with env `{ CHAT_API: <base> }` (the `mode.test.js` pattern; goes through `lib/client.js` `rosterRows`).

Assertions, in this order: `assert.deepEqual(direct, server)` and `assert.deepEqual(api, server)` (whole rows: shape *and* values); then explicitly `assert.deepEqual(Object.keys(direct[0]).sort(), Object.keys(server[0]).sort())` so a failure reads as a shape diff; then the same three-way compare without `me` (no `dmConversationId/unread` anywhere). Cardinality first: assert `server.length === 2` before any row compare — an empty three-way match is vacuous. Reads only: the direct-mode process opens a DB the server also has open, but the guard writes nothing from the CLI side and both are on one host filesystem, so the AS-24 WAL hazard (container bind-mount) does not apply.

### F4 — two small defects in `public/org-chart.js`

a. `validateOrg` line 115: `const all = Array.isArray(roster) ? roster : [];` → `const all = (Array.isArray(roster) ? roster : []).filter(Boolean);`. Today the `active` filter and the `anyId` loop guard against a null entry but the `invalid_status` loop (`for (const e of all) … e.status`) does not, so `validateOrg({ roster: [null] })` throws while `buildOrgTree([null])` is tested to degrade. The `e &&` guards on lines 116 and 120 become redundant; remove them so there is one rule.

b. Orphan detail (lines 141–143). `known` is any dossier with that id; it is outside `byId` because it is not active, which means either `departed` or an invalid status:

```js
detail: !known
  ? `reports to ${target}, who has no dossier`
  : known.status === 'departed'
    ? `reports to ${target}, who is departed`
    : `reports to ${target}, whose status ${JSON.stringify(known.status ?? '')} is invalid`,
```

The `invalid_status` rule still fires on the target separately; the orphan message now points the reader at the right dossier line instead of telling them to re-point a live manager.

## 3. Key files and functions

| File | What |
|---|---|
| `apps/chat/lib/personnel.js` | new `hasLeadingFence(text)` (exported); `parseFrontmatter` line 40; `readPersonnel` line 102 + `examined` counter and return shape + doc comment |
| `apps/chat/bin/check-org.js` | Examined line before line 84's degradation branch |
| `apps/chat/public/org-chart.js` | `validateOrg` lines 115–120 (null filter), 141–143 (orphan detail). Module purity test (`org: the module is pure`) still applies — no imports |
| `apps/chat/test/personnel.test.js` | +2 cases (F1 unit, F2 unit) |
| `apps/chat/test/org-chart.test.js` | +1 scratch-root check-org case (F1+F2 at the gate); +2 validator cases (F4a, F4b); Examined-line assertions added to the two existing check-org fixture cases |
| `apps/chat/test/roster-parity.test.js` | new, +1 case (F3) |

Untouched: `server.js`, `lib/client.js`, `public/app.js`, fixtures, `compose.yaml`.

## 4. New test cases (names are the executable names — predict them, then make them exist)

- T1 `readPersonnel: fence whitespace and a BOM never hide a broken dossier` (personnel.test.js). Scratch root via `mkdtempSync` + `personnel/` subdir, `t.after` rm. Plant: `lead.md` (`\t---\n…` no closing fence), `trail.md` (`--- \n…` no closing fence), `bom.md` (`﻿---\n…` no closing fence), `bare.md` (`---` with no newline at all), control `ok-bom.md` (`﻿---\nactor_id: agent:ok\nname: Ok\nstatus: active\n---\n`), control `README.md` (`# not a dossier`). Assert `skipped` deepEquals the four `{ file, reason: 'malformed_frontmatter' }` rows in directory order, `roster.map(actorId)` is `['agent:ok']`, `examined === 6`.
- T2 `readPersonnel: examined counts every .md file, dossier or not` (personnel.test.js). Scratch root: two valid dossiers, one broken with a clean `---\n` fence (so M1 cannot touch this case — it isolates the counter), `README.md`, `notes.txt`. Assert `examined === 4`, `roster.length === 2`, `skipped.length === 1`, and the invariant `examined === roster.length + skipped.length + 1`. Missing dir ⇒ `examined === 0` (alongside empty arrays — the existing degradation contract, now four keys).
- T3 `check-org: reports the examined count and every unclassifiable person on a scratch root` (org-chart.test.js, next to the other `checkOrg` cases). Same six files as T1 (built inline, not shared, so each case owns its root). Assert exit 1; stdout matches `/^Examined 6 \.md files in /m` **and** `/1 active of 1 dossiers parsed, 4 unparsed/`; the four `unparsed_dossier` rows by file name via the existing split-on-two-spaces pattern; `/^4 violations\.$/m`.
- T4 `parity: the CLI roster row is the server roster row minus self, in direct and api mode` (roster-parity.test.js) — §2 F3.
- T5 `org: validateOrg tolerates a null roster entry, as buildOrgTree does` (org-chart.test.js). `validateOrg({ roster: [null, emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' })], skipped: [], sources: [], examined: 2 })` deepEquals `[]`; `buildOrgTree([null, …])` still degrades (same input, two functions, one answer).
- T6 `org: orphan_reports_to names an invalid status, not departed, when that is the reason` (org-chart.test.js). Roster: ceo (cofounder), `agent:mgr` manager with `status: 'activ'` reporting to ceo, `agent:dev` reporting to `agent:mgr`. Expect exactly two violations in rule order: `invalid_status` for `agent:mgr` (`status "activ" is not one of active, departed`) then `orphan_reports_to` for `agent:dev` with detail `reports to agent:mgr, whose status "activ" is invalid`.
- Amendments: `check-org: exits 0 on a clean fixture root` gains `assert.match(r.stdout, /^Examined 5 \.md files in /m)`; `check-org: exits 1 and names every violation on the dirty fixture root` gains `/^Examined 6 \.md files in /m`; `check-org: a root with no personnel/ …` gains `/^Examined 0 \.md files in /m`.

Host count after: master 468 (measured 2026-09-11 on b1bba80, `node --test`, 468 pass / 0 fail) + 6 = **474**.

## 5. Acceptance criteria (numbered; M4 — each property names its falsifier)

1. `hasLeadingFence` is exported from `lib/personnel.js` and is the only fence test in the module: `grep -n -- "'---'" apps/chat/lib/personnel.js` lists exactly one code line (inside `hasLeadingFence`) plus comments; `grep -n "^---" ` finds no regex fence.
2. T1 passes, and **T1 + T3 go red under mutation M1** (§6) — predicted failing set is exactly `{T1, T3}`; `check-org: exits 1 and names every violation on the dirty fixture root` stays green under M1 (its broken fixture, `broken-mallory.md`, has a clean `---\n` fence — that is why the AS-33 suite never saw finding 1).
3. `readPersonnel` returns `examined`; T2 passes; the missing-directory return is `{ roster: [], skipped: [], sources: [], examined: 0 }`.
4. `check-org` prints `Examined N .md files in <root>/personnel` first on every non-JSON path; the three amended fixture cases assert 5, 6 and 0 respectively and pass.
5. **Mutation M2 (§6) reds every case that asserts an examined number** — the counter counts classified files instead of examined files, so anything with a non-dossier file in its root is off by one: predicted failing set `{T1 (6→5), T2 (4→3), T3 (6→5), exits-0-clean (5→4), exits-1-dirty (6→5)}`; the bare-root case stays green (0 either way). Record the observed set; a different set is a finding.
6. T4 passes on the unmodified branch, with `server.length === 2` asserted before any row compare.
7. **Mutation M3 (§6) turns exactly `{T4}` red** and `cli: roster prints the active company roster with work status (AS-8)` stays green — the survivor that Priya observed, now caught by one case. Predicted failing set `{T4}`.
8. T5 passes, and against master's `org-chart.js` it throws (`TypeError` on `.status` of null) — demonstrated by running T5 before applying F4a (TDD order), output recorded in the implementation comment.
9. T6 passes, and against master's `org-chart.js` it fails with detail `who is departed` — same TDD-order demonstration.
10. Existing `org: orphan_reports_to names a departed manager as the reason` still passes unchanged (the departed wording is retained, not generalised away).
11. `--json` output of `check-org` on both fixture roots is byte-identical to master's (diff the two stdouts; this is the "does not change" clause of §1 made observable).
12. Host suite: 474 pass, 0 fail. Counted compose run with `--build`: master's compose count + 6 (AS-100's receipt on b0763ad was 464 ⇒ expect 470), receipt = the `Image … Built` line quoted in the comment. Host-minus-compose delta must equal master's (468 − 464 = 4); any other delta is a finding, not noise.
13. `git diff master...feat/AS-73-org-gate-predicates --stat` touches only the six files in §3; no `.lattice/`, no `personnel/`, no fixtures, no top-level markdown, no `package.json`.

## 6. Mutations (scratch copy; anchored; occurrence-accurate)

General recipe, run once per mutation from the worktree `.worktrees/AS-73` (the implementer does it once and records it; QA repeats it cold):

```
W=/Users/forrest/Code/american-software-company/.worktrees/AS-73/apps/chat
F=<target file>; cp "$W/$F" "$W/$F.orig"
trap 'cp "$W/$F.orig" "$W/$F"; rm -f "$W/$F.orig"' EXIT
shasum -a 256 "$W/$F.orig"                       # hash BEFORE
node -e '<anchored edit, see below>'             # the mutation
node -e '<assert applied AT the site>'           # occurrence count via split(...).length-1, never grep -c
(cd "$W" && node --test 2>&1 | tail -8)          # observe: which cases, how many fail
trap - EXIT; cp "$W/$F.orig" "$W/$F"; rm -f "$W/$F.orig"
shasum -a 256 "$W/$F"                            # hash AFTER === hash BEFORE
git -C "$W" status --porcelain                   # must be empty
(cd "$W" && node --test 2>&1 | tail -8)          # green again: 474
```

`(cd …)` is a subshell so the Bash tool's cwd never moves — the CLAUDE.md working-directory hazard.

- **M1** (F1) — `lib/personnel.js`, inside `readPersonnel`: replace the single occurrence of `if (hasLeadingFence(text)) skipped.push({ file, reason: 'malformed_frontmatter' });` with `if (/^---\r?\n/.test(text)) skipped.push({ file, reason: 'malformed_frontmatter' });`. Anchor: the replacement pattern includes `reason: 'malformed_frontmatter'`, which occurs once in the file (the doc comment says `malformed_frontmatter` without `reason:`). Assert applied: the file's text contains `/^---\r?\n/` exactly once and `hasLeadingFence(text)) skipped` zero times. Predicted red: T1, T3 only.
- **M2** (F2) — `lib/personnel.js`, the `examined` increment: move it from "every `.md` entry read" to "every entry that produced a roster or skipped row" — concretely, delete the increment at the read site and add `examined = roster.length + skipped.length` immediately before the `return { roster, skipped, sources, examined }`. Anchor: that return statement occurs once. Assert applied: `examined = roster.length + skipped.length` occurs once; the original increment line occurs zero times. Predicted red: T2, T3, `check-org: exits 0 on a clean fixture root`, `check-org: exits 1 and names every violation on the dirty fixture root`.
- **M3** (F3) — `bin/chat.js`, inside `createDirectBackend.rosterRows`: delete the line `            reportsTo: e.reportsTo,` — the **only** occurrence of `reportsTo: e.reportsTo` in `bin/chat.js` (verified on master: line 190; `server.js` has two, lines 813 and 845, and is not the target). Anchor: assert the occurrence count in `bin/chat.js` goes 1 → 0 and that the deleted line sat between `rosterRows(me) {` and `registerIdentity:` (slice the text between those two anchors and check it no longer contains `reportsTo`). Predicted red: T4 only; `cli: roster prints …` green (the observed survivor).

If a predicted-red case stays green, re-read the mutated file's diff before concluding anything (CLAUDE.md, AS-95 sharpening) — a wrong-site mutation and a weak guard look the same from outside.

## 7. Test-run recipe

- Host: `(cd /Users/forrest/Code/american-software-company/.worktrees/AS-73/apps/chat && node --test 2>&1 | tail -8)` → expect `tests 474`, `fail 0`. Master baseline: 468 (this plan, b1bba80).
- Compose (counted, from the worktree's `apps/chat`): `docker compose run --build --rm test 2>&1 | tee /tmp/AS-73-compose.txt | tail -12`. Valid only if the output contains the `Image … Built` line; quote it. The `test` service mounts nothing, which is the proof T1/T2/T3 built their roots under `tmpdir()` and not under the repo.
- QA additionally runs `node bin/check-org.js` against the REAL root from the main checkout path (read-only; it opens no store) and records the Examined line for the live roster — the first time the gate states its own cardinality on real data.

## 8. Constraints

Zero new dependencies (`package.json` untouched). No protected top-level file edited. No running container touched — the parity test boots its own server on `listen(0)`; the compose `test` service is the only docker invocation. Ephemeral ports only. `personnel/` never written; all roots under `mkdtempSync(join(tmpdir(), …))` with `t.after` cleanup. `lattice` commands only from the main checkout path. Branch `feat/AS-73-org-gate-predicates`, worktree `.worktrees/AS-73`, commits as `developer-<name>` per the git identity rule, message prefix `AS-73:`.

## 9. Decisions and deliberate omissions

- Direction of unification: classifier loosened to the parser's rule, not the parser tightened — membership must not move (task text: "never worse than before").
- `examined` counts `.md` entries only; non-`.md` entries are not "examined" — they were never opened. Stated in the printed line as `.md files` so the number is unambiguous.
- `--json` / `/api/org` do not gain `examined`: that surface is pinned to the server's shape and adding a field is a paired server change with its own parity question. Filed as an omission, not a follow-up task; raise if the board wants the number on the org page.
- The pre-AS-33 vacuous case (`readRoster: missing personnel/ directory yields []`) is out of scope per the task's own "not work" note. T2's missing-dir clause asserts the four-key shape, which is the mutation-visible version of the same contract, so the gap narrows without touching that case.
- No fixture files change. Both fixture roots' counts are asserted by name in existing tests and were the AS-33 review's control; new cardinality lives in scratch roots.

## 10. People

Implementer: `developer-lena` (self-contained medium, no spine dependency — lane doctrine; Marcus is the default implementer for chat tooling but the AS-33 diff was his, and a second pair of eyes on the predicate is worth more than familiarity). Either is acceptable. Reviewer: `qa-ruben` — Priya filed these findings and must not certify their fix. Ruben's mandate under M6: past the list, try a fifth fence malformation the plan did not name (e.g. `---\r\n` alone, or a fence preceded by a blank line, which the parser rejects and so must the classifier — agreement, not acceptance, is the property).
