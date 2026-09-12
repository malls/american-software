Lattice-Reviewed-Commit: ff1a51eb90f98014fb5da624137a3d809480003f

# Code Review: AS-72 — `feat/AS-72-as25-guard-autolink` (5ca7fa3, five commits over master ff1a51e)

> Provenance: this is the Lattice **auto-fired** review (generic `claude` actor, `.lattice/review_state/`). Per `CLAUDE.md` § Review Gate it is third-party tooling output, not the company's review gate; the named `qa-*` reviewer should form their own findings before reading it. Nothing below touched the worktree, the board, or any container. Mutants were run on scratch copies under `/tmp` (since deleted); the worktree and main checkout are `git status --porcelain`-clean apart from the pre-existing untracked `scratchpad/`.

### 1. Verdict

**FAIL (implementation-level)** — every numbered acceptance criterion passes on the floor sweep (9/9, with AC-8's compose half still owed to a docker session, as the plan itself anticipates), and **one finding outside the list blocks**: the D4 change stops fewer invisible code points than its own comment and the test's explanatory note claim, and the branch attributes the 71-vs-43 gap to the wrong cause. The rework is small (re-derive the residual, then either widen the class or narrow the claim), and D4's intent is clear, so this is not plan-level.

### 2. Summary

Reviewed the three-file diff (`public/markdown.js`, `test/api.test.js`, `test/markdown.test.js`) against the plan and its nine criteria, ran the host suite in the worktree (Node 24.13.1: **426 tests, 426 pass, 0 fail** — matches the recorded 423 → 426), and re-ran mutants M1, M4 and M6 on scratch copies: each went red exactly where the plan predicts, and M1 reproduced the vacuous pass (old AS-25 guard **green**, new AS-72 guard **red**). The code is careful, dependency-free, and well-commented. The key finding: nine invisible non-Cf code points (variation selectors, CGJ, the Hangul fillers, Mongolian FVS, braille blank) still enter an href on this branch, and the "43 not 71 — Node 24's ICU" explanation in the test is not the real explanation of the gap.

### 3. Issues

**[MAJOR] apps/chat/public/markdown.js:127-131 and apps/chat/test/markdown.test.js:360-363 — D4's stated property is wider than its mechanism, and the 71/43 discrepancy is misattributed**
The new `URL_RE` comment says "the residual was 71 invisible format characters … A candidate stops at one." The test then pins 43 and explains the difference as "Node 24's ICU reports 43 Cf code points in the BMP." Both statements cannot be true, and the second is not the cause: Unicode has never had 71 Cf code points in the BMP (it is 43 on every recent version; 170 across all planes — I re-derived both numbers on this Node). The likely explanation of the reviewer's 71 is that it counted invisible code points that are **not** General_Category Cf, and I verified that those still pass the exclusion on this branch — each of the following enters the href of `https://x.dev/a<cp>b` unchanged: U+FE00/U+FE0F (variation selectors, Mn), U+034F (combining grapheme joiner, Mn), U+180B (Mongolian FVS, Mn), U+115F/U+1160/U+3164/U+FFA0 (Hangul fillers, Lo), U+2800 (braille blank, So). That is the AS-45 defect class exactly: English wider than the algorithm. The AS-95 lesson applies too — a number that does not match has two explanations, and "ICU" was adopted without being tested (a one-line enumeration disproves it).
**Fix:** re-derive the residual set rather than explain the gap away, then pick one of two implementation-level resolutions and record it in the plan notes. (a) Widen the class to `[^\s<>"'`\\\p{Cf}\p{Default_Ignorable_Code_Point}]` — `\p{DI}` is supported on this Node (verified); the union is 80 code points in the BMP and 4,206 across all planes (DI includes the reserved default-ignorable ranges), it covers all nine probes above except U+2800, which is `So` and would need to be listed explicitly or accepted; re-pin N and re-run M6. (b) Keep `\p{Cf}` and rewrite both comments to state the limit precisely: what is excluded (Cf, 43 BMP / 170 total) and which invisible classes are knowingly accepted and why (variation selectors are legitimate in emoji IRIs, for instance). Under either option, delete the ICU attribution. Note that option (a) changes what a URL containing an emoji with VS16 (`☕️`) links to, so it is a real product decision the plan owner should make, not a silent widening.

**[MINOR] apps/chat/test/markdown.test.js:355-358 — the D4 test enumerates the BMP only while the guard covers all planes**
The regex (with the `u` flag) stops at astral Cf too — I confirmed U+E0041 (tag character, the emoji-tag invisibles), U+1D173 and U+110BD are all stopped — but the test never drives one, so the `u`-flag half of the guarantee is untested. A full-plane enumeration (`0..0x10FFFF`, skipping surrogates) costs 25 ms on this machine.
**Fix:** enumerate all planes, pin 170 (or the union count if the class widens), and keep the cardinality assertion.

**[MINOR] apps/chat/test/api.test.js:183-233 — `matchParen`/`splitArgs` lexing has two sharp edges**
An unterminated `/*` makes `indexOf` return -1, so `i` becomes 0 and the scan restarts from the beginning — an infinite loop rather than an error. A regex literal inside a timer body containing `//` or an unbalanced `(` would be mis-lexed. Neither can occur in today's bodies, and the failure direction is red or hang, never a false green, so this does not weaken the guard.
**Fix:** throw when `indexOf` returns -1 (mirror the `//` branch), and note the regex-literal limitation in the docstring so the next person who adds a body with one knows why the guard threw.

**[MINOR] apps/chat/test/api.test.js:236-238 — `callNames` counts keywords and misses references**
`if (`, `for (`, `while (`, `catch (`, `function (` all match the "call" pattern, and a timer written as `setInterval(refreshSidebar, 60_000)` yields an empty call list. Both fail red, so the guard stays safe, but the assertion message ("calls refreshSidebar and nothing else") would mislead whoever hits it.
**Fix:** filter a small keyword set, or say in the comment that the region is asserted as source text and a control-flow keyword or a bare reference is a deliberate red.

**[MINOR] apps/chat/test/api.test.js:657-668 — the known-vacuous lazy-regex parse stays in the AS-25 test without a pointer**
The plan intentionally keeps the old guard as the observed vacuous-pass control (AC-1), which is fine; but the AS-25 test itself carries no note that its timer parse is superseded, so a future reader could trust it or "strengthen" it independently. The explanation currently lives only in the comment block above the AS-72 test.
**Fix:** one line inside the AS-25 test: "timer parse below is the vacuous shape AS-72 documents; the complete-contents guard is the AS-72 test."

**[NIT] apps/chat/test/api.test.js:240 — test name deviates from the plan's AC-1 name**
`>=30s` in the code, `≥30s` in the plan. Harmless, but AC-1 names the executable case and the record should match one way or the other.

### 4. Positive Observations

- **The vacuous pass was reproduced, not argued.** M1 (`60_000 → 5_000` plus a nested `setTimeout(() => {}, 60_000)` inside the reconcile body) leaves the AS-25 test green and turns only the AS-72 test red — the red set is exactly `{AS-72 guard}` as the plan predicted. That is the M4-style observed falsifier the task asked for.
- **The new guard asserts complete contents, not presence.** Exactly-two timers, both intervals, both inside `init()`, last argument is the cadence, and the exact non-member call list per body. Each of those closes a distinct way the old regex could be fooled.
- **The fuzz branch is genuinely reachable now.** M4's failure message shows a generated `…http://}README…` shape reaching the `scheme + alnum host` assertion — the input the old generator could not produce. The `saltPunct ≥ 15_000` counter proves the branch fired rather than assuming it.
- **D3 is tested on all three axes** (tail trimmed, mid-URL kept, runs trim fully) and the round-trip invariant is asserted in the same test. I also checked the interactions D3 could have broken: bracket balancing after a trimmed dash, a lone trailing surrogate under the new `u` flag, and a Wikipedia-style `Foo–Bar…` title — all behave correctly.
- **The `u` flag was introduced safely.** `trimUrlTail` only removes BMP characters, so `last` always lands on a code-point boundary and `URL_RE.lastIndex = last` cannot land mid-surrogate.
- **Cardinality before quantification** in the Cf test, and the implementer refreshed the `lastIndex` lockstep comment that D3 made stale — exactly the kind of collateral a plan does not list.
- Zero new dependencies, ephemeral ports only, no protected top-level file touched. Host count is stated (426/426); the compose `--build` receipt remains the merge precondition the plan names.
