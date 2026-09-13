// AS-76 rule-4 footprint measurement, offline.
// Reads the npm cacache index, extracts package/package.json from every cached
// tarball, and walks the `dependencies` closure from a named root.
// No network. Receipt: scratchpad/agent-cto-owen/AS-76/footprint.txt
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE = '/Users/forrest/.npm/_cacache';

function indexEntries() {
  const root = path.join(CACHE, 'index-v5');
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const i = line.indexOf('\t');
        if (i < 0) continue;
        try { const j = JSON.parse(line.slice(i + 1)); if (j.key && j.integrity) out.push(j); } catch (_) {}
      }
    }
  })(root);
  return out;
}

function contentPath(integrity) {
  const [algo, b64] = integrity.split('-');
  const hex = Buffer.from(b64, 'base64').toString('hex');
  return path.join(CACHE, 'content-v2', algo, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
}

// Minimal ustar reader: returns the first entry whose name ends with the suffix.
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

const manifests = new Map(); // "name@version" -> package.json object
const sizes = new Map();     // "name@version" -> unpacked tarball byte size
for (const e of indexEntries()) {
  if (!/\.tgz$/.test(e.key)) continue;
  const cp = contentPath(e.integrity);
  if (!fs.existsSync(cp)) continue;
  let pkg;
  try {
    pkg = JSON.parse(tarFind(zlib.gunzipSync(fs.readFileSync(cp)), 'package/package.json').toString('utf8'));
  } catch (_) { continue; }
  const id = `${pkg.name}@${pkg.version}`;
  manifests.set(id, pkg);
  sizes.set(id, e.size);
}

const byName = new Map(); // name -> [versions]
for (const id of manifests.keys()) {
  const at = id.lastIndexOf('@');
  const n = id.slice(0, at), v = id.slice(at + 1);
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(v);
}

function resolve(name) {
  const vs = byName.get(name);
  if (!vs) return null;
  return `${name}@${vs.sort().at(-1)}`;
}

function closure(rootName) {
  const root = resolve(rootName);
  if (!root) return { root: rootName, missing: [rootName], set: new Set() };
  const seen = new Set([root]);
  const missing = new Set();
  const queue = [root];
  while (queue.length) {
    const id = queue.shift();
    const pkg = manifests.get(id);
    for (const dep of Object.keys(pkg.dependencies || {})) {
      const r = resolve(dep);
      if (!r) { missing.add(`${dep} (required by ${id})`); continue; }
      if (!seen.has(r)) { seen.add(r); queue.push(r); }
    }
  }
  return { root, set: seen, missing: [...missing] };
}

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

say(`cacache: ${manifests.size} distinct name@version manifests recoverable offline`);
for (const rootName of ['@sentry/node', 'posthog-node']) {
  const { root, set, missing } = closure(rootName);
  const ids = [...set].sort();
  const bytes = ids.reduce((a, id) => a + (sizes.get(id) || 0), 0);
  say('');
  say(`=== ${root} ===`);
  say(`closure size (distinct name@version, incl. root): ${ids.length}`);
  say(`transitive (excl. root): ${ids.length - 1}`);
  say(`packed tarball bytes (sum): ${bytes} (${(bytes / 1048576).toFixed(2)} MB packed)`);
  say(`unresolved deps in cache: ${missing.length ? missing.join(', ') : 'none'}`);
  say('licences:');
  const lic = {};
  for (const id of ids) {
    const l = manifests.get(id).license || manifests.get(id).licenses || 'UNSTATED';
    const k = typeof l === 'string' ? l : JSON.stringify(l);
    lic[k] = (lic[k] || 0) + 1;
  }
  for (const [k, v] of Object.entries(lic).sort((a, b) => b[1] - a[1])) say(`  ${v.toString().padStart(3)}  ${k}`);
  say('members:');
  for (const id of ids) say(`  ${id}`);
}

// Union, as both would be adopted together.
const a = closure('@sentry/node').set, b = closure('posthog-node').set;
const union = new Set([...a, ...b]);
say('');
say('=== union (@sentry/node + posthog-node) ===');
say(`distinct name@version: ${union.size}`);
say(`overlap between the two SDK trees: ${a.size + b.size - union.size}`);

// --- overlap with the app as it stands, from the committed lockfile ----------
// This half is the cross-check on the method: if walking cached manifests is
// sound, re-deriving the app's OWN footprint the same way must reproduce the
// figure already recorded in docs/engineering/01-stack-decision.md §13
// amendment 8 (2 direct, 67 distinct, 69 instances, 61 MIT / 4 ISC /
// 1 Apache-2.0 / 1 BSD-3-Clause).
const LOCK = '/Users/forrest/Code/american-software-company/apps/invoicing/package-lock.json';
const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
// A name can appear at several versions and a name@version at several paths, so
// keep all three cardinalities apart — collapsing them by name loses one
// distinct name@version (content-type is present at 1.0.5 AND 2.1.0) and would
// silently disagree with the recorded figure.
const versionsOf = new Map(); // name -> Set(version)
const appInstances = [];      // one "name@version" per path
const appLicences = {};
for (const key of Object.keys(lock.packages || {})) {
  if (!key.startsWith('node_modules/')) continue;
  const name = key.split('node_modules/').pop();
  const entry = lock.packages[key];
  appInstances.push(`${name}@${entry.version}`);
  if (!versionsOf.has(name)) versionsOf.set(name, new Set());
  versionsOf.get(name).add(entry.version);
  const l = entry.license || 'UNSTATED';
  appLicences[l] = (appLicences[l] || 0) + 1;
}
const distinctToday = new Set(appInstances).size;
say('');
say('=== apps/invoicing today, re-derived from package-lock.json ===');
say(`instances on disk: ${appInstances.length}`);
say(`distinct name@version: ${distinctToday}`);
say(`distinct names: ${versionsOf.size}`);
say(`licences (instance-level): ${JSON.stringify(appLicences)}`);
say('(expected, per 01-stack-decision.md §13 amendment 8: 69 instances, 67 distinct,');
say(' 63 MIT / 4 ISC / 1 Apache-2.0 / 1 BSD-3-Clause instance-level)');

let sameName = 0, sameNV = 0;
const clashes = [];
for (const id of union) {
  const at = id.lastIndexOf('@');
  const n = id.slice(0, at), v = id.slice(at + 1);
  const have = versionsOf.get(n);
  if (!have) continue;
  sameName += 1;
  if (have.has(v)) sameNV += 1;
  else clashes.push(`${n}: app has ${[...have].join('/')}, SDK tree wants ${v}`);
}
say('');
say('=== adopting both SDKs ===');
say(`SDK-tree packages: ${union.size}`);
say(`name already present in the app tree: ${sameName} | identical name@version: ${sameNV}`);
say(`version clashes (a second instance on disk): ${clashes.length ? clashes.join('; ') : 'none'}`);
say(`distinct name@version after adoption: ${distinctToday} -> ${distinctToday + union.size - sameNV}`);
say(`net new: +${union.size - sameNV} (+${Math.round(((union.size - sameNV) / distinctToday) * 100)}%)`);

fs.writeFileSync(path.join(__dirname, 'footprint.txt'), lines.join('\n') + '\n');
