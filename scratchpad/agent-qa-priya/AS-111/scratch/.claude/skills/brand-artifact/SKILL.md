---
name: brand-artifact
description: Publish or refresh the viewable brand artifact — the company's visual identity as a hosted page. Use when BRANDING.md or the design tokens change, or when the board asks to see what the brand looks like.
---

# brand-artifact — publish the brand as something you can look at

`BRANDING.md` is the brand's source of truth, but nobody can *see* a markdown
file. This skill publishes the rendered style reference as a hosted Artifact so
the board can look at the brand instead of reading a spec.

## The derivation chain (read this before regenerating)

```
BRANDING.md                     ← source of truth, hand-authored by designer-sofia
  └─ docs/design/tokens/         ← tokens.css + tokens.json, derived (AS-29)
       └─ style-reference/       ← static page rendering every token
            └─ the Artifact      ← what this skill publishes
```

`docs/design/tokens/tokens.test.mjs` pins `BRANDING.md` to the tokens and fails
loudly on drift, so the page cannot silently disagree with the doc.

**This skill does not re-derive anything.** It inlines the existing style
reference. So if `BRANDING.md` changed, the tokens and the style reference must
be updated *first* — that is engineering work and gets a Lattice task. Running
this skill against stale tokens publishes a page that faithfully shows the old
brand. Run the token suite first; if it fails, the artifact is not the thing to
fix.

## Steps

1. **Locate the design directory.** Normally `docs/design` on master. While
   AS-29 is unmerged it lives in the worktree — check `git worktree list`.

2. **Verify the tokens still match the doc** (skip only if you just ran it):
   ```
   cd <design-dir>/../.. && node --test 'docs/design/tokens/*.test.mjs'
   ```
   A failure here means the page would misrepresent `BRANDING.md`. Fix that
   first.

3. **Build the single-file page:**
   ```
   node .claude/skills/brand-artifact/build.mjs <design-dir> /tmp/brand/brand.html
   ```
   The script inlines `tokens.css` and `reference.css` (the Artifact CSP blocks
   external stylesheets) and strips the `<!doctype>/<html>/<head>/<body>`
   wrapper, which the publish step supplies. It throws rather than emitting a
   half-page if a stylesheet comes back near-empty or the body markers drift.

4. **Publish to the SAME artifact**, using the URL in `artifact-url.txt`:
   ```
   Artifact(file_path: "/tmp/brand/brand.html", url: "<contents of artifact-url.txt>")
   ```
   Read the artifact first (`action: "read"` with that url) if this conversation
   has not already published it — a publish to an artifact the session has not
   read is refused.

## Rules that keep the artifact stable

- **Same URL, always.** The board bookmarks and shares this link. Passing `url`
  updates in place; omitting it silently creates a second artifact. If you ever
  do create a new one, update `artifact-url.txt` in the same commit.
- **Same title, same favicon.** The title lives in `build.mjs` and the favicon
  is set once, at first publish. Omit `favicon` on every redeploy — viewers find
  the tab by its icon, and a changed icon reads as a different page.
- **Never hand-edit the generated HTML.** It is rebuilt from source every run.
  A fix belongs in `BRANDING.md`, the tokens, or the style reference.
- **Do not redesign the page.** It renders the company's own design system using
  the company's own tokens. Imposing a different palette or typeface would
  defeat the point — the artifact's whole job is to show the brand as specified.

## Record

- Artifact URL: `.claude/skills/brand-artifact/artifact-url.txt`
- First published 2026-08-31, from `feat/AS-29-design-tokens` pre-merge, at the
  board's request in Claude Code chat ("wheres the artifact showing the brand?").
