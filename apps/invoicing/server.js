// server.js — the entrypoint (AS-37, plan §3.3a).
//
// The only file besides lib/config.js that touches process.env, and the only
// one that opens a socket. loadConfig() -> createApp() -> listen(). Anything
// more than that belongs in app.js or a route module.
//
// A bad setting throws out of loadConfig with the env var's name in the
// message and the process exits non-zero — a config error must be legible from
// a container log alone (plan §7.4).
import { createApp } from './app.js';
import { loadConfig, startupLogLine } from './lib/config.js';

const config = loadConfig();
const app = createApp(config);

// The app's own default bind is 127.0.0.1, so a misconfigured run fails closed.
// compose sets INVOICING_BIND=0.0.0.0 because binding loopback INSIDE the
// container makes the port map dead; loopback is enforced on the HOST side of
// the mapping instead ("127.0.0.1:8348:8348").
app.listen(config.port, config.bind, () => {
  console.log(startupLogLine(config));
});
