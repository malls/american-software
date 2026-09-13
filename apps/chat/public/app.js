// ASC Chat UI — vanilla JS (ES module), zero external requests.
// Rendering rule: ALL user content goes through textContent (never innerHTML).

import { parseChatUrl, serializeChatUrl, resolveConversation } from './url-state.js';
import { renderPreservingScroll, prependPreservingScroll } from './scroll.js';
import { applyFrameToPanes, replyLabel } from './message-pane.js';
import { shouldCloseOnEscape, shouldCloseOnBackdropGesture } from './thread-modal.js';
import { applyMessage, maxLoadedId, mergeOlderPage, ensureLoaded, findLoaded } from './live.js';
import { rosterOrder, dmOrder, togglePin, sanitizePins } from './dm-sort.js';
import { BOARD_ROOT, buildOrgTree } from './org-chart.js';
import { tokenizeInline, parseBlocks } from './markdown.js';
import { tokenizeLeaf } from './leaf-refs.js';
import { describeLoopStatus } from './loop-status.js';
// AS-99: every word the lanes badge and pane show is decided in this module,
// where it is unit-tested; this file does DOM only.
import { describeLanes, describeLane, describeTickLine, describeActivity } from './lanes.js';
import { dashboardTaskHref } from './dashboard-link.js';

const $ = (sel) => document.querySelector(sel);

// AS-17: who the picker lands on when localStorage has no (valid) saved pick.
// Seeded in lib/store.js; if ever absent, degrades to the first option.
const DEFAULT_IDENTITY = 'human:forrest';

// AS-131: top-level messages per page. The cold load is the newest page
// (?before=0); older pages load on scroll-up / "Load earlier messages".
const PAGE_SIZE = 50;
// Scroll-up trigger: an older page loads once the reader is within this many
// px of the top of #messages. A page of 50 is far taller than this, so one
// prepend never re-triggers itself.
const LOAD_OLDER_THRESHOLD_PX = 200;

const state = {
  me: null,
  conversations: [],
  roster: [], // AS-8: active employees from /api/roster (empty on degradation)
  currentConv: null, // conversation object
  currentThreadRoot: null, // message id
  lastData: null, // last /api/messages payload for current conversation (page mode since AS-131: carries hasMore/nextBefore)
  loadingOlder: false, // AS-131: one older-page fetch in flight at a time (serializes scroll-up)
  anchorMsg: null, // m= message anchor currently reflected in the URL (AS-9)
  anchorApplied: false, // one-shot: a push re-render must never re-scroll/re-highlight
  lastReadSent: 0, // AS-25: highest read watermark POSTed for currentConv (keeps /api/read cheap)
  pins: new Set(), // AS-18: pinned roster actor ids for state.me (localStorage-backed)
  loopStatus: null, // AS-27: last /api/loop-status payload (null = unavailable)
  dashboardUrl: null, // AS-93: LATTICE_DASHBOARD_URL from /api/config (null = infer)
  lanes: null, // AS-99: last /api/lanes projection (null = we cannot see, badge shows a dash)
  // AS-103: lane key -> the last live activity frame for that lane, {text, at}.
  // Push-only and in-memory: it is seeded by NOTHING (no fetch, no
  // localStorage, no on-connect replay) because the frames are never stored
  // anywhere a seed could read them. Blank after a reload is the contract, not
  // a gap — see the `activity` listener and public/lanes.js describeActivity.
  activity: {},
};

// --- pins (AS-18) -----------------------------------------------------------
// A pin is a per-viewer, per-identity UI preference: localStorage only
// (key 'chat.pins.<me>'), never the chat DB, never the URL. Reads and writes
// are try/catch-wrapped (house pattern, see 'chat.me'); corrupt or missing
// storage degrades to "no pins", never a crash.

function loadPins(me) {
  if (!me) return new Set();
  let raw = null;
  try { raw = localStorage.getItem(`chat.pins.${me}`); } catch {}
  if (raw == null) return new Set();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  return new Set(sanitizePins(parsed));
}

function savePins(me, pins) {
  if (!me) return;
  try { localStorage.setItem(`chat.pins.${me}`, JSON.stringify([...pins])); } catch {}
}

// --- URL state (AS-9) -------------------------------------------------------
// The query string is a projection of actual view state: c=<channel|dm:id>,
// t=<thread root>, m=<anchor>. Identity NEVER goes in the URL. All history
// writes funnel through syncUrl; all reads happen in restoreFromUrl. Nothing
// else in this file touches `location` or `history`.

/** Conversation object -> the url-state selection shape (AS-9/AS-26). */
const convSelector = (conv) =>
  conv.type === 'dm' ? { kind: 'dm', id: conv.id } : { kind: 'channel', name: conv.name };

/** Modified click (cmd/ctrl/shift/alt/middle): let the real href win (AS-10). */
const isModifiedClick = (e) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1;

// AS-26: one neutral wording for every msg-ref failure — nonexistent and
// not-visible targets must be indistinguishable (parity invariant).
const MSG_UNAVAILABLE = "That message isn't available.";
const FILE_UNAVAILABLE = "That file isn't available.";
const ORG_UNAVAILABLE = "The org chart isn't available.";

function syncUrl(mode /* 'push' | 'replace' | 'none' */) {
  if (mode === 'none') return;
  const conv = state.currentConv;
  const next = serializeChatUrl(
    {
      conv: conv ? convSelector(conv) : null,
      thread: state.currentThreadRoot,
      msg: state.anchorMsg,
    },
    location.search
  );
  if (next === location.search) return; // no-op guard: never write an equal URL
  const url = next || location.pathname;
  if (mode === 'push') history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const post = (path, body) =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// AS-93: the ONE place a Lattice deep link is built. Thin on purpose — it is
// the only thing that knows about `window`, so dashboard-link.js stays pure
// and unit-testable. Every anchor that points at the dashboard goes through
// here; never hard-code a host or a port at a call site.
function dashHref(taskId) {
  return dashboardTaskHref(taskId, { location: window.location, override: state.dashboardUrl });
}

// --- rendering helpers (safe DOM building only) ---------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString()} ${time}`;
}

// --- body rendering: composed ref pipeline (AS-10 refs + AS-26 msg refs) ---
// Ref passes run per plain-text leaf in the order fixed by tokenizeLeaf in
// leaf-refs.js (AS-115): URLs, branches, AS-refs, msg-refs, file-refs, hashes.
// The order is a tested invariant there, not a control-flow accident here.
// All content via el()/createTextNode.

/** AS-n ref anchor (AS-10): plain click → task panel, modified → dashboard. */
function asRefLink(ref) {
  const a = el('a', 'ref-link', ref.shortId);
  a.href = dashHref(ref.taskId);
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = `${ref.title} — ${ref.status}`;
  a.addEventListener('click', (e) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    showTaskPanel(ref.shortId);
  });
  return a;
}

/** "msg 156" anchor (AS-26): render optimistically, resolve at click time. */
function msgRefLink(tok) {
  const a = el('a', 'ref-link msg-ref', tok.text);
  // Conversationless placeholder href — parseable, restore treats it as
  // unrequested; plain click (below) is the primary path.
  a.href = `?m=${tok.id}`;
  a.title = `msg ${tok.id}`;
  a.addEventListener('click', (e) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    goToMessage(tok.id).catch(() => alert(MSG_UNAVAILABLE));
  });
  return a;
}

/** Repo markdown reference (AS-26 §5): plain click opens the in-app viewer.
 *  No href in v1 — there is no standalone page for a file. */
function fileRefLink(tok) {
  const a = el('a', 'ref-link file-ref', tok.text);
  a.title = tok.path;
  a.addEventListener('click', (e) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    openFile(tok.path).catch(() => alert(FILE_UNAVAILABLE));
  });
  return a;
}

// AS-115: click-to-copy chips for commit hashes and branch names. A span, not
// an <a> and not a <button>: it flows and selects like prose, and there is
// nothing to navigate to — no href of any spelling, ever (the AS-93/AS-98
// link-site guards and test/copy-refs.test.js AC-17 keep it that way).
const COPIED_MS = 1200;

function selectNode(node) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.selectAllChildren(node);
}

function flashCopied(node) {
  node.classList.add('copied');
  node.title = 'Copied';
  clearTimeout(node._copiedTimer);
  node._copiedTimer = setTimeout(() => {
    node.classList.remove('copied');
    node.title = 'Click to copy';
  }, COPIED_MS);
}

