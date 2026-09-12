const fs = require('fs'); const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8'); const before = s;
s = s.replace("export const LOOPBACK_PORT = 8799;", "export const LOOPBACK_PORT = 8443; // MUTANT-AC2");
if (s === before) { console.error('MUTATION DID NOT APPLY'); process.exit(2); } fs.writeFileSync(f, s);
