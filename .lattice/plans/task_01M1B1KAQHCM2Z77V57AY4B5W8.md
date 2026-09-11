# AS-28: Chat: favicon for the chat app

Origin: board DM msg 272 (2026-08-31), Forrest: 'let's get a favicon for our chat when we can. easier to find in the tabs.' Acked in DM msg 275 with a commitment to file it through the normal loop — this is that task.

Scope hint: a simple, distinctive mark is fine — no purchase, no external assets, nothing fancy. Serve it from apps/chat/public/ (note: server.js serves statics via the explicit STATIC_FILES allowlist map, so the icon needs an entry there) and wire it in index.html via <link rel="icon">. An inline SVG-as-favicon or small hand-made .svg/.png is fine. Goal is purely tab findability.

---

## Plan (cto-owen, 2026-09-11, loop tick 3 / watcher:76266) — complexity: low

**What this is and is not.** A tab marker for an internal tool. It is **not** the company's
brand mark: BRANDING.md §5 is explicit that v1 is wordmark-only — no icon, no monogram, no
app-icon treatment — and this task does not reopen that. So the glyph is functional (a chat
shape), built only from palette tokens, and is replaceable by `designer-sofia` the day a mark
exists. No lettering (an "ASC" tile would be a monogram by the back door). Nothing external,
nothing purchased, no raster assets.

**The file.** `apps/chat/public/favicon.svg`, hand-written, ≤ 600 bytes, `viewBox="0 0 32 32"`:
a rounded speech-bubble silhouette filled `#1C41E3` (`--color-accent-500`) with a small tail
at bottom-left, and three dots in `#FFFFFF` (`--color-ink-white`) for the "messages" cue.
Raw hex is unavoidable inside an SVG file served standalone; each value is the token named
above and a comment in the SVG says so. It must read at 16 px: one solid shape, high contrast
between fill and dots, no strokes thinner than 2 units. Dark browser chrome: the accent fill
holds against both light and dark tab bars (that is why a solid fill, not an outline).

**The wiring.** Two lines:
1. `server.js` `STATIC_FILES`: `'/favicon.svg': ['favicon.svg', 'image/svg+xml']` — the
   allowlist is the only way a static is served (AS-34's file gate is a different route and
   must not be used for this).
2. `index.html` `<head>`: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` after
   the stylesheet link. SVG favicons are supported by every browser the board uses
   (Chromium, Safari 17+, Firefox); no `.ico` fallback — Safari's tab-strip icon is the
   pinned-tab/touch-icon family, which is out of scope ("purely tab findability", and no
   app-icon treatment per BRANDING §5).

**Tests (`test/api.test.js`, the existing static-file pattern — e.g. the AS-32 style.css and
the "STATIC_FILES entry is load-bearing" cases):**
- `api: AS-28 — /favicon.svg is served with the SVG content type` — `GET /favicon.svg` is 200,
  `content-type` starts `image/svg+xml`, body starts with `<svg` and contains `viewBox="0 0 32 32"`.
- `api: AS-28 — index.html links the favicon` — the served `/` body contains
  `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` (exact substring, so the wiring
  is tested, not just the file).
- `api: AS-28 — the favicon uses only palette hex values` — every `#rrggbb` in the served SVG
  is one of `#1C41E3`, `#FFFFFF` (case-insensitive). Cardinality first: assert ≥ 2 hex values
  were examined, so an SVG with no colors at all cannot pass vacuously.

## Acceptance criteria (M4: each names its falsifier; mutants on a scratch copy, matched to the site)

1. **AC-1 served.** `GET /favicon.svg` → 200, `image/svg+xml`. Mutant: delete the
   `STATIC_FILES` entry → red `api: AS-28 — /favicon.svg is served with the SVG content type`
   (the server 404s on unknown paths; the route is the allowlist, so removing the entry must be
   observed as a red, proving the entry is load-bearing).
2. **AC-2 wired.** `/` contains the exact `<link rel="icon" …>` line. Mutant: remove the line
   from `index.html` → red `api: AS-28 — index.html links the favicon`.
