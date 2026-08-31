// msg-refs.js — pure tokenizer for "msg 156"-style message references (AS-26).
// No DOM, no fetch, no globals: importable from the browser (app.js) and from
// node:test alike (same pattern as url-state.js / live.js). DOM assembly and
// click handling live in app.js.

// Head of a reference: a msg/message keyword, optional plural, optional '#',
// then the first id. Case-insensitive. Bare numbers with no keyword never
// match ("26 messages" produces nothing). 'message' is tried before 'msg' so
// the full keyword wins without backtracking games.
const HEAD_RE = /\b(?:message|msg)s?\s*#?\s*(\d+)\b/gi;

// Continuation after a matched reference: a run of list separators
// ('/', ',', 'and', whitespace) followed by another bare integer, so board
// idioms like "msgs 218/220/221" and "message 12, 14 and 15" yield one
// msgref per number. Anchored — applied against the remainder of the string.
const CONT_RE = /^((?:\s*[/,]\s*|\s*\band\b\s*|\s+)+)(\d+)\b/i;

/** Digits -> positive safe-integer id, or null (same INT_RE discipline as url-state.js). */
function toId(digits) {
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Tokenize a message body into text and msgref tokens.
 *
 * Every token's `text` is the exact source slice, so concatenating token
 * texts round-trips the input verbatim. The first msgref of a reference
 * carries the keyword in its text ("msg 156"); continuation ids in a list
 * are their own tokens ("218", "220", …) with the separators left as text.
 *
 * @param {string} text
 * @returns {Array<{type:'text',text:string}|{type:'msgref',text:string,id:number}>}
 */
export function tokenizeMsgRefs(text) {
  const src = String(text ?? '');
  const tokens = [];
  let last = 0;
  const pushText = (s) => {
    if (s) tokens.push({ type: 'text', text: s });
  };
  HEAD_RE.lastIndex = 0;
  let m;
  while ((m = HEAD_RE.exec(src)) !== null) {
    const id = toId(m[1]);
    if (id == null) continue; // non-id number (0, unsafe): stays literal text
    pushText(src.slice(last, m.index));
    tokens.push({ type: 'msgref', text: m[0], id });
    let pos = m.index + m[0].length;
    // Consume a separator list of bare integers ("218/220/221", ", 14 and 15").
    for (;;) {
      const c = CONT_RE.exec(src.slice(pos));
      if (!c) break;
      const cid = toId(c[2]);
      if (cid == null) break;
      pushText(c[1]);
      tokens.push({ type: 'msgref', text: c[2], id: cid });
      pos += c[0].length;
    }
    last = pos;
    HEAD_RE.lastIndex = pos;
  }
  pushText(src.slice(last));
  return tokens;
}
