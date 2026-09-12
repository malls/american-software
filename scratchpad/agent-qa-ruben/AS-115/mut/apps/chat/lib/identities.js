// lib/identities.js — startup reconciliation of chat identities from
// personnel/ dossiers (AS-89).
//
// The dossier is the org source of truth (AS-8) and the identities table is
// the only derived state that was not derived: a hired employee had no chat
// identity until someone ran `chat register` for them, and qa-ruben was mute
// for three days because nobody did. This module closes that gap at the two
// places the DB is opened for writing (createChatServer and the CLI's
// direct-mode backend): every ACTIVE dossier whose actor_id the identities
// table does not know is registered, display name from the dossier's `name`,
// kind from the id's prefix.
//
// Lives beside lib/personnel.js rather than in it: that module's contract is
// "never writes anything", and this one writes the DB. It reads personnel
// through the existing parser and does not widen it.
//
// Deliberate non-actions (plan §2):
// - departed dossiers are never registered; an identity that already exists
//   for a departed person is never removed (identities are insert-only).
// - an actor_id already registered under a different display name is left
//   exactly as it is and counted as `existing` — the DB name is the history
//   messages were rendered under; the dossier is not a rename mechanism.
// - a per-dossier registerIdentity failure is caught into `skipped` and
//   never takes the caller down; a missing personnel/ dir yields the empty
//   result via readPersonnel's own degradation contract (AS-8).

import { readPersonnel } from './personnel.js';

/**
 * Register every active dossier's actor_id that `store` does not know.
 * Idempotent: a second run on the same DB registers nothing.
 *
 * Returns { registered, existing, skipped, examined } where `examined` is the
 * number of active dossiers considered — cardinality before quantification:
 * examined === registered.length + existing.length + skipped.length.
 */
export function reconcileIdentities({ store, root }) {
  const registered = [];
  const existing = [];
  const skipped = [];
  let examined = 0;
  const active = readPersonnel(root).roster.filter((e) => e.status === 'active');
  for (const entry of active) {
    examined++;
    const actorId = entry.actorId;
    if (store.getIdentity(actorId)) {
      existing.push(actorId);
      continue;
    }
    try {
      store.registerIdentity({
        id: actorId,
        displayName: entry.name,
        kind: actorId.slice(0, actorId.indexOf(':')),
      });
      registered.push(actorId);
    } catch (err) {
      skipped.push({ actorId, reason: err?.message ?? String(err) });
    }
  }
  return { registered, existing, skipped, examined };
}
