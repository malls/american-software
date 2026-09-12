// e2e-probe.mjs — AS-99 cycle-2 live probes without a browser and without
// touching the production watcher or container.
//
// Probe A: run the branch's real makeLanesOps (real git, read-only calls) against
//          the REAL repo root, write the snapshot into a temp data dir, boot the
//          branch's createChatServer on an ephemeral port with repoRoot = the
//          real checkout (read-only .lattice) and a temp db, GET /api/lanes.
//          Check: AS-99 and AS-28 lanes present and joined; no '/Users/' string
//          anywhere in the payload; badge/caption words for the real state.
// Probe B: scratch git repo in /tmp: one linked worktree INSIDE the root, one
//          detached worktree OUTSIDE the root (/tmp/...), and one worktree whose
//          admin dir has been removed (broken). Run makeLanesOps for real and
//          inspect relPath, lane.key, and errors[] for host-path leaks.
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BR = '/Users/forrest/Code/american-software-company/.worktrees/AS-99/apps/chat';
const REPO = '/Users/forrest/Code/american-software-company';
const { makeLanesOps, runSync } = await import(`${BR}/watch/advance-watcher.mjs`);
const { createChatServer } = await import(`${BR}/server.js`);
const { describeLanes, describeLane } = await import(`${BR}/public/lanes.js`);

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}: ${r.stderr}`);
  return r.stdout;
}

// ---------------- Probe A ----------------
const tmp = mkdtempSync(join(tmpdir(), 'as99-probe-'));
const dataDir = join(tmp, 'data');
mkdirSync(dataDir);
const statePath = join(dataDir, 'worktrees.json');
const ops = makeLanesOps({ repoRoot: REPO, statePath, log: (l) => console.log('[watcher]', l) });
const t0 = Date.now();
await ops.evaluate();
console.log(`A: evaluate() took ${Date.now() - t0} ms`);
const snap = JSON.parse(readFileSync(statePath, 'utf8'));
console.log('A: snapshot error =', snap.error, 'rows =', snap.worktrees.length, 'relPaths =', JSON.stringify(snap.worktrees.map((w) => w.relPath)));
const rawSnap = readFileSync(statePath, 'utf8');
console.log('A: snapshot contains "/Users/":', rawSnap.includes('/Users/'), ' contains "american-software-company":', rawSnap.includes('american-software-company'));

const { server, close } = createChatServer({ dbPath: join(tmp, 'chat.db'), repoRoot: REPO, dataDir });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const body = await (await fetch(`${base}/api/lanes`)).json();
const p = body.lanes;
const raw = JSON.stringify(body);
console.log('A: /api/lanes reason =', p.snapshot.reason, 'stale =', p.snapshot.stale, 'ageS =', p.snapshot.ageS, 'count =', p.count);
console.log('A: payload contains "/Users/":', raw.includes('/Users/'));
for (const lane of p.lanes) {
  const c = describeLane(lane, Date.now());
  console.log(`A: lane key=${lane.key} joinedBy=${lane.joinedBy} task=${lane.task?.shortId} status=${lane.task?.status} assignee=${lane.employee.assignee} author=${lane.employee.lastCommitAuthor} agree=${lane.employee.agree}`);
  console.log(`   worktree=${c.worktree} branch=${c.branch} commits="${c.ahead}" dirty="${c.dirty}" last="${c.lastCommit}" stale="${c.staleText}" errors="${c.errorsText}"`);
}
const view = describeLanes(p, Date.now());
console.log('A: badge =', JSON.stringify(view.badge), 'caption =', JSON.stringify(view.caption), 'emptyText =', JSON.stringify(view.emptyText));

// Stale caption at ~60 s without killing anything: age the snapshot's generatedAt
// by 61 s on disk (this is MY temp file), re-fetch, and check the count survives.
const aged = { ...snap, generatedAt: new Date(Date.now() - 61_000).toISOString() };
writeFileSync(statePath, JSON.stringify(aged));
const body2 = await (await fetch(`${base}/api/lanes`)).json();
const v2 = describeLanes(body2.lanes, Date.now());
console.log('A-stale: reason =', body2.lanes.snapshot.reason, 'count =', body2.lanes.count, 'badge =', JSON.stringify(v2.badge), 'caption =', JSON.stringify(v2.caption));
// Remove the file: badge must go to a dash.
rmSync(statePath);
const body3 = await (await fetch(`${base}/api/lanes`)).json();
const v3 = describeLanes(body3.lanes, Date.now());
console.log('A-missing: reason =', body3.lanes.snapshot.reason, 'lanes =', body3.lanes.lanes, 'badge =', JSON.stringify(v3.badge), 'emptyText =', JSON.stringify(v3.emptyText));
await close();

// ---------------- Probe B ----------------
const scratch = mkdtempSync(join(tmpdir(), 'as99-scratchrepo-'));
const root = join(scratch, 'repo');
mkdirSync(root);
sh('git', ['init', '-q', '-b', 'master'], root);
sh('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@x', 'commit', '-q', '--allow-empty', '-m', 'init'], root);
mkdirSync(join(root, '.worktrees'));
sh('git', ['worktree', 'add', '-q', '-b', 'feat/AS-999-inside', join(root, '.worktrees', 'AS-999')], root);
const outside = join(scratch, 'throwaway-wt');
sh('git', ['worktree', 'add', '-q', '--detach', outside], root);
const broken = join(root, '.worktrees', 'broken');
sh('git', ['worktree', 'add', '-q', '--detach', broken], root);
// Break it: remove the admin dir git keeps for that worktree, so its .git file dangles.
rmSync(join(root, '.git', 'worktrees', 'broken'), { recursive: true, force: true });
console.log('B: worktree list --porcelain:\n' + spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout);

const statePathB = join(scratch, 'worktrees.json');
const opsB = makeLanesOps({ repoRoot: root, statePath: statePathB, log: (l) => console.log('[watcher]', l) });
await opsB.evaluate();
const rawB = readFileSync(statePathB, 'utf8');
const snapB = JSON.parse(rawB);
console.log('B: error =', snapB.error);
for (const w of snapB.worktrees) console.log('B: row', JSON.stringify({ relPath: w.relPath, main: w.main, branch: w.branch, detached: w.detached, ahead: w.ahead, dirtyCount: w.dirtyCount, merged: w.merged, errors: w.errors }));
console.log('B: snapshot contains scratch dir path:', rawB.includes(scratch), '| contains "/private/" or "/var/" or "/tmp/":', /\/(private|var|tmp)\//.test(rawB));
// Compose through the real composer with no tasks to see lane.key for the outside row.
const { composeLanes } = await import(`${BR}/lib/lanes.js`);
const proj = composeLanes({ snapshot: snapB, tasks: [], ids: {}, nowMs: Date.now() });
for (const lane of proj.lanes) console.log('B: lane key =', JSON.stringify(lane.key), 'relPath =', JSON.stringify(lane.worktree.relPath), 'errors =', JSON.stringify(lane.worktree.errors));
console.log('B: projection contains scratch dir path:', JSON.stringify(proj).includes(scratch));

// Two outside worktrees with the SAME basename: do their lane keys collide?
const outside2 = join(scratch, 'other', 'throwaway-wt');
mkdirSync(join(scratch, 'other'));
sh('git', ['worktree', 'add', '-q', '--detach', outside2], root);
await opsB.evaluate();
const projC = composeLanes({ snapshot: JSON.parse(readFileSync(statePathB, 'utf8')), tasks: [], ids: {}, nowMs: Date.now() });
const keys = projC.lanes.map((l) => l.key);
console.log('C: lane keys =', JSON.stringify(keys), '| distinct =', new Set(keys).size, 'of', keys.length);

// cleanup
sh('git', ['worktree', 'prune'], root);
rmSync(scratch, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });
console.log('cleanup done');
