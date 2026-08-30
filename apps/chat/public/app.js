// ASC Chat UI — vanilla JS, zero external requests.
// Rendering rule: ALL user content goes through textContent (never innerHTML).

'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  conversations: [],
  currentConv: null, // conversation object
  currentThreadRoot: null, // message id
  lastData: null, // last /api/messages payload for current conversation
};

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
    a.href = '#';
    a.title = `${ref.title} — ${ref.status}`;
    a.addEventListener('click', (e) => {
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
  state.me = picker.value || null;
}

// --- sidebar --------------------------------------------------------------

async function refreshSidebar() {
  if (!state.me) return;
  const { conversations } = await api(`/api/conversations?me=${encodeURIComponent(state.me)}`);
  state.conversations = conversations;
  const channels = conversations.filter((c) => c.type === 'channel');
  const dms = conversations.filter((c) => c.type === 'dm');
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
  $('#dm-list').replaceChildren(...dms.map(li));
}

// --- conversation view ----------------------------------------------------

async function selectConversation(conv, { keepThread = false } = {}) {
  state.currentConv = conv;
  if (!keepThread) closeThread();
  const data = await api(`/api/messages?conversation=${conv.id}&me=${encodeURIComponent(state.me)}`);
  state.lastData = data;
  const c = data.conversation;
  $('#conv-title').textContent =
    c.type === 'channel'
      ? `${c.visibility === 'private' ? '🔒' : '#'} ${c.name}`
      : `DM with ${displayName((c.members || []).find((m) => m !== state.me) || '?')}`;
  $('#conv-purpose').textContent = c.purpose || '';
  const pane = $('#messages');
  const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
  pane.replaceChildren(
    ...(data.messages.length
      ? data.messages.map((m) => messageNode(m))
      : [el('div', 'empty-note', 'No messages yet.')])
  );
  if (atBottom) pane.scrollTop = pane.scrollHeight;
  if (state.currentThreadRoot != null) renderThread();
  // Viewing marks read (advances the watermark to the newest message).
  await post('/api/read', { me: state.me, conversation: conv.id }).catch(() => {});
  refreshSidebar().catch(() => {});
}

// --- threads --------------------------------------------------------------

function openThread(rootId) {
  state.currentThreadRoot = rootId;
  $('#thread-panel').hidden = false;
  location.hash = `msg-${rootId}`;
  renderThread();
}

function closeThread() {
  state.currentThreadRoot = null;
  $('#thread-panel').hidden = true;
  if (location.hash) history.replaceState(null, '', location.pathname);
}

function renderThread() {
  const rootId = state.currentThreadRoot;
  if (rootId == null || !state.lastData) return;
  const root = state.lastData.messages.find((m) => m.id === rootId);
  const replies = (state.lastData.threads && state.lastData.threads[rootId]) || [];
  const label = state.currentConv.type === 'channel' ? state.currentConv.name : 'dm';
  $('#thread-title').textContent = `Thread ${label}#${rootId}`;
  const pane = $('#thread-messages');
  pane.replaceChildren(
    ...(root ? [messageNode(root, { inThread: true })] : []),
    ...replies.map((m) => messageNode(m, { inThread: true }))
  );
  pane.scrollTop = pane.scrollHeight;
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
    body.replaceChildren(title, el('span', 'status', task.status), el('div', 'task-id', task.taskId));
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
  await selectConversation(state.currentConv, { keepThread: true });
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

// --- wiring ---------------------------------------------------------------

async function init() {
  await loadIdentities();
  $('#identity-picker').addEventListener('change', async (e) => {
    state.me = e.target.value;
    try { localStorage.setItem('chat.me', state.me); } catch {}
    state.currentConv = null;
    closeThread();
    $('#conv-title').textContent = 'Select a conversation';
    $('#conv-purpose').textContent = '';
    $('#messages').replaceChildren();
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

  $('#thread-close').addEventListener('click', closeThread);
  $('#task-panel-close').addEventListener('click', () => ($('#task-panel').hidden = true));
  wireComposer('#composer', '#composer-input', () => null);
  wireComposer('#thread-composer', '#thread-input', () => state.currentThreadRoot);

  await refreshSidebar();

  // Polling: localhost refresh for the open tab; 5s cadence.
  setInterval(() => {
    refreshSidebar().catch(() => {});
    if (state.currentConv) selectConversation(state.currentConv, { keepThread: true }).catch(() => {});
  }, 5000);
}

init().catch((err) => {
  document.body.replaceChildren(el('pre', null, `Failed to start: ${err.message}`));
});
