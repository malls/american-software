// AS-130 c2: final hygiene — nothing of mine left on the docker host; scratch merged tree removed.
import { spawnSync } from 'node:child_process';
import { rmSync, readdirSync } from 'node:fs';
const DOCKER = '/usr/local/bin/docker';
const dk = (...a) => spawnSync(DOCKER, a, { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
const mine = (s) => /asc-c2-|asc-capture-c2|asc-capture-merged|asc-review-as130/.test(s);
const containers = dk('ps', '-a', '--format', '{{.Names}}').filter(mine);
const nets = dk('network', 'ls', '--format', '{{.Name}}').filter(mine);
const vols = dk('volume', 'ls', '--format', '{{.Name}}').filter(mine);
const imgs = dk('images', '--format', '{{.Repository}}:{{.Tag}}').filter(mine);
console.log(`mine left — containers ${containers.length} ${JSON.stringify(containers)}; networks ${nets.length} ${JSON.stringify(nets)}; volumes ${vols.length} ${JSON.stringify(vols)}; images ${imgs.length} ${JSON.stringify(imgs)}`);
for (const i of imgs) spawnSync(DOCKER, ['rmi', i]);
const all = dk('ps', '-a', '--format', '{{.Names}}');
console.log(`host containers now: ${all.length} (baseline 19); pre-existing lanes still up: ${['asc-invoicing-stripe-mock-1', 'asc-as47-visual-web-run-ca97b94459d7', 'asc-impl-as69-stripe-mock-1', 'asc-invoicing-web-1', 'asc-chat-server-1'].every((n) => all.includes(n))}`);
console.log(`chrome profiles: ${JSON.stringify(readdirSync('/tmp').filter((f) => f.startsWith('asc-demo-chrome-')))} (baseline ["asc-demo-chrome-i5vyAj"], not mine)`);
rmSync('/tmp/as130-c2-merged', { recursive: true, force: true });
console.log('scratch merged tree /tmp/as130-c2-merged removed');
