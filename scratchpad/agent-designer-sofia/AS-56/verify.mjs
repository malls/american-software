function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function relLum([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(hexA, hexB) {
  const La = relLum(hexToRgb(hexA));
  const Lb = relLum(hexToRgb(hexB));
  const light = La > Lb ? La : Lb;
  const dark = La > Lb ? Lb : La;
  return (light + 0.05) / (dark + 0.05);
}

// LIGHT MODE: candidate danger-border = alias of existing danger-solid (danger-600, #AB212C)
const lightBg = { canvas: '#F8F8FA', surface: '#FFFFFF', sunken: '#F1F2F5' };
console.log('--- light: danger-border candidate = danger-600 #AB212C (== current danger-solid) ---');
for (const [name, hex] of Object.entries(lightBg)) {
  console.log(name, contrast('#AB212C', hex).toFixed(2));
}

// DARK MODE: candidate danger-border = danger-300 #E5767F (== current danger-text dark)
const darkBg = { canvas: '#121519', surface: '#1F232B', sunken: '#2F3441' };
console.log('');
console.log('--- dark: danger-border candidate = danger-300 #E5767F (== current danger-text dark) ---');
for (const [name, hex] of Object.entries(darkBg)) {
  console.log(name, contrast('#E5767F', hex).toFixed(2));
}

// Sanity: danger-solid (fill) unchanged, still used for white-label fills. Confirm untouched values still pass.
console.log('');
console.log('--- unchanged danger-solid (fill token) sanity ---');
console.log('light danger-solid boundary vs bg-canvas:', contrast('#AB212C', '#F8F8FA').toFixed(2));
console.log('light white-on-danger-solid:', contrast('#FFFFFF', '#AB212C').toFixed(2));
console.log('dark danger-solid (unchanged, #CE2735) white-on-it:', contrast('#FFFFFF', '#CE2735').toFixed(2));
console.log('dark danger-solid (unchanged, #CE2735) vs bg-canvas:', contrast('#CE2735', '#121519').toFixed(2));
