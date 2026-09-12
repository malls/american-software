// M1b: revert ALL THREE legs (tokens.css dark blocks, tokens.json dark aliases, BRANDING.md §3.3 dark row)
// to danger-500 so parity holds — does the §3.4 row 3.17 / the generated matrix go red on its own?
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-56';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-56';
const TOK = `${W}/docs/design/tokens/tokens.css`, BR = `${W}/BRANDING.md`, JSONP = `${W}/docs/design/tokens/tokens.json`, HTML = `${W}/docs/design/style-reference/index.html`;
const files = { [TOK]: `${OUT}/m1b-tokens.css.bak`, [BR]: `${OUT}/m1b-BRANDING.md.bak`, [JSONP]: `${OUT}/m1b-tokens.json.bak`, [HTML]: `${OUT}/m1b-index.html.bak` };
for (const [s, b] of Object.entries(files)) copyFileSync(s, b);
const restore = () => { for (const [s, b] of Object.entries(files)) copyFileSync(b, s); };
process.on('exit', restore);
const sh = (bin, args) => spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const mutate = (path, pattern, replacement, expectCount, label) => {
  let s = readFileSync(path, 'utf8'); const count = s.split(pattern).length - 1;
  if (count !== expectCount) { console.log(`${label}: NOT applied as intended (${count} sites, expected ${expectCount})`); process.exit(9); }
  writeFileSync(path, s.split(pattern).join(replacement)); console.log(`${label}: applied at ${count} site(s)`);
};
mutate(TOK, '--color-danger-solid: var(--color-danger-400);', '--color-danger-solid: var(--color-danger-500);', 2, 'M1b css');
mutate(BR, '| `--color-danger-solid` | `#D62937` | `danger-400` |', '| `--color-danger-solid` | `#CE2735` | `danger-500` |', 1, 'M1b branding §3.3');
// tokens.json: the dark + explicit-dark alias objects. Pattern is the value+alias pair; light says #AB212C so only dark sites match.
mutate(JSONP, '"value": "#D62937",\n        "alias": "danger-400"', '"value": "#CE2735",\n        "alias": "danger-500"', 1, 'M1b json (tokens.json has light+dark only; plan §3 said two dark sites — misstatement)');
const r = sh('node', ['--test', `${W}/docs/design/tokens/tokens.test.mjs`]);
const out = r.stdout + r.stderr;
console.log(out.split('\n').filter((l) => /^(not ok|✖)|^ℹ (tests|pass|fail)|AssertionError|message:/.test(l)).join('\n'));
const d = sh('git', ['-C', W, 'diff', '--stat']); console.log('dirty during mutant (json rewrite by the idempotent writer counts):\n' + d.stdout);
restore();
const c = sh('git', ['-C', W, 'diff', '--exit-code', '--stat']); console.log('M1b: tree', c.status === 0 ? 'CLEAN' : 'DIRTY\n' + c.stdout);
