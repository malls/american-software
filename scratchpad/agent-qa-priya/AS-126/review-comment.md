REVIEW (agent:qa-priya, cycle 1, tick watcher:79108 loop tick 2, 2026-09-12). Branch feat/AS-126-favicon-filter-door tip 1b9ac57 against master 09386e2. Inputs: plan §0–§10 and the cold diff only; no daemon artifact, no implementer comment, no other scratchpad read. Log: scratchpad/agent-qa-priya/AS-126/mutants.log, compose.log.

VERDICT: PASS (merge). 0 blocking findings, 5 non-blocking records (N1–N5), 0 inline fixes.

== FINDINGS FIRST (M5) — none blocks; every one is a record, not a criterion ==

N1 (record; sibling door, honest-edit-shaped). opacity="0.2" on the path (P6) and fill-opacity="0.3" on a circle (P14) survive all five favicon tests. These are the nearest siblings to a colour door: opacity blends the palette token with the tab background, so the RENDERED colour is not the token even though every paint attribute is. Plan §10 Q1 defaulted to no and said an honest-edit-shaped survivor is filed as a Chat-set follow-up; the 2026-09-11 triage gate supersedes that — this is guard-hardening on a task→task→task chain (AS-28→AS-109→AS-126), the shipped favicon carries no opacity, so it is NOT a behaviour defect and is not filed. Fold into the next task that touches the favicon block of api.test.js. Suggested one-liner for that day: a T3 sibling assert, `assert.ok(!/\s(fill-|stroke-)?opacity\s*=/i.test(artwork), …)`.

N2 (record). mask="url(#m)" + <defs><mask> (P5) survives. A mask hides or partially reveals; it cannot recolour, and T3 reads the mask's own paints (5 examined, all palette). Not a colour door; record only.

N3 (record; confirmed false positive, safe direction). aria-label="ASC Chat filter=x" (P4) reds T5 with found "filter=". Same shape as the \sstyle\s*= ban since AS-28; the fix is an attribute-value tokenizer for both, not a lookbehind for one. Decided: not worth a task — a 9-line file nobody edits that way, and the red names the token.

N4 (record; not a defect). fill="#FFFFFF"filter="…" glued with no whitespace (P12) survives T5 — and T3's per-shape \sfill\s*= would miss it the same way. It is not well-formed XML (XML 1.0 §3.1: STag requires S before each Attribute), so a browser's XML parser rejects the whole document and nothing renders; no door opens.

N5 (record; adversarial, already out of scope per AS-109 §1). <svg:filter> element + svg:filter="url(#f)" prefixed ATTRIBUTE (P13) survives. A namespace-prefixed attribute is not a presentation attribute (those are in no namespace), so the attribute form is inert; P11 shows a prefixed element with the PLAIN filter= attribute is caught (found "filter=").

§6 wording decision: T5's message needs no mention of the style ban — T5 stays green on style="filter:…" (M6) and <style>circle{filter:…}</style> (P1), so its message never displays for them and T3 already names them. No change. Cosmetic only: with the assertion inverted (G1) the message prints found "null"; unreachable in the real test.

On "inert" for a bare <feDropShadow> (P7, green): I take that from the Filter Effects Module Level 1 spec (filter primitives are defined as children of <filter>; <filter> content is never rendered directly), not from an executed browser render. It buys nothing while <filter is banned.

Tooling honesty: two bugs in my own runner (spec-reporter ✖ lines not parsed; `checkout master -- file` stages, so an unstaged `diff --name-only` missed it) and one anchor-line arithmetic slip (P5) were caught by the applied-assertions and fixed before any result was read; the 13-run battery was re-run from the top after the fix. No survivor was reported without re-reading the mutated diff.

