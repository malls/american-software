// scratchpad/qa-priya/AS-90/mutants.mjs — drive run.mjs falsifiers on SCRATCH copies,
// bind-mounted over /app/demo/run.mjs in the branch image (project asc-rev-as90-mut).
// Each mutant asserts its mutation applied exactly once AT THE INTENDED SITE (anchored
// pattern + occurrence count) before running. The worktree is never touched.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-90/apps/invoicing';
const DIR = '/Users/forrest/Code/american-software-company/scratchpad/qa-priya/AS-90/mut';
mkdirSync(DIR, { recursive: true });
const original = readFileSync(`${WT}/demo/run.mjs`, 'utf8');

const MUTANTS = {
  // AC-1: total 1500 vs the mock's constant 1000 → 409 at step 9
  'ac1-1500': {
    anchor: /const LINE_ITEM = \{ description: 'Website redesign — milestone 1', quantity: 1, unitAmountMinor: 1000 \};/,
    replace: (s) => s.replace(/(const LINE_ITEM = \{[^}]*unitAmountMinor: )1000/, '$11500'),
  },
  // AC-8: a /v1/charges call from inside step 8's run(), before the app's own request
  'ac8-charges': {
    anchor: /n: '8',\n    title: 'Invoice draft',[\s\S]*?async run\(\) \{\n      const fields = \{/,
    replace: (s) => s.replace(/(n: '8',\n    title: 'Invoice draft',[\s\S]*?async run\(\) \{\n)(      const fields = \{)/, "$1      await stripe.request({ method: 'POST', path: '/v1/charges', platform: true, params: { amount: 1000, currency: 'usd' } });\n$2"),
  },
  // AC-7: step 11's delivery removed → step 12 shows draft, exit 0
  'ac7-no-paid': {
    anchor: /n: '11',\n    title: 'Paid',[\s\S]*?const res = await deliver\(event\);\n      expect\(res, 200\);/,
    replace: (s) => s.replace(/(n: '11',\n    title: 'Paid',[\s\S]*?state\.paidEvent = event;\n)      const res = await deliver\(event\);\n      expect\(res, 200\);/, "$1      const res = { status: 0, location: null, setCookie: null, body: '(delivery skipped by the reviewer mutant)', header: '(none)' };"),
  },
  // AC-7 corrected: BOTH 11 and 11b deliveries removed (11b re-delivers state.paidEvent)
  'ac7-no-paid-no-redeliver': {
    anchor: /n: '11b',\n    title: 'Paid, redelivered',[\s\S]*?const res = await deliver\(state\.paidEvent\);\n      expect\(res, 200\);/,
    replace: (s) => MUTANTS['ac7-no-paid'].replace(s).replace(/(n: '11b',\n    title: 'Paid, redelivered',[\s\S]*?async run\(\) \{\n)      const res = await deliver\(state\.paidEvent\);\n      expect\(res, 200\);/, "$1      const res = { status: 0, location: null, setCookie: null, body: '(redelivery skipped by the reviewer mutant)', header: '(none)' };"),
  },
  // M6: replay account.updated, deliver it 400 s stale, tamper one byte after signing
  'm6-webhook-probes': {
    anchor: /n: '5',\n    title: 'Readiness',[\s\S]*?const row = state\.repos\.connectedAccounts\.getByFreelancer\(state\.freelancerId\);\n      return \[/,
    replace: (s) => s.replace(/(n: '5',\n    title: 'Readiness',[\s\S]*?expect\(res, 200\);\n)(      const row = state\.repos\.connectedAccounts\.getByFreelancer\(state\.freelancerId\);\n      return \[)/, `$1      // --- reviewer probes (Priya, AS-90 review) ---
      const replay = await deliver(event);
      out(\`  PROBE replay same event id: \${replay.status} \${JSON.stringify(replay.body.trimEnd())}\`);
      {
        const payload = JSON.stringify(event);
        const t = Math.floor(Date.now() / 1000) - 400;
        const v1 = createHmac('sha256', WEBHOOK_SECRET).update(\`\${t}.\${payload}\`, 'utf8').digest('hex');
        const stale = await call('POST', '/webhooks/stripe', { body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': \`t=\${t},v1=\${v1}\` }, cookie: null });
        out(\`  PROBE t 400 s in the past: \${stale.status} \${JSON.stringify(stale.body.trimEnd())}\`);
      }
      {
        const { payload, header } = signedEvent(event);
        const tampered = payload.replace('"charges_enabled":true', '"charges_enabled":TRUE');
        if (tampered === payload) throw new Error('tamper did not apply');
        const t2 = await call('POST', '/webhooks/stripe', { body: tampered, headers: { 'content-type': 'application/json', 'stripe-signature': header }, cookie: null });
        out(\`  PROBE one byte tampered after signing: \${t2.status} \${JSON.stringify(t2.body.trimEnd())}\`);
      }
      {
        const { payload, header } = signedEvent(event);
        const t3 = await call('POST', '/webhooks/stripe', { body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': header.replace(/v1=[0-9a-f]{4}/, 'v1=0000') }, cookie: null });
        out(\`  PROBE signature digest altered: \${t3.status} \${JSON.stringify(t3.body.trimEnd())}\`);
      }
$2`),
  },
};

const which = process.argv.slice(2);
for (const name of which.length ? which : Object.keys(MUTANTS)) {
  const m = MUTANTS[name];
  if (!m) throw new Error(`unknown mutant ${name}`);
  const anchorHits = (original.match(new RegExp(m.anchor.source, 'g')) ?? []).length;
  if (anchorHits !== 1) throw new Error(`${name}: anchor hits ${anchorHits}, expected exactly 1 — mutation site is not unique`);
  const mutated = m.replace(original);
  if (mutated === original) throw new Error(`${name}: mutation did NOT apply`);
  const file = `${DIR}/${name}.run.mjs`;
  writeFileSync(file, mutated);
  // Show the diff so the site is visible in the record.
  const d = spawnSync('diff', ['-u', `${WT}/demo/run.mjs`, file], { encoding: 'utf8' });
  console.log(`\n===== ${name} — diff vs shipped run.mjs =====\n${d.stdout.split('\n').slice(2).join('\n')}`);
  const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-rev-as90-mut', 'run', '--rm', '--build', '-v', `${file}:/app/demo/run.mjs:ro`, 'demo'], {
    cwd: WT, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(`${DIR}/${name}.log`, `${r.stdout}\n--- stderr ---\n${r.stderr}\nexit=${r.status}\n`);
  const built = /Image \S+ Built/.exec(r.stderr)?.[0] ?? '(no Built line)';
  const stopped = r.stdout.split('\n').filter((l) => /^STOPPED|^demo:|PROBE|^\[12\/12\]|status (paid|draft)$/.test(l) || /invoice [0-9a-f-]+: status/.test(l));
  console.log(`===== ${name}: exit=${r.status}; ${built}\n${stopped.map((l) => `  ${l}`).join('\n')}`);
}
