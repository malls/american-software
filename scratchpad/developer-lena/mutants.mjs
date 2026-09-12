// AS-94 §5 mutation runner. Operates ONLY on the detached scratch worktree $S.
// For each mutant: apply, assert applied, run the guard, record the failing set, restore.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const S = process.argv[2];
const TPL = path.join(S, 'apps/chat/watch/com.american-software.lattice-dashboard.plist.template');
const RDM = path.join(S, 'apps/chat/watch/README.md');
const TEST = 'test/launchd-plist.test.js';

const T = {
  T1: 'every plist template under watch/ renders clean',
  T2: 'binds loopback :8799 from the repo root',
  T3: 'README install recipe substitutes',
  T4: 'plist reader throws on forms',
};

function runGuard() {
  let out;
  try {
    out = execFileSync('node', ['--test', TEST], { cwd: path.join(S, 'apps/chat'), encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  const failing = [];
  for (const [id, frag] of Object.entries(T)) {
    if (new RegExp('✖ launchd: AS-94 — [^\\n]*' + frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(out)) failing.push(id);
  }
  const tests = (out.match(/ℹ tests (\d+)/) || [])[1];
  const fail = (out.match(/ℹ fail (\d+)/) || [])[1];
  return { failing: failing.sort(), tests, fail };
}

function restore() {
  execFileSync('git', ['-C', S, 'checkout', '--', '.']);
  execFileSync('git', ['-C', S, 'clean', '-fd']);
}

const mutants = [
  ['M-AC1 (delete </array>)', () => {
    const t = fs.readFileSync(TPL, 'utf8');
    const before = (t.match(/<\/array>/g) || []).length;
    const m = t.replace('    <string>8799</string>\n  </array>', '    <string>8799</string>\n  <!-- MUTANT-AC1 -->');
    fs.writeFileSync(TPL, m);
    const after = (fs.readFileSync(TPL, 'utf8').match(/<\/array>/g) || []).length;
    return `</array> ${before}->${after}, marker ${/MUTANT-AC1/.test(fs.readFileSync(TPL, 'utf8')) ? 1 : 0}`;
  }],
  ['M-AC2a (0.0.0.0)', () => {
    const t = fs.readFileSync(TPL, 'utf8').replace('<string>127.0.0.1</string>', '<string>0.0.0.0</string>');
    fs.writeFileSync(TPL, t);
    return `0.0.0.0 count 0->${(t.match(/0\.0\.0\.0/g) || []).length}`;
  }],
  ['M-AC2b (port 8800)', () => {
    const t = fs.readFileSync(TPL, 'utf8').replace('<string>8799</string>', '<string>8800</string>');
    fs.writeFileSync(TPL, t);
    return `8799 count 1->${(t.match(/>8799</g) || []).length}, 8800 count ${(t.match(/8800/g) || []).length}`;
  }],
  ['M-AC2c (WorkingDirectory)', () => {
    const t = fs.readFileSync(TPL, 'utf8').replace('  <key>WorkingDirectory</key>\n  <string>__REPO_ROOT__</string>', '  <key>WorkingDirectory</key>\n  <string>__REPO_ROOT__/apps/chat</string>');
    fs.writeFileSync(TPL, t);
    return `__REPO_ROOT__/apps/chat count 0->${(t.match(/__REPO_ROOT__\/apps\/chat</g) || []).length}`;
  }],
  ['M-AC2d (ADVANCE_REPO_ROOT env leak)', () => {
    const t = fs.readFileSync(TPL, 'utf8').replace('    <string>__PATH__</string>\n  </dict>', '    <string>__PATH__</string>\n    <key>ADVANCE_REPO_ROOT</key>\n    <string>__REPO_ROOT__</string>\n  </dict>');
    fs.writeFileSync(TPL, t);
    return `ADVANCE_REPO_ROOT count 0->${(t.match(/ADVANCE_REPO_ROOT/g) || []).length}`;
  }],
  ['M-KEEPALIVE (<false/>)', () => {
    const t = fs.readFileSync(TPL, 'utf8').replace('<key>KeepAlive</key>\n  <true/>', '<key>KeepAlive</key>\n  <false/>');
    fs.writeFileSync(TPL, t);
    return `<false/> count 0->${(t.match(/<false\/>/g) || []).length}`;
  }],
  ['M-LEFTOVER (__EXTRA__ arg)', () => {
    const t = fs.readFileSync(TPL, 'utf8').replace('    <string>8799</string>\n', '    <string>8799</string>\n    <string>__EXTRA__</string>\n');
    fs.writeFileSync(TPL, t);
    return `__EXTRA__ count 0->${(t.match(/__EXTRA__/g) || []).length}`;
  }],
  ['M-RECIPE (dashboard sed key renamed)', () => {
    const r = fs.readFileSync(RDM, 'utf8');
    const i = r.indexOf('LABEL=com.american-software.lattice-dashboard');
    const head = r.slice(0, i);
    const tail = r.slice(i).replace('s|__LATTICE_BIN__|', 's|__LATTICE__|');
    fs.writeFileSync(RDM, head + tail);
    return `__LATTICE__| count 0->${((head + tail).match(/s\|__LATTICE__\|/g) || []).length}`;
  }],
  ['M-ENUM (drop com.american-software. from filename)', () => {
    execFileSync('git', ['-C', S, 'mv', 'apps/chat/watch/com.american-software.lattice-dashboard.plist.template', 'apps/chat/watch/lattice-dashboard.plist.template']);
    const files = fs.readdirSync(path.join(S, 'apps/chat/watch')).filter((f) => f.endsWith('.template'));
    return `watch templates now: ${files.join(', ')}`;
  }],
];

restore();
const base = runGuard();
console.log(`BASELINE (scratch, unmutated): tests=${base.tests} fail=${base.fail} failing=[${base.failing.join(',')}]`);
for (const [name, apply] of mutants) {
  const applied = apply();
  const r = runGuard();
  console.log(`${name} | applied: ${applied} | tests=${r.tests} fail=${r.fail} | RED=[${r.failing.join(',')}]`);
  restore();
}
const after = runGuard();
console.log(`RESTORED: tests=${after.tests} fail=${after.fail} failing=[${after.failing.join(',')}]`);
console.log('git status of scratch:', execFileSync('git', ['-C', S, 'status', '--porcelain'], { encoding: 'utf8' }).trim() || '(clean)');
