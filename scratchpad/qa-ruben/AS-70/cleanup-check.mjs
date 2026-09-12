import { spawnSync } from 'node:child_process';
import { rmSync, readdirSync } from 'node:fs';
const D = '/usr/local/bin/docker';
const q = (args) => (spawnSync(D, args, { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean);
const mine = (l) => /asc-rev-as70/.test(l);
console.log('containers:', q(['ps', '-a', '--format', '{{.Names}}']).filter(mine));
console.log('images:', q(['images', '--format', '{{.Repository}}:{{.Tag}}']).filter(mine));
console.log('volumes:', q(['volume', 'ls', '--format', '{{.Name}}']).filter(mine));
console.log('networks:', q(['network', 'ls', '--format', '{{.Name}}']).filter(mine));
console.log('shared untouched:', q(['ps', '--format', '{{.Names}}']).filter((n) => /asc-invoicing-web-1|asc-chat-server-1/.test(n)));
// Remove the extract copies (logs and .diff files stay as the record).
const R = '/Users/forrest/Code/american-software-company/scratchpad/qa-ruben/AS-70/mut';
for (const e of readdirSync(R, { withFileTypes: true })) if (e.isDirectory()) rmSync(`${R}/${e.name}`, { recursive: true, force: true });
console.log('mut/ now holds:', readdirSync(R).join(' '));
