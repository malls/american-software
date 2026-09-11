// lib/compose-run.js — AS-106: the pure logic behind bin/compose-run.mjs, the
// one canonical way to take a counted compose receipt.
//
// Why this exists: `docker compose -p <p> run --rm --build test` removes only
// the container. The project's `default` network and its `<p>-test` image
// survive until someone runs `down`; every reviewer's recipe stopped at the
// `Built` line, and at ~27 leaked `asc-*` networks Docker Desktop's address
// pool ran dry and voided three counted acceptance runs. This module makes
// the teardown and the leak check part of the receipt, and makes the leak
// observable (`classifyNetworks`) before it bites (`preflight`).
//
// Everything here takes an injected `exec(argv, opts) -> {status, stdout,
// stderr}` so it is host-testable without docker (the compose test image has
// none). Zero dependencies, node:* only.

/** Exit codes of the CLI. Named so the tests and the README say the same thing. */
export const EXIT = Object.freeze({
  BAD_PROJECT: 2,   // name refused, no docker call made
  CEILING: 3,       // too many asc-* networks already; no run made
  LEAK: 4,          // run + down happened, but something of the project survived
  NO_BUILD: 5,      // the run produced no `Built` line — not a receipt
});

/** Default leftover ceiling (plan Q2): the pool is ~30; production + three lanes = 6. */
export const DEFAULT_CEILING = 20;

/** Every project name this tool will touch matches this. */
export const PROJECT_RE = /^asc-[a-z0-9-]+$/;

/**
 * Reads the `name:` line of a compose file. Returns null when there is none
 * (a project without `name:` derives it from its directory, which is not one
 * of ours to protect by name).
 */
