Lattice-Reviewed-Commit: 95c4a6789c11fd949ce728ccbc43c0b552bdca39

# Code Review: AS-28 — Chat: favicon for the chat app

> Provenance: this is the output of Lattice's auto-fired `code-review` daemon (generic actor),
> not the company's review gate. Per CLAUDE.md, only a named `qa-*` employee's `--role review`
> comment satisfies the gate. The QA employee should form their own findings before reading this.

Reviewed: `feat/AS-28-favicon` at `8ee82bf` (worktree `.worktrees/AS-28`), against the plan in
`.lattice/plans/AS-28.md`. Diff stat: 4 files, +62/−0 — exactly the four files AC-5 names.

## 1. Verdict

**FAIL (implementation-level)** — the plan is sound; the SVG as committed is not well-formed XML
and no browser renders it, so the task's one goal (a visible tab icon) is not met. The fix is a
one-line edit plus one test assertion. Return to `in_progress`.

## 2. Summary

Wiring (allowlist entry, `<link rel="icon">`), the three tests, and the four planned mutants are
all correct and were re-verified here on a scratch copy (each red at its intended site). The
defect is inside `favicon.svg` itself: the explanatory comment spells the CSS token names
`--color-accent-500` and `--color-ink-white`, and a double hyphen inside an XML comment is a
well-formedness error (XML 1.0 §2.5). Chrome's parser stops at line 4 and yields an empty
`<svg>`; WebKit (Quick Look) produces the same parser-error page. The suite is green because
none of the three tests parses the document — a probe that injects a second `--` into the comment
survives the whole battery, and so does a body truncated to a bare `<svg …` opening tag.

Counted runs (all labelled):
- Host `node --test` on master: **367 / 0 failing**. On the branch: **370 / 0 failing** (baseline + 3, AC-4).
- `docker compose run --rm --build test` in the worktree: receipt line `Image asc-chat-test Built` observed; **370 / 0 failing**.

## 3. Issues

**[CRITICAL] apps/chat/public/favicon.svg:4 — The SVG is not well-formed XML; browsers render nothing**
The comment on lines 2–4 contains `--color-accent-500` and `--color-ink-white`. XML forbids the
string `--` inside a comment, and SVG served as `image/svg+xml` goes through the strict XML
parser in every engine. Evidence gathered during this review:
- `xmllint --noout favicon.svg` → `parser error : Double hyphen within comment` (line 4, twice).
- Headless Chrome `--dump-dom file://…/favicon.svg` → a `<parsererror>` block ("error on line 4
  at column 18: Double hyphen within comment") followed by an **empty** `<svg …></svg>` — the
  path and circles never enter the DOM. Screenshot shows the pink error page, no glyph.
- macOS Quick Look (WebKit) thumbnail of the file renders the same error page, so Safari fails too.
- Control: a copy with the two leading `--` removed parses clean in xmllint and Chrome (0 parser errors).
The tab therefore shows the browser default icon, which is precisely what the board asked to
get rid of. Every test passes because the tests treat the body as a string, not a document.
**Fix:** Rewrite the comment without any `--` sequence, e.g.
`#1C41E3 = color-accent-500 token, #FFFFFF = color-ink-white token (BRANDING.md §3.1)`.
Then re-run `xmllint --noout apps/chat/public/favicon.svg` (or open the file directly in a
browser) and confirm the glyph renders in the tab on light and dark chrome — the plan's M6 probe
asks for exactly this and it would have caught the defect.

**[MAJOR] apps/chat/test/api.test.js:1172–1187 — The served-SVG test cannot detect an unrenderable SVG**
`startsWith('<svg')` + `includes('viewBox="0 0 32 32"')` is satisfied by the broken file above,
by a file with a `--` injected anywhere in a comment (probe M5: 25/25 green), and by a body
truncated to `<svg viewBox="0 0 32 32" fill="#1C41E3" stroke="#FFFFFF"` with no closing tag
(probe M6: 25/25 green). The test verifies that *some* SVG-shaped bytes are served, not that a
favicon is. AC-1's falsifier (drop the allowlist entry) is real, but the property "the favicon is
served" needs a second falsifier for "…and is a parseable SVG document".
**Fix:** In a zero-dependency app, two cheap assertions close both survivors:
```js
// well-formedness floor: XML forbids '--' inside a comment (this is how AS-28 shipped blank once)
for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
  assert.ok(!body.includes('--'), 'no double hyphen inside an SVG comment');
}
assert.ok(svg.trimEnd().endsWith('</svg>'), 'the document is closed');
```
Record the two mutants (inject `--` into the comment; drop the closing tag) as observed reds in
the rework comment, matched to the site.

**[MINOR] apps/chat/public/favicon.svg:1 — `aria-label="ASC Chat"` on a favicon**
Harmless (favicons are never exposed to assistive tech), and `role="img"` is good hygiene if the
file is ever inlined. Not lettering, so it does not breach the plan's "no monogram by the back
door" rule. Noting only so nobody later reads it as brand text.
**Fix:** none required; optionally drop it to keep the file to the bare shape.

Observations outside the diff (pre-existing, not AS-28's to fix, recorded for the M6 probe budget):
- `GET //favicon.svg` returns `index.html` (200, `text/html`): `new URL('//favicon.svg', base)`
  parses `favicon.svg` as the host and the pathname collapses to `/`. Applies to every static;
  serves only the public index page. Worth a one-line note on a future server task, not a blocker.
- `HEAD /favicon.svg` → 404 (the static branch is `GET`-only). Browsers fetch favicons with GET;
  same behaviour for every other static file.

## 4. Positive Observations

- **The wiring is exactly the plan's two lines**, and the merge seam it warned about is clean:
  `git merge-tree --write-tree feat/AS-99-lane-view feat/AS-28-favicon` exits 0 with no
  conflicts, so whichever lands second rebases trivially.
- **Traversal probes answer from the allowlist, never the file gate**, as the plan required:
  `/../favicon.svg`, `/%2e%2e/favicon.svg`, `/./favicon.svg` and `/public/../favicon.svg` (sent
  over a raw socket, so no client-side normalisation) all resolve to the `/favicon.svg` key via
  URL normalisation and return the SVG; `/public/favicon.svg`, `/apps/chat/public/favicon.svg`,
  `/FAVICON.SVG`, `/favicon%2Esvg`, `/favicon.svg/` and `/favicon.svg%00` all 404; the AS-26/34
  file gate refuses it (`No such file.`). No request-derived string reaches the filesystem — the
  key lookup is exact and the filename is a literal in the map.
- **All four planned mutants observed red at the intended site** (scratch copy, mutation asserted
  applied, tree proven clean with `git diff --exit-code` afterwards): AC-1 drop the entry → 2 red
  (the served test and, as a consequence of the 404, the palette test — a wider set than the plan
  names, explained by the palette test fetching the same URL, not by a weak guard); AC-2 remove
  the link → 1 red; AC-3a fill `#FF0000` → 1 red; AC-3b strip every hex → 1 red on the
  cardinality floor, not a vacuous pass.
- **The palette test does cardinality before quantification** and its failure messages carry the
  examined count and the token names — the M5 habit applied at the assertion level.
- **Test placement and naming** follow the file's existing `api: AS-nn — …` convention and the
  AS-32 static-file pattern; the comments explain *why* each assertion is load-bearing.
- **Size and scope discipline:** 593 bytes (under the 600-byte ceiling), no strokes, solid fill
  for dark chrome, no lettering, no external asset, no compose/Dockerfile change (`public/` is
  already an image input, confirmed by the compose `--build` run picking up the new file).
