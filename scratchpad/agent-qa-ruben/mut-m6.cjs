const fs = require('fs'); const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8'); const before = s;
const OLD = "    body.replaceChildren(title, el('span', 'status', task.status), el('div', 'task-id', task.taskId), open);\n";
const NEW = "    const shadow = el('a', 'lattice-open', 'Open (shadow)'); // MUTANT-M6: a fourth link site\n" +
            "    shadow.href=task.url; // MUTANT-M6: server-baked loopback base, no spaces around '='\n" +
            "    body.replaceChildren(title, el('span', 'status', task.status), el('div', 'task-id', task.taskId), open, shadow);\n";
s = s.replace(OLD, NEW); if (s === before) { console.error('MUTATION DID NOT APPLY'); process.exit(2); } fs.writeFileSync(f, s);
