// AS-124 N1 probe 2 (cto-owen): does an open+read of the old file before the
// rename (what the tail does every poll) change what stat reports after it?
// Modes: 'inside' — rename in this process after open/read/close;
//        'watch'  — poll stat for N ms while ANOTHER process (the host) renames.
import { writeFileSync, renameSync, statSync, openSync, readSync, closeSync } from 'node:fs';
const [dir, mode = 'inside', watchMs = '4000'] = process.argv.slice(2);
const path = `${dir}/company.jsonl`;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function readAll() {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(4096);
  const n = readSync(fd, buf, 0, 4096, 0);
  closeSync(fd);
  return n;
}
if (mode === 'inside') {
  for (const variant of ['stat-only', 'open-read-then-rename', 'open-read-stat-then-rename']) {
    writeFileSync(path, 'a\n'.repeat(10));
    const i0 = statSync(path).ino;
    if (variant !== 'stat-only') readAll();
    if (variant === 'open-read-stat-then-rename') statSync(path);
    writeFileSync(`${path}.next`, 'b\n'.repeat(12));
    renameSync(`${path}.next`, path);
    const seen = [];
    for (const d of [0, 0, 0, 100, 500, 1000]) {
      if (d) sleep(d);
      const s = statSync(path);
      seen.push([s.ino, s.size]);
    }
    console.log(variant, 'before', i0, JSON.stringify(seen));
  }
} else {
  // watch: stat + read every 50 ms, print every change of ino
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < Number(watchMs)) {
    let s;
    try { s = statSync(path); } catch (e) { s = { ino: 'ENOENT', size: -1 }; }
    let n = -1;
    try { n = readAll(); } catch {}
    if (!last || last.ino !== s.ino) {
      console.log(`+${Date.now() - t0}ms ino ${s.ino} size ${s.size} read ${n}`);
      last = s;
    }
    sleep(50);
  }
}
