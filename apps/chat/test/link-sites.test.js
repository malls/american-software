// AS-98: the link-site guard, inverted from a denylist of one spelling into an
// allowlist of every href source in public/*.js.
//
// The English this file enforces, verbatim from the plan (§1) — the algorithm
// is no wider and no narrower than this sentence:
//
//   Every `.href =` assignment in public/*.js has a right-hand side that
//   begins with `dashHref(`, `tok.href`, `` `?m= `` or `serializeChatUrl(`,
//   and there are exactly 9 of them. No file in public/*.js uses
//   `setAttribute('href'`, `Object.assign(`, `['href']`, or `.href +=`. No
//   file in public/*.js reads a `url` property by member (`.url`, other than
//   `import.meta.url`) or bracket (`['url']`) access.
//
// (The literal host/port ban that completes the sentence lives in
// api.test.js T7 — AS-93 AC-9, widened by AS-98 T7b.)
//
// Pure node:fs — no server, no DOM (pattern: test/msg-refs.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const PUBLIC = new URL('../public/', import.meta.url);

/** Every .js file under public/, enumerated — never a hand-kept list. */
function jsFiles() {
  return readdirSync(PUBLIC).filter((f) => f.endsWith('.js'));
}

// `(?!=)` skips `===` comparisons; `[^;\n]*` takes the RHS head, so a
// multi-line RHS (the AS-26 permalink) still yields its first line.
const HREF_ASSIGN = /\.href\s*(\+?=)(?!=)\s*([^;\n]*)/g;

// The app's actual link inventory (plan §0): the ONLY legitimate href sources.
// A fifth entry is a deliberate edit here, with a comment saying why.
const ALLOWED_RHS = [/^dashHref\(/, /^tok\.href\b/, /^`\?m=/, /^serializeChatUrl\(/];

/**
 * Classify every href assignment in one source text.
 * @returns {{count: number, violations: Array<{op: string, rhs: string}>}}
 */
function classifyHrefAssignments(source) {
  let count = 0;
  const violations = [];
  for (const m of source.matchAll(HREF_ASSIGN)) {
    count += 1;
    const op = m[1];
    const rhs = m[2].trim();
    const allowed = op === '=' && ALLOWED_RHS.some((re) => re.test(rhs));
    if (!allowed) violations.push({ op, rhs });
  }
  return { count, violations };
}

const MECHANISMS = [
  ["setAttribute('href'", /setAttribute\(\s*['"]href['"]/],
  ['Object.assign(', /Object\.assign\(/],
  ["['href']", /\[\s*['"]href['"]\s*\]/],
  ['.href +=', /\.href\s*\+=/],
];

test('link-sites: AS-98 — every href in public/*.js comes from an allowlisted source (12 files, 9 assignments examined)', () => {
  const files = jsFiles();
  assert.ok(files.length >= 10, `${files.length} public/*.js files examined`);
  let total = 0;
  const violations = [];
  for (const file of files) {
    const { count, violations: v } = classifyHrefAssignments(readFileSync(new URL(file, PUBLIC), 'utf8'));
    total += count;
    for (const { rhs } of v) violations.push(`${file}: ${rhs}`);
  }
  assert.equal(
    total,
    9,
    `${files.length} files examined: 9 href assignments across public/*.js — a tenth is a deliberate edit here, ` +
      'with its RHS added to ALLOWED_RHS only if it is a new legitimate link source ' +
      `(found ${total})`
  );
  assert.deepEqual(
    violations,
    [],
    `${files.length} files, ${total} href assignments examined: every RHS must begin with dashHref(, tok.href, \`?m= ` +
      `or serializeChatUrl( — violations: ${violations.join('; ')}`
  );
});

test('link-sites: AS-98 — no file in public/*.js sets href by any mechanism other than a .href = assignment', () => {
  const files = jsFiles();
  assert.ok(files.length >= 10, `${files.length} public/*.js files examined`);
  for (const file of files) {
    const body = readFileSync(new URL(file, PUBLIC), 'utf8');
    for (const [name, re] of MECHANISMS) {
      assert.doesNotMatch(body, re, `${files.length} files examined: ${file} must not set href via ${name}`);
    }
  }
});

test('link-sites: AS-98 — no file in public/*.js reads the server-baked url field (member or bracket access)', () => {
  const files = jsFiles();
  assert.ok(files.length >= 10, `${files.length} public/*.js files examined`);
  for (const file of files) {
    const body = readFileSync(new URL(file, PUBLIC), 'utf8');
    const why =
      ' — the url field is the JSON-API contract, never the link the browser renders (AS-93 plan §3); ' +
      'use dashHref(taskId)';
    assert.doesNotMatch(body, /(?<!import\.meta)\.url\b/, `${files.length} files examined: ${file} reads .url${why}`);
    assert.doesNotMatch(body, /\[\s*['"]url['"]\s*\]/, `${files.length} files examined: ${file} reads ['url']${why}`);
  }
});

test('link-sites: AS-98 — the classifier itself rejects every known evasion spelling and accepts every allowed one', () => {
  const rejected = [
    'shadow.href=task.url;', // Ruben's M-M6
    'shadow.href = u;',
    "shadow.href = task['url'];",
    'shadow.href = url;',
    "shadow.href = 'http://localhost:' + (8000 + 799);",
    "shadow.href = 'https://x.tail3f3c29.ts.net/';",
    "shadow.href = 'http://' + '127.0.0' + '.1:8799/';",
    "shadow.href += '/x';",
    "c.href = '#';",
  ];
  assert.equal(rejected.length, 9, '9 rejected inputs examined');
  for (const input of rejected) {
    const { count, violations } = classifyHrefAssignments(input);
    assert.equal(count, 1, `9 rejected inputs examined: ${JSON.stringify(input)} is one assignment`);
    assert.equal(violations.length, 1, `9 rejected inputs examined: ${JSON.stringify(input)} must be one violation`);
  }

  // The four allowed shapes as they appear in app.js, incl. the multi-line
  // permalink head (4 allowed + the comparison below = 5 accepted inputs).
  const accepted = [
    'a.href = dashHref(ref.taskId);',
    'a.href = `?m=${tok.id}`;',
    'a.href = tok.href; // http/https only — the tokenizer\'s scheme allowlist',
    'permalink.href = serializeChatUrl(\n    m.conversation_id,\n  );',
  ];
  assert.equal(accepted.length, 4, '5 accepted inputs examined: 4 allowed shapes + 1 comparison');
  const ok = classifyHrefAssignments(accepted.join('\n'));
  assert.equal(ok.count, 4, '5 accepted inputs examined: the 4 allowed shapes are each counted as an assignment');
  assert.deepEqual(ok.violations, [], `5 accepted inputs examined: zero violations, got ${JSON.stringify(ok.violations)}`);

  // A comparison is not an assignment — the fifth accepted input.
  const cmp = classifyHrefAssignments('if (a.href === b.href) {}');
  assert.equal(cmp.count, 0, '5 accepted inputs examined: a.href === b.href is a comparison, not an assignment');
});
