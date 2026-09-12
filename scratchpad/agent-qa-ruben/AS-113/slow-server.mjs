// Slow (300 ms) live fake chat server for the AS-113 end-to-end check. Logs every request.
import { createServer } from 'node:http';
const port = Number(process.argv[2] || 0);
const srv = createServer((req, res) => {
  console.log('REQ', req.method, req.url);
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/api/identities')) res.end(JSON.stringify({ identities: [{ id: 'human:forrest', kind: 'human', displayName: 'Forrest' }] }));
    else if (req.url.startsWith('/api/conversations')) res.end(JSON.stringify({ conversations: [] }));
    else res.end('{}');
  }, 300);
});
srv.listen(port, '127.0.0.1', () => console.log('LISTENING', srv.address().port));
