// Unit tests for the pure scroll primitive (AS-17). No server, no DOM — the
// same file the browser imports is imported here directly, with plain objects
// standing in for scrollable elements (the module only reads/writes the three
// scroll metrics, so a fake pane is a faithful double).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAtBottom, renderPreservingScroll } from '../public/scroll.js';

// --- isAtBottom -------------------------------------------------------------

test('scroll: isAtBottom — slack boundary at default slack (40)', () => {
  // delta = scrollHeight - scrollTop - clientHeight
  const pane = (delta) => ({ scrollTop: 1000 - 500 - delta, scrollHeight: 1000, clientHeight: 500 });
  assert.equal(isAtBottom(pane(0)), true, 'exactly at bottom');
  assert.equal(isAtBottom(pane(39)), true, 'delta 39 < slack -> at bottom');
  assert.equal(isAtBottom(pane(40)), false, 'delta 40 === slack -> not at bottom');
  assert.equal(isAtBottom(pane(41)), false, 'delta 41 > slack -> not at bottom');
});

test('scroll: isAtBottom — explicit slack overrides the default', () => {
  const m = { scrollTop: 0, scrollHeight: 600, clientHeight: 500 }; // delta 100
  assert.equal(isAtBottom(m), false);
  assert.equal(isAtBottom(m, 101), true);
  assert.equal(isAtBottom(m, 100), false, 'strict less-than, same as default');
});

test('scroll: isAtBottom — degenerate metrics count as at-bottom', () => {
  // Hidden pane: every metric zero.
  assert.equal(isAtBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 }), true);
  // No scrollbar: content fits (clientHeight >= scrollHeight).
  assert.equal(isAtBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), true);
  assert.equal(isAtBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 }), true);
  // Null/undefined metrics never throw.
  assert.equal(isAtBottom(null), true);
  assert.equal(isAtBottom(undefined), true);
  assert.equal(isAtBottom({}), true);
});

// --- renderPreservingScroll --------------------------------------------------

/** Fake pane + a render that appends `growth` px of content. replaceChildren's
 *  remove-all-then-insert may reset scrollTop in a real engine, so the fake
 *  render zeroes it — proving the primitive restores explicitly rather than
 *  relying on engine retention. */
function fakePane({ scrollTop, scrollHeight, clientHeight = 500 }) {
  return { scrollTop, scrollHeight, clientHeight };
}
function growingRender(pane, growth, calls) {
  return () => {
    calls.count += 1;
    pane.scrollHeight += growth;
    pane.scrollTop = 0; // engine-hostile: content replacement clobbered the position
  };
}

test('scroll: renderPreservingScroll — forceBottom jumps to the new bottom', () => {
  const pane = fakePane({ scrollTop: 100, scrollHeight: 1000 }); // scrolled up
  const calls = { count: 0 };
  renderPreservingScroll(pane, growingRender(pane, 200, calls), { forceBottom: true });
  assert.equal(calls.count, 1, 'render invoked exactly once');
  assert.equal(pane.scrollTop, 1200, 'pinned to the new scrollHeight');
});

test('scroll: renderPreservingScroll — at bottom stays stuck to new content', () => {
  const pane = fakePane({ scrollTop: 500, scrollHeight: 1000 }); // delta 0: at bottom
  const calls = { count: 0 };
  renderPreservingScroll(pane, growingRender(pane, 300, calls));
  assert.equal(calls.count, 1);
  assert.equal(pane.scrollTop, 1300, 'followed growth to the new bottom');
});

test('scroll: renderPreservingScroll — scrolled up restores position exactly', () => {
  const pane = fakePane({ scrollTop: 137, scrollHeight: 1000 }); // delta 363: scrolled up
  const calls = { count: 0 };
  renderPreservingScroll(pane, growingRender(pane, 300, calls));
  assert.equal(calls.count, 1);
  assert.equal(pane.scrollTop, 137, 'exact restore of the measured scrollTop');
});

test('scroll: renderPreservingScroll — unchanged content, scrolled up: no movement', () => {
  const pane = fakePane({ scrollTop: 137, scrollHeight: 1000 });
  renderPreservingScroll(pane, () => { pane.scrollTop = 0; }); // re-render, same height
  assert.equal(pane.scrollTop, 137);
});

test('scroll: renderPreservingScroll — empty/hidden pane is a safe no-op-to-bottom', () => {
  const pane = fakePane({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  renderPreservingScroll(pane, () => {});
  assert.equal(pane.scrollTop, 0, 'zero metrics: at-bottom write lands on 0');
});
