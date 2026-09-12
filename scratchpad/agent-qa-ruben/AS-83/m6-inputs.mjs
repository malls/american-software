// M6 extra: knob edge inputs nothing tested, and the CHAT_MODE=api refusal carrying a reason.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer as createTcpServer, connect as tcpConnect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
const { createChatServer } = await import(`${W}/server.js`);
const BIN = `${W}/bin/chat.js`;
const FIX = `${W}/test/fixtures/repo`;
function run(args, env) {
  const base = { ...process.env, CHAT_REPO_ROOT: FIX, NODE_OPTIONS: '--no-warnings' };
  for (const k of ['CHAT_MODE', 'CHAT_API', 'CHAT_DB', 'CHAT_ME', 'CHAT_PROBE_TIMEOUT_MS']) delete base[k];
  const t0 = Date.now();
  return new Promise((done) => { const c = spawn(process.execPath, [BIN, ...args], { env: { ...base, ...env } }); let o = '', e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.on('close', (status) => done({ status, stdout: o, stderr: e, ms: Date.now() - t0 })); });
}
// 1. knob edge inputs on rule 4 (CHAT_DB alone)
for (const v of ['007', '1e3', ' 5', '5 ', '+5', '2.5', '99999999999']) {
  const dir = mkdtempSync(join(tmpdir(), 'as83-knob-'));
  const r = await run(['channels', '--me', 'human:forrest'], { CHAT_DB: join(dir, 'chat.db'), CHAT_PROBE_TIMEOUT_MS: v });
  console.log(`knob=${JSON.stringify(v)}: exit ${r.status}; stderr=${r.stderr.trim().slice(0, 90) || "''"}`);
  rmSync(dir, { recursive: true, force: true });
}
// 2. CHAT_MODE=api against a slow proxy with a tiny budget: refusal must carry the reason
const dir = mkdtempSync(join(tmpdir(), 'as83-api-'));
const { server: s, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIX });
await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
const port = s.address().port;
const sockets = new Set();
const proxy = createTcpServer((client) => { sockets.add(client); client.on('error', () => {}); setTimeout(() => { const up = tcpConnect({ port, host: '127.0.0.1' }); sockets.add(up); up.on('error', () => client.destroy()); client.pipe(up).pipe(client); }, 150); });
await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok));
const pbase = `http://127.0.0.1:${proxy.address().port}`;
const ph = join(mkdtempSync(join(tmpdir(), 'as83-ph-')), 'nested', 'x.db');
const r = await run(['channels', '--me', 'human:forrest'], { CHAT_MODE: 'api', CHAT_API: pbase, CHAT_DB: ph, CHAT_PROBE_TIMEOUT_MS: '50' });
console.log(`CHAT_MODE=api slow proxy budget 50: exit ${r.status} after ${r.ms} ms; dbTouched=${existsSync(dirname(ph))}; stderr=${r.stderr.trim()}`);
// 3. squatter reason (wrong shape) and 5xx reason via a raw http server
const { createServer: http } = await import('node:http');
const sq = http((req, res) => { res.writeHead(500); res.end('boom'); });
await new Promise((ok) => sq.listen(0, '127.0.0.1', ok));
const r5 = await run(['channels', '--me', 'human:forrest'], { CHAT_API: `http://127.0.0.1:${sq.address().port}`, CHAT_DB: ph });
console.log(`5xx squatter: exit ${r5.status}; dbTouched=${existsSync(dirname(ph))}; reason=${(r5.stderr.match(/\(([^)]*)\)\s*$/) || [])[1]}`);
sq.close();
for (const x of sockets) x.destroy();
proxy.close();
await close();
rmSync(dir, { recursive: true, force: true });
