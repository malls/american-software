// AS-124 N1 probe (cto-owen): is the transient inode after a rename on the
// Docker Desktop bind mount count-based (one stat) or time-based?
import { writeFileSync, renameSync, statSync } from 'node:fs';
const dir = process.argv[2];
const path = `${dir}/company.jsonl`;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function run(label, delaysMs) {
  writeFileSync(path, 'a\n'.repeat(10));
  const i0 = statSync(path).ino;
  writeFileSync(`${path}.next`, 'b\n'.repeat(12));
  renameSync(`${path}.next`, path);
  const t0 = process.hrtime.bigint();
  const seen = [];
  for (const d of delaysMs) {
    if (d) sleep(d);
    const s = statSync(path);
    seen.push([(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1), s.ino, s.size]);
  }
  console.log(label, 'ino before', i0, JSON.stringify(seen));
}
run('tight x8', [0, 0, 0, 0, 0, 0, 0, 0]);
run('sleep100 then x4', [100, 0, 0, 0]);
run('sleep1000 then x4', [1000, 0, 0, 0]);
run('sleep2000 then x4', [2000, 0, 0, 0]);
run('50ms apart x6', [50, 50, 50, 50, 50, 50]);
