// lib/lattice.js — read-only access to the repo's .lattice/ directory.
// ALL filesystem knowledge of .lattice/ lives here (portability, plan §8):
// the repo root is a single configurable path. This module never writes .lattice/.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Default repo root: two levels up from apps/chat/ (this file is apps/chat/lib/).
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function latticeRoot() {
  return process.env.CHAT_REPO_ROOT || DEFAULT_ROOT;
}

function latticeDir(root) {
  return join(root ?? latticeRoot(), '.lattice');
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** shortId (e.g. 'AS-2') -> task file id, from ids.json. */
function idMap(root) {
  const ids = readJson(join(latticeDir(root), 'ids.json'));
  return ids?.map ?? {};
}

function taskById(taskId, root) {
  return readJson(join(latticeDir(root), 'tasks', `${taskId}.json`));
}

// Lattice dashboard deep links (AS-10). The server never fetches this URL —
// it is rendered for the viewer's browser, which sits on the same host as the
// loopback-only chat UI, so the 127.0.0.1 default is correct even in-container.
const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:8799';

/** Dashboard task URL: <base>/#/task/<taskId>. Base from LATTICE_DASHBOARD_URL
 * (empty string = unset, per compose passthrough), trailing '/' trimmed. */
export function dashboardTaskUrl(taskId) {
  const base = (process.env.LATTICE_DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, '');
  return `${base}/#/task/${taskId}`;
}

/**
 * Resolve a Lattice short code to {shortId, exists, taskId?, title?, status?, url?}.
 * Lattice stays the source of truth; this is annotation only.
 */
export function resolveShortId(shortId, root) {
  const taskId = idMap(root)[shortId];
  if (!taskId) return { shortId, exists: false };
  const task = taskById(taskId, root);
  if (!task) return { shortId, exists: false };
  return {
    shortId,
    exists: true,
    taskId,
    title: task.title ?? '',
    status: task.status ?? '',
    url: dashboardTaskUrl(taskId),
  };
}

// --- work-status derivation (AS-8) ----------------------------------------

// In-flight statuses only: backlog is a queue (not current work), done and
// cancelled are over. Lower rank = shown first / primary.
const IN_FLIGHT_RANK = {
  in_progress: 0,
  review: 1,
  blocked: 2,
  needs_human: 3,
  planned: 4,
  in_planning: 5,
};

/**
 * Current work per actor: read every .lattice/tasks/*.json (same tolerant
 * readJson pattern as event ingestion — ~a dozen small files, no cache), keep
 * in-flight tasks with an assignee, group by assigned_to. Per actor, entries
 * are ordered by status priority (in_progress > review > blocked >
 * needs_human > planned > in_planning), tie-broken by last_status_changed_at
 * desc; the first is the primary task. Returns
 * { [actorId]: [{ shortId, taskId, title, status, url }, …] } — actors with
 * nothing in flight are absent.
 */
export function assignmentsByActor(root) {
  const dir = join(latticeDir(root), 'tasks');
  const byActor = {};
  if (!existsSync(dir)) return byActor;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const task = readJson(join(dir, file));
    if (!task || !task.assigned_to) continue;
    if (!(task.status in IN_FLIGHT_RANK)) continue;
    (byActor[task.assigned_to] ??= []).push(task);
  }
  for (const [actor, tasks] of Object.entries(byActor)) {
    tasks.sort(
      (a, b) =>
        IN_FLIGHT_RANK[a.status] - IN_FLIGHT_RANK[b.status] ||
        String(b.last_status_changed_at ?? '').localeCompare(String(a.last_status_changed_at ?? ''))
    );
    byActor[actor] = tasks.map((t) => ({
      shortId: t.short_id ?? t.id,
      taskId: t.id,
      title: t.title ?? '',
      status: t.status,
      url: dashboardTaskUrl(t.id),
    }));
  }
  return byActor;
}

const REF_RE = /\bAS-\d+\b/g;

/** Unique resolved refs for a message body. Unresolvable codes are flagged, not linked. */
export function resolveRefs(body, root) {
  const seen = new Set();
  const refs = [];
  for (const match of String(body).matchAll(REF_RE)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    refs.push(resolveShortId(match[0], root));
  }
  return refs;
}

/** Attach a refs array to each message object (non-destructive copy). */
export function annotate(messages, root) {
  return messages.map((m) => ({ ...m, refs: resolveRefs(m.body, root) }));
}

// --- event ingestion ------------------------------------------------------

function truncate(s, n = 60) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Read the complete event stream. Source of truth verified 2026-08-29 (M0):
 * per-task files events/task_*.jsonl are complete; _lifecycle.jsonl holds only
 * task_created duplicates. Read exactly the per-task files, never both.
 */
export function readTaskEvents(root) {
  const dir = join(latticeDir(root), 'events');
  if (!existsSync(dir)) return [];
  const events = [];
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('task_') || !file.endsWith('.jsonl')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && ev.id) events.push(ev);
      } catch {
        // Malformed line: skip; ingestion must never crash on someone else's file.
      }
    }
  }
  events.sort((a, b) =>
    a.ts === b.ts ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.ts < b.ts ? -1 : 1
  );
  return events;
}

function shortIdForTask(taskId, root, eventData) {
  if (eventData?.short_id) return eventData.short_id;
  for (const [shortId, tid] of Object.entries(idMap(root))) {
    if (tid === taskId) return shortId;
  }
  return taskId; // last resort: raw task id, still identifies the task
}

export function formatEvent(ev, root) {
  const shortId = shortIdForTask(ev.task_id, root, ev.data);
  if (ev.type === 'task_created') {
    const title = truncate(ev.data?.title);
    const status = ev.data?.status ?? 'backlog';
    return `${shortId} created by ${ev.actor} — "${title}" [${status}]`;
  }
  if (ev.type === 'status_changed') {
    return `${shortId}: ${ev.data?.from} → ${ev.data?.to} — by ${ev.actor}`;
  }
  return null;
}

const INGEST_TYPES = new Set(['task_created', 'status_changed']);

/**
 * Post any not-yet-ingested Lattice events (creation + status transitions)
 * into the lattice-events channel as system:lattice. Idempotent by
 * construction (ingested_events table). Returns the number posted.
 */
export function ingestNewEvents(store, root) {
  let posted = 0;
  for (const ev of readTaskEvents(root)) {
    if (!INGEST_TYPES.has(ev.type)) continue;
    if (store.hasIngested(ev.id)) continue;
    const body = formatEvent(ev, root);
    if (body && store.ingestEvent(ev.id, body)) posted++;
  }
  return posted;
}