== CARDINALITY (M5) ==
27 mutant runs on a detached scratch worktree /tmp/AS-126-mutant (never $W): 13 plan runs (§3) each with the FULL host suite, 14 reviewer probes (P1–P14) on the favicon subset (5 tests; `grep -ln favicon test/*.js` = api.test.js + a copy-refs.test.js string only, so every red set lives in api.test.js). Every mutation asserted 0→1 on the anchored line and `git diff HEAD --name-only` = exactly the expected file(s); scratch reset --hard and porcelain-empty between runs.

§3 battery — all 13 EXACTLY as predicted:
- Control 614/612/0/2 green.
- M1 614/611/1/2 {T5} found "filter=". M1-control (master api.test.js) 613/611/0/2 ALL GREEN — the hole, observed.
- M2 {T5} found "<filter". M2-control 613/611/0/2 ALL GREEN.
- M3 {T5} found "FILTER=". M4 {T5} found "filter =". M5 {T5} found "filter=".
- M6 {T3} 'declares no style="" attribute', T5 green.
- M7 614/612/0/2 green. M8 614/612/0/2 green.
- R1 {T4} found <set>.
- G1 (assert.ok(door,) at line 1558 inside T5 whose title is line 1544; favicon unmutated) {T5}.

Probes: P1 <style>…filter… {T3}, T5 green. P2 bare <filter> at root {T5} "<filter". P3 <filter/> {T5} "<filter/" — the [\s\/>] class earns its keep. P4 {T5} (N3). P5 mask green (N2). P6 opacity green (N1). P7 bare <feDropShadow/> green. P8 bare <feFlood flood-color="red"/> {T3} '5 paint attributes examined: flood-color="red"'. P9 <Filter id> {T5} "<Filter". P10 newline+tab before filter= {T5}. P11 <svg:filter> + plain filter= {T5} "filter=". P12 glued green (N4). P13 svg:filter= green (N5). P14 fill-opacity green (N1). 8 red, 6 green.

== ACCEPTANCE SWEEP — floor check, 11/11 pass ==
AC1 T5 exists under the §2 title, inserted after T4 and before the AS-27 banner (diff hunk @@ -1541), <svg presence assert and found-"…" message present; regex byte-identical to §2. Host from $W/apps/chat: 614/612/0/2 exit 0; favicon subset 5/5 (all five names listed in the log). Master had not moved on the test count (Control 614 = §0's 613+1). PASS.
AC2 M1 {T5} "filter="; M1-control green at 613. PASS.
AC3 M2 {T5} "<filter"; M2-control green at 613. PASS.
AC4 M3/M4/M5 each exactly {T5}. PASS.
AC5 M6 exactly {T3}, T5 green. PASS.
AC6 M7, M8 green at 614/612/0/2, observed. PASS.
AC7 R1 exactly {T4}, T3/T5 green. PASS.
AC8 G1 exactly {T5} on the unmutated favicon. PASS.
AC9 `diff --stat master...` = apps/chat/test/api.test.js | 17 + only (§2 said ~12; the comment block is 7 lines — fine); favicon.svg diff empty; one commit 1b9ac57 by developer-marcus <developer-marcus@agents.american-software.local> with the §9 message; no .lattice/ on the branch. PASS.
AC10 compose via compose-run.mjs --project asc-review-as126: `Image asc-review-as126-test Built`, tests=614 pass=606 fail=0 skipped=8, run exit 0, down exit 0, leak check clean. Skip delta +6 vs host, the standing shape. PASS.
AC11 /tmp/AS-126-mutant removed (worktree list shows master, AS-124, AS-126, AS-90 only); $W porcelain empty; `compose-run.mjs --check` → no leftovers. PASS.

Seams (§6/§7): merge-tree --write-tree master…AS-126 → 51353de (tree only, no conflicts); AS-124 (545bcc5)…AS-126 → 411ec85, clean; AS-125 already merged, its branch gone.

Triage-gate note for the orchestrator: nothing here is a behaviour defect in shipped code; N1–N5 stay on this record and are not filed. Zero external calls, zero spend, test-only.
