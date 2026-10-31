// Renders the app icons from the brand mark (the same SVG as BrandMark in src/ui/App.tsx).
// Run: node tools/app-icons.mjs   (writes public/icons/* and resources/icon*.png for the native apps)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const mark = (scale) => {
  // The 32x32 mark, centred on a 1024 canvas at `scale` of its width.
  const s = (1024 * scale) / 32;
  const o = (1024 - 32 * s) / 2;
  return `<g transform="translate(${o} ${o}) scale(${s})">
    <path d="M8 2 H24 L30 8 V24 L24 30 H8 L2 24 V8 Z" fill="url(#g)" stroke="#f6b14f" stroke-width="1.2"/>
    <circle cx="16" cy="16" r="6.5" fill="none" stroke="#1b1206" stroke-width="2.2"/>
    <path d="M16 5.5 V11 M16 21 V26.5 M5.5 16 H11 M21 16 H26.5" stroke="#1b1206" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="1.6" fill="#1b1206"/>
  </g>`;
};

const svg = ({ scale, rounded }) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc56a"/><stop offset="1" stop-color="#e08c22"/></linearGradient>
    <radialGradient id="bg" cx="0.5" cy="0.3" r="0.8"><stop offset="0" stop-color="#1c2633"/><stop offset="1" stop-color="#0a0e13"/></radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f0a33a" stop-opacity="0.28"/><stop offset="1" stop-color="#f0a33a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="${rounded ? 220 : 0}" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="420" fill="url(#glow)"/>
  ${mark(scale)}
</svg>`);

mkdirSync('public/icons', { recursive: true });
mkdirSync('resources', { recursive: true });
const out = [
  ['public/icons/icon-192.png', 192, { scale: 0.62, rounded: false }],
  ['public/icons/icon-512.png', 512, { scale: 0.62, rounded: false }],
  // Maskable: the launcher crops to a circle or squircle, so keep the mark inside the 80% safe zone.
  ['public/icons/maskable-512.png', 512, { scale: 0.5, rounded: false }],
  ['public/icons/apple-touch-icon.png', 180, { scale: 0.62, rounded: false }],
  ['public/icons/favicon-64.png', 64, { scale: 0.8, rounded: true }],
  // Sources for the native app icons and splash (Capacitor / Android Studio / Xcode).
  ['resources/icon.png', 1024, { scale: 0.62, rounded: false }],
  ['resources/icon-foreground.png', 1024, { scale: 0.46, rounded: false }],
];
for (const [file, size, opts] of out) {
  await sharp(svg(opts)).resize(size, size).png().toFile(file);
  console.log('wrote', file);
}

// Names @capacitor/assets expects (npx @capacitor/assets generate): icon-only, foreground/background, splash.
await sharp(svg({ scale: 0.62, rounded: false })).resize(1024, 1024).png().toFile('resources/icon-only.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#0a0e13' } }).png().toFile('resources/icon-background.png');
const splash = await sharp(svg({ scale: 0.34, rounded: false })).resize(1100, 1100).png().toBuffer();
for (const f of ['resources/splash.png', 'resources/splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#0a0e13' } }).composite([{ input: splash, gravity: 'center' }]).png().toFile(f);
}
console.log('wrote native icon and splash sources');
