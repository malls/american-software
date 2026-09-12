// mutant.js <name> <file-relative-to-worktree> <mutation-module>
// Backs up the file, registers restore on exit (normal, error, or signal),
// applies the mutation via the module's `mutate(text) -> {out, assert(after)}`,
// asserts it applied at the intended site, runs the compose suite with --build,
// logs to the scratchpad, then restores and proves the tree clean by sha + git.
const fs = require('fs');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const [name, rel, mutModule] = process.argv.slice(2);
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-71';
const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-71';
const file = path.join(WT, rel);
const bak = path.join(SP, `${name}.backup`);
const log = path.join(SP, `run-${name}.log`);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const original = fs.readFileSync(file, 'utf8');
fs.writeFileSync(bak, original);
const before = sha(file);
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  fs.writeFileSync(file, original);
  const after = sha(file);
  console.log(`restore: sha before=${before.slice(0, 16)} after=${after.slice(0, 16)} ${before === after ? 'MATCH' : 'MISMATCH'}`);
  const d = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--', rel], { encoding: 'utf8' });
  console.log(`restore: git diff --exit-code on ${rel} -> ${d.status === 0 ? 'clean' : 'DIRTY'}`);
  const s = spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' });
  console.log(`restore: git status --porcelain -> ${JSON.stringify(s.stdout)}`);
}
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { restore(); process.exit(130); });

try {
  const { mutate } = require(mutModule);
  const { out, assert } = mutate(original);
  fs.writeFileSync(file, out);
  const after = fs.readFileSync(file, 'utf8');
  assert(after); // throws if the mutation did not land at the intended site
  const stat = spawnSync('git', ['-C', WT, 'diff', '--stat', '--', rel], { encoding: 'utf8' }).stdout.trim().split('\n').pop();
  console.log(`mutation applied: ${stat}`);
  fs.writeFileSync(path.join(SP, `${name}.mutant.diff`), spawnSync('git', ['-C', WT, 'diff', '--', rel], { encoding: 'utf8' }).stdout);

  const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-review-as71', 'run', '--rm', '--build', 'test'], {
    cwd: path.join(WT, 'apps/invoicing'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
  });
  const text = (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || '') + '\nexit=' + r.status + '\n';
  fs.writeFileSync(log, text);
  console.log('compose exit', r.status);
  const built = /Image asc-review-as71-test\s+Built/.test(text);
  console.log(`receipt: ${built ? 'Image asc-review-as71-test Built' : 'NO BUILD LINE — RUN VOID'}`);
  for (const k of ['tests', 'pass', 'fail', 'skipped']) {
    const m = text.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm'));
    console.log(`${k}: ${m ? m[1] : '?'}`);
  }
  console.log('--- red set (top-level ✖ lines) ---');
  for (const line of text.split('\n')) if (/^✖ /.test(line)) console.log(line);
} catch (e) {
  console.error('MUTANT RUN ERROR:', e.message);
  process.exitCode = 2;
}
