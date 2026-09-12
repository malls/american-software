// AS-98 planning spike (cto-owen): does the candidate guard stay green on
// master's public/ and go red on each evasion spelling? Throwaway.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PUB = '/Users/forrest/Code/american-software-company/apps/chat/public';
const files = readdirSync(PUB).filter((f) => f.endsWith('.js'));

// --- candidate guard, exactly as the plan will specify it ------------------
const HREF_ASSIGN = /\.href\s*(\+?=)(?!=)\s*([^;\n]*)/g;
const ALLOWED_RHS = [
  /^dashHref\(/,          // the AS-93 helper — the only dashboard-link source
  /^tok\.href\b/,         // autolinked URL / markdown link: verbatim tokenizer slice
  /^`\?m=/,               // msgRefLink placeholder (AS-26)
  /^serializeChatUrl\(/,  // permalink (AS-26 §1)
];
const MECHANISM_BANS = [
  [/setAttribute\(\s*['"]href['"]/, "setAttribute('href', …)"],
  [/Object\.assign\(/, 'Object.assign(…)'],
  [/\[\s*['"]href['"]\s*\]/, "['href'] bracket access"],
];
const URL_READ_BANS = [
  [/(?<!import\.meta)\.url\b/, '.url member read'],
  [/\[\s*['"]url['"]\s*\]/, "['url'] bracket read"],
];
const LITERALS = ['8799', '8443', '127.0.0.1', 'localhost', '.ts.net', '::1'];

function check(name, body, { isHelper = false } = {}) {
  const findings = [];
  let n = 0;
  for (const m of body.matchAll(HREF_ASSIGN)) {
    n++;
    const [, op, rhs] = m;
    if (op !== '=') findings.push(`${name}: href ${op} (compound assignment)`);
    else if (!ALLOWED_RHS.some((re) => re.test(rhs.trim()))) findings.push(`${name}: href RHS not allowlisted: ${rhs.trim()}`);
  }
  for (const [re, what] of MECHANISM_BANS) if (re.test(body)) findings.push(`${name}: ${what}`);
  for (const [re, what] of URL_READ_BANS) if (re.test(body)) findings.push(`${name}: ${what}`);
  if (!isHelper) for (const lit of LITERALS) if (body.includes(lit)) findings.push(`${name}: literal ${lit}`);
  return { n, findings };
}

let total = 0;
const all = [];
for (const f of files) {
  const { n, findings } = check(f, readFileSync(resolve(PUB, f), 'utf8'), { isHelper: f === 'dashboard-link.js' });
  total += n;
  all.push(...findings);
}
console.log(`master: ${files.length} public/*.js files, ${total} href assignments, ${all.length} findings`);
for (const f of all) console.log('  ' + f);

// --- evasions: each appended to app.js in memory --------------------------
const app = readFileSync(resolve(PUB, 'app.js'), 'utf8');
const evasions = {
  'M-M6 no-space .url': "const shadow = el('a'); shadow.href=task.url;",
  'setAttribute href': "shadow.setAttribute('href', task.url);",
  'Object.assign href': 'Object.assign(shadow, { href: task.url });',
  'computed localhost literal': "shadow.href = 'http://localhost:' + (8000 + 799);",
  'bare tailnet literal': "shadow.href = 'https://forrests-newer-macbook.tail3f3c29.ts.net/';",
  'indirection': 'const u = task.url; shadow.href = u;',
  'bracket url': "shadow.href = task['url'];",
  'destructured url': 'const { url } = task; shadow.href = url;',
  'fragment host': "shadow.href = 'http://' + '127.0.0' + '.1:87' + '99/#/task/' + task.taskId;",
  'bracket href': "shadow['href'] = task.taskId;",
  'compound': "shadow.href += '/x';",
  'AS-115 span (must stay GREEN)': "const c = el('span', 'copyable', tok.text); c.setAttribute('role', 'button'); c.tabIndex = 0;",
  'AS-115 as anchor (must go RED)': "const c = el('a', 'copyable', tok.text); c.href = '#';",
};
for (const [name, code] of Object.entries(evasions)) {
  const { n, findings } = check('app.js', app + '\n' + code + '\n');
  console.log(`${findings.length ? 'RED  ' : 'GREEN'} ${name} — ${n} assignments; ${findings.join(' / ') || 'no findings'}`);
}
