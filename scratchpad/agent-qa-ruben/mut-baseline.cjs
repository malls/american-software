const fs = require('fs'); const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8'); const before = s;
const OLD = "  const port = LOOPBACK_HOSTS.has(location.hostname) ? LOOPBACK_PORT : REMOTE_PORT;\n  return `${location.protocol}//${hostForUrl(location.hostname)}:${port}/#/task/${encodeURIComponent(taskId)}`;\n";
const NEW = "  return 'http://127.0.0.1:8799/#/task/' + taskId; // MUTANT-BASELINE\n";
s = s.replace(OLD, NEW); if (s === before) { console.error('MUTATION DID NOT APPLY'); process.exit(2); } fs.writeFileSync(f, s);
