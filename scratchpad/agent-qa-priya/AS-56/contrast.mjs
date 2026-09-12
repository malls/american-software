// Priya's independent recomputation for AS-56. WCAG 2.1 relative luminance,
// sRGB, per BRANDING.md §11. Written without looking at Sofia's script.
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const r2 = (x) => Math.round(x * 100) / 100;

// HSL -> hex, to verify the generated step is really HSL(355,68%,50%).
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
}

const OLD = '#CE2735', NEW = '#D62937', WHITE = '#FFFFFF';
console.log('HSL(355,68,50) ->', hslToHex(355, 68, 50), '(expect #D62937)');
console.log('HSL(355,68,46)? ->', hslToHex(355, 68, 46), ' HSL(355,68,48)?', hslToHex(355, 68, 48), ' (locate the old -500 step)');

// Dark backgrounds: read from tokens.css on the branch, not from memory.
import { readFileSync } from 'node:fs';
const css = readFileSync(process.argv[2], 'utf8');
const dark = css.slice(css.indexOf('[data-theme="dark"]'));
const prim = Object.fromEntries([...css.matchAll(/--color-([a-z]+-[a-z0-9]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const alias = (name) => { const m = dark.match(new RegExp(`--color-${name}:\\s*var\\(--color-([a-z]+-[a-z0-9]+)\\)`)); return m ? prim[m[1]] : null; };
const bg = { canvas: alias('bg-canvas'), surface: alias('bg-surface'), sunken: alias('bg-surface-sunken') };
console.log('dark backgrounds resolved from tokens.css:', bg, 'dark danger-solid resolves to', alias('danger-solid'));
for (const [name, hex] of Object.entries(bg)) {
  console.log(`danger-solid vs bg-${name}: old ${r2(ratio(OLD, hex))}  new ${r2(ratio(NEW, hex))}  floor 3`);
}
console.log(`white on danger-solid: old ${r2(ratio(WHITE, OLD))}  new ${r2(ratio(WHITE, NEW))}  floor 4.5`);
// hover untouched
console.log('white on danger-solid-hover (dark, #AB212C):', r2(ratio(WHITE, '#AB212C')));
// light mode: what does danger-solid resolve to and against light bgs?
const light = css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'));
const la = (name) => { const m = light.match(new RegExp(`--color-${name}:\\s*var\\(--color-([a-z]+-[a-z0-9]+)\\)`)); if (m) return [m[1], prim[m[1]]]; const lit = light.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`)); return lit ? ['literal', lit[1].toUpperCase()] : null; };
console.log('light danger-solid ->', la('danger-solid'), 'bgs', la('bg-canvas'), la('bg-surface'), la('bg-surface-sunken'));
const [, ls] = la('danger-solid');
for (const b of ['bg-canvas', 'bg-surface', 'bg-surface-sunken']) console.log(`light danger-solid vs ${b}:`, r2(ratio(ls, la(b)[1])));
// window sweep, my own
const win = [];
for (let L = 40; L <= 62; L++) {
  const h = hslToHex(355, 68, L);
  win.push({ L, h, surf: r2(ratio(h, bg.surface)), sunk: r2(ratio(h, bg.sunken)), white: r2(ratio(WHITE, h)) });
}
console.table(win);
