// config.js — settings resolution (AS-37, plan §7).
//
// loadConfig(env) is a PURE function: it reads the object it is handed and
// returns a frozen settings object. Only server.js calls it with process.env.
// app.js receives the result as an argument and never touches the environment
// itself, which is what lets every test construct settings without mutating
// process.env — and is in turn what makes the health check's failure paths
// testable (plan §3.3b, §7.1).
//
// The schema is DATA, not a pile of `||` defaults. Adding a setting is one row.
// AS-38 (Stripe) and AS-40 (sessions) add their own rows; the `secret` and
// `required` machinery below exists and is tested NOW, against a fixture
// schema, so those tasks inherit a tested mechanism rather than an untested one
// (plan §7.3). No credential is named here on purpose: there is no Stripe
// account (AS-51 is an open board ask) and declaring a key would encode exactly
// the assumption this scaffold must not encode.

/** The live schema. Every row: { key, envVar, type, default, required, secret }.
 *  At AS-37 nothing is `required` and nothing is `secret` — deliberately. */
export const SCHEMA = Object.freeze([
  { key: 'port', envVar: 'INVOICING_PORT', type: 'integer', default: 8348, min: 1, max: 65535 },
  { key: 'bind', envVar: 'INVOICING_BIND', type: 'string', default: '127.0.0.1' },
  { key: 'env', envVar: 'NODE_ENV', type: 'enum', default: 'development', values: ['development', 'test', 'production'] },
  { key: 'logLevel', envVar: 'INVOICING_LOG_LEVEL', type: 'enum', default: 'info', values: ['debug', 'info', 'warn', 'error'] },
  { key: 'vendorDir', envVar: 'INVOICING_VENDOR_DIR', type: 'path', default: '/app/vendor' },
  { key: 'viewsDir', envVar: 'INVOICING_VIEWS_DIR', type: 'path', default: '/app/views' },
  { key: 'publicDir', envVar: 'INVOICING_PUBLIC_DIR', type: 'path', default: '/app/public' },
].map(Object.freeze));

/** Config errors are read from a container log by someone with no debugger and
 *  no way to attach to a crashed container, so the env var's NAME is always in
 *  the message. Fail at boot; never coerce silently (plan §7.4). */
export class ConfigError extends Error {
  constructor(envVar, problem) {
    super(`${envVar}: ${problem}`);
    this.name = 'ConfigError';
    this.envVar = envVar;
  }
}

/** An env var set to '' or whitespace is treated as ABSENT (the default wins).
 *  Compose passes empty strings through for unset host variables, and an empty
 *  string is never a meaningful value for any type below. */
function present(raw) {
  return typeof raw === 'string' && raw.trim() !== '';
}

function coerce(row, raw) {
  const value = raw.trim();
  switch (row.type) {
    case 'integer': {
      if (!/^-?\d+$/.test(value)) throw new ConfigError(row.envVar, `expected an integer, got ${JSON.stringify(raw)}`);
      const n = Number(value);
      if (row.min !== undefined && n < row.min) throw new ConfigError(row.envVar, `must be >= ${row.min}, got ${n}`);
      if (row.max !== undefined && n > row.max) throw new ConfigError(row.envVar, `must be <= ${row.max}, got ${n}`);
      return n;
    }
    case 'enum':
      if (!row.values.includes(value)) {
        throw new ConfigError(row.envVar, `must be one of ${row.values.join(', ')}, got ${JSON.stringify(raw)}`);
      }
      return value;
    case 'path':
      // Absolute only. A relative path resolves against cwd, which differs
      // between `node server.js` in /app and any other invocation — an
      // ambiguity that shows up as a mysterious ENOENT rather than a config
      // error, which is the opposite of what §7.4 asks for.
      if (!value.startsWith('/')) throw new ConfigError(row.envVar, `must be an absolute path, got ${JSON.stringify(raw)}`);
      return value;
    case 'string':
      return value;
    default:
      throw new ConfigError(row.envVar, `unknown schema type ${JSON.stringify(row.type)}`);
  }
}

/**
 * Resolve settings from an environment object.
 *
 * @param {Record<string,string|undefined>} env  defaults to process.env
 * @param {Array} schema  defaults to SCHEMA; tests pass a fixture schema so the
 *   secret/required semantics are pinned before the first real secret exists.
 * @returns {Readonly<object>} frozen settings, with a non-enumerable
 *   `redacted()`. Enumerable keys are EXACTLY the schema keys.
 */
export function loadConfig(env = process.env, schema = SCHEMA) {
  const resolved = {};
  for (const row of schema) {
    const raw = env[row.envVar];
    if (present(raw)) {
      resolved[row.key] = coerce(row, raw);
      continue;
    }
    if (row.required) throw new ConfigError(row.envVar, 'is required and was not set');
    // An absent optional value is `null` — a first-class "unconfigured" state.
    // Never '' and never undefined: both leak into a caller looking like a
    // value, which is how an empty API key reaches a real call (plan §7.3).
    resolved[row.key] = row.default === undefined ? null : row.default;
  }

  Object.defineProperty(resolved, 'redacted', {
    value: () => {
      const out = {};
      for (const row of schema) out[row.key] = row.secret ? '[redacted]' : resolved[row.key];
      return out;
    },
    enumerable: false,
  });

  return Object.freeze(resolved);
}

/**
 * Re-validate an ALREADY-RESOLVED settings object against a schema.
 *
 * loadConfig validates raw strings at boot; this validates the object a caller
 * actually handed createApp. It exists because app.js takes config as an
 * argument (§3.3b) — so the live app can be holding a hand-built or partial
 * settings object that never went through loadConfig, and no boot-time check
 * would ever see it. That is a precondition supplied from outside the process,
 * which is precisely what the health check is for (plan §10.1).
 *
 * @returns {string[]} problems, empty when the object is well-formed.
 */
export function validateResolved(config, schema = SCHEMA) {
  const problems = [];
  if (config === null || typeof config !== 'object') return [`settings is not an object (got ${typeof config})`];
  for (const row of schema) {
    const value = config[row.key];
    if (value === undefined) {
      problems.push(`${row.key} (${row.envVar}) is missing`);
      continue;
    }
    if (value === null) {
      if (row.required) problems.push(`${row.key} (${row.envVar}) is required but unconfigured`);
      continue; // a legitimate "unconfigured" optional
    }
    switch (row.type) {
      case 'integer':
        if (!Number.isInteger(value)) problems.push(`${row.key} (${row.envVar}) is not an integer`);
        else if (row.min !== undefined && value < row.min) problems.push(`${row.key} (${row.envVar}) is below ${row.min}`);
        else if (row.max !== undefined && value > row.max) problems.push(`${row.key} (${row.envVar}) is above ${row.max}`);
        break;
      case 'enum':
        if (!row.values.includes(value)) problems.push(`${row.key} (${row.envVar}) is not one of ${row.values.join(', ')}`);
        break;
      case 'path':
        if (typeof value !== 'string' || !value.startsWith('/')) problems.push(`${row.key} (${row.envVar}) is not an absolute path`);
        break;
      case 'string':
        if (typeof value !== 'string') problems.push(`${row.key} (${row.envVar}) is not a string`);
        break;
      default:
        problems.push(`${row.key} (${row.envVar}) has unknown schema type ${JSON.stringify(row.type)}`);
    }
  }
  return problems;
}

/** The single startup log line. Uses redacted() and nothing else, so a secret
 *  added later cannot reach a log by default (plan §7.3 item 4). */
export function startupLogLine(config) {
  return `invoicing listening on ${config.bind}:${config.port} ${JSON.stringify(config.redacted())}`;
}
