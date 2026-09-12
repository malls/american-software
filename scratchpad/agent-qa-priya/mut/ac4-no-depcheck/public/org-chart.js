// org-chart.js — the org graph: validation rules + tree building (AS-33).
// Pure by construction: no fs, no fetch, no DOM, no globals, no clock. It
// takes plain data and returns plain data, which is what lets every rule be
// tested with a four-line literal instead of a fixture tree.
//
// It lives in public/ (not lib/) because the BROWSER imports it — public/ is
// what the server serves. server.js therefore imports UP into public/, which
// looks backwards and is deliberate: the alternative is a second copy of the
// rule set for the client, and a validator that disagrees with the view is
// worse than no view at all. public/dm-sort.js is the standing precedent for
// a pure module shared by the browser and node:test.
//
// Consumers: public/app.js (render), server.js (GET /api/org),
// bin/check-org.js (the CLI gate), test/org-chart.test.js.

// The board member is the tree's root and has no dossier — PHILOSOPHY.md and
// CLAUDE.md both put him outside the employee set, so nothing in personnel/
// can derive him. The tempting alternative ("the root is whatever reports_to
// target has no dossier") is actively harmful: under it EVERY orphan becomes a
// new root and orphan_reports_to could never fire. The root and the orphan
// rule are one decision seen twice.
export const BOARD_ROOT = 'human:forrest';

// The display name duplicates the seed identity string in lib/store.js — as a
// CONSTANT, not a join. The chart must render with no store lookup and no
// 'me'. Do not "fix" this into a lookup.
// class: 'board' is deliberately outside VALID_CLASSES: the board node is
// never validated, and giving it a class the validator rejects makes it
// impossible to feed it through the employee path by accident.
export const BOARD_NODE = Object.freeze({
  actorId: BOARD_ROOT,
  name: 'Forrest (Board)',
  title: 'Board',
  class: 'board',
  team: '',
});

/** The four classes CLAUDE.md "Org Chart" defines. */
export const VALID_CLASSES = Object.freeze(['cofounder', 'c-level', 'manager', 'ic']);

/** The two statuses. A departed employee keeps their dossier; records are never deleted. */
export const VALID_STATUSES = Object.freeze(['active', 'departed']);

// The nine rules, in emit order. Each code appears EXACTLY TWICE in this file:
// once here, once at its emit site (marked `// rule: <code>`). That is what
// makes a per-rule mutation scopeable to one region instead of file-wide —
// keep the property when adding a rule.
export const ORG_RULES = Object.freeze([
  'orphan_reports_to',
  'missing_reports_to',
  'reporting_cycle',
  'reports_to_ic',
  'unparsed_dossier',
  'duplicate_actor_id',
  'invalid_class',
  'invalid_status',
  'multiple_board_reports',
]);

