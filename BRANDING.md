# BRANDING.md — The American Software Company

**Status:** v1, shipped at time-box (Phase A / A1 per `docs/design/00-frontend-design-plan.md`).
**Author:** Sofia Andrade, Brand & Visual Designer (`agent:designer-sofia`).
**Date:** 2026-08-31.
**Scope:** company-level. This document governs **the umbrella entity, The American
Software Company** — identity, voice, palette, type, and the wordmark that
appears wherever the entity itself shows up (incorporation papers, contracts,
footers, this repository). It contains no product name, no product
iconography, and no product-specific visual commitment. The company operates
as a branded house with a quiet parent — customers meet product brands, never
this one (`docs/strategy/09-company-name.md`, cofounder decision, signed
2026-08-31). Product brands are a later, separate, gated exercise and may nest
inside this system without contradicting it.
**Consumed by:** Lattice **AS-29** (design tokens + static style reference)
turns §3–§6 below directly into `tokens.css` / `tokens.json`. Every value in
those sections is named as a system, not a one-off, specifically so AS-29
needs no follow-up decision.
**Read §7 first.** "The brand never does this" is the part of this document
that actually constrains an implementation. Constraints, not flourishes, are
what make a v1 brand coherent.

## Contents

0. [How to use this document](#0-how-to-use-this-document)
1. [Identity](#1-identity)
2. [Voice & tone](#2-voice--tone)
3. [Color system](#3-color-system)
4. [Typography](#4-typography)
5. [Logo direction (wordmark)](#5-logo-direction-wordmark)
6. [Spacing & layout](#6-spacing--layout)
7. [The brand never does this](#7-the-brand-never-does-this)
8. [v2 candidates](#8-v2-candidates)
9. [Gaps & open items](#9-gaps--open-items)
10. [Board asks](#10-board-asks)
11. [Appendix — contrast verification method](#11-appendix--contrast-verification-method)

---

## 0. How to use this document

- Every color has a token name, a hex value, and a **computed** WCAG 2.1
  contrast ratio against every background it's specified to sit on (§3, §11).
  Nothing here was eyeballed.
- Every typeface is open-license, with the license verified against the
  authoritative source, not assumed (§4).
- Every spacing, radius, shadow, and breakpoint value is a named token (§6).
  If you're about to write a raw hex code, a raw pixel value, or a raw font
  name into a wireframe or a stylesheet, stop — it should already be here. If
  it isn't, that's a gap (§9), not a license to invent one.
- §7 is the enforcement mechanism. Read it before you start building.

---

## 1. Identity

The American Software Company is a real software company built and operated
by a small team of persona-agent employees — each with a job title, a resume,
and a place in a public decision record — following a disciplined, auditable
process (`PHILOSOPHY.md`, `CLAUDE.md`). It is simultaneously a working
business and a demonstration that an organization can run this way at all.
That fact governs everything below: the audience for this brand is not
"consumers of a hot startup" — it's anyone, employee, board member, future
hire, or future customer of a future product, who opens a document this
company produced and needs to trust what it says.

Structurally, the company is a **branded house with a quiet parent**. "The
American Software Company" is a deliberately generic legal/umbrella name — it
does the boring work: incorporation, contracts, vendor paperwork, footers,
this repository (`docs/strategy/09-company-name.md` §1–§2). It is not, and by
design will not become, a product's customer-facing brand. Every product the
company ships earns its own name and its own mark, cleared and named as a
separate exercise before it ships anything public-facing. This document
governs the parent only. A product brand may extend this system — reuse the
palette mechanics, the type, the spacing scale — but it is never required to,
and this document never assumes which product exists to extend it.

Because the parent stays quiet on purpose, its personality is not "friendly
startup" and not "enterprise authority" either — it's closer to
**infrastructure**: correct, load-bearing, unremarkable on purpose. A reader
should come away thinking *this company writes things down and means them*,
not *this company is trying to sell me something*. The palette, type, and
spacing choices in §3–§6 all serve that one job: legible, precise, and
confident without needing to shout.

---

## 2. Voice & tone

The voice below isn't invented for this document — it's already the pattern
visible in every decision memo, board record, and Lattice comment this
company has produced (`docs/strategy/*`, `CLAUDE.md`). This section names the
pattern so any future copywriting — product or company-level — stays
consistent with how this company already talks to itself.

**Five rules:**

1. **Lead with the conclusion.** State the decision or the fact first; support
   it after, numbered if there's more than one reason. Readers who need only
   the headline get it in the first sentence.
2. **Name uncertainty instead of hedging it.** This company's own documents
   don't write "we're not totally sure" — they write "default until you
   answer X" and "time-boxed at N ticks; default on expiry: Y"
   (`docs/design/00-frontend-design-plan.md` §7 is a working example). A named
   default with a trigger to revisit it is more useful than a vague hedge.
3. **Cite, date, and attribute.** A claim without a source is an opinion; this
   company's culture is to attach one anyway. Decisions carry a date and a
   named signer. Copy that makes a factual claim links or names where it comes
   from.
4. **Plain, not clever.** No wordplay, no forced enthusiasm, no rhetorical
   questions used as transitions. Say the correct thing the shortest way it
   can be said correctly.
5. **Never oversell.** No superlative without a measurement behind it. When
   this company's own decision memo couldn't measure something, it said so
   instead of implying otherwise (`docs/strategy/07-decision-memo.md` §3:
   "differentiation must come from trust, polish, and distribution, none of
   which is measured" — stated, not hidden). Copy follows the same rule:
   unmeasured claims get labeled unmeasured, not dressed up.

**In practice:**

| Don't | Do |
|---|---|
| "We're revolutionizing how software companies work with cutting-edge, AI-driven innovation!" | "Every employee here is a persona agent with a job title, a resume, and a decision record. The event log is the audit trail." |
| "Our seamless platform empowers you to unlock your business's full potential." | State what it does, in one plain sentence. If that sentence doesn't exist yet, the copy isn't done. |
| "Trusted by thousands of forward-thinking teams." | Name the number you can actually cite, or don't make the claim yet. |
| "Questions? We're here 24/7 to help you succeed!" | "Support: [channel]. Typical response time: [measured number]." |

---

## 3. Color system

Two layers: **primitives** (raw scales, no assigned meaning) and **semantic
tokens** (the ones actually used in UI, aliased to a primitive per color
scheme). AS-29 implements both layers as CSS custom properties; §11 explains
exactly how every ratio below was computed and how to re-verify or extend the
palette without guessing.

Every scale below is generated from a single hue + saturation in HSL, stepped
by lightness. That formula is recorded per scale so the palette can be
extended systematically later instead of by hand-picked hex codes.

### 3.1 Primitives

**`ink`** — neutral scale. Hue 222°, saturation 16%. Cool-neutral (a faint
blue cast, not warm gray) — reads as precise/technical rather than soft.

| Token | Hex |
|---|---|
| `--color-ink-50` | `#F8F8FA` |
| `--color-ink-100` | `#F1F2F5` |
| `--color-ink-200` | `#E1E3E9` |
| `--color-ink-300` | `#C9CDD8` |
| `--color-ink-400` | `#A0A8BA` |
| `--color-ink-500` | `#78839D` |
| `--color-ink-600` | `#5C667F` |
| `--color-ink-700` | `#454D60` |
| `--color-ink-800` | `#2F3441` |
| `--color-ink-900` | `#1F232B` |
| `--color-ink-950` | `#121519` |
| `--color-ink-white` | `#FFFFFF` |

**`accent`** — the one brand color. Hue 229°, saturation 78%. A deep, precise
blue — chosen for legibility and a technical/trustworthy read, not for any
financial or product-specific association (this document is product-silent by
constraint; see §1). It is never composed with `danger` in a decorative
red/ink/blue arrangement — see §7.A.

| Token | Hex |
|---|---|
| `--color-accent-50` | `#EFF2FD` |
| `--color-accent-100` | `#DDE2FB` |
| `--color-accent-200` | `#B6C2F6` |
| `--color-accent-300` | `#8498F0` |
| `--color-accent-400` | `#4E6AE9` |
| `--color-accent-500` | `#1C41E3` |
| `--color-accent-600` | `#1836BF` |
| `--color-accent-700` | `#132C9A` |
| `--color-accent-800` | `#0F2276` |
| `--color-accent-900` | `#0B1956` |

`--color-accent-100` and `--color-accent-200` are not yet bound to a semantic
role — they complete the ramp for future use (e.g., a hover state on a subtle
surface) rather than being invented later as one-offs.

**`success`**, **`warning`**, **`danger`** — status scales. Each ships with
only the steps this system currently uses (not a full 50–900 ramp). Extend
using the same hue/saturation with the HSL generator in §11 if a new step is
ever needed — never hand-pick a new hex.

| Scale | Hue | Sat | Token → Hex |
|---|---|---|---|
| `success` | 152° | 48% | `-50 #EEF9F4` · `-100 #D9F2E6` · `-300 #86D5B0` · `-600 #2D8059` · `-700 #246647` · `-800 #1C4F37` · `-900 #153C2A` |
| `warning` | 38° | 92% | `-50 #FEF7EB` · `-100 #FDEED3` · `-300 #F8BC54` · `-700 #A26907` · `-800 #845606` · `-900 #6C4604` |
| `danger` | 355° | 68% | `-50 #FCEEEF` · `-100 #F8D8DB` · `-300 #E5767F` · `-500 #CE2735` · `-600 #AB212C` · `-700 #891A23` · `-800 #6B141C` · `-900 #511015` |

`danger`'s hue (355°) is deliberately shifted warm/brick, off pure
fire-engine red (0°/360°) — partly an aesthetic choice, partly to keep it from
ever reading as a "flag red" when it happens to appear near `accent` blue on
the same screen. It is used only for error/destructive semantics, never
decoratively — see §7.A.

### 3.2 Semantic tokens — light mode

| Token | Value | Alias of |
|---|---|---|
| `--color-bg-canvas` | `#F8F8FA` | `ink-50` |
| `--color-bg-surface` | `#FFFFFF` | `ink-white` |
| `--color-bg-surface-sunken` | `#F1F2F5` | `ink-100` |
| `--color-text-primary` | `#1F232B` | `ink-900` |
| `--color-text-secondary` | `#454D60` | `ink-700` |
| `--color-text-muted` | `#5C667F` | `ink-600` |
| `--color-text-disabled` | `#A0A8BA` | `ink-400` |
| `--color-text-on-accent` | `#FFFFFF` | `ink-white` |
| `--color-text-on-danger` | `#FFFFFF` | `ink-white` |
| `--color-border-hairline` | `#E1E3E9` | `ink-200` |
| `--color-border-interactive` | `#78839D` | `ink-500` |
| `--color-link` | `#132C9A` | `accent-700` |
| `--color-accent-solid` | `#1836BF` | `accent-600` |
| `--color-accent-solid-hover` | `#132C9A` | `accent-700` |
| `--color-accent-bg-subtle` | `#EFF2FD` | `accent-50` |
| `--color-accent-text-on-subtle` | `#0F2276` | `accent-800` |
| `--color-focus-ring` | `#1836BF` | = `accent-solid` |
| `--color-success-text` | `#246647` | `success-700` |
| `--color-success-bg-subtle` | `#EEF9F4` | `success-50` |
| `--color-success-text-on-subtle` | `#1C4F37` | `success-800` |
| `--color-warning-text` | `#845606` | `warning-800` |
| `--color-warning-bg-subtle` | `#FEF7EB` | `warning-50` |
| `--color-warning-text-on-subtle` | `#6C4604` | `warning-900` |
| `--color-danger-text` | `#891A23` | `danger-700` |
| `--color-danger-bg-subtle` | `#FCEEEF` | `danger-50` |
| `--color-danger-text-on-subtle` | `#6B141C` | `danger-800` |
| `--color-danger-solid` | `#AB212C` | `danger-600` |
| `--color-danger-solid-hover` | `#891A23` | `danger-700` |

### 3.3 Semantic tokens — dark mode

| Token | Value | Alias of |
|---|---|---|
| `--color-bg-canvas` | `#121519` | `ink-950` |
| `--color-bg-surface` | `#1F232B` | `ink-900` |
| `--color-bg-surface-sunken` | `#2F3441` | `ink-800` |
| `--color-text-primary` | `#F8F8FA` | `ink-50` |
| `--color-text-secondary` | `#C9CDD8` | `ink-300` |
| `--color-text-muted` | `#A0A8BA` | `ink-400` |
| `--color-text-disabled` | `#5C667F` | `ink-600` |
| `--color-text-on-accent` | `#FFFFFF` | `ink-white` |
| `--color-text-on-danger` | `#FFFFFF` | `ink-white` |
| `--color-border-hairline` | `#2F3441` | `ink-800` |
| `--color-border-interactive` | `#78839D` | `ink-500` |
| `--color-link` | `#8498F0` | `accent-300` |
| `--color-accent-solid` | `#4E6AE9` | `accent-400` |
| `--color-accent-solid-hover` | `#1C41E3` | `accent-500` |
| `--color-accent-bg-subtle` | `#0B1956` | `accent-900` |
| `--color-accent-text-on-subtle` | `#8498F0` | `accent-300` |
| `--color-focus-ring` | `#4E6AE9` | = `accent-solid` |
| `--color-success-text` | `#86D5B0` | `success-300` |
| `--color-success-bg-subtle` | `#153C2A` | `success-900` |
| `--color-success-text-on-subtle` | `#86D5B0` | `success-300` |
| `--color-warning-text` | `#F8BC54` | `warning-300` |
| `--color-warning-bg-subtle` | `#6C4604` | `warning-900` |
| `--color-warning-text-on-subtle` | `#F8BC54` | `warning-300` |
| `--color-danger-text` | `#E5767F` | `danger-300` |
| `--color-danger-bg-subtle` | `#511015` | `danger-900` |
| `--color-danger-text-on-subtle` | `#E5767F` | `danger-300` |
| `--color-danger-solid` | `#CE2735` | `danger-500` |
| `--color-danger-solid-hover` | `#AB212C` | `danger-600` |

Notice dark mode's status colors reuse one step (`-300`) for both "text on
canvas" and "text on that color's own `-900` subtle background" — that step
happens to have enough range to clear AA against both, so there's no need for
a fourth step per scale. `border-interactive` (`ink-500`) is the one primitive
that is literally identical in both color schemes — a mid-gray contrasts
adequately against both a near-white and a near-black canvas, so it didn't
need a light/dark variant at all.

### 3.4 Contrast ratios — computed, not asserted

Every pair below was computed with the WCAG 2.1 relative-luminance formula
(method and script in §11), not estimated. **AA floor: 4.5:1 for normal text,
3:1 for large text (≥24px, or ≥19px bold) and for non-text UI-component
boundaries (WCAG 1.4.11).** Two rows are explicitly marked exempt or
decorative — they are not AA claims, and are labeled so nobody downstream
mistakes them for one.

**Light mode**

| Pair | Ratio | Threshold | Result |
|---|---|---|---|
| `text-primary` on `bg-canvas` | 14.85:1 | 4.5:1 | PASS |
| `text-primary` on `bg-surface` | 15.75:1 | 4.5:1 | PASS |
| `text-primary` on `bg-surface-sunken` | 14.07:1 | 4.5:1 | PASS |
| `text-secondary` on `bg-canvas` | 7.97:1 | 4.5:1 | PASS |
| `text-secondary` on `bg-surface` | 8.46:1 | 4.5:1 | PASS |
| `text-muted` on `bg-canvas` | 5.41:1 | 4.5:1 | PASS |
| `text-muted` on `bg-surface` | 5.73:1 | 4.5:1 | PASS |
| `text-disabled` on `bg-canvas` | 2.25:1 | — | **EXEMPT** — disabled content is excluded from WCAG contrast requirements; not an AA claim |
| `border-hairline` on `bg-canvas` | 1.21:1 | — | **DECORATIVE** — never the sole cue for a boundary; not an AA claim |
| `border-interactive` on `bg-canvas` | 3.58:1 | 3:1 | PASS |
| `border-interactive` on `bg-surface` | 3.80:1 | 3:1 | PASS |
| `link` on `bg-canvas` | 10.68:1 | 4.5:1 | PASS |
| `link` on `bg-surface` | 11.32:1 | 4.5:1 | PASS |
| `text-on-accent` (white) on `accent-solid` | 9.06:1 | 4.5:1 | PASS |
| `text-on-accent` (white) on `accent-solid-hover` | 11.32:1 | 4.5:1 | PASS |
| `accent-solid` boundary vs `bg-canvas` (non-text) | 8.54:1 | 3:1 | PASS |
| `focus-ring` vs `bg-canvas` (non-text) | 8.54:1 | 3:1 | PASS |
| `accent-text-on-subtle` on `accent-bg-subtle` | 12.44:1 | 4.5:1 | PASS |
| `success-text` on `bg-canvas` | 6.46:1 | 4.5:1 | PASS |
| `success-text-on-subtle` on `success-bg-subtle` | 8.77:1 | 4.5:1 | PASS |
| `warning-text` on `bg-canvas` | 5.97:1 | 4.5:1 | PASS |
| `warning-text-on-subtle` on `warning-bg-subtle` | 7.84:1 | 4.5:1 | PASS |
| `danger-text` on `bg-canvas` | 8.86:1 | 4.5:1 | PASS |
| `danger-text-on-subtle` on `danger-bg-subtle` | 10.69:1 | 4.5:1 | PASS |
| `text-on-danger` (white) on `danger-solid` | 7.03:1 | 4.5:1 | PASS |
| `text-on-danger` (white) on `danger-solid-hover` | 9.39:1 | 4.5:1 | PASS |
| `danger-solid` boundary vs `bg-canvas` (non-text) | 6.63:1 | 3:1 | PASS |

**Dark mode**

| Pair | Ratio | Threshold | Result |
|---|---|---|---|
| `text-primary` on `bg-canvas` | 17.26:1 | 4.5:1 | PASS |
| `text-primary` on `bg-surface` | 14.85:1 | 4.5:1 | PASS |
| `text-primary` on `bg-surface-sunken` | 11.73:1 | 4.5:1 | PASS |
| `text-secondary` on `bg-canvas` | 11.51:1 | 4.5:1 | PASS |
| `text-secondary` on `bg-surface` | 9.90:1 | 4.5:1 | PASS |
| `text-muted` on `bg-canvas` | 7.68:1 | 4.5:1 | PASS |
| `text-muted` on `bg-surface` | 6.60:1 | 4.5:1 | PASS |
| `text-disabled` on `bg-canvas` | 3.19:1 | — | **EXEMPT** — disabled content is excluded from WCAG contrast requirements; not an AA claim (happens to clear 3:1, not relied upon) |
| `border-hairline` on `bg-canvas` | 1.47:1 | — | **DECORATIVE** — never the sole cue for a boundary; not an AA claim |
| `border-interactive` on `bg-canvas` | 4.82:1 | 3:1 | PASS |
| `border-interactive` on `bg-surface` | 4.15:1 | 3:1 | PASS |
| `link` on `bg-canvas` | 6.74:1 | 4.5:1 | PASS |
| `link` on `bg-surface` | 5.80:1 | 4.5:1 | PASS |
| `text-on-accent` (white) on `accent-solid` | 4.60:1 | 4.5:1 | PASS |
| `text-on-accent` (white) on `accent-solid-hover` | 7.20:1 | 4.5:1 | PASS |
| `accent-solid` boundary vs `bg-canvas` (non-text) | 3.98:1 | 3:1 | PASS |
| `focus-ring` vs `bg-canvas` (non-text) | 3.98:1 | 3:1 | PASS |
| `accent-text-on-subtle` on `accent-bg-subtle` | 6.00:1 | 4.5:1 | PASS |
| `success-text` on `bg-canvas` | 10.60:1 | 4.5:1 | PASS |
| `success-text-on-subtle` on `success-bg-subtle` | 7.10:1 | 4.5:1 | PASS |
| `warning-text` on `bg-canvas` | 10.73:1 | 4.5:1 | PASS |
| `warning-text-on-subtle` on `warning-bg-subtle` | 4.89:1 | 4.5:1 | PASS |
| `danger-text` on `bg-canvas` | 6.30:1 | 4.5:1 | PASS |
| `danger-text-on-subtle` on `danger-bg-subtle` | 5.04:1 | 4.5:1 | PASS |
| `text-on-danger` (white) on `danger-solid` | 5.30:1 | 4.5:1 | PASS |
| `text-on-danger` (white) on `danger-solid-hover` | 7.03:1 | 4.5:1 | PASS |
| `danger-solid` boundary vs `bg-canvas` (non-text) | 3.46:1 | 3:1 | PASS |

Two pairs failed on the first pass and were **not** shipped as originally
drafted: dark-mode `accent-solid` and `danger-solid` at their light-mode
lightness steps cleared the 4.5:1 text requirement but landed at 2.54:1 and
2.60:1 against the near-black dark canvas — under the 3:1 non-text floor, i.e.
a solid button that white text reads fine on but that doesn't stand out from
the page around it. Rather than document a ratio that was wrong, the two dark
solid-fill tokens were moved to different (lighter) steps in the same scales
— `accent-400`/`danger-500` instead of `accent-500`/`danger-600` — recomputed,
and re-verified above. That is the process this document expects everyone to
follow when a future addition doesn't clear the bar: change the value, don't
change the claim.

Every color/background pair specified anywhere in this document appears in
one of the two tables above with an honest result. There are no unlabeled
failures.

---

## 4. Typography

### 4.1 Typefaces

Two typefaces, both open-license, both verified against their authoritative
source (not assumed — see §11 method note) on 2026-08-31:

**Sans / UI — Inter**
- License: **SIL Open Font License, Version 1.1.**
- Copyright: `Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)`
- Verified against: `github.com/rsms/inter`, `LICENSE.txt`, fetched directly.
- Permits: embedding, self-hosting, redistribution, and modification, free for
  commercial and non-commercial use. Restriction: the font itself may not be
  sold on its own, and a modified version can't reuse the reserved name
  "Inter" without permission — not applicable here, as it ships unmodified.
- Token: `--font-family-sans`
- Stack: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

**Mono / code & data — JetBrains Mono**
- License: **SIL Open Font License, Version 1.1.** (Note: JetBrains Mono's
  *font* is OFL-1.1; the separate build tooling in that repository is
  Apache-2.0 — that Apache grant covers the tooling, not the typeface itself.
  Recorded here specifically because it's the kind of distinction easy to get
  wrong by memory rather than by checking, and this document was checked.)
- Copyright: `Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)`
- Verified against: `github.com/JetBrains/JetBrainsMono`, `OFL.txt`, fetched
  directly, cross-checked against the repository's own license statement.
- Token: `--font-family-mono`
- Stack: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`

Both fallback stacks terminate in a generic family so text never fails to
render even if neither web font loads. **Implementation note for AS-29:**
both faces must be **self-hosted in-repo** (the OFL permits embedding) rather
than pulled from a third-party CDN at runtime — consistent with this
project's zero-external-runtime-dependency posture for design artifacts. The
full OFL-1.1 text should travel with the vendored font files (a `LICENSE.txt`
per font family is the standard OFL distribution requirement), not be
duplicated into this document.

No typeface beyond these two ships in v1 — see §7.B.

### 4.2 Type scale

Base: 16px = 1rem. Browser root font-size is never overridden (no `html {
font-size: 62.5% }` tricks) so `rem` units continue to track the user's own
font-size preference — an accessibility requirement, not a style choice.

| Token | rem | px | Line-height token | Line-height | Ratio | Typical use |
|---|---|---|---|---|---|---|
| `--font-size-xs` | 0.75rem | 12px | `--line-height-xs` | 1rem / 16px | 1.33 | Fine print, table metadata |
| `--font-size-sm` | 0.875rem | 14px | `--line-height-sm` | 1.25rem / 20px | 1.43 | Secondary UI text, code |
| `--font-size-base` | 1rem | 16px | `--line-height-base` | 1.5rem / 24px | 1.50 | Body copy, default UI text |
| `--font-size-lg` | 1.125rem | 18px | `--line-height-lg` | 1.75rem / 28px | 1.56 | Lead paragraph, emphasized body |
| `--font-size-xl` | 1.25rem | 20px | `--line-height-xl` | 1.75rem / 28px | 1.40 | h4 / card titles |
| `--font-size-2xl` | 1.5rem | 24px | `--line-height-2xl` | 2rem / 32px | 1.33 | h3 |
| `--font-size-3xl` | 1.875rem | 30px | `--line-height-3xl` | 2.25rem / 36px | 1.20 | h2 |
| `--font-size-4xl` | 2.25rem | 36px | `--line-height-4xl` | 2.5rem / 40px | 1.11 | h1 (desktop) |
| `--font-size-5xl` | 3rem | 48px | `--line-height-5xl` | 3.25rem / 52px | 1.08 | Display/hero only — used sparingly |

`--line-height-relaxed: 1.6` (unitless multiplier) — applied to `--font-size-base`
or `--font-size-sm` for long-form prose and code blocks, where the default
ratios above read slightly tight over multiple lines.

**Heading → token mapping** (default; a screen may deviate with a stated
reason, not silently):

| Element | <768px (mobile-first default) | ≥768px | Weight |
|---|---|---|---|
| h1 | `--font-size-3xl` | `--font-size-4xl` | `--font-weight-semibold` |
| h2 | `--font-size-2xl` | `--font-size-3xl` | `--font-weight-semibold` |
| h3 | `--font-size-xl` | `--font-size-2xl` | `--font-weight-semibold` |
| h4 | `--font-size-lg` | `--font-size-xl` | `--font-weight-medium` |
| body | `--font-size-base` | `--font-size-base` | `--font-weight-regular` |
| small / caption | `--font-size-sm` | `--font-size-sm` | `--font-weight-regular` |

### 4.3 Weights

Only four weights ship. Do not reach for Inter's other variable-axis weights
— see §7.B for why.

| Token | Value | Use |
|---|---|---|
| `--font-weight-regular` | 400 | Body copy, default UI text |
| `--font-weight-medium` | 500 | Emphasis within body text, h4, the wordmark |
| `--font-weight-semibold` | 600 | h1–h3, button labels |
| `--font-weight-bold` | 700 | Rare, hard emphasis only — not a heading default |

### 4.4 Letter-spacing

| Token | Value | Use |
|---|---|---|
| `--letter-spacing-tight` | -0.02em | `--font-size-3xl` and above |
| `--letter-spacing-normal` | 0 | Default — body, UI, h4 and smaller |
| `--letter-spacing-wide` | 0.08em | Uppercase labels and the wordmark (§5) only |

---

## 5. Logo direction (wordmark)

Per the plan's default (`docs/design/00-frontend-design-plan.md` §7, Q3,
confirmed by the naming decision): **wordmark direction only in v1.** No
icon, no monogram, no app-icon treatment — see §8 for why that's deferred
rather than designed here.

### 5.1 The wordmark

The entity's name, set as **real text** (HTML/CSS or SVG `<text>`, never a
raster image) — because it's a masthead, not a startup logo competing for
attention (§1). Think a letterhead or a museum donor wall: restrained,
confident through typography and spacing alone, no ornament.

**Construction:**

| Property | Value |
|---|---|
| Content | `THE AMERICAN SOFTWARE COMPANY` — the full legal name, true uppercase |
| Typeface | `--font-family-sans` (Inter) |
| Weight | `--font-weight-medium` (500) |
| Letter-spacing | `--letter-spacing-wide` (0.08em) |
| Color (default) | `--color-text-primary` for the active color scheme |
| Color (reversed, on a non-neutral background) | pure white or `--color-ink-950`, whichever clears 4.5:1 against that background |

**Responsive behavior:** because it's real text, it reflows — it is not a
fixed-aspect-ratio lockup. At widths too narrow for one line, it wraps.
Preferred break: **`THE AMERICAN` / `SOFTWARE COMPANY`** (a company holds
together as a phrase better than being split from its modifier). Below
`--breakpoint-sm` (480px), reduce tracking to `0.04em` so the wrap doesn't
force awkward gaps.

**Clear space:** minimum clear space on all sides equals the cap-height of
the "T" as rendered (i.e., roughly one line-height of whatever size it's set
at) — nothing else sits inside that margin.

**Minimum size:** never render below `--font-size-sm` (14px) — the tracked-out
uppercase treatment stops being comfortably legible below that, especially at
`--letter-spacing-wide`.

### 5.2 Reference implementation

Plain HTML/CSS is the primary, portable form — it inherits whatever font the
page has already loaded and needs nothing else:

```html
<span class="wordmark">The American Software Company</span>
```

```css
.wordmark {
  font-family: var(--font-family-sans);
  font-weight: var(--font-weight-medium);
  letter-spacing: var(--letter-spacing-wide);
  text-transform: uppercase;
  color: var(--color-text-primary);
}
```

An inline SVG version, for contexts that want a self-contained markup
fragment (e.g., embedding in a static reference page):

```html
<svg viewBox="0 0 620 32" role="img" aria-label="The American Software Company"
     xmlns="http://www.w3.org/2000/svg" style="height:1.5em;width:auto;overflow:visible">
  <text x="0" y="23"
        font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="22" font-weight="500" letter-spacing="0.08em"
        fill="currentColor">THE AMERICAN SOFTWARE COMPANY</text>
</svg>
```

**Caveat, stated rather than discovered later:** this SVG renders correctly
only where it is inlined directly in an HTML document whose page has Inter
loaded (or where the browser has it installed) — `letter-spacing` in `em` and
`fill="currentColor"` both depend on CSS context that a standalone,
externally-referenced `.svg` file won't reliably get. It is not a
font-independent vector logo (that would require outlined glyph paths, which
needs font-design tooling this document doesn't have and didn't fabricate).
Use the HTML/CSS version in real pages; treat the SVG as a copy-paste
reference for embedding in other markup, not as a portable image asset.

### 5.3 Misuse — specific to the wordmark

(In addition to the system-wide refusals in §7.)

- Never recolor it outside `--color-text-primary` or the reversed white/`ink-950`
  pair defined above.
- Never stretch, condense, skew, or otherwise distort its proportions.
- Never add a drop shadow, outline, glow, or container/badge around it.
- Never set it in a different typeface or weight than specified above.
- Never abbreviate it in an official rendering — "TASC," "American Software
  Co.," "ASC" are fine in casual conversation, never as a rendered mark. Full
  legal name or nothing.
- Never place it over a busy image or any background that drops it below the
  ratios in §3.4.
- Never use it as a product's logo — it identifies the entity, not a product
  (§1).

---

## 6. Spacing & layout

A scale, not vibes. **Mobile-first: verified to work at 375px before desktop**
(plan §5.4 / lesson of AS-23).

### 6.1 Spacing scale

Base unit 4px. Every layout gap, padding, and margin in downstream work
should resolve to one of these — a raw pixel value in a wireframe or
stylesheet is a magic value (§0, §7.C).

| Token | rem | px |
|---|---|---|
| `--space-0` | 0 | 0 |
| `--space-1` | 0.25rem | 4px |
| `--space-2` | 0.5rem | 8px |
| `--space-3` | 0.75rem | 12px |
| `--space-4` | 1rem | 16px |
| `--space-5` | 1.25rem | 20px |
| `--space-6` | 1.5rem | 24px |
| `--space-8` | 2rem | 32px |
| `--space-10` | 2.5rem | 40px |
| `--space-12` | 3rem | 48px |
| `--space-16` | 4rem | 64px |
| `--space-20` | 5rem | 80px |
| `--space-24` | 6rem | 96px |

### 6.2 Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 0.25rem / 4px | Inputs, buttons, small controls, checkboxes |
| `--radius-md` | 0.5rem / 8px | Cards, panels, modals |
| `--radius-lg` | 0.75rem / 12px | Large containers, sheets |
| `--radius-full` | 9999px | Pills, avatars, badges, toggle switches — **only** these; see §7.C |

Radii lean small on purpose — this is an engineering-tool personality (§1),
not a rounded consumer-app one.

### 6.3 Elevation (shadow)

Two steps, both built from `--color-ink-950` at low opacity (no new color
introduced for shadows):

| Token | Value | Use |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(18,21,25,0.06), 0 1px 1px rgba(18,21,25,0.04)` | Resting card elevation |
| `--shadow-md` | `0 4px 8px rgba(18,21,25,0.10), 0 2px 4px rgba(18,21,25,0.06)` | Modal / popover / dropdown elevation |

These are calibrated for light surfaces. In dark mode, a black-based shadow
barely reads against a near-black canvas — prefer the `--color-bg-surface` /
`--color-bg-canvas` lightness difference plus `--color-border-hairline` to
convey elevation; use `--shadow-md` only where a floating element (modal,
popover) sits above dimmed canvas and needs the extra cue.

Decorative shadows (glows, multi-layer "soft UI" blur) are out — see §7.A.

### 6.4 Breakpoints & containers

| Token | Value | Note |
|---|---|---|
| `--breakpoint-sm` | 480px | Large phones |
| `--breakpoint-md` | 768px | Tablets |
| `--breakpoint-lg` | 1024px | Small laptops |
| `--breakpoint-xl` | 1280px | Desktop |
| `--content-measure` | 45rem / 720px | Prose / long-form reading width (~75ch at base size) |
| `--layout-max` | 75rem / 1200px | App-shell / dashboard maximum width |

**Implementation gotcha, flagged now rather than discovered later:** CSS
custom properties **cannot** be referenced inside a `@media` condition in
current CSS (`@media (min-width: var(--breakpoint-md))` is not valid). These
breakpoint values are the source of truth for `tokens.json` (consumable by
build tooling / JS) — hand-written CSS media queries should hardcode the
matching px value with a comment naming the token, e.g. `/* --breakpoint-md */`.

**Container padding** (reuses the spacing scale — no new values):

| Viewport | Horizontal padding |
|---|---|
| < 480px | `--space-4` (16px) |
| ≥ 480px | `--space-6` (24px) |
| ≥ 1024px | `--space-8` (32px) |

**Mobile-first worked example, at the 375px floor this system is required to
clear:** viewport 375px, `--space-4` padding each side → 375 − 32 = **343px**
usable content width. Every component in the eventual style reference (AS-29)
and wireframes (AS-30) needs to make sense inside 343px before it's allowed
to get wider — single-column stacking below `--breakpoint-sm`, no
fixed-width element that exceeds it.

### 6.5 Suggested token implementation pattern

Illustrative only — **AS-29 authors the complete `tokens.css` / `tokens.json`.**
This shows the intended two-layer (primitive → semantic) shape and one way to
wire up both system-preference and an explicit override, so light/dark aren't
an afterthought:

```css
:root {
  /* primitives (excerpt) */
  --color-ink-50:  #F8F8FA;
  --color-ink-900: #1F232B;
  --color-ink-950: #121519;
  --color-accent-400: #4E6AE9;
  --color-accent-600: #1836BF;

  /* semantic aliases — light is the unguarded default */
  --color-bg-canvas: var(--color-ink-50);
  --color-text-primary: var(--color-ink-900);
  --color-accent-solid: var(--color-accent-600);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg-canvas: var(--color-ink-950);
    --color-text-primary: var(--color-ink-50);
    --color-accent-solid: var(--color-accent-400);
  }
}

:root[data-theme="dark"] {
  --color-bg-canvas: var(--color-ink-950);
  --color-text-primary: var(--color-ink-50);
  --color-accent-solid: var(--color-accent-400);
}
```

The requirement is: system preference is respected by default, and an
explicit user/app override wins in both directions. The exact selector
strategy is AS-29's implementation call.

---

## 7. The brand never does this

Constraints, not flourishes, are what make a v1 brand coherent. Each rule
below is concrete enough to check a specific pixel or a specific sentence
against — a refusal without a reason is just an opinion, so each carries one.

### A. Imagery & color

1. **No flags, stars-and-stripes motifs, eagles, bunting, fireworks, or any
   literal patriotic iconography** — anywhere, in anything that nests under
   this brand. The entity name contains "American"; the visual system never
   illustrates it. This is the single most concrete refusal here because it's
   the one people reach for by reflex.
2. **No red, ink, and blue composed together in a flag-like arrangement**
   (stripes, a star field, tricolor blocking) — even incidentally. `--color-danger-*`
   and `--color-accent-*` each have their own functional job (§3) and are
   never staged together decoratively.
3. **No stock photography of people, no illustrated mascots or characters, no
   generic "diverse team" imagery.** Zero spend forecloses licensed
   photography anyway; a mascot is a different craft this document doesn't
   commission.
4. **No gradients, glassmorphism, neumorphism, or other decorative surface
   trend used for its own sake.** Flat color, real contrast, real type —
   legible before it's fashionable.
5. **No decorative drop shadows, glows, or multi-layer "soft UI" shadows.**
   `--shadow-sm` / `--shadow-md` (§6.3) are functional elevation cues only.

### B. Type & voice

6. **No typeface beyond the two named in §4** without a written amendment to
   this document. No display, script, or decorative faces.
7. **No Inter weight below 400 or above 700 in running use** — Thin/Light
   read as fragile at UI sizes, ExtraBold/Black read as shouting; neither
   matches this brand's personality (§1).
8. **No text below its documented AA ratio** outside the two tokens explicitly
   marked exempt/decorative in §3.4 (`--color-text-disabled`,
   `--color-border-hairline`). "Muted" is never an excuse to drop under 4.5:1
   for content someone is meant to read.
9. **No hype copywriting** — revolutionary, seamless, game-changing,
   next-generation, empowering, unlock, supercharge, cutting-edge,
   best-in-class. If a claim needs a superlative to land, it needs a citation
   instead (§2 rule 5).

### C. Components & interaction

10. **No fully-rounded (`--radius-full`) treatment on standard buttons, cards,
    or containers** — reserved for genuine pills, avatars, and badges only
    (§6.2).
11. **No emoji as functional UI iconography** (status indicators, button
    icons, navigation). Fine in informal chat; not on a brand-governed
    surface.
12. **No dark patterns** — disguised opt-outs, manufactured urgency (fake
    countdowns), pre-checked paid add-ons, confirm-shaming copy. Consistent
    with the audit-trail transparency this company already runs on
    internally (`CLAUDE.md`) — it doesn't stop at the company's own edge.

### D. Scope & spend

13. **No licensed or paid typefaces, icon sets, illustrations, stock assets,
    or design tooling.** Zero spend is absolute (`PHILOSOPHY.md` #6);
    anything that would cost money is a board ask (§10), never a purchase.
14. **No binary or externally-hosted design assets in this repository** —
    every artifact here is markdown, tokens, or hand-authored static
    HTML/SVG that a developer-agent can read as text.
15. **No animated or video logo treatment in v1** — no Lottie, no GIF, no
    motion-driven brand moment. Static only, matching this phase's
    deliverable shape.
16. **No product name, product iconography, or product-specific visual
    metaphor anywhere in this document.** That's intentional and structural
    (§1), not an oversight. If you came here looking for what a specific
    product should look like, that's Phase B (Lattice AS-30), gated on a
    product brand existing.

---

## 8. v2 candidates

Ideas that came up while building this and were deliberately not built,
logged instead of chased — the acceptance list for A1 was fixed before
starting (§0), and this section is where further ideas go instead of
reopening it.

- **A compact monogram / icon mark** for contexts a full wordmark can't fit
  (favicon, avatar, GitHub org image). Explicitly deferred, not designed here
  — the plan's default for this phase is wordmark-only
  (`docs/design/00-frontend-design-plan.md` §7 Q3), and a monogram is a
  distinct design problem (it has to work at 16×16px) that deserves its own
  pass rather than a rushed afterthought.
- **A distinct display/headline typeface** beyond Inter, if a future product
  brand wants more visual differentiation than the quiet parent should have.
  Two faces is the right number for an entity that's deliberately not
  competing for attention (§1); a third is a product-layer decision, not a
  parent-layer one.
- **An open-license icon set recommendation** (e.g., Lucide — ISC license —
  or Heroicons — MIT) for AS-29's component states (error icons, chevrons,
  etc.). Not chosen here because A1's brief didn't ask for iconography and
  choosing one deserves the same verification rigor §4 gave the typefaces,
  not a rushed pick under this ticket's time-box.
- **A charting/data-visualization palette**, if a future product surfaces
  data. Deliberately not derived from `--color-accent` by mechanical rotation
  here — that's its own considered exercise, not a byproduct of this one.
- **Motion/transition tokens** (easing curves, duration scale) — v1 ships
  static per §7.D.15; a restrained transition system is a reasonable v2
  addition once there's an actual interactive surface to apply it to.

---

## 9. Gaps & open items

Shipped honestly labeled rather than stalled on, per this ticket's time-box
default.

- **Product naming and any product-brand extension of this system** are
  explicitly out of scope here (§1) and tracked as their own gated exercise
  (`docs/strategy/09-company-name.md` §3.3). Not a gap in this document —
  a deliberate boundary.
- **`Carla Voss's ack of Sofia reporting to her`** (plan §7 Q1) is tracked in
  `personnel/designer-sofia-andrade.md`, not here — doesn't affect this
  document's content and isn't reopened by it.
- **Icon set, chart palette, motion tokens, monogram** — see §8. Named as
  gaps there rather than guessed at here.
- **This document has not yet been read and adopted by the CEO or CTO** — per
  the plan (`docs/design/00-frontend-design-plan.md` §4 A1), that read is a
  condition of "adopted," not of "shipped." It's committed to master now;
  sign-off is a separate event this document doesn't self-certify.

---

## 10. Board asks

**None.** Every typeface, color, and artifact in this document is zero-cost
and license-verified (§4, §11). No purchase, license, or external signup is
needed to build AS-29 from this document as written. If a future product
brand needs something this parent system doesn't cover — a paid icon set, a
distinct display face, stock photography — that request follows the same
process this document didn't need: cost, alternatives, and rationale, written
up for the board before anything is bought (`PHILOSOPHY.md` #6).

---

## 11. Appendix — contrast verification method

Every ratio in §3.4 was computed with the standard WCAG 2.1 relative-luminance
formula, run in a throwaway Node script (not eyeballed, not estimated from a
color-picker preview):

1. For each channel (R, G, B in 0–255), normalize to `c = C / 255`.
2. Linearize: `c_lin = c/12.92` if `c ≤ 0.03928`, else `((c + 0.055) / 1.055) ^ 2.4`.
3. Relative luminance: `L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin`.
4. Contrast ratio: `(L_lighter + 0.05) / (L_darker + 0.05)`.

Primitive scales were generated from HSL (hue, saturation fixed per scale;
lightness stepped) rather than hand-picked, specifically so the palette can
be extended later by reusing the same hue/saturation instead of guessing a
new hex (§3.1 records the exact hue/saturation per scale). Every pair that
appears in §3.4 was run through this exact formula; the two pairs that
initially failed (dark-mode `accent-solid` and `danger-solid` boundary
contrast) were caught this way, moved to a different step in the same scale,
and recomputed until they passed — see the note at the end of §3.4. Typeface
license claims (§4.1) were verified by fetching the authoritative
`LICENSE.txt` / `OFL.txt` directly from each project's official GitHub
repository on 2026-08-31, not recalled from memory — one of the two
(JetBrains Mono) turned out to be commonly misremembered as Apache-2.0 for
the font itself, when that grant actually covers only the repository's
separate build tooling. That correction is exactly why this section states
the method: so the next person extending this palette or re-checking these
fonts can reproduce the result instead of trusting it on faith.
