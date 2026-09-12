// Diagnose inode stability across a rename on the given directory.
import { writeFileSync, renameSync, statSync, openSync, fstatSync, closeSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
const p = join(dir, 'f.jsonl');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
writeFileSync(p, 'a\n');
const seq = [];
const snap = (label) => {
  const s = statSync(p);
  const fd = openSync(p, 'r'); const f = fstatSync(fd); closeSync(fd);
  seq.push({ label, statIno: s.ino, fstatIno: f.ino, size: s.size });
};
snap('t0'); await sleep(30); snap('t0+30');
writeFileSync(`${p}.next`, 'a\nb\n');
renameSync(`${p}.next`, p);
for (let i = 0; i < 6; i++) { snap(`after-rename+${i * 30}ms`); await sleep(30); }
// second rename
writeFileSync(`${p}.next`, 'a\nb\nc\n');
renameSync(`${p}.next`, p);
for (let i = 0; i < 4; i++) { snap(`after-rename2+${i * 30}ms`); await sleep(30); }
console.log(JSON.stringify(seq, null, 1));
rmSync(dir, { recursive: true, force: true });
