# AS-127 progress — developer-lena (tick watcher:79108 loop tick 12, Opus fallback)

## Rebase
- Branch feat/AS-127-contract-create rebased onto master ace4d09 (post-AS-49). No conflicts (branch had no code commits).
- AS-48 NOT merged yet (in review, parallel lane). Plan §10 order rule AS-49 -> AS-48 -> AS-127 still intended;
  §10 step 4 (dashboard.ejs/invoice-detail.ejs anchors, CTA swap, read-screens flips) WAITS for a rebase onto a
  master containing AS-48. If AS-48 is sent back and AS-127 reaches done first, the "order breaks" branch applies.
- SEAM NOTE for that rebase: AS-48 also edits test/invoice-screen.test.js; this branch moved two literals there
  (TEMPLATE_LINKS 17->24, state-id sweep templates 4->5) that the plan did not name. Recount both again then.

## Done (commits on the branch, oldest first)
- 0c317d3 view model + template + routes + anchors + export + views.js row + css
- a6119b1 literal recounts (route-surface 25/24/19, auth G15 25, health VIEWS 5, dep-policy 58 / expectFiles 6 x4 /
  P4 templates 5, contracts P8 4 + Y2 list, invoice-screen 24 + 5, Y1 comment word)
- 8b75e52 cases 1-19 + post helper + case 21/28 flips
- f775dc0 VIEW_START_TAGS = 87+43+208+60+183 (=581, read off the run-2 failure); cases 12/13/19 test-side fixes
- run3: test 487/468/0/19, `Image asc-impl-as127-lena-test Built`, exit 0
  (461 baseline + 7 AS-49 + 19 ours = 487; skipped 18 -> 19 is AS-49's)

## Decisions made in the open (record in the implementation comment)
- Q3 labels: from the declaration (`label` present on both form variables) — equal to the wireframe's.
- S6-ERROR-SYSTEM marker: the sentence is a literal in the template's `isSystem` branch (contract-detail.ejs
  shape), banner null in the view model for that state; submit reads "Try again".
- Case 6 (iii): API 400 body is `ValidationError: create\n` (fail prints step, not field — P3's own body);
  the field is confirmed by `generate` throwing ValidationError with `.field === name`.
- Route catch: ValidationError naming a DECLARED field -> that field marked (submission patched, no new
  view-model input); any other ValidationError -> S6-ERROR-SYSTEM (F19's prediction holds).
- invoice-screen.test.js: two literals moved although plan §2 said "not modified" — recorded deviation.
- assets.test.js APP_CSS_* did NOT move (selector-list edits only) — confirmed by run 1 not failing there.

- f74f353 README (§ Contracts present tense + R1 sentence, § Obligations discharged, § Layout count);
  `grep -n 'is AS-127.s\|when AS-127 lands\|until AS-127' README.md` = 0 hits, R1 sentence once
- run3 contract: 487/487/0/0, `Image asc-impl-as127-lena-contract Built`, exit 0
- compose project asc-impl-as127-lena torn down (`down --rmi local` exit 0; the two run-built images
  removed by name afterwards; 0 asc-impl-as127-lena* images left)
- TIP at end of tick 12: f74f353. Zero .lattice paths in master...branch diff. 16 files, +1360/-75.

## Tick 13 (stage 2)
- REBASED onto master dfdb136 (post-AS-48, code tip 4f4ef1b). 12 files conflicted across the 5 commits; resolved
  per plan §10: routes order POST /contracts -> GET new -> POST new -> GET view -> GET :id; views.js ours last (7);
  P8 5 + list; Y2 5-list; case 28 = detail 7 + form 6 = 13 (predicted); route walk 29/28/23 (predicted);
  G15 29; source 63; expectFiles 8; P4 7; TEMPLATE_LINKS 49 (predicted); state sweep 7;
  VIEW_START_TAGS 87+47+210+66+135+103+185 (predicted). New tips: c17a42d d257616 9b5b27f 52ec5cd b9670c0.
- 3166ba5 step 4 hand-offs done (dashboard/invoice-detail anchors, contract-form Dashboard anchor, CTA swap
  incl. dashboard-view.js COPY.invoiceCta relabel — file NOT in plan §2, recorded deviation; read-screens flips
  NEW_TEMPLATE_LINKS 17->20 + named-three-links filter; case 3 nav 4 entries; README obligations + partials
  revisit trigger fired (nav change in 4 files) recorded as follow-up, not done).
- run4 test: 511/492/0/19 `Image asc-impl-as127-lena-test Built` exit 0 (492 master + 19). All predicted literals
  held green on first run (equality-pinned; none read off a red). run4 contract: 511/511/0/0 Built, 0 images left.
- §8 battery done (battery.mjs, battery-results.jsonl): 16 recipes, 0 survivors after two instrument fixes
  (fe95641 case 14 asserts S6-DEFAULT/200; 4563f42 case 28 drives sign-out last + lost-session tripwire).
- §5 eyes done (visual.mjs, visual/): 12 renders at measured 375px, scrollWidth 375 everywhere, textarea 343/343.
- FINAL tip 4563f42: test 511/492/0/19 Built, contract 511/511/0/0 Built, torn down, 0 as127 leftovers.
- Stage-2 comment posted (comment-stage2.md). Split line exceeded (1,609 vs 1,200) — flagged as finding 3.
- STAGE COMPLETE; review-ready. Orchestrator moves to review (Ruben).

## Remaining (next tick resumes from the branch)
- Mutant battery (plan §8), on a `git archive HEAD` extract, isolated project per recipe, `--build`, assert
  applied in image, restore + `git diff --exit-code`: F1, F2, F4, F6, F9, F10, F11a, F12 (both ends), F19,
  F-ta, F15, F8-dup, F-count, F-nav (two runs), F-order-P8 (not a mutation — quote P8's list).
  Anchors as built: F4 = `err.entity === 'client'` in routes/contracts.js POST /contracts/new catch;
  F10 = `switch (submission.intent)` default; F19 = `for (const variable of formVariables())` in parseContractForm;
  F-ta = the line break after `rows="3">` / `aria-describedby="<%= field.name %>-error">` in contract-form.ejs;
  F-count = `attentionTitle(errorCount)` in contractFormLocals' S6-ERROR-VALIDATION branch;
  F15 = the `default:` branch (new-client) in the route; F8-dup = `repos.clients.findByEmail(` in the route.
- §5 375px eyes half (isolated `web` on 127.0.0.1:8360, `-p asc-as127-visual`) + record in the Lattice comment
- Final receipts after the mutant pass (rebuild), then the implementation comment (counts, mutants, seams, deviations)
- Orchestrator moves to review; do NOT change status from here.