export function composeProjectName(composeText) {
  const m = /^name:\s*([^\s#]+)/m.exec(composeText);
  return m ? m[1] : null;
}

/**
 * The project-name guard (plan §2(b)1). Refuses production names (the `name:`
 * of every apps/x/compose.yaml), anything outside PROJECT_RE (so `/`,
 * whitespace, uppercase, non-`asc-` prefixes), and any project `compose ls`
 * already reports — a name this invocation did not create is someone else's
 * lane, and `down` on it would be exactly the AS-88 hazard.
 * -> { ok: true } | { ok: false, reason }
 */
export function isAllowedProject(name, { productionNames = [], runningProjects = [] } = {}) {
  if (typeof name !== 'string' || !PROJECT_RE.test(name)) {
    return { ok: false, reason: `project name must match ${PROJECT_RE} (got ${JSON.stringify(name)})` };
  }
  if (productionNames.includes(name)) {
    return { ok: false, reason: `${name} is a production compose project` };
  }
  if (runningProjects.includes(name)) {
    return { ok: false, reason: `${name} is already a running compose project (someone else's lane)` };
  }
  return { ok: true };
}

export function buildRunArgs(project) {
  return ['compose', '-p', project, 'run', '--rm', '--build', 'test'];
}

export function buildDownArgs(project) {
  return ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'];
}

/** `docker network ls --format {{.Name}}` -> names. Blank lines dropped. */
export function parseNetworkLs(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** `docker compose ls -a --format json` -> project names. Tolerates empty/garbage. */
export function parseComposeLs(text) {
  try {
    const arr = JSON.parse(text || '[]');
    return Array.isArray(arr) ? arr.map((p) => p && p.Name).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort owner guess from a network name, for the `--check` listing.
 * `asc-review-as102_default` -> "AS-102 reviewer"; `asc-as94-lena_default` ->
 * "AS-94 lena"; `asc-marcus95_default` -> "marcus AS-95". Unknown shapes get
 * "unknown" — the listing is a lead for the orchestrator, never an authority.
 */
export function guessOwner(networkName) {
  const base = networkName.replace(/^asc-/, '').replace(/_[a-z0-9-]+$/, '');
  const task = /as-?(\d+)/.exec(base);
  const stage = /(review|impl|qa|mutant|master|probe|real)/.exec(base);
  const person = /(marcus|lena|priya|ruben|owen|carla)/.exec(base);
  const parts = [];
  if (task) parts.push(`AS-${task[1]}`);
  if (person) parts.push(person[1]);
  if (stage) parts.push(stage[1] === 'qa' ? 'reviewer' : stage[1]);
  return parts.length ? parts.join(' ') : 'unknown';
}

/**
 * Classifies every `asc-*` network (plan §2(c)). A network belongs to the
 * project whose name prefixes it up to the last `_`: `asc-chat_default` ->
 * `asc-chat`, `asc-invoicing_stripe-mock` -> `asc-invoicing`.
 * -> { production: [...], live: [...], leftover: [{ network, project, owner }] }
 */
export function classifyNetworks(networkNames, runningProjects, productionNames) {
  const out = { production: [], live: [], leftover: [] };
  for (const network of networkNames) {
    if (!network.startsWith('asc-')) continue;
    const project = network.replace(/_[^_]*$/, '');
    if (productionNames.includes(project)) out.production.push(network);
    else if (runningProjects.includes(project)) out.live.push(network);
    else out.leftover.push({ network, project, owner: guessOwner(network) });
  }
  return out;
}

/**
 * Receipt parsing (plan §2(b)6, AC-7). `built` is true only when a compose
 * `Built` line is present — the `--build` corollary made executable. Counts
 * come from node's `# tests N` summary; missing counts are null, never 0.
 */
export function parseReceipt(output) {
  const lines = String(output || '').split('\n');
  const builtLine = lines.find((l) => /\bBuilt\b/.test(l) && /Image|Built/.test(l)) || null;
  // node's summary is `# tests N` under the TAP reporter (no TTY) and
  // `ℹ tests N` under spec (compose `run` allocates a TTY) — measured in the
  // AC-1 probe; both are read.
  const count = (key) => {
    const m = new RegExp(`^(?:#|ℹ)\\s*${key} (\\d+)`, 'm').exec(output || '');
    return m ? Number(m[1]) : null;
  };
  return {
    built: builtLine !== null,
    builtLine: builtLine ? builtLine.trim() : null,
    tests: count('tests'),
    pass: count('pass'),
    fail: count('fail'),
    skipped: count('skipped'),
  };
}

/** Text of a receipt block, one line per fact — what a reviewer pastes. */
export function formatReceipt(r) {
  return [
    `RECEIPT project=${r.project}`,
    `  built: ${r.receipt.built ? r.receipt.builtLine : 'missing'}`,
    `  tests=${r.receipt.tests} pass=${r.receipt.pass} fail=${r.receipt.fail} skipped=${r.receipt.skipped}`,
    `  run exit=${r.runStatus}${r.runError ? ` (threw: ${r.runError})` : ''}`,
    `  down exit=${r.downStatus}`,
    `  leak check: ${r.leaks.length ? `LEAK: ${r.leaks.join(', ')}` : 'clean (0 networks, 0 images for this project)'}`,
    `  exit=${r.exit}`,
  ].join('\n');
}

const s = (r) => (r && r.stdout) || '';

/** Docker-side observations the run and the check both need. */
function observe(exec, { docker }) {
  const networks = parseNetworkLs(s(exec([docker, 'network', 'ls', '--format', '{{.Name}}'])));
  const running = parseComposeLs(s(exec([docker, 'compose', 'ls', '--format', 'json'])));
  return { networks, running };
}

/**
 * The pre-flight (plan §2(b)2, AC-9): refuse at or above the ceiling.
 * -> { ok, count, ceiling, classified }
 */
export function preflight({ networks, running, productionNames, ceiling = DEFAULT_CEILING }) {
  const classified = classifyNetworks(networks, running, productionNames);
  const count = networks.filter((n) => n.startsWith('asc-')).length;
  return { ok: count < ceiling, count, ceiling, classified };
}

/**
 * `--check` (plan §2(c), AC-10): observe and classify, remove nothing.
 * -> { exit: 0|1, classified, count }
 */
export function runCheck(exec, { docker, productionNames }) {
  const { networks, running } = observe(exec, { docker });
  const classified = classifyNetworks(networks, running, productionNames);
  return { exit: classified.leftover.length ? 1 : 0, classified, count: networks.filter((n) => n.startsWith('asc-')).length };
}

/**
 * The counted run (plan §2(b)). Order: guard -> pre-flight -> run -> ALWAYS
 * down -> leak check -> receipt. `down` is the `trap … EXIT` of the shell
 * recipe: it runs whether `run` exits 0, exits non-zero, or throws, and the
 * run's own status is what is reported. `onOutput` receives the run's raw
 * output for teeing to a log.
 * -> { exit, project, runStatus, runError, downStatus, receipt, leaks, refused }
 */
export function runCounted(exec, {
  docker, project, cwd, productionNames = [], env = {}, ceiling = DEFAULT_CEILING, onOutput = () => {},
}) {
  const { networks, running } = observe(exec, { docker });
  const allowed = isAllowedProject(project, { productionNames, runningProjects: running });
  if (!allowed.ok) return { exit: EXIT.BAD_PROJECT, project, refused: allowed.reason };
  const pre = preflight({ networks, running, productionNames, ceiling });
  if (!pre.ok) {
    const list = pre.classified.leftover.map((l) => `${l.network} (${l.owner})`).join(', ');
    return { exit: EXIT.CEILING, project, refused: `${pre.count} asc-* networks >= ceiling ${pre.ceiling}; leftovers: ${list || 'none'}`, preflight: pre };
  }
  const runEnv = { ...env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
  let runStatus = null;
  let runError = null;
  let output = '';
  // From here on, down runs no matter what — that is the whole point.
  try {
    const r = exec([docker, ...buildRunArgs(project)], { cwd, env: runEnv });
    runStatus = r.status;
    output = (r.stdout || '') + (r.stderr || '');
  } catch (e) {
    runError = e && e.message ? e.message : String(e);
    runStatus = runStatus ?? 1;
  }
  onOutput(output);
  let downStatus;
  try {
    downStatus = exec([docker, ...buildDownArgs(project)], { cwd, env: runEnv }).status;
  } catch (e) {
    downStatus = `threw: ${e && e.message ? e.message : e}`;
  }
  // Leak assertion (AC-6): anchored at `^<project>_` so a project that is a
  // prefix of a live one (asc-review-as10 vs asc-review-as102) does not match
  // the live lane's network.
  const leftNets = parseNetworkLs(s(exec([docker, 'network', 'ls', '--format', '{{.Name}}'])))
    .filter((n) => n.startsWith(`${project}_`));
  const leftImgs = parseNetworkLs(s(exec([docker, 'images', '--format', '{{.Repository}}:{{.Tag}}'])))
    .filter((n) => n.startsWith(`${project}-`));
  const leaks = [...leftNets, ...leftImgs];
  const receipt = parseReceipt(output);
  let exit = runStatus === 0 ? 0 : (typeof runStatus === 'number' ? runStatus : 1);
  if (leaks.length) exit = EXIT.LEAK;
  else if (!receipt.built) exit = EXIT.NO_BUILD;
  return { exit, project, runStatus, runError, downStatus, receipt, leaks };
}
