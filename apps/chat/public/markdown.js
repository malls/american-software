// markdown.js — pure inline/block markdown tokenizers (AS-26 §6).
// No DOM, no fetch, no globals: importable from the browser (app.js) and from
// node:test alike. The tokenizers emit text and structure, NEVER markup —
// DOM assembly (el()/textContent only, zero innerHTML) lives in app.js.

// Inline patterns in precedence order. Code first: its inner receives no
// further styling, so `**x**` inside backticks stays literal. Delimiters must
// hug non-space content (`** x **` stays literal); `_em_` only fires when the
// underscores are word-boundary-adjacent (snake_case_name stays literal);
// links carry an http/https-only scheme allowlist — any other scheme
// (javascript: etc.) simply fails the match and stays literal text.
// Single level: a styled token's inner is not re-tokenized.
const PATTERNS = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'strong', re: /\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/ },
  { type: 'em', re: /\*(?!\s)([^*\n]+?)(?<!\s)\*/ },
  { type: 'em', re: /(?<![A-Za-z0-9_])_(?!\s)([^_\n]+?)(?<!\s)_(?![A-Za-z0-9_])/ },
  { type: 'link', re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/ },
];

/**
 * Tokenize one run of body text into inline-styled tokens.
 *
 * Every token's `text` is the exact source slice (concatenating token texts
 * round-trips the input); styled tokens additionally carry `inner` — the
 * content without its delimiters — and links carry `href`. Unmatched or
 * non-hugging delimiters stay literal text.
 *
 * @param {string} text
 * @returns {Array<{type:'text',text:string}
 *   |{type:'code'|'strong'|'em',text:string,inner:string}
 *   |{type:'link',text:string,inner:string,href:string}>}
 */
export function tokenizeInline(text) {
  const src = String(text ?? '');
  const tokens = [];
  let pos = 0;
  while (pos < src.length) {
    const rest = src.slice(pos);
    let best = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(rest);
      // Leftmost match wins; on a tie, earlier (higher-precedence) pattern.
      if (m && (best === null || m.index < best.m.index)) best = { m, type: p.type };
    }
    if (!best) break;
    const { m, type } = best;
    if (m.index > 0) tokens.push({ type: 'text', text: rest.slice(0, m.index) });
    if (type === 'link') tokens.push({ type, text: m[0], inner: m[1], href: m[2] });
    else tokens.push({ type, text: m[0], inner: m[1] });
    pos += m.index + m[0].length;
  }
  if (pos < src.length) tokens.push({ type: 'text', text: src.slice(pos) });
  return tokens;
}

/**
 * Block-level parse, used ONLY by the §5 file viewer (message bodies get
 * inline styling only — block markdown typed into chat stays literal in v1).
 *
 * Blocks: `heading` (#–######, single line), `code` (``` fenced, closing
 * fence optional at EOF), `para` (blank-line-delimited; hard line breaks
 * preserved in `text`). List lines are ordinary para lines — their bullet
 * characters render intact (no <ul>/<ol> construction in v1).
 *
 * @param {string} text
 * @returns {Array<{type:'heading',level:number,text:string}
 *   |{type:'code',text:string}|{type:'para',text:string}>}
 */
export function parseBlocks(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: 'para', text: para.join('\n') });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue; // the closing fence line (if any) is consumed here
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ type: 'heading', level: h[1].length, text: h[2] });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
