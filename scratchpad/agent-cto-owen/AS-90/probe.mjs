// AS-90 planning probe: host capture options + a stripe-mock account fixture read.
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const out = (k, v) => console.log(`${k}: ${JSON.stringify(v)}`);
out('node', process.version);
out('apps', readdirSync('/Applications').filter((n) => /chrom|firefox|safari|arc|brave|edge/i.test(n)));
for (const p of [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Safari.app/Contents/MacOS/Safari',
  '/usr/bin/safaridriver',
  '/opt/homebrew/bin/chromium',
  '/opt/homebrew/bin/wkhtmltoimage',
  `${process.env.HOME}/Library/Caches/ms-playwright`,
  `${process.env.HOME}/.cache/ms-playwright`,
  `${process.env.HOME}/.cache/puppeteer`,
]) out(p, existsSync(p));
const which = (b) => spawnSync('/usr/bin/which', [b], { encoding: 'utf8' }).stdout.trim() || null;
for (const b of ['chromium', 'google-chrome', 'firefox', 'playwright', 'wkhtmltoimage', 'docker']) out(`which ${b}`, which(b));
const g = spawnSync('npm', ['ls', '-g', '--depth=0'], { encoding: 'utf8' });
out('npm -g playwright/puppeteer', (g.stdout || '').split('\n').filter((l) => /playwright|puppeteer/i.test(l)));
out('C11_SHELL_INTEGRATION', process.env.C11_SHELL_INTEGRATION ?? null);
