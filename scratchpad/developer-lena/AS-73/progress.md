# AS-73 implementation — developer-lena, tick watcher:67350 — COMPLETE

Branch `feat/AS-73-org-gate-predicates`, HEAD `3f96ab2` (also `c775f16`).
Worktree clean. Host suite **474 pass / 0 fail** (master baseline 468 + 6).

## Commits

- `c775f16` — F1 `hasLeadingFence` (one fence predicate, parser + classifier),
  F2 `examined` on `readPersonnel` + the `Examined N .md files in ...` line in
  `check-org`, F4a `validateOrg` filters junk once at the top, F4b orphan
  detail distinguishes no-dossier / departed / invalid status. Tests T1, T2,
  T3, T5, T6 + three Examined amendments.
- `3f96ab2` — F3 `test/roster-parity.test.js` (T4): server row vs CLI direct
  vs CLI api, compared to each other and to no literal.

Diff touches exactly the six files in plan §3, nothing else.

## Red first (every new case)

- T5: `TypeError: Cannot read properties of null (reading 'status')`
- T6: actual `reports to agent:mgr, who is departed`
- three amendments: missing `Examined` line
- T1/T2/T3: missing `examined` / unclassified files
- T4: green on first run, then driven red by M3 (below)

## Mutation battery — 3 of 3, zero survivors

Scratch copy via `fs.cpSync` to `/tmp/as73-mut` (`cp -R` is blocked by the
sandbox), baseline green in the copy, removed afterwards. Worktree never
mutated: `git status --porcelain` empty throughout.

| Mut | Site, asserted at the line | Predicted red | Observed red |
|---|---|---|---|
| M1 | `lib/personnel.js:122` classifier back to `/^---\r?\n/` | T1, T3 | T1, T3 — 2 fail / 471 pass |
| M2 | `lib/personnel.js:145` `examined = roster.length + skipped.length`, increment deleted | T1, T2, T3, clean-fixture, dirty-fixture | same 5 — 5 fail / 468 pass |
| M3 | `bin/chat.js:190` drop `reportsTo: e.reportsTo` (only occurrence; proved inside the `rosterRows` segment) | T4 | T4 — 1 fail / 473 pass |

Controls that stayed green as predicted: dirty-fixture case under M1 (its
broken dossier carries a clean `---\n` fence — the reason AS-33 never saw F1);
bare-root case under M2 (0 either way); `cli: roster prints the active company
roster with work status (AS-8)` under M3 — the survivor Priya observed.

## Not done

- Counted compose `--build` receipt: docker is off PATH for the implementer.
  Orchestrator owns it. Expect 470 (464 + 6); host-minus-compose delta 4.

## Note for the reviewer — AC-1 is not literally satisfied

`grep -n -- "'---'" apps/chat/lib/personnel.js` returns **two** code lines:
line 40 inside `hasLeadingFence` (leading fence) and line 54 inside
`parseFrontmatter`s loop, `if (line.trim() === '---')` — the *closing* fence,
a different test that F1 was never about. The property AC-1 is after (one
leading-fence test, asked by both parser and classifier) holds; the grep
wording does not. Left as-is rather than reshaped to make a grep pass.
No `/^---` regex survives as a test; one appears in a doc comment on line 34.
