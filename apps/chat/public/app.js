// ASC Chat UI — vanilla JS (ES module), zero external requests.
// Rendering rule: ALL user content goes through textContent (never innerHTML).

import { parseChatUrl, serializeChatUrl, resolveConversation } from './url-state.js';
import { renderPreservingScroll } from './scroll.js';
import { shouldCloseOnEscape, shouldCloseOnBackdropGesture } from './thread-modal.js';

const $ = (sel) => document.querySelector(sel);

// AS-17: who the picker lands on when localStorage has no (valid) saved pick.
// Seeded in lib/store.js; if ever absent, degrades to the first option.
const DEFAULT_IDENTITY = 'human:forrest';

const state = {
  me: null,
  conversations: [],
  roster: [], // AS-8: active employees from /api/roster (empty on degradation)
  currentConv: null, // conversation object
  currentThreadRoot: null, // message id
  lastData: null, // last /api/messages payload for current conversation
  anchorMsg: null, // m= message anchor currently reflected in the URL (AS-9)
  anchorApplied: false, // one-shot: the 5s poll must never re-scroll/re-highlight
};

// --- URL state (AS-9) -------------------------------------------------------
// The query string is a projection of actual view state: c=<channel|dm:id>,
// t=<thread root>, m=<anchor>. Identity NEVER goes in the URL. All history
// writes funnel through syncUrl; all reads happen in restoreFromUrl. Nothing
// else in this file touches `location` or `history`.

