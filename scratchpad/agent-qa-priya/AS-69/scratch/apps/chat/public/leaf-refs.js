// leaf-refs.js — the pure leaf pass chain (AS-115). Composes every per-leaf
// tokenizer in the recorded order so the order is observable from node:test
// instead of being an invariant that only app.js's control flow knew about.
// No DOM, no fetch, no globals; app.js maps the flat token list to nodes.
import { tokenizeUrls } from './markdown.js';
import { tokenizeMsgRefs, tokenizeFileRefs } from './msg-refs.js';
import { tokenizeHashes, tokenizeBranches } from './copy-refs.js';

/** Split text into { type:'text'|'asref' } tokens against resolved refs
 *  (moved verbatim from app.js, AS-10). */
export function tokenizeAsRefs(text, refs) {
  if (!text) return [];
  if (refs.length === 0) return [{ type: 'text', text }];
  const re = new RegExp(`\\b(${refs.map((r) => r.shortId).join('|')})\\b`, 'g');
  const tokens = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) tokens.push({ type: 'text', text: text.slice(last, m.index) });
    tokens.push({ type: 'asref', text: m[0], ref: refs.find((r) => r.shortId === m[0]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
  return tokens;
}

/** Run `pass` over every remaining text token; every non-text token is
 *  terminal — its text is never fed to a later pass. */
function refine(tokens, pass) {
  const out = [];
  for (const tok of tokens) {
    if (tok.type !== 'text') out.push(tok);
    else out.push(...pass(tok.text));
  }
  return out;
}

/**
 * Tokenize a plain-text leaf with every pass applied, in order:
 * URLs → branches → AS-refs → msg-refs → file-refs → hashes → text.
 * `autolink: false` (a markdown link's label) skips every pass that would
 * create a clickable element with no server-resolved ref: URL, branch, hash.
 * Every token's `text` is the exact source slice; the list round-trips.
 *
 * @param {string} text
 * @param {Array<{shortId:string}>} refs
 * @param {{autolink?: boolean}} [opts]
 * @returns {Array<{type:'text'|'url'|'branch'|'asref'|'msgref'|'fileref'|'hash', text:string}>}
 */
export function tokenizeLeaf(text, refs, { autolink = true } = {}) {
  const src = String(text ?? '');
  let tokens = [{ type: 'text', text: src }];
  if (autolink) tokens = refine(tokens, tokenizeUrls);
  if (autolink) tokens = refine(tokens, tokenizeBranches);
  tokens = refine(tokens, (t) => tokenizeAsRefs(t, refs));
  tokens = refine(tokens, tokenizeMsgRefs);
  tokens = refine(tokens, tokenizeFileRefs);
  if (autolink) tokens = refine(tokens, tokenizeHashes);
  return tokens.filter((t) => t.text !== '');
}
