# AS-91: exclude DMs with a human participant from the chat export; delete the nine committed human:forrest DM files

Plan by `agent:cto-owen`, 2026-09-08 (tick `watcher:17217`). Implementer: `agent:developer-marcus`. Reviewer: a QA who did not review AS-45/AS-75 (Priya by default).
The task description (`lattice show AS-91`) carries the WHAT/WHY, the six scoping decisions, and AC-1..AC-7. This file is the HOW. Complexity: low.

Branch `feat/AS-91-export-exclude-human-dms`, worktree `.worktrees/AS-91/`. Below, `$M` = `/Users/forrest/Code/american-software-company` (main checkout, pinned to master) and `$W` = `$M/.worktrees/AS-91`. Use `git -C $W …` for worktree work; never `cd` there before a `lattice` call.

## 0. Ground truth (verified 2026-09-08 against master f08ad41) — where the description drifted

| Description says | Actual |
|---|---|
| WHERE clause at `store.js:829-841` | Holds: comment block 829-835, `SELECT … WHERE NOT (type = 'channel' AND visibility = 'private') ORDER BY id` at 836-841 (the WHERE is line 839). |
| `dmKeyFor` at `store.js:103` | Holds (103-105: `[a, b].sort().join('|')`). Note the consequence: `agent:` sorts before `human:`, so in every agent-human DM the human is the **second** component. A human-**first** key only occurs for a human-human DM. |
| DM rows `visibility='private'` at `store.js:350` | Holds (INSERT at 350-352 inside `openDm`). |
| Determinism contract at `store.js:800-807` | Comment is at 802-807; same content. |
| `export.test.js:122/123` | Hold exactly (test 'DM filenames use the ~ scheme…' at 113-128). |
| AS-6 CLI test at `export.test.js:240-272` | The test spans 240-284; the count assertions are at 262-263, the file-list assertion at 265-270. |
| "nine files" | Confirmed by `ls apps/chat/data/export/` — exactly nine `*~~human~forrest.jsonl` files (enumerated in §4). Five agent-agent DM files, four channel files and `identities.jsonl` stay. |
| Plan scaffold "empty" | The scaffold held a copy of the description; replaced by this file. |

Export consumers, all through the single function `exportFiles()` in `apps/chat/lib/store.js`: `bin/chat.js` `case 'export'` (491-520) in direct mode; the same case in API mode via the server adapter; and `GET /api/export` (`api.test.js:578-584`). One chokepoint, so one predicate. `mode.test.js:383-395` and `api.test.js:578-584` compare their output **relative to** `store.exportFiles()`, so they stay green under any predicate and are not part of the falsifier set.

The CLI summary counts (`chat.js:495-506`) are derived by iterating the very array it writes (`conversations += 1; messages += lines.length - 1` per non-identities file). There is no second query. That is what keeps decision 2(b) consistent with 2(a): a conversation that is not in `files` cannot move a number. **Do not touch `chat.js`.** The AC-2 test pins this: if anyone later replaces the file-derived counts with a `SELECT COUNT(*)` that forgets the predicate, that test goes red.

## 1. The code change (one commit: `AS-91: exclude DMs with a human participant from exportFiles()`)

`apps/chat/lib/store.js`, the query at 836-841. Replace the WHERE with:

```sql
WHERE NOT (type = 'channel' AND visibility = 'private')
  AND NOT (type = 'dm' AND (substr(dm_key, 1, 6) = 'human:' OR instr(dm_key, '|human:') > 0))
ORDER BY id
```

Decisions, so nobody re-derives them:

- **SQL, not a JS filter, and not both.** One predicate in the one function every consumer calls. Two predicates (SQL + JS) are two things that can drift; AS-6's exclusion is here, and this composes with it by `AND`.
- **`dm_key` prefix test, not a join on `identities.kind`.** They are the same predicate — `registerIdentity` (store.js:199-209) rejects any id whose prefix is not its kind — but the `dm_key` form is row-local and **fails closed**: a join through `conversation_members` would leak a DM whose membership rows were somehow missing. A privacy guard fails closed.
- **`substr`/`instr`, not `LIKE`.** `_` is in the identity alphabet and is a `LIKE` single-character wildcard. Don't open that class of bug.
- **Both branches are real.** `instr(…, '|human:')` catches every agent-human DM (human is always the second component, §0). `substr(…, 1, 6) = 'human:'` catches human-human DMs. AC-4's test exercises both (§2).
- **Header line unchanged** (AS-6 reasoning; description decision 5). No new key.

