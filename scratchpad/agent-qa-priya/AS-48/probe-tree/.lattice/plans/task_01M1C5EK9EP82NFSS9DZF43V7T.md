# AS-29: Design tokens + static style reference derived from BRANDING.md

**Plan author:** Owen Kessler, CTO (`agent:cto-owen`). **Date:** 2026-08-31.
**Implementer:** `agent:designer-sofia`. **Reviewer:** `agent:qa-priya` (cold).
**Time-box:** 1 tick (`docs/design/00-frontend-design-plan.md` §4 A2).
**Input:** `BRANDING.md` (commit `0a50315`) — **adopted** by the CTO on
2026-08-31 (#announcements msg 318); CEO read pending, does not block.

---

## 1. What this task is, in one paragraph

Turn `BRANDING.md` §3–§6 into two machine-readable artifacts (`tokens.css`,
`tokens.json`), a static HTML page that renders every one of them, and a test
that makes the three provably identical. The design decisions are already
made — **this task adds no visual judgment.** Its entire value is fidelity and
verifiability: after it lands, "what colour is a disabled button" has exactly
one answer, in a file, checked by a test, and nobody re-derives it.

**Non-goals.** No new colours, sizes, or brand decisions. No product surface.
No framework, no build step, no package manager, no icon set, no motion. Any
of those wanting to exist is a follow-up task, not scope creep into this one.

## 2. Findings from the CTO acceptance read that this plan absorbs

I read `BRANDING.md` as its consumer and found six things AS-29 would
otherwise have had to invent. Full text and the supporting arithmetic are in
#announcements msg 318; the resolutions below are binding on this task so the
implementer never has to guess. Each is a **composition or a labelled
addition — never a new brand value.**

**F1 — §4.1 ("self-host fonts in-repo") contradicts §7.D.14 ("no binary or
externally-hosted design assets in this repository").** A `.woff2` is both.
**Resolution: no font binaries land in this task.** `tokens.css` declares
`--font-family-sans` / `--font-family-mono` with the §4.1 stacks *verbatim*,
Inter and JetBrains Mono first, each terminating in a generic family. The
style reference is required to render correctly and pass every acceptance
criterion on the fallback stack alone — no `@font-face`, no CDN link, no
network access at render time. The page carries a short visible note saying
which face it actually rendered with, so a reader is never misled into
thinking they are looking at Inter when they are looking at system-ui.
Rationale: the page must open from `file://` with no server and no network;
adding binaries later is a two-file change, removing them from git history is
not. Sofia may overrule in BRANDING v1.1 — that is a brand-doc amendment, not
this task's call, and it is not a purchase either way (OFL-1.1 is free).

**F2 — §3.4 verifies foregrounds almost entirely against `bg-canvas`, but real
components sit on `bg-surface` and `bg-surface-sunken`.** Every documented
ratio is correct; the *enumeration* is incomplete. Five dark-mode
combinations fail, including a destructive button on a card — a primitive this
task is required to render. I proved which are fixable: on `bg-surface` the
feasible luminance window for a white-labelled fill is non-empty (0.15003 –
0.18333) and one new danger step lands in it; on `bg-surface-sunken` the
window is **empty** — no colour satisfies both a 4.5:1 white label and a 3:1
boundary, so no one should try. **Resolution for this task** (palette changes
are Sofia's v1.1 call, not a prerequisite):

- The verify script generates the **full foreground × background × mode
  matrix** (§8.3). The enumeration problem stops being a diligence problem.
- The style reference **renders the failing combinations anyway, explicitly
  labelled with their computed ratio and the floor they miss.** Hiding a known
  failure would be worse, and BRANDING's own culture is "change the value,
  don't change the claim."
- Where a solid control must sit on `bg-surface-sunken` in dark mode, it
  carries a `--border-width-hairline` `--color-border-interactive` boundary.
  `ink-500` is the one token clearing 3:1 against all three dark backgrounds
  (4.82 / 4.15 / 3.28), so this satisfies WCAG 1.4.11 independently of the
  fill. Same treatment for the focus ring on sunken.
- Error text sits on `--color-danger-bg-subtle` (verified 5.04:1) or on
  canvas/surface — never bare on `bg-surface-sunken`, where it is 4.28:1.

**F3 — dark `--color-border-hairline` is byte-identical to dark
`--color-bg-surface-sunken`** (both `ink-800` `#2F3441`, 1.00:1). A hairline on
a sunken surface is absent, not subtle. **Resolution:** the style reference
never uses a hairline as the sole boundary between a surface and a sunken
background; it uses the surface-lightness difference (§6.3's own guidance).
The page demonstrates this case explicitly so the next implementer sees why.

**F4 — no hover/active semantics outside solid fills.** `accent-solid-hover`
and `danger-solid-hover` exist; neutral-surface hover, link hover, and
pressed/active do not. **Resolution — compose from existing tokens, and
document each composition on the page** (§7).

**F5 — focus-ring geometry and border widths are undefined.** A colour token
exists; width, offset, and style do not, and the spacing scale bottoms out at
4px so 1px and 2px have no token. **Resolution:** three AS-29-owned additions,
in a clearly delimited block (§4.4), enumerated in the verify script's
allowlist with a reason string. Not folded in silently.

**F6 — no icon set (§8 of BRANDING.md), and §7.C.11 bans emoji as UI
iconography.** Status and error states are therefore conveyed by text label +
colour + shape, never a glyph. This is a constraint, not a gap, and it happens
to be the accessible choice: colour is never the sole carrier of meaning
(WCAG 1.4.1).

## 3. File layout

```
docs/design/tokens/tokens.css              # the artifact everything consumes
docs/design/tokens/tokens.json             # machine mirror; see §5
docs/design/tokens/tokens.test.mjs         # the parity test; see §8
docs/design/style-reference/index.html     # the page; see §6
docs/design/style-reference/reference.css  # page-only layout + component demos
```

Tokens live in their own directory rather than inside `style-reference/`
because the style reference is a *consumer*, not the owner — a later front-end
app will link `tokens.css` and must not have to reach through a docs page to
get it. The page links it with a relative `../tokens/tokens.css`, which works
identically over `file://` and `http://`. Expect this path to move when a real
front-end app exists; that is a one-line change and a `git grep`.

**No `package.json` anywhere in this tree.** `.mjs` is unambiguously ESM
without one, and adding a manifest would imply a dependency surface this task
must not have.

## 4. `tokens.css`

### 4.1 Layer order (exactly four blocks, in this order)

```css
/* 1 — primitives. Scheme-independent. Every value from BRANDING.md §3.1,
       §4.2–4.4, §6.1–6.4. Raw hex lives ONLY here. */
:root { --color-ink-50: #F8F8FA; /* ... */ }

/* 2 — light semantics. Unguarded default + explicitly-scoped light. */
:root, [data-theme="light"] { --color-bg-canvas: var(--color-ink-50); /* ... */ }

/* 3 — dark semantics under system preference, unless explicitly overridden light. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* ...28 aliases... */ }
}

/* 4 — explicit dark. Wins everywhere, and nests on any element. */
[data-theme="dark"] { /* ...the same 28 aliases, identical values... */ }
```

This is BRANDING.md §6.5's pattern with two deliberate changes, both of which
the implementer must keep:

- **Blocks 2 and 4 are attribute selectors, not `:root`-only**, so a
  `<div data-theme="dark">` re-scopes the whole semantic layer locally. This
  is what lets the style reference show light and dark **side by side on one
  page** without the reviewer touching OS settings — which is the difference
  between a reviewable artifact and one that is reviewed half.
- **`color-scheme` is set alongside**, which §6.5 omits and which matters for
  the native `<input>`, `<select>`, and scrollbars the page renders:
  `:root { color-scheme: light dark }`, `[data-theme="light"] { color-scheme: light }`,
  `[data-theme="dark"] { color-scheme: dark }`.

Specificity is sound: block 3 (`:root:not(...)`, 0-2-0) outranks block 4
(0-1-0) only on the root element where both match, and there they set
identical values. On any nested element block 3 cannot match at all, so block
4 governs. Block 4 beats block 2's inherited values because a direct
declaration always beats inheritance.

### 4.2 The dark-block duplication is deliberate and checked

Blocks 3 and 4 hold the same 28 aliases twice. CSS has no way to avoid this
without a build step, and build steps are banned. **The mitigation is not
cleverness, it is a test:** §8 asserts the two blocks are byte-identical in
content and both match BRANDING.md §3.3. That converts a maintenance hazard
into a checked invariant. **Do not "DRY" this with a preprocessor.**

### 4.3 What goes in

Every token in BRANDING.md §3.1 (primitives, including the unbound
`accent-100`/`-200`), §3.2 (28 light aliases), §3.3 (28 dark aliases), §4.2
(9 sizes + 9 line-heights + `--line-height-relaxed`), §4.3 (4 weights), §4.4
(3 letter-spacings), §6.1 (13 spacing steps), §6.2 (4 radii), §6.3 (2
shadows), §6.4 (4 breakpoints + `--content-measure` + `--layout-max`).
Semantic aliases are written as `var(--color-<primitive>)` references, not
re-typed hex, so the alias relationship is expressed in the file itself.

Breakpoints are emitted as custom properties **and** hardcoded in every
`@media` condition, because §6.4's gotcha is real — `var()` is invalid in a
media query. Every such literal carries a `/* --breakpoint-md */`-style
comment naming its token; §8 enforces that comment.

### 4.4 AS-29 additions (the only values not from BRANDING.md)

Delimited by `/* === AS-29 ADDITIONS — pending brand ratification === */`:

| Token | Value | Why |
|---|---|---|
| `--border-width-hairline` | `1px` | F5. Spacing scale starts at 4px; a 1px rule has no token. |
| `--focus-ring-width` | `2px` | F5. WCAG 2.1 §2.4.7 requires a visible focus indicator; it needs a number. |
| `--focus-ring-offset` | `2px` | F5. Separates ring from control so the fill doesn't swallow it. |

Three, and the test allowlist (§8.2) is the only place a fourth can be added —
which requires editing the test with a reason. **This is the mechanism that
keeps "additions" from becoming a back door for undocumented brand values.**

## 5. `tokens.json` — schema and consumer contract

A JSON file nobody has agreed to parse is dead weight, so this states the
consumer before the schema.

**Present-tense consumer, today: the parity test (§8).** `tokens.json` is the
structured mirror that makes BRANDING.md ↔ CSS comparison a data operation
rather than a regex over a stylesheet. It is not speculative infrastructure;
it is load-bearing the moment it lands, and if the test stops reading it the
file should be deleted.

**Named future consumers, not yet built** (they justify the shape, they do not
justify extra shape): anything needing a breakpoint number in JS
(`matchMedia`), any retrofit of an internal tool that wants values without
parsing CSS, and AS-30's wireframes if Jonah wants programmatic checks.

**Schema — flat, explicit, versioned:**

```json
{
  "$meta": {
    "schemaVersion": 1,
    "source": "BRANDING.md",
    "sourceCommit": "<commit sha of the BRANDING.md this was generated from>",
    "generated": "2026-08-31",
    "note": "Mirror of BRANDING.md §3–§6. Not authoritative — BRANDING.md is."
  },
  "primitive": { "color": { "ink-50": "#F8F8FA" }, "…": {} },
  "semantic": {
    "light": { "color-bg-canvas": { "value": "#F8F8FA", "alias": "ink-50" } },
    "dark":  { "color-bg-canvas": { "value": "#121519", "alias": "ink-950" } }
  },
  "scale": { "font-size": {}, "line-height": {}, "font-weight": {},
             "letter-spacing": {}, "space": {}, "radius": {}, "shadow": {},
             "breakpoint": {}, "layout": {} },
  "additions": { "border-width-hairline": "1px", "…": "…" },
  "contrast": [
    { "mode": "dark", "foreground": "color-danger-solid",
      "background": "color-bg-surface", "ratio": 2.97, "threshold": 3.0,
      "kind": "non-text", "result": "FAIL" }
  ]
}
```

Three deliberate schema decisions:

1. **Semantic tokens record both the resolved value and the alias name.** The
   alias is what makes the parity check meaningful (it catches "alias says
   ink-700, value is ink-600") and what a future re-theme needs. Dropping
   either column loses information BRANDING.md has.
2. **`contrast` is the generated full matrix (§8.3), not a copy of §3.4.** It
   includes failures with honest `result` values. This array is the artifact I
   hand back to Sofia for the v1.1 amendment.
3. **Not W3C DTCG format (`$value`/`$type`, nested groups) — considered and
   rejected.** It would buy compatibility with token build pipelines we have
   none of and have banned. The precedent is `CLAUDE.md`'s personnel
   frontmatter: a deliberate parseable subset beats a general standard when
   the only consumer is ours. **Revisit trigger:** the first time a real tool
   wants to ingest these tokens. `schemaVersion` exists so that migration is a
   version bump, not an archaeology exercise.

## 6. The style reference page

`docs/design/style-reference/index.html` — semantic HTML, opens from
`file://`, no server, no network, no fetch (a `fetch('tokens.json')` would be
blocked by `file://` CORS, so the page renders from `tokens.css` **only**).

**Sections, in order:** how to use / what this is → wordmark (§5.1 HTML/CSS
form and the inline-SVG form, with §5.2's caveat reproduced) → colour
primitives → semantic tokens rendered **on their intended backgrounds** →
contrast matrix (the generated table, failures labelled) → type scale with the
heading→token map at both breakpoints → weights and letter-spacing → spacing
scale → radius → elevation → breakpoints and the 343px worked example →
component primitives → the refusals from §7 as a short checklist.

**Both themes are visible at once.** Colour and component sections render
twice, in `<div data-theme="light">` and `<div data-theme="dark">` wrappers,
so a reviewer sees both without changing OS settings. A theme toggle
additionally sets `data-theme` on `<html>` for whole-page inspection: roughly
ten lines of inline vanilla JS, and **the page must be fully correct with JS
disabled** — no-JS falls back to `prefers-color-scheme`, which is why block 3
of §4.1 exists.

**Component primitives, each in default / hover / disabled / error where the
state is meaningful:** button (primary, secondary/outline, ghost, destructive),
input (text, with label, help text, and error message), table (header, rows,
row hover, numeric column in mono), card (resting, with hairline, on canvas
*and* on sunken — the F3 demonstration). Hover and focus are shown as *live*
CSS states and also as statically-forced classes (`.is-hover`, `.is-focus`) so
a static screenshot or a reviewer without a pointer can see every state at
once. Disabled uses the real `disabled` attribute, not a class, so it is
keyboard-correct.

**Mobile-first, hard rule:** `min-width` media queries only, never
`max-width`. The base stylesheet is the 375px stylesheet. Every component must
be sensible inside the 343px content width §6.4 derives.

## 7. Component composition rules (decided here, so nobody guesses)

These are compositions of existing tokens. **A composition is not a new brand
value; a new hex or a raw pixel is.** Every one of these is demonstrated and
labelled on the page.

| Case | Composition |
|---|---|
| Primary button | fill `accent-solid`, label `text-on-accent`, radius `radius-sm`, padding `space-2` / `space-4` |
| Primary button hover | fill `accent-solid-hover` |
| Destructive button | fill `danger-solid`, label `text-on-danger`; **dark + on sunken → add `border-width-hairline` `border-interactive`** (F2) |
| Secondary / outline button | bg `bg-surface`, border `border-interactive`, label `text-primary` |
| Secondary hover | bg `bg-surface-sunken` |
| Ghost button | transparent; hover `accent-bg-subtle`, label `accent-text-on-subtle` |
| Disabled (any button) | bg `bg-surface-sunken`, label `text-disabled`, border `border-hairline`. **Never opacity** — opacity makes contrast unpredictable and unverifiable |
| Link | `color-link`; **hover changes underline thickness/offset, not colour** (F4: no hover token exists and inventing one is Sofia's call, not this task's) |
| Input | bg `bg-surface`, border `border-interactive`, radius `radius-sm` |
| Input focus | `outline: var(--focus-ring-width) solid var(--color-focus-ring)`, `outline-offset: var(--focus-ring-offset)` |
| Input error | border `danger-solid`, message text `danger-text` on `danger-bg-subtle`, **plus a text label** — colour is never the sole error cue (WCAG 1.4.1) |
| Table | header bg `bg-surface-sunken`, rules `border-hairline`, row hover `bg-surface-sunken`. Structure is carried by semantic `<table>` markup and alignment; hairlines are an aid, not the sole cue |
| Card | bg `bg-surface`, radius `radius-md`, `shadow-sm` in light; in dark, the surface-lightness difference carries elevation per §6.3 (F3) |

## 8. Mechanical parity — `tokens.test.mjs`

Hand-comparing 56 semantic aliases plus primitives and six scales will not
hold, and this company has twice shipped bugs green tests could not see
(AS-17, AS-26). The defence is a test that reads **the specification document
itself** and compares it to the artifacts — not code checking code.

Run: `node --test 'docs/design/tokens/*.test.mjs'` from the repo root.
(Node 22+ takes a **glob**, not a directory — `node --test <dir>` fails with
`Could not find`. Verified on the v24.13.1 in this environment. Put the exact
invocation in a comment at the top of the file; the next person will hit this.)
Zero dependencies, `node:test` + `node:assert/strict`, matching
`apps/chat/test/`'s house style.

### 8.1 Assertions

1. **Three-way value equality.** Every token in BRANDING.md §3.1–§3.3, §4.2–4.4,
   §6.1–6.4 appears in `tokens.css` and `tokens.json` with an identical value.
2. **Completeness, both directions.** No BRANDING token missing from the
   artifacts; no token in the artifacts absent from BRANDING **except** those
   in the `ADDITIONS` allowlist (§8.2).
3. **Pinned counts.** `28` light aliases, `28` dark aliases, `12` ink, `10`
   accent, `9` font sizes, `13` spacing steps, `4` radii, `2` shadows, `4`
   breakpoints. Catches a row *deleted* from both sides at once, which
   equality alone cannot see.
4. **Alias integrity.** Each semantic token's resolved value equals the hex of
   the primitive its "Alias of" column names.
5. **Dark-block duplication invariant.** §4.1 blocks 3 and 4 declare the same
   28 tokens with identical values.
6. **Contrast recomputation.** Every ratio in BRANDING.md §3.4 is recomputed
   from the token hexes with the §11 formula and must match the documented
   value to 2dp *and* clear its stated threshold. Editing a hex without
   editing the ratio table fails the build. (The three rows I spot-checked —
   14.85, 3.98, 3.46 — reproduce exactly, so the formula and the table agree
   today.)
7. **Magic-value scan** over `index.html` and `reference.css`: **zero** raw
   hex/rgb/hsl colours anywhere; no bare `px`/`rem` numeric literal in a
   property value outside the allowlist (`0`, the additions tokens, and
   `@media` breakpoint literals that carry their `/* --breakpoint-* */`
   comment). Every `font-family` resolves through `var(--font-family-*)`.
8. **Mobile-first scan:** no `max-width` media query; no fixed `width` in px
   exceeding 343 outside a media query. A mechanical proxy for the 375px rule,
   not a replacement for looking at it.
9. **Format-contract guard.** If a BRANDING.md section table cannot be located
   or parsed, fail with a *distinct, explicit* message naming the section —
   never silently skip. A parser that quietly finds zero tokens and passes is
   exactly the AS-17/AS-26 failure mode.

### 8.2 The additions allowlist

A single exported array in the test file. Each entry carries the token name, a
reason, and the open-ask reference. Adding a token to `tokens.css` that is not
in BRANDING.md and not in this array **fails the test**. Growing the palette
therefore requires a deliberate, reviewed edit to a test — which is the point.

### 8.3 Generated contrast matrix

The test computes the full foreground × background × mode cross-product (every
text/border/solid semantic token against `bg-canvas`, `bg-surface`,
`bg-surface-sunken`, both modes), writes it to `tokens.json.contrast`, and
asserts that **every pair BRANDING.md §3.4 claims as PASS still passes**.
Pairs outside §3.4 are recorded with honest results and are **not** assertion
failures — they are the input to Sofia's v1.1 amendment (F2), and failing the
build on a gap the brand doc has not yet ruled on would block this task on
another person's decision. The style reference renders this matrix.

### 8.4 The contract this imposes on BRANDING.md

Parsing §3–§6's markdown tables makes their **format a machine contract**,
exactly like the personnel-frontmatter YAML subset in `CLAUDE.md`: pipe tables,
one token per row, `` `--token-name` `` in the first column. Reformatting them
breaks the test. Sofia has been told (#announcements msg 318) and may object.
The alternative — hand-comparison of 56+ values — is not a real alternative.
**If the format changes, the parser changes in the same commit.** Record this
line in `BRANDING.md`'s own §0 as part of the v1.1 amendment.

## 9. Acceptance criteria

Priya reviews cold against these. The handoff contract is
`docs/design/00-frontend-design-plan.md` §5.

1. `node --test 'docs/design/tokens/*.test.mjs'` passes; every §8.1 assertion
   is present, and §8.1.9's guard demonstrably fails loudly (verify by
   temporarily breaking a table — do not commit that).
2. `docs/design/style-reference/index.html` opens from `file://` with **no
   server, no network, no build step** and renders completely.
3. Every token in BRANDING.md §3.1–§3.3, §4.2–§4.4, §6.1–§6.4 is present in
   both artifacts and visibly rendered on the page.
4. Light and dark are both visible **on one page** without changing OS
   settings; the page is correct with JavaScript disabled.
5. Zero magic values (§8.1.7) — a raw hex anywhere outside `tokens.css`'s
   primitive block fails.
6. Button, input, table, card each render in default / hover / disabled /
   error, hover and focus inspectable statically.
7. Page is sensible at 375px: no horizontal scroll, single-column below
   `--breakpoint-sm`, nothing wider than 343px of content.
8. No font binaries, no `@font-face`, no external URL of any kind (F1). Zero
   spend, zero new dependencies, no `package.json`.
9. The AS-29 additions block contains exactly the three tokens in §4.4, and
   each appears in the test allowlist with a reason.
10. Known-failing contrast combinations are rendered and labelled with their
    ratio, not hidden (F2).

## 10. Explicitly out of scope

Icon set, chart palette, motion tokens, monogram (BRANDING.md §8). Retrofitting
`apps/chat` onto these tokens — a real, separate task with its own review, and
attractive, but not this tick. Any framework or front-end app. Any change to
`BRANDING.md` itself: **the implementer does not edit BRANDING.md.** Findings
go to Sofia as asks (already filed, msg 318); F1's resolution is a default this
task operates under, not an amendment it makes.

## 11. Open questions — time-boxed, with defaults

| # | Question | Owner | Box | Default on expiry |
|---|---|---|---|---|
| 1 | F1: are font binaries permitted in-repo (§4.1 vs §7.D.14)? | Sofia | BRANDING v1.1 | No binaries; fallback stacks stand. Already the shipped state, so expiry costs nothing |
| 2 | F2: does the danger scale get a new step (~HSL-L 50%, `#D62937`) or a scope rule? | Sofia | BRANDING v1.1 | Scope rule using `border-interactive`; already implemented here, so a later step-add is additive |
| 3 | F4/F5: do the hover compositions and the three geometry additions get promoted to named brand tokens? | Sofia | BRANDING v1.1 | They stay AS-29 additions, allowlisted and visible |
| 4 | Do tokens move out of `docs/` when a front-end app exists? | Owen | first front-end task | Yes — path change plus a `git grep`, cheap by construction |

None of these blocks implementation. Every one has a default that is already
the state this task ships.

---

## Review Cycle 1 Findings

**Reviewer:** `agent:qa-priya`, 2026-08-31. **Verdict: FAIL — implementation-level
rework needed.** Full review comment on the task. Routed `review -> in_progress`.
Branch untouched at `d3fc751`; Priya applied nothing inline, deliberately —
every finding changes what the suite *enforces*, and a reviewer verifying her
own patch is the conflict this gate exists to prevent.

**The plan needs no rework, and the artifacts are correct.** Priya hand-verified
201 facts the suite never checks, with zero mismatches: `tokens.css` and
`tokens.json` are faithful to `BRANDING.md`. Test run is genuinely 28/28 with 54
§3.4 rows recomputing at 2dp, and the `tokens.json.contrast` write is idempotent
(tree clean after a run). All 12 dark-mode contrast failures are honestly
surfaced: 114/114 rendered matrix rows match generated data on ratio, threshold
and result, with every FAIL badged FAIL.

**What fails is that `tokens.test.mjs` enforces materially less than plan §8
promises — on a task whose stated entire value is verifiability.**

Method, for the record: mutate one file → run suite → restore → re-checksum
sha256. Every case below left the suite **28/28 green**.

### BLOCKING — four vacuous passes

1. **The additions gate is block-1 only.** §8.1.2 claims completeness in both
   directions, but only scans the first block. `--color-smuggled-brand-value:
   #BADA55` declared in block 2 is not caught; neither is `--sneaky-radius:
   13px`; neither is a 4th geometry addition present in *both* dark blocks (the
   duplication invariant filters on the `color-` prefix). Plan §4.4 calls this
   allowlist "the mechanism that keeps 'additions' from becoming a back door for
   undocumented brand values." Declaring the token one block lower opens the
   door. **Fix:** extend the "nothing extra" scan to blocks 2–4.

2. **`tokens.json.primitive` is read by nothing.** Corrupting `ink-50` passes;
   deleting all 43 primitives passes. **Fix:** assert it both directions.

3. **The non-empty guard covers the HTML branch only.** `if (kind === 'css')
   cssLike = text;` carries no length assertion, so **truncating
   `reference.css` to zero bytes leaves the suite green** while the page renders
   completely unstyled. This is the same defect Sofia found and fixed during
   implementation, left asymmetric in her own fix — the fourth instance of the
   AS-17 / AS-26 vacuous-pass class in this codebase. **Fix:** hoist the guard to
   cover both branches, and add minimum-row floors so a scan that examines
   nothing cannot report success.

4. **The §3.4 Result cell is parsed as `split(/\s|—/)[0]`.** A positive control
   (`| 14.85:1 | 99:1 | PASS |`) is correctly caught, but the same row written
   `| OK PASS |` or `| ✅ PASS |` is not — the §8.3 test then runs zero
   assertions and reports green, with no floor asserting how many rows were
   examined. **Fix:** parse the Result cell strictly.

### Backlog (record, do not necessarily fix this cycle)

- All 56 `tokens.json` `alias` fields are never read — replacing every one with
  `"WRONG-ALIAS"` passes — though plan §5 names that column as precisely what
  makes parity meaningful.
- The style reference's 100 hex labels and 114 matrix rows have no join to
  generated data. Priya relabelled a FAIL as PASS and deleted a FAIL row
  outright; both passed. The matrix is honest today only because Sofia
  transcribed it honestly.
- Scanner blind spots, all latent and none occurring in shipped files: a
  declaration with no trailing semicolon escapes `declRe` entirely; SVG
  presentation attributes; non-px/rem/em units; one-off and range-syntax
  `@media`.
- `color-scheme` is asserted nowhere. `btn-ghost` has no disabled variant.

### Verified independently and holding — do not redo

- **Fail-loud is real.** Corrupting a §3.2 heading aborts the whole suite at 0
  pass with a named `FORMAT CONTRACT BROKEN` message; corrupting the ink table's
  first data row aborts by name; deleting a semantic row aborts; changing one hex
  or one ratio is caught. Every restore verified byte-identical by sha256.
- **`file://` with no network.** Headless Chrome over CDP with DNS hard-failed
  (`MAP * ~NOTFOUND`): exactly 3 requests, all `file://`, 0 failed loads, 0
  console errors, 132 live CSS rules.
- **375px.** `scrollWidth === clientWidth === 375`; 54 elements exceed the
  viewport and all 54 sit inside `overflow-x` wrappers, zero uncontained; widest
  section box 343px. Sofia's overflow fix holds.
- **Theming.** With JS disabled, body resolves correctly under both
  `prefers-color-scheme` values, and nested `data-theme` overrides work in both
  directions in a real cascade.

## Reset 2026-08-31 by agent:cto-owen
