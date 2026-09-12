# AS-57 — mutation recipes and planner's measurements (Owen, 2026-09-12)

Companion to `.lattice/plans/task_01M1FF185QBCB1Z9X9F8P9M5WM.md`. The plan is binding;
this file carries the long-form recipes so the plan stays under its cap.

## Measurements on master (0b39536 + df7e5c8), read cold

- `apps/invoicing/test/dependency-policy.test.js`: **1,185 lines** (`wc -l`; `split('\n').length` = 1,186).
  Test #7 caps every scanned file AND every `test/*.js` at 1,200. **Net headroom: +14 lines.**
- `deploy-shape.test.js`: 486 lines. Pins: `COPIES.length === 11`, `IGNORE_PATTERNS.length === 6`,
  demo COPY exactly once (line 425), manifests ride along (lines 456–464), ignore-list members (468–486).
- Dockerfile COPYs today: 11. Host `apps/invoicing/` top level minus the COPY set: `README.md`, `.env.local`
  (gitignored; `**/.env.local` in `.dockerignore`). Nothing else.
- compose.yaml: `services:` line 30, `  web:` line 31; no backslash inside any quoted scalar (the item-3 fix
  cannot change what the strippers return for the real file).
- No host run exists for this suite (README § The three commands): the counted compose run is the whole
  proof burden. Last merged-master receipt: AS-128, **530/511/0/19**, `Image asc-merge-as128-test Built`.
- `stripComment` (deploy-shape 49–62) and the per-line loop in `stripHashComments` (dependency-policy
  223–234) are byte-identical apart from indentation. YAML single-quoted scalars escape `'` as `''`, which
  the loop already handles by accident (close, reopen); only `\` inside `"…"` is mishandled.
- Concept rows that scan the union without `only`: none matches `example.invalid`, `compose.override`,
  or `probe`; `STRIPE_ config key` allows `compose.yaml` and M3's line carries no `STRIPE_`.

## The template (AS-53 §4.1, adapted for compose-run.mjs and for "the mutation is a NEW file")

```bash
WT=/Users/forrest/Code/american-software-company/.worktrees/AS-57
APP=$WT/apps/invoicing
RUN="node /Users/forrest/Code/american-software-company/apps/chat/bin/compose-run.mjs --project asc-impl-as57-m<N> --cwd $APP"
# editing an existing file F:
( cp "$F" "$F.as57bak" && trap 'mv -f "$F.as57bak" "$F"' EXIT; <MUTATE>; <ASSERT-APPLIED> || { echo MUTATION DID NOT APPLY; exit 99; }; $RUN; echo "MUTANT_EXIT=$?" )
# planting a new file F:
( trap 'rm -f "$F"' EXIT; <PLANT>; test -f "$F" || { echo MUTATION DID NOT APPLY; exit 99; }; $RUN; echo "MUTANT_EXIT=$?" )
git -C "$WT" status --porcelain -- apps/invoicing .dockerignore .gitignore   # must be empty
$RUN; echo "RESTORED_EXIT=$?"                                                # 530/511/0/19 + Built line
```

compose-run.mjs tears the project down itself (`down -v --rmi local`), so the "rebuild" half of the house
technique is the restored run's own `--build`. Record per run: `MUTANT_EXIT`, the four counts, the
`Image asc-impl-as57-m<N>-test Built` line, the failing test NAMES and first message of each.

## M1 — item 1, the record's reproducer (new top-level file with an outbound healthcheck)

```bash
F=$APP/compose.override.yaml
printf 'services:\n  web:\n    healthcheck:\n      test: ["CMD", "node", "-e", "fetch('"'"'https://example.invalid/'"'"')"]\n' > "$F"
```
Expected red, exactly two: DP#3 (`expected 3 manifests, found 4: Dockerfile, compose.override.yaml,
compose.yaml, package.json`) and DP#5 (`compose.override.yaml:4: fetch — not sanctioned`). 530/509/2/19.
Compose merges the override into `web`, which `run test` never starts — the stack accepts the file, as
Priya observed under AS-53. (Today, before the fix, this is 530/511/0/19 green — record that too.)

## M1b — item 1, the pin: the explicit COPY list reintroduced (image identical, world narrowed)

`F=$APP/Dockerfile`. Replace the single line `COPY apps/invoicing ./` with this block (scratch file `m1b.txt`):

```
COPY apps/invoicing/app.js apps/invoicing/server.js ./
COPY apps/invoicing/lib ./lib
COPY apps/invoicing/routes ./routes
COPY apps/invoicing/views ./views
COPY apps/invoicing/public ./public
COPY apps/invoicing/test ./test
COPY apps/invoicing/demo ./demo
COPY apps/invoicing/compose.yaml apps/invoicing/Dockerfile ./
```
```bash
perl -0pi -e 'BEGIN { local $/; open my $h, "<", "m1b.txt" or die; $r = <$h> } s{^COPY apps/invoicing \./\n}{$r}m' "$F"
grep -q 'COPY apps/invoicing/lib ./lib' "$F"   # assert applied
```
Expected red, exactly three, all deploy-shape: `the parsers read the manifests…` (12 COPYs ≠ 5),
`the demo service is the contract service…` (no whole-directory COPY), `the manifests ride along as data…`
(no whole-directory COPY; 9 sub-path COPYs ≠ the one cache-layer COPY). dependency-policy stays green
(README.md leaves the image; `UNSCANNED` is allowed-if-present). 530/508/3/19.

## M2 — item 2, the record's reproducer (nested skip-named directory)

```bash
F=$APP/lib/vendor/probe.js; mkdir -p "$APP/lib/vendor"; printf "fetch('https://example.invalid/');\n" > "$F"
# trap: rm -f "$F" && rmdir "$APP/lib/vendor"
```
Expected red, exactly two: DP#3 (first failing assertion is the new one: message names `lib/vendor` and
says SKIPPED_DIRS applies at the top level only) and DP#5 (`lib/vendor/probe.js:1: fetch — not sanctioned`).
530/509/2/19. A narrower set ({#3} alone) means the directory was still skipped and only the assertion
fired — that is a finding, not a pass.

## M3 — item 3, the record's reproducer (escaped quote before ` #` in a double-quoted scalar)

