function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
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
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

const dangerSteps = {
  50: '#FCEEEF', 100: '#F8D8DB', 300: '#E5767F', 500: '#CE2735',
  600: '#AB212C', 700: '#891A23', 800: '#6B141C', 900: '#511015',
};
console.log('--- existing danger scale HSL ---');
for (const [k, hex] of Object.entries(dangerSteps)) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  console.log('danger-' + k + ': ' + hex + '  H=' + h.toFixed(1) + ' S=' + s.toFixed(1) + ' L=' + l.toFixed(1));
}

const bgSurface = '#1F232B';
const bgSurfaceSunken = '#2F3441';
const bgCanvas = '#121519';
const white = '#FFFFFF';

console.log('');
console.log('--- current dark danger-solid (danger-500, #CE2735) ---');
console.log('vs bg-canvas:', contrast('#CE2735', bgCanvas).toFixed(2));
console.log('vs bg-surface:', contrast('#CE2735', bgSurface).toFixed(2));
console.log('vs bg-surface-sunken:', contrast('#CE2735', bgSurfaceSunken).toFixed(2));
console.log('white-on-danger-solid:', contrast(white, '#CE2735').toFixed(2));

console.log('');
console.log('--- current dark danger-solid-hover (danger-600, #AB212C) ---');
console.log('vs bg-canvas:', contrast('#AB212C', bgCanvas).toFixed(2));
console.log('vs bg-surface:', contrast('#AB212C', bgSurface).toFixed(2));
console.log('vs bg-surface-sunken:', contrast('#AB212C', bgSurfaceSunken).toFixed(2));
console.log('white-on-danger-solid-hover:', contrast(white, '#AB212C').toFixed(2));

console.log('');
console.log('--- sweep hue=355 sat=68% across L, holding brand hue/sat ---');
for (let l = 30; l <= 62; l += 1) {
  const hex = rgbToHex(hslToRgb(355, 68, l));
  const cSurface = contrast(hex, bgSurface);
  const cSunken = contrast(hex, bgSurfaceSunken);
  const cCanvas = contrast(hex, bgCanvas);
  const cWhite = contrast(white, hex);
  const okSurface = cSurface >= 3 ? 'OK' : 'fail';
  const okSunken = cSunken >= 3 ? 'OK' : 'fail';
  const okCanvas = cCanvas >= 3 ? 'OK' : 'fail';
  const okWhite = cWhite >= 4.5 ? 'OK' : 'fail';
  console.log('L=' + l + ' ' + hex + '  surface=' + cSurface.toFixed(2) + '(' + okSurface + ') sunken=' + cSunken.toFixed(2) + '(' + okSunken + ') canvas=' + cCanvas.toFixed(2) + '(' + okCanvas + ') white=' + cWhite.toFixed(2) + '(' + okWhite + ')');
}
