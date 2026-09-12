# AS-125 implementation — progress note (developer-marcus, on Opus under Fable fallback)

Branch `feat/AS-125-cascade-guard-routes`, worktree `.worktrees/AS-125`, base 7181486.
One file: `apps/chat/test/roster-truncation.test.js`.

## Steps
- [x] 1. Baselines: host 612/610/0/2 (matches); compose base `Image asc-impl-as125-test Built` 612/604/0/8 exit 0 (caveat: §2.1 edit landed while the build ran; count unaffected — no case added yet)
- [x] 2. Implement §2.1–§2.8 — d083ca7 (guard + H4), 7690a5a (H7–H9). Host at tip 615/613/0/2; file alone 10/10.
- [x] 3. §3 battery: 21/21 match (19 red as predicted, N1/N2 green, 0 mismatches). F9 first attempt aborted by my own site check (check too loose — counted `won.selector` assert; mutation had applied), re-run with array-scoped check → {H9}. Extra run G1+A3: T1 green, {H9} only — H9 load-bearing, observed. Log: `mutants.md`.
- [x] 4. Final counts: host 615/613/0/2, file alone 10/10; compose at tip `Image asc-impl-as125-test Built` 615/607/0/8 exit 0 leak clean (`compose-tip.out`); merge-tree vs master clean (931e7f4…); vs AS-109 and AS-124 clean; diff stat one file +194/−17; $W porcelain empty; /tmp/AS-125-mutant removed; `--check` no leftovers.
- [ ] 5. Lattice comment
- [ ] 6. #engineering message

## Decisions (boring choices, recorded)
- Did NOT add the optional `raw` field to rules (plan §2.3 "optional") — no message uses it; one less field.
- C2's offset is into the comment-stripped source, not the file — message says "offset" only. Left as-is; noting on the task.
- H7(a) is two `assert.throws` on the same input (depth-1 regex, opened-by regex) rather than one combined regex — each half fails on its own.

## Log
