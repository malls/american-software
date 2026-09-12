// lib/contracts/templates.js — the contract template registry (AS-42, plan §3.1–§3.3).
//
// TEMPLATES ARE CODE, AND NEVER USER-SUPPLIED. A template is a frozen
// declaration under lib/contracts/ that ships in the image — not a row in the
// database, not a file on disk. That is a security property rather than a
// convenience: a user-supplied template means user-controlled template SOURCE,
// which is server-side template injection by construction — the caller would
// supply not values but the document's own structure. There is no
// user-supplied template path in v1 and this registry leaves no seam for one.
//
// THE VERSION RIDES IN THE ID (`...@1`), which is why there is no
// template_version column and no migration (plan §3.2). A version is not an
// attribute OF a family — it IS a different template, for the only purpose the
// id serves here: naming the exact declaration a stored document came from.
// That is what makes the reproduction invariant true —
// renderContract(getTemplate(c.templateId), c.variables) equals c.renderedHtml
// byte for byte — and it would be unprovable under an unversioned id, because
// after the body text is replaced the re-render would silently differ with no
// marker saying why. Replacing the placeholder body is a NEW declaration with
// id `...@2` added here, DEFAULT_TEMPLATE_ID repointed, and `@1` KEPT so
// already-issued contracts stay reproducible. Retiring a version means removing
// it from selection, never from the registry. A digest committed in
// test/contracts.test.js keeps the version honest: change a word of the body
// without bumping the id and the suite goes red.
//
// THE ATTRIBUTION CROSS-CHECK IS A MECHANISM, NOT A FIELD (C-18). Every
// declaration must carry a non-empty `attribution` AND an explicit
// `sourceTemplate` — null, or { name, licence, url }. When a source IS
// declared, the attribution must contain its licence as a substring, checked at
// module load. Declaring a CC BY 4.0 source and forgetting to say so in the
// rendered line is then a boot failure, not a licence breach discovered later.
// The check is exercised today against a fixture declaration in the test file,
// so it is a used exemption from the day it ships rather than dead code.
import { NotFoundError } from '../db/database.js';
import { INDEPENDENT_CONTRACTOR_AGREEMENT_V1 } from './templates/independent-contractor-agreement.js';

/** An id names a family AND a version: `family-name@<digits>`. */
const ID_SHAPE = /^[a-z][a-z0-9-]*@\d+$/;

/** Where a value comes from. `record` is resolved from the freelancer's own
 *  rows and can never be supplied by a request; `form` is the freelancer's
 *  input. The split is what makes "post freelancerName=Someone Else" a refusal
 *  rather than a document issued in another person's name. */
const SOURCES = new Set(['record', 'form']);

/** How a value is validated and rendered. */
const TYPES = new Set(['text', 'multiline', 'date']);

/** Recursive freeze. Freeze first, then descend: a declaration that somehow
 *  referred to itself would otherwise recur forever. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A malformed declaration is a programming defect that must crash at boot, not
 *  at a freelancer's first contract — so it is a TypeError, in the spirit of
 *  app.js's fail-at-boot rule, and never a RepositoryError. */
function fail(message) {
  throw new TypeError(`contract template: ${message}`);
}

