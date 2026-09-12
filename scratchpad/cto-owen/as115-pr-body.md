## What
Commit hashes (7–40 char hex, word-bounded) and branch names (`feat/AS-<n>-<slug>` shape) inside chat message bodies render as an inline chip that, on plain click, copies the literal matched text to the clipboard and shows a brief "copied" state. No navigation, no href. Modified clicks and text selection keep working.

## Why
Board DM msg 793 (2026-09-11): "I think we need to make commit hashes/branch names in chat messages clickable to copy." The board reads hashes and branch names in tick reports and review comments and wants to paste them into a terminal without drag-selecting a 7-character token.

## Plan
`.lattice/plans/task_01M28WQ53NHZFJB9SKGXX7X5BT.md`

## Acceptance criteria
**Test-guarded (19, all passing — QA review by `agent:qa-ruben` on the task):** AC-1..AC-19 in plan §8a — recognition fixtures P1–P12 / N1–N18 / BP1–BP7 / BN1–BN8, junk tolerance, right-boundary rule, leaf-chain ordering (hash inside a URL is not a hash; branch before AS-refs; hash after msg-refs; branch inside a URL is not a branch; `autolink:false` yields no url/branch/hash tokens), whole-chain round-trip, `tokenizeAsRefs` moved to `leaf-refs.js` with identical behaviour, `public/tokens.css` byte-identical to `docs/design/tokens/tokens.css`, the chip assigns no `href` (pinned count of href assignments in `app.js` unchanged at 9 and 0 `setAttribute('href'`), `index.html` links tokens before style with `data-theme="light"`, `.copy-ref` rules use tokens only.

**Manual browser checks (10, plan §8b) — NOT PERFORMED by anyone; this is why the merge is held for the board:**
- C1 click a chip in `#lattice-events`, paste → exactly the hash
- C2 success colouring appears, clears after ~1 s; second click restarts it
- C3 Tab to a chip, Enter, then Space → each copies; focus ring visible
- C4 Cmd/Ctrl-click and middle-click → nothing copies, no navigation
- C5 drag-select across a sentence containing a chip, copy, paste → chip text inside the selection
- C6 hash inside a code span and inside `**bold**` → one chip look, bold preserved
- C7 markdown link whose label contains a hash → no chip; link navigates
- C8 with `navigator.clipboard` undefined, click → chip text becomes selected, no "copied" state
- C9 OS dark mode on, reload → page and chip both light
- C10 a branch name in `#engineering` → one chip covering the whole name; the `AS-n` inside it is not a separate link; an `AS-n` elsewhere in the message still links

## Review
QA (Ruben) recorded PASS on the 19 test-guarded criteria at `124440b`: 11 mutants run, 11 red, 0 survivors; host 569/568/1 skipped; compose (`--build`, receipt `Image asc-review-as115-test Built`) 569/562/7 skipped/0 fail; scratch merge with AS-98 (now on master) clean. Full comment on the Lattice task.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
