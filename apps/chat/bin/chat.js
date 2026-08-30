#!/usr/bin/env node
// bin/chat.js — agent-facing CLI for the chat app (AS-2, reworked in AS-24).
//
// Mode resolution (AS-24): while a chat server is up, the server is the single
// reader/writer of the shared DB — a host-side open of the same file can see
// (and write) a divergent WAL view across the Docker bind mount (verified:
// orphan message 161). So the CLI decides ONCE per invocation, before any
// store open, whether to proxy every command through the server HTTP API or
// to open the DB file directly — and refuses loudly whenever it cannot
// positively establish that no server is listening. In API mode this process
// never opens a DB file at all.
//
// Precedence:
//   1. CHAT_MODE=api    — API mode; unreachable server is a loud error.
//   2. CHAT_MODE=direct — direct mode, no probe (operator/offline escape
//                         hatch; you own the divergence risk).
//   3. CHAT_API set     — probe it: up → API mode; connection-refused/
//                         not-found → direct; anything else → loud refusal.
//   4. CHAT_DB set (no CHAT_API) — direct mode, no probe: an explicit
//                         alternate store is by definition not the DB the
//                         server owns (keeps the test suite hermetic).
//   5. neither          — probe http://127.0.0.1:8347, as in 3.

import { resolve, dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore, StoreError, EVENTS_CHANNEL } from '../lib/store.js';
import { probe, createApiBackend, DEFAULT_API } from '../lib/client.js';
import { ingestNewEvents, resolveRefs, resolveShortId, latticeRoot, assignmentsByActor } from '../lib/lattice.js';
import { readRoster } from '../lib/personnel.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = join(APP_DIR, 'data', 'chat.db');

const USAGE = `usage: chat <command> [args] [--me <identity>] [--json]

  channels                            list channels and DMs with unread counts
  create-channel <name> [--purpose "…"] [--visibility public|private --members <id,id,…>]
                                      create a channel (public by default)
  post <channel> "<body>"             post a top-level message
  dm <identity> "<body>"              get-or-create a DM, post into it
  reply <conv>#<msgid> "<body>"       thread reply (e.g. reply engineering#42 "…")
  history <channel|@identity>         show a conversation [--limit N] [--threads]
  inbox                               ingest lattice events, then print everything unread
  read <channel|@identity>            mark one conversation read
  catchup                             mark everything read
  roster                              company roster with current work status
                                      (add --me for DM ids/unread)
  register <id> "<display name>" --kind agent|human|system
  sync                                run lattice event ingestion
  dump                                full store as JSONL on stdout
  export [--out <dir>]                append-only JSONL export of identities,
                                      conversations, messages (default dir:
                                      <data>/export; deterministic, AS-5)

  --me <identity> (or CHAT_ME env var) identifies you; --json for machine output.
  Backend (AS-24): auto — proxies via the chat server when one is reachable
  ($CHAT_API or http://127.0.0.1:8347), opens the DB directly only when no
  server is provably listening or $CHAT_DB names an alternate store.
  Override with CHAT_MODE=api|direct. DB: $CHAT_DB or apps/chat/data/chat.db`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--threads') args.flags[a.slice(2)] = true;
    else if (a === '--me' || a === '--purpose' || a === '--kind' || a === '--limit' || a === '--out' || a === '--visibility' || a === '--members') {
      args.flags[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) fail(`Unknown flag '${a}'.\n\n${USAGE}`);
    else args._.push(a);
  }
  return args;
}

