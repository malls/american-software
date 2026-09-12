const fs = require('fs'); const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8'); const before = s;
s = s.replace("export const REMOTE_PORT = 8443;", "export const REMOTE_PORT = 8799; // MUTANT-AC1");
if (s === before) { console.error('MUTATION DID NOT APPLY'); process.exit(2); } fs.writeFileSync(f, s);
