// M6 probes past the list, against an in-memory store on the branch's lib.
import { openStore } from '/Users/forrest/Code/american-software-company/.worktrees/AS-91/apps/chat/lib/store.js';
const s = openStore(':memory:');
s.registerIdentity({ id: 'human:x9._-z', displayName: 'Dotty Human', kind: 'human' });
s.registerIdentity({ id: 'agent:human-resources', displayName: 'HR bot', kind: 'agent' });
s.registerIdentity({ id: 'agent:a1.b_c-d', displayName: 'Alpha', kind: 'agent' });
s.registerIdentity({ id: 'system:lattice-x', displayName: 'Sys', kind: 'system' });
// P1: human id with dots/underscore/hyphen, DM never messaged (header-only) -> must be absent
s.openDm('agent:a1.b_c-d', 'human:x9._-z');
// P2: agent whose NAME contains "human" DM'd by an agent -> must be PRESENT (predicate is on the kind prefix, not the word)
const hr = s.openDm('agent:cto-owen', 'agent:human-resources');
s.postMessage({ conversation: hr.id, author: 'agent:cto-owen', body: 'hr body' });
// P3: human <-> system DM (human-first key) -> must be absent
const hs = s.openDm('human:forrest', 'system:lattice-x');
s.postMessage({ conversation: hs.id, author: 'human:forrest', body: 'sys secret' });
// P4: human DM with thread replies -> absent including replies
const hd = s.openDm('agent:cto-owen', 'human:forrest');
const root = s.postMessage({ conversation: hd.id, author: 'human:forrest', body: 'root secret' });
s.postMessage({ conversation: hd.id, author: 'agent:cto-owen', body: 'reply secret', threadRoot: root.id });
const files = s.exportFiles();
const names = files.map((f) => f.filename);
const all = files.flatMap((f) => f.lines).join('\n');
console.log('files:', names);
console.log('P1 dotty human DM absent:', !names.includes('dm-agent~a1.b_c-d~~human~x9._-z.jsonl'));
console.log('P2 agent:human-resources DM present:', names.includes('dm-agent~cto-owen~~agent~human-resources.jsonl'), 'body present:', all.includes('hr body'));
console.log('P3 human|system DM absent:', !names.includes('dm-human~forrest~~system~lattice-x.jsonl'), 'body absent:', !all.includes('sys secret'));
console.log('P4 human DM w/ thread absent:', !names.includes('dm-agent~cto-owen~~human~forrest.jsonl'), 'bodies absent:', !all.includes('root secret') && !all.includes('reply secret'));
// P5: dump stays visibility-blind (operator surface) -> the human DM IS in dump
const dump = s.dumpLines().join('\n');
console.log('P5 dump still carries human DM:', dump.includes('root secret'));
s.close();