Also update the comment block at 829-835: the sentence "DMs keep exporting exactly as before (pre-existing AS-5 behavior)" becomes: "AS-91: DMs with a human participant (either dm_key component `human:*`) are excluded the same way — no file, no counts (#board msg 559, 2026-09-07). Agent-agent DMs keep exporting; they are company work record." Keep the sentence about the header line.

## 2. Tests (`apps/chat/test/export.test.js`, same commit as §1)

Exact titles matter: the reviewer matches the mutant's failing set against them (§3).

**T1 — modify** 'DM filenames use the ~ scheme, are safe, and never collide' (113-128):
- Line 117: register `agent:x9._-z` with `kind: 'agent'` instead of `human:x9._-z` (same alphabet coverage — dots, underscores, hyphens, digits).
- Line 118: `store.openDm('agent:a1.b_c-d', 'agent:x9._-z')`.
- Line 122: expect `'dm-agent~a1.b_c-d~~agent~x9._-z.jsonl'` — the mapping is still exercised on a file that exists.
- Line 123 **inverted, not deleted**: `assert.ok(!dmNames.includes('dm-agent~cto-owen~~human~forrest.jsonl'), 'AS-91: the human:forrest DM must not export')`. Keep line 119's `openDm('agent:cto-owen', 'human:forrest')` so the pin is real.

**T2 — new** `'AS-91: a DM with a human participant produces no export file; the sibling agent-agent DM still does'` (AC-1):
one fresh store; register `agent:developer-marcus`, `agent:qa-priya`; DM marcus↔forrest with 2 messages (distinct bodies, e.g. `'human dm one'`, `'human dm two'`); DM marcus↔priya with 1 message. Assert: no filename contains `'~~human~'` and none starts with `'dm-human~'`; no line of any file contains either human-DM body; `dm-agent~developer-marcus~~agent~qa-priya.jsonl` exists with exactly 2 lines (header + 1 message); `identities.jsonl` still contains a line with `"id":"human:forrest"` (decision 2 — identity existence is not conversation content).

**T3 — new** `'AS-91: any human identity is excluded, not just human:forrest (human-second and human-first keys)'` (AC-4):
register `human:test-advisor` (`kind: 'human'`) and `agent:developer-marcus`; DM marcus↔test-advisor with 1 message (`'advisor secret'`); DM forrest↔test-advisor with 1 message (`'two humans'` — dm_key `human:forrest|human:test-advisor`, the only way to hit the `substr` branch). Assert no `dm-` filename contains `'~~human~'` or starts with `'dm-human~'`, and neither body appears in any exported line. A `human:forrest` hard-code fails this test on the first DM; a predicate that only checks the second component fails it on the second.

**T4 — new** `'cli: AS-91 — chat export skips human DMs: no file, no counts, still byte-identical on re-run'` (AC-2), a mirror of the AS-6 CLI test at 240-284:
seed `#engineering` 1 message, DM marcus↔forrest 2 messages, DM marcus↔priya 1 message; close the store; run `[BIN, 'export', '--out', outDir, '--json']` with `CHAT_DB`. Assert `parsed.conversations === 4` (3 seed channels + the agent-agent DM), `parsed.messages === 2`; `readdirSync(outDir).sort()` deep-equals exactly `['channel-announcements.jsonl','channel-engineering.jsonl','channel-lattice-events.jsonl','dm-agent~developer-marcus~~agent~qa-priya.jsonl','identities.jsonl']`; no file contains the human-DM bodies; second run byte-identical (hash map, as in 274-283). Under the mutant the numbers read 5/4 — red.

Untouched and expected green: the three AS-5 tests (42-111), the AS-6 trio (190-238), AS-3 (288-323), `mode.test.js`, `api.test.js`. AC-6 is the existing determinism tests (80-92, 130-186) plus T4's re-run assertion.

## 3. Proving the guard (M4) — the mutation recipe, run AFTER §1+§2 are committed on the branch

Scratch copy, not the task worktree. A detached second worktree of the same commit is the scratch copy:

```
M=/Users/forrest/Code/american-software-company
S=/tmp/AS-91-mutant
git -C $M worktree add --detach $S feat/AS-91-export-exclude-human-dms
```

**Mutate** `$S/apps/chat/lib/store.js`: delete the whole `AND NOT (type = 'dm' AND (substr(dm_key, 1, 6) = 'human:' OR instr(dm_key, '|human:') > 0))` line so the WHERE is exactly the AS-6 form `WHERE NOT (type = 'channel' AND visibility = 'private') ORDER BY id`. **Assert it applied** before running anything: `grep -c "instr(dm_key" $S/apps/chat/lib/store.js` must print `0`, and `git -C $S diff --stat` must list exactly `apps/chat/lib/store.js` (an unapplied mutation looks exactly like a passing guard — CLAUDE.md records a `sed` that "passed" this way).

