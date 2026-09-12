# AS-34: chat /api/file: re-check dot-segment rule after realpath — non-dot symlink can launder a dot directory

Planned 2026-09-02 by agent:cto-owen (tech lead for this planning stage). Implementer: agent:developer-lena.
This task has **no description**; its record is three comments on the task. This §1 carries the context a description normally would — the next reader has nothing else.

## §1 Scope and context

### 1.1 The bug (what a description would have said)

`readRepoMarkdown` (`apps/chat/server.js:56`) gates `GET /api/file`, the in-app
repo-markdown viewer added in AS-26. Its checks run in order: (1) syntax on the
request string, (2) **segment rules on the request string** — no `.`/`..`/empty
segments, no dot-leading segment except a first segment exactly `.lattice`,
(3) `realpathSync` containment — the resolved target must sit under the
resolved root, (4) regular file, (5) 512 KB cap. The hole: check 2 tests the
*requested spelling* only, and check 3 tests only the *prefix* of the resolved
path. A non-dot-named symlink inside the repo pointing at a dot directory
therefore launders it: `latticelink -> .lattice` serves
`latticelink/plans/p.md` with 200 (qa-priya's reproduction, demonstrated on a
scratch root during the AS-26 cycle-2 review). Containment is unaffected —
nothing outside the mounted root is reachable — so this is a scope question
*inside* the repo, not an escape.

**The boundary in one sentence:** `/api/file` is the only endpoint through
which the chat server — a network-reachable container that bind-mounts the
entire repository read-only (`../..:/repo:ro`, AS-26) — reads repo files for
clients, so this gate alone decides what a chat client can read out of the
checkout.

**Provenance and priority:** found by qa-priya in the AS-26 cycle-2 review,
recorded non-blocking and deliberately deferred (task comment 1, the
specification for this fix). No live exploit: the checkout contains zero
symlinks (re-verified 2026-09-02: `find` over the working tree excluding
`.git`/`.worktrees` finds 0; `git ls-files -s` shows no mode-120000 objects;
no `node_modules` exists), and planting one requires repo write access, which
already exceeds what laundering would grant. Raised to high by board directive
(DM msg 394): all chat issues ship, security hardening leads the cluster
(order 1/6) — it is small, it is security debt on a boundary AS-26
deliberately widened, and "dot directories are unreachable" is load-bearing
operator prose.