/** Write `text` to the clipboard; fall back to selecting the chip so the
 *  user can Cmd/Ctrl-C (insecure contexts, or a refused write). */
function copyText(node, text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => flashCopied(node), () => selectNode(node));
  } else {
    selectNode(node);
  }
}

/** Copy chip for a hash or branch token: the payload is the tokenizer's exact
 *  source slice, never the DOM's textContent. */
function copyRefNode(tok) {
  const node = el('span', 'copy-ref', tok.text);
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.title = 'Click to copy';
  node.dataset.kind = tok.type;
  node.addEventListener('click', (e) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    copyText(node, tok.text);
  });
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    copyText(node, tok.text);
  });
  return node;
}

/** Bare-URL anchor (AS-54): plain external navigation, same affordance as a
 *  markdown link. The href is the verbatim matched slice — the tokenizer's
 *  http/https allowlist is the only gate, and nothing here transforms it. */
function urlLink(tok) {
  const a = el('a', 'md-link', tok.text); // el() sets textContent
  a.href = tok.href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

/** Append a plain-text leaf with every pass applied — tokenizeLeaf (leaf-refs.js)
 *  owns the order (URLs → branches → AS-refs → msg-refs → file-refs → hashes)
 *  and the terminal rule (a matched token's text never reaches a later pass).
 *  `autolink: false` (the markdown-link label call site) skips every pass that
 *  would create a clickable element with no server-resolved ref — URL, branch,
 *  hash — which keeps an anchor out of an anchor by construction. */
function appendRefLeaf(parent, text, refs, opts) {
  for (const tok of tokenizeLeaf(text, refs, opts)) {
    switch (tok.type) {
      case 'url': parent.appendChild(urlLink(tok)); break;
      case 'branch':
      case 'hash': parent.appendChild(copyRefNode(tok)); break;
      case 'asref': parent.appendChild(asRefLink(tok.ref)); break;
      case 'msgref': parent.appendChild(msgRefLink(tok)); break;
      case 'fileref': parent.appendChild(fileRefLink(tok)); break;
      default: parent.appendChild(document.createTextNode(tok.text));
    }
  }
}

/**
 * Body text as a structure-first pipeline (AS-26 §6): tokenizeInline over the
 * whole body, then the leaf passes over every plain-text leaf — top-level text
 * tokens AND the inner of strong/em/code/link tokens (so `**see msg 5**` is a
 * bold span containing a working link, and a backticked path is a code span
 * containing a working file ref). A markdown link's *inner* is the only leaf
 * that opts out of autolinking (AS-54): its href never reaches a pass at all,
 * and skipping the URL pass on its label is what keeps an `<a>` out of an
 * `<a>`. Zero innerHTML anywhere — tokenizers emit text and structure, never
 * markup.
 */
function bodyNode(message) {
  const div = el('div', 'body');
  const refs = (message.refs || []).filter((r) => r.exists);
  for (const tok of tokenizeInline(message.body)) {
    if (tok.type === 'text') {
      appendRefLeaf(div, tok.text, refs);
      continue;
    }
    if (tok.type === 'link') {
      const a = el('a', 'md-link');
      a.href = tok.href; // http/https only — the tokenizer's scheme allowlist
      a.target = '_blank';
      a.rel = 'noopener';
      appendRefLeaf(a, tok.inner, refs, { autolink: false });
      div.appendChild(a);
      continue;
    }
    const wrap = el(tok.type === 'strong' ? 'strong' : tok.type === 'em' ? 'em' : 'code');
    appendRefLeaf(wrap, tok.inner, refs);
    div.appendChild(wrap);
  }
  return div;
}

function displayName(id) {
  const opt = state.identityMap && state.identityMap[id];
  return opt ? opt.displayName : id;
}

function messageNode(m, { inThread = false } = {}) {
  const wrap = el('div', 'message');
  wrap.id = `msg-${m.id}`;
  const meta = el('div', 'meta');
  const author = el('span', 'author', displayName(m.authorId));
  if (m.authorId.startsWith('system:')) author.classList.add('kind-system');
  author.title = m.authorId;
  const time = el('span', 'time', fmtTime(m.createdAt));
  time.title = m.createdAt + ' (UTC)';
  // AS-26 §1: the visible message number IS the permalink anchor. href is the
  // canonical deep link built against an EMPTY search (foreign params are a
  // copy-link's problem, not ours): ?c=<conv>&m=<id>, plus t=<root> for
  // thread replies. Right-click → Copy Link gives a durable permalink;
  // plain click highlights in place and puts the permalink in the URL bar.
  const permalink = el('a', 'msg-permalink', `#${m.id}`);
  permalink.href = serializeChatUrl(
    { conv: convSelector(state.currentConv), thread: m.threadRootId ?? null, msg: m.id },
    ''
  );
  permalink.title = 'Permalink';
  permalink.addEventListener('click', (e) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    state.anchorMsg = m.id;
    state.anchorApplied = false;
    applyAnchor();
    syncUrl('push');
  });
  meta.append(author, time, permalink);
  if (!inThread) {
    const actions = el('span', 'actions');
    const replyBtn = el('button', null, 'reply in thread');
    replyBtn.addEventListener('click', () => openThread(m.id));
    actions.appendChild(replyBtn);
    meta.appendChild(actions);
  }
  wrap.append(meta, bodyNode(m));
  if (!inThread && m.replyCount > 0) wrap.appendChild(threadLinkNode(m.id, m.replyCount));
  return wrap;
}

/**
 * The "N replies" control under a root (AS-135: one factory, used by
 * messageNode on a rebuild and by the incremental reply-count patch when a
 * root gains its first reply; the label text has one source, replyLabel).
 */
function threadLinkNode(rootId, count) {
  const link = el('button', 'thread-link', replyLabel(count));
  link.addEventListener('click', () => openThread(rootId));
  return link;
}

// --- identity -------------------------------------------------------------

async function loadIdentities() {
  const { identities } = await api('/api/identities');
  state.identityMap = Object.fromEntries(identities.map((i) => [i.id, i]));
  const picker = $('#identity-picker');
  picker.replaceChildren(
    ...identities
      .filter((i) => i.kind !== 'system')
      .map((i) => {
        const opt = el('option', null, i.displayName);
        opt.value = i.id;
        return opt;
      })
  );
  let saved = null;
  try { saved = localStorage.getItem('chat.me'); } catch {}
  if (saved && state.identityMap[saved]) picker.value = saved;
  else if (state.identityMap[DEFAULT_IDENTITY]) picker.value = DEFAULT_IDENTITY;
  // Deliberately NOT persisted: a default is not a choice. Only an explicit
  // pick (the change handler in init()) writes localStorage['chat.me'].
  state.me = picker.value || null;
  state.pins = loadPins(state.me); // AS-18: pins are per-identity
}

// --- sidebar --------------------------------------------------------------

async function refreshSidebar() {
  if (!state.me) return;
  const meQ = encodeURIComponent(state.me);
  const { conversations } = await api(`/api/conversations?me=${meQ}`);
  state.conversations = conversations;
  // AS-8: roster rides the same refresh. Degradation contract: if the
  // endpoint fails (old compose file, missing mount), the roster is empty
  // and the sidebar falls back to DM-conversations-only — never a crash.
  try {
    state.roster = (await api(`/api/roster?me=${meQ}`)).roster;
  } catch {
    state.roster = [];
  }
  // AS-27: the loop indicator rides the same refresh, so the 60s reconcile and
  // the foreground catch-up both bring it current. No 'me': the answer is the
  // same for every viewer. Degradation contract: a failed fetch means "we do
  // not know", rendered as such — never a thrown sidebar refresh.
  try {
    state.loopStatus = (await api('/api/loop-status')).status;
  } catch {
    state.loopStatus = null;
  }
  // AS-99: and the lane projection, on the same terms — no 'me', and a failed
  // fetch means "we cannot see what is running" (badge: a dash), which is a
  // different statement from "nothing is running" (badge: 0).
  try {
    state.lanes = (await api('/api/lanes')).lanes;
  } catch {
    state.lanes = null;
  }
  renderSidebar();
}

