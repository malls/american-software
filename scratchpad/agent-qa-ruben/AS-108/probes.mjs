// AS-108 review: M6 probes past the list, on a scratch repo under /tmp (a symlink to
// /private/tmp on macOS) — never the real repo.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, realpathSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { relPathOf, makeLanesOps, parseWorktreeList } from '/Users/forrest/Code/american-software-company/.worktrees/AS-108/apps/chat/watch/advance-watcher.mjs';

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const base = mkdtempSync('/tmp/as108-probe-');       // NON-canonical: /tmp/...
const real = realpathSync(base);                       // canonical: /private/tmp/...
console.log('P0 base (as given):', base, '| realpath:', real);
try {
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(['init', '-q', '-b', 'master'], repo);
  git(['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '--allow-empty', '-m', 'init'], repo);
  // linked worktree added THROUGH the symlinked path, inside the root and outside it
  git(['worktree', 'add', '-q', join(repo, '.worktrees', 'AS-1'), '-b', 'a'], repo);
  git(['worktree', 'add', '-q', join(base, 'outside-wt'), '-b', 'b'], repo);
  // a symlink-to-symlink root
  const link1 = join(real, 'link1'); symlinkSync(join(real, 'repo'), link1);
  const link2 = join(real, 'link2'); symlinkSync(link1, link2);
  const porcelain = git(['worktree', 'list', '--porcelain'], repo).stdout;
  console.log('P1 git worktree list --porcelain (cwd = symlinked path):\n' + porcelain);
  const rows = parseWorktreeList(porcelain);
  for (const [label, root] of [['as-given /tmp', repo], ['link2 -> link1 -> real', link2], ['link2 with trailing slash', link2 + '/'], ['upper-cased real', real.replace('/private/tmp', '/PRIVATE/TMP')]]) {
    let canon; try { canon = realpathSync.native(root); } catch (e) { canon = `THROWS ${e.code}`; }
    console.log(`P2 root=${label}: realpath.native -> ${canon}`);
    console.log('   relPaths vs canon:', rows.map((r) => relPathOf(canon, r.path)));
    console.log('   relPaths vs as-given:', rows.map((r) => relPathOf(root, r.path)));
  }
  // P3: full makeLanesOps with the DEFAULT realpath against the scratch repo, root given via link2
  const writes = [], logs = [];
  const ops = makeLanesOps({ repoRoot: link2, statePath: join(real, 'wt.json'), gitBin: 'git', writeState: (p, b) => writes.push(b), log: (l) => logs.push(l) });
  await ops.evaluate();
  console.log('P3 default-wired evaluate via link2:', JSON.stringify(writes[0].worktrees.map((r) => [r.relPath, r.main])), 'logs:', logs);
  // P4: root is a prefix of a sibling path
  console.log('P4 prefix sibling:', relPathOf('/private/tmp/x/repo', '/private/tmp/x/repo2/wt'), '|', relPathOf('/private/tmp/x/repo', '/private/tmp/x/repo/'));
  // P5: worktree removed between polls (prunable) — does anything throw?
  rmSync(join(base, 'outside-wt'), { recursive: true, force: true });
  await ops.evaluate();
  console.log('P5 after rm of outside-wt:', JSON.stringify(writes[1].worktrees.map((r) => [r.relPath, r.prunable ?? null])), 'error:', writes[1].error, 'logs:', logs.length);
  // P6: root vanished between polls (ENOENT masking)
  const ops2 = makeLanesOps({ repoRoot: join(real, 'gone'), statePath: join(real, 'wt2.json'), gitBin: 'git', writeState: (p, b) => writes.push(b), log: (l) => logs.push(l) });
  await ops2.evaluate();
  console.log('P6 vanished root:', JSON.stringify({ error: writes[2].error, rows: writes[2].worktrees?.length }), 'logs:', logs.slice(-2));
} finally {
  rmSync(real, { recursive: true, force: true });
}
