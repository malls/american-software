// lib/contracts/generation.js — validate -> resolve -> render -> persist
// (AS-42, plan §3.6). The one place a contract comes into existence.
//
// THE ORDER IS LOAD-BEARING. Every refusal happens before anything is written:
// an unknown template, an unknown field, a bad value and a client that is not
// this freelancer's are all raised before repos.contracts.create is reached, so
// a failed generation leaves no row.
//
// WHY THE MERGED MAP IS STORED, NOT JUST THE FORM INPUT. Clients can be renamed
// and freelancers can change their display name. If record-sourced values were
// re-read at render time, an issued document would silently change meaning when
// a record changed. Storing the RESOLVED values makes `variables` a snapshot of
// exactly what the document says — which is what makes the reproduction
// invariant true: renderContract(getTemplate(c.templateId), c.variables) equals
// c.renderedHtml, byte for byte.
//
// THE FORM-KEY CHECK LIVES HERE AND NOWHERE ELSE. routes/contracts.js keeps no
// allowlist of its own, so the two cannot drift. It has two jobs: reject
// nonsense fields, and reject a request supplying a RECORD-sourced name. The
// second is the one that matters — without it a request could post
// `freelancerName=Someone Else` and issue a document in another person's name.
import { NotFoundError, ValidationError } from '../db/database.js';
import { DEFAULT_TEMPLATE_ID, getTemplate } from './templates.js';
import { assertCalendarDate, renderContract } from './render.js';

/** Per-type ceilings, applied when a declaration states no narrower maxLength.
 *  A total-output bound would be a second, redundant rule (plan §9 Q4); the
 *  route's own parser limit is the outer one. */
const TYPE_MAX_LENGTH = Object.freeze({ text: 200, multiline: 5000, date: 10 });

/** One form value, by its declared type. Returns the value to store. */
function validateFormValue(variable, raw) {
  if (raw === undefined) {
    if (variable.required) throw new ValidationError(variable.name, 'is required');
    return undefined;
  }
  // A repeated or nested parameter arrives as something other than a string,
  // and that is nobody's valid input.
  if (typeof raw !== 'string') throw new ValidationError(variable.name, 'must be a single text value');
  if (raw.trim().length === 0) {
    if (variable.required) throw new ValidationError(variable.name, 'is required — a blank value is not a value');
    return undefined;
  }
  const limit = variable.maxLength ?? TYPE_MAX_LENGTH[variable.type];
  if (raw.length > limit) {
    throw new ValidationError(variable.name, `must be at most ${limit} characters, got ${raw.length}`);
  }
  if (variable.type === 'date') assertCalendarDate(raw, variable.name);
  return raw;
}

/**
 * @param {{ repos: object }} deps the repositories, exactly as every other
 *   service on this app takes them
 * @returns {{ generate: (freelancerId: string, input: object) => object }}
 */
export function createContractGeneration({ repos }) {
  /**
   * @param {string} freelancerId ALWAYS the session's — the route reads it from
   *   the one sanctioned accessor and never from the request
   * @param {{ clientId: string, templateId?: string, formValues: object }} input
   * @returns {object} the persisted contract row
   */
  function generate(freelancerId, input) {
    const { clientId, templateId, formValues } = input;

    // 1. Which legal text is being issued. Unknown is a NotFoundError, which
    //    the route answers as a 404 exactly like an unknown client.
    const template = getTemplate(templateId ?? DEFAULT_TEMPLATE_ID);

    // 2. The form key set, against the FORM-SOURCED names alone.
    const formVariables = template.variables.filter((variable) => variable.source === 'form');
    const formNames = new Set(formVariables.map((variable) => variable.name));
    const recordNames = new Set(
      template.variables.filter((variable) => variable.source === 'record').map((variable) => variable.name),
    );
    const submitted = formValues === null || typeof formValues !== 'object' ? {} : formValues;
    for (const key of Object.keys(submitted)) {
      if (formNames.has(key)) continue;
      if (recordNames.has(key)) {
        throw new ValidationError(key, 'is resolved from your own records and cannot be supplied');
      }
      throw new ValidationError(key, `unknown field; known: ${[...formNames].join(', ')}`);
    }

    // 3. Each declared form value, by its type. A missing required value names
    //    the field — never a silent blank.
    const variables = {};
    for (const variable of formVariables) {
      const value = validateFormValue(variable, submitted[variable.name]);
      if (value !== undefined) variables[variable.name] = value;
    }

    // 4. The record-sourced values, both owner-scoped. A client that is missing
    //    OR another freelancer's is the same NotFoundError, raised HERE, before
    //    anything is rendered or written.
    if (typeof clientId !== 'string' || clientId.trim().length === 0) {
      throw new ValidationError('clientId', 'must be a non-empty string');
    }
    variables.freelancerName = repos.freelancers.getById(freelancerId).displayName;
    variables.clientName = repos.clients.getById(freelancerId, clientId).name;

    // A declaration whose record-sourced set grew without this function growing
    // with it would render a blank rather than fail. It fails instead.
    for (const name of recordNames) {
      if (typeof variables[name] !== 'string') {
        throw new NotFoundError('template variable', `${template.id}.${name}`);
      }
    }

    // 5 and 6. Render, then persist the merged map alongside the document it
    //    produced. Every value here is a validated string, so the repository's
    //    JSON.stringify cannot meet a BigInt or a cyclic object on this path.
    const renderedHtml = renderContract(template, variables);
    return repos.contracts.create(freelancerId, {
      clientId,
      templateId: template.id,
      variables,
      renderedHtml,
    });
  }

  return Object.freeze({ generate });
}
