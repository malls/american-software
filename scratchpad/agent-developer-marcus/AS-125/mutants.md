# AS-125 §3 battery — mutant log (developer-marcus)

Scratch worktree: `/tmp/AS-125-mutant` detached at 7690a5a (branch tip). Runner: `mutate.mjs <id>`.
Whole host suite per run (`node --test`, cwd `/tmp/AS-125-mutant/apps/chat`, via spawnSync). Baseline on the tip: 615/613/0/2.

> (first A1 run discarded: runner parsed TAP, reporter is spec — 615/612/1/2 observed, red set unparsed; re-run below)

### A1
- file: apps/chat/public/style.css
- applied check (li.roster-row div {): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} won by #roster-list li.roster-row div (spec 1,1,2, order 210)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title white-space: effective value is normal — won by #roster-list li.roster-row div (spec 1,1,2, order 210); the contract allows nowrap. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | .roster-title [spec 0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 51] | #roster-list li.roster-row div [spec 1,1,2
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### A2
- file: apps/chat/public/style.css
- applied check (#roster-list * {): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} won by #roster-list * (spec 1,0,0, order 210)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title white-space: effective value is normal — won by #roster-list * (spec 1,0,0, order 210); the contract allows nowrap. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | .roster-title [spec 0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 51] | #roster-list * [spec 1,0,0, order 210]
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### A3
- file: apps/chat/public/style.css
- applied check ([class~="roster-title"]): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} won by [class~="roster-title"] (spec 0,1,0, order 210)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title white-space: effective value is normal — won by [class~="roster-title"] (spec 0,1,0, order 210); the contract allows nowrap. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | .roster-title [spec 0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 51] | [class~="roster-title"] [spec 0,1,0, order 210]
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### A3b
- file: apps/chat/public/style.css
- applied check ([class~=roster-title]): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} won by [class~=roster-title] (spec 0,1,0, order 210)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title white-space: effective value is normal — won by [class~=roster-title] (spec 0,1,0, order 210); the contract allows nowrap. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | .roster-title [spec 0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 51] | [class~=roster-title] [spec 0,1,0, order 210]
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### A4
- file: apps/chat/public/style.css
- applied check (.roster\-title { (and .roster-title { stays 2->2)): 0 -> 1 (expected 0 -> 1), extra site assert true => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} won by .roster-title (spec 0,1,0, order 210) — escape normalised
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title white-space: effective value is normal — won by .roster-title (spec 0,1,0, order 210); the contract allows nowrap. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | .roster-title [spec 0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 51] | .roster-title [spec 0,1,0, order 210]
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### B1
- file: apps/chat/public/style.css
- applied check (@scope): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} thrown: cannot score unknown at-rule (neither flattened nor ignored): @scope (#roster-list)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: Error: cannot score unknown at-rule (neither flattened nor ignored): @scope (#roster-list)
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### B2
- file: apps/chat/public/style.css
- applied check (@import): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 3 insertions(+)
- predicted: {T1} thrown: cannot score: statement at-rule or stray ';' glued into a prelude: @import url("x.css"); …
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: Error: cannot score: statement at-rule or stray ';' glued into a prelude: @import url("x.css");
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### B3
- file: apps/chat/public/style.css
- applied check (@layer): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} thrown: …unknown at-rule…: @layer x
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: Error: cannot score unknown at-rule (neither flattened nor ignored): @layer x
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### C1
- file: apps/chat/public/style.css
- applied check (content: "{"): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 3 insertions(+)
- predicted: {T1} thrown: unbalanced braces: depth 1 at end of input (unclosed block opened by: .roster-status::after)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: Error: unbalanced braces: depth 1 at end of input (unclosed block opened by: .roster-status::after)
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### C2
- file: apps/chat/public/style.css
- applied check (} count +1): 191 -> 192 (expected 191 -> 192) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} thrown: unbalanced braces: stray '}' at offset N
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: Error: unbalanced braces: stray '}' at offset 16370
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### C3
- file: apps/chat/public/style.css
- applied check (@import): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} thrown: trailing content without a block: @import url("x.css");
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: Error: trailing content without a block: @import url("x.css");
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### N1
- file: apps/chat/public/style.css
- applied check (#roster-list span {): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: GREEN 615/613/0/2
- host (whole suite): 615/613/0/2 exit 0
- red set: (none — GREEN)
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### N2
- file: apps/chat/public/style.css
- applied check (div.other {): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: GREEN 615/613/0/2
- host (whole suite): 615/613/0/2 exit 0
- red set: (none — GREEN)
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### R1
- file: apps/chat/public/style.css
- applied check (.roster-title {): 2 -> 3 (expected 2 -> 3) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} won by .roster-title (spec 0,1,0, order 210)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title white-space: effective value is normal — won by .roster-title (spec 0,1,0, order 210); the contract allows nowrap. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | .roster-title [spec 0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 51] | .roster-title [spec 0,1,0, order 210]
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### R2
- file: apps/chat/public/style.css
- applied check (#roster-list .roster-title {): 0 -> 1 (expected 0 -> 1), extra site assert true => APPLIED
- diff --stat:  1 file changed, 1 insertion(+)
- predicted: {T1} won by #roster-list .roster-title (spec 1,1,0, order 50)
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title white-space: effective value is normal — won by #roster-list .roster-title (spec 1,1,0, order 50); the contract allows nowrap. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | #roster-list .roster-title [spec 1,1,0, order 50] | .roster-title [spec 0,1,0, order 51] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 5
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### R3
- file: apps/chat/public/style.css
- applied check (all: unset): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} .roster-title all: effective value is unset — … the contract allows undeclared
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: AssertionError [ERR_ASSERTION]: .roster-title all: effective value is unset — won by .roster-title (spec 0,1,0, order 210); the contract allows undeclared. 211 rules parsed, 4 target .roster-title: * [spec 0,0,0, order 0] | .roster-title [spec 0,1,0, order 50] | #roster-list li.roster-row.active .roster-title [spec 1,3,1, order 51] | .roster-title [spec 0,1,0, order 210]
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### R4
- file: apps/chat/public/style.css
- applied check (#roster-list { .roster-title {): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 2 insertions(+)
- predicted: {T1} thrown: cannot score nested style rule (native CSS nesting) under: #roster-list
- host (whole suite): 615/612/1/2 exit 1
- red set: `truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping`
  - truncation: AS-74 — the cascade leaves .roster-title nowrap, overflow hidden, ellipsis — no later or stronger rule re-enables wrapping: Error: cannot score nested style rule (native CSS nesting) under: #roster-list
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### G1
- file: apps/chat/test/roster-truncation.test.js
- applied check (lastCompound( in targets()): 1 -> 0 (expected 1 -> 0) => APPLIED
- diff --stat:  1 file changed, 1 insertion(+), 1 deletion(-)
- predicted: {H9} exactly; T1 green
- host (whole suite): 615/612/1/2 exit 1
- red set: `css-cascade: the subject need not spell the class to reach the element — type, universal, attribute and escaped subjects`
  - css-cascade: the subject need not spell the class to reach the element — type, universal, attribute and escaped subjects: AssertionError [ERR_ASSERTION]: expected [class~="t"] to target .t
- roster-truncation.test.js alone: 10/9/1/0
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### F7
- file: apps/chat/test/roster-truncation.test.js
- applied check (assert.doesNotThrow in H7 body): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 1 insertion(+), 1 deletion(-)
- predicted: {H7} exactly; file alone 10/9/1
- host (whole suite): 615/612/1/2 exit 1
- red set: `css-cascade: unbalanced braces throw instead of collapsing the block list`
  - css-cascade: unbalanced braces throw instead of collapsing the block list: AssertionError [ERR_ASSERTION]: Got unwanted exception.
- roster-truncation.test.js alone: 10/9/1/0
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### F8
- file: apps/chat/test/roster-truncation.test.js
- applied check (assert.doesNotThrow in H8 body): 0 -> 1 (expected 0 -> 1) => APPLIED
- diff --stat:  1 file changed, 1 insertion(+), 1 deletion(-)
- predicted: {H8} exactly; file alone 10/9/1
- host (whole suite): 615/612/1/2 exit 1
- red set: `css-cascade: an unknown or statement at-rule throws instead of being swallowed`
  - css-cascade: an unknown or statement at-rule throws instead of being swallowed: AssertionError [ERR_ASSERTION]: Got unwanted exception.
- roster-truncation.test.js alone: 10/9/1/0
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### F9
- file: apps/chat/test/roster-truncation.test.js
- applied check ('#r li.row div' inside H9's misses array): 1 -> 2 (expected 0 -> 1), extra site assert true => NOT APPLIED
- diff --stat:  1 file changed, 1 insertion(+), 1 deletion(-)
- predicted: {H9} exactly; file alone 10/9/1
- ABORTED: mutation did not apply at the intended site; restoring
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### F9
- file: apps/chat/test/roster-truncation.test.js
- applied check ('#r li.row div' inside H9's misses array): 0 -> 1 (expected 0 -> 1), extra site assert true => APPLIED
- diff --stat:  1 file changed, 1 insertion(+), 1 deletion(-)
- predicted: {H9} exactly; file alone 10/9/1
- host (whole suite): 615/612/1/2 exit 1
- red set: `css-cascade: the subject need not spell the class to reach the element — type, universal, attribute and escaped subjects`
  - css-cascade: the subject need not spell the class to reach the element — type, universal, attribute and escaped subjects: AssertionError [ERR_ASSERTION]: expected #r li.row div NOT to target .t
- roster-truncation.test.js alone: 10/9/1/0
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0

### G1+A3
- file: apps/chat/public/style.css
- applied check ([class~="roster-title"] (CSS) — and lastCompound( in targets() 1->0): 0 -> 1 (expected 0 -> 1), extra site assert true => APPLIED
- diff --stat:  2 files changed, 3 insertions(+), 1 deletion(-)
- predicted: EXTRA: {H9} only — T1 GREEN despite the A3 rule (plan §3 G1 note: H9 alone pins the bracket-aware scan)
- host (whole suite): 615/612/1/2 exit 1
- red set: `css-cascade: the subject need not spell the class to reach the element — type, universal, attribute and escaped subjects`
  - css-cascade: the subject need not spell the class to reach the element — type, universal, attribute and escaped subjects: AssertionError [ERR_ASSERTION]: expected [class~="t"] to target .t
- restored: porcelain empty
- post-restore host: 615/613/0/2 exit 0
