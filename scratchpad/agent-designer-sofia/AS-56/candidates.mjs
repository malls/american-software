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

const bgSurface = '#1F232B';
const bgSurfaceSunken = '#2F3441';
const bgCanvas = '#121519';
const white = '#FFFFFF';

const candidates = [
  ['danger-300', '#E5767F'],
  ['danger-500 (current solid)', '#CE2735'],
  ['danger-100', '#F8D8DB'],
  ['L52 candidate #D8313F', '#D8313F'],
];

for (const [name, hex] of candidates) {
  console.log(
    name, hex,
    'canvas=' + contrast(hex, bgCanvas).toFixed(2),
    'surface=' + contrast(hex, bgSurface).toFixed(2),
    'sunken=' + contrast(hex, bgSurfaceSunken).toFixed(2),
    'white-on-it=' + contrast(white, hex).toFixed(2)
  );
}
