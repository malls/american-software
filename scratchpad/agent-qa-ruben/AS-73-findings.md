# AS-73 findings (qa-ruben) — recorded BEFORE reading Lena's comment or the daemon artifact

Battery: M1 {T1,T3} exact, M2 5/5 exact, M3 {T4} exact, 0 survivors, restores hash-proven, 474/474 after each (AS-73-mutations.log).
Worktree `git status --porcelain` after all work: empty.

F-1 convention (plan wording), non-blocking: AC-1's grep for the quoted fence hits 2 code lines
  (40 hasLeadingFence; 54 the CLOSING-fence test in parseFrontmatter's loop). Intent met: the
  regex-fence grep hits only the doc comment at line 38. Propose reword.
F-2 plan record, non-blocking: AC-12's compose expectation (470, delta 4) was derived from AS-100's
  receipt on b0763ad, not from b1bba80; AS-61 (6b14c38) and AS-72 (79d639d, 1ca6059, 5a362db, 57ebf2a)
  added cases between the two. Observed compose 474 = host 474, delta 0 — the healthy state.
  Post-merge expectation on master e5de119: 478 + 6 = 484.
F-3 plan recipe, non-blocking: M1's whole-file "regex occurs once" assert is false against the
  implementation — hasLeadingFence's doc comment quotes the old regex, so the count is 2; the
  site-anchored count inside readPersonnel is 1. Recipe should anchor to the function (AS-95 rule).
F-4 note: CR-only (classic Mac) line endings — a valid dossier is silently dropped by parser AND
  classifier. Agreement holds; pre-existing; no live file affected. Not in scope.
Disproved suspicion: parity guard's work/moreTasks are NOT trivial — fixture root carries .lattice
  with 3 tasks for agent:eng-ada.
Merge seam vs master e5de119: master touched stream/watcher tests + advance-watcher.mjs + exports
  only; no overlap with the six AS-73 files; merge-tree dry run clean.