/** Plain lexicographic compare — deterministic, no locale surprises. */
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Display-name compare, matching the roster sort in lib/personnel.js. */
function cmpName(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * Every cycle in the active reporting graph. Each node has at most one
 * out-edge, so a walk from any node either reaches a terminal or re-enters a
 * node it has already stepped on; the slice from that re-entry is the cycle.
 * Nodes are coloured done afterwards so each cycle is reported exactly once.
 */
function findCycles(active, byId) {
  const done = new Set();
  const cycles = [];
  for (const e of active) {
    if (done.has(e.actorId)) continue;
    const path = [];
    const at = new Map();
    let cur = e.actorId;
    while (cur != null && !done.has(cur)) {
      if (at.has(cur)) {
        cycles.push(path.slice(at.get(cur)));
        break;
      }
      at.set(cur, path.length);
      path.push(cur);
      const next = byId.get(cur)?.reportsTo ?? '';
      cur = next && byId.has(next) ? next : null;
    }
    for (const id of path) done.add(id);
  }
  return cycles;
}

/**
 * Validate the personnel graph. Input is exactly what lib/personnel.js's
 * readPersonnel returns — the UNFILTERED roster plus the skipped files and the
 * file each entry came from. Rules 5, 6 and 8 need what the active filter
 * throws away, which is why the filtering happens here and not at the caller.
 *
 * Returns [{ rule, actorId, file, detail }, …] sorted by (rule, actorId, file)
 * so every assertion can be a deepEqual on the whole array rather than a
 * .some() — an ordering-independent assertion is one of the ways a "passing"
 * test stops noticing extra output.
 *
 * One severity tier: any violation is a violation. At headcount 10 every one
 * of these is a one-line dossier edit, and a warning tier is a queue nobody
 * drains.
 */
export function validateOrg({ roster = [], skipped = [], sources = [] } = {}) {
  const all = Array.isArray(roster) ? roster : [];
  const active = all.filter((e) => e && e.status === 'active');
  const byId = new Map();
  for (const e of active) if (!byId.has(e.actorId)) byId.set(e.actorId, e);
  const anyId = new Map();
  for (const e of all) if (e && !anyId.has(e.actorId)) anyId.set(e.actorId, e);
  const fileOf = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!fileOf.has(s.actorId)) fileOf.set(s.actorId, s.file);
  }
  const fileFor = (id) => fileOf.get(id) ?? null;
  const out = [];

  // rule: orphan_reports_to
  // A reporting line to somebody who is not there. The departed variant is not
  // a separate rule — it is the same broken edge with a different fix, and a
  // departed manager with live reports is a real organisational defect, not an
  // artifact of the active-only filter.
  for (const e of active) {
    const target = e.reportsTo ?? '';
    if (!target || target === BOARD_ROOT || byId.has(target)) continue;
    const known = anyId.get(target);
    out.push({
      rule: 'orphan_reports_to',
      actorId: e.actorId,
      file: fileFor(e.actorId),
      detail: known
        ? `reports to ${target}, who is departed`
        : `reports to ${target}, who has no dossier`,
    });
  }

  // rule: missing_reports_to
  // A degenerate orphan, split out only so the message can say "has no
  // reporting line" instead of "points at ''".
  for (const e of active) {
    if (e.reportsTo ?? '') continue;
    out.push({
      rule: 'missing_reports_to',
      actorId: e.actorId,
      file: fileFor(e.actorId),
      detail: 'has no reporting line',
    });
  }

  // rule: reporting_cycle
  // One violation per cycle, keyed on the lexicographically smallest member so
  // the same cycle always reports under the same actor.
  for (const members of findCycles(active, byId)) {
    const sorted = [...members].sort(cmp);
    out.push({
      rule: 'reporting_cycle',
      actorId: sorted[0],
      file: fileFor(sorted[0]),
      detail: `reporting cycle: ${sorted.join(', ')}`,
    });
  }

  // rule: reports_to_ic
  // An ic has no reports by definition (CLAUDE.md: managers and above spawn
  // sub-agents; ics do the work). This check is only trustworthy while class
  // is meaningful, which is what invalid_class below is for.
  for (const e of active) {
    const manager = byId.get(e.reportsTo ?? '');
    if (!manager || manager.class !== 'ic' || manager.actorId === e.actorId) continue;
    out.push({
      rule: 'reports_to_ic',
      actorId: e.actorId,
      file: fileFor(e.actorId),
      detail: `reports to ${manager.actorId}, who is an ic`,
    });
  }

  // rule: unparsed_dossier
  // The invisibility rule: readRoster skips a broken dossier silently, so a
  // real employee can vanish from the roster, the sidebar and this chart with
  // no signal anywhere. A rule that only inspects the graph cannot see the
  // person who is missing from it.
  for (const s of Array.isArray(skipped) ? skipped : []) {
    out.push({
      rule: 'unparsed_dossier',
      actorId: null,
      file: s.file,
      detail: `dossier yielded no employee (${s.reason})`,
    });
  }

  // rule: duplicate_actor_id
  // A copy-pasted hire: two nodes with one identity, and every join (Lattice
  // work, DM state) becomes ambiguous.
  const filesById = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!filesById.has(s.actorId)) filesById.set(s.actorId, []);
    filesById.get(s.actorId).push(s.file);
  }
  for (const [actorId, files] of filesById) {
    if (files.length < 2) continue;
    out.push({
      rule: 'duplicate_actor_id',
      actorId,
      file: null,
      detail: `declared in ${[...files].sort(cmp).join(', ')}`,
    });
  }

  // rule: invalid_class
  // Load-bearing for reports_to_ic: a typo'd class silently disables the
  // mandated check — the classic way a rule passes vacuously in production.
  for (const e of active) {
    if (VALID_CLASSES.includes(e.class)) continue;
    out.push({
      rule: 'invalid_class',
      actorId: e.actorId,
      file: fileFor(e.actorId),
      detail: `class ${JSON.stringify(e.class ?? '')} is not one of ${VALID_CLASSES.join(', ')}`,
    });
  }

  // rule: invalid_status
  // Scans the UNFILTERED roster on purpose: `status: activ` deletes a person
  // from the sidebar, the chart, the CLI roster and every DM affordance,
  // silently — and by definition they are not in the active set to be checked.
  for (const e of all) {
    if (VALID_STATUSES.includes(e.status)) continue;
    out.push({
      rule: 'invalid_status',
      actorId: e.actorId,
      file: fileFor(e.actorId),
      detail: `status ${JSON.stringify(e.status ?? '')} is not one of ${VALID_STATUSES.join(', ')}`,
    });
  }

  // rule: multiple_board_reports
  // CLAUDE.md: only the CEO reports to human:forrest. A second board report is
  // how an org chart quietly grows two roots.
  const boardReports = active
    .filter((e) => (e.reportsTo ?? '') === BOARD_ROOT)
    .map((e) => e.actorId)
    .sort(cmp);
  if (boardReports.length > 1) {
    out.push({
      rule: 'multiple_board_reports',
      actorId: null,
      file: null,
      detail: `only the CEO reports to the board: ${boardReports.join(', ')}`,
    });
  }

  out.sort(
    (a, b) =>
      cmp(a.rule, b.rule) || cmp(a.actorId ?? '', b.actorId ?? '') || cmp(a.file ?? '', b.file ?? '')
  );
  return out;
}

