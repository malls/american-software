import { tokenizeUrls } from '/Users/forrest/Code/american-software-company/.worktrees/AS-72/apps/chat/public/markdown.js';
let bmp = 0, all = 0;
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  if (/\p{Cf}/u.test(String.fromCodePoint(cp))) { all++; if (cp <= 0xffff) bmp++; }
}
console.log('Cf BMP', bmp, 'Cf all planes', all, 'node', process.version);
const EN = '–', EM = '—', EL = '…', ZWSP = '​', ZWJ = '‍', SHY = '­', WJ = '⁠', BOM = '﻿', ASTRAL = '\u{E0001}', LRM = '‎';
const cases = [
  `https://x.dev/a${EN}${EN} end`, `https://x.dev/a${EN}b/c`, `https://x.dev/path${EN}?q=1`, `https://x.dev/a${EL}b`,
  `https://x.dev/a${EM}?q=1${EM}`, `https://xn--r8jz45g.xn--zckzah/${EN}x`, `https://x.dev/%E2%80%93 then`,
  `https://x.dev/a${ZWSP}b`, `https://x.dev/a${ZWJ}`, `https://x.dev/${ZWSP}a`, `https://x.dev/a${SHY}b`, `https://x.dev/a${WJ}b end`,
  `http://x.dev/a${BOM}`, `https://x.dev/a${ASTRAL}b`, `(https://x.dev/a${EN})`, `https://x.dev/a${EN}.`, `https://x.dev/a${LRM}b`,
  `https://${ZWSP}x.dev/a`, `https://x.dev/a${EN}${ZWSP}b`,
];
for (const s of cases) {
  const t = tokenizeUrls(s);
  const u = t.filter((x) => x.type === 'url').map((x) => x.href);
  console.log(JSON.stringify(s), '=>', JSON.stringify(u), 'rt', t.map((x) => x.text).join('') === s);
}