```bash
F=$APP/compose.yaml
perl -pi -e 'print q{    container_name: "asc-inv \" # fetch(} . q{'"'"'https://example.invalid/'"'"'} . q{)"} . "\n" if $. == 31 && /^  web:$/' "$F"
grep -q 'example.invalid' "$F"
```
Expected red, exactly one: DP#5 (`compose.yaml:32: fetch — not sanctioned`). deploy-shape stays green
(the strict parser reads the value as a quoted scalar; no assertion pins `web`'s key set). 530/510/1/19.
Fallback if compose rejects `container_name` with spaces at config time: use `    labels: ["asc=x \" # fetch('https://example.invalid/')"]` — same line number, same red set.

## M4 — item 4, both halves

(i) plant: `F=$APP/lib/.DS_Store; printf 'Bud1' > "$F"` with the new `**/.DS_Store` line in place →
**green**, 530/511/0/19 (the nuisance is gone). Also `git -C "$WT" check-ignore -q apps/invoicing/lib/.DS_Store`
→ exit 0 (the `.gitignore` half; host-only, so proven by git, not by the suite).
(ii) same plant, plus `perl -ni -e 'print unless m{^\*\*/\.DS_Store$}' "$WT/.dockerignore"` (assert:
`! grep -q DS_Store "$WT/.dockerignore"`) → red, exactly three: DS `the parsers read the manifests…`
(6 ≠ 7 patterns), DS `the repo-root .dockerignore keeps the live chat database out`, DP#3
(`lib/.DS_Store is neither app source, a manifest, nor listed in UNSCANNED`). 530/508/3/19.
Two traps: restore `.dockerignore` and remove the planted file.

## M5 — item 3, the helper's guard (escape handling removed at the source)

`F=$APP/test/helpers/hash-comment.js`; delete the one line that begins `    if (quote === '"' && ch === '\\')`
(`perl -ni -e 'print unless /quote === .\x22. && ch === /' "$F"`; assert `! grep -q "ch === '\\\\\\\\'" "$F"`).
Expected red, exactly two: DP#2 (`the manifest comment stripper works, in both directions` — the escaped-quote
case) and DS `the parser rejects shapes it does not understand` (its escaped-quote case). 530/509/2/19.
This is the mutation that proves the shared helper is what both files actually run.

## Reviewer probes past the list (suggestions, not the answer)

`lib/test/x.js` and `routes/node_modules/x.js` (M2's siblings); a top-level `Dockerfile.dev` with
`RUN curl …`; a top-level `notes.txt` (unknown → DP#3); `"a\\" # fetch(` (escaped backslash, then the quote
really closes — the comment IS stripped, so DP#5 must stay green on it); `'a\' # fetch('…')'` in single
quotes (YAML: `\` is literal, the string ends at `\'`, the tail is a comment — green expected).
