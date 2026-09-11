// AS-98: the link-site guard, inverted from a denylist of one spelling into an
// allowlist of every href source in public/*.js. AS-120: the assignment
// operator set is enumerated (all 16 of ECMAScript's), not two of them.
//
// The English this file enforces, verbatim from the AS-120 plan (§1) — the
// algorithm is no wider and no narrower than this sentence:
//
//   Every `.href` assignment in public/*.js — by any of the 16 ECMAScript
//   assignment operators — uses plain `=` with a right-hand side that begins
//   with `dashHref(`, `tok.href`, `` `?m= `` or `serializeChatUrl(`, and
//   there are exactly 9 of them. No file in public/*.js uses
//   `setAttribute('href'`, `Object.assign(`, `['href']`, `Reflect.set(`,
//   `Object.defineProperty(`/`defineProperties(`, or `.href` followed by a
//   compound assignment operator. No file in public/*.js reads a `url`
//   property by member (`.url`, other than `import.meta.url`) or bracket
//   (`['url']`) access.
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

// Every ECMAScript assignment operator (ECMA-262 §13.15 + the logical forms):
// 16, enumerated. Longer operators first inside the alternation, so `>>>=`
// is not read as `>>=` and `||=` is not read as `|=`.
const ASSIGN_OP = String.raw`\*\*=|<<=|>>>=|>>=|\|\|=|\?\?=|&&=|[-+*/%&|^]=|=`;
// `(?!=)` skips `==`/`===` comparisons; `[^;\n]*` takes the RHS head, so a
// multi-line RHS (the AS-26 permalink) still yields its first line.
const HREF_ASSIGN = new RegExp(String.raw`\.href\s*(${ASSIGN_OP})(?!=)\s*([^;\n]*)`, 'g');
// The 15 compound forms (everything above except bare `=`), for the
// MECHANISMS ban — deliberately a second, independent regex (AS-120 §8 Q1):
// the flat spelling ban must keep firing even if the classifier is loosened.
const HREF_COMPOUND = new RegExp(String.raw`\.href\s*(?:\*\*=|<<=|>>>=|>>=|\|\|=|\?\?=|&&=|[-+*/%&|^]=)`);

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
  ['.href <compound>=', HREF_COMPOUND],
  // Whole bans, not key-scoped to 'href' — same reasoning as Object.assign(
  // (zero uses; house style is el() + explicit property sets). A legitimate
  // future use is a one-line edit here, with a comment saying why.
  ['Reflect.set(', /Reflect\.set\(/],
  ['Object.defineProperty(', /Object\.definePropert(?:y|ies)\(/],
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

test('link-sites: AS-98/AS-120 — no file in public/*.js sets href by any mechanism other than a plain .href = assignment', () => {
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
    // AS-120: compound assignment on a fresh anchor (Priya's P8, verbatim, and
    // two siblings). The third has an allowlisted RHS and a forbidden operator
    // — it proves the classifier's `op === '='` test is load-bearing.
    'p1.href ||= task.taskId;',
    'p1.href ??= task.url;',
    'p1.href &&= dashHref(task.taskId);',
  ];
  assert.equal(rejected.length, 12, '12 rejected inputs examined');
  for (const input of rejected) {
    const { count, violations } = classifyHrefAssignments(input);
    assert.equal(count, 1, `12 rejected inputs examined: ${JSON.stringify(input)} is one assignment`);
    assert.equal(violations.length, 1, `12 rejected inputs examined: ${JSON.stringify(input)} must be one violation`);
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

test('link-sites: AS-120 — the classifier and the mechanism ban see all 16 ECMAScript assignment operators and no comparison operator', () => {
  // A literal list (ECMA-262 §13.15 AssignmentOperator + the three logical
  // forms) — NOT derived from ASSIGN_OP, or this would check the regex
  // against itself.
  const operators = [
    '=', '*=', '/=', '%=', '+=', '-=', '<<=', '>>=', '>>>=',
    '&=', '^=', '|=', '**=', '&&=', '||=', '??=',
  ];
  assert.equal(operators.length, 16, '16 operators examined');
  for (const op of operators) {
    const input = `x.href ${op} y;`;
    const { count, violations } = classifyHrefAssignments(input);
    assert.equal(count, 1, `16 operators examined: ${JSON.stringify(input)} is one assignment`);
    // `y` is not an allowlisted RHS, so bare `=` is a violation too; the
    // captured operator must be the whole operator, not a suffix of it.
    assert.equal(violations.length, 1, `16 operators examined: ${JSON.stringify(input)} is one violation`);
    assert.equal(violations[0].op, op, `16 operators examined: ${JSON.stringify(input)} captures op ${JSON.stringify(op)}`);
    assert.equal(violations[0].rhs, 'y', `16 operators examined: ${JSON.stringify(input)} captures rhs "y"`);
    if (op === '=') {
      assert.doesNotMatch(input, HREF_COMPOUND, `16 operators examined: plain = is not a compound assignment`);
    } else {
      assert.match(input, HREF_COMPOUND, `16 operators examined: ${JSON.stringify(input)} is banned as a compound assignment`);
    }
  }

  const comparisons = ['==', '===', '!=', '<=', '>='];
  assert.equal(comparisons.length, 5, '5 comparisons examined');
  for (const op of comparisons) {
    const input = `if (x.href ${op} y) {}`;
    const { count } = classifyHrefAssignments(input);
    assert.equal(count, 0, `5 comparisons examined: ${JSON.stringify(input)} is not an assignment`);
    assert.doesNotMatch(input, HREF_COMPOUND, `5 comparisons examined: ${JSON.stringify(input)} is not a compound assignment`);
  }
});
