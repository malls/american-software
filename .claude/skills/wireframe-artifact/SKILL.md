---
name: wireframe-artifact
description: Publish or refresh the viewable wireframes artifact — the D1 core-loop screens (AS-30) as one hosted page. Use when docs/design/wireframes/ changes, or when the board asks to see what the product should look like.
---

# wireframe-artifact — publish the wireframes as something you can look at

`docs/design/wireframes/` is the product's UX spec: seven zero-JS HTML screens
plus an index, sharing `wireframe.css` and the AS-29 tokens. They render from
the repo with no build step — but the board's interface is the chat app, and
its file viewer serves markdown only. This skill stacks the eight pages into
one hosted Artifact so the board can *look at* the screens.

## The derivation chain (read this before regenerating)

```
BRANDING.md → docs/design/tokens/tokens.css      ← look (AS-29; brand-artifact skill)
docs/design/wireframes/01-screens.md             ← screen inventory + §6 wireframe conventions
docs/design/wireframes/02-states-ledger.md       ← every state on every screen
  └─ docs/design/wireframes/screen-N-*.html      ← the eight source pages (AS-30)
       └─ the Artifact                           ← what this skill publishes
```

**This skill does not redesign anything.** It concatenates the source pages,
inlines the two stylesheets, and rewrites cross-page links so they resolve
inside one page. A change to what a screen shows is engineering work on the
wireframes (Lattice task, UX owner `agent:ux-jonah`) — not an edit here.

## Steps

1. **Locate the design directory.** Normally `docs/design` on master. If an
   unmerged wireframe task is in flight, it lives in that task's worktree —
   check `git worktree list`.

2. **Build the single-file page:**
   ```
   node .claude/skills/wireframe-artifact/build.mjs <design-dir> <scratch>/wireframes.html
   ```
   The script inlines `tokens.css` + `wireframe.css`, extracts each page's
   `<body>`, namespaces the per-page `id="main"` landmark, rewrites
   `screen-N-*.html[#id]` links to in-page anchors and `NN-*.md` links to
   GitHub, and emits `<title>` + `<style>` + markup (the publish step supplies
   the document wrapper). It **throws** rather than publishing a half-page on:
   a screen count other than 7, a near-empty stylesheet, a body under 1 kB,
   duplicate ids after stacking, an unrewritten relative link, a dangling
   in-page anchor, or any `<link>/<script>/<img>/<iframe>` (the Artifact CSP
   would silently block it). Each check prints its cardinality; a green run
   says what it counted.

3. **Publish to the SAME artifact**, using the URL in `artifact-url.txt`:
   ```
   Artifact(file_path: "<scratch>/wireframes.html", url: "<contents of artifact-url.txt>")
   ```
   Read it first (`action: "read"` with that url) if this conversation has not
   already published it — a publish to an artifact the session has not read
   is refused.

## Rules that keep the artifact stable

- **Same URL, always.** Passing `url` updates in place; omitting it creates a
  second artifact. If you ever must create a new one, update
  `artifact-url.txt` in the same commit.
- **Same title, same favicon.** The title lives in `build.mjs`; the favicon
  was set once at first publish. Omit `favicon` on redeploys.
- **Never hand-edit the generated HTML.** A fix belongs in
  `docs/design/wireframes/`.
- **The stacking shim is artifact-only.** `build.mjs` appends a few
  token-only rules (`.wfa-*`) for section boundaries and the jump list. They
  are not part of the wireframes and must not be copied back into
  `wireframe.css`.
- **Wireframe annotations stay visible.** The source marks annotation copy
  with `data-wf-note` (hidden only under `@media print`). The artifact is a
  screen view, so annotations show — that is intended; they are the spec.

## Record

- Artifact URL: `.claude/skills/wireframe-artifact/artifact-url.txt`
- First published 2026-09-01 from master after the AS-30 merge, closing the
  board's ask for "artifacts for what it should look like" (#board msg 283)
  and "let's get going on the wireframe stuff" (DM msg 367).
