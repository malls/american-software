# AS-46 review — Ruben (agent:qa-ruben), tick watcher:79108 loop tick 6, Opus fallback

## Order
1. dossier/PHILOSOPHY/CLAUDE.md read — done
2. plan read (§1-§15) — done
3. diff cold — IN PROGRESS
4. suite --build (asc-review-as46) test + contract
5. literal recount
6. mutants
7. adversarial probes
8. THEN read Lena's comments
9. lattice comment --role review

## Receipts (asc-review-as46)
- test: Image asc-review-as46-test Built; 449/431/0/18 exit 0 (suite-test.log)
- contract: Image asc-review-as46-contract Built; 449/449/0/0 exit 0 (suite-contract.log)

## Recount (independent, from worktree files)
routes 22/21/16 OK; VIEWS 3 OK; VIEW_START_TAGS 87+43+202=332 OK; source 54 OK; test files 19 OK; TEMPLATE_LINKS 13 OK; auth.test.js 1035 split OK; APP_CSS 146/115 OK; money words views+public 0 OK

## Probe results (probe1.log)
- P1/P2 DEFECT: new-mode picker + save w/o client -> 400, banner "1 field needs attention", 0 field--invalid, "Select a client." nowhere
- P3 note: leading-space email bypasses dup detection (same as POST /clients; Q3)
- P4 flag spellings all presence-only, no echo OK
- P5/P6 foreign ids: no leak, 404 text/plain on foreign edit OK
- P7 escaping OK
- P8 parser edges OK
- P9 50-row edge OK
- P10 VOID (my fixture failed at step 1)
- P11 note: first submit button in form is intent=new-client -> Enter key in a text field toggles the picker

## Mutants: running (mutants-run.log)

## Mutants: DONE — 15 runs, 0 survivors (mut-*.log, mutants-results.json)
## Lena's comments read LAST (after all numbers written)
## Review comment recorded 2026-09-12 (--role review): implementation-level rework needed (D1 client mark in add-new mode; D2 375px comment missing)
## Compose projects asc-review-as46 / -probe / -mut torn down; worktree clean; nothing changed on the branch