function assertNonEmptyString(value, what) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${what} must be a non-empty string`);
  return value;
}

/** Every segment of every block, flattened — the one walk both slot checks use. */
function segmentsOf(body) {
  return body.flat();
}

/**
 * The load-time validator. Exported so the test file can drive it directly
 * against deliberately deficient fixture declarations — which is what keeps the
 * attribution cross-check a used exemption rather than an untested claim.
 *
 * @param {object} declaration
 * @returns {object} the same declaration, so a caller can validate and bind in
 *   one expression
 */
export function assertTemplate(declaration) {
  if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) {
    fail('a declaration must be an object');
  }
  const { id, title, sourceTemplate, attribution, notice, variables, body } = declaration;

  // 1. Identity, carrying its version.
  if (typeof id !== 'string' || !ID_SHAPE.test(id)) {
    fail(`id ${JSON.stringify(id)} must look like family-name@1 — the version rides in the id`);
  }
  assertNonEmptyString(title, `${id}: title`);

  // 4. Attribution, and the cross-check that makes it a mechanism.
  assertNonEmptyString(attribution, `${id}: attribution`);
  if (sourceTemplate === undefined) {
    fail(`${id}: sourceTemplate must be declared explicitly — null, or { name, licence, url }`);
  }
  if (sourceTemplate !== null) {
    if (typeof sourceTemplate !== 'object' || Array.isArray(sourceTemplate)) {
      fail(`${id}: sourceTemplate must be null or an object`);
    }
    for (const key of ['name', 'licence', 'url']) {
      assertNonEmptyString(sourceTemplate[key], `${id}: sourceTemplate.${key}`);
    }
    if (!attribution.includes(sourceTemplate.licence)) {
      fail(`${id}: attribution does not name the declared licence ${JSON.stringify(sourceTemplate.licence)} — a declared source must be credited in the rendered line`);
    }
  }

  // The notice is part of the document, so it is required structure.
  if (notice === null || typeof notice !== 'object' || Array.isArray(notice)) fail(`${id}: notice must be an object`);
  assertNonEmptyString(notice.title, `${id}: notice.title`);
  if (!Array.isArray(notice.paragraphs) || notice.paragraphs.length === 0) {
    fail(`${id}: notice.paragraphs must be a non-empty array`);
  }
  notice.paragraphs.forEach((text, i) => assertNonEmptyString(text, `${id}: notice.paragraphs[${i}]`));

  // 3. Every variable's source and type are known, and `required` belongs to
  //    form-sourced variables alone — a record-sourced one is always resolved,
  //    so a `required` on it would be a flag nothing reads.
  if (!Array.isArray(variables) || variables.length === 0) fail(`${id}: variables must be a non-empty array`);
  const names = new Set();
  for (const variable of variables) {
    if (variable === null || typeof variable !== 'object') fail(`${id}: each variable must be an object`);
    const name = assertNonEmptyString(variable.name, `${id}: variable name`);
    if (names.has(name)) fail(`${id}: variable ${name} is declared twice`);
    names.add(name);
    if (!SOURCES.has(variable.source)) fail(`${id}: ${name}.source must be one of ${[...SOURCES].join(', ')}`);
    if (!TYPES.has(variable.type)) fail(`${id}: ${name}.type must be one of ${[...TYPES].join(', ')}`);
    assertNonEmptyString(variable.label, `${id}: ${name}.label`);
    if (variable.source === 'form') {
      if (typeof variable.required !== 'boolean') fail(`${id}: form-sourced ${name} must declare required as a boolean`);
    } else if (variable.required !== undefined) {
      fail(`${id}: record-sourced ${name} must not declare required — it is always resolved`);
    }
    if (variable.maxLength !== undefined && (!Number.isInteger(variable.maxLength) || variable.maxLength <= 0)) {
      fail(`${id}: ${name}.maxLength must be a positive integer`);
    }
  }

  // The body's vocabulary: a block is an array of segments, and a segment is
  // either template-authored text or a slot reference. There is no substitution
  // SYNTAX anywhere in it, which is why there is no parser (see render.js).
  if (!Array.isArray(body) || body.length === 0) fail(`${id}: body must be a non-empty array of blocks`);
  for (const block of body) {
    if (!Array.isArray(block) || block.length === 0) fail(`${id}: each body block must be a non-empty array of segments`);
    for (const segment of block) {
      if (segment === null || typeof segment !== 'object') fail(`${id}: each body segment must be an object`);
      const hasText = segment.text !== undefined;
      const hasSlot = segment.slot !== undefined;
      if (hasText === hasSlot) fail(`${id}: a body segment carries exactly one of text or slot`);
      assertNonEmptyString(hasText ? segment.text : segment.slot, `${id}: segment ${hasText ? 'text' : 'slot'}`);
      if (segment.strong !== undefined && typeof segment.strong !== 'boolean') {
        fail(`${id}: segment strong must be a boolean when present`);
      }
    }
  }

  // 2. BOTH DIRECTIONS. A slot with no declaration is a render-time crash; a
  //    declared-but-unreferenced variable is a form field that goes nowhere.
  const slots = new Set(segmentsOf(body).filter((s) => s.slot !== undefined).map((s) => s.slot));
  for (const slot of slots) if (!names.has(slot)) fail(`${id}: body names slot ${slot}, which is not declared`);
  for (const name of names) if (!slots.has(name)) fail(`${id}: variable ${name} is declared but never referenced by the body`);

  return declaration;
}

/** Every declaration that has ever shipped. A retired version stays here so
 *  its already-issued contracts keep reproducing; it leaves DEFAULT_TEMPLATE_ID
 *  instead. */
const DECLARATIONS = [INDEPENDENT_CONTRACTOR_AGREEMENT_V1];

/** Validated at module load, so a malformed declaration crashes at boot rather
 *  than at a freelancer's first contract. Object.freeze cannot seal a Map's
 *  ENTRIES — the immutability that matters is the deepFreeze on each
 *  declaration, plus there being no `.set` call outside this module, which is
 *  one grep. Every consumer goes through getTemplate. */
export const TEMPLATES = Object.freeze(
  new Map(DECLARATIONS.map((declaration) => [assertTemplate(deepFreeze(declaration)).id, declaration])),
);

// Invariant 1's second half: two declarations sharing an id would collapse into
// one Map entry, silently retiring the first. Vacuous at one template and
// deliberately kept: it is the check that stops being vacuous at M4.
if (TEMPLATES.size !== DECLARATIONS.length) {
  fail(`two declarations share an id — ${DECLARATIONS.length} declared, ${TEMPLATES.size} registered`);
}

// Re-exported so every consumer imports the registry AND the declaration from
// one module — and so the object they get is the frozen one this file froze.
export { INDEPENDENT_CONTRACTOR_AGREEMENT_V1 };

/** Selection when a request names none. Repointed, never redefined, at M4. */
export const DEFAULT_TEMPLATE_ID = INDEPENDENT_CONTRACTOR_AGREEMENT_V1.id;

/**
 * @param {string} id a versioned template id
 * @returns {object} the frozen declaration
 * @throws {NotFoundError} for an id no declaration carries — which is a 404 at
 *   the route, exactly like an unknown client
 */
export function getTemplate(id) {
  const declaration = TEMPLATES.get(id);
  if (declaration === undefined) throw new NotFoundError('template', typeof id === 'string' ? id : String(id));
  return declaration;
}
