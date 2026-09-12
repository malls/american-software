// Priya: recompute every pinned number this branch touches, from the files themselves.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-56`;
const docs = readFileSync(`${W}/docs/design/tokens/tokens.css`);
const chat = readFileSync(`${W}/apps/chat/public/tokens.css`);
const master = execFileSync('git', ['-C', ROOT, 'show', 'master:docs/design/tokens/tokens.css']);
const stats = (buf, label) => {
  const s = buf.toString('utf8');
  const decls = s.match(/^\s*--[a-z0-9-]+\s*:/gm) ?? [];
  const names = new Set(decls.map((d) => d.trim().replace(/\s*:$/, '')));
  console.log(label, { bytes: buf.length, lines: s.split('\n').length - (s.endsWith('\n') ? 1 : 0), declarations: decls.length, names: names.size, sha256: createHash('sha256').update(buf).digest('hex') });
};
stats(master, 'master docs/tokens.css ');
stats(docs, 'branch docs/tokens.css ');
stats(chat, 'branch chat/tokens.css ');
console.log('docs == chat byte-identical:', docs.equals(chat));
