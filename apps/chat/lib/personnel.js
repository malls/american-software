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
 * Read every dossier under <root>/personnel, with the two facts readRoster
 * throws away (AS-33): which fenced files yielded nothing, and which file each
 * entry came from. Returns
 *
 *   { roster, skipped, sources }
 *
 * - roster  — [{ actorId, name, title, class, reportsTo, team, hired, status }, …]
 *             sorted by name. IDENTICAL in shape and membership to what
 *             readRoster has always returned; parseFrontmatter remains the sole
 *             gate for inclusion, so no file's roster fate changes here.
 * - skipped — [{ file, reason }] for files that LOOK like dossiers (leading
 *             `---` fence) but produced no entry. reason ∈ malformed_frontmatter
 *             | invalid_actor_id | missing_name | unreadable. Directory order.
 *             A file with no leading fence (README.md) is not a dossier and is
 *             skipped silently — absence from this list is the contract.
 * - sources — [{ file, actorId }] for every parsed entry, directory order. Two
 *             entries with one actorId is how a copy-pasted hire is detectable.
 *
 * Degradation contract is unchanged: a missing/unreadable directory yields all
 * three empty, never a throw — a broken mount must never take the server down.
 */
export function readPersonnel(root) {
  const dir = join(root ?? latticeRoot(), 'personnel');
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return { roster: [], skipped: [], sources: [] };
  }
  const roster = [];
  const skipped = [];
  const sources = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    let text;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      skipped.push({ file, reason: 'unreadable' });
      continue;
    }
    const fm = parseFrontmatter(text);
    if (!fm) {
      // parseFrontmatter returns null for BOTH "no leading fence" (README.md)
      // and "no closing fence" (a broken dossier). It is asked first, so the
      // roster's membership is decided by exactly the same call as before;
      // the fence test below only classifies an already-excluded file.
      if (/^---\r?\n/.test(text)) skipped.push({ file, reason: 'malformed_frontmatter' });
      continue;
    }
    if (!ACTOR_ID_RE.test(fm.actor_id ?? '')) {
      skipped.push({ file, reason: 'invalid_actor_id' });
      continue;
    }
    if (!fm.name) {
      skipped.push({ file, reason: 'missing_name' });
      continue;
    }
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
    sources.push({ file, actorId: fm.actor_id });
  }
  roster.sort((a, b) => a.name.localeCompare(b.name));
  return { roster, skipped, sources };
}

/**
 * The roster alone — the long-standing AS-8 entry point, unchanged in
 * signature and behaviour. Every existing caller (server.js, bin/chat.js,
 * test/personnel.test.js) keeps using this.
 */
export function readRoster(root) {
  return readPersonnel(root).roster;
}
