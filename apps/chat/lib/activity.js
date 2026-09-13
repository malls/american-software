// lib/activity.js — AS-103: the live tool-level activity reduction.
//
// One employee, one tool call, one sentence: "reading server.js". The frames
// this module shapes are LIVE-ONLY (CLAUDE.md § Observability north star, and
// the board's own words on the task) — they are fanned out to the SSE
// connections open at that instant and written nowhere. Nothing in this file
// touches a store, a file, or the AS-100 stream, and nothing downstream of it
// may either.
//
// PURE: no fs, no clock, no process — lib/lanes.js's rule, for the same reason.
// Every rule below is a unit test instead of an argument.
//
// TWO HALVES, BOTH REDUCING. `coarseObject` runs in the hook, on the host, in
// the process that can see the whole tool input: a full command line, a grep
// pattern, or a file body must never leave that process. `activityText` runs in
// the server and reduces AGAIN — basenames anything absolute, re-takes the
// first token of anything command-shaped, drops the search pattern outright —
// so a producer that got sloppy (or a hand-rolled POST to /api/activity, which
// is loopback-open by construction) still cannot put an untamed string in a
// browser. The duplication is the design, not an oversight.

/** Minimum gap between two DELIVERED frames on one lane. A frame inside the
 *  window is dropped, never queued: only the freshest frame matters to an
 *  animation layer, and public/lanes.js's 15 s decay covers the tail. Exported
 *  so the throttle tests assert the boundary against the constant. */
export const ACTIVITY_MIN_INTERVAL_MS = 200;

/** Hard clamp on the rendered sentence. A lane card is one column wide; a
 *  string longer than this is a leak, not a label. */
export const ACTIVITY_TEXT_MAX = 80;

/** The exact keys of a fanned-out `event: activity` frame — AS-27's whitelist
 *  rule applied to a third payload. Note what is NOT here: no `employee`, no
 *  `cwd`, no tool input. Attribution stays DERIVED — `key` is the lane, and the
 *  card already names that lane's assignee from /api/lanes — which keeps a
 *  .lattice read out of this hot path. */
export const ACTIVITY_FRAME_KEYS = Object.freeze(['key', 'text', 'at']);

/** Longest `running <token>` token. A command's first token is a program name;
 *  anything longer than this is not one. */
const TOKEN_MAX = 24;

/** What a harness tool name may look like. Deliberately narrow: the name is
 *  interpolated into `using <tool>`, so it is the one payload field that can
 *  reach a browser unreduced. Anything else is `bad-tool` at the endpoint. */
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

/** The `.worktrees/<seg>` marker, matched as a SUFFIX-side segment rather than
 *  an absolute prefix: the hook runs on the host
 *  (/Users/forrest/Code/american-software-company/.worktrees/AS-103) and the
 *  server reads it inside a container over a bind mount (/app/.worktrees/AS-103
 *  or /repo/...). A prefix match would derive a lane for exactly one of them. */
const WORKTREE_SEG_RE = /(?:^|\/)\.worktrees\/([^/]+)(?:\/|$)/;

/** Same shape lib/lanes.js joins lane keys on, so a key derived here and a key
 *  composed there are the same string or the card never lights up. */
const SHORT_ID_RE = /AS-\d+/;

const isToolName = (tool) => typeof tool === 'string' && TOOL_NAME_RE.test(tool);

/** Control characters and newlines out, runs of whitespace collapsed. A frame
 *  is one line by definition — an embedded newline would also break the SSE
 *  framing this text is interpolated into. */
