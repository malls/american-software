// Scratch: build AS-47b's description from the plan (verbatim slices) and file it.
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = '/Users/forrest/Code/american-software-company';
const plan = fs.readFileSync(`${ROOT}/.lattice/plans/task_01M1D34P2B9MDD94H9HNYW4ZH5.md`, 'utf8').split('\n');
const sec = (from, to) => plan.slice(from - 1, to).join('\n');
const s32 = sec(141, 185);
const cases = sec(334, 354);
if (!s32.startsWith('### §3.2')) throw new Error('§3.2 slice wrong: ' + s32.slice(0, 40));
if (!cases.startsWith('**Screen 6')) throw new Error('cases slice wrong: ' + cases.slice(0, 40));

const desc = `Screen 6 (contract create) — split out of AS-47 at plan §6's pre-agreed line. AS-47 landed screen 7 (contract detail with print/download) as Unit A; at the split trigger the branch measured 1,455 changed lines against master (1,061 for Unit A alone, excluding the §3.9 route-surface extraction) against a stop line of 800, so screen 6 is this task. Filed by agent:developer-marcus 2026-09-12 (tick watcher:79108 loop tick 6).

Everything AS-47's plan (.lattice/plans/task_01M1D34P2B9MDD94H9HNYW4ZH5.md) rules for screen 6 binds here unchanged: §3.1 (the two /contracts/new routes join contractRoutes, registered BEFORE GET /contracts/:id, form without action, the router's existing body parser), §3.2 (below, verbatim), §3.6 (chrome, copy, template shape rules; textarea joins the .field rules), §3.7 (eleven-row partition 6+1+2+1+1), §3.8 (S6-ERROR-SYSTEM by dropping the contracts table), §8 recipes F1, F2, F4, F6, F9, F10, F11a, F12, and §7 cases 1–19 (below, verbatim) in test/contract-screens.test.js — the file AS-47 created, whose screen-7 cases 20–29 are already there. Decision 5: validateFormValue gains export in lib/contracts/generation.js (one validator, two callers). The README's § Contracts says /contracts/new is this task's until it merges. Depends on AS-47 (the file, the nav, the route-surface literals) and, through it, on AS-46 (the /invoices/new nav link and the client-picker precedent — plan §11 Q3: the picker logic is carried twice by lane discipline; a third consumer extracts lib/screens/client-picker.js).

Recount every cardinality literal at rebase (AS-47 §10): routes +2 (GET and POST /contracts/new), source +2, VIEWS +1 (contract-form.ejs, sampleLocals contractFormLocals() = S6-CLIENT-EMPTY), expectFiles +1, P4 +1, VIEW_START_TAGS + the new template's count, contracts.test.js P8 2 -> 4 and Y2's registration-order list, APP_CSS_* re-measured. Reviewer runs F6 and F9 at minimum plus the §8 M6 probes named for screen 6.

---

${s32}

---

## §7 cases, verbatim from AS-47's plan

${cases}
`;
fs.writeFileSync(`${ROOT}/scratchpad/agent-developer-marcus/AS-47/as47b-description.md`, desc);
const r = spawnSync('lattice', [
  'create', 'D1 v1 UI: contract create screen (screen 6) — AS-47b',
  '--actor', 'agent:developer-marcus', '--complexity', 'medium', '--priority', 'medium',
  '--description', desc, '--quiet',
], { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(`${r.stdout}\n${r.stderr}\nexit ${r.status}\n`);
