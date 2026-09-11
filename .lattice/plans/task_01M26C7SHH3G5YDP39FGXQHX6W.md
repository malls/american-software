# AS-98: the link-site guard — from a denylist of one spelling to an allowlist of every href

Plan by `agent:cto-owen`, 2026-09-11 (tick watcher:53418, loop tick 10). Implementer: `agent:developer-marcus`. Reviewer: `agent:qa-priya` (§8 says why not Ruben). Complexity: **low-to-medium** — the code is one test file and a few edited lines; the work is proving the guard can fail.

Branch `feat/AS-98-href-allowlist-guard`, worktree `.worktrees/AS-98/`. `$M` = `/Users/forrest/Code/american-software-company` (main checkout, master), `$W` = `$M/.worktrees/AS-98`. Use `git -C $W …`; **never `cd` into `$W` before a `lattice` call**. Scratchpads per actor (M3): implementer under `scratchpad/agent-developer-marcus/AS-98/`, reviewer under `scratchpad/agent-qa-priya/AS-98/`. My planning spike and baseline logs are under `scratchpad/agent-cto-owen/AS-98/` — **the reviewer does not read them before forming her own results.**

The task description (`lattice show AS-98`) carries Ruben's observed evasion and his three candidate tightenings. This file decides. Where it departs from his candidates, §1 says why.

---

## §0. Ground truth (verified 2026-09-11 against master `7b1f036`)

