// AS-28 review probes (qa-priya). Boots the worktree server on an ephemeral
// port with a scratch DB and drives raw HTTP at it. Read-only against the
// worktree; writes only to a tmp dir.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createChatServer } from '/Users/forrest/Code/american-software-company/.worktrees/AS-28/apps/chat/server.js';

const FIXTURE_ROOT = resolve('/Users/forrest/Code/american-software-company/.worktrees/AS-28/apps/chat/test/fixtures/repo');
const REAL_ROOT = '/Users/forrest/Code/american-software-company/.worktrees/AS-28';

async function boot(repoRoot) {
  const dir = mkdtempSync(join(tmpdir(), 'as28-probe-'));
  const { server, close } = createChatServer({
    dbPath: join(dir, 'chat.db'), repoRoot, dataDir: join(dir, 'loop-data'),
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: async () => { await close(); rmSync(dir, { recursive: true, force: true }); } };
}

// Raw socket request so nothing on the client side normalizes the path.
import { connect } from 'node:net';
function raw(base, target, method = 'GET') {
  const { hostname, port } = new URL(base);
  return new Promise((ok, err) => {
    const sock = connect(Number(port), hostname, () => {
      sock.write(`${method} ${target} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (d) => (buf += d));
    sock.on('end', () => {
      const [head, ...rest] = buf.split('\r\n\r\n');
      const [status, ...hdrs] = head.split('\r\n');
      ok({ status, headers: hdrs, body: rest.join('\r\n\r\n') });
    });
    sock.on('error', err);
  });
}

const { base, stop } = await boot(FIXTURE_ROOT);
try {
  const targets = [
    '/favicon.svg',
    '/favicon.svg/',
    '/favicon.svg/../favicon.svg',
    '/../favicon.svg',
    '/%2e%2e/favicon.svg',
    '/public/favicon.svg',
    '/favicon%2Esvg',
    '/favicon%2esvg',
    '/FAVICON.SVG',
    '/favicon.svg?x=1',
    '/favicon.svg#frag',
    '//favicon.svg',
    '/./favicon.svg',
    '/%2Ffavicon.svg',
    '/favicon.svg%00',
    '/__proto__',
    '/constructor',
    '/favicon.ico',
  ];
  console.log('--- path probes (raw socket, no client normalization) ---');
  for (const t of targets) {
    const r = await raw(base, t);
    const ct = r.headers.find((h) => /^content-type/i.test(h)) || '(no content-type)';
    console.log(`${t.padEnd(28)} -> ${r.status.replace('HTTP/1.1 ', '').padEnd(16)} ${ct.padEnd(44)} body[0..20]=${JSON.stringify(r.body.slice(0, 20))}`);
  }
  console.log('--- method probes ---');
  for (const m of ['HEAD', 'POST', 'OPTIONS']) {
    const r = await raw(base, '/favicon.svg', m);
    console.log(`${m.padEnd(8)} /favicon.svg -> ${r.status.replace('HTTP/1.1 ', '')} body[0..40]=${JSON.stringify(r.body.slice(0, 40))}`);
  }
  console.log('--- full headers on the happy path ---');
  const happy = await raw(base, '/favicon.svg');
  for (const h of happy.headers) console.log('  ' + h);
  console.log('  body bytes:', Buffer.byteLength(happy.body));
} finally {
  await stop();
}

// AS-34 /api/file gate, against the REAL worktree root (the fixture has no apps/chat).
const real = await boot(REAL_ROOT);
try {
  console.log('--- /api/file gate probes (repo root = worktree) ---');
  for (const p of ['apps/chat/public/favicon.svg', 'apps/chat/public/favicon.svg.md', 'apps/chat/public/index.html', 'README.md']) {
    const res = await fetch(`${real.base}/api/file?path=${encodeURIComponent(p)}`);
    const body = await res.text();
    console.log(`${p.padEnd(36)} -> ${res.status} ${res.headers.get('content-type')} body[0..30]=${JSON.stringify(body.slice(0, 30))}`);
  }
} finally {
  await real.stop();
}
