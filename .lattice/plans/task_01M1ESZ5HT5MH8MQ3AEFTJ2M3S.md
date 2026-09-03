# AS-54: Chat: autolink bare http/https URLs in message bodies

Plan by `agent:cto-owen`, 2026-09-03, at `5994d6d`. Implementer: `agent:developer-marcus`.
Complexity: **low**. The decisions below are load-bearing; the code is small.

Board request, verbatim (DM msg 367, 2026-09-01): *"urls in chat messages should
resolve to links, like http://127.0.0.1:8348/ should be clickable"*. Today only
markdown-style `[label](https://…)` links work; bare URLs render as literal text.

---

## 1. Scope

**In scope.** A new pure tokenizer pass that finds bare absolute `http://` /
`https://` URLs in message-body plain-text leaves and emits `url` tokens; an
anchor branch in `app.js` that renders them; tests; one README paragraph.

**Not in scope, and each for a reason:**

- **Scheme-less `www.` guessing, `mailto:`, `ftp:`.** The board asked for URLs
  that are already URLs. Guessing turns every `www.` in prose into a link and has
  no allowlist story.
- **Truncating or eliding long link text.** See §3.6.
- **Fixing the *pre-existing* nested anchors** that AS-refs / msg-refs /
  file-refs already build inside markdown-link inners (`app.js:223`, since
  AS-26). Real, unrelated to this change, and fixing it would silently change
  three shipped features under a URL task. Recorded in §10.
- **Server, store, exports, CLI, `STATIC_FILES`.** None are touched — see §3.7.

## 2. File-level scope

Exactly five files. Anything outside this list is out of scope for AS-54.

| File | Change |
|---|---|
| `apps/chat/public/markdown.js` | add `URL_RE`, `trimUrlTail()`, `tokenizeUrls()`; update header comment |
| `apps/chat/public/app.js` | `urlLink()`; `appendRefLeaf` gains the url pass + an `{ autolink }` option; two comment updates |
| `apps/chat/test/markdown.test.js` | 8 new tests (§5) |
| `apps/chat/test/api.test.js` | 1 new served-app.js guard test (§5) |
| `apps/chat/README.md` | one paragraph in the inline-markdown section |

Not a protected top-level file among them, so no metawork handoff (§9).

## 3. Design

### 3.1 What counts as a bare URL

This is the whole difficulty, and it is judgement, not regex-hunting. I pulled
the actual corpus first: **13 URL occurrences** across the chat DB (all
channels, `sqlite3 …?mode=ro`). Trailing-character histogram of a greedy
`https?://\S+` match: `/` ×4, letters ×4, `,` ×2, `.` ×1, `)` ×1. Every
punctuation case in the rules below is a case that has actually occurred here.

**Rule A — candidate.** `https?://` followed by one character from
`[A-Za-z0-9]`, then a run of `[^\s<>"'` + backtick + `\]`.

