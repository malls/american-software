#!/usr/bin/env node
// bin/chat.js — agent-facing CLI for the chat app (AS-2).
// Thin wrapper over lib/store.js; talks to the DB directly (no server needed).

import { resolve, dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore, StoreError, EVENTS_CHANNEL } from '../lib/store.js';
import { ingestNewEvents, resolveRefs, resolveShortId, latticeRoot, assignmentsByActor } from '../lib/lattice.js';
import { readRoster } from '../lib/personnel.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.CHAT_DB || join(APP_DIR, 'data', 'chat.db');

const USAGE = `usage: chat <command> [args] [--me <identity>] [--json]

  channels                            list channels and DMs with unread counts
  create-channel <name> --purpose "…" create a channel
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
  DB: $CHAT_DB or apps/chat/data/chat.db`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--threads') args.flags[a.slice(2)] = true;
    else if (a === '--me' || a === '--purpose' || a === '--kind' || a === '--limit' || a === '--out') {
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

/** Resolve 'channel-name' or '@identity' to a conversation (get-or-create for DMs). */
function resolveConv(store, ref, me, { createDm = false } = {}) {
  if (ref.startsWith('@')) {
    const other = ref.slice(1);
    if (!me) fail('DM addressing requires --me (or CHAT_ME).');
    if (!createDm) {
      // Existence check without creating: openDm is get-or-create, which is the
      // v1 semantic for DMs (history is reconstructable per pair) — acceptable for reads too.
    }
    return store.openDm(me, other);
  }
  // AS-6: resolution is visibility-gated — a private channel the caller is
  // not a member of resolves exactly like a nonexistent one (same message,
  // same exit code). Never reveal hidden channels here.
  const chan = store.getChannelVisibleTo(ref, me);
  if (!chan) fail(`Unknown channel '${ref}'. 'chat channels' lists them.`);
  return chan;
}

function requireMe(store, flags) {
  const me = flags.me || process.env.CHAT_ME;
  if (!me) fail('This command needs an identity: pass --me <id> or set CHAT_ME.');
  try {
    store.requireIdentity(me);
  } catch (e) {
    fail(e.message);
  }
  return me;
}

function printMessage(m, root, { indent = '' } = {}) {
  out(`${indent}[${m.id}] ${fmtTime(m.createdAt)} ${m.authorId}: ${m.body.replace(/\n/g, `\n${indent}    `)}${fmtRefs(m.body, root)}`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    process.exit(cmd ? 0 : 1);
  }
  const args = parseArgs(rest);
  const store = openStore(DB_PATH);
  const root = latticeRoot();
  const json = !!args.flags.json;

  try {
    switch (cmd) {
      case 'channels': {
        const me = requireMe(store, args.flags);
        const convs = store.listConversationsFor(me);
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
        const me = requireMe(store, args.flags);
        const [name] = args._;
        if (!name) fail('usage: chat create-channel <name> --purpose "…"');
        const ch = store.createChannel({ name, purpose: args.flags.purpose ?? null, actor: me });
        return out(json ? JSON.stringify(ch) : `Created #${ch.name}`);
      }

      case 'post': {
        const me = requireMe(store, args.flags);
        const [channel, body] = args._;
        if (!channel || body == null) fail('usage: chat post <channel> "<body>"');
        const chan = store.getChannelVisibleTo(channel, me);
        if (!chan) fail(`Unknown channel '${channel}'. 'chat channels' lists them.`);
        const m = store.postMessage({ conversation: chan.id, author: me, body });
        return out(json ? JSON.stringify(m) : `Posted to #${channel} as message ${m.id}`);
      }

      case 'dm': {
        const me = requireMe(store, args.flags);
        const [other, body] = args._;
        if (!other || body == null) fail('usage: chat dm <identity> "<body>"');
        const conv = store.openDm(me, other);
        const m = store.postMessage({ conversation: conv.id, author: me, body });
        return out(json ? JSON.stringify(m) : `Sent DM to ${other} as message ${m.id}`);
      }

      case 'reply': {
        const me = requireMe(store, args.flags);
        const [target, body] = args._;
        const match = target && /^(.+)#(\d+)$/.exec(target);
        if (!match || body == null) fail('usage: chat reply <conversation>#<msgid> "<body>"');
        const [, convRef, msgId] = match;
        const conv = resolveConv(store, convRef, me);
        const m = store.postMessage({
          conversation: conv.id,
          author: me,
          body,
          threadRoot: Number(msgId),
        });
        return out(json ? JSON.stringify(m) : `Replied in thread ${convRef}#${m.threadRootId} as message ${m.id}`);
      }

      case 'history': {
        const me = requireMe(store, args.flags);
        const [ref] = args._;
        if (!ref) fail('usage: chat history <channel|@identity> [--limit N] [--threads]');
        const conv = resolveConv(store, ref, me);
        const limit = args.flags.limit ? Number(args.flags.limit) : undefined;
        const { messages, threads } = store.getMessages(conv.id, me, { limit });
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
        const me = requireMe(store, args.flags);
        ingestNewEvents(store, root);
        const groups = store.unreadFor(me);
        if (json) {
          const withRefs = groups.map((g) => ({
            ...g,
            messages: g.messages.map((m) => ({
              ...m,
              refs: resolveRefs(m.body, root),
              threadContext: m.threadRootId ? store.getMessage(m.threadRootId)?.body ?? null : null,
            })),
          }));
          return out(JSON.stringify(withRefs, null, 2));
        }
        if (groups.length === 0) return out('Nothing new.');
        for (const g of groups) {
          const label = convLabel(g, me);
          out(`${label} — ${g.messages.length} new`);
          for (const m of g.messages) {
            if (m.threadRootId) {
              const rootMsg = store.getMessage(m.threadRootId);
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
        const me = requireMe(store, args.flags);
        const [ref] = args._;
        if (!ref) fail('usage: chat read <channel|@identity>');
        const conv = resolveConv(store, ref, me);
        const r = store.markRead(me, conv.id);
        return out(json ? JSON.stringify(r) : `Marked ${convLabel(conv, me)} read.`);
      }

      case 'catchup': {
        const me = requireMe(store, args.flags);
        const n = store.catchupAll(me);
        return out(json ? JSON.stringify({ conversations: n }) : `Caught up on ${n} conversations.`);
      }

      case 'roster': {
        // AS-8 CLI parity with GET /api/roster, minus viewer-relative fields
        // ('me' optional here: --me/CHAT_ME adds dmConversationId/unread).
        const me = args.flags.me || process.env.CHAT_ME || null;
        const assignments = assignmentsByActor(root);
        const rows = readRoster(root)
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
        const row = store.registerIdentity({ id, displayName, kind });
        return out(json ? JSON.stringify(row) : `Registered ${row.id} (${row.displayName})`);
      }

      case 'sync': {
        const n = ingestNewEvents(store, root);
        return out(json ? JSON.stringify({ posted: n }) : `Ingested ${n} new Lattice event${n === 1 ? '' : 's'} into #${EVENTS_CHANNEL}.`);
      }

      case 'dump': {
        for (const line of store.dumpLines()) out(line);
        return;
      }

      case 'export': {
        // Append-only JSONL export for git durability (AS-5). Deterministic:
        // same DB state => byte-identical files => `git status` stays clean.
        const outDir = args.flags.out || join(dirname(DB_PATH), 'export');
        mkdirSync(outDir, { recursive: true });
        const files = store.exportFiles();
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
        // but 'chat inbox' output invites following a ref; read-only).
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
    store.close();
  }
}

main();
