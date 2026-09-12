const fs = require('fs'); const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8'); const before = s;
const OLD = "  const base = usableOverride(override);\n";
s = s.replace(OLD, "  override = null; // MUTANT-AC5\n" + OLD); if (s === before) { console.error('MUTATION DID NOT APPLY'); process.exit(2); } fs.writeFileSync(f, s);