function clean(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Last path segment, whatever the separator depth. Never returns a leading
 *  slash: an absolute host path is exactly what must not reach a browser. */
function basename(p) {
  const parts = String(p).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** One whitespace-delimited token, basenamed and clamped — `running docker`,
 *  never `running /usr/local/bin/docker compose -f … up --build`. */
function firstToken(cmd) {
  const c = clean(cmd);
  if (!c) return null;
  const tok = basename(c.split(' ')[0]);
  return tok ? tok.slice(0, TOKEN_MAX) : null;
}

/** A short slug (a subagent type, a hostname) — cleaned, single-token, clamped
 *  the same way, because both arrive from the same untrusted payload. */
function slug(v) {
  const c = clean(v);
  if (!c) return null;
  return c.split(' ')[0].slice(0, 40) || null;
}

/**
 * A file path the browser may see: relative to the tool call's cwd when it sits
 * inside it, and a bare basename when it does not. Never absolute, in either
 * branch — "outside the worktree" is not a licence to print a host path.
 */
function relPath(p, cwd) {
  if (typeof p !== 'string' || !p) return null;
  let out = clean(p);
  if (!out) return null;
  if (typeof cwd === 'string' && cwd) {
    const base = clean(cwd).replace(/\/+$/, '');
    if (base && out.startsWith(base + '/')) out = out.slice(base.length + 1);
  }
  if (out.startsWith('/')) out = basename(out);
  return out || null;
}

/**
 * Reduce a harness tool call's input to the ONE coarse string a lane card may
 * show — or null when the honest answer is "the verb alone". Runs in the hook,
 * at the source, so the untamed input never crosses a socket.
 *
 * `cwd` is optional: with it, a file path comes back relative to the worktree;
 * without it, the same path comes back as a basename. Both are safe; only the
 * first is useful.
 */
export function coarseObject(tool, input, cwd = null) {
  if (!isToolName(tool)) return null;
  const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return relPath(inp.file_path, cwd);
    case 'Bash':
      return firstToken(inp.command);
    case 'Grep':
    case 'Glob':
      // The pattern is DROPPED, not clamped. A search pattern is the closest
      // thing in a tool input to a statement of intent, and "searching" says
      // everything a foreman view needs.
      return null;
    case 'Task':
      return slug(inp.subagent_type);
    case 'WebFetch':
      try {
        return slug(new URL(String(inp.url)).hostname);
      } catch {
        return null;
      }
    default:
      // The table never has to be exhaustive: an unlisted tool reduces to its
      // own name and carries no object at all, so a tool added to the harness
      // tomorrow cannot leak an input shape nobody has read.
      return null;
  }
}

/**
 * The sentence a lane card renders, or null when the payload is not a tool call
 * this endpoint will speak for (the caller turns that null into `bad-tool`).
 *
 * `coarse` is whatever `coarseObject` produced, and is re-reduced here rather
 * than trusted — see the two-halves note at the top of the file.
 */
export function activityText(tool, coarse) {
  if (!isToolName(tool)) return null;
  if (coarse !== null && coarse !== undefined && typeof coarse !== 'string') return null;
  const raw = typeof coarse === 'string' ? coarse : null;

  let text;
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const verb = tool === 'Read' ? 'reading' : tool === 'Write' ? 'writing' : 'editing';
      const p = relPath(raw, null); // absolute in, basename out — second line of defence
      text = p ? `${verb} ${p}` : verb;
      break;
    }
    case 'Bash': {
      const tok = firstToken(raw);
      text = tok ? `running ${tok}` : 'running';
      break;
    }
    case 'Grep':
    case 'Glob':
      // `raw` is ignored on purpose. If a producer sent the pattern anyway, it
      // dies here rather than being clamped to 80 characters of it.
      text = 'searching';
      break;
    case 'Task': {
      const t = slug(raw);
      text = t ? `delegating to ${t}` : 'delegating';
      break;
    }
    case 'WebFetch': {
      const h = slug(raw);
      text = h ? `fetching ${h}` : 'fetching';
      break;
    }
    default:
      text = `using ${tool}`;
      break;
  }
  return clean(text).slice(0, ACTIVITY_TEXT_MAX).trim();
}

/**
 * Which lane a tool call belongs to, from its cwd alone — `.worktrees/AS-103`
 * is the task, and the task is the card. Returns null for a cwd outside any
 * worktree (the orchestrator's main checkout, a live metawork session): no
 * lane, no card to put it on, and the endpoint drops the frame.
 */
export function laneKeyFromCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  const m = WORKTREE_SEG_RE.exec(clean(cwd));
  if (!m) return null;
  const short = SHORT_ID_RE.exec(m[1]);
  return short ? short[0] : null;
}
