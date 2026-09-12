const base = 'http://127.0.0.1:8399';
let r = await fetch(base + '/api/channels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'scratch115', purpose: 'scratch', actor: 'human:forrest', visibility: 'public' }) });
console.log('chan', r.status, (await r.text()).slice(0, 200));
const body = [
  'AS-88 merged 74cb6f9 after `e5a180a` and **bold 0337a54** on feat/AS-88-deploy-names-its-project.',
  'label link [see e5a180a](https://example.test) and url https://github.com/malls/american-software/commit/a0cfb0b done',
  'msg 810 and build cb92cbbb2c37d4a8 at 1411753, also AS-88 elsewhere',
].join('\n');
r = await fetch(base + '/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversation: 'scratch115', author: 'human:forrest', body }) });
console.log('post', r.status, (await r.text()).slice(0, 200));
r = await fetch(base + '/api/conversations?me=human:forrest');
console.log('convs', r.status, (await r.text()).slice(0, 300));
