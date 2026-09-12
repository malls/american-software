// AS-121 cycle 1 (developer-lena): run the opt-in real-docker T11 + T13 on the branch and scan for leftovers.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-121/apps/chat`;
const D = JSON.parse(readFileSync(`${ROOT}/apps/chat/data/deploy-state.json`, 'utf8')).dockerBin;
const S = `${ROOT}/scratchpad/agent-developer-lena/AS-121/cycle1`;

const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=T1[13]', 'test/compose-run.test.js'], {
  cwd: W, encoding: 'utf8', env: { ...process.env, AS106_REAL: '1', ADVANCE_DOCKER_BIN: D }, maxBuffer: 64 * 1024 * 1024,
});
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${S}/real-T11-T13.log`, out);
console.log(`node --test exit=${r.status}`);
for (const l of out.split('\n')) if (/T1[13]|^ℹ (tests|pass|fail|skipped) /.test(l)) console.log(l);
const nets = spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith('asc-as1'));
const imgs = spawnSync(D, ['images', '--format', '{{.Repository}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith('asc-as1') || n.startsWith('asc-impl-as121'));
console.log(`leftover scan: networks=${JSON.stringify(nets)} images=${JSON.stringify(imgs)}`);
