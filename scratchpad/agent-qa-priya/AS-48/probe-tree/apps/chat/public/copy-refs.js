// copy-refs.js — pure tokenizers for click-to-copy refs (AS-115): commit
// hashes and feat/AS-<n>-<slug> branch names. No DOM, no fetch, no globals:
// importable from the browser (app.js) and from node:test alike (same
// contract as msg-refs.js). DOM assembly and clipboard handling live in app.js.

// Lowercase hex run of 7–40 (git's abbrev floor to a full SHA). Left fence
// blocks a word char, '/', '#', '-' (paths, commit URLs, issue numbers, UUID
// and compose-project fragments); it allows '.', '(', '`', ':' and space so
// the range idiom `a..b` yields both halves. Right fence blocks a word char or
// '-', or a '.' followed by a word char (`abc1234.js`); a sentence-ending '.'
// is fine because a space follows it. Rules calibrated on the live corpus —
// see the plan §3.
const HASH_RE = /(?<![A-Za-z0-9_/#-])[0-9a-f]{7,40}(?!\.?[A-Za-z0-9_-])/g;

// The English words of 7+ letters drawn only from {a…f}. Exhaustive.
const HEX_WORDS = new Set(['acceded', 'defaced', 'effaced']);

/** Composition gate: all-digit runs only at exactly length 7 (a real observed
 *  hash; 8+ digits is a number), all-alpha runs except the stoplist. */
function admitHash(s) {
  if (HEX_WORDS.has(s)) return false;
  if (/^\d+$/.test(s)) return s.length === 7;
  return true;
}

// feat/AS-<n>-<slug> only — the one branch form the git methodology permits.
// At least one slug segment; segments are [A-Za-z0-9_] joined by '-'. Left
// fence allows '/' and '.' on purpose (`origin/feat/…`, `master...feat/…`).
const BRANCH_RE = /(?<![A-Za-z0-9_-])feat\/AS-\d+(?:-[A-Za-z0-9_]+)+(?![A-Za-z0-9_/-])/g;

/** Generic exact-slice scan: text tokens between matches, `type` for matches
 *  that pass `admit`. Round-trips the input verbatim. */
function scan(text, re, type, admit) {
  const src = String(text ?? '');
  const tokens = [];
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (admit && !admit(m[0])) continue;
    if (m.index > last) tokens.push({ type: 'text', text: src.slice(last, m.index) });
    tokens.push({ type, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ type: 'text', text: src.slice(last) });
  return tokens;
}

/**
 * Tokenize text into text and hash tokens.
 * @param {string} text
 * @returns {Array<{type:'text',text:string}|{type:'hash',text:string}>}
 */
export function tokenizeHashes(text) {
  return scan(text, HASH_RE, 'hash', admitHash);
}

/**
 * Tokenize text into text and branch tokens.
 * @param {string} text
 * @returns {Array<{type:'text',text:string}|{type:'branch',text:string}>}
 */
export function tokenizeBranches(text) {
  return scan(text, BRANCH_RE, 'branch', null);
}