**Run the suite from the scratch copy** with its own compose project name so it shares no image with the live `asc-chat` project:

```
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f $S/apps/chat/compose.yaml -p asc-as91-mutant --profile tools run --rm --build test
```

Record, verbatim, the `# tests` / `# pass` / `# fail` lines and the **names** of the failing tests. Expected red set: exactly T1, T2, T3, T4 — four tests, all in `export.test.js`, nothing else. A wider or narrower set is a finding in its own right (report it; do not "fix" the expectation).

**Restore and prove**: `git -C $M worktree remove --force $S`; `docker image rm asc-as91-mutant-test`; `git -C $W status --porcelain` shows nothing you did not intend (the mutant never touched `$W`). Then **rebuild and re-run** the real suite from `$W` (§5) and record its numbers next to the mutant's: same `# tests` cardinality, `# fail 0`.

Fallback only if the detached worktree is impossible: in-place in `$W`, as a **single Bash invocation** (the tool resets cwd and shell state between calls, so a `trap` does not survive to a second call): back up the file, `trap` the restore on `EXIT`, mutate, assert applied, run, let the trap restore, then `git -C $W diff --exit-code -- apps/chat/lib/store.js`, then rebuild and re-run.

## 4. The data-deletion commit (second commit, data only: `AS-91: remove the nine committed human:forrest DM exports`)

Enumerated from `ls apps/chat/data/export/` on 2026-09-08 — exactly these nine, relative to `$W`:

```
apps/chat/data/export/dm-agent~ceo-carla~~human~forrest.jsonl
apps/chat/data/export/dm-agent~cto-owen~~human~forrest.jsonl
apps/chat/data/export/dm-agent~designer-sofia~~human~forrest.jsonl
apps/chat/data/export/dm-agent~developer-lena~~human~forrest.jsonl
apps/chat/data/export/dm-agent~developer-marcus~~human~forrest.jsonl
apps/chat/data/export/dm-agent~qa-priya~~human~forrest.jsonl
apps/chat/data/export/dm-agent~researcher-elliot~~human~forrest.jsonl
apps/chat/data/export/dm-agent~researcher-nadia~~human~forrest.jsonl
apps/chat/data/export/dm-agent~ux-jonah~~human~forrest.jsonl
```

`git -C $W rm` those nine paths (a mid-word `~` is not tilde-expanded by the shell; quoting is still cheap). Do **not** remove `dm-agent~ceo-carla~~agent~cto-owen`, `~~agent~developer-marcus`, `~~agent~qa-priya`, `dm-agent~qa-fixture~~agent~qa-priya`, the four `channel-*` files or `identities.jsonl`. Verify: `git -C $W diff --stat master...HEAD -- apps/chat/data/export/` shows 9 files, all deletions, 0 insertions. No history rewrite of any kind (decision 4).

Merge hazard to know about: if a `records: chat export …` commit lands on master before this merges and appends to any of the nine, the `--no-ff` merge hits a modify/delete conflict on that file; resolve by keeping the deletion. The records step is suspended until AS-91 merges (CLAUDE.md), so this should not arise.

## 5. Running the suite (environment reality)

The app runs only under compose; `docker` is on the tick PATH since 4f2cd89 (verified in this tick). The `test` service is mountless and copies `test/` into the image, so it runs the branch's bits only if the image is rebuilt — hence `--build`, always, and the `Built` line for the test image in the output is the receipt; **a quoted number without a `Built` line is void** (CLAUDE.md, AS-45 corollary). Do not pass `--progress quiet` — it suppresses the receipt.

```
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f $W/apps/chat/compose.yaml -p asc-as91-<actor> --profile tools run --rm --build test
```

`-f` makes the build context the worktree's `apps/chat`; `-p asc-as91-<actor>` (`marcus`, `priya`) keeps your image apart from the live server's and from each other's. Run it once on the unmodified branch tip first to record the baseline `# tests` (grep counts 283 top-level `test(` calls across the 20 files today; `node --test`'s own line is the number that counts), then after §1+§2 expect baseline + 4. Remove your image when done (`docker image rm asc-as91-<actor>-test`) — the AS-75 review left one behind.

## 6. README (AC-7, in the §1 commit)