/** One tree node from a roster entry. `reports` is filled by the walk. */
function treeNode(e) {
  return {
    actorId: e.actorId,
    name: e.name ?? '',
    title: e.title ?? '',
    class: e.class ?? '',
    team: e.team ?? '',
    reports: [],
  };
}

/**
 * Build the reporting tree from the ACTIVE employees, rooted at the board.
 * Returns { root, unplaced }.
 *
 * The walk only ever goes DOWN from BOARD_ROOT, guarded by a visited set: a
 * cycle is an input we expect, and walking up a parent chain would hang on
 * one. Anything the walk never reaches — orphans, cycle members, a duplicate
 * identity, anyone under a broken edge — lands in `unplaced`, name-sorted.
 *
 * Invariant: every input employee appears EXACTLY ONCE, in the tree or in
 * unplaced. The view must never silently lose a person, whatever the graph
 * does. That is a rendering safeguard, not a validation rule — validateOrg
 * says what is wrong; this says nobody disappeared while we drew it.
 */
export function buildOrgTree(employees) {
  const list = (Array.isArray(employees) ? employees : []).filter(Boolean);
  const byManager = new Map();
  for (const e of list) {
    const key = e.reportsTo ?? '';
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key).push(e);
  }
  for (const kids of byManager.values()) kids.sort((a, b) => cmpName(a.name, b.name));

  const placed = new Set();
  const visited = new Set([BOARD_ROOT]);
  const root = { ...BOARD_NODE, reports: [] };
  const walk = (parent, id) => {
    for (const e of byManager.get(id) ?? []) {
      if (visited.has(e.actorId)) continue; // duplicate identity: place it once
      visited.add(e.actorId);
      placed.add(e);
      const node = treeNode(e);
      parent.reports.push(node);
      walk(node, e.actorId);
    }
  };
  walk(root, BOARD_ROOT);

  const unplaced = list
    .filter((e) => !placed.has(e))
    .map(treeNode)
    .sort((a, b) => cmpName(a.name, b.name));
  return { root, unplaced };
}
