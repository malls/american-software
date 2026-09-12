import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
const t = readFileSync(`${W}/test/mode.test.js`, 'utf8');
const c = readFileSync(`${W}/lib/client.js`, 'utf8');
const b = readFileSync(`${W}/bin/chat.js`, 'utf8');
const count = (s, re) => (s.match(re) || []).length;
const grepn = (s, re) => s.split('\n').map((l, i) => (re.test(l) ? `${i + 1}: ${l}` : null)).filter(Boolean).join('\n');
console.log('AC-1 status,0,describeExit =', count(t, /status, 0, describeExit/g), ' status,0, total =', count(t, /status, 0, /g));
console.log('AC-2 timed out after in client.js:\n' + grepn(c, /timed out after/));
console.log('AC-3 500|3000 in client.js:\n' + grepn(c, /500|3000/));
console.log('knob literal in chat.js:\n' + grepn(b, /CHAT_PROBE_TIMEOUT_MS/));
console.log("apiEnv '20000':\n" + grepn(t, /'20000'/));
console.log("'500' in test:\n" + grepn(t, /'500'/));
console.log('createApiBackend(api):\n' + grepn(b, /createApiBackend\(api\)/));
console.log('isConnDown(e):\n' + grepn(c, /isConnDown\(e\)/));
console.log('--- docker ---');
for (const a of [['compose', 'ls'], ['ps', '--format', '{{.Names}} {{.Status}}']]) {
  const r = spawnSync('/usr/local/bin/docker', a, { encoding: 'utf8' });
  console.log(a.join(' ') + ':\n' + (r.stdout || r.stderr));
}
const ps = spawnSync('ps', ['-eo', 'pid,etime,command'], { encoding: 'utf8' });
console.log('docker compose procs:\n' + ps.stdout.split('\n').filter((l) => /docker compose|buildkit|docker build/.test(l) && !/grep/.test(l)).map((l) => l.slice(0, 160)).join('\n'));