// AS-27: the indicator, rendered from state alone. Pure DOM: every string
// comes from describeLoopStatus (public/loop-status.js) and lands via
// textContent — the label module never returns markup and this never parses
// any.
function renderLoopStatus() {
  const box = $('#loop-status');
  const labelEl = $('#loop-label');
  if (!box || !labelEl) return;
  const { tone, label, detail } = describeLoopStatus(state.loopStatus, Date.now());
  const dot = box.querySelector('.loop-dot');
  if (dot) dot.className = `loop-dot loop-dot--${tone}`;
  labelEl.textContent = label;
  box.title = detail;
}

// AS-25: pure re-render from state — push frames bump local badges and call
// this directly, no fetch. refreshSidebar (initial load, catch-up, the 60s
// reconcile poll) stays the authoritative fetch-then-render path.
function renderSidebar() {
  const conversations = state.conversations;
  const channels = conversations.filter((c) => c.type === 'channel');
  // Non-roster DMs render below the roster: DMs whose other member has no
  // active dossier (human:forrest, departed employees — history never disappears).
  const rosterIds = new Set(state.roster.map((r) => r.actorId));
  const otherOf = (c) => (c.members || []).find((m) => m !== state.me) || '';
  const dms = conversations
    .filter((c) => c.type === 'dm')
    .filter((c) => !rosterIds.has(otherOf(c)));
  const li = (conv) => {
    const item = el('li');
    // Private channels get a lock marker (members are the only ones who ever
    // receive them from the server — non-members never see the row at all).
    const label =
      conv.type === 'channel'
        ? `${conv.visibility === 'private' ? '🔒' : '#'} ${conv.name}`
        : displayName((conv.members || []).find((m) => m !== state.me) || '?');
    item.appendChild(el('span', null, label));
    if (conv.unread > 0) item.appendChild(el('span', 'badge', String(conv.unread)));
    if (state.currentConv && state.currentConv.id === conv.id) item.classList.add('active');
    item.addEventListener('click', () => selectConversation(conv));
    return item;
  };
  $('#channel-list').replaceChildren(...channels.map(li));
  // AS-18: ordering is a pure function of (roster, conversations, pins) —
  // push-frame badge bumps and the 60s reconcile re-sort identically, so
  // rows only move when pins or headcount change.
  $('#roster-list').replaceChildren(...rosterOrder(state.roster, state.pins).map(rosterRow));
  $('#dm-list').replaceChildren(
    ...dmOrder(dms, otherOf, (c) => displayName(otherOf(c) || '?')).map(li)
  );
  renderLoopStatus();
  renderLanesBadge(); // AS-99: the ambient count rides the same re-render
}

// --- roster rows (AS-8) -----------------------------------------------------
// Every active employee, DM or not. All content via textContent (house rule).

