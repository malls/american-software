// probes.js — M6 probes past the plan's list. Each probe is a scratch copy of
// the real ledger (or a view module) with one thing changed, bind-mounted over
// the in-image path; the worktree is never touched. Runs only
// test/states-ledger.test.js. Prediction is written before the run.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-71';
const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-71/probes';
fs.mkdirSync(SP, { recursive: true });
const LEDGER = fs.readFileSync(path.join(WT, 'docs/design/wireframes/02-states-ledger.md'), 'utf8');
const DASH = fs.readFileSync(path.join(WT, 'apps/invoicing/lib/screens/dashboard-view.js'), 'utf8');

const once = (text, needle, replacement) => {
  const c = text.split(needle).length - 1;
  if (c !== 1) throw new Error(`needle ${JSON.stringify(needle)} occurs ${c} times`);
  return text.replace(needle, replacement);
};

const PROBES = [
  { id: 'P1', what: 'whitespace only: CRLF line endings + padded cells on the S1-DEFAULT-SIGNIN row + trailing spaces', predict: 'GREEN 9/9',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '| `S1-DEFAULT-SIGNIN` | DEFAULT |', '|   `S1-DEFAULT-SIGNIN`   |  DEFAULT   |').replace(/\n/g, '   \r\n') },
  { id: 'P2', what: 'prose-only change in What renders of a rendered row (S3-ERROR-SYSTEM)', predict: 'GREEN 9/9',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, 'Error banner in place of both tables, "Retry"', 'A completely different sentence about the error banner') },
  { id: 'P3', what: 'category change on a non-LOADING, non-n/a row where the screen keeps all six categories: S4-ERROR-SYSTEM ERROR -> GATED', predict: 'GREEN 9/9 — NOT CAUGHT (module ledger carries no category; only LOADING/n-a are joined)',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '| `S4-ERROR-SYSTEM` | ERROR |', '| `S4-ERROR-SYSTEM` | GATED |') },
  { id: 'P4', what: 'a row ADDED to the document: S3-EMPTY under screen 3', predict: 'RED {case 1 (66 rows), screen 3}',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '| `S3-ABANDON` | ABANDON |', '| `S3-EMPTY` | EMPTY | some trigger | some render |\n| `S3-ABANDON` | ABANDON |') },
  { id: 'P5', what: 'MODULE-side drift: dashboard-view.js marks S3-ERROR-SYSTEM as n/a while the document does not', predict: 'RED {screen 3} (n/a rows differ); case 1 green',
    mount: '/app/lib/screens/dashboard-view.js', text: once(DASH, "Object.freeze({ id: 'S3-ERROR-SYSTEM', disposition: 'rendered' }),", "Object.freeze({ id: 'S3-ERROR-SYSTEM', disposition: 'n/a' }),") },
  { id: 'P6', what: 'rows reordered within screen 7 (S7-EMPTY moved to the end)', predict: 'GREEN 9/9 (set equality, order not joined)',
    mount: '/app/vendor/states-ledger.md', text: (() => { const row = LEDGER.split('\n').find((l) => l.startsWith('| `S7-EMPTY` |')); const abandon = LEDGER.split('\n').find((l) => l.startsWith('| `S7-ABANDON` |')); return once(once(LEDGER, row + '\n', ''), abandon + '\n', abandon + '\n' + row + '\n'); })() },
  { id: 'P7', what: 'heading punctuation drift: Screen 3 heading em-dash -> hyphen', predict: 'RED 9/9 (parser throws: table outside any Screen section)',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '## 3. Screen 3 — Dashboard / list', '## 3. Screen 3 - Dashboard / list') },
  { id: 'P8', what: 'n/a marker drift: S3-ABANDON Trigger says "not applicable — because" while What renders still says n/a row', predict: 'RED 9/9 (parser throws: n/a in one cell but not the other)',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '| `S3-ABANDON` | ABANDON | n/a — because', '| `S3-ABANDON` | ABANDON | not applicable — because') },
  { id: 'P9', what: '§8 declared count 65 -> 66 with no row change', predict: 'RED {case 1 only}',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '= **65 states across 7 screens.**', '= **66 states across 7 screens.**') },
  { id: 'P10', what: 'the LOADING row of screen 3 becomes an n/a row (both markers)', predict: 'RED {case 1 (LOADING/n-a disjoint), screen 3 (n/a rows)}',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '| `S3-LOADING` | LOADING | Initial fetch | Labeled loading placeholder in place of each table |', '| `S3-LOADING` | LOADING | n/a — because probe | *(n/a row)* |') },
  { id: 'P11', what: 'a literal pipe inside a What renders cell (S5-DEFAULT-DRAFT: "edit | finalize")', predict: 'RED 9/9 (parser throws: expected 4 cells, found 5) — strict, documented',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, 'Status "Draft," edit and finalize actions', 'Status "Draft," edit | finalize actions') },
  { id: 'P12', what: 'a new screen section 8 with a one-row table, §8 untouched', predict: 'RED {case 1 (eight sections / 66 rows)}; screens 1-7 green',
    mount: '/app/vendor/states-ledger.md', text: once(LEDGER, '## 8. Row count against the wireframes', '## 8. Screen 8 — Probe\n\n| Row ID | Category | Trigger | What renders |\n|---|---|---|---|\n| `S8-DEFAULT` | DEFAULT | t | r |\n\n## 9. Row count against the wireframes') },
];

const only = process.argv[2] ? process.argv[2].split(',') : null;
for (const p of PROBES) {
  if (only && !only.includes(p.id)) continue;
  const hostFile = path.join(SP, `${p.id}${p.mount.endsWith('.js') ? '.js' : '.md'}`);
  fs.writeFileSync(hostFile, p.text);
  const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-review-as71', 'run', '--rm', '--build', '-v', `${hostFile}:${p.mount}:ro`, 'test', 'node', '--test', 'test/states-ledger.test.js'], {
    cwd: path.join(WT, 'apps/invoicing'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
  });
  const text = (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || '') + '\nexit=' + r.status + '\n';
  fs.writeFileSync(path.join(SP, `run-${p.id}.log`), text);
  const n = (k) => { const m = text.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')); return m ? m[1] : '?'; };
  const reds = text.split('\n').filter((l) => /^✖ /.test(l) && !/failing tests/.test(l)).map((l) => l.replace(/ \([\d.]+ms\)$/, '').replace('✖ states-ledger: ', '').replace(/ — the view module's rows.*$/, ''));
  const firstErr = (text.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]*)|Error: (states-ledger: [^\n]*)/) || [])[0] || '';
  console.log(`${p.id} | ${p.what}\n   predicted: ${p.predict}\n   observed: tests ${n('tests')} pass ${n('pass')} fail ${n('fail')} exit ${r.status} built=${/Image asc-review-as71-test\s+Built/.test(text)}\n   reds: ${reds.length ? reds.join(' ; ') : '(none)'}\n   first error: ${firstErr.slice(0, 160)}`);
}
