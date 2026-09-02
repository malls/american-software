// server.js — the entrypoint (AS-37, plan §3.3a; AS-39, plan §2.8; AS-41, §3.7).
//
// The only file besides lib/config.js that touches process.env, the only one
// that opens a socket, and the only one that opens the database.
// loadConfig() -> prepareDatabase() -> createApp(config, { repos, stripe }) ->
// listen(). Anything more than that belongs in app.js, lib/db/ or a route
// module: the entrypoint composes, it does not implement.
//
// No key configured is a fine way to boot (AS-38's rule stands): the client is
// constructed with apiKey null, and a Stripe-calling route answers 503 from
// the requireKey step — per call, AFTER the custody guard has run.
//
// A bad setting throws out of loadConfig with the env var's name in the
// message and the process exits non-zero — a config error must be legible from
// a container log alone (plan §7.4). A database that cannot be opened fails the
// same way, BEFORE the app exists, with the path in the message: a mis-mounted
// volume is loud, and the directory is never created (creating it would put
// the data in the container layer, to be lost on the next recreate).
import { createApp } from './app.js';
import { loadConfig, startupLogLine } from './lib/config.js';
import { createRepositories, prepareDatabase, SCHEMA_VERSION } from './lib/db/database.js';
import { createStripeClient } from './lib/stripe/client.js';

const config = loadConfig();
const { db, applied } = prepareDatabase(config);
// The operator's proof that migrations ran: `applied 1` on a fresh volume,
// `applied 0` on every later boot (the AS-39 acceptance transcript reads this).
console.log(`database ${config.dbPath}: schema v${SCHEMA_VERSION}, applied ${applied.length} migration(s)`);
const repos = createRepositories(db);
const stripe = createStripeClient({ apiKey: config.stripeSecretKey });
const app = createApp(config, { repos, stripe });

// The app's own default bind is 127.0.0.1, so a misconfigured run fails closed.
// compose sets INVOICING_BIND=0.0.0.0 because binding loopback INSIDE the
// container makes the port map dead; loopback is enforced on the HOST side of
// the mapping instead ("127.0.0.1:8348:8348").
const server = app.listen(config.port, config.bind, () => {
  console.log(startupLogLine(config));
});

// node is PID 1 in the container (CMD ["node", "server.js"], no init), and PID 1
// ignores SIGTERM unless it handles it: without this, `docker compose stop`
// waits out the 10 s grace period and SIGKILLs. With it, stop returns at once
// and close() checkpoints the WAL.
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
