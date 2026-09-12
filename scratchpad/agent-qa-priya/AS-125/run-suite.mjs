// run-suite.mjs — host `node --test` with an explicit cwd, summary + failing-test names.
//   node run-suite.mjs <cwd> <label> [--file <glob-or-file>]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [cwd, label, ...rest] = process.argv.slice(2);
const args = ['--test'];
const fi = rest.indexOf('--file');
if (fi !== -1) args.push(rest[fi + 1]);
const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(join(HERE, `${label}.log`), out);
const summary = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l)).map((l) => l.replace('ℹ ', '')).join(' ');
const failing = out.split('\n').filter((l) => /^not ok /.test(l)).map((l) => l.replace(/^not ok \d+ - /, '').trim());
// node prints nested "not ok" lines indented; top-level only above. Also collect indented ones for detail.
const failingAll = out.split('\n').filter((l) => /^\s*not ok /.test(l)).map((l) => l.trim().replace(/^not ok \d+ - /, ''));
const firstMsgs = [];
const lines = out.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (/^\s*not ok /.test(lines[i])) {
    const m = lines.slice(i, i + 40).find((l) => /^\s*(error|message):/.test(l));
    if (m) firstMsgs.push(m.trim().slice(0, 400));
  }
}
console.log(`[${label}] exit=${r.status} ${summary}`);
console.log(`[${label}] red set: ${failingAll.length ? JSON.stringify(failingAll) : '{}'}`);
for (const m of firstMsgs) console.log(`[${label}]   ${m}`);
