// End-to-end truth check for AS-113: a slow (300 ms) but live fake server on an
// ephemeral loopback port. Before the fix, budget 2147483648 clamped to 1 ms and
// refused this server as ambiguous ("timed out after 2147483648 ms"). After the
// fix it must be refused at parse time (exit 1, before any fetch), and the
// ceiling 2147483647 must actually wait the 300 ms and reach the server.
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
const CLI = '/Users/forrest/Code/american-software-company/.worktrees/AS-113/apps/chat/bin/chat.js';
let hits = 0;
const srv = createServer((req, res) => {
  hits++;
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/api/identities')) res.end(JSON.stringify({ identities: [] }));
    else res.end(JSON.stringify({ conversations: [] }));
  }, 300);
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${srv.address().port}`;
function run(budget) {
  const env = { ...process.env, CHAT_API: base, CHAT_PROBE_TIMEOUT_MS: budget };
  delete env.CHAT_DB; delete env.CHAT_MODE;
  const before = hits; const t0 = Date.now();
  const r = spawnSync('node', [CLI, 'channels', '--me', 'human:forrest'], { env, encoding: 'utf8' });
  const chatLine = (r.stderr || '').split('\n').find((l) => l.startsWith('chat:')) || '(none)';
  console.log(`budget=${budget} exit=${r.status} wall=${Date.now() - t0}ms serverHits=${hits - before} stderr=${chatLine}`);
}
run('2147483648');
run('2147483647');
run('1'); // control: a genuinely 1 ms budget against the 300 ms server IS ambiguous — the message names 1 ms, which it did spend
srv.close();
