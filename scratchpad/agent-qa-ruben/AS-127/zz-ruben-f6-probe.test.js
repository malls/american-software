// Ruben's one-off probe on the F6 mutant copy (never part of the suite): with the
// parser's date check mutated to a regex, does the ROUTE still mark startDate when
// generate refuses it (assertion (ii) of case 6)? This exercises the
// ValidationError-mapping branch in routes/contracts.js that the plan says
// "cannot happen after the screen's own parse".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configFor, seedSignedIn, signedInHeaders, withServer } from './helpers/server.js';

test('F6 probe: generate refuses 2026-02-31 and the route marks startDate, 400, zero rows', async () => {
  await withServer(configFor(), async (base, app) => {
    const { repos } = app.locals;
    const { cookie, freelancer } = seedSignedIn(repos, { email: 'f6@example.test', displayName: 'F6' });
    const client = repos.clients.create(freelancer.id, { name: 'C', email: 'c@example.test' });
    const headers = { ...signedInHeaders(base, cookie), 'content-type': 'application/x-www-form-urlencoded' };
    const res = await fetch(`${base}/contracts/new`, {
      method: 'POST', redirect: 'manual', headers,
      body: new URLSearchParams({ intent: 'generate', pickerMode: 'select', clientId: client.id, projectDescription: 'ok', startDate: '2026-02-31' }).toString(),
    });
    const html = await res.text();
    console.log(`status=${res.status} state=${(html.match(/data-state="([^"]+)"/) || [])[1]} invalid=${html.split('field--invalid').length - 1} startDateError=${html.split('id="startDate-error"').length - 1} rows=${repos.contracts.listByFreelancer(freelancer.id).length}`);
    assert.equal(res.status, 400);
    assert.equal(html.split('field--invalid').length - 1, 1);
    assert.equal(html.split('id="startDate-error"').length - 1, 1);
    assert.equal(repos.contracts.listByFreelancer(freelancer.id).length, 0);
  });
});