function rosterRow(emp) {
  const item = el('li', 'roster-row');
  const top = el('div', 'roster-top');
  const name = el('span', 'roster-name', emp.self ? `${emp.name} (you)` : emp.name);
  name.title = emp.title;
  top.appendChild(name);
  if (emp.unread > 0) top.appendChild(el('span', 'badge', String(emp.unread)));
  const status = el('div', 'roster-status');
  if (emp.work) {
    // Same affordance as AS-n refs in message bodies (AS-10): plain click →
    // in-app task panel, modified click / middle click → dashboard tab.
    const a = el('a', 'ref-link', emp.work.shortId);
    a.href = dashHref(emp.work.taskId);
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = `${emp.work.title} — ${emp.work.status}`;
    a.addEventListener('click', (e) => {
      e.stopPropagation(); // task link never opens the DM
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      e.preventDefault();
      showTaskPanel(emp.work.shortId);
    });
    status.appendChild(a);
    const more = emp.moreTasks > 0 ? ` (+${emp.moreTasks})` : '';
    status.appendChild(
      document.createTextNode(` · ${emp.work.status.replace('_', ' ')}${more}`)
    );
  } else {
    status.textContent = 'idle';
  }
  item.append(top);
  // AS-32: the title on its own line — a 240px column has no room for an
  // inline suffix beside the name, badge and pin. Empty title renders no
  // element at all (no blank line, no `title=""`).
  if (emp.title) {
    const role = el('div', 'roster-title', emp.title);
    role.title = emp.title; // the clipped text is where you hover for the full string
    item.append(role);
  }
  item.append(status);
  if (emp.self) {
    item.classList.add('self'); // inert: no click-to-DM with yourself
  } else {
    if (
      emp.dmConversationId != null &&
      state.currentConv &&
      state.currentConv.id === emp.dmConversationId
    ) {
      item.classList.add('active');
    }
    item.addEventListener('click', () => {
      openRosterDm(emp).catch((err) => alert(err.message));
    });
    // AS-18: always-visible pin toggle (hover-reveal is invisible on touch).
    // Self row gets none — you cannot DM yourself, so pinning it is noise.
    const pinned = state.pins.has(emp.actorId);
    if (pinned) item.classList.add('pinned');
    const pin = el('button', 'pin-toggle', pinned ? '★' : '☆');
    pin.type = 'button';
    pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    pin.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${emp.name}`);
    pin.addEventListener('click', (e) => {
      e.stopPropagation(); // toggling never opens the DM (ref-link pattern)
      state.pins = new Set(togglePin(state.pins, emp.actorId));
      savePins(state.me, state.pins);
      renderSidebar(); // pure re-render from state, no fetch (AS-25 style)
    });
    top.appendChild(pin);
  }
  return item;
}

/** Click-to-DM: get-or-create, auto-registering the dossier identity first
 *  when needed (mechanical bookkeeping — the dossier is the source of truth). */
async function openRosterDm(emp) {
  if (emp.dmConversationId != null) {
    const existing = state.conversations.find((c) => c.id === emp.dmConversationId);
    if (existing) return selectConversation(existing);
  }
  if (!emp.registered) {
    try {
      await post('/api/identities', {
        id: emp.actorId,
        displayName: emp.name,
        kind: emp.actorId.split(':')[0],
      });
    } catch (err) {
      // 409 race: already registered by a concurrent tab — proceed to the DM.
      if (!/already exists/.test(err.message)) throw err;
    }
    // Merge into the local identity map (for display names) without
    // rebuilding the picker — that could clobber the current selection.
    if (state.identityMap && !state.identityMap[emp.actorId]) {
      state.identityMap[emp.actorId] = {
        id: emp.actorId,
        displayName: emp.name,
        kind: emp.actorId.split(':')[0],
      };
      const opt = el('option', null, emp.name);
      opt.value = emp.actorId;
      $('#identity-picker').appendChild(opt);
    }
  }
  const { conversation } = await post('/api/dms', { me: state.me, other: emp.actorId });
  await refreshSidebar();
  await selectConversation(conversation);
}

// --- sidebar drawer (AS-23) -------------------------------------------------
// At <=700px the sidebar is an off-canvas drawer (CSS transform); above that
// width these classes are inert — the media query ignores them. Drawer state
// is VIEW-LOCAL: never in the URL (AS-9 projection invariant), never
// persisted. refreshSidebar() replaces children *inside* #sidebar, so the
// drawer-open class on #app survives every poll re-render.

function openDrawer() {
  $('#app').classList.add('drawer-open');
  $('#sidebar-scrim').hidden = false;
}

function closeDrawer() {
  $('#app').classList.remove('drawer-open');
  $('#sidebar-scrim').hidden = true;
}

// --- iOS keyboard / visible-area pin (AS-23) ---------------------------------
// No CSS unit (vh/dvh/svh) tracks the iOS on-screen keyboard — only
// window.visualViewport does. Pin #app's height to the visible area via the
// --app-height custom property; CSS falls back to 100dvh where visualViewport
// is absent. window.scrollTo(0,0) counters iOS's automatic pan-on-focus.

function wireViewportPin() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    document.documentElement.style.setProperty('--app-height', vv.height + 'px');
    window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', apply);
  apply();
}

// --- conversation view ----------------------------------------------------

/**
 * AS-25: render the current conversation from state.lastData — no fetch.
 * AS-135: this is the NAVIGATION rebuild (selectConversation is its one
 * caller); a live frame, a send echo or a catch-up row goes through
 * renderFrame instead and never replaces the pane's children.
 */
function renderConversation({ scroll = 'preserve' } = {}) {
  const data = state.lastData;
  if (!data || !state.currentConv) return;
  const c = data.conversation;
  $('#conv-title').textContent =
    c.type === 'channel'
      ? `${c.visibility === 'private' ? '🔒' : '#'} ${c.name}`
      : `DM with ${displayName((c.members || []).find((m) => m !== state.me) || '?')}`;
  $('#conv-purpose').textContent = c.purpose || '';
  const pane = $('#messages');
  // AS-17: navigation (scroll:'bottom') always lands at the newest message;
  // push/send re-renders (scroll:'preserve') are sticky-bottom — follow new
  // messages only when the reader was already at the bottom.
  renderPreservingScroll(pane, () => pane.replaceChildren(...paneChildren(data)), {
    forceBottom: scroll === 'bottom',
  });
  // Render the open thread BEFORE applying the anchor (AS-26): a reply
  // anchor's node exists only inside the thread pane.
  if (state.currentThreadRoot != null) renderThread();
  applyAnchor();
}

/**
 * The main pane's children for a payload: the "Load earlier messages"
 * control (AS-131; only while the server reports an older page — it covers a
 * first page too short to scroll), then the loaded top-level messages.
 */
function paneChildren(data) {
  const nodes = [];
  if (data.hasMore) {
    const btn = el('button', 'load-earlier', 'Load earlier messages');
    btn.type = 'button';
    btn.addEventListener('click', () => loadOlderPage());
    nodes.push(btn);
  }
  if (data.messages.length) nodes.push(...data.messages.map((m) => messageNode(m)));
  else nodes.push(el('div', 'empty-note', 'No messages yet.'));
  return nodes;
}

/**
 * AS-135: reflect ONE message that applyMessage just merged into
 * state.lastData — the path for SSE frames, the send echo and since= catch-up
 * rows. Inserts the node in id order into the main pane (top-level) or the
 * open thread pane (reply) under the sticky-bottom rule, and patches the
 * reply's root count in place; nothing else in the pane is touched, so the
 * m= highlight and every existing node survive. The anchor is one-shot
 * (applyAnchor no-ops unless pending) — kept here so a permalink whose
 * target arrives by frame still lands.
 */
function renderFrame(msg) {
  if (!state.lastData || !state.currentConv) return;
  applyFrameToPanes({
    data: state.lastData,
    msg,
    currentThreadRoot: state.currentThreadRoot,
    mainPane: $('#messages'),
    threadPane: $('#thread-messages'),
    nodeFor: messageNode,
    linkFor: threadLinkNode,
  });
  applyAnchor();
}

/** GET one page older than `before` (0 = the newest page) for `conv` (default: the open conversation). */
function fetchPage(before, conv = state.currentConv) {
  return api(
    `/api/messages?conversation=${conv.id}&me=${encodeURIComponent(state.me)}&before=${before ?? 0}&limit=${PAGE_SIZE}`
  );
}

/**
 * AS-131: merge the next older page in front of the loaded set and re-render
 * without moving the reader's row. Guarded: one fetch in flight, only while
 * the server reported hasMore, and dropped if the conversation changed while
 * the fetch was out (state.lastData is a fresh object per selectConversation).
 */
async function loadOlderPage() {
  const data = state.lastData;
  if (!data || !data.hasMore || state.loadingOlder) return;
  state.loadingOlder = true;
  try {
    const page = await fetchPage(data.nextBefore);
    if (state.lastData !== data) return;
    const added = mergeOlderPage(data, page);
    if (added || !data.hasMore) {
      const pane = $('#messages');
      prependPreservingScroll(pane, () => pane.replaceChildren(...paneChildren(data)));
    }
  } catch {
    // Transient failure: nothing merged; the next scroll-up / click retries.
  } finally {
    state.loadingOlder = false;
  }
}

/**
 * m= anchor, one-shot (AS-9, shared by both panes since AS-26): scroll to and
 * highlight whichever rendered pane contains msg-<id> — main conversation or
 * open thread modal. A push re-render never repeats it (anchorApplied); a
 * repeat anchor on the same node re-fires the highlight animation via
 * class-remove + forced reflow. Node not rendered anywhere (dead id, or a
 * reply whose thread isn't open): drop the param, AS-9 behavior.
 */
function applyAnchor() {
  if (state.anchorMsg == null || state.anchorApplied) return;
  const node = document.getElementById(`msg-${state.anchorMsg}`);
  if (!node) {
    state.anchorMsg = null;
    return;
  }
  state.anchorApplied = true;
  node.scrollIntoView({ block: 'center' });
  node.classList.remove('anchored');
  void node.offsetWidth; // force reflow so a re-added class restarts the animation
  node.classList.add('anchored');
}

/**
 * Open a conversation: fetch its newest page (AS-131), optionally page back
 * until `ensure` (a root or reply id a permalink / thread-open / msg-ref is
 * about to anchor on) is loaded, render, mark read.
 */
async function selectConversation(conv, { keepThread = false, url = 'push', scroll = 'bottom', ensure = null } = {}) {
  // AS-23: picking a conversation closes the drawer. Every user pick (sidebar
  // li, roster row, DM typeahead, new-channel) reaches here as url:'push';
  // URL restore comes in as url:'none' and must NOT slam a drawer the user
  // is browsing. Inert at desktop widths.
  if (url === 'push') closeDrawer();
  if (url === 'push') state.anchorMsg = null; // user navigation drops the m= anchor
  state.currentConv = conv;
  state.lastReadSent = 0; // new conversation, new watermark bookkeeping
  state.loadingOlder = false;
  if (!keepThread) closeThread({ url: 'none' });
  const data = await fetchPage(0, conv);
  // Decision 7: one direction of paging, one code path — page back for the
  // target BEFORE the first render, so applyAnchor / the t= root check see it.
  // A target past the 20-page cap simply is not loaded: the anchor drops as a
  // dead id does (AS-9).
  if (ensure != null) await ensureLoaded(data, ensure, (before) => fetchPage(before, conv));
  // The reader moved on while the pages were in flight: a stale open must
  // not overwrite the newer conversation's payload.
  if (state.currentConv !== conv) return;
  state.lastData = data;
  state.lastReadSent = maxLoadedId(data);
  renderConversation({ scroll });
  syncUrl(url);
  // Viewing marks read (advances the watermark to the newest message). No
  // upTo, deliberately: the server marks the conversation max, so a partial
  // page never leaves unread residue (AS-131 Decision 6).
  await post('/api/read', { me: state.me, conversation: conv.id }).catch(() => {});
  refreshSidebar().catch(() => {});
}

// --- threads --------------------------------------------------------------

function openThread(rootId, { url = 'push' } = {}) {
  if (url === 'push') state.anchorMsg = null; // navigation drops the m= anchor
  state.currentThreadRoot = rootId;
  $('#thread-modal').hidden = false; // AS-19: large modal, was the sidebar
  renderThread({ forceBottom: true }); // a freshly opened thread starts at its newest reply
  $('#thread-input').focus(); // a11y floor: focus enters the dialog on open
  syncUrl(url);
}

function closeThread({ url = 'push' } = {}) {
  if (url === 'push') state.anchorMsg = null;
  state.currentThreadRoot = null;
  $('#thread-modal').hidden = true;
  syncUrl(url);
}

function renderThread({ forceBottom = false } = {}) {
  const rootId = state.currentThreadRoot;
  if (rootId == null || !state.lastData) return;
  const root = state.lastData.messages.find((m) => m.id === rootId);
  const replies = (state.lastData.threads && state.lastData.threads[rootId]) || [];
  const label = state.currentConv.type === 'channel' ? state.currentConv.name : 'dm';
  $('#thread-title').textContent = `Thread ${label}#${rootId}`;
  const pane = $('#thread-messages');
  // AS-17: sticky-bottom — the 5s poll re-render must never yank a reader who
  // has scrolled up (the reported bug was an unconditional scroll-to-bottom here).
  renderPreservingScroll(
    pane,
    () =>
      pane.replaceChildren(
        ...(root ? [messageNode(root, { inThread: true })] : []),
        ...replies.map((m) => messageNode(m, { inThread: true }))
      ),
    { forceBottom }
  );
  // AS-26 §3: reply permalinks (?c&t&m) anchor inside the thread pane.
  applyAnchor();
}

// --- task panel -----------------------------------------------------------

async function showTaskPanel(shortId) {
  const { task } = await api(`/api/task/${encodeURIComponent(shortId)}`);
  $('#task-panel-code').textContent = shortId;
  const body = $('#task-panel-body');
  if (!task.exists) {
    body.replaceChildren(el('div', null, 'No such task.'));
  } else {
    const title = el('div', null, task.title);
    title.style.fontWeight = '600';
    const open = el('a', 'lattice-open', 'Open in Lattice ↗');
    open.href = dashHref(task.taskId);
    open.target = '_blank';
    open.rel = 'noopener';
    body.replaceChildren(title, el('span', 'status', task.status), el('div', 'task-id', task.taskId), open);
  }
  $('#task-panel').hidden = false;
}

// --- msg-ref navigation (AS-26) ---------------------------------------------
// Rendering is optimistic (every "msg N" is a link, zero render-time network);
// resolution happens at click time: local anchor when the target is already
// loaded, one /api/message/<id> call otherwise. Every failure — nonexistent,
// hidden, transient — collapses to the one neutral MSG_UNAVAILABLE wording.

/**
 * The loaded message with this id (top-level, or a reply whose root is a
 * loaded top-level row), or null. Same rule as ensureLoaded's stop condition
 * (live.js findLoaded): a live reply on a root outside the loaded pages is
 * not "loaded" — step 2 pages its root in before the thread opens.
 */
function findLoadedMessage(id) {
  return findLoaded(state.lastData, id);
}

async function goToMessage(id) {
  // 1. Target already in the loaded conversation: no network at all.
  const local = findLoadedMessage(id);
  if (local) {
    state.anchorMsg = id;
    state.anchorApplied = false;
    if (local.threadRootId != null && state.currentThreadRoot !== local.threadRootId) {
      openThread(local.threadRootId, { url: 'none' }); // renderThread applies the anchor
    } else {
      applyAnchor();
    }
    syncUrl('push');
    return;
  }
  // 2. Cross-conversation: resolve, then navigate with the anchor pre-set,
  // reusing the restore path's sequencing (anchor applies after the fetch
  // renders; thread replies open their thread first).
  let resolved;
  try {
    resolved = (await api(`/api/message/${id}?me=${encodeURIComponent(state.me)}`)).message;
  } catch {
    alert(MSG_UNAVAILABLE); // 404 and failure: byte-identical wording
    return;
  }
  let conv = state.conversations.find((c) => c.id === resolved.conversationId);
  if (!conv) {
    // Visible per the resolver but not in the (stale) sidebar list yet.
    await refreshSidebar().catch(() => {});
    conv = state.conversations.find((c) => c.id === resolved.conversationId);
  }
  if (!conv) {
    alert(MSG_UNAVAILABLE);
    return;
  }
  state.anchorMsg = resolved.threadRootId == null ? id : null;
  state.anchorApplied = false;
  // AS-131: the target may sit past the newest page — page back to its root.
  await selectConversation(conv, { url: 'none', ensure: resolved.threadRootId ?? id });
  if (resolved.threadRootId != null) {
    state.anchorMsg = id;
    state.anchorApplied = false;
    openThread(resolved.threadRootId, { url: 'none' });
  }
  syncUrl('push'); // one history entry for the whole navigation
}

// --- in-app file viewer (AS-26 §5) ------------------------------------------
// Repo markdown only, through the gated /api/file endpoint. View-local state:
// never in the URL (f= is explicitly out of scope in v1), never persisted.

/** Inline token -> DOM, styling only (viewer content gets no ref passes). */
function appendInlineToken(parent, tok) {
  if (tok.type === 'text') {
    parent.appendChild(document.createTextNode(tok.text));
  } else if (tok.type === 'link') {
    const a = el('a', 'md-link', tok.inner);
    a.href = tok.href;
    a.target = '_blank';
    a.rel = 'noopener';
    parent.appendChild(a);
  } else {
    parent.appendChild(el(tok.type === 'strong' ? 'strong' : tok.type === 'em' ? 'em' : 'code', null, tok.inner));
  }
}

function renderFileViewer(path, content) {
  $('#file-title').textContent = path;
  const nodes = [];
  for (const b of parseBlocks(content)) {
    if (b.type === 'heading') {
      // Styled divs, not real h1s — a viewed file must not outrank the app's
      // own document structure.
      nodes.push(el('div', `md-h${b.level}`, b.text));
    } else if (b.type === 'code') {
      const pre = el('pre', 'md-code-block');
      pre.appendChild(el('code', null, b.text));
      nodes.push(pre);
    } else {
      // Paragraph: hard line breaks preserved (pre-wrap), list lines render
      // as plain lines with their bullet characters intact (v1).
      const p = el('div', 'md-para');
      for (const tok of tokenizeInline(b.text)) appendInlineToken(p, tok);
      nodes.push(p);
    }
  }
  $('#file-body').replaceChildren(...nodes);
  $('#file-modal').hidden = false;
}

async function openFile(path) {
  let data;
  try {
    data = await api(`/api/file?path=${encodeURIComponent(path)}`);
  } catch {
    alert(FILE_UNAVAILABLE); // 404 and failure: byte-identical wording
    return;
  }
  renderFileViewer(data.path, data.content);
}

function closeFileModal() {
  $('#file-modal').hidden = true;
}

// --- org chart (AS-33) ------------------------------------------------------
// Derived live from /api/org on EVERY open — no cached artifact and no
// committed generated file, which is the hand-maintained-chart drift the org
// section of CLAUDE.md exists to prevent. Edit a dossier, reopen, see it.
//
// Structure-first like the rest of this file: buildOrgTree returns plain
// objects holding plain strings and knows nothing about the DOM; everything
// below is el() and createTextNode. Personnel files are repo-authored, which
// weakens the threat model and changes nothing about the mechanism — the
// value of the no-innerHTML rule is that it is absolute.

/** One <li> per employee, with a nested <ul> for their reports. */
function orgNodeItem(node) {
  const item = el('li');
  const row = el('div', 'org-node-row');
  if (node.actorId === BOARD_ROOT) row.classList.add('org-root');
  row.appendChild(el('span', 'org-node-name', node.name || node.actorId));
  const meta = [node.title, node.class, node.team].filter(Boolean).join(' \u00b7 ');
  if (meta) row.appendChild(el('span', 'org-node-meta', meta));
  item.appendChild(row);
  if (node.reports.length > 0) {
    const kids = el('ul', 'org-tree');
    kids.append(...node.reports.map(orgNodeItem));
    item.appendChild(kids);
  }
  return item;
}

/** Violations block, then the tree, then anyone the tree could not place. */
function renderOrgChart({ employees, violations }) {
  const { root, unplaced } = buildOrgTree(employees);
  const n = violations.length;
  $('#org-title').textContent =
    `Org chart \u2014 ${employees.length} active, ${n} violation${n === 1 ? '' : 's'}`;
  const nodes = [];

  if (n > 0) {
    nodes.push(el('div', 'org-section-title', `${n} violation${n === 1 ? '' : 's'}`));
    const list = el('ul', 'org-violation-list');
    for (const v of violations) {
      const li = el('li', 'org-violation');
      li.appendChild(el('span', 'org-violation-rule', v.rule));
      li.appendChild(document.createTextNode(` ${v.actorId || v.file || ''} \u2014 ${v.detail}`));
      list.appendChild(li);
    }
    nodes.push(list);
  } else {
    // A line, not an empty region: "nothing here" and "nothing checked" must
    // not look the same.
    nodes.push(el('div', 'org-ok', 'No violations.'));
  }

  if (employees.length === 0) {
    // Degradation: the board node still renders, with a reason beside it.
    nodes.push(
      el('div', 'org-empty', 'No active employees are visible \u2014 personnel/ may be unavailable.')
    );
  }

  const tree = el('ul', 'org-tree');
  tree.appendChild(orgNodeItem(root));
  nodes.push(tree);

  if (unplaced.length > 0) {
    // Nobody is ever dropped: an orphan or a cycle member shows up here rather
    // than vanishing from the picture.
    nodes.push(el('div', 'org-section-title', `Not placed (${unplaced.length})`));
    const list = el('ul', 'org-tree org-unplaced');
    list.append(...unplaced.map(orgNodeItem));
    nodes.push(list);
  }

  $('#org-body').replaceChildren(...nodes);
  $('#org-modal').hidden = false;
}

async function openOrgChart() {
  renderOrgChart(await api('/api/org'));
}

function closeOrgModal() {
  $('#org-modal').hidden = true;
}

// --- AS-99: lanes ----------------------------------------------------------
// What is in flight, one card per lane. Same doctrine as the org chart above:
// derived on every render from /api/lanes (the watcher's git snapshot joined to
// .lattice read live), never a cached artifact. Push frames ('lanes') and the
// 15 s render timer keep it current while it is open.

/** The ambient sidebar glance. A count, never a denominator — nothing on disk
 *  carries the WIP limit as data, so a "2/3" would be invented. */
function renderLanesBadge() {
  const badge = $('#lanes-badge');
  if (!badge) return;
  const { badge: text, title } = describeLanes(state.lanes, Date.now());
  badge.textContent = text;
  badge.title = title;
}

function laneField(label, value, className) {
  const row = el('div', `lane-field ${className || ''}`.trim());
  row.appendChild(el('span', 'lane-field-label', label));
  row.appendChild(el('span', 'lane-field-value', value));
  return row;
}

function laneCard(lane, nowMs, eventsReason = 'ok') {
  const card = el('div', 'lane-card');
  const c = describeLane(lane, nowMs, eventsReason);

  const head = el('header', 'lane-head');
  if (c.shortId) {
    // AS-93: the one dashboard-link helper, and the task panel on click — the
    // same anchor shape every other AS-<n> reference in this app uses.
    const a = el('a', 'lane-task ref-link', c.shortId);
    a.href = dashHref(c.taskId);
    a.target = '_blank';
    a.rel = 'noopener';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      showTaskPanel(c.shortId);
    });
    head.appendChild(a);
  } else {
    // LANES-UNKNOWN-TASK: a worktree with no join is never filtered out — its
    // existence is itself information — so the branch stands in for the id.
    head.appendChild(el('span', 'lane-task lane-task--unknown', c.taskText));
  }
  head.appendChild(el('span', 'lane-stage', c.stage));
  if (c.staleFlag) head.appendChild(el('span', 'lane-stale', c.staleText));
  card.appendChild(head);
  if (c.title) card.appendChild(el('div', 'lane-title', c.title));

  card.appendChild(laneField('Employee', c.employee));
  card.appendChild(laneField('Worktree', c.worktree, 'lane-mono'));
  card.appendChild(laneField('Branch', c.branch, 'lane-mono'));
  card.appendChild(laneField('Commits', c.ahead));
  card.appendChild(laneField('Working tree', c.dirty));
  card.appendChild(laneField('Last commit', c.lastCommit));
  if (c.errorsText) card.appendChild(laneField('git', c.errorsText, 'lane-errors'));

  // The two AS-100 slots: always rendered, never omitted, never styled as an
  // error. The tone class is the only styling difference — `alert` is the
  // stale-open / cut / unclosed family, which the board should be able to find
  // without reading every card; `none` keeps AS-99's placeholder tone.
  const liveClass = c.liveTone === 'none' ? 'lane-placeholder' : `lane-live lane-live--${c.liveTone}`;
  card.appendChild(laneField('Stage timer', c.stageTimer, liveClass));
  card.appendChild(laneField('Sub-agent', c.subAgent, liveClass));

  // AS-103's transient line, now with its producer. `state.activity` is fed by
  // the `activity` SSE listener alone; the three states (live / decayed /
  // blank) are decided in the label module, so this stays a two-liner. Blank
  // after a reload is correct and deliberate: the stream is strictly ephemeral
  // and there is nothing to replay.
  const now = describeActivity(lane && state.activity ? state.activity[lane.key] : null, nowMs);
  card.appendChild(el('div', `lane-now lane-now--${now.state}`, now.text));
  return card;
}

