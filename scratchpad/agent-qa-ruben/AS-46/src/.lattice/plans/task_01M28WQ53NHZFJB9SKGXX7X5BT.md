# AS-115: Chat: commit hashes and branch names in messages are click-to-copy

Planner: agent:cto-owen, tick watcher:53418 loop tick 10 (2026-09-11). Source: board DM msg 793,
filed on the board's behalf. Baseline master for every number below: `7b1f036`.

## 1. Scope

A commit hash or a `feat/AS-<n>-<slug>` branch name inside a message body renders as an inline
copy chip: plain click (or Enter/Space when focused) writes the exact matched text to the
clipboard and shows a short "copied" state. No navigation, no href, no new tab. Modified clicks
and ordinary text selection behave as today.

Deliverables, in order of risk:

1. Two new pure tokenizers, `tokenizeHashes` and `tokenizeBranches`, in a new module
   `apps/chat/public/copy-refs.js` (same contract as `public/msg-refs.js`: exact source slices,
   round-trip, no DOM, importable from node:test).
2. The leaf pass chain that today lives inline in `appendRefLeaf` (`public/app.js` lines
   218–241) is extracted into a pure composer `tokenizeLeaf(text, refs, { autolink })` in a new
   module `apps/chat/public/leaf-refs.js`, together with `tokenizeAsRefs` (app.js lines 142–155,
   already pure). `appendRefLeaf` becomes a `switch` on token type → node. This is the only way
   the ordering constraints in §4 can be proven red (M4): the chain order is a "recorded
   invariant" today and nothing can observe it from node:test.
3. The chip element + click/keyboard/clipboard handling in `app.js` (`copyRefNode(tok)`), next to
   `fileRefLink` (app.js line 189).
