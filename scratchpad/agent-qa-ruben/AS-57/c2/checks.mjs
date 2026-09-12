// Mechanical floor checks: AC1 COPY count, AC6 no private stripper copies, AC11 line cap,
// AC12 product code untouched / no .lattice on branch, AC13 stale comments, authorship.
import { APP, WT, read, git } from './harness.mjs';
import { join } from 'node:path';
const dp = read(join(APP, 'test/dependency-policy.test.js'));
const ds = read(join(APP, 'test/deploy-shape.test.js'));
const df = read(join(APP, 'Dockerfile'));
const count = (t, re) => (t.match(re) || []).length;
console.log(`AC6 'quote = null' in dependency-policy: ${count(dp, /quote = null/g)}, in deploy-shape: ${count(ds, /quote = null/g)}`);
console.log(`AC6 helper imported: dp=${/from '\.\/helpers\/hash-comment\.js'/.test(dp)} ds=${/from '\.\/helpers\/hash-comment\.js'/.test(ds)}`);
console.log(`AC11 dependency-policy lines: ${dp.split('\n').length - 1}`);
console.log(`AC1 COPY count: ${count(df, /^COPY /gm)}; whole-dir COPY after RUN npm ci: ${df.indexOf('COPY apps/invoicing ./') > df.indexOf('RUN npm ci')}`);
console.log(`AC12 product diff: '${git('diff', '--stat', 'master...HEAD', '--', 'apps/invoicing/app.js', 'apps/invoicing/server.js', 'apps/invoicing/lib', 'apps/invoicing/routes', 'apps/invoicing/views', 'apps/invoicing/public', 'apps/invoicing/package.json')}'`);
console.log(`AC12 .lattice on branch: '${git('diff', '--stat', 'master...HEAD', '--', '.lattice')}'`);
const stale = /both places|bounded by VENDOR_ASSETS|exists only inside the image|exists only on the host/;
console.log(`AC13 stale phrases: dp=${stale.test(dp)} Dockerfile=${stale.test(df)}; Dockerfile still lists per-dir COPYs: ${/^COPY apps\/invoicing\/(lib|routes|views|public|test|demo) /m.test(df)}`);
console.log(`AC11 new *.test.js on branch: '${git('diff', '--name-status', 'master...HEAD').split('\n').filter((l) => /\.test\.js$/.test(l) && !l.startsWith('M')).join(', ')}'`);
console.log(`authors: ${git('log', '--format=%an <%ae>', 'master..HEAD').split('\n').join(' | ')}`);
console.log(`porcelain: '${git('status', '--porcelain')}'`);