function renderLanes() {
  const body = $('#lanes-body');
  if (!body || $('#lanes-modal').hidden) return;
  const nowMs = Date.now();
  const view = describeLanes(state.lanes, nowMs);
  const nodes = [];

  // Whole-tick liveness, above the cards and labelled as whole-company: the
  // one honesty requirement the north-star comment states outright.
  const tick = describeTickLine(state.loopStatus, nowMs);
  const tickLine = el('div', 'lanes-tick');
  tickLine.appendChild(el('span', 'lanes-tick-text', tick.text));
  tickLine.appendChild(el('span', 'lanes-tick-caption', tick.caption));
  nodes.push(tickLine);
  nodes.push(el('div', `lanes-caption${view.stale ? ' lanes-caption--stale' : ''}`, view.caption));
  // AS-100: the event stream's own caption, separate from the snapshot's,
  // because either input can be degraded while the other is healthy.
  if (view.eventsCaption) nodes.push(el('div', 'lanes-caption lanes-caption--stale', view.eventsCaption));

  if (view.lanes.length === 0) {
    // The sentence comes from the label module, keyed off the snapshot REASON.
    // It is never re-derived here by comparing the badge string: a badge is a
    // rendering, and "0 lanes" and "git refused" render the same way the moment
    // anyone touches the badge (F1, cycle 1).
    nodes.push(el('div', 'lanes-empty', view.emptyText));
  } else {
    const list = el('div', 'lane-list');
    for (const lane of view.lanes) list.appendChild(laneCard(lane, nowMs, view.eventsReason));
    nodes.push(list);
  }
  body.replaceChildren(...nodes);
}

