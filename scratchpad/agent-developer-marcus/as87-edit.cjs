const fs = require('fs');
const root = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/';
const p = root + 'apps/chat/watch/advance-watcher.mjs';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b) => {
  if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60));
  if (s.split(a).length !== 2) throw new Error('not unique: ' + a.slice(0, 60));
  s = s.replace(a, b);
};
rep(" * over 8 of 9 inputs would be perfectly stable", " * over 9 of 10 inputs would be perfectly stable");
rep("['compose', '--progress', 'quiet', 'up', '-d', '--build']", "['compose', '--progress', 'plain', 'up', '-d', '--build']");
rep("  let deploying = false;\n",
  "  let deploying = false;\n" +
  "  // AS-87 (Ruben's AS-75 F3): the state fields of the deploy in flight, so the\n" +
  "  // heartbeat below re-persists the same desired/running ids the pre-build write\n" +
  "  // carried — not persist()'s `no-git` defaults. Set by performDeploy, cleared in\n" +
  "  // its finally.\n" +
  "  let inflight = null;\n");
rep("    deploying = true;\n    abortSignal = null;\n", "    deploying = true;\n    inflight = stateFields;\n    abortSignal = null;\n");
rep("      lock.releaseLock();\n      deploying = false;\n      deployChild = null;\n",
  "      lock.releaseLock();\n      deploying = false;\n      inflight = null;\n      deployChild = null;\n");
rep("    if (deploying) return { action: 'noop', reason: 'busy' };\n    const nowMs = now();",
  "    if (deploying) {\n" +
  "      // AS-87 (Ruben's AS-75 F3): heartbeat. Before this, nothing rewrote\n" +
  "      // deploy-state.json for the length of a build, so computedAt froze at\n" +
  "      // the last pre-build poll and a build longer than DEPLOY_STATE_STALE_MS\n" +
  "      // (10 min, under the 15 min deploy timeout) flipped the sidebar to \"the\n" +
  "      // watcher crashed\" while it was alive and mid-build. Only the PERSISTED\n" +
  "      // reason is new: the returned decision stays 'busy', which is what\n" +
  "      // pendingDeploy() and the loop's yield logic read.\n" +
  "      persist({ ...inflight, reason: 'deploying' });\n" +
  "      return { action: 'noop', reason: 'busy' };\n" +
  "    }\n" +
  "    const nowMs = now();");
fs.writeFileSync(p, s);

const q = root + 'apps/chat/public/loop-status.js';
let t = fs.readFileSync(q, 'utf8');
const a = "  busy: 'a tick is running, so the watcher is holding the rebuild until it finishes',\n";
if (!t.includes(a)) throw new Error('loop-status anchor');
t = t.replace(a, a +
  "  // AS-87: persisted on every deploy poll while a build is in flight, so a\n" +
  "  // long build never reads as a crashed watcher.\n" +
  "  deploying: 'the watcher is rebuilding it now — see apps/chat/data/logs/deploy-*.log',\n");
fs.writeFileSync(q, t);

const r = root + 'apps/chat/watch/README.md';
let u = fs.readFileSync(r, 'utf8');
const b = "| `error` | AS-84: the poll itself threw";
if (!u.includes(b)) throw new Error('readme anchor');
u = u.replace(b,
  "| `deploying` | AS-87: a rebuild is in flight. Every deploy poll during the build re-writes the file with a fresh `computedAt` (a heartbeat), so a build longer than the server's 10-minute stale threshold no longer reads as a crashed watcher; `lastAttempt.outcome` stays `started` until the build settles. The build's output is in `logs/deploy-<ts>.log` |\n" + b);
fs.writeFileSync(r, u);
console.log('ok');