4. Styling from semantic tokens. The chat app has no token layer today (`public/style.css` is
   raw hex throughout; the only custom property is `--app-height`, line 357), so this task
   adopts AS-29's token file: `apps/chat/public/tokens.css` is a **verbatim copy** of
   `docs/design/tokens/tokens.css` (291 lines), guarded by a byte-equality parity test, linked
   from `index.html` line 7 ahead of `/style.css`, with `<html data-theme="light">` pinned
   (tokens.css switches semantic tokens on `prefers-color-scheme: dark` unless
   `[data-theme="light"]` is set — lines 173–174 and 215–216; without the pin a dark-OS user
   would get a dark chip on the app's white raw-hex page).

## 2. Non-goals

- Migrating the rest of `style.css` to tokens. Only the new `.copy-ref` rules use them; the
  token file is adopted so the new rules can be written correctly, not to restyle the app.
- Copying anything other than the two shapes above (task ids, build ids as a category, URLs,
  `AS-n` codes). 16-hex build ids do tokenize because they are hex runs of admitted length
  (§3.1) — that is accepted, not designed for.
- Fixing the pre-existing anchor-in-anchor cases (an `AS-n` or `msg n` link inside a markdown
  link label already nests `<a>` inside `<a>` — app.js line 267 with lines 159/174). Observed,
  left alone; the new chip does NOT add to it (§4, O5).
- Making `master` or `origin/master` copyable, or admitting branch prefixes other than `feat/`
  (§3.2 says why).
- A clipboard test harness. There is no DOM in this suite; clipboard behaviour is verified by
  recorded manual checks (§8b) and counted separately.

## 3. Recognition rules (calibrated on the live corpus)

Calibration: 738 bodies from the public channels plus the CTO's own DMs via the AS-25
`?since=0` read path, and 593 bodies from `apps/chat/data/export/*.jsonl` (scripts:
`scratchpad/agent-cto-owen/AS-115/calibrate-live.mjs`, `calibrate.mjs`, `regex-check.mjs`).
Findings that shaped the rules:

- Word-bounded lowercase hex runs of 7–40: 97 of length 7, 4 of length 16 (watcher build ids,
  e.g. `96b396aefb4058e5`), 1 of 8 and 1 of 12 (both fragments of a UUID inside a URL). No
  40-char full hashes in chat at all.
- **Two real commit hashes are single-class:** `1411753` (all digits, "at 1411753, 456/456
  host") and `efadfac` (all a–f, "four commits to efadfac"). The "require a digit AND a letter"
  rule floated in the task description would silently miss both — a silent miss is worse than a
  stray chip, because the board cannot tell why *this* hash is not clickable. Recall wins.
- Zero all-digit runs of 8+ anywhere in either corpus; zero a–f-only English words. Pids are 5
  digits (`watcher:53418`), msg ids 3, ports 4.
- Characters around real hashes: before — space (70), `(` (26), `/` (3, all inside GitHub
  commit URLs), `.` (1, the range `b3f71ee..44ac58a`), `-` (1, UUID). After — `)`, `,`, space,
  `.` (sentence end, 14), `:`, `;`.
- Branch names: every one is `feat/AS-<n>-<slug>` (18 occurrences, 12 distinct). No other
  prefix occurs (`fix/`, `chore/`, `hotfix/`, … all zero); `origin/master` once. Three end a
  sentence with a period glued on (`feat/AS-83-probe-budget.`); slugs use `[a-z0-9-]` only.

### 3.1 Hashes

```js
// public/copy-refs.js
const HASH_RE = /(?<![A-Za-z0-9_/#-])[0-9a-f]{7,40}(?!\.?[A-Za-z0-9_-])/g;
const HEX_WORDS = new Set(['acceded', 'defaced', 'effaced']); // the a–f-only English words of 7+ letters
function admitHash(s) {
  if (HEX_WORDS.has(s)) return false;
  if (/^\d+$/.test(s)) return s.length === 7; // git's abbrev length; 8+ digits is a number
  return true;
}
```

Decisions, each with its reason:
- Lowercase only: git prints lowercase; `1C41E3FF` (a BRANDING colour) and `DEADBEEF` must not chip.
- Left boundary blocks `[A-Za-z0-9_]` (word), `/` (a path segment like `apps/abc1234.js`, and
  GitHub `commit/<sha>` URLs — those are already terminal in the URL pass, this is the second
  fence), `#` (an issue number), `-` (UUID and compose-project fragments). It deliberately
  allows `.`, `(`, `` ` ``, `:` and whitespace — the range idiom `a..b` yields both halves.
- Right boundary blocks a word char or `-`, **or a `.` followed by a word char** (`abc1234.js`);
  a sentence-ending `.` is fine because a space follows it.
- All-digit runs are admitted only at exactly length 7 (the observed real case; a 7-digit
  integer is rare in engineering chat, the corpus has none) and rejected at 8+ (epoch seconds
  are 10 digits, epoch ms 13, `2147483648` 10).
- All-alpha runs are admitted except the three-word stoplist. The list is exhaustive for English
  words of 7+ letters drawn from {a…f}; `deadbeef` is an idiom that *should* chip.

**Positive inputs (P) — each must yield exactly the listed hash tokens:**

| # | Input | Tokens |
|---|---|---|
| P1 | `merged 74cb6f9 after` | `74cb6f9` |
| P2 | `(commit e5a180a)` | `e5a180a` |
| P3 | `landed as 0337a54.` | `0337a54` (period stays text) |
| P4 | `at 1411753, 456/456 host` | `1411753` (all digits, length 7) |
| P5 | `four commits to efadfac; host` | `efadfac` (all a–f) |
| P6 | `master pushed b3f71ee..44ac58a; worktree` | `b3f71ee`, `44ac58a` |
| P7 | `build cb92cbbb2c37d4a8, 5 s` | `cb92cbbb2c37d4a8` |
| P8 | a 40-char run between spaces | the 40-char run |
| P9 | `` `e5a180a` `` | `e5a180a` (backticks stay text) |
| P10 | `e5a180a:` | `e5a180a` |
| P11 | `desiredId == 84639eb29e39d4d7) and` | `84639eb29e39d4d7` |
| P12 | `deadbeef in the fixture` | `deadbeef` |

**Negative inputs (N) — each must yield zero hash tokens:**

| # | Input | Why |
|---|---|---|
| N1 | `acceded to the plan` | stoplist |
| N2 | `defaced and effaced` | stoplist (two hits) |
| N3 | `pid 1234567890 exited` | all-digit, length 10 |
| N4 | `epoch 1757620000 and 1757620000123` | all-digit 10 and 13 |
| N5 | `2147483648 and 10000000` | all-digit 10 and 8 |
| N6 | `#1411753 is an issue` | `#` left boundary |
| N7 | `AS-1411753` | `-` left boundary |
| N8 | `x_e5a180a and e5a180a_x` | word boundary |
| N9 | `1C41E3FF and Abc1234 and DEADBEEF` | not lowercase |
| N10 | `d1d38cac-4449-42ce-babe-fcc1b3e77a2a` | UUID: `-` boundaries |
| N11 | `asc-as93-ruben-mm6-test` | compose project name |
| N12 | `apps/abc1234.js and lib/abc1234/x` | `/` left boundary |
| N13 | `abc1234.js` | `.` + word char right boundary |
| N14 | a 41-char lowercase hex run | over length (`{7,40}` is exact) |
| N15 | `abc123 short` | length 6 |
| N16 | `task_01M28WQ53NHZFJB9SKGXX7X5BT` | Crockford base32, uppercase, `_` |
| N17 | `watcher:53418 loop tick 10` | 5 digits |
| N18 | `v1.156 released` | not hex length |
| N19 | `msg 1234567` **through the composer** | msg-ref pass consumes it first (O3 in §4; the tokenizer alone WOULD match, which is why order is a criterion) |

### 3.2 Branch names

```js
const BRANCH_RE = /(?<![A-Za-z0-9_-])feat\/AS-\d+(?:-[A-Za-z0-9_]+)+(?![A-Za-z0-9_/-])/g;
```

- `feat/AS-<n>-<slug>` only: it is the one branch form the git methodology permits
  (`CLAUDE.md` § Task lifecycle in git) and the only one the corpus contains. Admitting
  `fix/`… would be speculation; adding a prefix later is a one-token edit with its own P/N rows.
- At least one slug segment: `feat/AS-88` alone is not a branch the company creates.
- Slug segments are `[A-Za-z0-9_]+` joined by `-`; no `.` inside, so the sentence-ending
  period in `feat/AS-83-probe-budget.` falls outside the token. Uppercase `AS` only.
- Left boundary allows `/` and `.` on purpose: `origin/feat/AS-95-watcher-loop` and
  `master...feat/AS-93-deep-link-host` (the CLAUDE.md review idiom) both yield the branch.
- The `AS-<n>` inside a branch token is NOT also a task link: branch tokens are terminal and the
  branch pass runs before `tokenizeAsRefs` (§4). The whole name is one copy target; a task link
  in the middle of it would split the copy. Deliberate trade, recorded here.

| # | Input | Tokens |
|---|---|---|
| BP1 | `branch feat/AS-88-deploy-names-its-project from` | `feat/AS-88-deploy-names-its-project` |
| BP2 | `(feat/AS-26-message-permalinks).` | `feat/AS-26-message-permalinks` |
| BP3 | `on feat/AS-83-probe-budget.` | `feat/AS-83-probe-budget` |
| BP4 | `git diff master...feat/AS-93-deep-link-host` | `feat/AS-93-deep-link-host` |
| BP5 | `origin/feat/AS-95-watcher-loop` | `feat/AS-95-watcher-loop` |
| BP6 | `` `feat/AS-28-favicon` `` | `feat/AS-28-favicon` |
| BP7 | `feat/AS-115-copy-refs,` | `feat/AS-115-copy-refs` |

| # | Input (zero branch tokens) | Why |
|---|---|---|
| BN1 | `feat/AS-88` | no slug |
| BN2 | `feat/AS-88-` | dangling dash |
| BN3 | `feat/AS-88-slug-` | trailing dash → not a whole match |
| BN4 | `xfeat/AS-88-slug` | left boundary |
| BN5 | `feat/AS-88-slug/extra` | right boundary `/` |
| BN6 | `fix/AS-88-slug` | prefix not admitted |
| BN7 | `.worktrees/AS-88` | not a branch |
| BN8 | `feat/as-88-slug` | lowercase code |

Both tokenizers: `String(text ?? '')`, `lastIndex = 0` before scanning, exact slices, round-trip
(`tokens.map(t => t.text).join('') === input`), `''`/`null`/`undefined` → `[]`. Token shapes:
`{ type: 'hash', text }` and `{ type: 'branch', text }`.

## 4. Position in the leaf chain, and the composer

Today (`app.js` 218–241): `tokenizeUrls` → `tokenizeAsRefs` → `tokenizeMsgRefs` →
`tokenizeFileRefs` → text. New order, as `tokenizeLeaf` in `public/leaf-refs.js`:

```
tokenizeUrls (terminal)            [skipped when autolink:false]
  → tokenizeBranches (terminal)    [skipped when autolink:false]
    → tokenizeAsRefs (terminal)
      → tokenizeMsgRefs (terminal)
        → tokenizeFileRefs (terminal)
          → tokenizeHashes (terminal)   [skipped when autolink:false]
            → text
```

`tokenizeLeaf(text, refs, { autolink = true } = {})` returns a flat array of tokens of types
`text | url | branch | asref | msgref | fileref | hash`, in source order, round-tripping the
input. `appendRefLeaf(parent, text, refs, opts)` in app.js becomes: for each token, append
`urlLink` / `copyRefNode` / `asRefLink` / `msgRefLink` / `fileRefLink` / `createTextNode`.
`bodyNode` (app.js 254–276) is unchanged. The `autolink` flag keeps its name; its documented
meaning widens from "skip the URL pass" to "this leaf is the label of a markdown link — skip
every pass that would create a clickable element with no server-resolved ref" (URL, branch,
hash). AS-refs and msg-refs keep their existing behaviour inside link labels (non-goal above).