**Current truth status of that prose:** `apps/chat/README.md` (§"Repo file
links", lines ~126–130) is **not false today** — the AS-26 close-out added an
honest caveat documenting this exact hole ("it is a check on the *requested*
string, so a non-dot-named symlink ... would launder it ... do not add one
into a dot directory"). The `compose.yaml` mount comment, however, says
`.git/.claude/.worktrees` are "categorically unreachable" — an overclaim
today (extensionally true only because no symlinks exist), which this fix
makes exactly true without editing that file. After the fix the README caveat
is stale in the opposite direction (documents a closed hole) and must be
replaced by the stronger claim (§9.1).

**What an operator is entitled to conclude after the fix:** a request serves
iff its literal path, appended below the resolved repo root, is a regular
`.md` file ≤ 512 KB whose spelling passes the string gate. No alias can widen
that set: dot directories other than a literal first-segment `.lattice` are
categorically unreachable, symlinks or not.

### 1.2 In scope

1. The one-line re-check in `readRepoMarkdown` (§3) plus its docblock update.
2. Test extension of the existing AS-26 gate battery in
   `apps/chat/test/api.test.js` (§5): laundering probe, two policy probes, one
   positive control.
3. `apps/chat/README.md` prose correction (§9.1) — app documentation, editable
   by the implementer.

### 1.3 Not in scope

- `apps/chat/compose.yaml` and `test/deploy-shape.test.js` — untouched; the
  fix makes the compose comment true as written (§8 Q2).
- The client-side tokenizer (`public/msg-refs.js`, `public/app.js`): they
  *consume* `/api/file`; their path rules are a UX mirror, not a boundary. A
  laundering path typed into chat would render a link whose viewer now 404s —
  correct behavior, no client change.
- macOS case-insensitivity behavior (unchanged by design, §3.6), the `me`
  gate (none by design, AS-26), TOCTOU between realpath and read
  (pre-existing; mitigated by the `:ro` mount in the supported deployment).

## §2 Declared file-level scope (AS-60 trial lane B — lift verbatim)

```json
{
  "task": "AS-34",
  "branch": "feat/AS-34-symlink-dot-check",
  "allowed_path_prefixes": ["apps/chat/"],
  "expected_files": [
    "apps/chat/server.js",
    "apps/chat/test/api.test.js",
    "apps/chat/README.md"
  ]
}
```

The implementation lane writes **only** the three files above. No writes under
`apps/invoicing/` (lane A, AS-41), `tools/` (AS-60's own prefix),
`docs/`, top-level `*.md`, or `.lattice/` (board plane; during the trial all
board writes are serialized through the orchestrator). File-disjoint from lane
A and from AS-60 by construction.

## §3 Design

### 3.1 The check, exactly

Insert one check — **3b** — in `readRepoMarkdown`, immediately after the
containment check and before the regular-file check (between current lines 79
and 80 of `apps/chat/server.js`):

```js
if (real !== join(rootReal, path)) throw fail();
```

- **String tested:** `real`, the `realpathSync`-resolved absolute path of the
  requested file, byte-compared against `join(rootReal, path)` — the resolved
  root joined with the already-vetted request string. Same byte-identical
  `not_found` as checks 1–4: a laundering probe stays indistinguishable from a
  nonexistent file.
- **What it enforces:** resolution below the root is the *identity*. Since
  check 2 already proved the request string's segments clean, resolved
  segments = request segments, so the dot rule now holds for the file's real
  location, not just its requested spelling. Equality implies the containment
  prefix, but containment stays (§8 Q1) — established, independently
  motivated, cheap.

### 3.2 Symlink policy (decided): refuse symlinks below the root entirely

A symlink to a **non**-dot location is *not* followed either. Follow-and-recheck
(the minimal shape in the finding) was considered and rejected on three grounds:

1. **It fails the finding's own reproduction.** A naive resolved-path
   dot-recheck inherits the first-segment-`.lattice` exemption:
   `latticelink -> .lattice` resolves to `.lattice/plans/p.md`, whose first
   resolved segment is exempt — it would still serve 200. Closing that
   requires exemption-vs-alias special-casing that every future reader must
   re-derive. The equality rule serves `.lattice` content only under its real
   name — uniform, no per-target reasoning.
2. **Nothing legitimate breaks.** Symlink census (2026-09-02): zero in the
   working tree, zero tracked in git (mode 120000), no `node_modules`, and
   nothing in `apps/` documents or relies on symlink traversal. The endpoint's
   purpose is serving git-tracked markdown at canonical paths.
3. **What it removes:** the entire "what can an alias reach" question class.
   The boundary statement becomes quantifier-free (§1.1 last paragraph).

Cost, accepted and documented: a future legitimate in-repo symlink would 404
until policy is revisited; the README wording (§9.1) names the rule so that
failure is diagnosable in seconds.

### 3.3 Above the root: no false rejections, by construction

Both comparands share the `rootReal` prefix verbatim, so the rule quantifies
only over the below-root suffix. A dotted or symlinked *parent* of the repo
(repo under a hidden directory; root reached through a symlink) is
canonicalized into `rootReal` on both sides before comparison and cannot
reject. Standing empirical proof in the suite itself: the test scratch root
lives under macOS `/var -> /private/var`, and the happy paths pass — a
whole-path rule would false-fail every one of them.

### 3.4 "Segment" on the resolved path

Moot under the equality formulation — no split is performed. Equivalently: the
enforced property is that the `sep`-split segments of
`real.slice(rootReal.length + 1)` are exactly the request's `/`-split
segments; equality states that in one comparison and is strictly stronger than
re-running the dot rule over them.

### 3.5 Check order is otherwise unchanged

String checks 1–2 still run first, before any filesystem access; 3b runs after
resolution because that is the earliest the resolved truth exists. The
existing string-level dot check stays as the cheap pre-filter (finding's fix
shape): most hostile probes still die without touching the FS.

### 3.6 The macOS case-insensitivity note re-verified under the reorder

Priya's AS-26 note: `readme.md` serves on a case-insensitive dev filesystem;
not a hole because the dot and `.md` checks run on the request string before
FS access, so case can never widen the *class* of reachable paths; vanishes on
the Linux deploy target. **This reasoning survives this change, verified two
ways:** (a) the fix adds a check and reorders nothing — checks 1–2 are
untouched and still precede FS access, and 3b only ever narrows; (b) probed
empirically on this machine (2026-09-02): Node's JS `realpathSync` preserves
the input spelling of non-symlink components (on-disk `Foo.md`, request
`foo.md` → resolved `.../foo.md`), so the equality holds for wrong-case
requests on macOS exactly as today — no behavior change in either direction,
on either platform. Do not switch to `realpathSync.native` in this task; it
may case-correct and would entangle the policy change with a platform quirk.

### 3.7 No helper extraction

`readRepoMarkdown` is the logic's only home and `server.js` its only caller
(`deploy-shape.test.js`'s `realpathSync` use pins the compose mount, unrelated;
`public/*` are HTTP clients). A helper with one caller is speculative
generality — the fix stays inline.

## §4 Key files

- `apps/chat/server.js` — docblock (lines 45–55) gains check 3b in its
  enumeration; `readRepoMarkdown` (56–84) gains the one line between
  containment (79) and isFile (80).
- `apps/chat/test/api.test.js` — AS-26 gate test (767–831): scaffold gains 4
  artifacts (`latticelink`, `docs/ok.md`, `docslink`, `alias.md`); probes
  array grows 16 → 19 entries; happy paths gain the `docs/ok.md` positive
  control (3 → 4). No existing literal changes.
- `apps/chat/README.md` — lines ~126–130: caveat sentence replaced by §9.1
  wording (implementer-editable app doc).
- Read-only context, must not change: `apps/chat/compose.yaml`,
  `apps/chat/test/deploy-shape.test.js`, `apps/chat/public/msg-refs.js`.

## §5 Acceptance criteria

Test scaffold facts (all pre-existing house pattern, unchanged in kind): the
scratch root is `mkdtempSync(join(tmpdir(), 'chat-file-root-'))` + a fixture
copy — never the real repo — torn down by `t.after(rmSync(..., {recursive,
force}))`; the server boots against it via `bootServer(t, root)` with a temp
DB on an ephemeral port. New symlinks are created with absolute in-scratch
targets before boot.

1. **Laundering probe (the reproduction):** with `latticelink -> .lattice`
   planted in the scratch root, `GET /api/file?path=latticelink/plans/task_TEST.md`
   returns 404 with the byte-identical `{"error":"No such file."}` body. This
   exact request serves 200 with `plan body\n` on master today — this is the
   test that fails without the fix.
2. **Policy probes:** `docslink/ok.md` (dir symlink `docslink -> docs`, a
   non-dot, servable target) and `alias.md` (file symlink to the servable
   `README.md`) both 404 byte-identically — pinning refuse-symlinks in both
   directory and file position.
3. **Positive control:** `docs/ok.md` requested directly returns 200 — proving
   the §5.2 404s are the symlink's fault alone, not the target's.
4. **No regression, no widening:** every pre-existing happy path still 200s
   and every pre-existing probe still 404s byte-identically — including with
   the scratch root behind a symlinked parent (`/var -> /private/var` on
   macOS), proving no above-root false rejection (§3.3).
5. **Falsification executed:** recipe §6.R1 (revert the fix → suite red at the
   laundering probe; restore → green) and §6.R2 (wrong-policy mutant → red)
   run by the implementer, outcomes recorded in a lattice comment with the
   cardinality line (probes 16 → 19, happy paths 3 → 4).
6. **Docs:** `server.js` docblock enumerates 3b in position; README caveat
   replaced per §9.1.
7. **Scope clean:** `node --test` green in `apps/chat/` on the branch, and
   `git diff master...feat/AS-34-symlink-dot-check --name-only` is a subset of
   the three §2 files (this doubles as the trial's disjointness evidence).

## §6 Falsification recipes (house style)

Both recipes mutate `apps/chat/server.js` in the task worktree as a transient
uncommitted edit; git is the backup and the restore is trapped. No build step
exists (`node --test` runs the source directly), so the stale-mutant-image
hazard is vacuous here — stated, not skipped. Run from the worktree root
`/Users/forrest/Code/american-software-company/.worktrees/AS-34`.

**R1 — revert the fix (proves the new test is non-vacuous):**

```sh
set -e; trap 'git checkout -- apps/chat/server.js' EXIT
# mutation: delete the equality line
perl -0pi -e 's/^\s*if \(real !== join\(rootReal, path\)\) throw fail\(\);\n//m' apps/chat/server.js
# assert the mutation applied (an unapplied mutation looks like a passing checker):
test "$(grep -c 'real !== join' apps/chat/server.js)" = 0
git diff --stat -- apps/chat/server.js   # must show exactly 1 deletion
(cd apps/chat && node --test test/api.test.js) && echo 'UNEXPECTED GREEN — fix not load-bearing' || echo 'red as predicted'
```

Predicted failing set: exactly one test — `api: AS-26 — GET /api/file …` —
failing inside the probe battery at `latticelink/plans/task_TEST.md` with
`200 !== 404`. The battery is fail-fast within its loop, so this probe (first
of the three new entries in array order) names the failure; `docslink/ok.md`
and `alias.md` would also flip but are not reached. A wider set (any
pre-existing probe flipping) or a green run is itself a finding. Then let the
trap restore, prove the tree with
`git diff --exit-code -- apps/chat/server.js`, and re-run to green.

**R2 — wrong-policy mutant (proves the test pins the *policy*, not mere
presence of a check):** replace the equality line with the plausible-but-wrong
naive resolved-dot recheck, which inherits the `.lattice` exemption:

```js
// AS34_MUTANT
const relSegs = real.slice(rootReal.length + 1).split(sep);
for (let i = 0; i < relSegs.length; i++) {
  if (relSegs[i].startsWith('.') && !(i === 0 && relSegs[i] === '.lattice')) throw fail();
}
```

Assert applied: `grep -c AS34_MUTANT apps/chat/server.js` → 1. Predicted:
red at the same battery, same probe — `latticelink/plans/task_TEST.md` serves
`200` because its *resolved* first segment `.lattice` is exempt under the
mutant (and `docslink`/`alias.md` would serve too, if reached). Restore via
trap, `git diff --exit-code`, re-run green. This mutant is the implementation
this plan explicitly rejects in §3.2(1); the test suite must be able to tell
them apart.

## §7 Size and complexity

- `server.js`: +1 code line, ~4 docblock lines. `api.test.js`: ~+12 lines.
  `README.md`: ~7 lines replacing 5. Net ≈ 30 lines across 3 files.
- Complexity: **low** (set on the task). One review cycle expected. The weight
  is in §5/§6, not in the diff.

## §8 Open questions, defaults, time-boxes

- **Q1 — drop the containment prefix check as redundant (equality subsumes
  it)?** Default **no**: removing an established security check inside a
  security fix trades one line for review risk; belt-and-suspenders ordering
  means a future edit weakening one check does not silently lose the other.
  Box: this task's implementation; revisit only if QA flags it.
- **Q2 — upgrade the `compose.yaml` comment ("categorically unreachable")?**
  Default **no edit**: the fix makes the sentence true as written;
  `deploy-shape.test.js` pins that file and churn there buys zero behavior.
- **Q3 — is `.lattice`-as-a-symlink supported?** Default **no — real
  directory is a standing invariant** (it is one in every checkout and in the
  container mount). If a future deployment symlinks it, plan reads 404 loudly
  and §9.1's README sentence names the rule that did it.

## §9 Proposed wording for docs (and the metawork boundary)

**9.1 `apps/chat/README.md`** — this is *app* documentation, not a protected
top-level file (`CLAUDE.md`, root `README.md`, `PHILOSOPHY.md`, `agents.md`),
so **the implementer edits it directly in this task.** Replace the caveat
sentence block ("One caveat on that dot rule: … cannot write the repo
regardless.", lines ~126–131) with:

> Since AS-34 the gate also refuses aliasing outright: after realpath
> resolution, the resolved path below the (resolved) repo root must equal the
> requested path byte-for-byte, so a symlink anywhere inside the tree 404s —
> `link/x.md` where `link -> .git`, and equally a symlink to a servable
> location. The dot rule therefore holds for real locations, not just
> requested spellings: `.git/`, `.claude/` and `.worktrees/` are categorically
> unreachable regardless of how the tree is aliased. Symlinks *above* the repo
> root (a symlinked parent directory) stay irrelevant — both sides of the
> comparison sit below the resolved root. The mount is read-only at the
> kernel, so the container cannot write the repo regardless.

**9.2 Protected top-level files:** no changes needed or proposed. Nothing in
this task touches the metawork layer.

## §10 Stale items found while planning (FYI; no action in this task)

- Priya's finding comment records "no symlinks at all (verified by find)" as
  of 2026-08-31; re-verified 2026-09-02 — still zero, no drift.
- `compose.yaml`'s "categorically unreachable" overclaim (§1.1) self-heals
  when this task merges; recorded here so nobody files it separately.
- The AS-60 plan §4.2 reassignment (Marcus → Lena at this planning tick) is
  already reflected on the board; nothing dangling.
