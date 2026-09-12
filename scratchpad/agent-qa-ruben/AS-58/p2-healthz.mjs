// P2 — what GET /healthz actually puts on the wire, verbatim, in the 200 case
// and in every 503 case an unauthenticated stranger can reach, plus the methods
// and the auth boundary.
import { rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configFor, withServer } from './test/helpers/server.js';
import { SCHEMA } from './lib/config.js';

const SETTING_NAMES = SCHEMA.map((r) => r.key);
const ENV_NAMES = SCHEMA.map((r) => r.envVar);

async function shot(label, config, beforeFetch) {
  await withServer(config, async (base) => {
    if (beforeFetch) beforeFetch(config);
    const res = await fetch(`${base}/healthz`);
    const text = await res.text();
    console.log(`\n### ${label}`);
    console.log(`status=${res.status} content-type=${res.headers.get('content-type')}`);
    console.log(`keys=${JSON.stringify(Object.keys(JSON.parse(text)))}`);
    console.log(`BODY: ${text}`);
    const names = SETTING_NAMES.filter((k) => text.includes(k));
    const envs = ENV_NAMES.filter((k) => text.includes(k));
    const values = SETTING_NAMES.filter((k) => config[k] !== null && typeof config[k] === 'string' && config[k].length > 3 && text.includes(String(config[k])));
    console.log(`setting NAMES present: ${JSON.stringify(names)}`);
    console.log(`env-var NAMES present: ${JSON.stringify(envs)}`);
    console.log(`setting VALUES present: ${JSON.stringify(values.map((k) => [k, config[k]]))}`);
  });
}

await shot('200, real container paths (the shipped image)', configFor());
await shot('503 vendor_assets — the AS-17 deploy failure', configFor({ vendorDir: '/nonexistent/vendor' }));
await shot('503 views — views/ not COPYd', configFor({ viewsDir: '/nonexistent/views' }));

const badViews = await mkdtemp(join(tmpdir(), 'ruben-views-'));
await writeFile(join(badViews, 'signin.ejs'), '<% this is not valid ejs %>');
await shot('503 views — a template that cannot render', configFor({ viewsDir: badViews }));

const dbCfg = configFor();
await shot('503 database — the file deleted under a running server', dbCfg, (c) => rmSync(c.dbPath, { force: true }));

// Methods and the auth boundary, unauthenticated.
await withServer(configFor(), async (base) => {
  console.log('\n### method surface, no cookie');
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const res = await fetch(`${base}/healthz`, { method, redirect: 'manual' });
    const body = method === 'HEAD' ? '' : (await res.text()).slice(0, 120);
    console.log(`${method} /healthz -> ${res.status} loc=${res.headers.get('location')} body=${JSON.stringify(body)}`);
  }
  const q = await fetch(`${base}/healthz?config=1&verbose=1`);
  console.log(`GET /healthz?config=1&verbose=1 -> ${q.status} ${JSON.stringify((await q.text()).slice(0, 200))}`);
});