function syncUrl(mode /* 'push' | 'replace' | 'none' */) {
  if (mode === 'none') return;
  const conv = state.currentConv;
  const next = serializeChatUrl(
    {
      conv: conv
        ? conv.type === 'dm'
          ? { kind: 'dm', id: conv.id }
          : { kind: 'channel', name: conv.name }
        : null,
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

/** Body text with AS-n refs turned into safe link elements. */
function bodyNode(message) {
  const div = el('div', 'body');
  const refs = (message.refs || []).filter((r) => r.exists);
  if (refs.length === 0) {
    div.textContent = message.body;
    return div;
  }
  const codes = refs.map((r) => r.shortId);
  const re = new RegExp(`\\b(${codes.join('|')})\\b`, 'g');
  let last = 0;
  for (const m of message.body.matchAll(re)) {
    div.appendChild(document.createTextNode(message.body.slice(last, m.index)));
    const ref = refs.find((r) => r.shortId === m[0]);
    const a = el('a', 'ref-link', m[0]);
    // Real href to the Lattice dashboard (AS-10): copy-link and modified
    // clicks (cmd/ctrl/shift/alt/middle) go to the dashboard in a new tab;
    // a plain click keeps the in-app task panel.
    a.href = ref.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = `${ref.title} — ${ref.status}`;
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      e.preventDefault();
      showTaskPanel(ref.shortId);
    });
    div.appendChild(a);
    last = m.index + m[0].length;
  }
  div.appendChild(document.createTextNode(message.body.slice(last)));
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
  meta.append(author, time);
  if (!inThread) {
    const actions = el('span', 'actions');
    const replyBtn = el('button', null, 'reply in thread');
    replyBtn.addEventListener('click', () => openThread(m.id));
    actions.appendChild(replyBtn);
    meta.appendChild(actions);
  }
  wrap.append(meta, bodyNode(m));
  if (!inThread && m.replyCount > 0) {
    const link = el('button', 'thread-link', `${m.replyCount} ${m.replyCount === 1 ? 'reply' : 'replies'}`);
    link.addEventListener('click', () => openThread(m.id));
    wrap.appendChild(link);
  }
  return wrap;
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
  const channels = conversations.filter((c) => c.type === 'channel');
  // Non-roster DMs render below the roster: DMs whose other member has no
  // active dossier (human:forrest, departed employees — history never disappears).
  const rosterIds = new Set(state.roster.map((r) => r.actorId));
  const dms = conversations
    .filter((c) => c.type === 'dm')
    .filter((c) => !rosterIds.has((c.members || []).find((m) => m !== state.me)));
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
  $('#roster-list').replaceChildren(...state.roster.map(rosterRow));
  $('#dm-list').replaceChildren(...dms.map(li));
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
    a.href = emp.work.url;
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
  item.append(top, status);
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

// --- conversation view ----------------------------------------------------

async function selectConversation(conv, { keepThread = false, url = 'push', scroll = 'bottom' } = {}) {
  if (url === 'push') state.anchorMsg = null; // user navigation drops the m= anchor
  state.currentConv = conv;
  if (!keepThread) closeThread({ url: 'none' });
  const data = await api(`/api/messages?conversation=${conv.id}&me=${encodeURIComponent(state.me)}`);
  state.lastData = data;
  const c = data.conversation;
  $('#conv-title').textContent =
    c.type === 'channel'
      ? `${c.visibility === 'private' ? '🔒' : '#'} ${c.name}`
      : `DM with ${displayName((c.members || []).find((m) => m !== state.me) || '?')}`;
  $('#conv-purpose').textContent = c.purpose || '';
  const pane = $('#messages');
  // AS-17: navigation (scroll:'bottom') always lands at the newest message;
  // poll/send re-renders (scroll:'preserve') are sticky-bottom — follow new
  // messages only when the reader was already at the bottom.
  renderPreservingScroll(
    pane,
    () =>
      pane.replaceChildren(
        ...(data.messages.length
          ? data.messages.map((m) => messageNode(m))
          : [el('div', 'empty-note', 'No messages yet.')])
      ),
    { forceBottom: scroll === 'bottom' }
  );
  // m= anchor: one-shot scroll + highlight — the poll re-render never repeats it.
  if (state.anchorMsg != null && !state.anchorApplied) {
    state.anchorApplied = true;
    const node = document.getElementById(`msg-${state.anchorMsg}`);
    if (node) {
      node.scrollIntoView({ block: 'center' });
      node.classList.add('anchored');
    } else {
      state.anchorMsg = null; // not in this conversation's messages: drop the param
    }
  }
  if (state.currentThreadRoot != null) renderThread();
  syncUrl(url);
  // Viewing marks read (advances the watermark to the newest message).
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
    open.href = task.url;
    open.target = '_blank';
    open.rel = 'noopener';
    body.replaceChildren(title, el('span', 'status', task.status), el('div', 'task-id', task.taskId), open);
  }
  $('#task-panel').hidden = false;
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
  await post('/api/messages', {
    conversation: state.currentConv.id,
    author: state.me,
    body: text,
    threadRoot: threadRoot ?? null,
  });
  // Re-render, not navigation: never a history write, never a scroll yank —
  // your message lands below without moving a scrolled-up pane (AS-17).
  await selectConversation(state.currentConv, { keepThread: true, url: 'none', scroll: 'preserve' });
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
  // Per the grammar, m is ignored when t is present.
  state.anchorMsg = parsed.thread != null ? null : parsed.msg;
  state.anchorApplied = false;
  try {
    await selectConversation(conv, { url: 'none' });
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
    if (rootExists) openThread(parsed.thread, { url: 'none' });
    // Miss: conversation stays open, the dead t param is stripped below.
  }
  syncUrl('replace'); // normalize form; no-op when the URL already matches
}

// --- wiring ---------------------------------------------------------------

async function init() {
  await loadIdentities();
  $('#identity-picker').addEventListener('change', async (e) => {
    state.me = e.target.value;
    try { localStorage.setItem('chat.me', state.me); } catch {}
    resetMainPane();
    syncUrl('replace'); // identity switch clears the URL — never a history entry
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
  // AS-19: document-level Escape, live only while the modal is visible.
  // defaultPrevented is respected so the DM typeahead's own Escape (which
  // preventDefaults on its input before the event reaches document) wins.
  document.addEventListener('keydown', (e) => {
    if (shouldCloseOnEscape(e, $('#thread-modal').hidden)) closeThread();
  });
  $('#task-panel-close').addEventListener('click', () => ($('#task-panel').hidden = true));
  wireComposer('#composer', '#composer-input', () => null);
  wireComposer('#thread-composer', '#thread-input', () => state.currentThreadRoot);

  await refreshSidebar();

  // AS-9: restore view from the URL (after identity + conversation list are
  // loaded, before the poll starts). Back/forward re-applies without writing.
  await restoreFromUrl('load');
  window.addEventListener('popstate', () => restoreFromUrl('popstate').catch(() => {}));

  // Polling: localhost refresh for the open tab; 5s cadence. Never writes the URL.
  setInterval(() => {
    refreshSidebar().catch(() => {});
    if (state.currentConv)
      selectConversation(state.currentConv, { keepThread: true, url: 'none', scroll: 'preserve' }).catch(() => {});
  }, 5000);
}

init().catch((err) => {
  document.body.replaceChildren(el('pre', null, `Failed to start: ${err.message}`));
});