`apps/chat/README.md` Durability paragraph (482-501): replace the sentence "DMs keep exporting exactly as before." (line 495) with: "**DMs with a human participant are excluded the same way (AS-91, board directive 2026-09-07): no `dm-*~~human~*.jsonl`, ever.** The same durability caveat applies: those DMs exist only in the gitignored SQLite DB and in manual `chat dump` backups. Agent-agent DMs keep exporting — they are company work record." The `chat export` usage line (446-448) and `bin/chat.js` USAGE (52-54) mention no DMs; leave them.

## 7. AC-5 pre-merge check — the reviewer's recipe (scratch DB copy, never the live path)

The live DB is `apps/chat/data/chat.db` **plus** `chat.db-wal` (4 MB, everything since Sep 5) and `chat.db-shm`. Copy all three or you test a three-day-old database:

```
mkdir -p /tmp/AS-91-db && chmod 777 /tmp/AS-91-db
cp $M/apps/chat/data/chat.db $M/apps/chat/data/chat.db-wal $M/apps/chat/data/chat.db-shm /tmp/AS-91-db/
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f $W/apps/chat/compose.yaml -p asc-as91-priya --profile tools run --rm --build -T \
  -e CHAT_API= -e CHAT_DB=/scratch/chat.db -v /tmp/AS-91-db:/scratch cli export --out /scratch/export --json
```

Empty `CHAT_API` plus an explicit `CHAT_DB` is direct mode with no probe (`chat.js` precedence rule 4), so the run reads the copy, not the server. Then compare `/tmp/AS-91-db/export/` with `$W/apps/chat/data/export/`: the file **sets** must be equal (no `~~human~` name in the scratch set; every committed public file present), and every committed file must be a byte-prefix of its scratch counterpart (`cmp -n "$(wc -c < committed)" committed scratch`). That is exactly the post-merge property "a fresh export re-creates none of the nine and leaves `git status` clean apart from appends", proven without writing to the tracked path. Delete `/tmp/AS-91-db` afterwards. The post-merge half is observed by the tick that runs the first records export after merge (§8).

## 8. At merge (orchestrator, not the implementer)

- Merge `--no-ff` from `$M` as usual. The first `chat export` afterwards must produce no `~~human~` file and only appends — the merge tick reports that as AC-5's second half.
- Proposed CLAUDE.md wording for the metawork layer (employees do not edit it): under "Operational record commits", delete the paragraph beginning "**Records step SUSPENDED until AS-91 merges**" and change "implemented by AS-91, which also removes the nine already-committed `dm-*~~human~forrest.jsonl` files without rewriting history" to "implemented by AS-91 (merged <date>), which also removed the nine previously committed `dm-*~~human~forrest.jsonl` files without rewriting history"; the matching suspension sentence in `.claude/commands/advance.md` is removed. Under "Repo Visibility", "the implementing task removes the files but does not rewrite history" becomes "AS-91 removed the files but did not rewrite history".

## 9. Acceptance criteria — the review floor (M5: findings first, this sweep second; M6: probe past it)

AC-1..AC-7 as in the task description, made concrete by this plan: AC-1 = T2 (§2) green, and observed red under the §3 mutant; AC-2 = T4 green and observed red under the mutant; AC-3 = T1 modified as specified (line 123 inverted, line 122 re-pointed to an agent-agent key) and observed red under the mutant; AC-4 = T3 green, both key positions, observed red under the mutant; AC-5 = nine deletions and only those (§4) plus the §7 scratch-DB comparison; AC-6 = existing determinism tests green and T4's re-run assertion; AC-7 = §6 wording present.

Added by this plan:
- **AC-8. Mutation cardinality.** The §3 run's failing set is exactly {T1, T2, T3, T4} and the suite total equals the green run's total; the review comment quotes both runs' `# tests/# pass/# fail` lines and shows the `Built` receipt for each. An argument that the tests "would" fail does not satisfy AC-1/2/3/4.
- **AC-9. Single chokepoint.** `grep -n "FROM conversations" apps/chat/lib/store.js apps/chat/server.js` shows no second conversation-listing query feeding an export path; `chat.js` is unchanged (`git diff --stat master...HEAD -- apps/chat/bin` empty).
- **AC-10. Nothing left behind.** No `asc-as91-*` images, no `/tmp/AS-91-*` directories, no extra worktrees (`git worktree list` shows only master and `.worktrees/AS-91`).

Places worth probing past the list: a DM opened but never messaged (header-only file — must also be absent); an identity registered with `kind: 'human'` whose id has dots/hyphens; whether `dump` (deliberately visibility-blind, an operator surface) was left alone — it should be.
