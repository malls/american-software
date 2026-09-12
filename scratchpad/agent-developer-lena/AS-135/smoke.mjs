// Module-graph smoke against a worktree server (plan step 4, non-interactive
// half): boot server.js on a spare port with a throwaway DB, verify every
// module app.js imports (and message-pane.js's own imports) is served 200,
// then verify the browser's ESM graph actually evaluates by importing app.js's
// pure dependencies from the served URLs' on-disk twins. Kills the server.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const chat = process.argv[2];
const port = 8399;
const base = `http://127.0.0.1:${port}`;
const srv = spawn(process.execPath, ['server.js'], {
  cwd: chat,
  env: { ...process.env, PORT: String(port), CHAT_DB: '/tmp/as135-manual.db' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
srv.stdout.on('data', (d) => (logs += d));
srv.stderr.on('data', (d) => (logs += d));
try {
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await sleep(300);
    try { up = (await fetch(base + '/')).status === 200; } catch {}
  }
  if (!up) throw new Error('server did not come up: ' + logs);
  const app = await (await fetch(base + '/app.js')).text();
  const imports = [...app.matchAll(/from '\.\/([\w-]+\.js)'/g)].map((m) => m[1]);
  const missing = [];
  for (const f of imports) {
    const r = await fetch(base + '/' + f);
    if (r.status !== 200 || !/javascript/.test(r.headers.get('content-type') || '')) missing.push(`${f}:${r.status}`);
  }
  console.log(`app.js imports ${imports.length} modules; missing: ${missing.length ? missing.join(', ') : 'none'}`);
  const mp = await (await fetch(base + '/message-pane.js')).text();
  const mpImports = [...mp.matchAll(/from '\.\/([\w-]+\.js)'/g)].map((m) => m[1]);
  for (const f of mpImports) {
    const r = await fetch(base + '/' + f);
    console.log(`message-pane.js -> ${f}: ${r.status}`);
  }
  // ESM evaluation of the pure graph (the browser-only app.js needs document).
  const mod = await import(`${chat}/public/message-pane.js`);
  console.log('message-pane.js exports:', Object.keys(mod).sort().join(', '));
  process.exitCode = missing.length ? 1 : 0;
} finally {
  srv.kill('SIGTERM');
}
