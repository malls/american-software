// qa-priya AS-28 cycle 2: boot the WORKTREE server in-process on a random
// loopback port with a scratch data dir, and probe the served favicon.
import { createChatServer } from '/Users/forrest/Code/american-software-company/.worktrees/AS-28/apps/chat/server.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'as28-priya-'));
const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: dir, dataDir: join(dir, 'loop-data') });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
try {
  const onDisk = readFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-28/apps/chat/public/favicon.svg');
  const r = await fetch(base + '/favicon.svg');
  const served = Buffer.from(await r.arrayBuffer());
  console.log('GET /favicon.svg', r.status, [...r.headers.entries()].filter(([k]) => /content|cache|security|x-/.test(k)));
  console.log('served bytes', served.length, 'sha', sha(served), '| on disk', onDisk.length, 'sha', sha(onDisk), '| equal:', served.equals(onDisk));
  console.log('non-ASCII bytes in served:', [...served].filter((b) => b > 127).length);
  const page = await (await fetch(base + '/')).text();
  const linkIdx = page.indexOf('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
  const cssIdx = page.indexOf('<link rel="stylesheet" href="/style.css">');
  const headEnd = page.indexOf('</head>');
  console.log('index.html link line at', linkIdx, '| after stylesheet:', linkIdx > cssIdx, '| inside head:', linkIdx < headEnd, '| occurrences:', page.split('<link rel="icon"').length - 1);
  for (const p of ['/favicon.ico', '/FAVICON.SVG', '/favicon.svg/', '/favicon%2Esvg', '/public/favicon.svg', '/api/file?path=apps/chat/public/favicon.svg', '/favicon.svg?x=1']) {
    const rr = await fetch(base + p);
    console.log('GET', p, '->', rr.status, rr.headers.get('content-type'));
  }
  const head = await fetch(base + '/favicon.svg', { method: 'HEAD' });
  console.log('HEAD /favicon.svg ->', head.status);
  // Parse the SVG the way the guard does and independently: whole paint values, comments stripped.
  const art = onDisk.toString().replace(/<!--[\s\S]*?-->/g, '');
  const paints = [...art.matchAll(/\b(fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[2] ?? m[3]]);
  console.log('independent paint scan (both quote styles):', paints);
  console.log('elements:', [...art.matchAll(/<([a-zA-Z:]+)[\s/>]/g)].map((m) => m[1]));
  console.log('attributes present:', [...new Set([...art.matchAll(/\s([a-zA-Z:-]+)\s*=/g)].map((m) => m[1]))]);
} finally {
  await close();
  rmSync(dir, { recursive: true, force: true });
}
