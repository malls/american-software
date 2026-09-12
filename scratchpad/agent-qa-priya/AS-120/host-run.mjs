// AS-120 review (qa-priya): host node --test over <apps/chat dir>; prints totals, not-ok lines, exit. Full log saved.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
const [dir, label, ...files] = process.argv.slice(2);
const list = files.length ? files : globSync('test/*.test.js', { cwd: dir }).sort();
const r = spawnSync('node', ['--test', '--test-reporter=tap', ...list], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
const log = `/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-120/host-${label}-${Date.now()}.log`;
writeFileSync(log, out);
for (const line of out.split('\n')) if (/^# (tests|pass|fail|skipped|cancelled)|^\s*not ok/.test(line)) console.log(line.trim());
console.log(`${label}: files=${list.length} exit=${r.status} log=${log}`);
