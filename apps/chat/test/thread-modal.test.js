// Unit tests for the thread-modal close-eligibility predicates (AS-19).
// No server, no DOM — the same file the browser imports is imported here
// directly, with plain objects standing in for events (the module only reads
// key/defaultPrevented/target/currentTarget, so a fake event is a faithful
// double). Same pattern as scroll.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCloseOnEscape, isBackdropClick } from '../public/thread-modal.js';

// --- shouldCloseOnEscape ------------------------------------------------------

test('thread-modal: Escape closes only while the modal is visible', () => {
  const esc = { key: 'Escape', defaultPrevented: false };
  assert.equal(shouldCloseOnEscape(esc, false), true, 'visible modal + Escape -> close');
  assert.equal(shouldCloseOnEscape(esc, true), false, 'hidden modal -> document listener is inert');
});

test('thread-modal: defaultPrevented events never close (DM typeahead contract)', () => {
  // The typeahead's own keydown handler calls preventDefault on its Escape
  // before the event bubbles to document — that event must be ignored even
  // with the modal open.
  const claimed = { key: 'Escape', defaultPrevented: true };
  assert.equal(shouldCloseOnEscape(claimed, false), false);
});

test('thread-modal: only the Escape key qualifies', () => {
  for (const key of ['Enter', 'Esc', 'q', ' ', undefined]) {
    assert.equal(shouldCloseOnEscape({ key, defaultPrevented: false }, false), false, `key=${key}`);
  }
  assert.equal(shouldCloseOnEscape(null, false), false, 'no event object -> no close');
});

// --- isBackdropClick ----------------------------------------------------------

test('thread-modal: click on the overlay itself is a backdrop click', () => {
  const overlay = { id: 'thread-modal' };
  assert.equal(isBackdropClick({ target: overlay, currentTarget: overlay }), true);
});

test('thread-modal: clicks inside the dialog are not backdrop clicks', () => {
  const overlay = { id: 'thread-modal' };
  const dialog = { id: 'thread-dialog' };
  assert.equal(isBackdropClick({ target: dialog, currentTarget: overlay }), false);
  assert.equal(isBackdropClick(null), false, 'no event object -> not a backdrop click');
});
