// test/helpers/states-ledger.js — a strict reader for the vendored states
// ledger, docs/design/wireframes/02-states-ledger.md (AS-71).
//
// WHY THIS EXISTS. Every screen's view module carries a frozen transcription of
// the ledger's rows, and every screen's test file carries a second one; the
// suite compared those two copies to each other. Nothing read the design
// document, so a row changing THERE changed nothing here. The Dockerfile now
// vendors the document into the image next to tokens.css, and this parser is
// how the suite reads it — so the join to the design document is mechanical,
// not a dated review act.
//
// The parser is deliberately STRICT and throws on anything it does not
// recognise — the deploy-shape.test.js doctrine. A parser that shrugged at a
// reshaped table would make every assertion downstream of it vacuous, which is
// the exact failure this task exists to close. If the ledger grows a shape this
// cannot read, teach it that shape; do not loosen it into shrugging.
//
// What it recognises, and nothing else:
//   - `## <n>. Screen <n> — <title>` headings (both numbers must agree);
//   - under such a heading, the header `| Row ID | Category | Trigger | What renders |`
//     and its `|---|---|---|---|` separator, then data rows of EXACTLY four
//     cells whose first cell is a backticked `S<n>-…` id with <n> equal to the
//     enclosing screen's number and whose Category is one of the six shorthands;
//   - §0's shared sub-pattern table (`| Row ID pattern | …`), recognised by name
//     and skipped: its rows are already expanded into §4 and §6;
//   - §8's `= **N states across M screens.**` line, as the document's own count.
// A row whose Trigger begins `n/a — ` is an n/a row, and its "What renders"
// cell must say `n/a row` too — the two markers agree or the row is rejected.
// Test-only: nothing under lib/ or routes/ imports this.

/** The six category shorthands the ledger's preamble defines. */
export const CATEGORIES = Object.freeze(['DEFAULT', 'LOADING', 'EMPTY', 'ERROR', 'GATED', 'ABANDON']);

const SCREEN_HEADING = /^## (\d+)\. Screen (\d+) — (.+)$/;
const ANY_HEADING = /^## /;
const ROW_HEADER = '| Row ID | Category | Trigger | What renders |';
const PATTERN_HEADER = '| Row ID pattern | Category | Trigger | What renders |';
const SEPARATOR = /^\|\s*-{3,}\s*(\|\s*-{3,}\s*){3}\|$/;
const ROW_ID = /^`(S(\d+)-[A-Z0-9-]+)`$/;
const DECLARED = /= \*\*(\d+) states across (\d+) screens\.\*\*/;

/** Split a `| a | b | c |` line into its trimmed cells. The ledger uses no
 *  escaped pipes, and this rejects a row with the wrong cell count anyway. */
function cells(line) {
  if (!line.startsWith('|') || !line.endsWith('|')) throw new Error(`states-ledger: not a table row: ${JSON.stringify(line)}`);
  return line.slice(1, -1).split('|').map((cell) => cell.trim());
}

/**
 * @param {string} text the document
 * @returns {{
 *   screens: Map<number, { title: string, rows: Array<{ id: string, category: string, trigger: string, renders: string, na: boolean }> }>,
 *   rows: Array<{ screen: number, id: string, category: string, trigger: string, renders: string, na: boolean }>,
 *   declared: { rows: number, screens: number },
 * }}
 */
export function parseStatesLedger(text) {
  const lines = text.split('\n').map((line) => line.trimEnd());
  const screens = new Map();
  const rows = [];
  const seen = new Set();
  let screen = null; // number of the enclosing `## n. Screen n` section, or null
  let inTable = null; // 'rows' | 'pattern' | null
  let declared = null;

  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    const where = `line ${n + 1}`;

    if (ANY_HEADING.test(line)) {
      inTable = null;
      const m = SCREEN_HEADING.exec(line);
      if (m) {
        if (m[1] !== m[2]) throw new Error(`states-ledger: ${where}: section ${m[1]} names Screen ${m[2]}`);
        screen = Number(m[1]);
        if (screens.has(screen)) throw new Error(`states-ledger: ${where}: Screen ${screen} appears twice`);
        screens.set(screen, { title: m[3].trim(), rows: [] });
      } else {
        screen = null;
      }
      continue;
    }

    const declaredMatch = DECLARED.exec(line);
    if (declaredMatch) {
      if (declared !== null) throw new Error(`states-ledger: ${where}: a second declared count`);
      declared = { rows: Number(declaredMatch[1]), screens: Number(declaredMatch[2]) };
      continue;
    }

    if (!line.startsWith('|')) {
      inTable = null;
      continue;
    }

    // From here on the line is a table line.
    if (line === ROW_HEADER) {
      if (screen === null) throw new Error(`states-ledger: ${where}: a row table outside any Screen section`);
      const sep = lines[n + 1] ?? '';
      if (!SEPARATOR.test(sep)) throw new Error(`states-ledger: ${where}: header not followed by a separator: ${JSON.stringify(sep)}`);
      inTable = 'rows';
      n += 1;
      continue;
    }
    if (line === PATTERN_HEADER) {
      if (screen !== null) throw new Error(`states-ledger: ${where}: the pattern table inside Screen ${screen}`);
      const sep = lines[n + 1] ?? '';
      if (!SEPARATOR.test(sep)) throw new Error(`states-ledger: ${where}: header not followed by a separator: ${JSON.stringify(sep)}`);
      inTable = 'pattern';
      n += 1;
      continue;
    }
    if (inTable === 'pattern') continue; // §0's rows are expanded into §4 and §6
    if (inTable !== 'rows') throw new Error(`states-ledger: ${where}: a table line outside a recognised table: ${JSON.stringify(line)}`);

    const parts = cells(line);
    if (parts.length !== 4) throw new Error(`states-ledger: ${where}: expected 4 cells, found ${parts.length}: ${JSON.stringify(line)}`);
    const [rawId, category, trigger, renders] = parts;
    const idMatch = ROW_ID.exec(rawId);
    if (!idMatch) throw new Error(`states-ledger: ${where}: unrecognised row id ${JSON.stringify(rawId)}`);
    const [, id, prefix] = idMatch;
    if (Number(prefix) !== screen) throw new Error(`states-ledger: ${where}: row ${id} sits under Screen ${screen}`);
    if (!CATEGORIES.includes(category)) throw new Error(`states-ledger: ${where}: unknown category ${JSON.stringify(category)} on ${id}`);
    if (seen.has(id)) throw new Error(`states-ledger: ${where}: duplicate row id ${id}`);
    const na = /^n\/a — /.test(trigger);
    if (na !== renders.includes('n/a row')) {
      throw new Error(`states-ledger: ${where}: ${id} is n/a in ${na ? 'Trigger' : 'What renders'} but not the other`);
    }
    seen.add(id);
    const row = { id, category, trigger, renders, na };
    screens.get(screen).rows.push(row);
    rows.push({ screen, ...row });
  }

  if (rows.length === 0) throw new Error('states-ledger: the document yields no rows');
  if (declared === null) throw new Error('states-ledger: no declared count (§8) found');
  return { screens, rows, declared };
}
