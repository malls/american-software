import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const S = '/tmp/AS-126-mutant';
const f = S + '/apps/chat/public/favicon.svg';
writeFileSync(f, readFileSync(f, 'utf8').replace('<circle fill="#FFFFFF" cx="9"', '<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9"'));
const r = spawnSync('node', ['--test', '--test-name-pattern', 'favicon', 'test/api.test.js'], { cwd: S + '/apps/chat', encoding: 'utf8' });
console.log((r.stdout + r.stderr).split('\n').filter(l => /ok|error|message|failureType|tests|pass|fail|✖|✔/.test(l)).slice(0, 40).join('\n'));
spawnSync('git', ['-C', S, 'reset', '--hard', 'HEAD']);
console.log('porcelain:', JSON.stringify(spawnSync('git', ['-C', S, 'status', '--porcelain'], { encoding: 'utf8' }).stdout));
