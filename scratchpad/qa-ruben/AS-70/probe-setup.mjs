import { cpSync, copyFileSync, rmSync } from 'node:fs';
const R = '/Users/forrest/Code/american-software-company/scratchpad/qa-ruben/AS-70';
rmSync(R + '/mut/probe', { recursive: true, force: true });
cpSync(R + '/mut/pristine', R + '/mut/probe', { recursive: true });
copyFileSync(R + '/zz-ruben-probes.test.js', R + '/mut/probe/apps/invoicing/test/zz-ruben-probes.test.js');
console.log('probe extract ready');
