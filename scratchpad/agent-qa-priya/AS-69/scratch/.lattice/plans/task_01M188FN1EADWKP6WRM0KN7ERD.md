# Plan: AS-5 — Chat history durability: JSONL export committed to git

Author: agent:cto-owen (planning stage). Design was decided with the investor
(see task description); this plan turns it into an implementable spec. Where I
verified the design against the code, I note what I found.

## Problem

All chat history lives in one SQLite file, `apps/chat/data/chat.db` (WAL,
gitignored, one machine, no backup). A lost laptop loses the company's entire
conversational record. Fix: deterministic, append-only JSONL exports of the
chat store, committed to the repo on a recurring operational cadence.

`chat dump` already exists but is the wrong artifact to commit: it includes
`read_state` (rows that are UPDATEd in place as people read) and
`ingested_events`, so consecutive dumps produce churny, non-append-only diffs.
The export is a new, narrower artifact: conversations + messages + identities
only — the tables that are insert-only in this codebase (there is no message
edit/delete, no identity delete, no channel edit).

## Scope

1. `chat export` subcommand — per-conversation append-only JSONL to a tracked
   directory, idempotent and deterministic.
2. `.gitignore` carve-out so `apps/chat/data/export/` is tracked while the DB
   stays ignored.
3. `.gitattributes` `merge=union` for the export files.
4. `/advance` tick procedure gains an export+commit step at the
   push-master-after-merge point.
5. `CLAUDE.md` Git Methodology gains an "operational record commits" carve-out
   (`records: chat export <date>`).
6. Tests (zero-dependency `node:test`, in-container like everything else).
7. README update + initial baseline export committed on the task branch.

Explicitly out of scope: any scheduler/daemon (delivery model is "no daemons"),
restore/import tooling (the JSONL is readable by a future importer; writing one
now is speculative), and exporting `read_state`/`ingested_events` (operational
cruft; churn would destroy clean diffs — deliberate omission).

## Export design

### Directory and file naming

Target dir: `apps/chat/data/export/` (in-container: `/app/data/export/` — the
`./data` bind mount already exists on both `server` and `cli` services, and the
image runs as user `node` with `/app` chowned, so container writes land on the
host with no compose changes).

One file per conversation plus one for identities:

- `identities.jsonl` — all identities, ordered by `id`.
- `channel-<name>.jsonl` — channel names are already constrained to
  `[a-z0-9-]+` and UNIQUE, so the name is filesystem-safe and collision-free.
- `dm-<key>.jsonl` — where `<key>` is `dm_key` with `:` → `~` and `|` → `~~`.
  The identity alphabet (`[a-z0-9._-]`, kind prefixes `human|agent|system`)
  contains neither `~`, `:` nor `|`, and `:` is never adjacent to `|` in a
  valid dm_key, so the mapping is injective — two distinct DMs can never
  collide on filename. `~` is safe on macOS/Linux/Windows filesystems.
  Example: `dm-agent~cto-owen~~human~forrest.jsonl`.

Filenames are derived conveniences; the file content is authoritative (each
conversation file self-describes via its first line).

### File format

JSONL, LF line endings, one JSON object per line, keys emitted in a fixed
explicit order (hand-built objects, not `SELECT *` spreads), no export-run
timestamp anywhere in the content (that would break idempotency).

Conversation files:

- Line 1: `{"type":"conversation","id":…,"conv_type":"channel"|"dm","name":…,"purpose":…,"dm_key":…,"members":[…]|null,"created_by":…,"created_at":…}`
  — immutable in this codebase, so line 1 never changes across runs.
- Lines 2..N: `{"type":"message","id":…,"thread_root_id":…|null,"author":…,"body":…,"created_at":…}`
  ordered by `id` ASC. `conversation_id` is implied by the file (kept out of
  each line to reduce noise; the header carries it).

`identities.jsonl`: `{"type":"identity","id":…,"display_name":…,"kind":…,"created_at":…}`
ordered by `id`.

Append-only property: message ids are monotonically increasing per
conversation and rows are never mutated, so re-running export writes each
prior file as a byte-identical prefix plus new message lines appended — git
diffs of a re-run are pure additions (plus possibly new files for new
conversations). One exception: `identities.jsonl` is ordered by `id` (a text
key), so a new identity can insert a line mid-file. Acceptable — identities
arrive rarely, the diff is still a clean one-line addition, and ordering by id
keeps the file deterministic. Note it in the README.

BigInt hygiene: normalize any `bigint` from `node:sqlite` to `Number`, same as
`dumpLines()` does today.

### Idempotency contract (the acceptance bar)

- Same DB state ⇒ byte-identical files ⇒ `git status` clean ⇒ the /advance
  commit step is a natural no-op. No "skip if unchanged" logic needed in the
  exporter — determinism *is* the idempotency mechanism.
- Writes go through write-then-`rename` per file? No — not needed. The
  exporter runs in a one-off CLI container invoked by a sequential tick; a
  plain `writeFileSync` per file is fine. (Rejected atomic-rename as
  complexity without a concurrent writer to defend against.)

### Code structure

All SQL stays in `lib/store.js` (the portability seam — no SQL outside it):

- `store.exportFiles()` → returns `[{ filename, lines: [string…] }, …]`,
  deterministic order (identities first, then conversations by id). Pure data,
  no filesystem access — this is what unit tests exercise.
- `bin/chat.js` gains `export [--out <dir>]` (default:
  `join(dirname(DB_PATH), 'export')`, i.e. `/app/data/export` in-container).
  Creates the dir, writes each file with trailing newline, prints a summary:
  `Exported <C> conversations, <M> messages, <I> identities to <dir>`;
  `--json` variant emits `{files, conversations, messages, identities, out}`.
  Update the USAGE block and README CLI table.

