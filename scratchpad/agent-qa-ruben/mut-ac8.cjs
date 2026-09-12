const fs = require('fs'); const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8'); const before = s;
s = s.replace("  '/dashboard-link.js': ['dashboard-link.js', 'text/javascript; charset=utf-8'],\n", "");
if (s === before) { console.error('MUTATION DID NOT APPLY'); process.exit(2); } fs.writeFileSync(f, s);
