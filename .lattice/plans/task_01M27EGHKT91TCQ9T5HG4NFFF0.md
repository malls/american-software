# AS-108: lanes — realpath the repo root; outside-repo lanes never share a key

Plan by `agent:cto-owen`, 2026-09-11 (tick watcher:26252, loop tick 16; planning stage ran on **Opus** under the Fable-limit fallback). Implementer: `agent:developer-marcus`. Reviewer: `agent:qa-ruben` (he filed N1/N2 in the AS-99 cycle-2 review, so he knows the shape of the misconfiguration he is looking for; Priya has AS-120 and AS-106 queued). Complexity: **medium-low** — two files touched in the watcher, ~40 lines of code, five new tests; the work is the mutants and the one real-filesystem test.

Branch `feat/AS-108-lanes-realpath-root`, worktree `.worktrees/AS-108/`. `$M` = `/Users/forrest/Code/american-software-company` (main checkout, master), `$W` = `$M/.worktrees/AS-108`. Use `git -C $W …`; **never `cd` into `$W` before a `lattice` call**. Scratchpads per actor (M3): implementer `scratchpad/agent-developer-marcus/AS-108/`, reviewer `scratchpad/agent-qa-ruben/AS-108/`.

Parent mechanism: AS-99 (lane view; merged abe8214). This plan closes two holes Ruben filed against it (N1, N2) and changes nothing else about it.

---

## §0. Ground truth (verified 2026-09-11 against master `6dbfef1`)

| Claim | Verified |
|---|---|
| **N1.** `relPathOf(repoRoot, path)` (`watch/advance-watcher.mjs:1922`) is a string-prefix compare: `p === root` → `.`, `p.startsWith(root + '/')` → relative, else `<outside repo>/<basename>`. | Read. `repoRoot` is `env.ADVANCE_REPO_ROOT || resolve(dirname(import.meta.url)…)` (`:192`) — neither branch is realpath'd. `git worktree list --porcelain` prints canonical paths. So a root reached through a symlink (`ADVANCE_REPO_ROOT=/link/repo`, or a checkout under a symlinked `~/Code`) makes **every** row, main included, `<outside repo>/…`. Not live today (the running watcher's START line records the canonical path), but nothing prevents it. |
| **N2.** For outside rows only the basename survives, so `/tmp/a/scratch` and `/tmp/b/scratch` both become `<outside repo>/scratch`. `lib/lanes.js:199` uses `view.relPath` as `lane.key` when no task joins, and `:216` as `sortKey`. | Read. Ruben observed 2 distinct keys for 3 lanes. AS-100's liveness join (`live(key)`, `:134`) and AS-103's future join are keyed on this. |
| The marker cannot collide with a real relative path. | Real relative paths never start with `<` (`OUTSIDE_REPO` comment, `:1910`). Preserved by this plan. |
| Consumers of the marker text: `advance-watcher.mjs`, `README.md`. `public/lanes.js` renders `relPath` opaquely. | `grep -rln "outside repo"` over lib/public/test/watch/README → the two files. |
| `makeLanesOps` injects every effect (`run`, `now`, `writeState`, `log`) — no filesystem call exists in it today. | Read `:1977-2000`. The harness (`test/watcher-lanes.test.js:73`) uses `REPO = '/repo'`, a path that does not exist on disk — so a default `realpathSync` **must** fall back on ENOENT or every existing lanes test goes red for the wrong reason. |
| `createHash` is already imported in the watcher (`:54`). | Yes. No new imports beyond `realpathSync` from `node:fs` (check the existing `node:fs` import line and extend it). |
| **Baseline.** Host `node --test` in `apps/chat`: **554 examined / 553 pass / 0 fail / 1 skipped** (per the AS-120 plan §0 on `d2d6608`; no test file has changed on master since). | Implementer re-measures on his branch base before touching anything (§5). |

---

## §1. Decision

### N1 — canonicalise the root once per poll, inside `makeLanesOps`

`makeLanesOps` gains one injected effect, `realpath = defaultRealpath`, where

```js
function defaultRealpath(p) { return realpathSync.native(p); }
```

