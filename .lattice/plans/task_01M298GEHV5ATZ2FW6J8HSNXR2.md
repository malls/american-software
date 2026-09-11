# AS-120: the href guard sees every assignment operator, not two of them

Plan by `agent:cto-owen`, 2026-09-11 (tick watcher:86819, loop tick 14; planning stage ran on **Opus** under the Fable-limit fallback). Implementer: `agent:developer-marcus`. Reviewer: `agent:qa-priya` (§7). Complexity: **low** — one test file, ~30 lines changed, one README sentence; the work is the mutants.

Branch `feat/AS-120-href-assignment-operators`, worktree `.worktrees/AS-120/`. `$M` = `/Users/forrest/Code/american-software-company` (main checkout, master), `$W` = `$M/.worktrees/AS-120`. Use `git -C $W …`; **never `cd` into `$W` before a `lattice` call**. Scratchpads per actor (M3): implementer `scratchpad/agent-developer-marcus/AS-120/`, reviewer `scratchpad/agent-qa-priya/AS-120/`. My baseline log is `scratchpad/agent-cto-owen/AS-120/host-baseline-master-d2d6608.tap` — the reviewer measures her own.

Parent mechanism: AS-98 (`.lattice/plans/task_01M26C7SHH3G5YDP39FGXQHX6W.md`, merged b4680fa). This plan closes one hole in it and changes nothing else about it.

---

## §0. Ground truth (verified 2026-09-11 against master `d2d6608`)

