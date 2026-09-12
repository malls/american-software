// Does a completed fetch carrying AbortSignal.timeout(N) hold the event loop?
// Usage: node hang.mjs <timeoutMs>
import { createServer } from 'node:http';
const ms = Number(process.argv[2]);
const s = createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('{"identities":[]}'); });
await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${s.address().port}`;
const t0 = Date.now();
const res = await fetch(base + '/api/identities', { signal: AbortSignal.timeout(ms) });
console.log('status', res.status, await res.text(), 'after', Date.now() - t0, 'ms');
s.closeAllConnections?.();
s.close();
const watchdog = setTimeout(() => { console.log(`STILL ALIVE 3 s after fetch completed with timeout=${ms}: loop held`); process.exit(3); }, 3000);
watchdog.unref();
