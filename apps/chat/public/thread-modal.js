// thread-modal.js — close-eligibility predicates for the thread modal (AS-19).
// No DOM construction, no fetch, no globals: importable from the browser
// (app.js) and from node:test alike (same pattern as scroll.js). The inputs
// are plain event-shaped objects — only `key`, `defaultPrevented`, `target`,
// and `currentTarget` are ever read — so tests use faithful plain-object
// doubles.

/**
 * Should a document-level keydown close the thread modal?
 *
 * The contract (plan AS-19):
 * - only Escape closes;
 * - only while the modal is visible (`modalHidden === false`);
 * - never when another handler already claimed the key (`defaultPrevented`) —
 *   this is what keeps the DM typeahead's own Escape wiring (which calls
 *   preventDefault before the event bubbles to document) untouched.
 *
 * @param {{ key?: string, defaultPrevented?: boolean }} evt
 * @param {boolean} modalHidden  The modal container's `hidden` property.
 * @returns {boolean}
 */
export function shouldCloseOnEscape(evt, modalHidden) {
  if (modalHidden) return false;
  if (!evt || evt.defaultPrevented) return false;
  return evt.key === 'Escape';
}

/**
 * Did a click land on the backdrop itself — the listener's own element, not a
 * descendant? The outer #thread-modal *is* the backdrop; clicks inside the
 * dialog bubble up with `target` pointing at the inner node, so they never
 * qualify.
 *
 * @param {{ target?: object, currentTarget?: object }} evt
 * @returns {boolean}
 */
export function isBackdropClick(evt) {
  return !!evt && evt.target === evt.currentTarget;
}

/**
 * Should a click on the backdrop actually close the modal, given where the
 * gesture STARTED? (AS-23, folding in the AS-19 QA backlog item c.)
 *
 * A text-selection drag that begins inside the dialog and releases on the
 * backdrop dispatches `click` on the common ancestor (#thread-modal) with
 * `target === currentTarget` — indistinguishable from a dismissal by
 * isBackdropClick alone. The caller records the `pointerdown` target and
 * passes it here: close only when the gesture began on the backdrop too.
 *
 * @param {{ target?: object, currentTarget?: object }} clickEvt
 * @param {object|null} downTarget  The preceding pointerdown's target, or
 *   null when no pointer event was seen (keyboard/synthetic click) — that
 *   falls back to the click-target check alone (legacy behavior).
 * @returns {boolean}
 */
export function shouldCloseOnBackdropGesture(clickEvt, downTarget) {
  // Close only when the gesture BEGAN on the backdrop too: a click whose
  // pointerdown landed inside the dialog is a text-selection drag, not a
  // dismissal. Null downTarget (no pointer event seen) falls back to the
  // click-target check alone.
  return isBackdropClick(clickEvt) &&
    (downTarget == null || downTarget === clickEvt.currentTarget);
}