and `evaluate()` computes `const root = canonRoot()` **once per call**, before the `git worktree list` call, with:

```js
function canonRoot() {
  try { return realpath(repoRoot); }
  catch (err) {
    warnOnce(`realpath:${err.code}`, `WARN cannot realpath ${repoRoot} (${err.message}); lanes use the path as given`);
    return repoRoot;
  }
}
```

(`warnOnce` semantics as the deploy ops' own — one line per distinct reason, reset when it succeeds. A local two-line equivalent inside `makeLanesOps` is fine; do not reach for the deploy closure's.) Every `relPathOf(repoRoot, …)` in `evaluate()` becomes `relPathOf(root, …)`. The git `cwd` arguments stay `repoRoot` — git resolves either. Per-poll, not per-construction: one `lstat` chain every 15 s is nothing, and a root that is re-linked mid-run does not strand the view.

**Why not realpath each row too.** Git already emits canonical paths; realpathing rows adds a syscall per worktree and fails on prunable rows (the path is gone) — which would turn a `prunable` fact into an exception path. Root only.

**Why not shortcut `row.main` to `'.'`.** It would hide the misconfiguration N1 describes instead of fixing it, and it would be a second mechanism for the same answer. One mechanism.

### N2 — outside-repo rows carry a stable, non-leaking disambiguator

`relPathOf` for an absolute path outside the root returns

```
<outside repo>/<basename>#<first 8 hex of sha256(path-with-trailing-slashes-stripped)>
```

