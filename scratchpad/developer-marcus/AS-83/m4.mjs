// AS-83 M4 (scratch, not committed): the old 500 ms budget under R1 load reds again.
// One indivisible step: back up -> mutate -> assert applied AT the site -> rebuild
// -> run -> restore -> assert restored (sha + git status) -> rebuild -> run.
// RUNS must not overlap a counted R2 run: the image COPYs this source.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DOCKER = '/usr/local/bin/docker';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-83';
const APP = `${WT}/apps/chat`;
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/developer-marcus/AS-83';
const FILE = `${APP}/test/mode.test.js`;
const RUNS = Number(process.env.M4_RUNS || 2); // plan asks 3+3; tick clock may force fewer

const sha = (s) => createHash('sha256').update(s).digest('hex');
const count = (h, n) => h.split(n).length - 1;
const log = (s) => { console.log(s); appendFileSync(`${OUT}/m4.log`, s + '\n'); };
const must = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); log('  ok: ' + m); };
const now = () => new Date().toISOString().slice(11, 19) + 'Z';

// R1 load: 20 cpu-burn siblings (container nproc 10) inside the test container.
const BURN =
  'P=""; i=0; while [ $i -lt 20 ]; do node -e "for(;;){}" & P="$P $!"; i=$((i+1)); done; ' +
  'sleep 1; node --test test/mode.test.js; s=$?; kill $P 2>/dev/null; exit $s';

function r1(tag) {
  const t0 = Date.now();
  const r = spawnSync(DOCKER, ['compose', '-p', 'as83test', 'run', '--build', '--rm', 'test', 'sh', '-c', BURN],
    { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${OUT}/${tag}.txt`, out);
  const g = (k) => { const m = out.match(new RegExp('^[#ℹ] ' + k + ' (\\d+)$', 'm')); return m ? +m[1] : null; };
  const built = (out.match(/^.*Image as83test-test\s+Built.*$/m) || ['NO BUILD LINE'])[0].trim();
  const failing = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].trim());
  const rec = { tag, exit: r.status, tests: g('tests'), pass: g('pass'), fail: g('fail'), built,
    failing, secs: Math.round((Date.now() - t0) / 1000) };
  log(`[${now()}] ${tag} -> ${JSON.stringify(rec)}`);
  return rec;
}

const original = readFileSync(FILE, 'utf8');
const before = sha(original);
const OLD = "  return { CHAT_API: base, CHAT_DB: phantom, CHAT_PROBE_TIMEOUT_MS: '20000', ...extra };";
const NEW = "  return { CHAT_API: base, CHAT_DB: phantom, CHAT_PROBE_TIMEOUT_MS: '500', ...extra };";
log(`[${now()}] M4 mode.test.js sha BEFORE ${before}`);
const results = { mutated: [], restored: [] };

try {
  must(count(original, OLD) === 1, 'the apiEnv return line occurs exactly once');
  must(count(original, "'20000'") === 1, "'20000' occurs exactly once in the file");
  must(count(original, "'500'") === 0, "'500' occurs zero times before the mutation");
  const mutated = original.replace(OLD, NEW);
  if (mutated === original) throw new Error('mutation produced an identical file');
  writeFileSync(FILE, mutated);
  const after = readFileSync(FILE, 'utf8');
  must(count(after, "'20000'") === 0, "'20000' now occurs zero times");
  must(count(after, "'500'") === 1, "'500' now occurs exactly once");
  const a = after.indexOf('function apiEnv');
  const b = after.indexOf('\n}', a);
  must(a > -1 && b > a, 'apiEnv body located');
  must(count(after.slice(a, b), "CHAT_PROBE_TIMEOUT_MS: '500'") === 1,
    'the mutation landed INSIDE apiEnv (intended site), not elsewhere');
  for (let i = 1; i <= RUNS; i++) results.mutated.push(r1(`m4-mutated-${i}`));
} finally {
  writeFileSync(FILE, original);
  const back = readFileSync(FILE, 'utf8');
  log(`[${now()}] M4 sha AFTER ${sha(back)} restored_equal=${sha(back) === before}`);
  const gs = spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' });
  log(`[${now()}] git status --porcelain: ${JSON.stringify(gs.stdout)}`);
  if (sha(back) !== before || (gs.stdout || '').trim() !== '') {
    log('[FATAL] tree not clean after restore — NOT running the restored half');
  } else {
    for (let i = 1; i <= RUNS; i++) results.restored.push(r1(`m4-restored-${i}`));
  }
  writeFileSync(`${OUT}/m4-results.json`, JSON.stringify(results, null, 2));
  log('[M4 DONE] ' + JSON.stringify(results, null, 2));
}