| Claim | Verified |
|---|---|
| The hole, as filed (Priya F1 / probe P8): `p1.href \|\|= task.taskId` on a **new** anchor survives every AS-93/AS-98 guard. | Cause re-derived: `HREF_ASSIGN = /\.href\s*(\+?=)(?!=)\s*([^;\n]*)/g` (`link-sites.test.js:31`) admits only `=` and `+=`; `MECHANISMS` (`:54-59`) bans only `.href +=`. Probe (host, `node -e`): `\|\|=`, `??=`, `&&=`, `-=` all yield **zero** matches against the current regex; `+=` and `=` yield one. So T8's count pin never increments and T9 never fires. |
| The same operator on an **existing** site is already red. | P8 as Priya ran it: count 9 → 8 trips T8's pin, and T7's named-site regex misses. Only a fresh element evades — this plan is about the fresh-element case. |
| ECMAScript defines exactly **16** assignment operators. | `=`, `*=`, `/=`, `%=`, `+=`, `-=`, `<<=`, `>>=`, `>>>=`, `&=`, `^=`, `\|=`, `**=`, `&&=`, `\|\|=`, `??=` (ECMA-262 §13.15, *AssignmentOperator* plus the three logical forms). A closed set — which is what makes an allowlist of operators honest rather than another denylist of spellings. |
| Nothing in `public/*.js` uses any compound operator on `.href`, `Reflect.`, `Object.defineProperty(` or `Object.defineProperties(`. | `grep -n 'Reflect\.\|defineProperty\|defineProperties\|\.href\s*[-+*/%&\|^?<>]' public/*.js` → empty. So widening the ban costs nothing on master. |
| Comparisons must stay invisible. | `a.href == b`, `a.href === b`, `a.href != b`, `a.href <= b`, `a.href >= b` — probe: zero matches under both the current and the §1 regex. |
| `public/*.js` file count: **12**. The 9 href assignments of AS-98 §0 are unchanged (AS-99's `laneCard` included). | `ls public/*.js \| wc -l` = 12; T8 green on master. |
| **AS-115** (`feat/AS-115-copy-refs`, held at `needs_human` for the board) carries its own pin, `copy-refs.test.js` T17: `app.match(/\.href\s*=/g).length === 9` over `app.js` only. | That regex has the **same gap** (`\|\|=` is not `\.href\s*=`), and additionally would over-count a `.href ==` comparison. It is not this task's file — §6 rules on the seam. |
| **Baseline, measured on master `d2d6608`.** | Host (`node --test` over `apps/chat/test/*.test.js`): **554 tests / 553 pass / 0 fail / 1 skipped** (log above). Compose not re-measured here — the AS-98 review's post-AS-88 receipt was 554 / 547 / 0 fail / 7 skipped on the same tree contents; the implementer takes the compose baseline with `--build` before touching anything (§5). |

---

## §1. Decision: enumerate the operator set, in both guards

**What problem this solves.** AS-98's English says "every `.href =` assignment" and its algorithm matched two operators. A developer who writes `a.href ||= x` (a plausible "set a default" idiom) or `a.href ??= x` has made an assignment the guard's *sentence* covers and its *regex* does not — the AS-45 shape (English wider than algorithm) one more time. The fix is to make the operator set explicit and complete, so the sentence and the regex are the same object.

**The two candidates in the filing, ruled on:** do **both**, because they protect different things.

1. **Widen `HREF_ASSIGN` to every ECMAScript assignment operator** (primary). This is what makes the *count pin* and the *allowlist* see a compound assignment: a new anchor with `||=` becomes a tenth assignment (count red) *and* a violation (the classifier already requires `op === '='` for an allowed RHS — that line is untouched and now does real work for 15 operators instead of one).
2. **Widen the `MECHANISMS` `.href +=` entry to every compound operator** (defense in depth). T9 stays a flat "this spelling must not appear" ban that fires even if the classifier is ever loosened — the AS-98 M11 lesson: the allowlist is the one thing that must never be edited casually, so a second, independent guard on the same spelling is cheap insurance.

**Also closed, same reasoning as AS-98 §1.5 (zero uses, house style is `el()` + explicit property sets):** `Reflect.set(` and `Object.defineProperty(` / `Object.defineProperties(` join `MECHANISMS` as **whole bans** — not key-scoped to `'href'`, for the same reason `Object.assign(` is not. A legitimate future use is a one-line allowlist edit with a comment.

**The regexes** (file-local, `link-sites.test.js`; order inside the alternation matters — longer operators first):

```js
// Every ECMAScript assignment operator (ECMA-262 §13.15 + the logical forms): 16, enumerated.
const ASSIGN_OP = String.raw`\*\*=|<<=|>>>=|>>=|\|\|=|\?\?=|&&=|[-+*/%&|^]=|=`;
const HREF_ASSIGN = new RegExp(String.raw`\.href\s*(${ASSIGN_OP})(?!=)\s*([^;\n]*)`, 'g');
// The 15 compound forms, for the MECHANISMS ban (everything above except bare `=`).
const HREF_COMPOUND = new RegExp(String.raw`\.href\s*(?:\*\*=|<<=|>>>=|>>=|\|\|=|\?\?=|&&=|[-+*/%&|^]=)`);
```

`classifyHrefAssignments` is unchanged. `MECHANISMS` becomes six entries: the three existing (`setAttribute('href'`, `Object.assign(`, `['href']`), `.href +=` **replaced** by `['.href <compound>=', HREF_COMPOUND]`, plus `['Reflect.set(', /Reflect\.set\(/]` and `['Object.defineProperty(', /Object\.definePropert(?:y|ies)\(/]`.

**The English, revised** (the file header comment and test messages must say this and no more):

> Every `.href` assignment in `public/*.js` — by any of the 16 ECMAScript assignment operators — uses plain `=` with a right-hand side that begins with `dashHref(`, `tok.href`, `` `?m= `` or `serializeChatUrl(`, and there are exactly 9 of them. No file in `public/*.js` uses `setAttribute('href'`, `Object.assign(`, `['href']`, `Reflect.set(`, `Object.defineProperty(`/`defineProperties(`, or `.href` followed by a compound assignment operator. [The `url`-field and literal-host sentences are unchanged from AS-98.]

**§1.4 Deliberately out of scope, with reasons.** Destructuring assignment *targets* (`[a.href] = [x]`, `({ href: a.href } = o)`) — no operator follows `.href`, so no lexical operator guard sees them; adversarial, not an honest-mistake idiom, and **M7 below makes the boundary observable** rather than leaving it argued. Computed member keys (`a[k] = x` with `k = 'href'`), `with`, `eval`, prototype setters on `HTMLAnchorElement` — adversarial. `setAttributeNS` and computed attribute names — carried from AS-98 §1.4. AS-115's T17 regex — not this branch's file (§6).

---

## §2. Tests — exact titles

### Edited: `apps/chat/test/link-sites.test.js`

- **T8** — title and messages unchanged except the header sentence (§1). The behaviour change is entirely in `HREF_ASSIGN`.
- **T9** — retitle to `'link-sites: AS-98/AS-120 — no file in public/*.js sets href by any mechanism other than a plain .href = assignment'`; `MECHANISMS` per §1 (6 entries); the loop is unchanged and the message still names file and mechanism.
- **T11** — extend `rejected` with three inputs: `'p1.href ||= task.taskId;'` (Priya's P8, verbatim), `'p1.href ??= task.url;'`, `'p1.href &&= dashHref(task.taskId);'` (allowlisted RHS, forbidden operator — proves the `op === '='` test is load-bearing). Cardinality pin `9 → 12` and every `'9 rejected inputs examined'` message becomes `12`. Accepted set unchanged (4 + 1 comparison).
- **T12 (new) — AC-4** `'link-sites: AS-120 — the classifier and the mechanism ban see all 16 ECMAScript assignment operators and no comparison operator'`
  Drive both regexes with generated inputs: for each of the 16 operators `op`, `classifyHrefAssignments(\`x.href ${op} y;\`)` yields `count 1` and, for the 15 compound ops, exactly one violation whose `.op === op` (for `=` with RHS `y`, one violation too — `y` is not allowlisted; assert `.op === '='`); `HREF_COMPOUND` matches the 15 compound inputs and **does not** match the `=` input. Then for each of the 5 comparison spellings `==`, `===`, `!=`, `<=`, `>=`: count 0 and `HREF_COMPOUND` no match. Messages carry `16 operators examined` / `5 comparisons examined`. The operator list in the test is a literal array of 16 strings asserted to have length 16 — not derived from `ASSIGN_OP`, or the test would check the regex against itself.

### Edited: `apps/chat/README.md`

In the AS-98 paragraph under "Links to Lattice", change "no file may set an href by `setAttribute`/`Object.assign`/bracket access" to "no file may set an href by `setAttribute`, `Object.assign`, bracket access, `Reflect.set`, `defineProperty`, or a compound assignment operator (`||=`, `??=`, `+=` and the rest — AS-120)".

**Unchanged and expected green:** T7 (`api.test.js`), T10, all AS-98 sites, every other file.

---

## §3. Proving it (M4) — anchored mutants, predicted EXACT red sets

Scratch copy is a detached worktree, never `$W`: `git -C $M worktree add --detach /tmp/AS-120-mutant feat/AS-120-href-assignment-operators`. Anchoring rule (the 2026-09-10 sharpening): each app.js mutant is inserted *immediately after* **A-panel** = `open.href = dashHref(task.taskId);` (`app.js:718` on master; unique — implementer re-verifies the line on the branch). Applied-assertion per run: `grep -c 'MUTANT-M<id>'` in the target file 0→1, `git -C /tmp/AS-120-mutant diff --stat` naming exactly one file, and for app.js insertions `grep -c` of A-panel staying 1. Each run: compose `--build`, own `-p asc-as120-<actor>-m<id>`, `Built` line quoted; `git -C /tmp/AS-120-mutant checkout -- .` between runs. **A survivor is re-read as a diff before it is reported as a weak guard.**

| Mutant | Edit | Predicted EXACT red set |
|---|---|---|
| **M1 (AC-1 — Priya's P8 on a new anchor, verbatim)** | after A-panel: `const p1 = el('a'); p1.href \|\|= task.taskId; // MUTANT-M1` | **{T8, T9}** — T8 via count 10 ≠ 9 *and* violation `op '\|\|='`; T9 via `HREF_COMPOUND`. T7 green (no `dashHref(`, no `.url`, no literal), T10 green (`taskId`). **On master this mutant is all-green** — the implementer runs it once against master's test file first to observe the hole (67/67-style green), then against the branch. |
| **M2** | after A-panel: `const p2 = el('a'); p2.href ??= task.url; // MUTANT-M2` | **{T8, T9, T10}** — T10 via `.url`. T7 **green**: T7a's pattern is `\.href\s*=\s*…\.url` and `??=` does not match it — T7a has the same operator blindness, is subsumed by T10, and is not edited here (§8 Q2). |
| **M3** | after A-panel: `const p3 = el('a'); p3.href &&= dashHref(task.taskId); // MUTANT-M3` | **{T7, T8, T9}** — T7 via `dashHref(` count 5 → 6; T8 via count 10 *and* violation (RHS allowlisted, operator not); T9 via `HREF_COMPOUND`. This row proves a compound op with a *legitimate* RHS is still red. |
| **M4** | after A-panel: `const p4 = el('a'); p4.href -= 1; // MUTANT-M4` | **{T8, T9}** — an arithmetic op outside the three in the filing: the set is the ECMAScript 16, not Priya's 3. |
| **M5** | after A-panel: `Reflect.set(open, 'href', task.taskId); // MUTANT-M5` | **{T9}** only — no `.href` token, so T8's count stays 9 (quote that green: it is why the mechanism ban exists). |
| **M6** | after A-panel: `Object.defineProperty(open, 'href', { value: task.taskId }); // MUTANT-M6` | **{T9}** only |
| **M7 (boundary — expected GREEN by design)** | after A-panel: `const p7 = el('a'); [p7.href] = [task.taskId]; // MUTANT-M7` | **all GREEN.** No operator follows `.href` (`]` does), no `dashHref(`, no `.url`, no literal, no banned mechanism. This is §1.4 made observable. Unlike AS-98's M11, this inserts **no** `.href <op>` token, so the count pin cannot fire; if anything goes red, that is a finding (something unknown is guarding), not a prediction to adjust. |
| **M8 (classifier)** | in `link-sites.test.js`, replace `ASSIGN_OP`'s value with `String.raw\`\+?=\`` `// MUTANT-M8` (the AS-98 regex, restored) | **{T11, T12}** — T11 via the three new rejected inputs counting 0; T12 via 14 of 16 operators counting 0. T8/T9 **green** (app.js untouched, and T9 no longer depends on `ASSIGN_OP`). |
| **M9 (mechanism)** | in `link-sites.test.js`, replace `HREF_COMPOUND` with `/\.href\s*\+=/` `// MUTANT-M9` (the AS-98 entry, restored) | **{T12}** only — the mechanism half of T12 fails for 14 operators; T11 green (it drives the classifier only); T8/T9 green on unmodified app.js. Without T12 this mutant would survive — that is why T12 tests both regexes. |

Nine runs; eight expected red, one expected green by design. **A wider or narrower set than predicted is a finding; do not edit the prediction to match.** After the last: `git -C $M worktree remove --force /tmp/AS-120-mutant`, remove every `asc-as120-*` image, `git -C $W diff --exit-code`, then **rebuild and re-run** the real suite from `$W`.

---

## §4. Acceptance criteria — the review floor (M5: findings first; M6: probe past it)

| AC | Criterion | Falsifier | Satisfied only by |
|---|---|---|---|
| **AC-1** | Priya's P8 on a new anchor is red | **M1** | observed red **{T8, T9}** on the branch, observed all-green against master's test file, `Built` receipts quoted |
| **AC-2** | All 15 compound operators are seen by the count pin and the allowlist | **M2, M3, M4** | red sets exactly as §3; M3's T8 failure message names the `&&=` violation |
| **AC-3** | `Reflect.set(` and `defineProperty` are banned as mechanisms | **M5, M6** | each red on exactly **{T9}** |
| **AC-4** | T12 green; T11 at 12 rejected / 5 accepted | **M8, M9** | M8 red **{T11, T12}**; M9 red **{T12}** |
| **AC-5** | The §1.4 boundary is where the plan says it is | **M7** | observed **all green**, recorded as expected; the reviewer then confirms the same edit on an *existing* site (`[open.href] = …` replacing A-panel) is red {T7, T8} via the count 9 → 8 and `dashHref(` 5 → 4 |
| **AC-6** | Branch-tip counts per the receipt rule: host **555 / 554 / 0 fail / 1 skipped**; compose `--build` with `Built` line **555 / 548 / 0 fail / 7 skipped** (baseline + 1) | — | both lines quoted |
| **AC-7** | README sentence (§2) present; file header sentence matches §1 | — | reviewer reads both |
| **AC-8** | Mutation cardinality: 9 runs, red sets exactly as §3, each applied-assertion recorded | — | reviewer's own runs, not the implementer's logs |
| **AC-9** | Nothing left behind: no `asc-as120-*` images, no `/tmp/AS-120-*`, worktrees = master + in-flight lanes, `$W` clean | — | listed in the review |

**Where the reviewer probes past the list (M6 — budget for it):** invent an href-setting spelling not in §3 that a developer would plausibly type — not one from this plan or from her own AS-98 probes — and see whether T8/T9 catch it; an honest-mistake survivor is blocking, an adversarial one is recorded as confirming §1.4. Confirm T12's operator array is literal (16 strings), not derived from `ASSIGN_OP`. Confirm the multi-line permalink RHS (`app.js:298`) still classifies as `serializeChatUrl(` under the new regex. Run T8/T12 inside compose, not only on the host.

## §5. Predicted counts

One new test (T12), zero removed, one retitled (T9). Host: 554 → **555** (554 pass, 1 skipped). Compose: 554 → **555** (548 pass, 7 skipped). The implementer measures both on the branch tip before writing anything (compose with `--build`, `Built` line quoted) and again after; a start figure that disagrees with 554 means master moved (AS-102 merging changes it; AS-115 adds its own tests) — re-baseline and say so, do not carry my number.

## §6. Key files, commit, seams

- `apps/chat/test/link-sites.test.js` — header comment, `ASSIGN_OP`/`HREF_ASSIGN`/`HREF_COMPOUND`, `MECHANISMS`, T9 title, T11 inputs, new T12 (~40 lines).
- `apps/chat/README.md` — one sentence.

One commit, as `developer-marcus` (`git -c user.name="developer-marcus" -c user.email="developer-marcus@agents.american-software.local"`): `AS-120: the href guard sees every ECMAScript assignment operator; ban Reflect.set and defineProperty (link-sites.test.js T9/T11/T12)`. Commit early; progress note in the scratchpad.

**Seams.**
- **AS-115** (`feat/AS-115-copy-refs`, `needs_human`, PR #2): its T17 pins `/\.href\s*=/g` over `app.js` at 9. This branch adds no href assignment and no app.js change, so T17 stays 9 whichever merges first; no conflict (`link-sites.test.js` vs `copy-refs.test.js`, disjoint README sentences). T17's regex shares the gap this task closes and is **not edited here** — it is another lane's held branch. Ruling: whichever tick merges the *second* of the two records that T17 is the narrower pin and files a one-line follow-up to align it to `ASSIGN_OP`, unless AS-115 is reworked first, in which case its plan picks it up.
- **AS-102** (in review, watcher code only) — no shared file.
- **AS-106** (planning, compose networks) — no shared file; its outcome may change how compose receipts are taken, but not their numbers.

## §7. Staffing

- **Implementer: `agent:developer-marcus`** — wrote AS-98, knows the file, free.
- **Reviewer: `agent:qa-priya`.** She filed the finding and wrote no code on it; she is not reviewing her own design in the AS-98 §8 sense — the decision here (§1: the 16-operator set, the dual guard, the two extra mechanisms) is mine, not hers. The known anchoring is narrow and named: she expects M1 red, and M1 is her own probe. Her M6 budget therefore goes to spellings *not* in this plan and not in her AS-98 review. If her lane is saturated, `agent:qa-ruben` is acceptable with no caveat.

## §8. Open questions — time-boxed, with defaults

1. **Should `ASSIGN_OP` be derived from one shared constant and reused by T9?** Default **no** — two independent regexes is the point of the dual guard (M9 shows why). Closed here.
2. **T7a's `.url` pattern in `api.test.js` (`\.href\s*=\s*…\.url`) has the same operator blindness.** Default **leave it** — T10 bans `.url` reads regardless of operator (M2's red set shows T10 catching it), and T7a exists as AC-1's direct reading for AS-98, not as a control. Box: closes at review; re-open only if Priya finds a `.url` read that reaches an href and survives T10.
3. **CLAUDE.md wording?** None proposed. The lesson — "when the English says *assignment*, the regex enumerates the language's assignment operators" — is an application of the AS-45 rule already recorded, not a new rule.