e.g. `<outside repo>/scratch#3f9a1c07`. The root-only case (`/`) stays bare `OUTSIDE_REPO` (no basename, and only one such path exists). Properties, each one a criterion below: distinct for distinct absolute paths; identical across polls (a hash, not an ordinal — an ordinal would shift when a sibling is removed and re-key AS-100/AS-103's liveness join); reveals no directory component (8 hex characters of a digest of the board's own machine path, read by a local browser — not the path, and T4's "never carry the host path" rule stays satisfied word for word); still starts with `<`, so it still cannot collide with a real relative path. The suffix is applied **always** for outside rows, not only on collision — a key that depends on which siblings exist is non-local and untestable in isolation.

`README.md`'s sentence on the marker gets the new shape. `public/lanes.js` is untouched (it renders `relPath` as opaque text; ugly-but-honest for a diagnostic row nobody should have in production).

### §1.4 Deliberately out of scope
- Realpathing `env.ADVANCE_REPO_ROOT` at config time for the *deploy* ops or the tick child's cwd — different consumer, not observed broken, and the lanes fix is self-contained.
- Changing `lane.key` for **joined** lanes (short id) or the `LANE_WORKTREE_KEYS` whitelist — no new field; the disambiguator rides inside `relPath`.
- AS-103's key shape. If AS-103 lands first and picks a different join key, this plan's key is still the fallback for unjoined rows; nothing to route.
- Windows paths, `\\` separators, case-insensitive filesystems — not this watcher's platform.

---

## §2. Tests — exact titles

### Edited: `apps/chat/test/lanes.test.js`
- **`lanes-relpath-outside-repo`** (existing, `:85`): the five `want` strings change to the `#<8hex>` shape. Rewrite the assertions as shape checks plus one pinned digest: `got` matches `/^<outside repo>\/[^/#]+#[0-9a-f]{8}$/` for the four basename cases, bare `OUTSIDE_REPO` for `/`; and one **literal** pin, `relPathOf('/Users/x/repo', '/tmp/throwaway-wt') === '<outside repo>/throwaway-wt#' + sha256('/tmp/throwaway-wt').slice(0,8)` computed in the test with `node:crypto` — so the digest input (trailing slash stripped, no root mixed in) is pinned, not just the length. Keep the five-case cardinality assert and the `/Users/` leak asserts.
- **T3 `lanes-relpath-outside-distinct-basenames`** (new): `relPathOf('/repo', '/tmp/a/scratch') !== relPathOf('/repo', '/tmp/b/scratch')`; both start with `<outside repo>/scratch#`; neither contains `tmp`, `/a`, or `/b` as a path component (assert `!got.includes('/tmp')` and `got.split('#')[0] === '<outside repo>/scratch'`).
- **T4 `lanes-relpath-outside-suffix-stable`** (new): two calls with the same input return the same string; `/tmp/x/` and `/tmp/x` return the same string (trailing slash stripped **before** hashing); the suffix is exactly 8 lowercase hex.
- **T5 `lanes-compose-outside-lanes-distinct-keys`** (new, compose level): snapshot with main plus two unjoined rows whose relPaths are `<outside repo>/scratch#aaaaaaaa` and `<outside repo>/scratch#bbbbbbbb` → `out.count === 2`, `new Set(out.lanes.map(l => l.key)).size === 2`. (This is the N2 observation restated as the composer's contract: cardinality of keys equals cardinality of lanes.)

### Edited: `apps/chat/test/watcher-lanes.test.js`
- `harness()` accepts an optional `realpath` and passes it to `makeLanesOps`; when omitted it injects `(p) => p` so every existing test keeps its `/repo` fiction. Nothing else in the existing tests changes (the happy path already asserts `main.relPath === '.'`).
- **T1 `watcher-lanes-symlinked-root`** (new): `harness({ repoRoot: '/link/repo', realpath: (p) => (p === '/link/repo' ? '/real/repo' : p) })`, fake git's porcelain emitting `/real/repo` (main) and `/real/repo/.worktrees/AS-99`. Assert two rows, `['.', '.worktrees/AS-99']`, no `<outside repo>` anywhere in the payload, no `/real/` anywhere in the payload, and the `realpath` stub was called with `'/link/repo'` exactly once per `evaluate()` (call twice, expect 2 — pins per-poll, not per-construction).
- **T2 `watcher-lanes-realpath-fallback`** (new): `realpath` throws `Object.assign(new Error('ENOENT'), { code: 'ENOENT' })`. Assert the snapshot is still written with `error: null` and rows computed against the root as given (`'.'`, `.worktrees/AS-99`), and exactly one log line matching `/^WARN cannot realpath \/repo/` across two `evaluate()` calls (warn-once).
- **T6 `watcher-lanes-realpath-default-wiring`** (new, real filesystem, no `realpath` injected): `real = realpathSync(mkdtempSync(join(tmpdir(), 'as108-')))`; `link = join(real, 'link')`; `symlinkSync(real, link)`; harness with `repoRoot: link`, fake git emitting `real` and `${real}/.worktrees/AS-1`. Assert `['.', '.worktrees/AS-1']`. `rmSync(real, { recursive: true })` in `finally`. This is the only test that proves the **default** `realpath` is wired — T1 alone proves the injection point exists, which is not the same thing (M5 below is why).

Count: **6 new tests** (T1–T6), one existing test rewritten.

---

## §3. Acceptance criteria (M4: each names its falsifier — an observed red, never an argument)

Every mutant is applied in a **scratch copy** or under `trap`-restore, with the mutation asserted at the intended site (`grep -n` the exact line, in the named function), then `git -C $W diff --exit-code` after restore. Record the exact red set; wider or narrower is a finding.

1. **AC-1 (N1 fixed).** With a symlinked root the main checkout is `'.'` and a linked worktree is repo-relative. Falsifier **M1**: in `evaluate()` replace `const root = canonRoot()` with `const root = repoRoot` (anchor: the line immediately before the `git(['worktree', 'list', …` call). Expected red: **T1, T6** only.
2. **AC-2 (per poll, not per construction).** Falsifier **M2**: hoist `canonRoot()` to the `makeLanesOps` body (computed once at construction). Expected red: **T1** only (the call-count pin).
3. **AC-3 (fallback is the path as given, warn once).** Falsifier **M3a**: `catch` returns `''` instead of `repoRoot` → red **T2** (rows become `<outside repo>/…`). **M3b**: drop the warn-once memo so the WARN logs every call → red **T2** only.
4. **AC-4 (default wiring reaches the real filesystem).** Falsifier **M5**: change the default parameter to `realpath = (p) => p`. Expected red: **T6 only; T1 and T2 stay green** — this asymmetry is the point.
5. **AC-5 (N2 fixed: distinct absolute paths → distinct relPaths).** Falsifier **M6**: in `relPathOf`, drop the `#${digest}` suffix. Expected red: **T3, T4, `lanes-relpath-outside-repo`**. **T5 stays green** (the composer is not what changed) — say so.
6. **AC-6 (stable and normalised).** Falsifier **M7**: hash `p` instead of the trailing-slash-stripped path. Expected red: **T4** (the `/tmp/x/` vs `/tmp/x` case) and the literal pin in `lanes-relpath-outside-repo`. **M8**: `Math.random()` in the suffix → red **T4** and the literal pin.
7. **AC-7 (no host path leaks; marker still uncollidable).** Falsifier **M9**: in `relPathOf` return `` `${OUTSIDE_REPO}/${p}` `` (the full path). Expected red: `lanes-relpath-outside-repo` (the `/Users/` leak assert) and **T3** (`/tmp` leak). **T1 stays green** — its rows are inside the root and never take the outside branch; record that. Unchanged from AS-99: `'<'` is still the first character — asserted by the regex in the rewritten test.
8. **AC-8 (composer contract).** Falsifier **M10**: in `lib/lanes.js:199` change the key fallback to `view.relPath?.split('#')[0]`. Expected red: **T5** only.
9. **AC-9 (nothing else moved).** Host suite on the branch: **560 examined / 559 pass / 0 fail / 1 skipped** against a base of 554 (§5); `--build` compose receipt shows the `Built` line and the same +6 over its own base. Any other delta is a finding.
10. **AC-10 (record).** `README.md`'s marker sentence carries the new shape; the `relPathOf` doc comment says why the suffix exists (N2) and why it is a hash (stability across polls for the liveness join).

Cardinality of the mutant battery: **10 mutants** (M1, M2, M3a, M3b, M5, M6, M7, M8, M9, M10 — there is no M4; keep the labels as written so the review can join on them). Report the battery as `<n> applied / <n> red as predicted / <n> deviations`.

---

## §4. Key files
- `apps/chat/watch/advance-watcher.mjs` — `relPathOf` (`:1922`), `makeLanesOps` (`:1977`, new `realpath` param, `canonRoot`), `node:fs` import.
- `apps/chat/lib/lanes.js` — **no change expected**; touched only if T5 finds otherwise (it should not).
- `apps/chat/test/lanes.test.js`, `apps/chat/test/watcher-lanes.test.js` — §2.
- `apps/chat/README.md` — the marker sentence.

## §5. Recipe (implementer)
1. Baseline on the branch base before any edit: `node --test` in `$W/apps/chat`; expect 554/553/0/1 (or state the measured base if AS-120/AS-106 merged first — each adds its own tests: +1 and +17 respectively; predict **+6** over whatever the base is).
2. Code, then tests, commit early (`AS-108: …`, identity `developer-marcus`), progress note in the scratchpad.
3. Mutant battery per §3, logs in the scratchpad; every survivor is re-read at the diff of the mutated file before it is reported (the AS-95 lesson).
4. Compose: `docker compose run --build --rm test` from `$W/apps/chat` via absolute docker (`/usr/local/bin/docker`), `-p asc-impl-as108`, torn down after (AS-106's `bin/compose-run.mjs` if it has merged by then; otherwise the manual receipt with the `Built` line).
5. Move nothing in Lattice; comment on AS-108 with findings first (M5), then the criteria sweep as a floor check.

## §6. Review notes (Ruben)
Probe past the list (M6): a root that is a symlink **to a symlink**; a root given with a trailing slash *and* through a symlink; a worktree whose canonical path is inside the root but whose *registered* path (as git prints it) is not — does git ever print non-canonical? (Verify against `git worktree list --porcelain` on the real repo with a linked worktree added via a symlinked path; that answer belongs in the review comment either way.) Do not read the implementer's scratchpad before forming your own battery.

## §7. Not in scope
Everything in §1.4; AS-103's key shape; the deploy ops' `repoRoot`; any change to `public/lanes.js` rendering; rewriting the AS-99 tests beyond the one `want`-shape change named in §2.