function openLanes() {
  $('#lanes-modal').hidden = false;
  renderLanes();
  // The badge and the pane read the same state; a fetch here only shortens the
  // gap to the next poll, and a failure leaves the last projection standing.
  refreshLanes().catch(() => {});
}

function closeLanesModal() {
  $('#lanes-modal').hidden = true;
}

async function refreshLanes() {
  try {
    state.lanes = (await api('/api/lanes')).lanes;
  } catch {
    state.lanes = null;
  }
  renderLanesBadge();
  renderLanes();
}

// --- DM typeahead (AS-6) ----------------------------------------------------
// Inline combobox over the already-loaded identity map — no new endpoint.
// Rendering stays textContent-only, like everything else in this file.

const typeahead = { options: [], active: -1 };

function dmCandidates(query) {
  const q = query.trim().toLowerCase();
  return Object.values(state.identityMap || {})
    .filter((i) => i.id !== state.me && i.kind !== 'system')
    .filter((i) => !q || i.displayName.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, 8);
}

function renderDmOptions() {
  const input = $('#dm-search');
  const list = $('#dm-options');
  list.replaceChildren(
    ...typeahead.options.map((ident, idx) => {
      const item = el('li', 'dm-option' + (idx === typeahead.active ? ' active' : ''));
      item.id = `dm-option-${idx}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', idx === typeahead.active ? 'true' : 'false');
      item.append(el('span', 'dm-option-name', ident.displayName), el('span', 'dm-option-id', ident.id));
      // mousedown (not click): fires before the input's blur closes the list.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickDmOption(ident.id);
      });
      return item;
    })
  );
  input.setAttribute('aria-expanded', typeahead.options.length > 0 ? 'true' : 'false');
  if (typeahead.active >= 0) input.setAttribute('aria-activedescendant', `dm-option-${typeahead.active}`);
  else input.removeAttribute('aria-activedescendant');
}

function updateDmOptions() {
  typeahead.options = dmCandidates($('#dm-search').value);
  typeahead.active = typeahead.options.length > 0 ? 0 : -1;
  renderDmOptions();
}

function openDmTypeahead() {
  const box = $('#dm-typeahead');
  box.hidden = false;
  const input = $('#dm-search');
  input.value = '';
  updateDmOptions();
  input.focus();
}

function closeDmTypeahead() {
  $('#dm-typeahead').hidden = true;
  $('#dm-options').replaceChildren();
  $('#dm-search').setAttribute('aria-expanded', 'false');
  typeahead.options = [];
  typeahead.active = -1;
}

async function pickDmOption(other) {
  closeDmTypeahead();
  try {
    const { conversation } = await post('/api/dms', { me: state.me, other });
    await refreshSidebar();
    await selectConversation(conversation);
  } catch (err) {
    alert(err.message);
  }
}

function wireDmTypeahead() {
  const input = $('#dm-search');
  $('#new-dm').addEventListener('click', () => {
    if ($('#dm-typeahead').hidden) openDmTypeahead();
    else closeDmTypeahead();
  });
  input.addEventListener('input', updateDmOptions);
  input.addEventListener('blur', () => closeDmTypeahead());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (typeahead.options.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      typeahead.active =
        (typeahead.active + delta + typeahead.options.length) % typeahead.options.length;
      renderDmOptions();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (typeahead.active >= 0) pickDmOption(typeahead.options[typeahead.active].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDmTypeahead();
    }
  });
}

// --- composers ------------------------------------------------------------

async function sendMessage(text, threadRoot) {
  if (!text.trim() || !state.currentConv) return;
  const { message } = await post('/api/messages', {
    conversation: state.currentConv.id,
    author: state.me,
    body: text,
    threadRoot: threadRoot ?? null,
  });
  // AS-25: no full-history refetch — the POST response merges through the
  // same idempotent applyMessage as live frames (our own SSE echo of this
  // message then dedupes by id). One node in, not navigation: never a history
  // write, never a scroll yank (AS-17), never a pane rebuild (AS-135).
  if (applyMessage(state.lastData, message)) {
    renderFrame(message);
    noteRead(message.id);
  }
}

function wireComposer(formSel, inputSel, getThreadRoot) {
  const form = $(formSel);
  const input = $(inputSel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    try {
      await sendMessage(text, getThreadRoot());
    } catch (err) {
      alert(err.message);
      input.value = text;
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

// --- URL restore (AS-9) -----------------------------------------------------

/** Default view ("Select a conversation"), optionally with a note in the pane. */
function resetMainPane(note) {
  state.currentConv = null;
  state.lastData = null;
  state.anchorMsg = null;
  state.lastReadSent = 0;
  state.loadingOlder = false;
  closeThread({ url: 'none' });
  $('#conv-title').textContent = 'Select a conversation';
  $('#conv-purpose').textContent = '';
  $('#messages').replaceChildren(...(note ? [el('div', 'empty-note', note)] : []));
}

/**
 * Parse the current URL and apply it to the view. Params resolve ONLY against
 * the viewer's own visibility-filtered conversation list — a nonexistent
 * channel, a hidden private channel, and a non-member DM all take this same
 * fail-soft path with zero network requests distinguishing them.
 *
 * mode 'load': initial restore — normalizes the URL via replaceState.
 * mode 'popstate': back/forward — applies the view; writes only to strip
 * params the view can't honor (replaceState, per the projection invariant).
 */
async function restoreFromUrl(mode) {
  const raw = new URLSearchParams(location.search);
  const requested = raw.has('c') || raw.has('t') || raw.has('m');
  const parsed = parseChatUrl(location.search);
  const conv = resolveConversation(parsed.conv, state.conversations);
  if (!conv) {
    if (requested) {
      // One neutral note, one code path, for every cause.
      resetMainPane("That conversation isn't available.");
      syncUrl('replace'); // strip dead params (foreign params preserved)
      refreshSidebar().catch(() => {});
    } else if (mode === 'popstate') {
      resetMainPane(); // back to '/': leave the conversation
      refreshSidebar().catch(() => {});
    }
    return;
  }
  // AS-26 §3: t and m compose — ?c&t&m is a reply permalink. When a thread is
  // requested, the anchor is set only AFTER openThread so renderThread (not
  // the main-pane render) applies it; a dead m inside the thread is dropped
  // by applyAnchor and stripped below.
  state.anchorMsg = parsed.thread != null ? null : parsed.msg;
  state.anchorApplied = false;
  try {
    // AS-131: a t= root or m= message older than the newest page is paged
    // in before the first render (bounded; a miss strips like a dead id).
    await selectConversation(conv, { url: 'none', ensure: parsed.thread ?? parsed.msg ?? null });
  } catch {
    // Listed a moment ago but gone now (e.g. deleted DB row): same fail-soft.
    resetMainPane("That conversation isn't available.");
    syncUrl('replace');
    refreshSidebar().catch(() => {});
    return;
  }
  if (parsed.thread != null) {
    // Resolved only against the fetched messages — never queried by id.
    const rootExists = (state.lastData?.messages || []).some((m) => m.id === parsed.thread);
    if (rootExists) {
      if (parsed.msg != null) {
        state.anchorMsg = parsed.msg;
        state.anchorApplied = false;
      }
      openThread(parsed.thread, { url: 'none' });
    }
    // Root miss: conversation stays open; the dead t (and its m) strip below.
  }
  syncUrl('replace'); // normalize form; no-op when the URL already matches
}

// --- push delivery (AS-25) --------------------------------------------------
// The server pushes every message it commits over GET /api/stream (SSE),
// gated per connection by visibility. The client merges frames — and the
// since= catch-up delta, and its own POST responses — through the single
// idempotent applyMessage (live.js). EventSource reconnects natively; on
// open-after-drop and on tab foregrounding we run explicit catch-up.

let eventSource = null;
let streamDropped = false; // set on error; the next 'open' is a reconnect

function connectStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (!state.me) return;
  streamDropped = false;
  eventSource = new EventSource(`/api/stream?me=${encodeURIComponent(state.me)}`);
  eventSource.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return; // a torn frame is the reconnect path's problem, not a crash
    }
    handleFrame(msg);
  });
  // AS-27: loop-status frames. Their own event name, so they never reach
  // handleFrame — this is server state, not a message, and it carries no
  // visibility gate because the answer is identical for every viewer.
  eventSource.addEventListener('loop', (e) => {
    let status;
    try {
      status = JSON.parse(e.data);
    } catch {
      return; // a torn frame is the reconnect path's problem, not a crash
    }
    state.loopStatus = status;
    renderLoopStatus();
    renderLanes(); // AS-99: the pane's tick line reads the same payload
  });
  // AS-99: lane frames. Same terms as the loop frame above — their own event
  // name, server state rather than a message, no visibility gate because the
  // answer is identical for every viewer. The server pushes only on change,
  // and one frame on connect, so this is the whole refresh path while open.
  eventSource.addEventListener('lanes', (e) => {
    let payload;
    try {
      payload = JSON.parse(e.data);
    } catch {
      return; // a torn frame is the reconnect path's problem, not a crash
    }
    state.lanes = payload && 'lanes' in payload ? payload.lanes : null;
    renderLanesBadge();
    renderLanes();
  });
  // AS-103: live tool-level activity. Its own event name, like `loop`, `lanes`
  // and `company` — but unlike all three it is a projection of nothing on disk.
  // There is no fetch beside it and no catch-up path: a frame missed (pane
  // closed, tab reloaded, connection dropped) is a frame gone, which is what
  // "live as it happens, it does not need persistence" means. The badge is
  // untouched — a count of lanes is not a count of tool calls.
  eventSource.addEventListener('activity', (e) => {
    let frame;
    try {
      frame = JSON.parse(e.data);
    } catch {
      return; // a torn frame is the reconnect path's problem, not a crash
    }
    if (!frame || typeof frame.key !== 'string' || !frame.key) return;
    state.activity[frame.key] = { text: frame.text, at: frame.at };
    renderLanes();
  });
  eventSource.addEventListener('open', () => {
    // First open: nothing missed. Open after a drop: the gap is unknown —
    // reconcile the sidebar and replay the open conversation's delta.
    if (streamDropped) {
      streamDropped = false;
      catchUp().catch(() => {});
    }
  });
  eventSource.addEventListener('error', () => {
    streamDropped = true; // EventSource retries by itself
  });
}

/** Advance the server read watermark, cheaply: at most one POST per new id. */
function noteRead(msgId) {
  if (!state.currentConv || msgId <= state.lastReadSent) return;
  state.lastReadSent = msgId;
  post('/api/read', { me: state.me, conversation: state.currentConv.id, upTo: msgId }).catch(() => {});
}

function handleFrame(msg) {
  const convId = msg.conversationId;
  if (state.currentConv && convId === state.currentConv.id) {
    // Open conversation: merge + insert one node (sticky scroll), mark read.
    // applyMessage no-ops if a conversation-switch fetch hasn't landed yet —
    // that fetch will include this message.
    if (applyMessage(state.lastData, msg)) {
      renderFrame(msg);
      noteRead(msg.id);
    }
    return;
  }
  const conv = state.conversations.find((c) => c.id === convId);
  if (!conv) {
    // Unknown conversation (brand-new channel, first DM message): one
    // authoritative refresh — closes the new-conversation gap without a
    // 'conversation' event type.
    refreshSidebar().catch(() => {});
    return;
  }
  // Known, unopened conversation: bump local badges (same author rule as
  // unreadCountFor) and re-render the sidebar from state — no fetch.
  if (msg.authorId !== state.me) {
    conv.unread = (conv.unread || 0) + 1;
    const rosterRowFor = state.roster.find((r) => r.dmConversationId === convId);
    if (rosterRowFor) rosterRowFor.unread = (rosterRowFor.unread || 0) + 1;
    renderSidebar();
  }
}

/**
 * Reconnect / foreground catch-up: authoritative sidebar (unread, roster,
 * new conversations) + the open conversation's since= delta, replayed
 * through the same applyMessage as frames. One merge code path.
 */
async function catchUp() {
  await refreshSidebar();
  if (!state.currentConv || !state.lastData) return;
  const since = maxLoadedId(state.lastData);
  const data = await api(
    `/api/messages?conversation=${state.currentConv.id}&me=${encodeURIComponent(state.me)}&since=${since}`
  );
  let latest = 0;
  let changed = false;
  // AS-135: a catch-up delta is N single-message frames — each merged row is
  // inserted on its own, so a scrolled-up reader is measured per insert and
  // never yanked, and the loaded rows keep their nodes.
  for (const m of data.messages) {
    if (applyMessage(state.lastData, m)) {
      renderFrame(m);
      changed = true;
    }
    if (m.id > latest) latest = m.id;
  }
  if (changed) noteRead(latest);
}

// --- wiring ---------------------------------------------------------------

async function init() {
  await loadIdentities();
  $('#identity-picker').addEventListener('change', async (e) => {
    state.me = e.target.value;
    try { localStorage.setItem('chat.me', state.me); } catch {}
    state.pins = loadPins(state.me); // AS-18: pins follow the identity
    resetMainPane();
    syncUrl('replace'); // identity switch clears the URL — never a history entry
    connectStream(); // AS-25: the stream is per-identity — tear down, reconnect
    await refreshSidebar();
  });

  $('#add-identity').addEventListener('click', async () => {
    const id = prompt("Identity id (e.g. 'agent:developer-marcus'):");
    if (!id) return;
    const displayName = prompt('Display name:');
    if (!displayName) return;
    const kind = id.split(':')[0];
    try {
      await post('/api/identities', { id, displayName, kind });
      await loadIdentities();
      $('#identity-picker').value = id;
      $('#identity-picker').dispatchEvent(new Event('change'));
    } catch (err) {
      alert(err.message);
    }
  });

  $('#new-channel').addEventListener('click', async () => {
    const name = prompt('Channel name (lowercase, digits, hyphens):');
    if (!name) return;
    const purpose = prompt('One-line purpose (optional):') || null;
    try {
      const { conversation } = await post('/api/channels', { name, purpose, actor: state.me });
      await refreshSidebar();
      await selectConversation(conversation);
    } catch (err) {
      alert(err.message);
    }
  });

  wireDmTypeahead();

  // AS-131: scrolling near the top of the conversation loads the next older
  // page; loadOlderPage's own guards (hasMore, one in flight) make a debounce
  // unnecessary. The "Load earlier messages" button covers a first page too
  // short to scroll.
  const messagesPane = $('#messages');
  messagesPane.addEventListener('scroll', () => {
    if (messagesPane.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlderPage();
  });

  $('#thread-close').addEventListener('click', () => closeThread());
  // AS-19: backdrop click closes — only when the click lands on the overlay
  // itself; clicks inside the dialog bubble up with a different target.
  // AS-23: ...and only when the gesture BEGAN on the backdrop too. A text-
  // selection drag that starts in the dialog and releases on the backdrop
  // dispatches click on #thread-modal (the common ancestor) — recording the
  // pointerdown target lets the predicate tell the two apart.
  let threadPointerDown = null;
  $('#thread-modal').addEventListener('pointerdown', (e) => {
    threadPointerDown = e.target;
  });
  $('#thread-modal').addEventListener('click', (e) => {
    const down = threadPointerDown;
    threadPointerDown = null; // one gesture, one answer
    if (shouldCloseOnBackdropGesture(e, down)) closeThread();
  });
  // AS-26 §5: file viewer close wiring (button + Esc; no backdrop gesture —
  // the plan scopes dismissal to those two).
  $('#file-close').addEventListener('click', () => closeFileModal());
  // AS-33: the org chart re-derives on every open, so there is no refresh path
  // to maintain and no stale render after a dossier edit.
  $('#org-chart-open').addEventListener('click', () => {
    openOrgChart().catch(() => alert(ORG_UNAVAILABLE));
  });
  $('#org-close').addEventListener('click', () => closeOrgModal());
  // AS-99: the lanes pane re-derives on every open and on every push frame, so
  // there is no cached render to invalidate.
  $('#lanes-open').addEventListener('click', () => openLanes());
  $('#lanes-close').addEventListener('click', () => closeLanesModal());
  // AS-19: document-level Escape, live only while the modal is visible.
  // defaultPrevented is respected so the DM typeahead's own Escape (which
  // preventDefaults on its input before the event reaches document) wins.
  // AS-26: the file viewer stacks above the thread modal — Esc closes the
  // top-most one only.
  // AS-33: the checks run in DESCENDING z-index order — org (36), file (35),
  // thread (30) — so Escape always closes the top-most overlay. The org modal
  // cannot in practice sit under the file viewer (its opener is in the
  // sidebar, which a full-screen backdrop covers), but the handler should read
  // the way the z-order inventory does, so the next overlay has a rule to
  // follow instead of a precedent to guess at.
  // AS-99: lanes (37) sits above org (36) in the same descending-z-order chain.
  document.addEventListener('keydown', (e) => {
    if (shouldCloseOnEscape(e, $('#lanes-modal').hidden)) {
      closeLanesModal();
      return;
    }
    if (shouldCloseOnEscape(e, $('#org-modal').hidden)) {
      closeOrgModal();
      return;
    }
    if (shouldCloseOnEscape(e, $('#file-modal').hidden)) {
      closeFileModal();
      return;
    }
    if (shouldCloseOnEscape(e, $('#thread-modal').hidden)) closeThread();
  });
  $('#task-panel-close').addEventListener('click', () => ($('#task-panel').hidden = true));
  wireComposer('#composer', '#composer-input', () => null);
  wireComposer('#thread-composer', '#thread-input', () => state.currentThreadRoot);

  // AS-23: sidebar drawer wiring (inert above 700px — the CSS ignores the
  // class there) + the visualViewport keyboard pin.
  $('#sidebar-toggle').addEventListener('click', () => {
    if ($('#app').classList.contains('drawer-open')) closeDrawer();
    else openDrawer();
  });
  $('#sidebar-scrim').addEventListener('click', () => closeDrawer());
  wireViewportPin();

  // AS-93: the operator's LATTICE_DASHBOARD_URL, if any, before anything
  // renders an href (the roster does). Degradation contract: an unknown
  // override means inference, never a crash — and inference is the right
  // answer in every deployment that has not set the variable.
  try {
    state.dashboardUrl = (await api('/api/config')).config.latticeDashboardUrl ?? null;
  } catch {
    state.dashboardUrl = null;
  }

  await refreshSidebar();

  // AS-9: restore view from the URL (after identity + conversation list are
  // loaded, before the poll starts). Back/forward re-applies without writing.
  await restoreFromUrl('load');
  window.addEventListener('popstate', () => restoreFromUrl('popstate').catch(() => {}));

  // AS-23: one-time empty-state nicety — a phone user with no conversation
  // selected lands on the channel list, not a blank pane. View-local: never
  // reflected in the URL, never repeated by the poll.
  if (!state.currentConv && window.matchMedia && window.matchMedia('(max-width: 700px)').matches) {
    openDrawer();
  }

  // AS-25: push replaces the old 5s full-refetch poll. Live delivery comes
  // over SSE; connect after identity + sidebar are loaded.
  connectStream();

  // Foregrounding (the iOS path — Safari kills background connections no
  // matter the transport): reconcile + replay the delta explicitly.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') catchUp().catch(() => {});
  });

  // 60s reconcile poll — sidebar only, never the message history. Covers
  // what push has no event source for: roster/work-status changes (Lattice
  // files change outside the chat DB), cross-device markRead drift, and it
  // keeps the server's lattice-ingest throttle ticking. Never writes the URL.
  setInterval(() => {
    refreshSidebar().catch(() => {});
  }, 60_000);

  // AS-27: local age tick. Issues NO request — it only re-renders the strings
  // describeLoopStatus derives from the timestamps already in state, so
  // "started 3 min ago" stays true between push frames. State changes arrive
  // over SSE; this timer can never invent one.
  // AS-99 rides the same timer for the same reason: snapshot age and commit
  // age are recomputed locally from the timestamps already in state.
  setInterval(() => {
    renderLoopStatus();
    renderLanesBadge();
    renderLanes();
  }, 15_000);
}

init().catch((err) => {
  document.body.replaceChildren(el('pre', null, `Failed to start: ${err.message}`));
});
