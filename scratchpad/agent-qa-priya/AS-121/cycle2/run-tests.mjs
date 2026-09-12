// node run-tests.mjs <apps-chat-dir> <out-file> [all|compose] [real]
// all: node --test (whole host suite); compose: test/compose-run.test.js only. real: AS106_REAL=1
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [dir, out, which = 'all', real] = process.argv.slice(2);
const env = { ...process.env, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' };
if (real === 'real') env.AS106_REAL = '1';
const args = which === 'compose' ? ['--test', 'test/compose-run.test.js'] : ['--test'];
const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const text = `${r.stdout}\n--- stderr ---\n${r.stderr}\nexit=${r.status}\n`;
writeFileSync(out, text);
for (const l of text.split('\n')) if (/^(✖|﹣|ℹ (tests|pass|fail|skipped))|^not ok|T1[123]/.test(l)) console.log(l);
console.log(`exit=${r.status}`);