| Claim | Verified |
|---|---|
| The guard under repair is **T7**, `apps/chat/test/api.test.js:1957-2005` (`'api: AS-93 — all four dashboard link sites go through the helper (4 examined, 4 covered)'`). | Four named per-site regexes at **:1964-1971** (AS-99 added `laneCard`), `dashHref(` count pinned to **5** at **:1976-1980**, the space-sensitive forbidden pattern `/\.href = [A-Za-z_$][\w.$]*\.url\b/` at **:1983-1987**, and the AC-9 literal ban (`8799`, `8443`, `127.0.0.1`) over `readdirSync(public/)` minus `dashboard-link.js` at **:1989-2004**. |
| Ruben's M-M6 stays green on master for the reason he gave: the pattern requires literal spaces. | Re-derived by spike (`scratchpad/agent-cto-owen/AS-98/spike-guard.mjs`): `shadow.href=task.url;` does not match `:1985`; the AS-93 plan already labelled T7 "the weakest control" (`.lattice/plans/task_01M242A2JX5AS5W44SAWA71MAW.md` §7.2, §9). |
| **`.url` has no consumer anywhere in `public/` today.** | `grep -n '\.url\b' apps/chat/public/*.js` → empty. The three AS-93 sites and the AS-99 site all read `taskId`. `import.meta.url` appears only under `test/`. So a ban on reading the field costs nothing on master. |
| **Every href assignment in `public/*.js`, enumerated: 9.** | `app.js:160` `a.href = dashHref(ref.taskId)` (asRefLink); `:177` `` a.href = `?m=${tok.id}` `` (msgRefLink); `:205` `a.href = tok.href` (markdown link); `:264` `a.href = tok.href` (autolinked URL); `:298` `permalink.href = serializeChatUrl(` (AS-26 permalink, multi-line RHS); `:457` `a.href = dashHref(emp.work.taskId)` (rosterRow); `:718` `open.href = dashHref(task.taskId)` (showTaskPanel); `:800` `a.href = tok.href` (thread view); `:964` `a.href = dashHref(c.taskId)` (laneCard). Four RHS shapes total: `dashHref(`, `tok.href`, `` `?m= ``, `serializeChatUrl(`. |
| No other href-setting mechanism exists in `public/`. | `setAttribute(` calls at `app.js:504-505`, `:1082-1083`, `:1093-1094` are all aria/role attributes — **none is `'href'`**; `Object.assign(` — zero uses in `public/`; `['href']` — zero; `.href +=` — zero. |
| No navigation API in `public/`. | `window.open`, `location.assign`, `location.replace`, `location.href` — zero uses. (Out of scope, §1.4, recorded so the reviewer need not re-grep.) |
| Literals that the widened ban must stay green on. | Outside `dashboard-link.js`: `localhost` 0, `.ts.net` 0, `::1` 0, `8347` 0. `markdown.js:113` has `https://…` in a comment — **do not** add `http://` to the ban. `index.html:7-8` carry `href="/style.css"` / `href="/favicon.svg"` as static attributes — they match none of the patterns below (verified in the spike: the mechanism regexes only see `.js` files; the literal ban sees every file and finds nothing). |
| House purity guards already cover HTML sinks. | `api.test.js:1407` (`SINKS`: innerHTML, insertAdjacentHTML, outerHTML, document.write) and `:1746`. **Not duplicated here.** |
| Test image copies `public/` and `test/`. | `Dockerfile:12`, `:18`. A new test file needs no compose change. |
| **Baseline, measured on master `7b1f036`.** | Host `node --test` from `apps/chat`: **542 tests / 541 pass / 0 fail / 1 skipped**. Compose (`-p asc-plan-as98 --build`, receipt `Image asc-plan-as98-test Built`): **542 / 535 pass / 0 fail / 7 skipped**. Log: `scratchpad/agent-cto-owen/AS-98/compose-baseline-master-7b1f036.log`. Project torn down, no `asc-plan-as98` image left. |

---

## §1. Decision: an allowlist of href sources, not a longer denylist

**The problem being solved.** A future developer adds an anchor and sets its href from the server-baked `url` field, or from a hand-assembled host, instead of `dashHref(taskId)`. The threat model is an **honest mistake in an ordinary spelling** — not an adversary hiding a host from a regex. A lexical guard cannot be complete against an adversary and this plan does not claim it is; it must be complete against every spelling a developer would actually type, and its English must say exactly what its algorithm does (the AS-45 rule this task exists to apply).

**Ruben's three candidates, ruled on:**

1. Whitespace-insensitive `.url` pattern — **adopted** as a one-line edit to T7 (`:1985` → `/\.href\s*=\s*[A-Za-z_$][\w.$]*\.url\b/`). Necessary, not sufficient: it still names one spelling.
2. `setAttribute('href', …)` scan — **adopted**, widened into a *mechanism ban* (§2 T9): `setAttribute('href'`, `Object.assign(`, `['href']`, and compound `.href +=`.
3. `localhost` / `.ts.net` in the literal ban — **adopted**, plus `::1` (§2 T7 edit). Defense in depth only: with T8 below, a hard-coded host in an href is red regardless of literal; the literal ban still matters for a host that enters by some non-href path.

**What the candidates miss, and the control that closes it — T8, the RHS allowlist.** Any denylist of value-spellings is the AS-45 shape again: `a.href = u` after `const u = task.url`, `const { url } = task`, `task['url']`, `'http://' + '127.0.0' + '.1:8799/…'` all evade every pattern in 1–3 (spike: the last two evade *everything except* T8). So the primary control inverts the question: **enumerate every `.href =` assignment in `public/*.js` and require its right-hand side to begin with one of four allowed shapes** — `dashHref(`, `tok.href`, `` `?m= ``, `serializeChatUrl(` — and pin the count at **9**. Because §0 shows those four shapes are the *only* legitimate href sources in the app, the allowlist is not a heuristic; it is the app's actual link inventory written down. A tenth assignment, or one whose RHS is anything else, is red with a message naming the file and the RHS.

The English of the tightened guard, which the test titles and messages must state verbatim so that it is no wider than the algorithm:

> Every `.href =` assignment in `public/*.js` has a right-hand side that begins with `dashHref(`, `tok.href`, `` `?m= `` or `serializeChatUrl(`, and there are exactly 9 of them. No file in `public/*.js` uses `setAttribute('href'`, `Object.assign(`, `['href']`, or `.href +=`. No file in `public/*.js` reads a `url` property by member (`.url`, other than `import.meta.url`) or bracket (`['url']`) access. No file in `public/` other than `dashboard-link.js` contains `8799`, `8443`, `127.0.0.1`, `localhost`, `.ts.net` or `::1`.

Everything outside that sentence is out of scope, and named as such:

- **§1.4 out of scope, with reasons.** Computed attribute names (`setAttribute(name, …)`), `setAttributeNS`, a `url` read via destructuring (`const { url } = x` — its *consequence* as an href is caught by T8; the field-read ban's English is "member or bracket access" and stops there), navigation APIs (`window.open` etc. — not link sites; a hard-coded host there is caught by the literal ban), static anchors in `index.html` (none exist; a new one is visible in any diff and a dashboard host in it is caught by the literal ban). Each is adversarial or already covered; none is an honest-mistake spelling.
- **§1.5 `Object.assign(` is banned whole**, not `Object.assign(…, {href…})`. Zero uses today; the house style is `el()` plus explicit property sets; a `{href: …}` literal can be defined far from the call, so a key-scoped ban is a denylist again. A future legitimate use is a one-line allowlist edit with a comment — the same "deliberate edit" contract T7 already uses for its counts. **AS-115 is told this in §7.**
- **§1.6 T11 is the checker checking itself.** The classifier that implements the sentence above is a pure function in the test file; T11 drives it with the evasion strings from §3 and the four allowed shapes as *inputs*, so the suite itself proves the checker can say no — without touching `app.js`. This is not a substitute for §3's mutants against the real tree (a classifier that works on strings and is wired to the wrong directory is a vacuous pass); it is the unit-level half.

---

## §2. Tests — exact titles; the reviewer matches §3's red sets against them

### Edited: `apps/chat/test/api.test.js` T7 (`:1957-2005`)

- **T7a** — replace the pattern at `:1985` with `/\.href\s*=\s*[A-Za-z_$][\w.$]*\.url\b/` and the message with `'no href is assigned from a server-baked .url, however spaced (AS-93, AS-98)'`.
- **T7b** — replace the literal array at `:1997` with `['8799', '8443', '127.0.0.1', 'localhost', '.ts.net', '::1']`; keep the `readdirSync` enumeration and the file-count-in-message discipline. Update the comment at `:1989` to say the ban is defense in depth behind `link-sites.test.js`.
- Leave the four named site assertions and the `dashHref(` count of 5 untouched. Do not retitle T7.

### New: `apps/chat/test/link-sites.test.js` — pure `node:fs`, no server, no DOM (pattern: `test/msg-refs.test.js`, `import test from 'node:test'` / `assert/strict`)

Module-level: `PUBLIC = new URL('../public/', import.meta.url)`; `jsFiles()` = `readdirSync(PUBLIC).filter(f => f.endsWith('.js'))` (enumerated, never listed); and the pure classifier

```js
export-less, file-local:
const HREF_ASSIGN = /\.href\s*(\+?=)(?!=)\s*([^;\n]*)/g;   // (?!=) skips === comparisons; [^;\n]* takes the RHS head — a multi-line RHS still yields its first line
const ALLOWED_RHS = [/^dashHref\(/, /^tok\.href\b/, /^`\?m=/, /^serializeChatUrl\(/];
function classifyHrefAssignments(source) → { count, violations: [{op, rhs}] }
```

- **T8 — AC-2** `'link-sites: AS-98 — every href in public/*.js comes from an allowlisted source (12 files, 9 assignments examined)'`
  Over every `.js` file: collect assignments; assert **total count === 9** with message `'9 href assignments across public/*.js — a tenth is a deliberate edit here, with its RHS added to ALLOWED_RHS only if it is a new legitimate link source'`; assert zero violations, message listing `file: rhs` for each. Report the file count and assignment count in the assertion messages (cardinality before quantification).
- **T9 — AC-3** `'link-sites: AS-98 — no file in public/*.js sets href by any mechanism other than a .href = assignment'`
  For each `.js` file, `assert.doesNotMatch` against each of: `/setAttribute\(\s*['"]href['"]/`, `/Object\.assign\(/`, `/\[\s*['"]href['"]\s*\]/`, `/\.href\s*\+=/`. Message names the file and the mechanism.
- **T10 — AC-4** `'link-sites: AS-98 — no file in public/*.js reads the server-baked url field (member or bracket access)'`
  For each `.js` file: `assert.doesNotMatch(body, /(?<!import\.meta)\.url\b/)` and `/\[\s*['"]url['"]\s*\]/`. Message cites AS-93 plan §3 (the field is the JSON-API contract, never the link the browser renders).
- **T11 — AC-5** `'link-sites: AS-98 — the classifier itself rejects every known evasion spelling and accepts every allowed one'`
  Drive `classifyHrefAssignments` with, as inputs, each of: `shadow.href=task.url;` (M-M6), `shadow.href = u;`, `shadow.href = task['url'];`, `shadow.href = url;`, `shadow.href = 'http://localhost:' + (8000 + 799);`, `shadow.href = 'https://x.tail3f3c29.ts.net/';`, `shadow.href = 'http://' + '127.0.0' + '.1:8799/';`, `shadow.href += '/x';`, `c.href = '#';` — assert each yields exactly one violation; then the four allowed forms as they appear in `app.js` (incl. the multi-line `permalink.href = serializeChatUrl(` head) — assert zero violations and count 4; and `if (a.href === b.href)` — assert count 0 (comparison, not assignment). Report the input cardinality (9 rejected / 5 accepted) in messages.

**Unchanged and expected green:** T7's four site assertions and `dashHref(` count; `api.test.js:1198`/`:1407`/`:1746` purity guards; every `dashboard-link.test.js` test; all five AS-10 server-side `url` assertions (`lattice.test.js:30,41,44,55,120`, `api.test.js:180,420`) — the field stays in the payloads, only the browser's reading of it is banned.

---

## §3. Proving the guards (M4) — anchored mutants, predicted EXACT red sets

Scratch copy is a detached second worktree, never `$W`:

```
git -C $M worktree add --detach /tmp/AS-98-mutant feat/AS-98-href-allowlist-guard
```

**Anchoring rule (the 2026-09-10 sharpening):** every mutant is inserted *immediately after one named, unique line*; the applied-assertion is (a) `grep -c 'MUTANT-<id>'` in the target file going 0→1, (b) `git -C /tmp/AS-98-mutant diff --stat` naming exactly one file, and (c) for the insertions in `app.js`, `grep -c` of the anchor line staying 1 (so the edit did not duplicate or displace the anchor). A survivor is re-read as a diff before it is reported as a weak guard. Each run: `--build`, its own `-p asc-as98-<actor>-m<id>`, the `Built` line quoted, then `git -C /tmp/AS-98-mutant checkout -- .` before the next.

Anchor lines (in `apps/chat/public/app.js`, master numbering; the implementer re-verifies on the branch): **A-panel** = `open.href = dashHref(task.taskId);` (`:718`, unique); **A-roster** = `a.href = dashHref(emp.work.taskId);` (`:457`, unique); **A-body** = the first line of `bodyNode(` (unique function name — implementer records the line).

| Mutant | Insert after anchor / change | Predicted EXACT red set |
|---|---|---|
| **M1 (AC-1 — Ruben's M-M6, verbatim)** | after A-panel: `const shadow = el('a', 'lattice-open', 'x'); shadow.href=task.url; // MUTANT-M1` | **{T7, T8, T10}** — T7 via T7a; T8 via count 10 ≠ 9 *and* RHS `task.url`; T10 via `.url` |
| **M2** | after A-panel: `open.setAttribute('href', task.url); // MUTANT-M2` | **{T9, T10}** — T7 and T8 GREEN (no `.href =` — that green is the reason T9 exists; quote it) |
| **M3** | after A-panel: `Object.assign(open, { href: task.url }); // MUTANT-M3` | **{T9, T10}** |
| **M4** | after A-panel: `const s4 = el('a'); s4.href = 'http://localhost:' + (8000 + 799); // MUTANT-M4` | **{T7, T8}** — T7 via T7b `localhost`; T10 GREEN |
| **M5** | after A-panel: `const s5 = el('a'); s5.href = 'https://forrests-newer-macbook.tail3f3c29.ts.net/'; // MUTANT-M5` | **{T7, T8}** — T7 via `.ts.net` |
| **M6 (allowlist-only)** | after A-panel: `const { url } = task; const s6 = el('a'); s6.href = url; // MUTANT-M6` | **{T8}** only — every denylist stays green; this is the row that justifies §1 |
| **M7 (allowlist-only)** | after A-panel: `const s7 = el('a'); s7.href = 'http://' + '127.0.0' + '.1:87' + '99/#/task/' + task.taskId; // MUTANT-M7` | **{T8}** only |
| **M8 (site regression)** | *replace* A-roster with `a.href = emp.work.url; // MUTANT-M8` (grep-count of A-roster 1→0) | **{T7, T8, T10}** — T7 via the named `rosterRow` assertion *and* the `dashHref(` count 5→4 *and* T7a; T8 via RHS (count stays 9); T10 via `.url` |
| **M9 (the AS-115 seam, §7)** | after A-body: `const cp = el('a', 'copyable', 'x'); cp.href = '#'; // MUTANT-M9` | **{T8}** only — the spelling that turns AS-115's element red if someone makes it an anchor |
| **M10** | after A-panel: `open['href'] = task.taskId; // MUTANT-M10` | **{T9}** only |
| **M11 (boundary demonstration — expected GREEN)** | two files: in `link-sites.test.js` add `/^url\b/` to `ALLOWED_RHS` `// MUTANT-M11` (a loosened allowlist), **and** M6's insertion in `app.js`; diff-stat must name both files | **all GREEN, by design.** M6's read is by destructuring (invisible to T10, §1.4) and its RHS `url` is now allowlisted (T8 satisfied). This is the §1.4 boundary made observable: the guard's protection is exactly the allowlist, so loosening the allowlist is the one edit that must never be made casually — which is why T8's message says so. The reviewer records it as expected-green, then reverts only the test change and observes **{T8}** red again. Not a finding unless the revert stays green. |

Eleven runs; ten expected red, one expected green by design. **A wider or narrower set than predicted is a finding; do not edit the prediction to match.** After the last: `git -C $M worktree remove --force /tmp/AS-98-mutant`, remove every `asc-as98-*` image, `git -C $W diff --exit-code`, then **rebuild and re-run** the real suite from `$W`.

---

## §4. Acceptance criteria — the review floor (M5: findings first; M6: probe past it)

| AC | Criterion | Falsifier | Satisfied only by |
|---|---|---|---|
| **AC-1** | Ruben's M-M6 (`shadow.href=task.url;`) no longer passes | **M1** | observed red **{T7, T8, T10}**, `Built` receipt quoted |
| **AC-2** | Every href in `public/*.js` is allowlisted; count pinned at 9; T8 green on the branch tip | **M6, M7, M9** | each observed red on exactly **{T8}** |
| **AC-3** | No non-assignment href mechanism; T9 green | **M2, M3, M10** | M2/M3 red **{T9, T10}**; M10 red **{T9}** |
| **AC-4** | No `.url` / `['url']` read in `public/*.js`; T10 green | **M1, M8** (both carry `.url`) | T10 in both red sets |
| **AC-5** | Classifier self-test T11 green with 9 rejected / 5 accepted / 1 comparison-ignored inputs | inline: T11's own inputs | T11 green, and the reviewer confirms that removing `(?!=)` from `HREF_ASSIGN` in the scratch tree turns T11 red (the comparison input becomes a count of 1) — one extra observed red, no separate mutant number |
| **AC-6** | T7a whitespace-insensitive; T7b literal list of six | **M1** (spacing), **M4/M5** (literals) | T7 in each red set |
| **AC-7** | Site regression still named: reverting one AS-93 site is red at the *named* assertion | **M8** | red **{T7, T8, T10}**, with T7's failure message naming `rosterRow` |
| **AC-8** | Branch-tip counts per the receipt rule: host **546 / 545 / 0 fail / 1 skipped**; compose `--build` with `Built` line **546 / 539 / 0 fail / 7 skipped** (baseline + 4) | — | both lines quoted |
| **AC-9** | README paragraph (§6) present | — | reviewer reads it |
| **AC-10** | Mutation cardinality: 11 runs, red sets exactly as §3, each applied-assertion (marker 0→1, one-file diff-stat, anchor count) recorded, M11 recorded as expected-green with the revert re-red | — | reviewer's own runs, not the implementer's logs |
| **AC-11** | Nothing left behind: no `asc-as98-*` images, no `/tmp/AS-98-*`, `git worktree list` = master + `.worktrees/AS-98`, both clean; the seven AS-10 `url` assertions untouched and green | — | listed in the review |

**Where the reviewer probes past the list (M6 — budget for it):**
- Invent an href spelling not in §3 that a developer would plausibly type and see whether T8/T9/T10 catch it. A survivor that is an *honest-mistake* spelling is a blocking finding; one that is adversarial (§1.4) is recorded as confirming the boundary.
- Confirm `HREF_ASSIGN` sees the multi-line permalink RHS at `app.js:298` as `serializeChatUrl(` (not as an empty RHS that accidentally passes).
- Confirm the classifier is wired to the *served* directory the image contains (run T8 inside compose, not only on the host) — a checker pointed at the wrong path is the vacuous-pass shape.
- Check that AS-99's `laneCard` (`app.js:964`) and AS-88's branch (§7) leave the count at 9.

---

## §5. Predicted counts

Four new tests, zero removed, zero retitled. Host: 542 → **546** (545 pass, 1 skipped). Compose: 542 → **546** (539 pass, 7 skipped — the seven are AS-87/AS-92 no-git skips in the image, unchanged). Measure on the branch tip before writing anything and again after; a figure that disagrees with 542 at the start means master moved (AS-88 merging adds +8 → 550/558) — re-baseline and say so, do not carry my number.

## §6. Key files, commits, README

- `apps/chat/test/link-sites.test.js` — new (~110 lines).
- `apps/chat/test/api.test.js` — T7a `:1985-1987`, T7b `:1989-1997` (~6 lines changed).
- `apps/chat/README.md` — in "Links to Lattice (AS-10, host inference AS-93)", append one paragraph after "The `url` field in the JSON API is the server-side answer…": *"The browser never reads that field, and a test pins it (`test/link-sites.test.js`, AS-98): every href assignment in `public/` must come from one of four allowlisted sources (`dashHref()`, a tokenizer's verbatim `tok.href`, the `?m=` message placeholder, or `serializeChatUrl()`), no file may set an href by `setAttribute`/`Object.assign`/bracket access, and no file outside `dashboard-link.js` may name a dashboard host or port. Adding a legitimate fifth source is a deliberate one-line edit to that test's allowlist, with a comment saying why."*

Two commits, as `developer-marcus` (`git -c user.name="developer-marcus" -c user.email="developer-marcus@agents.american-software.local"`): (1) `AS-98: allowlist every href source in public/ and ban url-field reads (test/link-sites.test.js; T7 widened)`; (2) `AS-98: document the link-site guard in the chat README`. Commit early; keep a progress note in the scratchpad so a tick cutoff is resumable. Projected total ≈ 130 lines; no split trigger needed (state it in the report if the branch exceeds 300).

## §7. Seams

- **AS-115 (in planning, parallel lane; adds a click-to-copy inline element to `bodyNode`).** Ruling: **its element is not an href site and must not become one.** It stays green under this guard *for the right reason* — T8's count remains 9 because no `.href =` is added, T9 is untouched because it may use `setAttribute('role'|'tabindex'|'aria-*')` freely (only `'href'` is banned) but **must not use `Object.assign(`** (§1.5), T10 is untouched because it reads `tok.text`, not `url`. The spelling that turns it red is **M9**: `cp.href = '#'` on an anchor — T8 goes red on RHS `'#'` and count 10. AS-115's plan cites this section and uses a `<span>`/`<button>` with `tabIndex`, never an `<a>`. **Merge order is free:** if AS-115 lands first, its element is already in `bodyNode` when Marcus measures the count (still 9); if AS-98 lands first, AS-115's reviewer runs `link-sites.test.js` and reports the count unchanged. Neither branch edits the other's files (`link-sites.test.js` is new; AS-115 edits `msg-refs.js`/`app.js` body pipeline/`style.css`).
- **AS-88 (`feat/AS-88-deploy-names-its-project`, in review).** Its diff touches `watch/`, `README.md`, and five watcher tests — **no `public/` file and not T7** (`git diff --stat master...feat/AS-88…`, 8 files). Both branches append to `apps/chat/README.md` in different sections (AS-88: deploy prose; this: the Links section); a `--no-ff` merge of the second one may need a trivial README conflict resolution — the merging tick says so. Test-count seam: AS-88 adds +8, so whichever merges second re-measures (§5).
- **AS-99 (done).** Its `laneCard` site is already in T7's list and in the count of 9; nothing to do.

## §8. Staffing

- **Implementer: `agent:developer-marcus`** — free (AS-87/AS-92 merged); Lena is on AS-88 in review and is the natural AS-115 implementer.
- **Reviewer: `agent:qa-priya`, not Ruben.** Ruben authored the finding *and* the three candidate tightenings; the implementation adopts all three. A reviewer whose own design is under review is anchored twice over — he would re-run the evasions he already listed rather than hunt new ones, and he cannot un-know which spelling he expects to survive. The M6 probing in §4 is the load-bearing control, and it needs a cold hunter. Priya's tasking message gives her the plan and the diff, **not** `review-AS-93.txt` and not my spike or baseline logs. If Priya's lane is saturated for two consecutive ticks, Ruben is acceptable with this caveat recorded in his review comment.

## §9. Open questions — time-boxed, with defaults

1. **Should T10 also ban destructured `url` reads?** Default **no** (§1.4: the href consequence is T8's; the English stays "member or bracket access"). Box: closes at review; re-open only if Priya finds an honest-mistake spelling that reaches an href through it *and* survives T8 (by construction it cannot).
2. **Keep T7's `.url` pattern now that T10 subsumes it?** Default **keep, widened** — it is AC-1's direct reading and costs one line. Box: implementation; the implementer may not remove it.
3. **Should the literal ban include `http://`/`https://`?** Default **no** — `markdown.js:113` carries one in a comment, and a scheme literal is not a host. Box: closed here.
4. **CLAUDE.md wording?** None proposed. This task needs no metawork change; the "guard is proven by breaking it" rule already covers it, and M11 is an application of the existing sharpening, not a new rule.
