# AS-53: invoicing: dependency-policy scan has a manifest-shaped blind spot — close it before AS-38 relies on the chokepoint guard

**Planner:** Owen Kessler, CTO (`agent:cto-owen`), 2026-09-01. **Implementer:** Marcus Webb
(`agent:developer-marcus`). **Reviewer:** Priya Raman (`agent:qa-priya`) — she filed the
finding; her acceptance criteria are the ones that matter, and she is not the implementer.

**Branch:** `feat/AS-53-dependency-scan-manifests`, worktree `.worktrees/AS-53`. Code and
docs changes go on the branch; the one board-state edit (§7.4) goes on master.

Everything binding is in this file. Where the plan quotes current text it was read from
master at commit `45abd0f`; where it gives a number, the planner measured it (§9.1).

---

## 1. Scope

### 1.1 What this task does

1. **Closes the guard-coverage gap.** `apps/invoicing/test/dependency-policy.test.js`
   scans app source for outbound-HTTP-client constructs — the standing enforcement for
   "never in the flow of funds" that AS-38's custody chokepoint will lean on. Today the
   walker admits only `.js/.ejs/.css`, so `compose.yaml`, `Dockerfile` and `package.json`
   are outside it, and `compose.yaml` legitimately contains `fetch(` (its healthcheck).
   After this task the scan walks manifests too, the healthcheck's `fetch(` is
   **sanctioned by a declared, keyed, counted allowlist entry** rather than silently
   unseen, and the walker is **closed-world over `apps/invoicing/`**: every file is app
   source, a manifest, or explicitly listed as unscanned with a reason — an unclassified
   file fails the suite.
2. **Folds in three smaller items from the AS-37 review** (all three re-measured by the
   planner, §9.1): (a) the AS-37 plan §1.2 size estimate, off by ~3.7×; (b) the
   `DOCKER_BUILDKIT=1` prose overstatement in `compose.yaml`'s header and
   `apps/invoicing/README.md`; (c) the §14 write-back owed to
   `docs/engineering/01-stack-decision.md` §13 (pins, adopted footprint, T4 upgrade
   clause, npm caret trap).
3. **Records the house mutation technique** where a future implementer will look for it
   (`apps/invoicing/README.md`), and uses it for every falsification run in §4.

### 1.2 Not in scope

- **AS-38 is not touched.** No Stripe client, no chokepoint module, no `STRIPE_*`
  anything. The scan stays "held open" for AS-38 exactly as the AS-37 plan §11 left it;
  AS-38 inherits the `SANCTIONED` mechanism for its own legitimate additions.
- **No new product code.** Nothing under `app.js`, `server.js`, `lib/`, `routes/`,
  `views/`, `public/` changes. The 11-file source list stays 11.
- No change to `deploy-shape.test.js`'s parser, no shared-helper refactor between test
  files, no new test files (harness.test.js pins the test-file list at 6 — keep it 6).
- No change to the README's two documented commands themselves (§7.2 changes the prose
  around them, not the commands).
- No edits to `CLAUDE.md`, `README.md` (repo root), `PHILOSOPHY.md`, `agents.md`. One
  proposed metawork paragraph is offered in §10 for the metawork layer to apply or not.

---

## 2. Approach — the fix shape, and why