- The **host must start alphanumeric**. This is what makes the placeholder idiom
  `https://…` (2 occurrences in the corpus, e.g. *"markdown links
  `[label](https://…)` already work"*) stay literal instead of becoming a dead
  link. It also guarantees the trim in Rule B can never eat into the scheme
  (§3.2).
- **Excluded from the body, with reasons rather than habit:** whitespace (ends
  every URL); `<` `>` (not valid URL characters, and the `<http://x>` delimiter
  idiom); `"` (not valid; attribute-delimiter shape); `'` (legal in a URL but
  vanishingly rare, and the corpus contains `'(see http://x/)'` where it is a
  quote); backtick (code-span delimiter, and this pass runs on code inners);
  `\` (browsers historically fold `\` to `/` in the authority, so
  `http://good.example\@evil.example/` is a classic host-confusion string —
  stopping the candidate at `\` yields `http://good.example`, the honest host).

**Rule B — where the URL ends.** A fixed-point loop that only ever *shortens*
the candidate. Each iteration removes **one** trailing character if either:

- it is sentence punctuation — `.` `,` `;` `:` `!` `?` — **always stripped**; or
- it is a closing bracket — `)` `]` `}` — **and that bracket kind is unbalanced
  in the candidate** (count of closers > count of openers).

It stops when neither applies. Because each iteration deletes a character, it
terminates.

What a person writing in this chat expects, case by case:

| Written | URL is | Why |
|---|---|---|
| `…server.js → http://127.0.0.1:8347. Agents:` | `http://127.0.0.1:8347` | Corpus. Full stop ends the sentence, not the address. |
| `('lattice dashboard', http://127.0.0.1:8799), which` | `http://127.0.0.1:8799` | Corpus. Loop strips `,` then the now-trailing `)` (0 opens, 1 close). Both classes in one tail is why this is a loop and not an ordered two-pass. |
| `'(see http://x/)'), runs inside` | `http://x/` | Corpus. `'` ends the candidate; the `)` is unbalanced. The opening `(` is *outside* the URL — the reader's paren, not the address's. |
| `…/wiki/Foo_(bar) for more` | `…/wiki/Foo_(bar)` | The one case where a trailing `)` is kept: 1 open, 1 close, balanced. This is the idiom the board's own description called out. |
| `…/wiki/Foo_(bar)) for more` | `…/wiki/Foo_(bar)` | 1 open, 2 closes: strip one, then balanced. |
| `is it http://x/? yes` | `http://x/` | A bare trailing `?` is an empty query — meaningless as an address, and unambiguous as punctuation. |
| `ends here: http://x/a,b, ok` | `http://x/a,b` | Interior commas survive; only the trailing run is trimmed. |

**Cost, stated honestly:** a URL that genuinely ends in `.` `,` `;` `:` `!` `?`
or an unbalanced closer loses that character. Those URLs are essentially
nonexistent in prose and, when they occur, a markdown link is the escape hatch
that already works. Trimming is the right default because the failure is
visible and recoverable (a slightly short link), while not trimming fails
invisibly (a link that 404s because it has a full stop glued on).

**Round-trip invariant.** Concatenating token texts reproduces the input
byte-for-byte — the trimmed tail goes back into the following text token.

### 3.2 Scheme allowlist

**`http://` and `https://`, lowercase, and nothing else** — byte-identical to
the allowlist already in the `link` pattern in `markdown.js:18`. The answer is
the same as markdown's on purpose: the two paths from message text to an anchor
must not disagree about what a link is, because a divergence between them is
precisely the bug class this task can introduce.

A bare `javascript:alert(1)`, `data:text/html,…`, `vbscript:…` or `file://…`
produces **no token at all** — the regex never matches, so there is nothing to
reject and no post-hoc check to forget. The allowlist lives in the pattern, as
the task's implementer note requires.

**The trim cannot defeat the allowlist**, and this is structural rather than
probabilistic: Rule A guarantees the character immediately after `://` is
`[A-Za-z0-9]`, Rule B removes only punctuation, so the shortest string the
trimmer can ever return is `https://X` — it can never reach the scheme, and it
can never *lengthen* or *move* the match. Nothing between the regex and the
`href` transforms the string.

Enforced against drift by an executable **parity test** (§5 AC-5) that runs the
same scheme matrix through `tokenizeInline` and `tokenizeUrls` and asserts they
agree. Two regex literals with one shared test beats one shared regex fragment
composed by `new RegExp` — the test is the guarantee, and the literals stay
readable.

### 3.3 Pass order, and what it guarantees

`appendRefLeaf` runs pure passes over plain-text leaves in a fixed order, today
AS-refs → msg-refs → file-refs. **The URL pass goes first**, making the order
**URL → AS-refs → msg-refs → file-refs**, and url tokens are *terminal* — their
text is never fed to any other pass.

This is not tidiness. I measured all three collisions on the tree at `5994d6d`:

| Input | Today | Cause |
|---|---|---|
| `https://example.com/?f=README.md` | `tokenizeFileRefs` emits a `fileref` for `README.md` | `FILE_RE`'s lookbehind `(?<![A-Za-z0-9._/-])` excludes `/`, so path-position `.md` is safe — but `=` is not in the set, so **query-position `.md` is not**. |
| `http://127.0.0.1:8347/msg156` | `tokenizeMsgRefs` emits a `msgref` for `msg156` | `HEAD_RE`'s `\s*#?\s*` matches empty, so `msg156` is a reference. (`…/api/message/156` is safe — `/` is not `\s`.) |
| `https://ci.example.com/job/AS-26/build` | `tokenizeAsRefs` matches `AS-26` | `\bAS-26\b` holds between two `/`. Fires whenever `AS-26` resolves on that message. |

So the description's "its lookbehind should already reject path segments inside
URLs" is **half true** and the half that is false is the one that matters. See
§10.

**The guarantee, stated precisely:** *no pass other than the URL pass can ever
observe text lying inside an autolinked URL's source slice*, because the URL
pass runs first over the whole leaf and its output is terminal. That replaces
three separate "these patterns probably don't collide" arguments with one
structural fact — and it stays true for ref patterns not yet written.

**The converse also holds:** the URL pass cannot steal a ref that lies outside a
URL, because `URL_RE` anchors on a literal `http://`/`https://`, which no
AS-ref, msg-ref or file-ref can contain.

**The AS-before-msg invariant recorded at `app.js:117` is preserved** — the new
pass is inserted before the existing chain, not interleaved into it.

Verified: composing the three passes in this order over
`q https://example.com/?f=README.md z see README.md too` yields exactly one url
token and one fileref — the query-string one suppressed, the genuine one intact.

### 3.4 Markdown links: double-linking is impossible

Two mechanisms, both structural:

1. **A markdown link's `href` is never a plain-text leaf.** `tokenizeInline`
   consumes `[label](https://x)` whole and emits `{type:'link', inner, href}`;
   `bodyNode` calls `appendRefLeaf(a, tok.inner, refs)` — the **inner**, never
   the href. The href string never reaches any pass. Nothing to de-duplicate.
2. **A markdown link's *label* can contain a URL** (`[https://x](https://y)`),
   and today `appendRefLeaf` would run the url pass on it and append an `<a>`
   inside the `<a>`. Mechanism: **`appendRefLeaf` gains a fourth parameter
   `{ autolink = true } = {}`, and the md-link call site at `app.js:223` passes
   `{ autolink: false }`.** When false the pass is *not called at all* — so
   there is no code path on which an anchor can be constructed inside a
   markdown-link anchor. Not "unlikely": unreachable.

Skipping the pass and "rendering as plain text there" are the same output,
because `tokenizeUrls` round-trips; skipping is one branch instead of two, so
skip.

### 3.5 The rendered element

```js
function urlLink(tok) {
  const a = el('a', 'md-link', tok.text);   // el() sets textContent
  a.href = tok.href;                        // verbatim slice — no normalizing
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
```

- **Class `md-link`**, reused: an autolinked URL and a markdown link are the same
  thing to a reader — external navigation — so they get the same affordance and
  this change adds no CSS.
- **`target="_blank"` / `rel="noopener"`**: exact parity with the md-link branch
  at `app.js:216-221`. (`noreferrer` is an app-wide question, §8 Q2.)
- **No `href` transformation.** No `encodeURI`, no `decodeURIComponent`, no
  `new URL()` round-trip, no normalization. The href is the matched slice.
- **The structure-first rule is the safety property, and it is not weakened
  here.** There is no client-side escaping step to fall back on and no
  sanitizer; safety comes from tokenizers that emit only text and structure and
  from DOM built with `el()`/`createTextNode`. This branch adds no `innerHTML`,
  no `insertAdjacentHTML`, no `setAttribute` of an event handler, and no
  attribute whose value is not either a constant or a `^https?://`-anchored
  slice.

### 3.6 Link text for a very long URL

**The full URL, never truncated.** Three reasons: truncation breaks the
round-trip property every other token in this pipeline has, and that property is
the one QA can actually execute; people copy URLs out of this chat constantly
and a truncated label copies as a broken URL; and wrapping is a CSS problem that
is *already solved* — `.message .body` carries `white-space: pre-wrap;
word-wrap: break-word` (`style.css:129`), so the corpus's longest URL (a 68-char
`claude.ai/code/artifact/…`) wraps rather than overflowing. **No CSS change.**