**Ordering constraints, each with its falsifier (an input whose token list changes if the order
is wrong):**

| # | Constraint | Falsifier input | Correct tokens | Wrong-order tokens |
|---|---|---|---|---|
| O1 | Hash after URL | `see https://github.com/malls/american-software/commit/a0cfb0b now` | one `url` (the whole URL), no `hash` | a `hash` `a0cfb0b` would appear if the hash pass saw URL text |
| O2 | Branch before AS-refs | `feat/AS-87-deploy-heartbeat-and-log` with `refs=[{shortId:'AS-87',…}]` | one `branch`, zero `asref` | `asref` `AS-87` splits the branch |
| O2b | AS-refs still fire outside a branch | `AS-87 on feat/AS-87-deploy-heartbeat-and-log` with the same refs | `asref`, text, `branch` | — (guards O2's mutant from over-correcting) |
| O3 | Hash after msg-refs | `msg 1234567` | `msgref` (id 1234567), zero `hash` | `hash` `1234567` |
| O3b | Msg-refs then hash both fire | `msg 810 merged 74cb6f9` | `msgref`, text, `hash` | — |
| O4 | Branch after URL | `https://github.com/malls/american-software/tree/feat/AS-95-watcher-loop` | one `url`, zero `branch` | `branch` inside the URL |
| O5 | `autolink:false` skips URL, branch, hash | `tokenizeLeaf('e5a180a on feat/AS-88-x https://x.test', refs, {autolink:false})` | a single `text` token | any of the three |
| O6 | Hash vs file-refs | **not observable**: a `.md` path never contains a bare hash (`/` left fence, `.m` right fence). Placed last by convention; stated as documentation, not a criterion (M4). |

## 5. The element

`copyRefNode(tok)` in app.js, beside `fileRefLink`:

- Tag: `<span class="copy-ref" role="button" tabindex="0">` with `textContent = tok.text` (via
  `el()`), `title = 'Click to copy'`, `data-kind = tok.type` (`hash` | `branch`) for styling
  hooks. Chosen over `<button>` because the body is `white-space: pre-wrap` inline prose: a span
  flows and selects like text (the "text selection keeps working" requirement), needs no UA
  button resets, and cannot become a form control. Cost: six lines of keyboard handling.
- **No `href`, no `<a>`, no `setAttribute('href', …)`, ever.** There is nothing to navigate to.
  This keeps the chip outside the subject of the AS-93 guard (`test/api.test.js` 1957–2005) and
  AS-98's tightening of it; §7 says how that is proven rather than assumed.
- Click: `if (isModifiedClick(e)) return;` (app.js line 72 helper) — modified clicks fall through
  to native behaviour. Otherwise `e.preventDefault()` and `copyText(node, tok.text)`.
- Keyboard: `keydown` for `Enter` and `' '` → `preventDefault()` + the same `copyText`. Tab
  reaches it via `tabindex="0"`.
- `copyText(node, text)`:
  - if `navigator.clipboard?.writeText` exists: `writeText(text).then(() => flashCopied(node),
    () => selectNode(node))`;
  - else `selectNode(node)`: `getSelection().selectAllChildren(node)` — the insecure-context
    fallback is **select-on-click**, so the user can Cmd/Ctrl-C. No `execCommand('copy')`
    (deprecated, and a "copied" state it cannot verify would lie). Both real deployments are
    secure contexts (https tailnet, http loopback), so this path is a degradation, not a mode.
  - `flashCopied(node)`: add class `copied`, set `title = 'Copied'`, `clearTimeout` any pending
    timer on the node, `setTimeout(1200)` to remove the class and restore the title. A repeat
    click restarts the window. The text content never changes (layout stable, round-trip
    intact). The constant is JS (`COPIED_MS = 1200`); tokens.css has no motion tokens, so there
    is nothing to reference.
- The clipboard payload is `tok.text` — the exact source slice, never the DOM's textContent
  (identical today, but the tokenizer is the contract).

## 6. Styling (tokens only — BRANDING.md §0, §3.2)

In `public/style.css`, after the `.body code` rule (line 176):

```css
/* AS-115: click-to-copy chips for commit hashes and branch names. Tokens from
   tokens.css (AS-29); this is the first rule set in this file to use them. */
.copy-ref {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  background: var(--color-accent-bg-subtle);
  color: var(--color-accent-text-on-subtle);
  border: var(--border-width-hairline) solid transparent;
  border-radius: var(--radius-sm);
  padding: 0 var(--space-1);
  cursor: copy;
  user-select: text;
}
.copy-ref:hover { border-color: var(--color-border-interactive); }
.copy-ref:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
  outline-offset: var(--focus-ring-offset);
}
.copy-ref.copied {
  background: var(--color-success-bg-subtle);
  color: var(--color-success-text-on-subtle);
  border-color: var(--color-success-text);
}
/* Inside a code span the span already draws the chip; don't draw two. */
.body code .copy-ref { background: transparent; padding: 0; }
```

Token existence, all verified in `docs/design/tokens/tokens.css`: `--font-family-mono` (l.84),
`--font-size-xs` (l.87), `--space-1` (l.121), `--radius-sm` (l.135), `--border-width-hairline`
(l.161), `--focus-ring-width` / `--focus-ring-offset` (l.162–163), the colour tokens (l.187–196
light, 229–238 dark, 273–282 override). No raw hex, no raw px, no new colour.

`index.html`: `<link rel="stylesheet" href="/tokens.css">` inserted before line 7's
`/style.css`; `<html lang="…" data-theme="light">`. `public/tokens.css` is byte-identical to
`docs/design/tokens/tokens.css` (parity test; the copy exists because the server serves
`public/` only — `server.js` line 2). It contains none of the AS-93 banned literals (`8799`,
`8443`, `127.0.0.1` — checked), so the AC-9 directory scan stays green for the right reason.

## 7. Relationship to the AS-93 / AS-98 link-site guard, and merge order

The AS-93 guard (`test/api.test.js` 1957–2005) asserts: four named `dashHref()` sites, exactly
5 `dashHref(` occurrences, no `.href = <x>.url`, and no host/port literal in any `public/` file.
AS-98 (planned in a parallel lane this tick) tightens the `.url` pattern to be
whitespace-insensitive, adds a `setAttribute('href'` scan, and widens the literal ban.

This task's position: **the chip is not a link site.** It must stay green under both guards
*because no href is assigned*, not because a pattern missed it. That is proven, not argued, by
a counter test in this task (AC-17): `app.js` has exactly **9** `/\.href\s*=/g` matches today
(lines 160, 177, 205, 264, 298, 457, 718, 800, 964) and **0** `setAttribute('href'`; both
counts are asserted unchanged, and mutant M9 (`node.href = ''` inside `copyRefNode`) must turn
it red. The spelling that would ALSO trip AS-98's tightened guard if the implementer did it
wrong is `node.setAttribute('href', …)` — under AS-98 that is red twice (AS-98's scan and
AC-17); under pre-AS-98 master it is red once (AC-17). `node.href=x` with no spaces is red
under AC-17 regardless (the regex is whitespace-insensitive by construction — the AS-98
lesson applied here from the start).

**Merge-order ruling (CTO):** AS-98 merges first if its review completes first, and it is the
smaller, test-only change, so that is the expected order. AS-115 then rebases
`feat/AS-115-copy-refs` onto post-AS-98 master **before** its review transition, and QA runs
AS-98's tightened guard as part of the sweep. If AS-115 reaches `review` first, it merges
first and the AS-98 implementer rebases over it — AS-98 must then include the copy chip in
its own falsifier set (its M-M6-style mutant applied at the `copyRefNode` site). File overlap
between the two is expected to be **zero** (AS-98 edits `test/api.test.js` and possibly
`README.md`; this task's source-scan tests live in `test/copy-refs.test.js`, deliberately not in
`api.test.js`, so neither branch conflicts textually). If AS-98's plan ends up editing
`public/` after all, the later of the two rebases and re-takes its compose receipt.

AS-88 (`feat/AS-88-deploy-names-its-project`, in review): `git diff master...` shows 8 files,
all under `watch/`, `test/watcher-*`, `test/deploy-*`, and the two READMEs. No `public/` file.
No seam; its merge only shifts the baseline counts by +8 (§9).

## 8. Acceptance criteria

### 8a. Test-guarded (19 criteria, 19 tests — one test each; the sweep is a floor check, M5)

New files: `test/copy-refs.test.js` (T1–T7, T17–T19), `test/leaf-refs.test.js` (T8–T15),
`test/tokens-parity.test.js` (T16).

| AC | Criterion | Test | Anchored mutant | Predicted red |
|---|---|---|---|---|
| AC-1 | P1–P12 each yield exactly the listed hash tokens, round-trip | T1 | M1: `{7,40}`→`{8,40}` in `HASH_RE` | T1 (P1–P6, P9, P10 — the 7-char rows; P7/P8/P11/P12 are 8+ and stay green), T13 (the fixture's 7-char hash becomes text) |
| AC-2 | N1–N18 each yield zero hash tokens, round-trip | T2 | M2: drop `#` from the left lookbehind | T2 (N6) |
| AC-3 | Composition rule: all-digit admitted only at length 7; all-alpha admitted except `HEX_WORDS` | T3 | M3: `admitHash` returns `true` | T3, T2 (N1–N5) |
| AC-4 | Junk-tolerant: `''`/`null`/`undefined` → `[]` (both tokenizers) | T4 | — (M4 does not require a falsifier for a shape check) | — |
| AC-5 | BP1–BP7 yield exactly the listed branch tokens, round-trip | T5 | M5: `(?:-[A-Za-z0-9_]+)+`→`*` | T6 (BN1); T5 unchanged — that asymmetry is expected, record it |
| AC-6 | BN1–BN8 yield zero branch tokens | T6 | M6: drop `/` from the branch right lookahead | T6 (BN5) |
| AC-7 | Right-boundary `\.?` clause: `abc1234.js` (N13) stays text while `0337a54.` (P3) tokenizes | T7 | M7: remove `\.?` from `HASH_RE` lookahead | T7, T2 (N13) |
| AC-8 | O1: hash inside a commit URL is not a hash token | T8 | M8: in `tokenizeLeaf`, `url` tokens stop being terminal — their text is fed down the rest of the chain | T8, T11, T13 |
| AC-9 | O2 + O2b: branch before AS-refs; AS-refs still fire outside | T9 | M9a: swap branch and AS-ref passes | T9 |
| AC-10 | O3 + O3b: hash after msg-refs; both fire when disjoint | T10 | M10: move the hash pass ahead of msg-refs | T10 |
| AC-11 | O4: branch inside a URL is not a branch token | T11 | (M8 is the falsifier for both O1 and O4 — one leak, two token types; T11 must be in M8's observed red set or M8 was applied at the wrong site) | T8, T11, T13 |
| AC-12 | O5: `autolink:false` yields no url/branch/hash tokens | T12 | M11: `autolink` gates only the URL pass (the pre-AS-115 behaviour) | T12 |
| AC-13 | Whole-chain round-trip on a fixture body containing a hash, a branch, a msg ref, an AS ref, a URL, a file ref — `join === input` and the type sequence is exact | T13 | (M8/M10 also turn this red — record which) | — |
| AC-14 | `tokenizeLeaf` emits only the seven known types (cardinality assertion over the fixture) | T14 | — | — |
| AC-15 | `tokenizeAsRefs` moved to `leaf-refs.js` with identical behaviour (`refs=[]` → single text token; `\b`-bounded) | T15 | — (regression pin; app.js no longer defines it — assert `app.js` source does not contain `function tokenizeAsRefs`) | — |
| AC-16 | `public/tokens.css` is byte-identical to `docs/design/tokens/tokens.css` | T16 | M12: flip one byte in `public/tokens.css` (scratch copy) | T16 |
| AC-17 | `app.js` has exactly 9 `/\.href\s*=/g` matches and 0 `setAttribute('href'`; `copy-refs.js` and `leaf-refs.js` have 0 of either | T17 | M13: `node.href = ''` inside `copyRefNode` | T17 only — the AS-93 guard stays green (that green is the point: AC-17 is what stands between the chip and a link) |
| AC-18 | `index.html` links `/tokens.css` before `/style.css` and `<html>` carries `data-theme="light"` | T18 | M14: delete `data-theme="light"` | T18 |
| AC-19 | The `.copy-ref` rule blocks in `style.css` contain no `#hex` literal and no `px` literal (BRANDING §0) | T19 | M15: replace `var(--color-accent-bg-subtle)` with `#EFF2FD` | T19 |

Mutants: **15** (M1–M15), all with a predicted exact red set. Each is applied in a scratch copy
(preferred) or in place with backup + `trap` restore + `git diff --exit-code` afterwards, and the
mutation is asserted applied **at the intended site** (anchor patterns to the enclosing
function/regex name, per the 2026-09-10 sharpening). A survivor is a lead, not a line item:
re-read the mutated diff before calling the guard weak. M5's asymmetric red set is predicted,
not a surprise.

### 8b. Manual-check-verified (10 checks; recorded by the implementer in a Lattice comment
with browser and page origin named, and re-performed cold by QA)

| Check | Steps | Expected |
|---|---|---|
| C1 | In `#lattice-events`, click a chip such as the one on "merged 74cb6f9"; paste into the composer | pasted text is exactly the hash, nothing else |
| C2 | Same click, watch the chip | success colouring appears, clears on its own after about a second; a second click restarts it |
| C3 | Tab to a chip; press Enter; then Space | each copies (paste to verify); focus ring visible |
| C4 | Cmd/Ctrl-click and middle-click a chip | nothing copies, no navigation, no new tab |
| C5 | Drag-select across a sentence containing a chip, copy, paste | the chip's text is inside the selection |
| C6 | A hash inside a code span and inside `**bold**` | one chip look (no double border in code), bold preserved |
| C7 | A markdown link whose label contains a hash `[see e5a180a](https://example.test)` | no chip; the link navigates |
| C8 | DevTools: `Object.defineProperty(navigator, 'clipboard', { value: undefined })`, click a chip | the chip's text becomes selected; no "copied" state |
| C9 | OS dark mode on, reload | page and chip both light (the `data-theme` pin) |
| C10 | A branch name in `#engineering` (e.g. an AS-88 tick report) | one chip covering the whole `feat/AS-…` name; the `AS-n` inside it is not a separate link; a `AS-n` elsewhere in the same message still links |

Counts: 19 test-guarded + 10 manual = **29 criteria**; 15 mutants.

## 9. Predicted counts (baseline measured this tick on master `7b1f036`)

- Host `node --test` in `apps/chat`: **542 total / 541 pass / 0 fail / 1 skipped** (13.9 s).
- Compose `docker compose -p asc-plan-as115 run --build --rm test` with the `Image
  asc-plan-as115-test Built` receipt: **542 / 535 pass / 0 fail / 7 skipped**. Scratch project
  torn down (`down --rmi local`), no leftover containers.
- Predicted after AS-115: **+19** → host 561 / 560 / 1 skipped; compose 561 / 554 / 7 skipped.
- If AS-88 merges first (its lane predicts +8): host 569 / 568 / 1; compose 569 / 562 / 7. The
  implementer states which baseline they branched from and re-derives the number; a count
  other than baseline+19 is a finding.
- Compose skips stay at 7 (all pre-existing, none in the new files); a new skip is a finding.

Every counted run carries `--build` and a scratch `-p` (suggested `asc-impl-as115`,
`asc-review-as115`), by absolute docker path (`/usr/local/bin/docker`, via `node -e` +
`spawnSync` with `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1`); never project `asc-chat`.

## 10. Key files

| File | Change |
|---|---|
| `apps/chat/public/copy-refs.js` | NEW: `HASH_RE`, `HEX_WORDS`, `admitHash`, `BRANCH_RE`, `tokenizeHashes`, `tokenizeBranches` |
| `apps/chat/public/leaf-refs.js` | NEW: `tokenizeAsRefs` (moved from app.js 142–155), `tokenizeLeaf` composer |
| `apps/chat/public/app.js` | import both; delete local `tokenizeAsRefs`; `appendRefLeaf` (218–241) becomes a switch over `tokenizeLeaf`; add `copyRefNode`, `copyText`, `flashCopied`, `selectNode` near `fileRefLink` (189); comment block at 135–139 and 211–217 updated to the new order |
| `apps/chat/public/style.css` | `.copy-ref` rules after line 176 |
| `apps/chat/public/tokens.css` | NEW: verbatim copy of `docs/design/tokens/tokens.css` |
| `apps/chat/public/index.html` | tokens link before line 7; `data-theme="light"` on `<html>` |
| `apps/chat/test/copy-refs.test.js` | NEW: T1–T7, T17–T19 |
| `apps/chat/test/leaf-refs.test.js` | NEW: T8–T15 |
| `apps/chat/test/tokens-parity.test.js` | NEW: T16 |
| `apps/chat/README.md` | one paragraph under the body-rendering / ref-pipeline section: the new chain order, the chip, the tokens.css parity rule ("edit `docs/design/tokens/tokens.css`, then copy; the test enforces it") |

Note for the implementer: `server.js` line 40 imports `./public/org-chart.js` — `public/`
modules are shared with the server and must stay dependency-free and DOM-free. `copy-refs.js`
and `leaf-refs.js` follow that (they import only from `./markdown.js` and `./msg-refs.js`).
The AS-93 AC-9 scan counts `public/` files (`>= 10`); three new files there are fine and
contain no banned literal.

## 11. Staffing, branch, sequencing

- Implementer: `agent:developer-marcus` (Lena is on AS-88 in review; Marcus is free this tick).
  Commit early on the branch; keep a progress note in `scratchpad/agent-developer-marcus/AS-115/`.
- Reviewer: `agent:qa-ruben` — the seam with AS-98 and the parallel-lane rebase are his lane;
  Priya reviews AS-88 next tick. Whoever reviews must not be told the mutant results; they take
  their own (M3 scratchpads).
- Branch: `feat/AS-115-copy-refs`, worktree `.worktrees/AS-115`, cut from the master current at
  implementation start (state the head in the first commit message).
- Order: after AS-98 if AS-98 is already `in_progress` when this reaches implementation is NOT
  required — the two can run in parallel lanes; §7 rules the merge order.

## 12. Open questions (time-boxed; default applies when the box expires)

| Q | Question | Default | Box |
|---|---|---|---|
| Q1 | Should a 16-hex build id (`cb92cbbb2c37d4a8`) chip? It does under the rule as written. | Yes — copyable and harmless; revisit only if the board says the chips are noisy. | Decided now; note in review if C1-type usage shows otherwise |
| Q2 | Announce the copy to screen readers (an `aria-live` region)? | Not in v1; `title` flips to "Copied". Add if an accessibility pass asks. | Closed at planning |
| Q3 | Should the branch inside `origin/feat/…` really chip without `origin/`? | Yes: the thing you paste into `git checkout` / `git diff master...` is the bare branch name. | Closed at planning |
| Q4 | Adopting `tokens.css` app-wide. | Out of scope; this task proves the parity mechanism. A follow-up task, if anyone wants it, is a Chat-set task of its own. | Closed at planning |
| Q5 | Should `<button>` be used instead of `role="button"` span? | Span, for the selection and inline-flow reasons in §5. If C5 fails with the span (selection excludes it), the implementer switches to `<button>` with `user-select: text` and says so — that is an implementation-level finding, not a plan change. | Implementer decides during C5 |

## Reset 2026-09-11 by human:forrest
