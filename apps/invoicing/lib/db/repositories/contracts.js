// lib/db/repositories/contracts.js — the issued contract record (AS-39, plan §2.5).
//
// Immutable: a contract has no draft state and no update method, so there is no
// updated_at. `rendered_html` is the record of exactly what was issued;
// `variables` is the JSON the template was rendered with (round-tripped through
// JSON.parse on read). Owner-scoped like clients; the client must belong to the
// same freelancer — checked here for the friendlier NotFoundError('client'),
// and enforced again by the composite FK in the DDL.
import { transaction } from '../connection.js';
import { mapSqliteError, NotFoundError, assertKnownKeys, assertPlainObject, assertText } from '../errors.js';
import { assertOwnedClient } from './clients.js';

const SUMMARY_COLUMNS = 'id, freelancer_id, client_id, template_id, created_at';
const COLUMNS = `${SUMMARY_COLUMNS}, variables, rendered_html`;

function mapSummary(row) {
  return {
    id: row.id,
    freelancerId: row.freelancer_id,
    clientId: row.client_id,
    templateId: row.template_id,
    createdAt: row.created_at,
  };
}

function mapRow(row) {
  return { ...mapSummary(row), variables: JSON.parse(row.variables), renderedHtml: row.rendered_html };
}

function create(db, { now, newId }, freelancerId, input) {
  assertText(freelancerId, 'freelancerId');
  assertKnownKeys(input, ['clientId', 'templateId', 'variables', 'renderedHtml'], 'contract');
  const clientId = assertText(input.clientId, 'clientId');
  const templateId = assertText(input.templateId, 'templateId');
  const variables = assertPlainObject(input.variables, 'variables');
  const renderedHtml = assertText(input.renderedHtml, 'renderedHtml');
  const id = newId();
  return transaction(db, () => {
    assertOwnedClient(db, freelancerId, clientId);
    try {
      db.prepare(`INSERT INTO contracts (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        freelancerId,
        clientId,
        templateId,
        now(),
        JSON.stringify(variables),
        renderedHtml,
      );
    } catch (err) {
      throw mapSqliteError(err);
    }
    return getById(db, freelancerId, id);
  });
}

function getById(db, freelancerId, id) {
  assertText(freelancerId, 'freelancerId');
  assertText(id, 'id');
  const row = db.prepare(`SELECT ${COLUMNS} FROM contracts WHERE freelancer_id = ? AND id = ?`).get(freelancerId, id);
  if (row === undefined) throw new NotFoundError('contract', id);
  return mapRow(row);
}

/** Newest first. Summaries only: the rendered HTML is a document, not a list row. */
function listByFreelancer(db, freelancerId) {
  assertText(freelancerId, 'freelancerId');
  return db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM contracts WHERE freelancer_id = ? ORDER BY created_at DESC, rowid DESC`)
    .all(freelancerId)
    .map(mapSummary);
}

export function createContractsRepository(db, ctx) {
  return Object.freeze({
    create: (freelancerId, input) => create(db, ctx, freelancerId, input),
    getById: (freelancerId, id) => getById(db, freelancerId, id),
    listByFreelancer: (freelancerId) => listByFreelancer(db, freelancerId),
  });
}
