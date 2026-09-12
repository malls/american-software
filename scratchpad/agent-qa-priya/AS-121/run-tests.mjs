// node run-tests.mjs <worktree-apps-chat-dir> <out-file> [real]  — runs test/compose-run.test.js, prints the summary lines
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [dir, out, real] = process.argv.slice(2);
const env = { ...process.env, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker', PATH: `/usr/local/bin:${process.env.PATH}` };
if (real === 'real') env.AS106_REAL = '1';
const r = spawnSync(process.execPath, ['--test', 'test/compose-run.test.js'], { cwd: dir, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const text = `${r.stdout}\n--- stderr ---\n${r.stderr}\nexit=${r.status}\n`;
writeFileSync(out, text);
for (const l of text.split('\n')) if (/^(✔|✖|﹣|ℹ)|not ok|Error|expected|actual/.test(l)) console.log(l);
console.log(`exit=${r.status}`);
