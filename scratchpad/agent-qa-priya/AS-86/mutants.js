// AS-86 review: mutation testing, one indivisible step per mutant.
// backup -> mutate -> assert applied AT THE INTENDED SITE (exact-count + site diff) -> run host suite
// -> restore -> git diff --exit-code. Full suite each time so a wider red set is visible.
const { spawnSync } = require('child_process');
const fs = require('fs');
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-86';
const APP = W + '/apps/chat';
const DIR = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-86';
const WATCHER = APP + '/watch/advance-watcher.mjs';
const IGNORE = APP + '/.dockerignore';

const mutants = {
  M1: { file: WATCHER, site: /export const IMAGE_INPUTS = Object\.freeze\(\[[\s\S]*?\]\);/, find: "  '.dockerignore',\n", repl: '' },
  M2: { file: WATCHER, site: /export function classifyImagePaths\(trackedPaths\) \{[\s\S]*?\n\}/, find: 'else unclassified.push(p);', repl: 'else declared.push(p);' },
  M3: { file: WATCHER, site: /  const paths = IMAGE_INPUTS\.map\(\(p\) => `apps\/chat\/\$\{p\}`\);/, find: 'IMAGE_INPUTS.map(', repl: 'IMAGE_INPUTS.slice(0, 9).map(' },
  M4: { file: IGNORE, site: /^chat\n# Dockerfile/m, find: 'chat\n# Dockerfile', repl: 'chat\ntest/fixtures\n# Dockerfile' },
};

function runSuite(tag) {
  const files = fs.readdirSync(APP + '/test').filter((f) => f.endsWith('.test.js')).map((f) => 'test/' + f);
  const r = spawnSync('node', ['--test', ...files], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(`${DIR}/mutant-${tag}.log`, (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || '') + '\nEXIT ' + r.status + '\n');
  const lines = (r.stdout || '').split('\n');
  const summary = lines.filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).join(' | ');
  const reds = lines.filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \(\d+(\.\d+)?ms\)$/, ''));
  return { exit: r.status, summary, reds };
}

const which = process.argv.slice(2);
for (const name of which) {
  const m = mutants[name];
  const orig = fs.readFileSync(m.file, 'utf8');
  const siteMatch = orig.match(m.site);
  if (!siteMatch) { console.log(`${name}: SITE NOT FOUND — abort`); continue; }
  const siteText = siteMatch[0];
  const occurrencesInSite = siteText.split(m.find).length - 1;
  if (occurrencesInSite !== 1) { console.log(`${name}: expected exactly 1 occurrence inside the site, found ${occurrencesInSite} — abort`); continue; }
  const mutatedSite = siteText.replace(m.find, m.repl);
  const mutated = orig.replace(siteText, mutatedSite);
  if (mutated === orig) { console.log(`${name}: mutation produced no change — abort`); continue; }
  fs.writeFileSync(m.file, mutated);
  try {
    // Assert applied at the intended site: re-read the file and diff it.
    const reread = fs.readFileSync(m.file, 'utf8');
    if (!reread.includes(mutatedSite) || reread.includes(siteText)) throw new Error('mutation not at intended site after write');
    const diff = spawnSync('git', ['-C', W, 'diff', '--', m.file], { encoding: 'utf8' }).stdout;
    const changed = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    console.log(`\n=== ${name} applied; git diff hunk lines (${changed.length}):\n${changed.join('\n')}`);
    if (name === 'M1') {
      const n = (reread.match(m.site)[0].match(/^\s+'[^']+',$/gm) || []).length;
      console.log(`M1: IMAGE_INPUTS entries now ${n}`);
    }
    const res = runSuite(name);
    console.log(`${name} suite: exit ${res.exit} | ${res.summary}\n${name} RED SET (${res.reds.length}):\n  ${res.reds.join('\n  ')}`);
  } finally {
    fs.writeFileSync(m.file, orig);
    const clean = spawnSync('git', ['-C', W, 'diff', '--exit-code'], { encoding: 'utf8' });
    console.log(`${name} restored; git diff --exit-code => ${clean.status}`);
  }
}
