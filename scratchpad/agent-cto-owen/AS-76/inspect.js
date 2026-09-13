// AS-76: inspect cached manifests for the load-time behaviour claim and for
// optional/peer deps the closure walk did not count.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const CACHE = '/Users/forrest/.npm/_cacache';
function entries() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const i = line.indexOf('\t'); if (i < 0) continue;
        try { const j = JSON.parse(line.slice(i + 1)); if (j.key && j.integrity) out.push(j); } catch (_) {}
      }
    }
  })(path.join(CACHE, 'index-v5'));
  return out;
}
function cp(integrity) {
  const [a, b] = integrity.split('-');
  const h = Buffer.from(b, 'base64').toString('hex');
  return path.join(CACHE, 'content-v2', a, h.slice(0, 2), h.slice(2, 4), h.slice(4));
}
function tarFind(buf, suffix) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) { off += 512; continue; }
    const size = parseInt(buf.toString('utf8', off + 124, off + 136).replace(/\0.*$/, '').trim(), 8) || 0;
    const body = off + 512;
    if (name.endsWith(suffix)) return buf.slice(body, body + size);
    off = body + Math.ceil(size / 512) * 512;
  }
  return null;
}
const want = new Set(['@sentry/node', '@sentry/node-core', 'posthog-node', '@posthog/core',
  'import-in-the-middle', 'require-in-the-middle', '@opentelemetry/instrumentation',
  '@apm-js-collab/code-transformer', '@apm-js-collab/tracing-hooks']);
for (const e of entries()) {
  if (!/\.tgz$/.test(e.key)) continue;
  const p = cp(e.integrity); if (!fs.existsSync(p)) continue;
  let pkg; try { pkg = JSON.parse(tarFind(zlib.gunzipSync(fs.readFileSync(p)), 'package/package.json').toString('utf8')); } catch (_) { continue; }
  if (!want.has(pkg.name)) continue;
  console.log('---', pkg.name + '@' + pkg.version, '|', pkg.license);
  console.log('  desc:', (pkg.description || '').slice(0, 150));
  console.log('  deps:', Object.keys(pkg.dependencies || {}).join(' ') || '(none)');
  console.log('  optional:', Object.keys(pkg.optionalDependencies || {}).join(' ') || '(none)');
  console.log('  peer:', Object.keys(pkg.peerDependencies || {}).join(' ') || '(none)');
  if (pkg.scripts && (pkg.scripts.install || pkg.scripts.postinstall || pkg.scripts.preinstall)) {
    console.log('  INSTALL SCRIPTS:', JSON.stringify(pkg.scripts));
  }
  console.log('  engines:', JSON.stringify(pkg.engines || {}));
}