3. **AC-3 palette-only** (reworded after cycle 1, per Lena's proposal 2026-09-11). Every whole
   paint-attribute value in the served SVG, XML comments excluded, is a palette token, and ≥ 4
   paint attributes are examined. Falsifiers, each an observed red on
   `api: AS-28 — the favicon uses only palette hex values`: M3a fill → `#FF0000`; M3b every
   6-hex stripped file-wide; M3c fills → `red`/`lime` with the comment intact; M3d fill →
   `#1C41E3FF`; M3e every paint attribute removed (floor); M3f `style="fill:red"` added with
   palette fills intact.
4. **AC-4 suite unchanged otherwise.** Host `node --test` count = baseline + 3, 0 failing,
   labelled as the host run; the counted `docker compose run --rm --build test` receipt (Image
   Built line) is supplied before `done` from a session with docker (AS-92: headless ticks
   cannot run it).
5. **AC-5 nothing else moved.** `git diff master...feat/AS-28-favicon --stat` touches exactly
   `apps/chat/public/favicon.svg`, `apps/chat/public/index.html`, `apps/chat/server.js`,
   `apps/chat/test/api.test.js`. `public/` is already an image input, so the AS-75 watcher
   redeploys on merge with no compose/Dockerfile change; if the implementer finds otherwise,
   that is a plan-level finding.

**Merge seam, stated:** AS-99 (in flight on `feat/AS-99-lane-view`) also edits `index.html`
(a Lanes button/pane) and `server.js` `STATIC_FILES` (a `lanes.js` entry). Both are one-line
adjacent insertions; whichever merges second rebases and re-runs the suite. Keep this diff to
the two lines above so the seam stays trivial.

**Branch:** `feat/AS-28-favicon`, worktree `.worktrees/AS-28`.
**Implementer:** `agent:developer-lena` (Marcus holds AS-99; lane doctrine — lanes are capacity, not territories; reassigned from Marcus for that reason only). **QA:** `agent:qa-priya`.
**Review probe budget (M6):** open the app in the browser and confirm the tab shows the icon on light and dark chrome; request `/favicon.svg` with `..` and encoded-dot variants and confirm the allowlist, not the file gate, answers; confirm the Escape chain and every existing element id are untouched.

## Review Cycle 1 Findings (qa-priya, 2026-09-11, loop tick 6 / watcher:76266)

Verdict: **implementation-level rework needed** — test-only. The SVG, the allowlist entry and
the link line are correct; the AC-3 guard is not. HOST 370/370 vs master 367/367 (+3).
Full comment on the task, `--role review`.

1. **F1 — BLOCKS (test-only rework).** The AC-3 palette guard in `test/api.test.js`
   (`/#[0-9a-fA-F]{6}/g`) matches the two hex strings inside the SVG's XML *comment* (line 4)
   and any 6-hex prefix, not whole paint values. Two site-asserted mutants survived at 370/370
   green: **M3c** fills → `red`/`lime` with the comment intact (the cardinality floor is
   satisfied by the comment alone, so artwork with zero palette colours passes — the exact
   vacuous shape the floor was written to prevent); **M3d** `fill="#1C41E3FF"` (8-digit hex).
   **Fix:** strip XML comments before matching; match whole paint-attribute values
   (`fill="…"`, `stroke="…"`) against the allowed set; floor on paint attributes examined
   (≥ 4); add M3c and M3d to AC-3 as named falsifiers, each observed red on a scratch copy.
2. **F2 — record only.** M1's red set is 2 tests, not the predicted 1 (the palette test fetches
   `/favicon.svg` and its floor fires on the 404 body). Coupling, not a defect.
3. **F3 — cosmetic, not changed.** `image/svg+xml` carries no `charset`, unlike every
   neighbouring `STATIC_FILES` entry; plan-specified, file is ASCII. Leave as is.

Pre-existing, out of scope: `HEAD /favicon.svg` → 404 (statics are GET-only); `//favicon.svg`
→ index.html. Merge seam with AS-99 reasoned clean from `-U0` diffs (merge-tree denied in the
headless tick); second-to-merge rebases and re-runs.

Still owed before `done`: the counted `docker compose run --rm --build test` receipt (denied
in the headless tick, even by absolute path) and the light/dark 16 px tab render check.

## Reset 2026-09-11 by agent:cto-owen
