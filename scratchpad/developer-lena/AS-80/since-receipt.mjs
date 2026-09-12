import { spawnSync } from 'node:child_process';
const R = '/Users/forrest/Code/american-software-company';
const d = spawnSync('git', ['-C', R, 'diff', '7f9ac2f..master', '--', 'apps/chat/test'], { encoding: 'utf8', maxBuffer: 64e6 }).stdout;
const add = (d.match(/^\+ *test\(/gm) || []).length;
const del = (d.match(/^- *test\(/gm) || []).length;
console.log('test( declarations added since 7f9ac2f:', add, ' removed:', del, ' net:', add - del);
