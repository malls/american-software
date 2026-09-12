// Unit tests for public/dashboard-link.js — pure, no DOM (AS-93).
// The suite has zero dependencies by design (package.json), so there is no
// jsdom: the helper is exercised directly with a plain `location` object,
// which is exactly why it was written pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardTaskHref } from '../public/dashboard-link.js';

const loc = (protocol, hostname) => ({ protocol, hostname });
const ID = 'task_TESTAAAA';
const TAILNET = 'forrests-newer-macbook.tail3f3c29.ts.net';

test('dashboard-link: AS-93 — a tailnet page links to the same host on :8443', () => {
  assert.equal(
    dashboardTaskHref(ID, { location: loc('https:', TAILNET) }),
    `https://${TAILNET}:8443/#/task/${ID}`
  );
});

test('dashboard-link: AS-93 — a loopback page links to :8799 (all four loopback spellings)', () => {
  const cases = [
    ['127.0.0.1', `http://127.0.0.1:8799/#/task/${ID}`],
    ['localhost', `http://localhost:8799/#/task/${ID}`],
    ['[::1]', `http://[::1]:8799/#/task/${ID}`],
    // Bare '::1' never comes from a browser, but a caller may pass it: it is
    // re-bracketed on output so the authority stays legal.
    ['::1', `http://[::1]:8799/#/task/${ID}`],
  ];
  assert.equal(cases.length, 4, '4 loopback spellings examined');
  for (const [hostname, expected] of cases) {
    assert.equal(dashboardTaskHref(ID, { location: loc('http:', hostname) }), expected, hostname);
  }
});

test('dashboard-link: AS-93 — fails closed: the href host is ALWAYS the page host, never a loopback fallback', () => {
  // (a) The rule reads the hostname, never the page's port: a page served on
  // :9000 still resolves the dashboard on the remote port.
  assert.equal(
    dashboardTaskHref(ID, { location: loc('https:', 'example.internal') }),
    `https://example.internal:8443/#/task/${ID}`
  );

  // (b) Arbitrary hosts, including ones built to look loopback-ish.
  const hosts = [
    'example.internal',
    'chat.internal',
    '10.0.0.7',
    '192.168.1.50',
    '127.0.0.1.evil.com',
    'localhost.attacker.test',
    'xn--80ak6aa92e.com',
    'a.very.long.sub.domain.example',
  ];
  assert.ok(hosts.length >= 8, `${hosts.length} hostnames examined (>= 8 required)`);
  for (const hostname of hosts) {
    const href = dashboardTaskHref(ID, { location: loc('https:', hostname) });
    assert.equal(
      new URL(href).hostname,
      hostname,
      `${hosts.length} hosts examined; href host must equal the page host for ${hostname}`
    );
    for (const forbidden of ['127.0.0.1', 'localhost']) {
      if (hostname.includes(forbidden)) continue; // the page itself said it
      assert.ok(
        !href.includes(forbidden),
        `${hosts.length} hosts examined; no ${forbidden} fallback may appear for ${hostname} (got ${href})`
      );
    }
  }
});

test('dashboard-link: AS-93 — an explicit override wins; blank and non-http overrides fall back to inference', () => {
  // Deliberately a value inference could never produce, asserted from a
  // TAILNET page: that is what makes this assertion load-bearing.
  const tailnetPage = { location: loc('https:', TAILNET) };
  assert.equal(
    dashboardTaskHref(ID, { ...tailnetPage, override: 'http://127.0.0.1:9999' }),
    `http://127.0.0.1:9999/#/task/${ID}`
  );
  assert.equal(
    dashboardTaskHref(ID, { ...tailnetPage, override: 'http://127.0.0.1:9999///' }),
    `http://127.0.0.1:9999/#/task/${ID}`,
    'trailing slashes are trimmed (AS-10 contract)'
  );
  assert.equal(
    dashboardTaskHref(ID, { ...tailnetPage, override: 'https://dash.example.test/lattice/' }),
    `https://dash.example.test/lattice/#/task/${ID}`,
    'a base with a path keeps the path, minus the trailing slash'
  );

  const inferred = `https://${TAILNET}:8443/#/task/${ID}`;
  const fallThrough = [null, undefined, '', '   ', 42, {}, [], 'javascript:alert(1)', 'data:text/html,x', 'not a url'];
  assert.equal(fallThrough.length, 10, '10 unusable override values examined');
  for (const override of fallThrough) {
    assert.equal(
      dashboardTaskHref(ID, { ...tailnetPage, override }),
      inferred,
      `unusable override ${JSON.stringify(override)} falls through to inference`
    );
  }
  // No override key at all is the same as null.
  assert.equal(dashboardTaskHref(ID, tailnetPage), inferred);
});

test('dashboard-link: AS-93 — a blank page hostname yields a host-less link, never a loopback one', () => {
  // A file:// page is not a supported deployment. The invariant HOLDING means
  // a visibly broken URL, not a silent loopback fallback — the default host is
  // the defect this task exists to remove.
  const href = dashboardTaskHref(ID, { location: loc('http:', '') });
  assert.equal(href, `http://:8443/#/task/${ID}`);
  assert.ok(!href.includes('127.0.0.1'), 'no loopback fallback');
  assert.ok(!href.includes('localhost'), 'no loopback fallback');
});