**Chosen: extend the scan to manifests with a declared allowlist** (Priya's preference),
plus one thing she did not ask for and I judge necessary: the walker becomes
**closed-world over the directory** rather than closed-world over a chosen extension
list. Reason: the finding is "a blind spot in WHICH files the scan walks." Enumerating
more extensions moves the blind spot; it does not remove it — a `.sh`, `.html`, `.py` or
`.env` appearing tomorrow would sit outside the scan exactly as `compose.yaml` does
today. Making every file either classified or explicitly-unscanned-with-a-reason means
the next new file type is a **decision** someone has to write down, not an omission.
Cost: about ten lines. That is the trade this company's dependency policy asks for —
evaluate by what it removes — and it removes the whole class.

The documented-carve-out fallback was rejected because the AS-37 review proved the
relevant point: the three construct assertions pass GREEN on whatever they do not see. A
comment saying "we do not look at compose.yaml" is still a scan that does not look at
compose.yaml.

### 2.1 The file set the scan walks after the change

Walk `apps/invoicing/` recursively (on the host) — which is `/app` inside the image —
skipping the directories `node_modules/`, `test/`, `vendor/` exactly as today. Every
remaining **file** is placed in exactly one bucket by its basename:

| Bucket | Rule (basename) | Today's members | Comment stripper |
|---|---|---|---|
| **SOURCE** | `SOURCE_EXT = /\.(js|mjs|cjs|ejs|css)$/` | 11 files (the current list, unchanged) | existing `stripComments` (`//`, `/* */`, strings; `<%# %>` for `.ejs`) |
| **MANIFEST** | `MANIFEST_NAME = /^(Dockerfile(\..+)?|.+\.ya?ml|.+\.json)$/` **minus** `UNSCANNED` | `Dockerfile`, `compose.yaml`, `package.json` (3) | new `stripHashComments` — see §2.3 |
| **UNSCANNED** | explicit `Set` of basenames, each with a reason in the code comment | `package-lock.json`, `README.md`, `.dockerignore` | none — never read |
| **unknown** | anything else | must be **empty** | — |

**Classification order is binding:** `UNSCANNED` first, then `SOURCE_EXT`, then
`MANIFEST_NAME`, else `unknown` — `package-lock.json` matches `MANIFEST_NAME` by extension
and must be caught by the explicit set before the regex sees it. Note also that
`Dockerfile(\..+)?` deliberately matches a stray `Dockerfile.bak`: a manifest-shaped file
gets scanned by default, which is the right default.

In and out, with reasons (these reasons go in the code comment too, so the file explains
itself):

- **`compose.yaml`, `Dockerfile` — IN.** They are the two places a manifest can invoke an
  HTTP client (`HEALTHCHECK`/`healthcheck`, `RUN`, `CMD`, `command:`). Both exist on the
  host and are COPY'd to `/app` (Dockerfile line 50), so the scanned set is identical
  host-side and in-container — the parity property the existing `vendor/` comment
  protects.
- **`package.json` — IN.** Its `scripts` are executable (`node -e "fetch(...)"` fits in a
  one-line script). Present in both places.
- **`.mjs`, `.cjs` — IN (SOURCE).** They are JavaScript by definition; zero files today,
  so zero cost, and classifying them is not speculative.
- **`.yaml`/`.yml` beyond `compose.yaml`, `Dockerfile.*` — IN (MANIFEST) by rule**, so a
  future `compose.override.yaml` or `Dockerfile.dev` is scanned the moment it appears
  (and the exact-list assertion in §2.4 makes its appearance a visible event).
- **`package-lock.json` — UNSCANNED.** Generated (898 lines), carries no executable
  content, and is already guarded by the *right* tool for its shape: the `LOCK_ENTRIES`
  cardinality literal (70) plus exact-name matching against `FORBIDDEN_PACKAGES`. A regex
  over it adds noise and no coverage. Any new package changes `LOCK_ENTRIES` and fails
  the suite regardless.
- **`README.md` (and `*.md` generally) — UNSCANNED.** Prose cannot execute. Also it is
  **not** COPY'd into the image, so scanning it would break host/container parity of the
  scanned set. Listed by name so the walker still *accounts* for it.
- **`.dockerignore` — UNSCANNED.** A pattern list; cannot execute; parsed as data by
  `deploy-shape.test.js` already. Present only at `/app` in the image (COPY'd from the
  repo root) and absent from `apps/invoicing/` on the host — parity again. `UNSCANNED` is
  an *allowed-if-present* set, not an expected list, precisely so both environments pass.
- **`test/`, `vendor/`, `node_modules/` — skipped**, same reasons as today (the test
  helper fetches its own loopback listener; vendor/ is not ours and exists only in the
  image).
- **`.html`, `.sh`, `.env*`, anything else — deliberately NOT pre-classified.** They fall
  into `unknown` and fail the suite with a message telling the author to classify them.
  (Parked tangent, with its default answer, in §11.)

### 2.2 The allowlist — `SANCTIONED`

Lives in `dependency-policy.test.js`, next to the forbidden-pattern tables, as a single
`const SANCTIONED = [...]`. **It keys on file + construct + line shape + count — never a
bare file exclusion.** Each entry:

```js
{
  file: 'compose.yaml',            // relative to APP_DIR; must match a MANIFEST or SOURCE member
  construct: 'fetch(',             // the `name` of the forbidden pattern being sanctioned
  count: 1,                        // exactly how many hits this entry may absorb
  line: /^\s+test: \["CMD", "node", "-e", "fetch\('http:\/\/127\.0\.0\.1:8348\/healthz'\)/,
                                   // the WHOLE line a sanctioned hit must sit on
  reason: "the web service's compose healthcheck probes ITS OWN /healthz over loopback so " +
          "compose can learn the container is alive. It is a self-probe, not an outbound " +
          "client: the target is pinned to 127.0.0.1:8348 by the line shape, so pointing it " +
          "anywhere else, or moving the fetch( to another key, un-sanctions it.",
}
```

Today the array has exactly this one entry. Semantics the implementation must have:

1. **Detection is whole-text, as today.** Each forbidden pattern is tested against the
   *stripped* file text (so `fetch\n(` still cannot hide from a line-oriented scan).
2. **Localisation is per match.** Every match is mapped to the 1-based line it starts on;
   that line's text is what a `SANCTIONED.line` regex is tested against.
3. A hit is sanctioned only if an entry matches on **all three** of `file`, `construct`,
   and `line`. A sanctioned hit increments that entry's `seen` counter. Every other hit
   is a finding.
4. **Every entry must be used exactly `count` times.** An entry that matched nothing (or
   too much) is itself a failure — V2 applied to the allowlist: a sanction that sanctions
   nothing is a hole waiting for a tenant, and this is what keeps the allowlist in sync
   with the manifests without review discipline.
5. **Every entry must carry a non-empty `reason`** (asserted). "Documented" is enforced,
   not hoped for.

**What a reader sees when it fires** — the two failure messages, both must contain
exactly these facts:

- Unsanctioned hit (in test #5 below):
  `outbound HTTP client in app source or manifest: Dockerfile:55: fetch( — not sanctioned — ENV ASC_MUTATION="fetch('https://example.invalid/')" — remove it, or if it is genuinely not an outbound client add a SANCTIONED entry with a reason`
  i.e. relative path, line number, construct name, the offending line (trimmed), and the
  remedy.
- Stale or over-used sanction (in test #4 below):
  `SANCTIONED entry compose.yaml / fetch( matched 0 line(s), expected 1 — the entry is stale: remove it, or restore what it sanctioned`
  i.e. file, construct, seen, expected, and the remedy.

### 2.3 The manifest comment stripper

New function `stripHashComments(text, { trailing })`, ~20 lines, tested in both
directions like the existing stripper:

- Full-line comments (`^\s*#`) are always removed.
- Trailing ` # ...` is removed only when `trailing: true`, and never inside `"…"`/`'…'`.
- Per-file: `compose.yaml` and any `.ya?ml` → `{ trailing: true }`; `Dockerfile*` →
  `{ trailing: false }` (Docker does not treat a mid-instruction `#` as a comment, so
  neither may we — `deploy-shape.test.js` makes the same choice in `DOCKERFILE_CODE`);
  `.json` → **identity**, JSON has no comment syntax and a `#` inside a JSON string is
  data.
- The both-directions test must include at minimum: a full-line comment containing
  `fetch(` disappears; a trailing `# fetch(` disappears under `trailing: true` and
  survives under `trailing: false`; `"a # b"` keeps its `#` under both; a `fetch(` before
  a `#` survives; and the stripper applied to the real `compose.yaml` text still contains
  `healthcheck:`.

Why strip at all: same reason the JS stripper exists — the compose header is 25 lines of
prose, and a future sentence mentioning `fetch` must not be a violation, while a real
call site hidden after `#` must not be a hiding place either (the trailing rule).

### 2.4 The cardinality guard after the change

**Exact lists per class, not a minimum count.** The existing assertion (exactly 11 named
source files) stays and gains two siblings, asserted **in this order** so the failure
message names the most informative thing first:

1. `unknown` is **empty** — message lists each unclassified file:
   `X is neither app source, a manifest, nor listed in UNSCANNED — classify it (SOURCE_EXT / MANIFEST_NAME) or list it with a reason`.
2. `manifest` is **exactly** `['Dockerfile', 'compose.yaml', 'package.json']` (length 3
   asserted first, then `deepEqual`).
3. `source` is **exactly** the current 11 (unchanged).
4. Every file in `source ∪ manifest` strips to non-empty text with its class's stripper
   (the existing "stripped to nothing — the stripper is broken" check, now per class).

A minimum-per-class would be weaker than this and buy nothing; the exact list is what
made V2 catch the zero-file case in AS-37 and it is what makes a new `.yaml` file a
visible, deliberate two-line change (the file, and this list). The `unknown`-empty
assertion is the new load-bearing one: it is what turns the extension list from a
blind-spot generator into a closed world.

### 2.5 Forbidden-pattern additions

Add to the outbound-HTTP-client table: `{ name: 'curl', pattern: /\bcurl\b/ }` and
`{ name: 'wget', pattern: /\bwget\b/ }`. Reason: a manifest cannot `import axios`; what a
manifest *can* do is `RUN curl` or `CMD wget`. A manifest scan that only knows Node-shaped
constructs covers the observed case (`node -e "fetch("`) and misses the obvious one.
Measured collision check (planner, 2026-09-01): the only `curl`/`wget` token in the
scanned set is `routes/assets.js:41`, inside a `//` comment, which the JS stripper
removes before matching. The scan must therefore report zero hits for these after the
change — if it reports one, the stripper regressed; do not loosen the pattern.

The AS-38/AS-39 leak test and the 1,200-line test simply iterate `source ∪ manifest`
instead of `APP_SOURCES`. Measured: no manifest contains `amount|currency|money`, so the
raw-text money check stays green. (The 1,200-line test's separate walk of `test/` is
unchanged.)

### 2.6 Test names (binding — the recipes in §4 match on them)

| # | Test name | Status |
|---|---|---|
| 1 | `the comment stripper works, in both directions` | existing, unchanged |
| 2 | `the manifest comment stripper works, in both directions` | **new** |
| 3 | `the scan examines exactly the files it is supposed to — source, manifests, and nothing unclassified` | renamed + extended (§2.4) |
| 4 | `every sanctioned construct is present exactly where it is declared` | **new** (§2.2 items 4–5) |
| 5 | `no app source or manifest outside test/ contains an outbound HTTP client` | renamed + extended (§2.2 items 1–3, §2.5) |
| 6 | `nothing AS-38 or AS-39 owns has leaked into the scaffold` | unchanged name, walks the union |
| 7 | `no file in apps/invoicing exceeds 1,200 lines` | unchanged name, walks the union |

Suite count: **66 → 68.** If the implementer's count differs, the comment must say why.

### 2.7 One identifier is pinned for QA's sake

The manifest predicate MUST be a single-line constant beginning exactly
`const MANIFEST_NAME = ` so that mutation M0 (§4.3) is a one-line `perl` any reviewer can
run cold. Everything else about naming and factoring is the implementer's (a shared
`scanForbidden(patterns)` helper returning `{ findings, seen }` used by tests #4 and #5
is the obvious shape).

---

## 3. Key files

| File | Plane | Change (one line) |
|---|---|---|
| `apps/invoicing/test/dependency-policy.test.js` | branch | Classified closed-world walker (`SOURCE_EXT`, `MANIFEST_NAME`, `UNSCANNED`), `stripHashComments` + its test, `SANCTIONED` + test #4, per-match localisation and sanction lookup in test #5, `curl`/`wget` patterns, union iteration in #6/#7, header comment updated to say the scan covers manifests |
| `apps/invoicing/compose.yaml` | branch | Header lines 17–21 replaced with the corrected BuildKit note (§7.2, verbatim); **no change below the header** — the healthcheck line 43 is untouched (it is what `SANCTIONED` pins) |
| `apps/invoicing/README.md` | branch | Add the "not required for correctness" sentence to the BuildKit paragraph (§7.2); replace the two-line mutation paragraph (lines 70–71) with the house technique (§7.3); add one row to the guards table noting the scan is closed-world over the directory and the allowlist must be exactly used (§7.3) |
| `docs/engineering/01-stack-decision.md` | branch | §9.1 T4 row gains the upgrade clause (original quoted in the log); §13 gains rows 8, 9, 10 (§7.4, verbatim) |
| `.lattice/plans/task_01M1D34MWF287MVX3FC9NTASW7.md` (AS-37 plan) | **master, board state** | Dated correction note appended under §1.2 quoting the original estimate and giving the measured numbers (§7.1, verbatim) — applied by the **orchestrator** from the main checkout at the `in_progress` kickoff, never from the worktree |

Nothing else. In particular `Dockerfile` is not edited (it is only *mutated* during §4 and
always restored), and no file outside these five.

---

## 4. Falsification — required of the implementer, re-run cold by the reviewer

A guard that has never been seen red is decoration. Every new assertion gets a mutation
that turns it red, with the expected failure set stated **exactly** so a wider or
narrower failure is itself a finding. Four mutations, M0–M3. The implementer runs all
four and pastes real output (`MUTANT_EXIT`, `ℹ tests/pass/fail`, and each failing test's
name and message) into the implementation comment. QA re-runs all four cold.

### 4.1 The house technique (binding for every mutation here and hereafter)

**Mutate / assert-applied / observe / restore / REBUILD, as one indivisible step, under a
shell `EXIT` trap; then verify the image, not just the tree.** Learned in AS-37: a stall
left a mutation live in the Dockerfile; a restore without rebuild left a mutant *image*
and produced two phantom failures; a mutation whose edit silently failed to apply would
have been misread as "the guard did not fire". All three are closed by the shape below.

Rules baked into the template:

- Run in a **subshell** with absolute paths. Never `cd` into the worktree in the tool's
  persistent shell — a later `lattice` call would write board state into the worktree's
  `.lattice/` (CLAUDE.md, "Working-directory hazard").
- Use `docker compose -p asc-invoicing-as53 --project-directory "$APP"` for every run.
  `asc-invoicing-web-1` from the main checkout is **up and healthy** on 8348 right now
  (its healthcheck is the very `fetch(` being sanctioned); a distinct project name means
  the worktree's builds never touch its image or container. Images are then named
  `asc-invoicing-as53-test`.
- `--build` on every run, mutant and restored. The restored run **is** the image
  verification: the guard you just watched fire would fire again on a stale mutant image.
- `git -C "$WT" diff --exit-code -- apps/invoicing` after the trap fires proves the tree.

```bash
# --- template: one indivisible mutation run -----------------------------------
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-53
APP=$WT/apps/invoicing
F=$APP/<file under mutation>
(
  cp "$F" "$F.as53bak" && trap 'mv -f "$F.as53bak" "$F"' EXIT
  <MUTATE>                                     # one command, from the recipe below
  <ASSERT-APPLIED> || { echo "MUTATION DID NOT APPLY"; exit 99; }
  docker compose -p asc-invoicing-as53 --project-directory "$APP" run --rm --build test
  echo "MUTANT_EXIT=$?"
)                                              # trap fires here: file restored
git -C "$WT" diff --exit-code -- apps/invoicing && echo TREE_CLEAN
docker compose -p asc-invoicing-as53 --project-directory "$APP" run --rm --build test
echo "RESTORED_EXIT=$?"                        # must be 0 with the full count (68/68)
```

Each run's record: `MUTANT_EXIT`, the `ℹ tests / ℹ pass / ℹ fail` triple, the **names**
of the failing tests (they must be exactly the set listed, no more and no fewer), the
first assertion message of each, `TREE_CLEAN`, and `RESTORED_EXIT=0` with `68/68`.

### 4.2 M1 — an unsanctioned `fetch(` planted in a manifest

- File: `Dockerfile`. Mutate (appends one instruction; the image still builds, the ENV
  has no effect on any test):
  ```bash
  cat >> "$F" <<'EOF'
  ENV ASC_MUTATION="fetch('https://example.invalid/')"
  EOF
  ```
- Assert applied: `grep -q 'example.invalid' "$F"`
- **Expected:** `MUTANT_EXIT=1`; `tests 68, pass 67, fail 1`; the ONE failure is test #5,
  message contains `Dockerfile:55: fetch(` and `not sanctioned`. Test #3 passes (the file
  set did not change — this is what proves the failure is the construct guard and not a
  side effect) and test #4 passes (the compose sanction is still exactly used).

### 4.3 M0 — the manifest class emptied (the AS-37 V2 mutation, re-aimed)

- File: `test/dependency-policy.test.js`. Mutate:
  ```bash
  perl -pi -e 's{^const MANIFEST_NAME = .*$}{const MANIFEST_NAME = /^\\.(nope)\$/;}' "$F"
  ```
- Assert applied: `grep -q 'nope' "$F"`
- **Expected:** `MUTANT_EXIT=1`; `tests 68, pass 66, fail 2`; the failures are test #3
  (first message names `Dockerfile`, `compose.yaml`, `package.json` as unclassified) and
  test #4 (`compose.yaml / fetch( matched 0 line(s), expected 1`). Test #5 **passes** —
  green on the empty manifest set, exactly the AS-37 finding — which is why #3 and #4
  exist. Two failures, not one: the sanction entry doubles as a canary that the manifest
  class is being walked at all.

### 4.4 M2 — the sanctioned hit loses its justification (target moved off loopback)

- File: `compose.yaml`. Mutate:
  ```bash
  perl -pi -e 's{http://127\.0\.0\.1:8348/healthz}{http://example.invalid:8348/healthz}' "$F"
  ```
- Assert applied: `grep -q 'example.invalid' "$F"`
- **Expected:** `MUTANT_EXIT=1`; `tests 68, pass 66, fail 2`; test #4 (`matched 0
  line(s), expected 1`) and test #5 (`compose.yaml:43: fetch(` … `not sanctioned`). No
  `deploy-shape` failure (it does not assert healthcheck contents, and `example.invalid`
  matches none of its credential words).

### 4.5 M3 — the sanctioned construct disappears entirely (stale allowlist)

- File: `compose.yaml`. Mutate (deletes the six-line `healthcheck:` block under `web`):
  ```bash
  perl -0pi -e 's/^    healthcheck:\n(?:      .*\n)+//m' "$F"
  ```
- Assert applied: `! grep -q 'healthcheck' "$F"`
- **Expected:** `MUTANT_EXIT=1`; `tests 68, pass 67, fail 1`; the ONE failure is test
  #4 (`matched 0 line(s), expected 1 — the entry is stale`). Test #5 passes (nothing to
  find). This is the property that separates this fix from a documented hole: the
  allowlist cannot outlive what it sanctions.

All four recipes were spiked by the planner on scratch copies on 2026-09-01 and apply as
written (the M3 `perl` removes exactly lines 42–47 of the current `compose.yaml`).

### 4.6 The measurement that licenses the prose change (§7.2)

From the worktree, with **no** `DOCKER_BUILDKIT=1` prefix (this host's shell exports
`DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0` — confirm with `echo $DOCKER_BUILDKIT`):

```bash
docker compose -p asc-invoicing-as53 --project-directory "$APP" run --rm --build test; echo "EXIT=$?"
docker image inspect asc-invoicing-as53-test --format '{{.Os}}/{{.Architecture}}'
```

Record: `EXIT=0`, the count (`68/68`), the architecture (`linux/amd64`), and evidence the
**legacy** builder ran — its build log prints `Step 1/17 : FROM node:24.20.0-slim` where
BuildKit prints `#1 [internal] load ...`. The planner's own run (2026-09-01, 66/66 on
master): legacy builder, `linux/amd64`, exit 0, 1.41 s.

---

## 5. Acceptance criteria

Each is independently checkable by a reviewer who has never seen the code. "Recorded"
means real pasted output in the implementation comment; QA reproduces every one.

**The guard**

1. `dependency-policy.test.js` walks `apps/invoicing/` closed-world: the test named in
   §2.6 #3 asserts (in order) `unknown` empty, manifest list exactly
   `['Dockerfile', 'compose.yaml', 'package.json']`, source list exactly the current 11,
   and non-empty stripped text for all 14. `UNSCANNED` is exactly
   `{package-lock.json, README.md, .dockerignore}`, each with a reason in the comment.
2. `SOURCE_EXT` is `/\.(js|mjs|cjs|ejs|css)$/`; `MANIFEST_NAME` is a single-line constant
   beginning `const MANIFEST_NAME = ` and matches `Dockerfile`, `Dockerfile.*`, `*.yaml`,
   `*.yml`, `*.json`.
3. `SANCTIONED` exists with exactly one entry, keyed on `file` + `construct` + `line` +
   `count` + `reason` as in §2.2, pinning `compose.yaml` / `fetch(` / the loopback
   `healthz` line / `1`. `compose.yaml` line 43 is byte-identical to master.
4. Test #4 asserts every `SANCTIONED` entry was matched exactly `count` times and carries
   a non-empty `reason`; its failure message contains file, construct, seen, expected,
   and the remedy (§2.2).
5. Test #5's failure message contains relative path, line number, construct name, the
   offending line, and the remedy (§2.2). Detection is whole-text; localisation is per
   match (§2.2 items 1–2).
6. `stripHashComments` exists with the `trailing` semantics of §2.3 and is tested in both
   directions with at least the six cases listed there; `.json` files are not stripped.
7. `curl` and `wget` are in the outbound-client pattern table; the suite is green, so
   `routes/assets.js:41` is proven stripped before matching.
8. Tests #6 and #7 iterate `source ∪ manifest`.
9. `docker compose run --rm --build test` → exit 0, **68 tests, 68 pass**, mountless and
   network-blocked as before; V1 still exits 1 under `ASC_SELFTEST_MUTATE=1`.
   `harness.test.js`'s test-file list is still 6 (no new test file).

**Falsification (§4) — recorded by the implementer, re-run cold by QA**

10. **M1** fails exactly test #5 (`68/67/1`), message names `Dockerfile:55: fetch(`;
    tree clean and `68/68` after the trap + rebuild.
11. **M0** fails exactly tests #3 and #4 (`68/66/2`); test #5 passes green on the emptied
    manifest set; tree clean and `68/68` after.
12. **M2** fails exactly tests #4 and #5 (`68/66/2`), the #5 message names
    `compose.yaml:43: fetch(`; tree clean and `68/68` after.
13. **M3** fails exactly test #4 (`68/67/1`) with the stale-entry message; tree clean and
    `68/68` after.
14. Every mutation run used the §4.1 template (trap + assert-applied + rebuild) under
    project name `asc-invoicing-as53`; `asc-invoicing-web-1` is still up and healthy on
    8348 before and after (`docker ps`), and `asc-chat-server-1` on 8347 untouched.

**Folded-in items (numbers in §9.1; the reviewer checks the edits against them)**

15. **AS-37 plan §1.2 correction** is on master (board-state commit, not on the branch),
    appended under §1.2 with the original sentence quoted and these numbers: **25 files /
    3,113 inserted lines at merge `9c3d965`, of which 898 is the generated
    `package-lock.json`; 2,215 hand-written = 651 product code + 1,280 tests + 129 README
    + 155 manifests and ignore files** — i.e. **3.7×** the "~600 lines including tests"
    estimate, with product code alone at 651 essentially AT the tripwire. Text in §7.1.
16. **BuildKit prose** — `compose.yaml` header lines 17–21 read exactly as §7.2; the
    README's BuildKit paragraph contains the §7.2 sentence; the two documented commands
    are unchanged; the §4.6 measurement is recorded (legacy builder, `linux/amd64`, exit
    0, 68/68).
17. **Stack-decision write-back** — §13 has rows 8, 9, 10 with the §7.4 content (pins
    `express@5.2.1` MIT / `ejs@6.0.1` Apache-2.0 / `node:24.20.0-slim`; footprint 2 direct
    / 67 distinct / 69 instances / 4.0 MB / 61 MIT · 4 ISC · 1 Apache-2.0 · 1 BSD-3-Clause
    / 0 non-permissive; T4 upgrade clause; npm caret trap), and §9.1's T4 row carries the
    upgrade clause with the original wording quoted in row 9. **No image-size figure** is
    written back (§9.1 explains).
18. `apps/invoicing/README.md` carries the house technique (§7.3) in place of the current
    two-line mutation paragraph, and the guards table has the new row.

**Hygiene**

19. Zero `.lattice/` paths on the branch (`git diff --stat master...feat/AS-53-dependency-scan-manifests -- .lattice` is empty); the only files on the branch are the four branch-plane files in §3.
20. No `.env*`, no new dependency (`package.json` unchanged), no product-code file
    changed (`git diff --stat master...<branch> -- apps/invoicing/{app.js,server.js,lib,routes,views,public}` is empty).

---

## 6. Size and complexity

**Complexity: `medium`.** The diff is small (§6.1), but the deliverable is a guard, and a
guard's cost is in proving it fails, not in writing it: four mutation runs with image
rebuilds, a builder measurement, and five files across two planes. Low would understate
the verification burden that *is* the work.

### 6.1 Line estimate (derived from the files, not guessed)

| File | Today | Change |
|---|---|---|
| `test/dependency-policy.test.js` | 289 | walker + constants ≈ +32/−22; hash stripper + test ≈ +37; `SANCTIONED` + test #4 ≈ +33; localisation/sanction lookup in #5 ≈ +17; patterns/union/header ≈ +8 → **≈ +127 / −22 → ≈ 394 lines** (limit 1,200) |
| `compose.yaml` | 62 | header 5 lines → 7: **+2** |
| `README.md` (app) | 129 | **≈ +14** |
| `docs/engineering/01-stack-decision.md` | 980 | T4 row edited in place; 3 log rows: **≈ +3 / −1** (long lines) |
| AS-37 plan §1.2 (master) | — | **+7** |

Total ≈ **+153 / −23** across five files; 66 → 68 tests. Well under the milestone
right-sizing tripwires (>~10 files, >~600 lines) — kept whole, no justification needed.

---

## 7. Verbatim text for the doc edits

### 7.1 AS-37 plan §1.2 — correction note (master; orchestrator applies at `in_progress` kickoff)

Append immediately after the §1.2 paragraph (after the line ending "…not because two
subsystems were joined."):

```markdown
> **Correction, 2026-09-01 (AS-53, from the AS-37 review):** the estimate above — *"~21
> files / ~600 lines including tests"* — was wrong by **3.7×**. Measured at merge `9c3d965`:
> **25 files / 3,113 inserted lines**, of which 898 is the generated `package-lock.json`;
> **2,215 hand-written** = 651 product code + 1,280 tests + 129 README + 155 manifests and
> ignore files. Product code alone (651) sits essentially at the ~600 tripwire; the overage
> is the suite, which the review demonstrated is load-bearing by breaking every guard in
> it. The keep-it-whole reasoning survives the corrected number; the number is corrected so
> future right-sizing is not calibrated against a bad one.
```

Commit from the main checkout: `AS-53: board — AS-37 plan §1.2 size estimate corrected`.

### 7.2 BuildKit prose

`compose.yaml` — replace lines 17–21 (from `# BuildKit note` through `…COMPOSE_DOCKER_CLI_BUILD=1.`) with:

```
# BuildKit note (inherited from apps/chat/compose.yaml, and live on this host):
# the shell exports DOCKER_BUILDKIT=0 and COMPOSE_DOCKER_CLI_BUILD=0. The
# service-level `platform:` key ALONE was measured producing a native image
# against the amd64 pin (Docker 29.6.1 / compose v5.3.0); `build.platforms` below
# is what makes the pin take, and it does so under BOTH builders (legacy builder,
# DOCKER_BUILDKIT=0: linux/amd64, suite green — measured 2026-09-01). README.md
# keeps the DOCKER_BUILDKIT=1 prefix as repo convention, not as a requirement.
```

`apps/invoicing/README.md` — in the paragraph beginning `**Why the \`DOCKER_BUILDKIT=1\`
prefix.**`, after the sentence ending "…follows chat's convention.", insert:

```
It is **not required for correctness**: with `build.platforms` set, the legacy builder
(`DOCKER_BUILDKIT=0`) also produces a `linux/amd64` image and the suite passes (measured
2026-09-01, re-measured under AS-53).
```

Leave the rest of the paragraph and both commands as they are.

### 7.3 README — the house technique and the coverage row

Replace the two-line paragraph beginning `If you run a mutation, **restore in the same
step as the observation.**` with:

```markdown
**Mutation discipline (house technique, learned the hard way in AS-37):**
mutate / assert-applied / observe / restore / **rebuild**, as **one indivisible shell
step** under an `EXIT` trap, then verify the **image**, not just the tree:

1. `cp` the file to a backup and `trap 'mv -f backup file' EXIT` — an interrupted run
   cannot leave the mutation live.
2. Mutate, then **assert the mutation applied** (`grep`) — a silently failed edit must
   not be misread as "the guard did not fire".
3. Observe with `docker compose run --rm --build test` and record the exit code and
   exactly which tests failed.
4. Let the trap restore; prove it with `git diff --exit-code`.
5. **Rebuild and re-run.** Restoring source is not restoring state: a stale mutant image
   produced two phantom failures in AS-37's review. Green on the rebuilt image is the
   verification.

Run it in a subshell with absolute paths and, when working in a task worktree, under a
distinct `-p` project name so the main checkout's running `web` is never touched.
```

Add to the "three structural guards" table, after the V2 row:

```markdown
| **V2b** — the scan is closed-world | `test/dependency-policy.test.js` classifies **every** file in this directory as app source, manifest, or explicitly unscanned; an unclassified file fails. Sanctioned hits (`SANCTIONED`) must be used exactly as declared | Plant `fetch(` in `Dockerfile` — red on the construct guard. Point the compose healthcheck off loopback — red on both the construct guard and the sanction guard. Delete the healthcheck — red on the sanction guard alone (AS-53) |
```

### 7.4 Stack-decision write-back

§9.1 — replace the T4 row with:

```markdown
| **T4** | A dependency acquires a cost, an account requirement, or a licence change — **including on upgrade of an existing dependency** | Any dependency requiring payment, signup, or a non-permissive licence, anywhere in the transitive tree, at adoption **or on upgrade** | any | Board ask, or removal. **Never adopted quietly.** On every upgrade of a direct dependency, **re-run the transitive licence scan** and record the spread before merging. This is §11's rule with a trigger attached (upgrade clause added under AS-53 — §13 row 9) | any time, and on every upgrade |
```

§13 — append three rows (use the actual date of the edit; "Who" attributes the decision,
the keystroke is the implementer's):

```markdown
| 8 | 2026-09-01 | **Pins named and adopted footprint recorded.** `express@5.2.1` (MIT), `ejs@6.0.1` (Apache-2.0), base image `node:24.20.0-slim` — an exact **patch**, stronger than §12's "exact minor". Transitive footprint as adopted by AS-37: **2 direct · 67 distinct `name@version` · 69 instances on disk · 4.0 MB**; licence spread **61 MIT · 4 ISC · 1 Apache-2.0 · 1 BSD-3-Clause** (distinct-level; instance-level is 63/4/1/1 = 69) · **0 non-permissive**. Two independent walks agree: AS-37's planner and AS-37's reviewer | §12 mandated exact pins without naming them and stated no adopted package count; §11 rule 4 says the footprint is counted, not assumed. AS-36 review findings 7a and 3, owed by AS-37 plan §14 item 1 | Owen Kessler, CTO — applied under AS-53 |
| 9 | 2026-09-01 | **Trigger T4 gains an upgrade clause** (§9.1, edited in place). Original observable read *"Any dependency requiring payment, signup, or a non-permissive licence"*; original action *"Board ask, or removal. Never adopted quietly. This is §11's rule with a trigger attached"*. Now: *"…including on upgrade of an existing dependency"*, with the action *"re-run the transitive licence scan and record the spread before merging"* | AS-36 review finding 2, accepted in AS-37 plan §14 item 2: nothing re-scanned the 67 admitted packages when Express or EJS was upgraded, and §5.3 is the proof that a tree is exactly where a licence problem hides | Owen Kessler, CTO — applied under AS-53 |
| 10 | 2026-09-01 | **Hazard recorded against §10.4 item 6 / §12 "no caret version range":** `npm install <pkg>@<exact>` writes a caret range (`"^5.2.1"`) by default, so the obvious command produces the forbidden shape silently. Mitigation as built by AS-37: `npm install --save-exact`; committed `package-lock.json` (lockfile v3) — the two exact literals pin the direct set only, the lockfile pins the other 65; `npm ci` as the only install in the `Dockerfile`; and `test/dependency-policy.test.js` asserts the exact-literal shape so it cannot regress on review discipline | Measured in AS-37 planning (plan §4.4); owed by AS-37 plan §14 item 3 | Owen Kessler, CTO — applied under AS-53 |
```

---

## 8. Implementation order

Each step ends somewhere verifiable, so a tick that dies mid-task leaves a resumable
worktree.

0. **Orchestrator, main checkout, master:** apply §7.1 to the AS-37 plan and commit as
   board state. (Do this at the `in_progress` transition, before spawning Marcus.)
1. **Marcus, worktree:** baseline run under `-p asc-invoicing-as53` — expect 66/66.
2. Walker + constants + cardinality test (#3). Run: 66/66 (the manifest list now exists
   and the file set is asserted; nothing else changed yet).
3. `stripHashComments` + test #2. Run: 67/67.
4. `SANCTIONED` + test #4 + localisation/sanction lookup in #5 + `curl`/`wget` + union
   in #6/#7 + header comment. Run: 68/68. **Commit** (`AS-53: extend dependency-policy
   scan to manifests with a keyed, counted allowlist`).
5. Mutations M1, M0, M2, M3 per §4 — record output. Nothing to commit (trees restored).
6. §7.2 compose header + README sentence; §4.6 measurement. **Commit.**
7. §7.3 README technique + row; §7.4 stack-decision edits. **Commit.**
8. Final: `docker compose -p asc-invoicing-as53 --project-directory "$APP" run --rm --build test` → 68/68; V1 both directions; `docker ps` shows both long-running containers healthy; clean up the worktree's images (`docker image rm asc-invoicing-as53-test`) so nothing is left behind. Write the implementation comment with all recorded output. Do **not** transition, merge, or push.

---

## 9. Evidence behind the numbers

### 9.1 What the planner measured on 2026-09-01

- **AS-37 merge `9c3d965`:** `git show --stat` → 25 files, 3,113 insertions. `wc -l`:
  product code (`app.js server.js lib/*.js routes/*.js views/*.ejs public/*.css`) = 651;
  tests (`test/*.js test/helpers/*.js`) = 1,280; `README.md` = 129; `Dockerfile` 54 +
  `compose.yaml` 62 + `package.json` 15 = 131; `.dockerignore` 23 + `.gitignore` +1 = 24;
  `package-lock.json` = 898. 651 + 1,280 + 129 + 131 + 24 = **2,215**; 2,215 + 898 =
  3,113 ✓. 2,215 / 600 = **3.69×**. Priya's figures reproduce exactly.
- **Legacy builder:** `docker compose -p asc-invoicing-plan53 run --rm --build test` from
  `apps/invoicing` on master with the shell's `DOCKER_BUILDKIT=0
  COMPOSE_DOCKER_CLI_BUILD=0` → build log `Step 1/17 : FROM node:24.20.0-slim` (legacy
  builder), `Successfully built`; suite **66 tests / 66 pass / 0 fail**, exit 0, 1.41 s;
  `docker image inspect … --format '{{.Architecture}}'` → **amd64**. Third independent
  confirmation (Marcus, Priya, Owen). Planning image removed afterwards; no container or
  network left behind.
- **Pattern collisions:** `grep -rnE '\b(curl|wget)\b'` over the scanned set → one hit,
  `routes/assets.js:41`, inside a `//` comment. `grep -niE 'amount|currency|money'` over
  the three manifests → none. Forbidden-construct patterns over the three manifests → the
  single `compose.yaml:43` `fetch(`. Over `package-lock.json` → none.
- **Live state:** `asc-invoicing-web-1` Up 5 h **(healthy)** on 127.0.0.1:8348 — the
  compose healthcheck is exercised and load-bearing; `asc-chat-server-1` Up 27 h healthy
  on 8347. Docker 29.6.1, compose v5.3.0.
- **Image size, for the record and NOT for the write-back:** `docker image inspect
  asc-invoicing-web:latest` → 234,556,990 B; base `node:24.20.0-slim` → 229,740,617 B;
  delta 4.8 MB. The AS-37 plan §4.2 states 239 MB / +9 MB — that was the planning spike
  image, and QA's independent walk did not cover image size. Two walks agree on the
  package footprint; nobody has reproduced the image figure; so §7.4 row 8 carries the
  footprint and omits the image size rather than write back a number with one source.

### 9.2 Where this contradicts, or extends, the filing comment

- Nothing in Priya's comment is contradicted. Her three numbers (2,215 / 651 / 1,280)
  and her builder measurement reproduce.
- Extended: (i) closed-world walker instead of an extension list (§2); (ii) `curl`/`wget`
  patterns (§2.5); (iii) `package.json` scanned (§2.1); (iv) the allowlist must be
  *exactly used*, so it cannot go stale (§2.2 item 4) — this is what makes the chosen
  fix shape strictly better than the documented-carve-out fallback rather than merely
  preferable to it.

---

## 10. Proposed metawork (for the metawork layer; employees do not edit CLAUDE.md)

Priya proposed the mutation technique as the house standard. If the board wants it above
the app README, this paragraph belongs under `CLAUDE.md` → Lattice → "The Review Gate":

> **Mutation testing is one indivisible step (learned 2026-09-01, AS-37/AS-53).** When a
> reviewer or implementer proves a guard by breaking it: back up, `trap` the restore on
> `EXIT`, mutate, **assert the mutation applied**, observe, let the trap restore, prove
> the tree with `git diff --exit-code`, then **rebuild and re-run** — a restored source
> tree with a stale mutant image produced phantom failures once already. Record the exact
> failing-test set; a wider or narrower set than expected is itself a finding.

Not required for AS-53's acceptance.

---

## 11. Open questions — time-boxed, with defaults

| # | Question | Default if unresolved | Box |
|---|---|---|---|
| Q1 | Should client-side `fetch(` in a future `.html`/inline `<script>` count as an "outbound HTTP client" for the custody guard? | **No** — the chokepoint is server-side egress to Stripe; same-origin browser fetches are the app talking to itself. But `.html` is deliberately *unclassified* today so its first appearance forces the author to write this down in `SOURCE_EXT`/`UNSCANNED`. | AS-38 planning |
| Q2 | Should `deploy-shape.test.js` and `dependency-policy.test.js` share one manifest parser/stripper via `test/helpers/`? | **Not now.** Two ~20-line strippers with different contracts (structural vs lexical) beat a shared helper that has to serve both. Revisit if a third consumer appears. | first task that needs a third |
| Q3 | Should `SANCTIONED` entries expire (a `review_by` date)? | **No.** The exact-use assertion already forces a touch whenever the sanctioned line changes; a date adds ceremony without a failure mode it removes. | — |

None of these blocks implementation. Take the default and note it in a Lattice comment.
