// lib/personnel.js — read-only access to personnel/ dossier frontmatter (AS-8).
// ALL filesystem knowledge of personnel/ lives here, mirroring lib/lattice.js:
// the root is injectable for tests, and this module never writes anything.
//
// This is deliberately NOT a YAML parser and must not grow into one. The
// schema (CLAUDE.md "Org Chart") is flat `key: value` scalars with optional
// inline `# comments` — per the board-recorded parser contract, adding
// nesting, lists, or multi-line values is a breaking change that updates this
// parser (and its tests) in the same task.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { latticeRoot } from './lattice.js';

// Same identity alphabet the chat store enforces (lib/store.js).
const ACTOR_ID_RE = /^(human|agent|system):[a-z0-9][a-z0-9._-]*$/;

/** One scalar value: optional surrounding quotes, one unquoted trailing
 *  ` # comment` stripped (the documented schema example carries them). */
function cleanValue(raw) {
  let v = raw.trim();
  const quote = v[0] === '"' || v[0] === "'" ? v[0] : null;
  if (quote) {
    const end = v.indexOf(quote, 1);
    if (end !== -1) return v.slice(1, end);
    // Unterminated quote: fall through and treat as unquoted.
  }
  const hash = v.indexOf(' #');
  if (hash !== -1) v = v.slice(0, hash);
  return v.trim();
}

/**
 * Parse flat YAML-subset frontmatter: first line `---`, `key: value` lines
 * until the closing `---`. Returns a plain object, or null when the text has
 * no leading fence (README.md) or no closing fence (malformed) — skip, never throw.
 */
export function parseFrontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') return out;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue; // tolerate junk lines; the fields we need are keyed
    const key = line.slice(0, sep).trim();
    if (key) out[key] = cleanValue(line.slice(sep + 1));
  }
  return null; // never saw the closing fence: malformed
}

/**
 * Read every dossier under <root>/personnel. Returns
 * [{ actorId, name, title, class, reportsTo, team, hired, status }, …]
 * sorted by name. Entries without a valid actor_id or a name are skipped;
 * a missing/unreadable directory returns [] (degradation contract: a broken
 * mount or malformed dossier must never take the server down). Callers
 * filter on status — everything is returned so a "departed" view costs nothing.
 */
export function readRoster(root) {
  const dir = join(root ?? latticeRoot(), 'personnel');
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const roster = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    let fm;
    try {
      fm = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!fm || !fm.name || !ACTOR_ID_RE.test(fm.actor_id ?? '')) continue;
    roster.push({
      actorId: fm.actor_id,
      name: fm.name,
      title: fm.title ?? '',
      class: fm.class ?? '',
      reportsTo: fm.reports_to ?? '',
      team: fm.team ?? '',
      hired: fm.hired ?? '',
      status: fm.status ?? '',
    });
  }
  roster.sort((a, b) => a.name.localeCompare(b.name));
  return roster;
}
