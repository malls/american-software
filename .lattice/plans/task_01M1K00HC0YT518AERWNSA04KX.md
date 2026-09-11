# AS-72: Chat: an AS-25 guard has the vacuous shape AS-54 was failed for, plus three boundary findings

Plan by agent:cto-owen, 2026-09-11T05:43Z, against master 3398238 (host `node --test` baseline 423/423 at 05:28Z). Written in an 11-minute box; §7 lists what the implementer must re-derive rather than take from here.

## 1. The four findings, re-read against today's master

| # | Finding (my words, after reading the code) | Still true on master? |
|---|---|---|
| 1 | `apps/chat/test/api.test.js` ("api: AS-25 — live.js is served …; the 5s poll is retired") parses the served `app.js` with `/setInterval\(([\s\S]*?),\s*([\d_]+)\)/g`. The lazy body match stops at the **first** `, <digits>)` after `setInterval(`, wherever it is — so any call of that shape *inside* an interval body (a nested `setTimeout(fn, 60_000)`) becomes "the cadence" and the real cadence is skipped over. The guard asserts a member's presence (one fetching interval ≥30 s) rather than the region's complete contents. | **Yes.** Same regex, same file. AS-99 added a third render call to the 15 s body (`renderLanesBadge`, `renderLanes`, `public/app.js:1557-1561`) but did not change the timer count (still exactly two, lines 1547 and 1557). |
| 2 | `markdown.test.js` "urls: href is a verbatim source slice; round-trip holds over a fuzz corpus": every `SALT` is emitted as `SALT + CHUNK`, and all 11 `CHUNK` values begin `[A-Za-z0-9]`, so the assertion `assert.match(t.href, /^https?:\/\/[A-Za-z0-9]/)` (line 280) is never exercised — the generator cannot produce `http://` followed by a non-alnum. | **Yes**, verbatim at lines 254-266. AS-99 did not touch this file. |
| 3 | Boundary rule for U+2013 (en dash) and U+2026 (ellipsis): `URL_RE = /https?:\/\/[A-Za-z0-9][^\s<>"'`\\]*/g` (`public/markdown.js:120`) admits both into the URL, and `trimUrlTail` only strips `SENTENCE_TAIL` ASCII and unbalanced closers. Corpus: en dash glued-left 62/62, ellipsis 52/63, em dash spaced 954/955. No rule was ever decided. | **Yes**, undecided; code unchanged. |
| 4 | 71 invisible/format code points (Cf: ZWSP, ZWJ, bidi controls, U+FEFF, …) pass the exclusion class, so href and visible text can differ invisibly. `\s` already excludes Unicode *spaces*; the residual is General_Category **Cf**. | **Yes**, undecided; code unchanged. |

## 2. Decisions (findings 3 and 4 are decisions first)

- **D3 — trailing typographic punctuation is prose.** Add `– — …` to the tail-trim set (same rule as `.`/`,`): trimmed only at the **tail**, never mid-URL (Wikipedia titles with en dashes stay whole). Basis: 100 % glue rate means an en dash after a URL is text; a real URL ending in a raw en dash/ellipsis does not occur in the corpus and would be percent-encoded by any tool that emits it. One rule for all three; round-trip property untouched (trimmed tail rejoins the following text token).
- **D4 — exclude Cf from the URL body.** Change the tail class to `[^\s<>"'`\\\p{Cf}]` with the `u` flag: a candidate **stops** at a format character (href stays a verbatim slice; the char becomes text). Basis: no typed URL contains one; an invisible char inside an href is exactly the display-integrity gap. Rendering them visibly would need DOM work (Q6 of the AS-54 plan) — out of scope, zero new dependencies.

## 3. Fix per finding

| # | Fix | Files |
|---|---|---|
| 1 | Replace the regex parse with a balanced-paren scan of the enclosing function's source (slice from `// files change outside the chat DB` … to the function's closing brace, bounded like the `sendMessage` slice already in the test). Assert the region's **complete** timer contents: exactly two top-level `setInterval(` calls; each call's last argument is its ms literal; call 1 body ⊇ `refreshSidebar` and contains **no** nested `setInterval|setTimeout|fetch(` other than that; ms ≥ 30_000; call 2 body is exactly the render calls `renderLoopStatus`, `renderLanesBadge`, `renderLanes` and no network. Move it into its own test (name in AC-1) so the AS-25 test keeps its original scope. | `apps/chat/test/api.test.js` |
| 2 | Add a generator branch `SALT + PUNCT` (≈8 % of pieces) so the scheme-then-non-alnum shape exists; re-derive and re-pin `urlTokens` (≥ threshold, measured on the new seed) and add a counter `saltPunct >= 1000` proving the branch fired. | `apps/chat/test/markdown.test.js` |
| 3 | D3: extend `SENTENCE_TAIL`; unit test per code point. | `apps/chat/public/markdown.js`, `markdown.test.js` |
| 4 | D4: `\p{Cf}` + `u` flag on `URL_RE`; unit test iterating every BMP code point with `/\p{Cf}/u` (cardinality asserted, expected count recorded by the implementer — the reviewer's 71 is the check value). | same |
| cosmetic | AS-54 plan §3.1 histogram: "letters ×4 / sum 12" → 5 / 13. One-line edit, recorded in a comment. | `.lattice/plans/task_01M1ESZ5HT5MH8MQ3AEFTJ2M3S.md` (board plane — orchestrator commits) |

## 4. Acceptance criteria (each names its mutant and the test that must go red; M4)

Mutants run on a **scratch copy**; assert the mutation applied at the intended site (anchor to the enclosing function / line, occurrence-accurate counts, never `grep -c`), restore, prove by content hash + `git status --porcelain`.

1. **The old guard's miss, observed red.** Mutant M1 on scratch `public/app.js` line 1547-1549: change `60_000` → `5_000` **and** insert `setTimeout(() => {}, 60_000);` inside that body. Old test "api: AS-25 — live.js is served …" stays **green** (record this — it is the vacuous pass). New test `api: AS-72 — app.js schedules exactly two intervals (balanced-paren scan): one ≥30s reconcile, one render-only tick` goes **red**.
2. Mutant M2: add a third `setInterval(() => refreshSidebar(), 45_000)` → AC-1 test red (complete-contents, not presence).
3. Mutant M3: add `fetch('/api/lanes')` into the 15 s body → AC-1 test red.
4. **Fuzz assertion exercised.** Mutant M4 on scratch `markdown.js`: `URL_RE` → `/https?:\/\/[^\s<>"'`\\]*/g` (drop the alnum first-host-char). On master the fuzz test stays **green** (record it); after the §3.2 generator change, "urls: href is a verbatim source slice; round-trip holds over a fuzz corpus" goes **red** at the `scheme + alnum host` assertion. New `saltPunct` counter ≥ 1000 on the unmodified seed.
5. D3: test `urls: AS-72 — trailing – — … is prose` — `https://x.dev/a–` → href `https://x.dev/a`, `https://x.dev/a–b` untouched. Mutant M5: remove `–` from `SENTENCE_TAIL` → red.
6. D4: test `urls: AS-72 — no Cf code point enters an href (N cases)` — for every BMP cp matching `/\p{Cf}/u`, `https://x.dev/a<cp>b` → href `https://x.dev/a`; N asserted and printed. Mutant M6: drop `\p{Cf}` from `URL_RE` → red with N failures.
7. Round-trip fuzz still green after D3/D4 (verbatim-slice property holds).
8. Counted run: host `node --test` ≥ 423 + new tests, 0 failing, count stated; compose `docker compose run --rm --build test` with the `Built` line is a **merge precondition** from a docker-capable session (headless tick cannot; say so in the report).
9. No new dependencies; no protected top-level file edited; ephemeral ports only.

## 5. Lane

- Branch `feat/AS-72-guard-and-url-boundaries`, worktree `.worktrees/AS-72`.
- Implementer: **developer-marcus**, after AS-61 (he is named there; Lena is on AS-100). Lane is **queued** behind whichever of AS-61/AS-100 frees first; if Lena frees first, she takes it — the plan needs no handoff.
- QA: **qa-priya** (Ruben filed the findings; he must not review his own predicted mutants).

## 6. Merge seam (AS-100)

AS-100 edits `server.js` and `stream.test.js`; AS-72 edits neither, so a clean rebase is expected. Risk: if AS-100's client adds a timer in `public/app.js` (an events tail on a poll), the AC-1 "exactly two" guard goes red on rebase — the implementer re-derives the region's complete contents against post-AS-100 master, not by relaxing the count.

## 7. Scope, complexity, unfinished

In: the four findings + the histogram fix. Out: DOM harness, visible rendering of Cf chars, uppercase schemes (AS-54 Q1). Complexity **low**. Not re-derived in this box: the name of the function enclosing `app.js:1547-1561` (implementer anchors the slice on it), and the new `urlTokens` pin after the generator change.
