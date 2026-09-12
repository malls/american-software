// AS-61 M6 probes (agent:qa-priya). Scratch root only; ephemeral port; never the real repo.
import { mkdtempSync, rmSync, cpSync, writeFileSync, mkdirSync, symlinkSync, linkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '/Users/forrest/Code/american-software-company/.worktrees/AS-61/apps/chat/server.js';

const FIX = '/Users/forrest/Code/american-software-company/.worktrees/AS-61/apps/chat/test/fixtures/repo';
const outer = mkdtempSync(join(tmpdir(), 'p61-outer-'));
const root = join(outer, 'repo');
cpSync(FIX, root, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'p61-data-'));

// P1: hard link whose OTHER name is outside the root entirely.
writeFileSync(join(root, 'inside.md'), 'inside\n');
linkSync(join(root, 'inside.md'), join(outer, 'outside-name.md'));
// P2: symlink -> hard-linked file (3b should fire before 4b).
mkdirSync(join(root, '.lattice', 'plans'), { recursive: true });
writeFileSync(join(root, '.lattice', 'plans', 'p.md'), 'plan\n');
linkSync(join(root, '.lattice', 'plans', 'p.md'), join(root, 'hl.md'));
symlinkSync(join(root, 'hl.md'), join(root, 'sym-to-hl.md'));
// P3: hard link to a .claude/ markdown planted in the scratch root.
mkdirSync(join(root, '.claude'), { recursive: true });
writeFileSync(join(root, '.claude', 'secret.md'), 'claude md\n');
linkSync(join(root, '.claude', 'secret.md'), join(root, 'looks-public.md'));
// P4: hard-linked directory attempt.
let dirLink = 'n/a';
try { linkSync(join(root, '.claude'), join(root, 'dirlink')); dirLink = 'CREATED'; } catch (e) { dirLink = 'refused: ' + e.code; }
// P5: nlink 3 (two extra names).
writeFileSync(join(root, 'tri.md'), 'tri\n');
linkSync(join(root, 'tri.md'), join(root, 'tri2.md'));
linkSync(join(root, 'tri.md'), join(root, 'tri3.md'));
// P6: positive control, fixture-shipped README (nlink 1).
writeFileSync(join(root, 'README.md'), '# ok\n');

const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: root, dataDir: join(dir, 'ld') });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => { const r = await fetch(`${base}/api/file?path=${encodeURIComponent(p)}`); return { status: r.status, body: await r.text() }; };
const ref = await get('no-such-file.md');
console.log('REF 404:', ref);
console.log('dir hardlink attempt:', dirLink);
for (const p of ['inside.md', 'hl.md', 'sym-to-hl.md', '.lattice/plans/p.md', 'looks-public.md', '.claude/secret.md', 'tri.md', 'tri2.md', 'README.md', 'dirlink/secret.md']) {
  let nl = '-'; try { nl = statSync(join(root, p)).nlink; } catch {}
  const r = await get(p);
  const same = r.status === ref.status && r.body === ref.body;
  console.log(`${p.padEnd(24)} nlink=${String(nl).padEnd(3)} -> ${r.status} ${same ? '(byte-identical to ref 404)' : r.body.slice(0, 60)}`);
}
await close();
rmSync(outer, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