function fail(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

function out(s) {
  process.stdout.write(s + '\n');
}

function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtRefs(body, root) {
  const refs = resolveRefs(body, root).filter((r) => r.exists);
  if (refs.length === 0) return '';
  return '  ' + refs.map((r) => `[${r.shortId} "${r.title}" — ${r.status}]`).join(' ');
}

function convLabel(conv, me) {
  if (conv.type === 'channel' || conv.name) return `#${conv.name}`;
  const members = conv.members ?? [];
  const other = members.find((m) => m !== me) ?? members.join('|');
  return `@${other}`;
}

// --- mode resolution (AS-24) -------------------------------------------------

const REFUSAL = (base) =>
  `chat: something is listening at ${base} but the probe failed; refusing to touch the shared DB directly — host-side access can silently fork it (AS-24). If the server is really down, retry or set CHAT_MODE=direct.`;

/**
 * One mode decision per invocation, before any store open. Returns a backend;
 * every command then runs entirely against that one backend. Ambiguous probe
 * outcomes exit 1 loudly with zero side effects — silent divergence was the
 * AS-24 failure mode, so ambiguity never falls back to the DB file.
 * Empty-string env vars count as unset (compose passthrough convention).
 */
async function resolveBackend() {
  const mode = process.env.CHAT_MODE || null;
  const api = process.env.CHAT_API || null;
  const db = process.env.CHAT_DB || null;

  if (mode && mode !== 'api' && mode !== 'direct') {
    fail(`chat: invalid CHAT_MODE '${mode}' — use 'api' or 'direct' (AS-24).`);
  }
  if (mode === 'api') {
    const base = api || DEFAULT_API;
    if ((await probe(base)) !== 'up') {
      fail(
        `chat: CHAT_MODE=api but the probe of ${base} failed; no direct-DB fallback in api mode (AS-24). Start the server (docker compose up -d) or unset CHAT_MODE.`
      );
    }
    return createApiBackend(base);
  }
  if (mode === 'direct') return createDirectBackend(db || DEFAULT_DB);
  if (api) {
    const result = await probe(api);
    if (result === 'up') return createApiBackend(api);
    if (result === 'down') return createDirectBackend(db || DEFAULT_DB);
    fail(REFUSAL(api));
  }
  if (db) return createDirectBackend(db); // explicit alternate store: provably not the server's DB
  const result = await probe(DEFAULT_API);
  if (result === 'up') return createApiBackend(DEFAULT_API);
  if (result === 'down') return createDirectBackend(DEFAULT_DB);
  fail(REFUSAL(DEFAULT_API));
}

/**
 * Direct-mode backend: the pre-AS-24 behavior, store opened synchronously,
 * same method surface as lib/client.js's API backend (methods async-compatible
 * — callers await them; these return plain values, which await passes through).
 */
function createDirectBackend(dbPath) {
  const store = openStore(dbPath);
  const root = latticeRoot();
  return {
    mode: 'direct',
    dbPath,
    close: () => store.close(),
    requireIdentity: (id) => store.requireIdentity(id),
    listConversations: (me) => store.listConversationsFor(me),
    findChannel: (name, me) => store.getChannelVisibleTo(name, me) ?? null,
    findDm(me, other) {
      // Pure lookup (AS-3): never creates the DM row.
      const dmId = store.dmConversationFor(me, other);
      if (dmId == null) return null;
      return { ...store.requireConversation(dmId), members: store.dmMembers(dmId) };
    },
    createChannel: (opts) => store.createChannel(opts),
    privateMemberCount: (conversation) => store.dmMembers(conversation.id).length,
    openDm: (me, other) => store.openDm(me, other),
    postMessage: (opts) => store.postMessage(opts),
    getMessages: (conversationId, me, opts) => store.getMessages(conversationId, me, opts),
    getMessage: (id) => store.getMessage(id),
    unreadFor: (me) => store.unreadFor(me),
    markRead: (me, conversationId) => store.markRead(me, conversationId),
    catchupAll: (me) => store.catchupAll(me),
    rosterRows(me) {
      // AS-8 CLI parity with GET /api/roster, minus the web-UI `self` field
      // ('me' optional: --me/CHAT_ME adds dmConversationId/unread).
      const assignments = assignmentsByActor(root);
      return readRoster(root)
        .filter((e) => e.status === 'active')
        .map((e) => {
          const tasks = assignments[e.actorId] ?? [];
          const row = {
            actorId: e.actorId,
            name: e.name,
            title: e.title,
            class: e.class,
            team: e.team,
            registered: !!store.getIdentity(e.actorId),
            work: tasks[0] ?? null,
            moreTasks: Math.max(0, tasks.length - 1),
          };
          if (me) {
            const dmId = e.actorId === me ? null : store.dmConversationFor(me, e.actorId);
            row.dmConversationId = dmId;
            row.unread = dmId == null ? 0 : store.unreadCountFor(me, dmId);
          }
          return row;
        });
    },
    registerIdentity: (opts) => store.registerIdentity(opts),
    syncLattice: () => ingestNewEvents(store, root),
    dumpLines: () => store.dumpLines(),
    exportFiles: () => store.exportFiles(),
  };
}

// --- shared command plumbing -------------------------------------------------

/**
 * Resolve 'channel-name' or '@identity' to a conversation. DM refs resolve
 * purely (AS-3): no conversation row is ever created here — a pair with no
 * DM yet returns null, and each call site decides what that means. The only
 * DM-creating paths are `chat dm` / POST /api/dms / store.openDm.
 * Channel resolution is visibility-gated (AS-6) in both backends: a private
 * channel the caller is not a member of resolves exactly like a nonexistent
 * one (same message, same exit code). Never reveal hidden channels here.
 */
async function resolveConv(backend, ref, me) {
  if (ref.startsWith('@')) {
    const other = ref.slice(1);
    if (!me) fail('DM addressing requires --me (or CHAT_ME).');
    await backend.requireIdentity(other); // typos still fail as unknown identity, not "no DM yet"
    if (me === other) fail('Cannot open a DM with yourself.'); // same error openDm gives
    return backend.findDm(me, other);
  }
  const chan = await backend.findChannel(ref, me);
  if (!chan) fail(`Unknown channel '${ref}'. 'chat channels' lists them.`);
  return chan;
}

async function requireMe(backend, flags) {
  const me = flags.me || process.env.CHAT_ME;
  if (!me) fail('This command needs an identity: pass --me <id> or set CHAT_ME.');
  try {
    await backend.requireIdentity(me);
  } catch (e) {
    fail(e.message);
  }
  return me;
}

function printMessage(m, root, { indent = '' } = {}) {
  out(`${indent}[${m.id}] ${fmtTime(m.createdAt)} ${m.authorId}: ${m.body.replace(/\n/g, `\n${indent}    `)}${fmtRefs(m.body, root)}`);
}

// Commands that need a backend (and therefore a mode decision). 'task' is a
// pure .lattice/ read — no store, no server, no probe.
const BACKEND_COMMANDS = new Set([
  'channels', 'create-channel', 'post', 'dm', 'reply', 'history', 'inbox',
  'read', 'catchup', 'roster', 'register', 'sync', 'dump', 'export',
]);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    process.exit(cmd ? 0 : 1);
  }
  const args = parseArgs(rest);
  const root = latticeRoot();
  const json = !!args.flags.json;
  const backend = BACKEND_COMMANDS.has(cmd) ? await resolveBackend() : null;

  try {
    switch (cmd) {
      case 'channels': {
        const me = await requireMe(backend, args.flags);
        const convs = await backend.listConversations(me);
        if (json) return out(JSON.stringify(convs, null, 2));
        for (const c of convs) {
          const label = convLabel(c, me);
          const purpose = c.purpose ? ` — ${c.purpose}` : '';
          const unread = c.unread > 0 ? ` (${c.unread} unread)` : '';
          out(`${label}${purpose}${unread}`);
        }
        return;
      }

      case 'create-channel': {
        const usage =
          'usage: chat create-channel <name> [--purpose "…"] [--visibility public|private --members <id,id,…>]';
        const me = await requireMe(backend, args.flags);
        const [name] = args._;
        if (!name) fail(usage);
        // AS-22: --members without --visibility private is a hard usage error.
        // The store enforces this too (AS-24 moved the rule down), but the CLI
        // preflight keeps the friendlier usage text.
        if (args.flags.members != null && args.flags.visibility !== 'private') {
          fail(`--members requires --visibility private.\n\n${usage}`);
        }
        // Comma-separated identity ids; passed through verbatim (the store is
        // the validation authority — dupes are harmless, insert is OR IGNORE).
        const members =
          args.flags.members != null
            ? args.flags.members.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined;
        const ch = await backend.createChannel({
          name,
          purpose: args.flags.purpose ?? null,
          actor: me,
          visibility: args.flags.visibility, // undefined → store default 'public'
          members,
        });
        if (json) return out(JSON.stringify(ch)); // shape unchanged; no members key (matches AS-6 conversation shape)
        if (ch.visibility === 'private') {
          return out(`Created #${ch.name} (private, ${await backend.privateMemberCount(ch, members)} members)`);
        }
        return out(`Created #${ch.name}`);
      }

      case 'post': {
        const me = await requireMe(backend, args.flags);
        const [channel, body] = args._;
        if (!channel || body == null) fail('usage: chat post <channel> "<body>"');
        const chan = await backend.findChannel(channel, me);
        if (!chan) fail(`Unknown channel '${channel}'. 'chat channels' lists them.`);
        const m = await backend.postMessage({ conversation: chan.id, author: me, body });
        return out(json ? JSON.stringify(m) : `Posted to #${channel} as message ${m.id}`);
      }

      case 'dm': {
        const me = await requireMe(backend, args.flags);
        const [other, body] = args._;
        if (!other || body == null) fail('usage: chat dm <identity> "<body>"');
        const conv = await backend.openDm(me, other);
        const m = await backend.postMessage({ conversation: conv.id, author: me, body });
        return out(json ? JSON.stringify(m) : `Sent DM to ${other} as message ${m.id}`);
      }

      case 'reply': {
        const me = await requireMe(backend, args.flags);
        const [target, body] = args._;
        const match = target && /^(.+)#(\d+)$/.exec(target);
        if (!match || body == null) fail('usage: chat reply <conversation>#<msgid> "<body>"');
        const [, convRef, msgId] = match;
        const conv = await resolveConv(backend, convRef, me);
        // AS-3: no DM row exists, so the referenced message cannot either.
        if (!conv) fail(`No DM with ${convRef} yet — message ${target} does not exist.`);
        const m = await backend.postMessage({
          conversation: conv.id,
          author: me,
          body,
          threadRoot: Number(msgId),
        });
        return out(json ? JSON.stringify(m) : `Replied in thread ${convRef}#${m.threadRootId} as message ${m.id}`);
      }

      case 'history': {
        const me = await requireMe(backend, args.flags);
        const [ref] = args._;
        if (!ref) fail('usage: chat history <channel|@identity> [--limit N] [--threads]');
        const conv = await resolveConv(backend, ref, me);
        if (!conv) {
          // AS-3: pure read — never create the DM row just to show it empty.
          if (json) return out(JSON.stringify({ conversation: null, messages: [], threads: {} }, null, 2));
          return out(`No DM with ${ref} yet — 'chat dm ${ref.slice(1)} "…"' starts one.`);
        }
        const limit = args.flags.limit ? Number(args.flags.limit) : undefined;
        const { messages, threads } = await backend.getMessages(conv.id, me, { limit });
        if (json) {
          const annotate = (m) => ({ ...m, refs: resolveRefs(m.body, root) });
          return out(
            JSON.stringify(
              { conversation: conv, messages: messages.map(annotate),
                threads: Object.fromEntries(Object.entries(threads).map(([k, v]) => [k, v.map(annotate)])) },
              null, 2
            )
          );
        }
        if (messages.length === 0) return out(`${convLabel(conv, me)} is empty.`);
        for (const m of messages) {
          printMessage(m, root);
          if (m.replyCount > 0 && !args.flags.threads) {
            out(`    (${m.replyCount} ${m.replyCount === 1 ? 'reply' : 'replies'} — chat reply ${ref}#${m.id} "…" to join)`);
          } else if (args.flags.threads) {
            for (const r of threads[m.id] ?? []) printMessage(r, root, { indent: '    ↳ ' });
          }
        }
        return;
      }

      case 'inbox': {
        const me = await requireMe(backend, args.flags);
        await backend.syncLattice(); // API mode: POST /api/sync — unthrottled ingest before the read
        const groups = await backend.unreadFor(me);
        if (json) {
          const withRefs = [];
          for (const g of groups) {
            const messages = [];
            for (const m of g.messages) {
              const rootMsg = m.threadRootId
                ? await backend.getMessage(m.threadRootId, { conversationId: g.conversationId, me })
                : null;
              messages.push({
                ...m,
                refs: resolveRefs(m.body, root),
                threadContext: m.threadRootId ? rootMsg?.body ?? null : null,
              });
            }
            withRefs.push({ ...g, messages });
          }
          return out(JSON.stringify(withRefs, null, 2));
        }
        if (groups.length === 0) return out('Nothing new.');
        for (const g of groups) {
          const label = convLabel(g, me);
          out(`${label} — ${g.messages.length} new`);
          for (const m of g.messages) {
            if (m.threadRootId) {
              const rootMsg = await backend.getMessage(m.threadRootId, { conversationId: g.conversationId, me });
              const snippet = rootMsg ? rootMsg.body.split('\n')[0].slice(0, 60) : '?';
              out(`  ↳ in thread ${label.replace(/^@/, '@')}#${m.threadRootId} ("${snippet}")`);
            }
            printMessage(m, root, { indent: '  ' });
          }
        }
        out(`\n(read with: chat read <conversation>, or chat catchup)`);
        return;
      }

      case 'read': {
        const me = await requireMe(backend, args.flags);
        const [ref] = args._;
        if (!ref) fail('usage: chat read <channel|@identity>');
        const conv = await resolveConv(backend, ref, me);
        if (!conv) {
          // AS-3: idempotent no-op for scripts — nothing exists to mark read.
          if (json) return out(JSON.stringify({ conversation: null, lastReadId: null }));
          return out(`Nothing to mark read — no DM with ${ref} yet.`);
        }
        const r = await backend.markRead(me, conv.id);
        return out(json ? JSON.stringify(r) : `Marked ${convLabel(conv, me)} read.`);
      }

      case 'catchup': {
        const me = await requireMe(backend, args.flags);
        const n = await backend.catchupAll(me);
        return out(json ? JSON.stringify({ conversations: n }) : `Caught up on ${n} conversations.`);
      }

      case 'roster': {
        const me = args.flags.me || process.env.CHAT_ME || null;
        const rows = await backend.rosterRows(me);
        if (json) return out(JSON.stringify(rows, null, 2));
        if (rows.length === 0) {
          // Degradation contract: missing personnel/ mount is a note, not an error.
          return out('No personnel records found (personnel/ missing or empty).');
        }
        const workLabel = (r) =>
          r.work
            ? `${r.work.shortId} ${r.work.status.replace('_', ' ')}${r.moreTasks > 0 ? ` (+${r.moreTasks})` : ''}`
            : 'idle';
        const cols = rows.map((r) => [r.actorId, r.name, r.title, workLabel(r)]);
        const width = (i) => Math.max(...cols.map((c) => c[i].length));
        for (const c of cols) {
          out(`${c[0].padEnd(width(0))}  ${c[1].padEnd(width(1))}  ${c[2].padEnd(width(2))}  ${c[3]}`);
        }
        return;
      }

      case 'register': {
        const [id, displayName] = args._;
        const kind = args.flags.kind;
        if (!id || !displayName || !kind) {
          fail('usage: chat register <id> "<display name>" --kind agent|human|system');
        }
        const row = await backend.registerIdentity({ id, displayName, kind });
        return out(json ? JSON.stringify(row) : `Registered ${row.id} (${row.displayName})`);
      }

      case 'sync': {
        const n = await backend.syncLattice();
        return out(json ? JSON.stringify({ posted: n }) : `Ingested ${n} new Lattice event${n === 1 ? '' : 's'} into #${EVENTS_CHANNEL}.`);
      }

      case 'dump': {
        for (const line of await backend.dumpLines()) out(line);
        return;
      }

      case 'export': {
        // Append-only JSONL export for git durability (AS-5). Deterministic:
        // same DB state => byte-identical files => `git status` stays clean.
        // Default out dir derives from the DB path convention (not the mode):
        // $CHAT_DB's directory or apps/chat/data — /app/data/export in the
        // container, apps/chat/data/export on the host, either way the AS-5
        // records path.
        const outDir =
          args.flags.out || join(dirname(process.env.CHAT_DB || DEFAULT_DB), 'export');
        mkdirSync(outDir, { recursive: true });
        const files = await backend.exportFiles();
        let conversations = 0;
        let messages = 0;
        let identities = 0;
        for (const f of files) {
          writeFileSync(join(outDir, f.filename), f.lines.map((l) => l + '\n').join(''));
          if (f.filename === 'identities.jsonl') {
            identities = f.lines.length;
          } else {
            conversations += 1;
            messages += f.lines.length - 1; // line 1 is the conversation header
          }
        }
        if (json) {
          return out(
            JSON.stringify({
              files: files.map((f) => f.filename),
              conversations,
              messages,
              identities,
              out: outDir,
            })
          );
        }
        return out(
          `Exported ${conversations} conversations, ${messages} messages, ${identities} identities to ${outDir}`
        );
      }

      case 'task': {
        // Convenience mirror of GET /api/task/:shortId (not in the plan's list,
        // but 'chat inbox' output invites following a ref; read-only, and needs
        // no backend at all — pure .lattice/ resolution).
        const [shortId] = args._;
        if (!shortId) fail('usage: chat task <short-id>');
        const r = resolveShortId(shortId, root);
        if (json) return out(JSON.stringify(r));
        return out(r.exists ? `${r.shortId} "${r.title}" — ${r.status} (${r.taskId})` : `${shortId}: no such task`);
      }

      default:
        fail(`Unknown command '${cmd}'.\n\n${USAGE}`);
    }
  } catch (e) {
    if (e instanceof StoreError) fail(e.message);
    throw e;
  } finally {
    backend?.close();
  }
}

main().catch((e) => {
  // Unexpected (non-StoreError) failure: preserve the old synchronous
  // uncaught-exception contract — stack to stderr, nonzero exit.
  process.stderr.write((e?.stack ?? String(e)) + '\n');
  process.exit(1);
});
