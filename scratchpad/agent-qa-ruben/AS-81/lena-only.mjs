// Print only developer-lena's comments from `lattice show --json` on stdin (anchoring rule: no daemon output).
let buf = '';
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  const j = JSON.parse(buf);
  const d = j.data ?? j;
  const comments = d.comments ?? [];
  const cs = comments.filter((c) => (c.actor ?? c.author ?? '') === 'agent:developer-lena');
  console.log(`comments total ${comments.length}; by developer-lena ${cs.length}`);
  for (const c of cs) console.log(`--- ${c.created_at ?? c.ts ?? ''} role=${c.role ?? ''}\n${c.text ?? c.body ?? JSON.stringify(c)}`);
});
