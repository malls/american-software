// dashboard-link.js — where a Lattice deep link points (AS-93).
//
// Pure module in the house style of msg-refs.js / url-state.js: no DOM, no
// globals, no fetch. app.js hands it the page's own `location`; node:test
// hands it a plain object. That purity is what makes the host rules
// behavioural tests instead of arguments.
//
// Why the browser derives this and not the server: one server fans ONE payload
// out to browsers sitting on two different hostnames at the same time (the Mac
// on loopback, a phone on the tailnet), and message refs ride the SSE
// broadcast — composed once, pushed to everyone. A server-baked absolute URL
// is therefore necessarily wrong for at least one audience.

export const LOOPBACK_PORT = 8799;
export const REMOTE_PORT = 8443;

// Exactly these four spellings, deliberately. Not 127.0.0.0/8, not
// *.localhost: a future loopback name is a one-line addition with a test,
// never a regex. A browser brackets IPv6 in location.hostname ('[::1]'); the
// bare form is accepted because a non-browser caller may not.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** '::1' -> '[::1]' so the bare IPv6 form is a legal URL authority. */
function hostForUrl(hostname) {
  return hostname === '::1' ? '[::1]' : hostname;
}

/**
 * The operator's LATTICE_DASHBOARD_URL, normalised, or null when it is not
 * usable. Usable = a non-blank string that parses as a URL whose scheme is
 * exactly http: or https:. The scheme check exists because this value now
 * lands in a live href — a `javascript:`/`data:` value would be a script
 * injection surface. An unusable value never throws and never ships: it falls
 * through to inference, which is the correct answer in every deployment that
 * has not set the variable.
 */
function usableOverride(override) {
  if (typeof override !== 'string') return null;
  const trimmed = override.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return trimmed.replace(/\/+$/, ''); // AS-10 contract: trailing '/' trimmed
}

/**
 * Href of a task in the Lattice dashboard: `<base>/#/task/<taskId>`.
 *
 * @param {string} taskId full Lattice task id (never a short code)
 * @param {{location: {protocol: string, hostname: string}, override?: ?string}} ctx
 *
 * Rules, in order:
 *   1. An explicitly configured override wins, verbatim (explicit config beats
 *      a heuristic).
 *   2. Otherwise ONLY the port is inferred: a loopback page hostname means the
 *      dashboard is on LOOPBACK_PORT, anything else means REMOTE_PORT (the
 *      Tailscale `serve` mapping). The page's own port is irrelevant.
 *   3. The protocol and the hostname are ALWAYS the page's own.
 *
 * The fail-closed invariant, stated so it can be falsified: outside the
 * override branch there is no expression in this module that can put a
 * hostname into the returned string other than `location.hostname`. So a link
 * can never point at a host the reader is not already on, and there is no code
 * path that falls back to loopback from a non-loopback page. Consequences,
 * accepted deliberately:
 *   - An unrecognised host is treated as remote. The two mistakes are not
 *     symmetric: remote-classified-as-loopback links the reader to their OWN
 *     machine (silently wrong — the bug this module exists to kill), while
 *     loopback-classified-as-remote is visibly dead and diagnosable at a
 *     glance. Fail closed toward the visible one.
 *   - A blank hostname (a file:// page — not a supported deployment) yields a
 *     host-less, visibly broken URL. That is the invariant HOLDING. Do not
 *     "fix" it with a default host: the default host IS the defect.
 */
export function dashboardTaskHref(taskId, { location, override = null } = {}) {
  const base = usableOverride(override);
  if (base) return `${base}/#/task/${encodeURIComponent(taskId)}`;
  const port = LOOPBACK_HOSTS.has(location.hostname) ? LOOPBACK_PORT : REMOTE_PORT;
  return `${location.protocol}//${hostForUrl(location.hostname)}:${port}/#/task/${encodeURIComponent(taskId)}`;
}
