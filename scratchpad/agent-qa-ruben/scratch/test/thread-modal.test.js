// Unit tests for the thread-modal close-eligibility predicates (AS-19).
// No server, no DOM — the same file the browser imports is imported here
// directly, with plain objects standing in for events (the module only reads
// key/defaultPrevented/target/currentTarget, so a fake event is a faithful
// double). Same pattern as scroll.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCloseOnEscape, isBackdropClick } from '../public/thread-modal.js';
import { shouldCloseOnBackdropGesture } from '../public/thread-modal.js'; // AS-23

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

// --- shouldCloseOnBackdropGesture (AS-23; AS-19 QA backlog item c) ------------

test('thread-modal: gesture down+click both on the backdrop closes', () => {
  const overlay = { id: 'thread-modal' };
  const click = { target: overlay, currentTarget: overlay };
  assert.equal(shouldCloseOnBackdropGesture(click, overlay), true);
});

test('thread-modal: selection drag from dialog to backdrop does NOT close', () => {
  // Press inside the dialog (start of a text selection), release on the
  // backdrop: the browser dispatches click on the common ancestor with
  // target === currentTarget — the down-target is what distinguishes it.
  const overlay = { id: 'thread-modal' };
  const dialogText = { id: 'thread-messages' };
  const click = { target: overlay, currentTarget: overlay };
  assert.equal(shouldCloseOnBackdropGesture(click, dialogText), false);
});

test('thread-modal: null down-target falls back to the click-target check alone', () => {
  const overlay = { id: 'thread-modal' };
  const dialog = { id: 'thread-dialog' };
  assert.equal(
    shouldCloseOnBackdropGesture({ target: overlay, currentTarget: overlay }, null),
    true,
    'no pointer event seen (keyboard/synthetic click) -> legacy behavior: close'
  );
  assert.equal(
    shouldCloseOnBackdropGesture({ target: overlay, currentTarget: overlay }, undefined),
    true,
    'undefined down-target treated the same as null'
  );
  assert.equal(
    shouldCloseOnBackdropGesture({ target: dialog, currentTarget: overlay }, null),
    false,
    'click inside the dialog never closes, down-target or not'
  );
});
