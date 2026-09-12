// Scratch, never committed. Headless Chrome on macOS clamps --window-size to a
// 500px minimum width (observed: innerWidth=500 with --window-size=375,812),
// so each captured state page is loaded inside a 375px-wide <iframe> in a
// host document. The iframe is a real CSS viewport (media queries, layout,
// window.innerWidth all evaluate at 375); the page's measuring script posts
// its results to the host, which writes them into a <pre> that --dump-dom
// returns. A screenshot of the host page shows the iframe at 375px.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-46/states';
const SHOTS = `${DIR}/shots`;
const WIDTH = Number(process.argv[2] || 375);
mkdirSync(SHOTS, { recursive: true });

const PAGE_SCRIPT = `<script>
(function () {
  const w = window.innerWidth;
  const out = { innerWidth: w, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
    docHeight: document.documentElement.scrollHeight, overflowing: [], rows: [], selects: [], buttons: [] };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > w + 0.5 || r.left < -0.5) out.overflowing.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '') + ' left=' + r.left.toFixed(1) + ' right=' + r.right.toFixed(1));
  }
  for (const row of document.querySelectorAll('.line-item-row')) {
    out.rows.push([...row.querySelectorAll('.field')].map((f) => { const r = f.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width) }; }));
  }
  for (const s of document.querySelectorAll('select')) { const r = s.getBoundingClientRect(); out.selects.push({ w: Math.round(r.width), right: Math.round(r.right) }); }
  for (const b of document.querySelectorAll('button, a.btn')) { const r = b.getBoundingClientRect(); out.buttons.push({ t: b.textContent.trim().slice(0, 24), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) }); }
  window.parent.postMessage(JSON.stringify(out), '*');
})();
</script>`;

const host = (name, height) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#888}iframe{border:0;display:block;background:#fff}</style></head><body>
<iframe id="f" src="./${name}.measure.html" width="${WIDTH}" height="${height}"></iframe>
<pre id="asc-measure">pending</pre>
<script>window.addEventListener('message', (e) => { document.getElementById('asc-measure').textContent = e.data; });</script>
</body></html>`;

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const results = {};
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.html') && !f.includes('.measure') && !f.includes('.host'))) {
  const name = file.replace(/\.html$/, '');
  writeFileSync(`${DIR}/${name}.measure.html`, readFileSync(`${DIR}/${file}`, 'utf8').replace('</body>', `${PAGE_SCRIPT}\n</body>`));
  writeFileSync(`${DIR}/${name}.host.html`, host(name, 812));
  const dump = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=1024,900', '--virtual-time-budget=3000', '--dump-dom', `file://${DIR}/${name}.host.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const m = (dump.stdout || '').match(/<pre id="asc-measure">([\s\S]*?)<\/pre>/);
  let parsed = { error: 'no measurement' };
  try { parsed = JSON.parse(decode(m[1])); } catch (e) { parsed = { error: String(m ? m[1].slice(0, 200) : dump.stderr.slice(0, 300)) }; }
  results[name] = parsed;
  const height = Math.max(812, Math.min(4000, (parsed.docHeight || 812) + 8));
  writeFileSync(`${DIR}/${name}.host.html`, host(name, height));
  spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', `--window-size=${WIDTH + 40},${height + 8}`, '--virtual-time-budget=3000', `--screenshot=${SHOTS}/${name}-${WIDTH}.png`, `file://${DIR}/${name}.host.html`], { encoding: 'utf8' });
}
writeFileSync(`${DIR}/measure-results-${WIDTH}.json`, JSON.stringify(results, null, 2));
for (const [name, r] of Object.entries(results)) {
  console.log(`${name}: innerWidth=${r.innerWidth} docScrollWidth=${r.docScrollWidth} bodyScrollWidth=${r.bodyScrollWidth} height=${r.docHeight} overflowing=${JSON.stringify(r.overflowing)} rows=${JSON.stringify(r.rows)} selects=${JSON.stringify(r.selects)} buttons=${JSON.stringify(r.buttons)}`);
}