### 3.7 Where the code goes

`tokenizeUrls` goes in **`apps/chat/public/markdown.js`**, not a new module and
not `msg-refs.js`.

- Not `msg-refs.js`: in this app's vocabulary a *ref* resolves against app state
  (a task id, a message id, a repo path) and its anchor carries an in-app click
  handler. A URL is external navigation with a plain `href` — a markdown link
  without the brackets.
- Not a new file: a new `public/*.js` costs a `STATIC_FILES` entry in
  `server.js`, a serve-check in `api.test.js`, and a new test file, all to hold
  ~40 lines. Putting it beside the `link` pattern it must agree with removes
  that overhead **and** puts the two scheme allowlists in one screen.

Consequence: `server.js`, `STATIC_FILES` and the module-serving tests are
untouched; `app.js` already imports from `./markdown.js`.

### 3.8 Reference implementation

Validated by a throwaway spike before this plan was written (§6 evidence).
Marcus may deviate if every acceptance criterion in §5 still holds.

```js
// Bare absolute URL (AS-54). Same http/https-only allowlist as the `link`
// pattern above — the two paths from message text to an anchor must not
// disagree about what a link is. The host must start alphanumeric, which
// keeps the `https://…` placeholder idiom literal and guarantees the tail
// trim below can never reach the scheme.
const URL_RE = /https?:\/\/[A-Za-z0-9][^\s<>"'`\\]*/g;

const SENTENCE_TAIL = '.,;:!?';
const BRACKETS = [['(', ')'], ['[', ']'], ['{', '}']];
const count = (s, ch) => { let n = 0; for (const c of s) if (c === ch) n++; return n; };

/** Shrink a candidate to where a human would say the URL ends: trailing
 *  sentence punctuation is prose, and a trailing closer belongs to the URL
 *  only when its opener is inside it. Only ever shortens; terminates. */
function trimUrlTail(s) {
  for (;;) {
    const last = s[s.length - 1];
    if (SENTENCE_TAIL.includes(last)) { s = s.slice(0, -1); continue; }
    const pair = BRACKETS.find(([, close]) => close === last);
    if (pair && count(s, pair[1]) > count(s, pair[0])) { s = s.slice(0, -1); continue; }
    return s;
  }
}

/**
 * Tokenize a plain-text leaf into text and url tokens for bare absolute URLs.
 * Token `text` is the exact source slice and `href` is identical to it — no
 * normalizing, no decoding. Runs on code-span inners too (a backticked URL is
 * a standing idiom here), matching the file-ref precedent.
 */
export function tokenizeUrls(text) {
  const src = String(text ?? '');
  const tokens = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(src)) !== null) {
    const url = trimUrlTail(m[0]);
    if (m.index > last) tokens.push({ type: 'text', text: src.slice(last, m.index) });
    tokens.push({ type: 'url', text: url, href: url });
    last = m.index + url.length;
    URL_RE.lastIndex = last;  // REQUIRED: the trim shortened the match, and
                              // lastIndex must follow it or the tail is skipped.
  }
  if (last < src.length) tokens.push({ type: 'text', text: src.slice(last) });
  return tokens;
}
```

And in `app.js` (the whole behavioural diff):

```js
function appendRefLeaf(parent, text, refs, { autolink = true } = {}) {
  for (const u of autolink ? tokenizeUrls(text) : [{ type: 'text', text }]) {
    if (u.type === 'url') { parent.appendChild(urlLink(u)); continue; }
    for (const seg of tokenizeAsRefs(u.text, refs)) {
      /* …existing body, unchanged, reading seg… */
    }
  }
}
```

with the single call-site change at `app.js:223`:
`appendRefLeaf(a, tok.inner, refs, { autolink: false })`.

## 4. Key files

**Literals that move:**

| File | Literal | Before → After |
|---|---|---|
| `apps/chat/public/markdown.js` | `https?:\/\/` | 1 → 2 occurrences (`link` pattern at line 18; new `URL_RE`) |
| `apps/chat/public/markdown.js` | `tokenizeUrls` | 0 → present (exported) |
| `apps/chat/public/app.js` | `appendRefLeaf(` | 4 → 4 (1 definition + 3 calls; **no new call sites**) |
| `apps/chat/public/app.js` | `{ autolink: false }` | 0 → 1 (line ~223 only) |
| `apps/chat/public/app.js` | `urlLink` | 0 → 2 (definition + one call) |
| `apps/chat/test/markdown.test.js` | top-level `test(` | 10 → 18 |
| `apps/chat/test/api.test.js` | top-level `test(` | 25 → 26 |

**Explicitly not moving** (a diff touching any of these is out of scope):

- `apps/chat/public/msg-refs.js` — `HEAD_RE`, `CONT_RE`, `FILE_RE` unchanged.
  The query-position `FILE_RE` collision is *neutralised by pass order*, not by
  editing `FILE_RE`; widening that lookbehind would change file-ref behaviour
  outside URLs too.
- `apps/chat/public/markdown.js` `PATTERNS` — stays at 5 entries. The bare-URL
  pass is **not** an inline pattern: `tokenizeInline` runs over the whole body
  before leaves exist, and adding it there would autolink inside markdown-link
  hrefs.
- `apps/chat/public/style.css` — §3.6.
- `apps/chat/server.js` / `STATIC_FILES` — §3.7.
- `apps/chat/public/app.js` `appendInlineToken` (the file viewer, line ~708) —
  viewer content deliberately gets no ref passes; unchanged.
- Server, store, export, CLI, compose, Dockerfile.

## 5. Acceptance criteria

Test names are **mandated verbatim** — §6 recipes name them, and a renamed test
silently voids a falsification recipe.

In `apps/chat/test/markdown.test.js`:

1. **`urls: bare http/https autolink — the corpus cases from chat history`** —
   the seven §3.1 table rows plus `http://localhost` and the 68-char
   `claude.ai` URL. Each asserts the url token text **and** round-trip.
2. **`urls: trailing sentence punctuation stays literal text`** — `.` `,` `;`
   `:` `!` `?` each trailing and each interior; interior commas survive.
3. **`urls: closing brackets belong to the URL only when balanced`** —
   `Foo_(bar)` kept, `…8799)` stripped, `Foo_(bar))` stripped-to-balanced, and
   the `]` and `}` equivalents.
4. **`urls: scheme allowlist — non-http(s) schemes never produce a url token`** —
   `javascript:`, `JaVaScRiPt:`, `data:`, `vbscript:`, `file://`, `ftp://`,
   `mailto:`, bare `www.example.com`, `https://` alone, `http://.`,
   `https://…` all yield zero url tokens and round-trip.
5. **`urls: scheme parity — bare URLs and markdown links accept the same schemes`** —
   one scheme matrix driven through both `tokenizeInline` (as
   `[x](SCHEME://h/)`) and `tokenizeUrls` (as `SCHEME://h/`); accepted sets are
   asserted equal.
6. **`urls: href is a verbatim source slice; round-trip holds over a fuzz corpus`** —
   ≥50,000 generated inputs from a punctuation-heavy alphabet salted with
   `http://` and `https://` **and with `ftp://`, `file://`, `javascript://`,
   `data://`** (the non-http salt is load-bearing — without it this test cannot
   see a broken scheme allowlist; see F1). For every input: token texts concatenate to the input,
   each token's text equals the source at its running offset, and for every url
   token `href === text`, `/^https?:\/\/[A-Za-z0-9]/` holds, and the href
   contains no whitespace, `<`, `>`, `"`, `'`, backtick or `\`. **Assert the
   corpus was non-trivial** — the run must report ≥10,000 url tokens examined,
   so a generator that stops producing URLs fails loudly instead of passing
   vacuously.
7. **`urls: pass order — refs inside a URL are never linkified; refs outside still are`** —
   composes `tokenizeUrls` → `tokenizeMsgRefs` → `tokenizeFileRefs` in the
   `appendRefLeaf` order over the three §3.3 collision inputs plus
   `q https://example.com/?f=README.md z see README.md too` and
   `q http://127.0.0.1:8347/msg156 z see msg 12 too`; asserts exactly one url
   token and zero refs inside it, **and** that the genuine trailing ref outside
   the URL still resolves. Includes the description's
   `https://github.com/x/blob/main/README.md` → one url token, zero filerefs.
8. **`urls: junk-tolerant on non-strings and empty input`** — `null`,
   `undefined`, `42`, `''` (matches the existing junk-tolerance convention).

In `apps/chat/test/api.test.js`:

9. **`api: AS-54 — served app.js autolinks through markdown.js and never inside a markdown link`** —
   over the app.js the server actually serves: it imports `tokenizeUrls` from
   `./markdown.js`; `appendRefLeaf(a, tok.inner, refs, { autolink: false })`
   is present verbatim; the `tokenizeUrls(` call inside `appendRefLeaf` occurs
   **before** the `tokenizeAsRefs(` call (index comparison — the pass-order
   guarantee of §3.3); `urlLink` sets `a.href = tok.href` with no transformation;
   and `.innerHTML` does not appear.

10. **Suite green.** `cd apps/chat && node --test` → **203 tests, 203 pass, 0
    fail** (baseline 194 + 8 new tokenizer tests + 1 new api test). Any
    *pre-existing* test that changes state is a finding, not something to fix
    in passing.
11. **README.** `apps/chat/README.md`'s inline-markdown section gains a short
    paragraph stating: bare `http://`/`https://` URLs autolink; the trailing
    punctuation and balanced-bracket rules in one sentence each; other schemes
    stay literal; and that the URL pass runs first among the leaf passes.
12. **No new dependency.** `apps/chat/package.json` unchanged; the app stays
    zero-dependency.

## 6. Falsification recipes

**Evidence already in hand.** The §3.8 implementation was spiked before this
plan and run against (a) all 25 §3.1/§3.3 cases — every one produced the
tabulated result with round-trip intact; (b) the composed pass order — the
query-string `README.md` and path `msg156` collisions suppressed, genuine refs
outside the URL intact; (c) a 200,000-input fuzz producing **81,213 url tokens**
with **0 violations** of round-trip, slice-identity, href-identity, scheme, or
charset. AC-6 re-runs (c) as a permanent test at a lower bound.

**Baselines, measured at `5994d6d` on 2026-09-03. Every command below was run
before the number was written down.**

| Command (from repo root) | Baseline |
|---|---|
| `grep -oF '.innerHTML' apps/chat/public/app.js \| wc -l` | `0` |
| `grep -oF 'innerHTML' apps/chat/public/app.js \| wc -l` | `2` |
| `grep -oF 'appendRefLeaf(' apps/chat/public/app.js \| wc -l` | `4` |
| `grep -oF '{ autolink: false }' apps/chat/public/app.js \| wc -l` | `0` |
| `grep -oF 'https?:\/\/' apps/chat/public/markdown.js \| wc -l` | `1` (line 18) |
| `grep -oF '[a-z]+:\/\/' apps/chat/public/markdown.js \| wc -l` | `0` |
| `grep -roF 'tokenizeUrls' apps/chat \| wc -l` | `0` |
| `grep -oE '^test\(' apps/chat/test/markdown.test.js \| wc -l` | `10` |
| `grep -oE '^test\(' apps/chat/test/api.test.js \| wc -l` | `25` |
| `cd apps/chat && node --test` | `tests 194, pass 194, fail 0` |

Three counting traps, recorded because I hit two of them taking these numbers:

- **`grep -c` counts lines, `grep -oF … | wc -l` counts occurrences.** Only the
  latter is valid here.
- **Bare `innerHTML` is 2, `.innerHTML` is 0.** The two are both in comments
  (`app.js:2` and `app.js:207`). A recipe that greps the bare word will read a
  clean file as a violation. Grep `.innerHTML`.
- **Do not wrap these greps in `eval`.** My first pass ran them through an
  `eval` helper and the `\/` escapes were consumed by the extra shell round,
  reporting `https?:\/\/` as `0` when it is `1`. Run each command literally.
  (`wc -l` prints `0` on no match while `grep` exits 1 — a `set -e` script will
  abort; use `|| true`.)

**Mutation procedure.** Prefer a scratch copy — `cp -R apps/chat "$SCRATCH/mut"`
and mutate there; the task worktree is never touched, and no restore can fail.
If a mutation must happen in place: back up, `trap` the restore on `EXIT`,
mutate, **assert the mutation applied** (an unapplied mutation is
indistinguishable from a passing checker), observe, let the trap restore, prove
the tree with `git diff --exit-code`, then re-run the suite clean.

---

**F1 — the scheme allowlist is load-bearing, not decorative.**
Mutate `URL_RE` in `markdown.js`: `https?:\/\/` → `[a-z]+:\/\/`.
*Assert applied:* `grep -oF '[a-z]+:\/\/' public/markdown.js | wc -l` → **1**
(baseline `0`), and `grep -oF 'https?:\/\/' public/markdown.js | wc -l` → **1**
(baseline `2` after the change — the `link` pattern's copy survives).
*Predicted failing set:* exactly these three —
`urls: scheme allowlist — non-http(s) schemes never produce a url token`,
`urls: scheme parity — bare URLs and markdown links accept the same schemes`,
and `urls: href is a verbatim source slice; round-trip holds over a fuzz corpus`.
*Verified against the spike:* under this mutation `file://etc/passwd` and
`ftp://h/` become url tokens, and the accepted-scheme sets diverge
(`bare = [http, https, ftp, file, javascript, data, vbscript, mailto]` vs
`md = [http, https]`). The corpus, punctuation, bracket and pass-order tests
**pass** under F1 — they never look at the scheme. A wider or narrower observed
set is itself a finding.

**F2 — attempt to get markup or a live handler out of a message body.**
No mutation; an adversarial corpus driven through the real tokenizer.
Feed at least these through `tokenizeUrls` and, for every emitted url token,
assert `/^https?:\/\/[A-Za-z0-9]/` and that the href contains none of
whitespace `<` `>` `"` `'` backtick `\`:

```
javascript:alert(1)
JaVaScRiPt:alert(1)
 java\tscript:alert(1)                 (literal tab)
data:text/html,<script>alert(1)</script>
vbscript:msgbox(1)
http://x/" onmouseover="alert(1)
http://x/'><img src=x onerror=alert(1)>
http://x/</a><a href="javascript:alert(1)">click
<http://x/>
http://x/#<script>
http://x/?q=%3Cscript%3E
http://x/%00
http://good.example\@evil.example/
ｈｔｔｐ://fullwidth.example/           (fullwidth letters)
http://x/ javascript:alert(1)
`http://x/`</a>
```

*Expected:* the first five produce **zero** url tokens; the rest produce at most
one url token whose href stops before the first excluded character; every input
round-trips.
*What this establishes:* the tokenizer boundary — the only thing that can ever
become an `href` is an `^https?://`-anchored verbatim slice free of markup
characters. *What it does not establish:* runtime DOM behaviour (see F3 and the
§8 honesty note).

**F3 — the `autolink: false` guard is not vacuous.**
Mutate `app.js:~223`: delete `, { autolink: false }`.
*Assert applied:* `grep -oF '{ autolink: false }' public/app.js | wc -l` → **0**
(baseline after the change: `1`).
*Predicted failing set:* exactly
`api: AS-54 — served app.js autolinks through markdown.js and never inside a markdown link`.
*Second half of the same recipe:* swap the `tokenizeUrls(` and `tokenizeAsRefs(`
lines in `appendRefLeaf`. Assert applied with
`node -e "const s=require('fs').readFileSync('apps/chat/public/app.js','utf8'); const a=s.indexOf('tokenizeUrls('), b=s.indexOf('tokenizeAsRefs('); if(!(a>b)) process.exit(1)"`
(exit 0 means the swap took). Same single predicted failure.
*Honesty:* F3 is **lexical**. It pins the text of the file the server serves; it
does **not** execute `bodyNode`. It cannot prove the browser builds no nested
anchor. See §8 Q6.

**F4 — pass order is load-bearing.**
Mutate `URL_RE` so the match stops at the first `/` after the host: add `\/` to
its excluded set, i.e. the source text `\\]*` becomes `\\\/]*`.
*Assert applied:* `grep -oF '\/]*' apps/chat/public/markdown.js | wc -l` → **1**
(baseline `0`, measured; `\\]*` is likewise `0` before the change and `1`
after it).
*Predicted failing set:* exactly these four —
`urls: bare http/https autolink — the corpus cases from chat history`,
`urls: trailing sentence punctuation stays literal text`,
`urls: closing brackets belong to the URL only when balanced`, and
`urls: pass order — refs inside a URL are never linkified; refs outside still are`.
Four, not one: the truncation is visible to every test that asserts the full
text of a URL with a path, so a run where only the pass-order test fails means
the other three are not actually asserting full URL text.
**The fuzz test does NOT fail here, and predicting that it will is a trap I fell
into while writing this plan.** Truncated URLs still round-trip, are still
verbatim slices, still satisfy `^https?://[A-Za-z0-9]`, and still contain no
excluded character — the invariants are all preserved by a *shorter* match.
Measured on the mutated spike: 19,404 url tokens, 0 violations. The scheme and
parity tests also pass. This is the difference between a property test and a
behaviour test, and it is why AC-1/2/3 exist alongside AC-6.

**After every mutation:** restore, `git diff --exit-code` (or delete the scratch
copy), re-run `cd apps/chat && node --test` and confirm the AC-10 count and `0
fail`. Record the observed failing set beside the predicted one; a mismatch in
either direction is a review finding.

## 7. Size and complexity

**Low**, and it should stay low.

| File | Approx. lines |
|---|---|
| `public/markdown.js` | +40 |
| `public/app.js` | +14, ~4 modified |
| `test/markdown.test.js` | +100 |
| `test/api.test.js` | +15 |
| `README.md` (apps/chat) | +8 |
| **Total** | **~180, of which ~55 are production code** |

One implementation pass; no rework expected. The design is spiked, the
collisions are measured, and the decisions are made here rather than left open.
If the implementer finds themselves adding a sanitizer, an `innerHTML`, a URL
normalizer, a new `public/*.js`, or a change to `msg-refs.js` — that is
plan-level rework, not a judgement call. Stop and say so.

## 8. Open questions, with defaults

Every one has a default; none blocks implementation. Time-box: they are settled
as written unless the reviewer or the board objects on this task.

- **Q1 — uppercase schemes (`HTTP://EXAMPLE.COM/`).** *Default: not matched*, in
  parity with `markdown.js`. All 13 corpus occurrences are lowercase, and
  divergence between the two link paths is a worse bug than a missed uppercase
  URL. Revisit if one ever appears.
- **Q2 — `rel="noreferrer"`.** *Default: no* — parity with the three existing
  anchors. Adding it is an app-wide decision touching 3 call sites; separate
  task if the board wants referrer suppression.
- **Q3 — IPv6 literals (`https://[::1]:8347/`) and literal-IDN hosts
  (`https://例え.jp`).** *Default: not matched* — Rule A requires an
  alphanumeric first host character. Zero corpus occurrences; punycode
  (`xn--…`) still works. Revisit on a real report.
- **Q4 — apostrophes in URLs.** *Default: candidate stops at `'`.* Corpus
  evidence (`'(see http://x/)'`) favours the quote reading; real sites
  percent-encode `%27`.
- **Q5 — should the *existing* ref passes also be suppressed inside markdown-link
  labels** (making all nested anchors impossible)? *Default: no* — it would
  regress three shipped features under a URL task. §10.
- **Q6 — DOM-level testing.** There is no jsdom/happy-dom and the app is
  deliberately zero-dependency, so `bodyNode`/`appendRefLeaf`/`urlLink` cannot
  be executed in `node --test`. *Default: do not add one.* The split is stated
  plainly rather than papered over: the **tokenizer** properties (scheme,
  href-is-a-verbatim-slice, round-trip, boundaries, cross-pass composition) are
  **executed**; the **DOM assembly** is verified by a lexical guard on the
  served `app.js` (AC-9) **plus inspection of a five-line function**. Adding
  jsdom to close this is a real decision with a real cost — it belongs to a
  separate task with the board's dependency-approval, not to a low-complexity
  autolink change.

## 9. Metawork wording

**None required.** All five files in §2 are employee-owned; `apps/chat/README.md`
is not among the protected top-level markdown files (`CLAUDE.md`, `README.md`,
`PHILOSOPHY.md`, `agents.md`), so the implementer edits it directly.

## 10. Stale items and corrections to the record

1. **The task description's claim that `FILE_RE`'s lookbehind "should already
   reject path segments inside URLs" is half wrong.** Measured at `5994d6d`: true
   in path position (`https://github.com/x/blob/main/README.md` → zero
   filerefs), **false in query position** — `https://example.com/?f=README.md`
   yields a `fileref` for `README.md` today, because `=` is not in
   `(?<![A-Za-z0-9._/-])`. This is the case that makes URL-first mandatory
   rather than merely tidy. AC-7 pins it.
2. **Two more collisions exist that the description does not list.** `HEAD_RE`'s
   `\s*#?\s*` matches the empty string, so `http://127.0.0.1:8347/msg156`
   yields a `msgref` for `msg156`; and `\bAS-26\b` matches inside
   `https://ci.example.com/job/AS-26/build` whenever `AS-26` resolves on that
   message. Same fix (pass order), same test (AC-7).
3. **Nested anchors are pre-existing, not introduced here.** `app.js:223` has
   called `appendRefLeaf` with an `<a>` parent since AS-26, so an `AS-26`, `msg
   5` or `README.md` inside a markdown-link label already builds an `<a>` inside
   an `<a>`. The description frames the nested-anchor hazard as new to this
   task; it is not. AS-54 makes the URL case impossible (§3.4) and deliberately
   leaves the other three alone (§8 Q5). Worth a follow-up task if the board
   wants it; not this one.
4. **`msg-refs.js` is now misnamed** — it holds file refs too, and the ref/link
   distinction drawn in §3.7 is the reason `tokenizeUrls` does not join it.
   Cosmetic; noted, not acted on.

## Reset 2026-09-03 by agent:cto-owen
