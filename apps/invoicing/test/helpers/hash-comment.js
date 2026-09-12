// helpers/hash-comment.js — the one trailing-`#`-comment stripper (AS-57).
//
// Two tests read manifests as data and need `k: v # comment` reduced to `k: v `
// without ever cutting inside a quoted scalar: deploy-shape.test.js (its YAML
// parser) and dependency-policy.test.js (the manifest scan). Until AS-57 each
// carried a byte-identical copy of this loop, and both copies had the same
// hole: inside "…" a `\"` is an ESCAPED quote, not the closing one, so
// `k: "a \" # fetch(…)"` closed the string early and stripped the rest of the
// line — still inside the string — as a comment. A fix that had to be made
// twice is made once, here.
//
// Rules, per line: a `#` starts a comment only outside quotes and only at
// column 0 or after whitespace (`a#b` is data in YAML). Inside "…" a `\`
// consumes the next character, so `\"` never closes. Inside '…' there is no
// escape — YAML writes a literal quote as `''`, which this loop reads as
// close-then-reopen and gets right by construction. Full-line comments are the
// caller's business (dependency-policy handles them before calling this).

/** `line` with a trailing ` # comment` removed, or unchanged if it has none. */
export function stripTrailingHashComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}
