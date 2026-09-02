// lib/db/errors.js — the repository error vocabulary, the mapping from the
// driver's errors onto it, and the input assertions that produce
// ValidationError (AS-39, plan §2.5). Imports nothing.
//
// Every error a repository throws extends RepositoryError and carries a stable
// `code`, so a route maps an error to a status by `code` and never by matching
// message text. The codes: not_found, unique_violation, foreign_key_violation,
// invalid_state, validation, migration.

export class RepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

/** Missing OR not owned by the caller — the same error on purpose, so
 *  "someone else's record" renders as not-found (S5-DENIED-NOTOWNER). */
export class NotFoundError extends RepositoryError {
  constructor(entity, id = undefined) {
    super('not_found', id === undefined ? `${entity} not found` : `${entity} not found: ${id}`);
    this.name = 'NotFoundError';
    this.entity = entity;
    this.id = id;
  }
}

export class UniqueViolationError extends RepositoryError {
  constructor(constraint) {
    super('unique_violation', `unique constraint violated: ${constraint}`);
    this.name = 'UniqueViolationError';
    this.constraint = constraint;
  }
}

export class ForeignKeyViolationError extends RepositoryError {
  constructor(message = 'foreign key constraint violated') {
    super('foreign_key_violation', message);
    this.name = 'ForeignKeyViolationError';
  }
}

export class InvalidStateError extends RepositoryError {
  constructor(message) {
    super('invalid_state', message);
    this.name = 'InvalidStateError';
  }
}

export class ValidationError extends RepositoryError {
  constructor(field, problem) {
    super('validation', `${field}: ${problem}`);
    this.name = 'ValidationError';
    this.field = field;
    this.problem = problem;
  }
}

export class MigrationError extends RepositoryError {
  constructor(message) {
    super('migration', message);
    this.name = 'MigrationError';
  }
}

// --- the driver's errors, mapped ----------------------------------------------

/** The `code` node:sqlite puts on every engine error; the extended result code
 *  is `errcode`. The five that a repository can provoke after its own
 *  validation has passed are mapped; anything else is returned unchanged so the
 *  caller rethrows it as the unknown failure it is. */
const SQLITE_ERROR = 'ERR_SQLITE_ERROR';
const CONSTRAINT_CHECK = 275;
const CONSTRAINT_FOREIGNKEY = 787;
const CONSTRAINT_PRIMARYKEY = 1555;
const CONSTRAINT_UNIQUE = 2067;
const CONSTRAINT_DATATYPE = 3091;

/**
 * Map a thrown driver error onto the vocabulary above. Usage is always
 * `throw mapSqliteError(err)`: the return value is the error to throw, which is
 * `err` itself when it is not an engine error, or an engine error this layer
 * does not interpret.
 *
 * The CHECK and STRICT-datatype cases become ValidationError: they are a
 * constraint the validator should have caught first, and even then they are a
 * bad request, never a 500.
 */
export function mapSqliteError(err) {
  if (err === null || typeof err !== 'object' || err.code !== SQLITE_ERROR) return err;
  const message = String(err.message);
  // "UNIQUE constraint failed: freelancers.id" / "... failed: index 'x'" /
  // "CHECK constraint failed: <expression>" — the part after `failed: ` names
  // the constraint; a message without it is passed on whole.
  const marker = 'failed: ';
  const at = message.indexOf(marker);
  const constraint = at === -1 ? message : message.slice(at + marker.length);
  let mapped;
  switch (err.errcode) {
    case CONSTRAINT_UNIQUE:
    case CONSTRAINT_PRIMARYKEY:
      mapped = new UniqueViolationError(constraint);
      break;
    case CONSTRAINT_FOREIGNKEY:
      mapped = new ForeignKeyViolationError();
      break;
    case CONSTRAINT_CHECK:
      mapped = new ValidationError('check', constraint);
      break;
    case CONSTRAINT_DATATYPE: {
      // "cannot store TEXT value in INTEGER column table.column"
      const column = message.match(/column (\S+)$/)?.[1] ?? 'value';
      mapped = new ValidationError(column, message);
      break;
    }
    default:
      return err;
  }
  mapped.cause = err;
  return mapped;
}

// --- input assertions --------------------------------------------------------
// Each returns the value it accepted, so a caller can validate and bind in one
// expression. Validation runs BEFORE any SQL (plan §2.5): the DDL CHECKs are the
// backstop, proven separately by the raw-DDL tests.

/** ISO-8601 UTC with milliseconds — exactly what Date#toISOString produces and
 *  the only timestamp shape stored (plan §2.4). A Stripe epoch that was never
 *  converted is a ValidationError here, not a silently unsortable column. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PREFIXED_ID_BODY = /^[A-Za-z0-9_]+$/;

export function assertText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(field, 'must be a non-empty string');
  }
  return value;
}

export function assertOptionalText(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(field, 'must be a string or null');
  return value;
}

export function assertBoolean(value, field) {
  if (typeof value !== 'boolean') throw new ValidationError(field, 'must be true or false');
  return value;
}

export function assertTimestamp(value, field) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) {
    throw new ValidationError(field, 'must be an ISO-8601 UTC timestamp with milliseconds (Date#toISOString)');
  }
  return value;
}

export function assertOptionalTimestamp(value, field) {
  return value === null ? null : assertTimestamp(value, field);
}

/** A Stripe object id: the given prefix (`acct_`, `cus_`, `in_`, `evt_`) and a
 *  non-empty alphanumeric body. The DDL checks the prefix too, with substr —
 *  this is the friendlier error for the same swapped-argument bug. */
export function assertStripeId(value, field, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix) || !PREFIXED_ID_BODY.test(value.slice(prefix.length))) {
    throw new ValidationError(field, `must be a Stripe id starting with ${prefix}`);
  }
  return value;
}

export function assertPlainObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ValidationError(field, 'must be a plain object');
  }
  return value;
}

/** Reject any key not in `allowed`, so a misspelled field (`invoicePdf` for
 *  `invoicePdfUrl`) cannot be dropped silently (plan §2.5). */
export function assertKnownKeys(value, allowed, field) {
  assertPlainObject(value, field);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ValidationError(`${field}.${key}`, `unknown field; known: ${allowed.join(', ')}`);
  }
  return value;
}

export function assertStringArray(value, field) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new ValidationError(field, 'must be an array of non-empty strings');
  }
  return value;
}