Host invocation (what /advance will run): `./apps/chat/chat export` — the
wrapper's `docker compose run --rm cli` path already bind-mounts `./data`, so
the files appear at `apps/chat/data/export/` on the host.

## Repo plumbing

### .gitignore

Replace the blanket rule:

```
apps/chat/data/*
!apps/chat/data/export/
```

(The current `apps/chat/data/` form ignores the directory itself, which makes
any negation inside it dead — must switch to `/*` + negation. DB/WAL/SHM stay
ignored via the `*`.)

### .gitattributes

Append, with a comment mirroring the Lattice one:

```
apps/chat/data/export/*.jsonl merge=union
```

Justified by the same argument as Lattice events: files are append-only, line
appends from parallel branches are order-independent per file. (Union merge
can interleave two branches' appends out of id-order within a file; consumers
must not assume strict line-order beyond what ids encode. Note in README.)

## /advance wiring (exact wording)

In `.claude/commands/advance.md`, Tick procedure step 2, first bullet, extend
the "On pass" clause:

> On pass: merge `--no-ff` into master, **then run the operational-records
> step: `./apps/chat/chat export`, and if it changed
> `apps/chat/data/export/`, commit those files to master as
> `records: chat export <YYYY-MM-DD>` (see Git Methodology, "Operational
> record commits") before pushing** — then push master, delete the branch,
> move to `done`.

Rationale recorded in the task description and preserved here: NOT a git
pre-push hook (a mutating hook creates commits the in-flight push misses) and
NOT PR-open (no PRs exist in this flow; local `--no-ff` merges only). The
post-merge/pre-push point is the one moment master is already being touched
by the orchestrator with a push immediately following.

## CLAUDE.md Git Methodology carve-out (exact wording)

Add a short subsection after "Commits":

> ### Operational record commits
>
> Recurring operational exports (currently: chat history, per AS-5) belong to
> no single task. They commit directly to master with message format
> `records: chat export <YYYY-MM-DD>` — the second sanctioned exception to
> the `AS-<n>:` rule alongside investor/chat-channel work. Scope discipline:
> a records commit touches only `apps/chat/data/export/` (and future record
> paths); never mix it with code. Identity: committed by the employee running
> the tick, under their persona git identity.

## Files to touch

| File | Change |
|---|---|
| `apps/chat/lib/store.js` | add `exportFiles()` (+ small helpers: filename derivation, row shaping) |
| `apps/chat/bin/chat.js` | `export` subcommand, USAGE text |
| `apps/chat/test/store.test.js` | export unit tests (or a new `test/export.test.js` — implementer's call; keep the temp-dir pattern) |
| `apps/chat/README.md` | CLI table row, Storage section paragraph on export/durability, union-merge caveat |
| `.gitignore` | `data/*` + `!data/export/` carve-out |
| `.gitattributes` | union rule for `export/*.jsonl` |
| `.claude/commands/advance.md` | records step in tick step 2 |
| `CLAUDE.md` | Operational record commits subsection |
| `apps/chat/data/export/*` | initial baseline export, committed on this branch as proof the pipeline works |

## Test plan (node:test, runs via `docker compose run --rm --build test`, no mounts)

1. **Round-trip fidelity**: seed a temp store; register identities, create a
   channel + a DM; post top-level messages and thread replies (including
   multi-line bodies, unicode, quotes); run `exportFiles()`; parse every line
   back and assert the reconstructed set equals the `messages` table exactly —
   ids, authors, `thread_root_id`s, `created_at` timestamps, bodies.
2. **Determinism/idempotency**: call `exportFiles()` twice with no writes in
   between; assert deep-equal output. Mark conversations read in between;
   assert output unchanged (read_state excluded by design).
3. **Append-only**: export, post one more message, export again; assert every
   prior file's content is a strict prefix of the new content, and only the
   affected conversation file grew.
4. **Filename safety**: DM between two identities exercising the full id
   alphabet (`.`/`_`/`-`); assert derived filename matches the `~` scheme,
   contains no `:`/`|`, and distinct DMs yield distinct filenames.
5. **CLI integration**: run `bin/chat.js export --out <tmpdir>` as a child
   process against a temp `CHAT_DB`; assert files exist on disk, summary line
   matches, exit 0; run twice, assert byte-identical files (hash compare).
6. Existing suite stays green.

## Acceptance criteria

- [ ] `./apps/chat/chat export` writes per-conversation JSONL +
      `identities.jsonl` to `apps/chat/data/export/`; running it twice
      back-to-back leaves `git status` clean (idempotent).
- [ ] Export round-trips the messages table faithfully: authors, thread
      structure, timestamps, bodies (test #1 proves it).
- [ ] `apps/chat/data/export/` is tracked; `chat.db*` remain ignored.
- [ ] `.gitattributes` union-merges `export/*.jsonl`.
- [ ] `.claude/commands/advance.md` documents the export+commit step at the
      post-merge/pre-push point, with the `records:` message format.
- [ ] `CLAUDE.md` Git Methodology contains the operational-record-commits
      carve-out.
- [ ] Full test suite passes in-container with zero mounts.
- [ ] Baseline export committed on the task branch.

## Open questions (time-boxed, with defaults)

- Should `dm-*` exports of private conversations be in a public GitHub repo at
  all? Today the repo is the company's own record and the investor mandated
  durability-in-git, so **default: yes, export everything**. If the repo ever
  goes public or a genuinely sensitive channel appears (e.g. AS-6 #board),
  revisit with a per-conversation export opt-out. Flagged in my task comment;
  not blocking.
