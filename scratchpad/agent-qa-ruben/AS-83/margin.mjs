// M6: margin probe. 150 ms slow proxy in front of a real in-process server; budgets 100, 200 (and 150 edge, 50, 20000).
// The verdict must flip AT the budget: 100 -> refused (timed out after 100 ms), 200 -> up (exit 0, write in server view).
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer as createTcpServer, connect as tcpConnect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
const { createChatServer } = await import(`${W}/server.js`);
const BIN = `${W}/bin/chat.js`;
const FIX = `${W}/test/fixtures/repo`;
const dir = mkdtempSync(join(tmpdir(), 'as83-margin-'));
const { server: s, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIX });
await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
const port = s.address().port;
const sockets = new Set();
const DELAY = Number(process.argv[2] || 150);
const proxy = createTcpServer((client) => {
  sockets.add(client); client.on('error', () => {});
  setTimeout(() => { const up = tcpConnect({ port, host: '127.0.0.1' }); sockets.add(up); up.on('error', () => client.destroy()); client.pipe(up).pipe(client); }, DELAY);
});
await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok));
const pbase = `http://127.0.0.1:${proxy.address().port}`;
function run(args, env) {
  const base = { ...process.env, CHAT_REPO_ROOT: FIX, NODE_OPTIONS: '--no-warnings' };
  for (const k of ['CHAT_MODE', 'CHAT_API', 'CHAT_DB', 'CHAT_ME', 'CHAT_PROBE_TIMEOUT_MS']) delete base[k];
  const t0 = performance.now();
  return new Promise((done) => { const c = spawn(process.execPath, [BIN, ...args], { env: { ...base, ...env } }); let o = '', e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.on('close', (status, signal) => done({ status, signal, stdout: o, stderr: e, ms: Math.round(performance.now() - t0) })); });
}
const budgets = (process.argv[3] || '100,200,150,50,20000').split(',');
for (const b of budgets) {
  const phantom = join(mkdtempSync(join(tmpdir(), 'as83-ph-')), 'nested', 'chat.db');
  rmSync(dirname(dirname(phantom)), { recursive: true, force: true });
  const r = await run(['dm', 'agent:ceo-carla', `margin ${b}`, '--me', 'human:forrest', '--json'], { CHAT_API: pbase, CHAT_DB: phantom, CHAT_PROBE_TIMEOUT_MS: b });
  const reason = (r.stderr.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
  console.log(`delay=${DELAY} budget=${b}: exit ${r.status} signal ${r.signal} after ${r.ms} ms; stdout=${r.stdout.trim().slice(0, 40) || "''"}; reason='${reason}'; dbTouched=${existsSync(dirname(phantom))}`);
}
for (const x of sockets) x.destroy();
proxy.close();
await close();
rmSync(dir, { recursive: true, force: true });
