// Procedural, deterministic esports-operator portraits rendered as compact SVG strings.
// Pure and framework-free: no DOM, no randomness beyond a PRNG seeded from the seed string.

export type AvatarKind = 'player' | 'coach';
export interface AvatarOptions {
  kind?: AvatarKind;
  /** Team colour hex, used on jersey trim, rim light and background glow. */
  accent?: string;
  /** Fixed jersey colour (a real org's kit); the face and every other trait stay the same. */
  jersey?: string;
}
export interface AvatarTraits {
  skin: string;
  headwear: string;
  eyewear: string;
  facialHair: string;
  hair: string;
  jersey: string;
}

const DEFAULT_ACCENT = '#f0a33a';
const CX = 60;

// ---------------------------------------------------------------- hashing / prng

function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
function pick<T>(r: Rand, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)] as T;
}
function weighted<T>(r: Rand, entries: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const e of entries) total += e[1];
  let x = r() * total;
  for (const e of entries) {
    x -= e[1];
    if (x < 0) return e[0];
  }
  return (entries[entries.length - 1] as readonly [T, number])[0];
}
const range = (r: Rand, a: number, b: number) => a + r() * (b - a);

// ---------------------------------------------------------------- colour

function normHex(input: string | undefined): string {
  if (!input) return DEFAULT_ACCENT;
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : DEFAULT_ACCENT;
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => {
        const v = Math.round((x[i] as number) + ((y[i] as number) - (x[i] as number)) * t);
        return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
      })
      .join('')
  );
}
const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
const darken = (c: string, t: number) => mix(c, '#000000', t);
const luma = (c: string) => {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/** number formatting: one decimal, no trailing zeros */
const n = (v: number) => {
  const s = (Math.round(v * 10) / 10).toString();
  return s === '-0' ? '0' : s;
};
/** point pair, half-unit precision (plenty at <=160px, keeps output compact) */
const h = (v: number) => {
  const s = (Math.round(v * 2) / 2).toString();
  return s === '-0' ? '0' : s;
};
const p = (x: number, y: number) => `${h(x)} ${h(y)}`;

// ---------------------------------------------------------------- palettes

const SKINS: readonly (readonly [string, string])[] = [
  ['porcelain', '#f3d3bf'],
  ['fair', '#ebc0a0'],
  ['light', '#deaa84'],
  ['golden', '#d39c6c'],
  ['olive', '#c08b5f'],
  ['tan', '#a87250'],
  ['brown', '#8c5a3b'],
  ['umber', '#6f442c'],
  ['dark', '#55331f'],
  ['deep', '#3f2517'],
];

const HAIR_COLORS: Record<string, string> = {
  black: '#16120f',
  espresso: '#2b1d15',
  brown: '#4a3021',
  chestnut: '#6b4027',
  auburn: '#7b3520',
  blonde: '#b88d50',
  platinum: '#d9d2c2',
  grey: '#8d8a86',
  salt: '#5e5953',
  white: '#cfccc6',
};

const IRIS = ['#3a2416', '#553621', '#6a5a2c', '#4c6a3c', '#3f6382', '#5d6a73'];

// ---------------------------------------------------------------- geometry

interface Geo {
  top: number;
  hw: number;
  jw: number;
  cw: number;
  chinY: number;
  eyeY: number;
  eyeDX: number;
  nY: number;
  mY: number;
  nw: number;
}

function headPath(g: Geo): string {
  const { top, hw, jw, cw, chinY, eyeY } = g;
  return (
    `M${p(CX - hw, eyeY - 2)}C${p(CX - hw, top + 9)} ${p(CX - hw * 0.56, top)} ${p(CX, top)}` +
    `C${p(CX + hw * 0.56, top)} ${p(CX + hw, top + 9)} ${p(CX + hw, eyeY - 2)}` +
    `C${p(CX + hw, eyeY + 9)} ${p(CX + jw + 1, chinY - 8)} ${p(CX + cw, chinY - 0.8)}` +
    `Q${p(CX, chinY + 1.2)} ${p(CX - cw, chinY - 0.8)}` +
    `C${p(CX - jw - 1, chinY - 8)} ${p(CX - hw, eyeY + 9)} ${p(CX - hw, eyeY - 2)}Z`
  );
}

/** Hair cap: outer skull contour (raised by vol) then inner hairline back across the forehead. */
function hairCap(g: Geo, vol: number, lineY: number, templeY: number, recede = 0, peak = 0, inf = 1.2): string {
  const { top, hw } = g;
  return (
    `M${p(CX - hw - inf, templeY)}C${p(CX - hw - inf, top + 8 - vol * 0.6)} ${p(CX - hw * 0.56 - inf * 0.5, top - vol)} ${p(CX, top - vol)}` +
    `C${p(CX + hw * 0.56 + inf * 0.5, top - vol)} ${p(CX + hw + inf, top + 8 - vol * 0.6)} ${p(CX + hw + inf, templeY)}` +
    `L${p(CX + hw - 1.3, templeY)}C${p(CX + hw - 1.8, lineY + 4)} ${p(CX + 13, lineY - recede)} ${p(CX + 7, lineY - recede * 0.5)}` +
    `Q${p(CX, lineY + peak)} ${p(CX - 7, lineY - recede * 0.5)}` +
    `C${p(CX - 13, lineY - recede)} ${p(CX - hw + 1.8, lineY + 4)} ${p(CX - hw + 1.3, templeY)}Z`
  );
}

function torsoPath(g: Geo, neckline: 'crew' | 'v' | 'zip' | 'polo'): string {
  const a = g.nw + 1;
  const sideL =
    `M${p(CX - a, 88)}C${p(CX - 24, 90.5)} ${p(CX - 42, 91.5)} ${p(CX - 50, 98.5)}` +
    `C${p(CX - 55, 103.5)} ${p(CX - 57, 112)} ${p(CX - 58, 121)}L${p(CX + 58, 121)}` +
    `C${p(CX + 57, 112)} ${p(CX + 55, 103.5)} ${p(CX + 50, 98.5)}C${p(CX + 42, 91.5)} ${p(CX + 24, 90.5)} ${p(CX + a, 88)}`;
  const neck =
    neckline === 'v' ? `L${p(CX, 103)}Z` : neckline === 'zip' ? `Q${p(CX, 93)} ${p(CX - a, 88)}Z` : neckline === 'polo' ? `Q${p(CX, 95)} ${p(CX - a, 88)}Z` : `Q${p(CX, 97)} ${p(CX - a, 88)}Z`;
  return sideL + neck;
}

// ---------------------------------------------------------------- core

interface Built {
  svg: string;
  traits: AvatarTraits;
}

function build(seed: string, opts: AvatarOptions | undefined): Built {
  const kind: AvatarKind = opts?.kind === 'coach' ? 'coach' : 'player';
  const accent = normHex(opts?.accent);
  const coach = kind === 'coach';
  // Identity depends only on seed+kind (same face regardless of team colours); ids include accent too.
  const r = mulberry32(cyrb53(`${kind}:${seed}`));
  const id = 'a' + (cyrb53(`${seed}|${kind}|${accent}|${opts?.jersey ?? ''}`, 7) % 2176782336).toString(36);
  const ref = (k: string) => `url(#${id}${k})`;

  // ---- geometry
  const top = range(r, 22.5, 24.5);
  const hw = range(r, 18.6, 20.8);
  const jw = hw - range(r, 3, 6.2);
  const chinY = range(r, 80, 83);
  const eyeY = range(r, 51, 52.6);
  const nY = eyeY + range(r, 9.4, 11);
  const g: Geo = {
    top,
    hw,
    jw,
    cw: range(r, 4, 7.6),
    chinY,
    eyeY,
    eyeDX: range(r, 7.6, 8.7),
    nY,
    mY: Math.min(nY + range(r, 6.8, 8), chinY - 8.5),
    nw: Math.min(jw - 1.5, 11.5),
  };

  // ---- traits
  const skinIdx = Math.floor(r() * SKINS.length);
  const [skinName, skin] = SKINS[skinIdx] as readonly [string, string];
  const darkSkin = skinIdx >= 6;

  let headwear: string = coach
    ? weighted(r, [['none', 55], ['cap', 20], ['headset', 25]] as const)
    : weighted(r, [['none', 20], ['headset', 30], ['cap', 8], ['cap-back', 7], ['beanie', 8], ['helmet', 9], ['balaclava', 8], ['hood', 10]] as const);
  const headsetOver = !coach && (headwear === 'beanie' || headwear === 'cap-back' || headwear === 'hood') && r() < 0.45;
  const headset = headwear === 'headset' || headsetOver;

  const hair: string = coach
    ? weighted(r, [['receding', 22], ['sidepart', 22], ['crop', 18], ['buzz', 12], ['bald', 12], ['curly', 6]] as const)
    : weighted(r, [['buzz', 14], ['crop', 16], ['fade', 16], ['curly', 12], ['tied', 8], ['mohawk', 6], ['bald', 6], ['quiff', 10], ['long', 6]] as const);
  let hairColName: string = coach
    ? weighted(r, [['grey', 30], ['salt', 25], ['white', 10], ['black', 15], ['espresso', 15], ['brown', 5]] as const)
    : weighted(r, [['black', 30], ['espresso', 25], ['brown', 18], ['chestnut', 8], ['auburn', 5], ['blonde', 8], ['platinum', 4], ['dyed', 2]] as const);
  if (darkSkin && /chestnut|auburn|blonde|brown/.test(hairColName) && r() < 0.75) hairColName = 'black';
  const hairCol = hairColName === 'dyed' ? mix(accent, '#2a1a10', 0.25) : (HAIR_COLORS[hairColName] as string);

  let eyewear: string = coach
    ? weighted(r, [['none', 55], ['glasses', 35], ['shooting', 10]] as const)
    : weighted(r, [['none', 60], ['glasses', 12], ['shooting', 15], ['goggles-forehead', 13]] as const);
  if (headwear === 'balaclava') eyewear = r() < 0.6 ? 'goggles' : 'goggles-forehead';
  else if (eyewear === 'goggles-forehead' && /cap|beanie|hood/.test(headwear)) eyewear = 'none';
  else if (headwear === 'helmet' && eyewear === 'glasses') eyewear = 'shooting';

  let facialHair: string = coach
    ? weighted(r, [['none', 25], ['stubble', 20], ['shortbeard', 15], ['beard', 20], ['moustache', 8], ['goatee', 12]] as const)
    : weighted(r, [['none', 40], ['stubble', 25], ['shortbeard', 10], ['beard', 8], ['moustache', 6], ['goatee', 11]] as const);
  if (headwear === 'balaclava') facialHair = 'none';

  const jerseyStyle: string = coach
    ? weighted(r, [['polo', 40], ['jacket', 35], ['blazer', 25]] as const)
    : pick(r, ['classic', 'raglan', 'sash', 'split', 'chevron'] as const);
  const collar: 'crew' | 'v' | 'zip' = coach ? 'crew' : pick(r, ['crew', 'v', 'zip'] as const);
  const rolledJersey = coach
    ? weighted(r, [['#1a2233', 30], ['#202227', 30], ['#e9e9ec', 15], [mix(accent, '#14161b', 0.72), 25]] as const)
    : weighted(r, [['#16191f', 35], ['#1e232c', 25], ['#e6e7ea', 12], [mix(accent, '#101216', 0.74), 28]] as const);
  const jerseyBase = opts?.jersey ? normHex(opts.jersey) : rolledJersey;
  const lanyard = coach && jerseyStyle !== 'blazer' && r() < 0.5;

  const irisCol = darkSkin ? pick(r, IRIS.slice(0, 3)) : pick(r, IRIS);
  const eyeOpen = range(r, 0.62, 1);
  const lookX = range(r, -0.5, 0.5);
  const browStyle = pick(r, ['flat', 'focused', 'arched', 'angry'] as const);
  const browW = range(r, 1.5, 2.5);
  const noseW = range(r, 2.5, 3.8);
  const mouthStyle = pick(r, ['neutral', 'smirk', 'smile', 'firm'] as const);
  const mouthW = range(r, 4.2, 5.8);
  const older = coach && r() < 0.8;
  const mic = headset && !coach ? r() < 0.6 : headset && r() < 0.35;
  const capCol = pick(r, ['#15171c', '#23262d', accent, '#e3e3e3', mix(accent, '#111', 0.6)]);
  const helmetCol = pick(r, ['#4a5140', '#8a7a5b', '#24272c', '#545b63']);
  const fabricCol = pick(r, ['#17191d', '#24272d', '#2f3540', mix(accent, '#0d0e11', 0.7), '#3b3f36']);
  const lensCol = pick(r, ['#d08a2c', '#38414e', '#3c7cbd', accent, '#4a8a6c']);
  const frameCol = pick(r, ['#16161a', '#5b4632', '#a9adb3']);

  const traits: AvatarTraits = {
    skin: skinName,
    headwear: headsetOver ? `${headwear}+headset` : headwear,
    eyewear,
    facialHair,
    hair,
    jersey: coach ? `${jerseyStyle}${lanyard ? '+lanyard' : ''}` : `${jerseyStyle}-${collar}`,
  };

  // ---- derived colours
  const shadowSkin = mix(skin, '#2e140c', 0.42);
  const deepSkin = mix(skin, '#1e0c06', 0.62);
  const lip = mix(mix(skin, '#9c4a46', 0.35), '#2a1210', 0.12);
  const browCol = hairColName === 'platinum' || hairColName === 'white' || hairColName === 'grey' ? darken(hairCol, 0.25) : hairColName === 'dyed' ? '#2a1e16' : hairCol;
  const lightJersey = luma(jerseyBase) > 0.6;

  // ---- which hair parts are visible
  const covered = headwear === 'helmet' || headwear === 'balaclava' || headwear === 'hood' || headwear === 'cap' || headwear === 'cap-back' || headwear === 'beanie';
  const hidden = headwear === 'balaclava';
  const hairVisible = hair !== 'bald' && !hidden;

  const out: string[] = [];
  const defs: string[] = [];
  const S = (s: string) => out.push(s);

  // ---- defs
  const bgInner = mix(accent, '#0b0d12', 0.62);
  defs.push(
    `<radialGradient id="${id}g" cx=".5" cy=".4" r=".75"><stop stop-color="${bgInner}"/><stop offset=".5" stop-color="${mix(accent, '#0c0e13', 0.88)}"/><stop offset="1" stop-color="#050608"/></radialGradient>`,
    `<radialGradient id="${id}s" gradientUnits="userSpaceOnUse" cx="${n(CX - hw * 0.3)}" cy="${n(top + 19)}" r="${n(hw * 2.4)}"><stop offset="0" stop-color="${lighten(skin, 0.16)}"/><stop offset=".55" stop-color="${skin}"/><stop offset="1" stop-color="${shadowSkin}"/></radialGradient>`,
    `<linearGradient id="${id}j" x2=".7" y2="1"><stop offset="0" stop-color="${lighten(jerseyBase, lightJersey ? 0.3 : 0.12)}"/><stop offset="1" stop-color="${darken(jerseyBase, lightJersey ? 0.28 : 0.45)}"/></linearGradient>`,
    `<linearGradient id="${id}r" gradientUnits="userSpaceOnUse" x1="${h(CX - hw * 0.6)}" y1="${h(top - 6)}" x2="${h(CX + hw * 0.6)}" y2="${h(chinY + 4)}"><stop offset="0" stop-color="${lighten(hairCol, 0.2)}"/><stop offset="1" stop-color="${darken(hairCol, 0.35)}"/></linearGradient>`,
    `<linearGradient id="${id}k" gradientUnits="userSpaceOnUse" x1="${n(CX + hw * 0.1)}" x2="${n(CX + hw + 2)}" y2="0"><stop offset="0" stop-color="${accent}" stop-opacity="0"/><stop offset=".8" stop-color="${accent}" stop-opacity=".1"/><stop offset="1" stop-color="${accent}" stop-opacity=".75"/></linearGradient>`,
    `<clipPath id="${id}c"><path d="${headPath(g)}"/></clipPath>`,
    `<clipPath id="${id}t"><path d="${torsoPath(g, coach ? 'polo' : collar)}"/></clipPath>`,
  );

  // ---- background
  S(`<rect width="120" height="120" fill="${ref('g')}"/>`);
  S(`<path d="M-20 40L40-20M0 80L80 0M40 120L120 40M80 140L140 80" stroke="#fff" stroke-opacity=".035" stroke-width="7"/>`);

  S(`<g transform="translate(-9 -3.5) scale(1.15)" fill='none' stroke-linecap='round'>`);
  // ---- back layers (behind head)
  const crown = { y: top }; // topmost y of whatever sits on the head, for headset band
  if (hairVisible && hair === 'long' && headwear !== 'helmet' && headwear !== 'hood') {
    S(`<path d="M${p(CX - hw - 2.5, eyeY - 6)}C${p(CX - hw - 4, top - 2)} ${p(CX + hw + 4, top - 2)} ${p(CX + hw + 2.5, eyeY - 6)}L${p(CX + hw + 4.5, 88)}Q${p(CX + hw - 2, 93)} ${p(CX + hw - 7, 89)}L${p(CX - hw + 7, 89)}Q${p(CX - hw + 2, 93)} ${p(CX - hw - 4.5, 88)}Z" fill="${darken(hairCol, 0.25)}"/>`);
  }
  if (hairVisible && hair === 'tied' && !covered) {
    S(`<circle cx="${n(CX + 1.5)}" cy="${n(top - 2.5)}" r="6.2" fill="${ref('r')}"/><path d="M${p(CX - 3, top - 5)}Q${p(CX + 1, top - 8.5)} ${p(CX + 5.5, top - 5)}" stroke="#fff" stroke-opacity=".18" fill="none"/>`);
    crown.y = top - 7;
  }
  const hoodOuter = (k: number) =>
    `M${p(CX - hw - k, 100)}C${p(CX - hw - k - 2, top + 6)} ${p(CX - hw + 2, top - k + 1)} ${p(CX, top - k + 1)}C${p(CX + hw - 2, top - k + 1)} ${p(CX + hw + k + 2, top + 6)} ${p(CX + hw + k, 100)}Z`;
  if (headwear === 'hood') {
    defs.push(`<linearGradient id="${id}w" x2=".8" y2="1"><stop offset="0" stop-color="${lighten(fabricCol, 0.14)}"/><stop offset="1" stop-color="${darken(fabricCol, 0.45)}"/></linearGradient>`);
    S(`<path d="${hoodOuter(9)}" fill="${darken(fabricCol, 0.4)}"/>`);
  }

  // ---- neck
  const nw = g.nw;
  S(`<path d="M${p(CX - nw, 70)}L${p(CX - nw - 0.6, 106)}L${p(CX + nw + 0.6, 106)}L${p(CX + nw, 70)}Z" fill="${ref('s')}"/><path d="M${p(CX + nw * 0.3, 70)}L${p(CX + nw * 0.4, 106)}H${h(CX + nw + 0.6)}L${p(CX + nw, 70)}Z" fill="${deepSkin}" opacity=".35"/>`);
  S(`<ellipse cx="60" cy="${n(chinY + 0.5)}" rx="${n(nw + 0.4)}" ry="6.5" fill="#1a0a05" opacity=".38"/>`);

  // ---- torso
  const panel: string[] = [`<rect width="120" height="121" fill="${ref('j')}"/>`];
  const acc = accent;
  if (!coach) {
    if (jerseyStyle === 'classic') {
      for (const s of [-1, 1]) {
        const x = (v: number) => CX + s * v;
        panel.push(`<path d="M${p(x(nw + 1), 88)}C${p(x(24), 90.5)} ${p(x(42), 91.5)} ${p(x(50), 98.5)}C${p(x(55), 103.5)} ${p(x(57), 112)} ${p(x(58), 121)}L${p(x(47), 121)}C${p(x(46), 110)} ${p(x(42), 103)} ${p(x(36), 100)}C${p(x(28), 96.5)} ${p(x(20), 95.5)} ${p(x(nw - 1), 95)}Z" fill="${acc}"/>`);
      }
    } else if (jerseyStyle === 'raglan') {
      for (const s of [-1, 1]) {
        const x = (v: number) => CX + s * v;
        panel.push(`<path d="M${p(x(nw - 1), 86)}L${p(x(30), 121)}L${p(x(70), 121)}L${p(x(70), 80)}Z" fill="${acc}"/><path d="M${p(x(nw - 1), 86)}L${p(x(30), 121)}" stroke="#fff" stroke-opacity=".5" stroke-width="1.1"/>`);
      }
    } else if (jerseyStyle === 'sash') {
      panel.push(`<path d="M${p(CX - 46, 90)}L${p(CX - 30, 88)}L${p(CX + 44, 121)}L${p(CX + 26, 121)}Z" fill="${acc}"/><path d="M${p(CX - 24, 88)}L${p(CX + 50, 121)}" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/>`);
    } else if (jerseyStyle === 'split') {
      panel.push(`<rect x="60" y="80" width="60" height="41" fill="#000" opacity=".32"/><path d="M${p(CX - 58, 103)}L${p(CX - 36, 92)}M${p(CX + 58, 103)}L${p(CX + 36, 92)}" stroke="${acc}" stroke-width="4"/>`);
    } else {
      panel.push(`<path d="M0 98L60 116L120 98L120 106L60 124L0 106Z" fill="${acc}"/><path d="M0 92L60 110L120 92" stroke="${acc}" stroke-width="1.5" fill="none" opacity=".7"/>`);
    }
    // sponsor bar + team badge
    panel.push(`<rect x="${n(CX - 24)}" y="99" width="10" height="2.4" rx="1" fill="${lightJersey ? '#22252b' : '#fff'}" opacity=".75"/>`);
    panel.push(`<path d="M${p(CX + 14, 97.5)}h7v4.5q-3.5 3-7 0z" fill="${acc}"/>`);
  } else if (jerseyStyle === 'jacket') {
    for (const s of [-1, 1]) {
      const x = (v: number) => CX + s * v;
      panel.push(`<path d="M${p(x(nw + 4), 90)}C${p(x(26), 92.5)} ${p(x(42), 93.5)} ${p(x(49), 101)}L${p(x(54), 121)}" stroke="${acc}" stroke-width="2" fill="none"/><path d="M${p(x(nw + 4), 93)}C${p(x(26), 95.5)} ${p(x(40), 96.5)} ${p(x(46), 103)}L${p(x(50), 121)}" stroke="#fff" stroke-opacity=".6" stroke-width="1" fill="none"/>`);
    }
    panel.push(`<path d="M60 94V121" stroke="#000" stroke-opacity=".5" stroke-width="1.6"/><path d="M60 94V121" stroke="#c9ccd2" stroke-opacity=".7" stroke-width=".5" stroke-dasharray="1 1"/>`);
  } else if (jerseyStyle === 'blazer') {
    const shirt = pick(r, ['#e8ecf2', '#b9cbe2', '#2b2f36']);
    panel.push(`<path d="M${p(CX - nw - 1.5, 88)}L60 112L${p(CX + nw + 1.5, 88)}Z" fill="${shirt}"/><path d="M${p(CX - nw + 1, 89)}L${p(CX - 3, 98)}L${p(CX - nw - 2, 94)}ZM${p(CX + nw - 1, 89)}L${p(CX + 3, 98)}L${p(CX + nw + 2, 94)}Z" fill="${lighten(shirt, 0.3)}" stroke="#000" stroke-opacity=".2" stroke-width=".5"/>`);
    for (const s of [-1, 1]) {
      const x = (v: number) => CX + s * v;
      panel.push(`<path d="M${p(x(nw + 2), 87.5)}L${p(x(1), 114)}L${p(x(9), 103)}L${p(x(14), 102)}L${p(x(19), 95)}Z" fill="${lighten(jerseyBase, 0.08)}" stroke="#fff" stroke-opacity=".12" stroke-width=".6"/>`);
    }
    panel.push(`<circle cx="${n(CX - 15)}" cy="101" r="1.4" fill="${acc}"/>`);
  } else {
    // polo: accent piping on shoulders
    panel.push(`<path d="M${p(CX - 50, 98.5)}C${p(CX - 42, 91.5)} ${p(CX - 24, 90.5)} ${p(CX - nw - 1, 88)}M${p(CX + 50, 98.5)}C${p(CX + 42, 91.5)} ${p(CX + 24, 90.5)} ${p(CX + nw + 1, 88)}" stroke="${acc}" stroke-width="1.6" fill="none"/>`);
    panel.push(`<path d="M${p(CX - 22, 100)}h7" stroke="${acc}" stroke-width="2.2"/>`);
  }
  // rim light (accent) on right shoulder
  panel.push(`<path d="M${p(CX + nw + 3, 89)}C${p(CX + 24, 91)} ${p(CX + 42, 92)} ${p(CX + 50, 99)}C${p(CX + 55, 104)} ${p(CX + 57, 112)} ${p(CX + 58, 121)}" stroke="${acc}" stroke-opacity=".75" stroke-width="2.4" fill="none"/>`);
  S(`<g clip-path="${ref('t')}">${panel.join('')}</g>`);

  // ---- ears
  const showEars = headwear !== 'balaclava' && headwear !== 'helmet';
  if (showEars) {
    let earLines = '';
    for (const s of [-1, 1]) {
      const ex = CX + s * (hw + 0.4);
      S(`<ellipse cx="${n(ex)}" cy="${n(eyeY + 3.2)}" rx="3.4" ry="5.8" fill="${s < 0 ? mix(skin, shadowSkin, 0.25) : shadowSkin}"/>`);
      earLines += `M${p(ex + s * 1.4, eyeY - 0.5)}q${n(s * 1.2)} 3.5 0 7`;
    }
    S(`<path d="${earLines}" stroke="${deepSkin}" stroke-opacity=".6" stroke-width=".9"/>`);
  }

  // ---- head
  const shade: string[] = [];
  shade.push(`<rect width="120" height="120" fill="${ref('s')}"/><rect width="120" height="120" fill="${ref('k')}"/>`);
  shade.push(`<ellipse cx="${n(CX - 7)}" cy="${n(top + 9)}" rx="9" ry="5" fill="#fff" opacity=".12"/>`);
  shade.push(`<path d="M${p(CX - jw - 2, chinY - 9)}Q${p(CX, chinY + 4)} ${p(CX + jw + 2, chinY - 9)}L${p(CX + jw + 2, chinY + 4)}L${p(CX - jw - 2, chinY + 4)}Z" fill="${deepSkin}" opacity=".18"/>`);
  // hair shadow on forehead
  if (hairVisible && !covered) {
    defs.push(`<clipPath id="${id}q"><path d="${hairCapFor(g, hair, 0)}"/></clipPath>`);
    shade.push(`<rect width="120" height="120" clip-path="${ref('q')}" transform="translate(0 1.6)" fill="#1a0a05" opacity=".22"/>`);
  }
  if (older) {
    shade.push(`<path d="M${p(CX - 8, top + 13.5)}q8 -2 16 0M${p(CX - 6, top + 16.5)}q6 -1.5 12 0" stroke="${deepSkin}" stroke-opacity=".32" stroke-width=".8" fill="none"/>`);
  }
  S(`<g clip-path="${ref('c')}">${shade.join('')}</g>`);

  // ---- eyes
  const eyePaths: string[] = [];
  const eyeParts: string[] = [];
  const lids: string[] = [];
  const upper: string[] = [];
  for (const s of [-1, 1]) {
    const ex = CX + s * g.eyeDX;
    const up = 2.5 * eyeOpen;
    const dn = 1.9 * eyeOpen;
    eyePaths.push(`M${p(ex - 3.7, eyeY)}Q${p(ex, eyeY - up)} ${p(ex + 3.7, eyeY)}Q${p(ex, eyeY + dn)} ${p(ex - 3.7, eyeY)}Z`);
    const ix = ex + lookX;
    eyeParts.push(`<circle cx="${n(ix)}" cy="${n(eyeY + 0.1)}" r="1.35" fill="#0b0807" stroke="${irisCol}"/><circle cx="${n(ix - 0.6)}" cy="${n(eyeY - 0.6)}" r=".45" fill="#fff"/>`);
    // socket shading + lid line
    lids.push(`M${p(ex - 4.8, eyeY - 1.6)}a4.8 2.8 0 1 0 9.6 0a4.8 2.8 0 1 0-9.6 0`);
    const outer = ex + s * 3.7;
    const inner = ex - s * 3.7;
    upper.push(`M${p(inner, eyeY + 0.1)}Q${p(ex, eyeY - up - 0.3)} ${p(outer + s * 0.6, eyeY - 0.5)}`);
  }
  defs.push(`<clipPath id="${id}e"><path d="${eyePaths.join('')}"/></clipPath>`);
  S(`<path d="${lids.join('')}" fill="${deepSkin}" opacity=".22"/>`);
  S(`<g clip-path="${ref('e')}"><rect x="40" y="${n(eyeY - 4)}" width="40" height="8" fill="#efe9e2"/>${eyeParts.join('')}<rect x="30" y="${n(eyeY - 4)}" width="60" height="2.6" fill="#000" opacity=".22"/></g>`);
  S(`<path d="${upper.join('')}" stroke="#1d0f0a" stroke-width="1.15" fill="none" stroke-linecap="round"/>`);

  // ---- brows
  const by = eyeY - 4.6;
  const brows: string[] = [];
  for (const s of [-1, 1]) {
    const xi = CX + s * 3.4;
    const xo = CX + s * 12;
    const xm = CX + s * 7.8;
    const [yi, ym, yo] =
      browStyle === 'flat' ? [by, by - 0.8, by - 0.2] : browStyle === 'focused' ? [by + 0.8, by - 0.6, by - 0.4] : browStyle === 'arched' ? [by, by - 1.8, by + 0.4] : [by + 1.5, by - 0.2, by - 1];
    brows.push(`M${p(xi, yi)}Q${p(xm, ym - 0.6)} ${p(xo, yo)}`);
  }
  S(`<path d="${brows.join('')}" stroke="${browCol}" stroke-width="${n(browW)}" stroke-linecap="round" fill="none"/>`);

  // ---- nose
  const nw2 = noseW;
  S(
    `<path d="M${p(CX + 1.2, eyeY + 1)}Q${p(CX + 2.8, nY - 4)} ${p(CX + nw2 - 0.2, nY - 0.6)}" stroke="${deepSkin}" stroke-opacity=".38" stroke-width="1.1" fill="none"/>` +
      `<ellipse cx="${n(CX - 0.6)}" cy="${n(nY - 1.6)}" rx="1.3" ry="1.7" fill="#fff" opacity=".2"/>` +
      `<path d="M${p(CX - nw2, nY - 0.8)}Q${p(CX - nw2 - 0.4, nY + 1.1)} ${p(CX - 1.5, nY + 0.9)}Q${p(CX, nY + 1.8)} ${p(CX + 1.5, nY + 0.9)}Q${p(CX + nw2 + 0.4, nY + 1.1)} ${p(CX + nw2, nY - 0.8)}" stroke="${deepSkin}" stroke-opacity=".75" stroke-width=".95" fill="none" stroke-linecap="round"/>`,
  );
  if (older) {
    S(`<path d="M${p(CX - nw2 - 1, nY)}Q${p(CX - nw2 - 3.2, g.mY - 2)} ${p(CX - mouthW - 0.8, g.mY + 1.5)}M${p(CX + nw2 + 1, nY)}Q${p(CX + nw2 + 3.2, g.mY - 2)} ${p(CX + mouthW + 0.8, g.mY + 1.5)}" stroke="${deepSkin}" stroke-opacity=".35" stroke-width=".8" fill="none"/>`);
  }

  // ---- facial hair (under mouth)
  const fhCol = hairColName === 'dyed' ? '#2a1e16' : hairCol;
  const mY = g.mY;
  const moustache = `<path d="M${p(CX - mouthW - 0.8, mY + 0.6)}Q${p(CX - 5, mY - 3.6)} ${p(CX, mY - 3)}Q${p(CX + 5, mY - 3.6)} ${p(CX + mouthW + 0.8, mY + 0.6)}Q${p(CX, mY - 1.4)} ${p(CX - mouthW - 0.8, mY + 0.6)}Z" fill="${fhCol}" opacity=".92"/>`;
  const jawRegion = `M${p(CX - hw - 2, eyeY + 3)}L${p(CX - hw + 3.5, eyeY + 8)}Q${p(CX - 8, nY + 1.5)} ${p(CX - 4, nY + 2.5)}L${p(CX + 4, nY + 2.5)}Q${p(CX + 8, nY + 1.5)} ${p(CX + hw - 3.5, eyeY + 8)}L${p(CX + hw + 2, eyeY + 3)}L${p(CX + hw + 2, 100)}L${p(CX - hw - 2, 100)}Z`;
  if (facialHair === 'stubble') {
    S(`<path d="${jawRegion}" fill="${fhCol}" opacity="${luma(fhCol) > 0.4 ? 0.16 : 0.26}" clip-path="${ref('c')}"/>`);
  } else if (facialHair === 'beard' || facialHair === 'shortbeard') {
    const full = facialHair === 'beard';
    const ext = full ? 4.5 : 1.8;
    S(
      `<path d="M${p(CX - hw + 0.3, eyeY + (full ? 2 : 5))}C${p(CX - hw + 0.6, eyeY + 16)} ${p(CX - jw - 1.5, chinY - 4)} ${p(CX - g.cw - 1.5, chinY + ext - 1)}Q${p(CX, chinY + ext + 3)} ${p(CX + g.cw + 1.5, chinY + ext - 1)}C${p(CX + jw + 1.5, chinY - 4)} ${p(CX + hw - 0.6, eyeY + 16)} ${p(CX + hw - 0.3, eyeY + (full ? 2 : 5))}L${p(CX + hw - 3.5, eyeY + 10)}Q${p(CX + 9, nY + 3)} ${p(CX, nY + 2.6)}Q${p(CX - 9, nY + 3)} ${p(CX - hw + 3.5, eyeY + 10)}Z" fill="${full ? ref('r') : fhCol}" opacity="${full ? 1 : 0.86}"/>` +
        `<path d="M${p(CX - 6, chinY + ext - 1)}Q${p(CX, chinY + ext + 1)} ${p(CX + 6, chinY + ext - 1)}" stroke="#fff" stroke-opacity=".12" stroke-width="1.2" fill="none"/>` +
        `<ellipse cx="60" cy="${n(mY + 1.6)}" rx="${n(mouthW + 0.4)}" ry="2.6" fill="${lip}" opacity=".55"/>`,
    );
  } else if (facialHair === 'goatee') {
    S(`<path d="M${p(CX - 4.5, mY + 2.4)}Q${p(CX, mY + 1.6)} ${p(CX + 4.5, mY + 2.4)}Q${p(CX + 4.8, chinY - 1)} ${p(CX, chinY + 1.4)}Q${p(CX - 4.8, chinY - 1)} ${p(CX - 4.5, mY + 2.4)}Z" fill="${fhCol}" opacity=".9"/>`);
  }

  // ---- mouth
  const mw = mouthW;
  const corner = mouthStyle === 'smile' ? -1 : mouthStyle === 'firm' ? 0.2 : 0;
  const rightCorner = mouthStyle === 'smirk' ? -1.3 : corner;
  const mid = mouthStyle === 'smile' ? 1.1 : mouthStyle === 'firm' ? 0 : 0.6;
  S(
    `<ellipse cx="60" cy="${n(mY + 1.9)}" rx="${n(mw * 0.62)}" ry="${mouthStyle === 'firm' ? 1 : 1.4}" fill="${lip}"/>` +
      `<ellipse cx="${n(CX - 0.6)}" cy="${n(mY + 1.6)}" rx="${n(mw * 0.3)}" ry=".45" fill="#fff" opacity=".22"/>` +
      `<path d="M${p(CX - mw, mY + corner)}Q${p(CX, mY + mid + 0.4)} ${p(CX + mw, mY + rightCorner)}" stroke="${mix(lip, '#1a0806', 0.55)}" stroke-width="1.05" fill="none" stroke-linecap="round"/>`,
  );
  if (facialHair === 'moustache' || facialHair === 'goatee' || facialHair === 'beard' || facialHair === 'shortbeard') S(moustache);

  // ---- hair (front)
  if (hairVisible) {
    if (covered) {
      // sideburns peeking under headwear
      if (headwear !== 'hood') S(`<path d="${hairCap(g, 0, top + 15, eyeY - 2)}" fill="${ref('r')}" opacity=".9"/>`);
      if (hair === 'long' && headwear !== 'helmet' && headwear !== 'hood') S(longStrands(g, ref('r')));
      if (hair === 'curly' && headwear !== 'hood') S(`<circle cx="${n(CX - hw - 1)}" cy="${n(top + 19)}" r="3" fill="${ref('r')}"/><circle cx="${n(CX + hw + 1)}" cy="${n(top + 19)}" r="3" fill="${ref('r')}"/>`);
    } else {
      S(hairFront(g, hair, ref('r'), hairCol, crown, ref('q')));
      S(`<rect width="120" height="120" clip-path="${ref('q')}" fill="${ref('k')}" opacity=".8"/>`);
    }
  } else if (!covered && !hidden) {
    S(`<ellipse cx="${n(CX - 6)}" cy="${n(top + 4)}" rx="6" ry="2.6" fill="#fff" opacity=".22" transform="rotate(-18 ${p(CX - 6, top + 4)})"/>`);
  }
  if (covered) crown.y = top;

  // ---- eyewear (glasses before headwear)
  const lensDef = () =>
    defs.push(`<linearGradient id="${id}l" y2="1"><stop offset="0" stop-color="${lighten(lensCol, 0.45)}"/><stop offset=".55" stop-color="${lensCol}"/><stop offset="1" stop-color="${darken(lensCol, 0.5)}"/></linearGradient>`);
  if (eyewear === 'glasses') {
    const gl: string[] = [];
    for (const s of [-1, 1]) {
      const ex = CX + s * g.eyeDX;
      gl.push(`<rect x="${n(ex - 5.2)}" y="${n(eyeY - 3.6)}" width="10.4" height="7" rx="2.4" fill="#cfe3ff" fill-opacity=".08" stroke="${frameCol}" stroke-width="1.1"/>`);
      gl.push(`<path d="M${p(CX + s * (g.eyeDX + 5.2), eyeY - 2)}L${p(CX + s * (hw + 1), eyeY - 1)}" stroke="${frameCol}" stroke-width="1"/>`);
      gl.push(`<path d="M${p(ex - 3, eyeY + 1.5)}l3 -3.6" stroke="#fff" stroke-opacity=".35" stroke-width=".7"/>`);
    }
    gl.push(`<path d="M${p(CX - g.eyeDX + 5.2, eyeY - 1.5)}Q${p(CX, eyeY - 3)} ${p(CX + g.eyeDX - 5.2, eyeY - 1.5)}" stroke="${frameCol}" stroke-width="1" fill="none"/>`);
    S(gl.join(''));
  } else if (eyewear === 'shooting') {
    lensDef();
    S(
      `<path d="M${p(CX - 17, eyeY - 2.5)}L${p(CX - hw - 1, eyeY - 1.5)}M${p(CX + 17, eyeY - 2.5)}L${p(CX + hw + 1, eyeY - 1.5)}" stroke="#15171b" stroke-width="1.2"/>` +
        `<g transform="translate(${p(CX, eyeY + 0.3)})"><path d="M-17 -3.6Q0 -5.8 17 -3.6Q17.6 1 14 4Q7 5.6 2.6 3Q0 1.4 -2.6 3Q-7 5.6 -14 4Q-17.6 1 -17 -3.6Z" fill="url(#${id}l)" opacity=".92" stroke="#121417" stroke-width=".8"/><path d="M-17 -3.6Q0 -5.8 17 -3.6" stroke="#121417" stroke-width="1.6" fill="none"/><path d="M-13 -1.6L-6 -2.4M5 -2.4L9 -2.2" stroke="#fff" stroke-opacity=".5" stroke-width=".9"/></g>`,
    );
  }

  // ---- headwear
  if (headwear === 'cap' || headwear === 'cap-back') {
    const cc = capCol;
    const capLight = luma(cc) > 0.6;
    const back = headwear === 'cap-back';
    const crownPath = `M${p(CX - hw - 1.6, top + 19)}C${p(CX - hw - 2.2, top + 3)} ${p(CX - hw * 0.5, top - 3.5)} ${p(CX, top - 3.5)}C${p(CX + hw * 0.5, top - 3.5)} ${p(CX + hw + 2.2, top + 3)} ${p(CX + hw + 1.6, top + 19)}Q${p(CX, top + 14.5)} ${p(CX - hw - 1.6, top + 19)}Z`;
    defs.push(`<linearGradient id="${id}w" x2=".8" y2="1"><stop offset="0" stop-color="${lighten(cc, 0.2)}"/><stop offset="1" stop-color="${darken(cc, capLight ? 0.3 : 0.45)}"/></linearGradient>`);
    S(`<g clip-path="${ref('c')}"><ellipse cx="60" cy="${n(top + 21)}" rx="${n(hw + 2)}" ry="5" fill="#1a0a05" opacity=".3"/></g>`);
    S(`<path d="${crownPath}" fill="${ref('w')}"/><path d="M${p(CX, top - 3.3)}V${n(top + 15)}M${p(CX - hw * 0.62, top + 2)}Q${p(CX - 9, top + 9)} ${p(CX - 8, top + 15.5)}M${p(CX + hw * 0.62, top + 2)}Q${p(CX + 9, top + 9)} ${p(CX + 8, top + 15.5)}" stroke="#000" stroke-opacity=".25" stroke-width=".6" fill="none"/><circle cx="60" cy="${n(top - 3)}" r="1.3" fill="${darken(cc, 0.3)}"/>`);
    if (!back) {
      S(`<path d="M${p(CX - hw - 2.6, top + 18.4)}Q${p(CX, top + 13.4)} ${p(CX + hw + 2.6, top + 18.4)}Q${p(CX + hw + 1, top + 23.6)} ${p(CX, top + 24.2)}Q${p(CX - hw - 1, top + 23.6)} ${p(CX - hw - 2.6, top + 18.4)}Z" fill="${darken(cc, capLight ? 0.15 : 0.3)}"/><path d="M${p(CX - hw - 2.6, top + 18.4)}Q${p(CX, top + 13.4)} ${p(CX + hw + 2.6, top + 18.4)}" stroke="#fff" stroke-opacity=".25" stroke-width=".8" fill="none"/>`);
      S(`<path d="M${p(CX - 4, top + 6)}h8l-1.3 4.6h-5.4z" fill="${cc === accent ? '#fff' : accent}" opacity=".95"/>`);
    } else {
      S(`<path d="M${p(CX - 5.5, top + 16.6)}Q${p(CX, top + 7)} ${p(CX + 5.5, top + 16.6)}Z" fill="${hairVisible ? hairCol : skin}"/><path d="M${p(CX - 6, top + 14.6)}H${n(CX + 6)}" stroke="${darken(cc, 0.35)}" stroke-width="1.4"/><rect x="${n(CX - 1.4)}" y="${n(top + 13.6)}" width="2.8" height="2" fill="#c8c8c8"/>`);
    }
    crown.y = top - 3.5;
  } else if (headwear === 'beanie') {
    const bc = capCol;
    defs.push(`<linearGradient id="${id}w" x2=".8" y2="1"><stop offset="0" stop-color="${lighten(bc, 0.18)}"/><stop offset="1" stop-color="${darken(bc, 0.45)}"/></linearGradient>`);
    S(
      `<path d="M${p(CX - hw - 1.8, top + 18)}C${p(CX - hw - 2.6, top + 1)} ${p(CX - hw * 0.5, top - 6.5)} ${p(CX, top - 6.5)}C${p(CX + hw * 0.5, top - 6.5)} ${p(CX + hw + 2.6, top + 1)} ${p(CX + hw + 1.8, top + 18)}Z" fill="${ref('w')}"/>` +
        `<path d="M${p(CX - hw - 2.3, top + 11)}Q${p(CX, top + 6.5)} ${p(CX + hw + 2.3, top + 11)}L${p(CX + hw + 2, top + 19)}Q${p(CX, top + 15)} ${p(CX - hw - 2, top + 19)}Z" fill="${lighten(bc, 0.06)}"/>` +
        `<path d="M${p(CX - hw - 1.8, top + 15)}Q${p(CX, top + 10.8)} ${p(CX + hw + 1.8, top + 15)}" stroke="#000" stroke-opacity=".28" stroke-width="6" stroke-dasharray=".8 1.8" fill="none"/>` +
        `<rect x="${n(CX + 5)}" y="${n(top + 11.6)}" width="6" height="3.2" rx=".6" fill="${bc === accent ? '#fff' : accent}"/>` +
        `<g clip-path="${ref('c')}"><ellipse cx="60" cy="${n(top + 20)}" rx="${n(hw + 2)}" ry="3.2" fill="#1a0a05" opacity=".28"/></g>`,
    );
    crown.y = top - 6;
  } else if (headwear === 'helmet') {
    const hc = helmetCol;
    defs.push(`<linearGradient id="${id}w" x2=".7" y2="1"><stop offset="0" stop-color="${lighten(hc, 0.25)}"/><stop offset="1" stop-color="${darken(hc, 0.5)}"/></linearGradient>`);
    S(`<g clip-path="${ref('c')}"><ellipse cx="60" cy="${n(top + 17)}" rx="${n(hw + 2)}" ry="4.5" fill="#1a0a05" opacity=".35"/></g>`);
    S(
      `<path d="M${p(CX - hw - 5, eyeY + 2)}C${p(CX - hw - 6.5, top + 1)} ${p(CX - hw * 0.6, top - 6.5)} ${p(CX, top - 6.5)}C${p(CX + hw * 0.6, top - 6.5)} ${p(CX + hw + 6.5, top + 1)} ${p(CX + hw + 5, eyeY + 2)}L${p(CX + hw + 1, eyeY + 2)}C${p(CX + hw, eyeY - 8)} ${p(CX + hw - 3, top + 15.5)} ${p(CX + 10, top + 14.5)}Q${p(CX, top + 13.5)} ${p(CX - 10, top + 14.5)}C${p(CX - hw + 3, top + 15.5)} ${p(CX - hw, eyeY - 8)} ${p(CX - hw - 1, eyeY + 2)}Z" fill="${ref('w')}"/>` +
        `<path d="M${p(CX - 15, top + 13.6)}Q${p(CX, top + 11.6)} ${p(CX + 15, top + 13.6)}" stroke="#000" stroke-opacity=".35" stroke-width="1.2" fill="none"/>` +
        `<path d="M${p(CX - hw * 0.5, top - 3)}Q${p(CX - hw + 1, top)} ${p(CX - hw - 2.5, top + 9)}" stroke="#fff" stroke-opacity=".25" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
        `<rect x="${n(CX - 4.5)}" y="${n(top + 3.6)}" width="9" height="6.4" rx="1.2" fill="#1b1d21"/><rect x="${n(CX - 2.4)}" y="${n(top + 5.4)}" width="4.8" height="2.6" rx=".6" fill="#3a3e45"/>` +
        `<rect x="${n(CX + 7)}" y="${n(top + 4)}" width="5.2" height="3.2" rx=".6" fill="${accent}"/>` +
        `<rect x="${n(CX - hw - 4.6)}" y="${n(top + 15)}" width="2.6" height="10" rx=".8" fill="#000" opacity=".35"/><rect x="${n(CX + hw + 2)}" y="${n(top + 15)}" width="2.6" height="10" rx=".8" fill="#000" opacity=".35"/>`,
    );
    S(`<path d="M${p(CX - hw - 1, eyeY + 10)}Q${p(CX - jw - 0.5, chinY - 2)} ${p(CX - g.cw, chinY + 1.4)}H${n(CX + g.cw)}Q${p(CX + jw + 0.5, chinY - 2)} ${p(CX + hw + 1, eyeY + 10)}" stroke="#15171a" stroke-width="1.3" fill="none"/>`);
    crown.y = top - 6.5;
  } else if (headwear === 'balaclava') {
    defs.push(`<linearGradient id="${id}w" x2=".8" y2="1"><stop offset="0" stop-color="${lighten(fabricCol, 0.15)}"/><stop offset="1" stop-color="${darken(fabricCol, 0.5)}"/></linearGradient>`);
    const k = 1.8;
    const win = `M${p(CX - 13.8, eyeY - 6.2)}Q${p(CX, eyeY - 8.2)} ${p(CX + 13.8, eyeY - 6.2)}Q${p(CX + 15.2, eyeY)} ${p(CX + 12.6, eyeY + 4)}Q${p(CX, eyeY + 6)} ${p(CX - 12.6, eyeY + 4)}Q${p(CX - 15.2, eyeY)} ${p(CX - 13.8, eyeY - 6.2)}Z`;
    const balPath = `M${p(CX - hw - k, eyeY - 2)}C${p(CX - hw - k, top + 8)} ${p(CX - hw * 0.56 - 1, top - k)} ${p(CX, top - k)}C${p(CX + hw * 0.56 + 1, top - k)} ${p(CX + hw + k, top + 8)} ${p(CX + hw + k, eyeY - 2)}C${p(CX + hw + k, eyeY + 12)} ${p(CX + jw + 3, chinY - 4)} ${p(CX + nw + 2, chinY + 4)}L${p(CX + nw + 3, 92)}Q${p(CX, 100)} ${p(CX - nw - 3, 92)}L${p(CX - nw - 2, chinY + 4)}C${p(CX - jw - 3, chinY - 4)} ${p(CX - hw - k, eyeY + 12)} ${p(CX - hw - k, eyeY - 2)}Z`;
    S(
      `<path fill-rule="evenodd" d="${balPath}${win}" fill="${ref('w')}"/>` +
        `<path d="${win}" stroke="#000" stroke-opacity=".45" stroke-width="1.4" fill="none"/>` +
        `<path d="M${p(CX + hw - 2, eyeY + 8)}Q${p(CX + 8, chinY - 2)} ${p(CX + 2, chinY + 2)}M${p(CX - 9, mY)}Q${p(CX, mY + 1.5)} ${p(CX + 9, mY)}" stroke="#000" stroke-opacity=".22" stroke-width="1" fill="none"/>` +
        `<path d="${balPath}" fill="${ref('k')}"/>`,
    );
    crown.y = top - 2;
  } else if (headwear === 'hood') {
    const inner = `M${p(CX, top + 5)}C${p(CX + hw + 1, top + 5)} ${p(CX + hw + 3.5, eyeY + 8)} ${p(CX + nw + 2, 96)}L${p(CX - nw - 2, 96)}C${p(CX - hw - 3.5, eyeY + 8)} ${p(CX - hw - 1, top + 5)} ${p(CX, top + 5)}Z`;
    if (hairVisible) S(`<path d="${hairCap(g, 0, top + 12, eyeY - 2)}" fill="${ref('r')}"/>`);
    S(`<path fill-rule="evenodd" d="${hoodOuter(7.5)}${inner}" fill="${ref('w')}"/><path d="${inner}" stroke="#000" stroke-opacity=".5" stroke-width="2.2" fill="none"/><path d="M${p(CX - hw - 6, eyeY)}Q${p(CX - hw - 5, top + 2)} ${p(CX - 6, top - 4.5)}" stroke="#fff" stroke-opacity=".14" stroke-width="1.6" fill="none"/>`);
    crown.y = top - 6.5;
  }

  // ---- goggles
  if (eyewear === 'goggles' || eyewear === 'goggles-forehead') {
    lensDef();
    const over = eyewear === 'goggles';
    const gy = over ? eyeY + 0.3 : headwear === 'helmet' ? top + 7 : top + 10;
    const sc = over ? 1.12 : 0.92;
    if (headwear !== 'helmet') {
      S(`<path d="M${p(CX - hw - 1.5, gy + 1.5)}Q${p(CX, gy - 3)} ${p(CX + hw + 1.5, gy + 1.5)}" stroke="#121316" stroke-width="2.6" fill="none"/>`);
    }
    S(
      `<g transform="translate(${p(CX, gy)}) scale(${sc})"><path d="M-13 -3.6Q0 -5.6 13 -3.6Q15 1 12.4 4.2Q6 4.8 2 2.6Q0 1.6 -2 2.6Q-6 4.8 -12.4 4.2Q-15 1 -13 -3.6Z" fill="#1a1c21" stroke="${accent}" stroke-opacity=".6" stroke-width=".6"/>` +
        `<path d="M-11.6 -2.4Q-6 -3.6 -1.2 -2.2Q-1 1.4 -2.6 1.6Q-7 3.4 -11 2.6Q-12.6 0 -11.6 -2.4ZM11.6 -2.4Q6 -3.6 1.2 -2.2Q1 1.4 2.6 1.6Q7 3.4 11 2.6Q12.6 0 11.6 -2.4Z" fill="url(#${id}l)"/>` +
        `<path d="M-10 -1.2L-6.6 -2M3 -1.6L6 -2.1" stroke="#fff" stroke-opacity=".6" stroke-width=".8"/></g>`,
    );
  }

  // ---- headset / ear protection
  if (headset || headwear === 'helmet') {
    const cups: string[] = [];
    if (headset) {
      const sy = eyeY - 3;
      const apex = crown.y - 1.6;
      const cy = (apex - 0.25 * sy) / 0.75;
      const bx = hw + 3.2;
      cups.push(`<path d="M${p(CX - bx, sy)}C${p(CX - bx, cy)} ${p(CX + bx, cy)} ${p(CX + bx, sy)}" stroke="#121418" stroke-width="3.4" fill="none"/><path d="M${p(CX - bx, sy)}C${p(CX - bx, cy)} ${p(CX + bx, cy)} ${p(CX + bx, sy)}" transform="translate(.6 .9)" stroke="#fff" stroke-opacity=".25" stroke-width=".8" stroke-dasharray="26 200" fill="none"/>`);
    }
    let shine = '';
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? CX - hw - 6.6 : CX + hw - 0.6;
      cups.push(`<rect x="${n(x0)}" y="${n(eyeY - 4.4)}" width="7.2" height="15" rx="3.4" fill="#17191e"/><rect x="${n(x0 + 1.1)}" y="${n(eyeY - 3.2)}" width="5" height="12.6" rx="2.4" stroke="${accent}" stroke-width=".9"/>`);
      shine += `M${p(x0 + 1.8, eyeY - 1.6)}v5`;
    }
    cups.push(`<path d="${shine}" stroke="#fff" stroke-opacity=".3" stroke-width=".8"/>`);
    if (mic || (headwear === 'helmet' && r() < 0.5)) {
      cups.push(`<path d="M${p(CX - hw - 3.4, eyeY + 9.5)}Q${p(CX - hw + 0.5, mY + 5.5)} ${p(CX - 8.4, mY + 2.6)}" stroke="#121418" stroke-width="1.5" fill="none" stroke-linecap="round"/><ellipse cx="${n(CX - 7.8)}" cy="${n(mY + 2.4)}" rx="2.1" ry="1.7" fill="#0d0e11"/><circle cx="${n(CX - 7.3)}" cy="${n(mY + 2)}" r=".55" fill="${accent}"/>`);
    }
    S(cups.join(''));
  }

  // ---- collar / clothing top
  const a = nw + 1;
  if (!coach) {
    const collarCol = lightJersey ? accent : pick(r, [accent, accent, '#e9eaee']);
    if (collar === 'crew') S(`<path d="M${p(CX - a, 88)}Q${p(CX, 97)} ${p(CX + a, 88)}" stroke="${collarCol}" stroke-width="2.4" fill="none"/>`);
    else if (collar === 'v') S(`<path d="M${p(CX - a, 88)}L${p(CX, 103)}L${p(CX + a, 88)}" stroke="${collarCol}" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`);
    else S(standCollar(a, jerseyBase, collarCol, true));
  } else if (jerseyStyle === 'polo') {
    const fc = lighten(jerseyBase, lightJersey ? 0 : 0.08);
    S(
      `<rect x="58.4" y="93" width="3.2" height="11" fill="#000" opacity=".25"/><circle cx="60" cy="97.5" r=".8" fill="#ddd"/><circle cx="60" cy="101.5" r=".8" fill="#ddd"/>` +
        `<path d="M${p(CX - a - 1, 86)}L${p(CX - 0.5, 95.5)}L${p(CX - 9, 99.5)}L${p(CX - a - 5, 92)}ZM${p(CX + a + 1, 86)}L${p(CX + 0.5, 95.5)}L${p(CX + 9, 99.5)}L${p(CX + a + 5, 92)}Z" fill="${fc}" stroke="${accent}" stroke-width=".9" stroke-linejoin="round"/>`,
    );
  } else if (jerseyStyle === 'jacket') {
    S(standCollar(a, jerseyBase, accent, false));
  }
  if (lanyard) {
    S(`<path d="M${p(CX - a + 1, 88)}L${p(CX - 2.5, 112)}M${p(CX + a - 1, 88)}L${p(CX + 2.5, 112)}" stroke="${accent}" stroke-width="1.6"/><rect x="54.5" y="111" width="11" height="12" rx="1" fill="#eef0f3"/><rect x="54.5" y="111" width="11" height="3" rx="1" fill="${accent}"/>`);
  }

  S('</g>');

  const body = (defs.join('') + '\u0000' + out.join(''))
    .replace(/ fill="none"| stroke-linecap="round"/g, '')
    .replace(/ offset="0"/g, '')
    .replace(/="0\./g, '=".')
    .replace(/ 0\.(\d)/g, ' .$1')
    .replace(/<(path|circle|ellipse|rect)\b([^>]*)\/>/g, (m, _t: string, attrs: string) => (!/ fill=| opacity=/.test(attrs) ? m.replace(' stroke-opacity=', ' opacity=') : m));
  const [defsMin, outMin] = body.split('\u0000') as [string, string];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs>${defsMin}</defs>${outMin}</svg>`;
  return { svg, traits };
}

function standCollar(a: number, base: string, edge: string, zipBelow: boolean): string {
  return (
    `<path d="M${p(CX - a - 1, 84)}L${p(CX - a - 0.5, 91)}Q${p(CX, 95.5)} ${p(CX + a + 0.5, 91)}L${p(CX + a + 1, 84)}Q${p(CX, 89)} ${p(CX - a - 1, 84)}Z" fill="${lighten(base, 0.1)}"/>` +
    `<path d="M${p(CX - a - 1, 84)}Q${p(CX, 89)} ${p(CX + a + 1, 84)}" stroke="${edge}" stroke-width="1.6" fill="none"/>` +
    `<path d="M60 ${zipBelow ? '89V108' : '89V121'}" stroke="#000" stroke-opacity=".45" stroke-width="1.4"/>` +
    `<rect x="58.8" y="${zipBelow ? 106 : 99}" width="2.4" height="4" rx=".8" fill="#c9ccd2"/>`
  );
}

function longStrands(g: Geo, fill: string): string {
  const { hw, top, eyeY } = g;
  let d = '';
  for (const s of [-1, 1]) {
    const x = (v: number) => CX + s * v;
    d += `M${p(x(hw + 1.6), top + 12)}Q${p(x(hw + 4.5), eyeY + 12)} ${p(x(hw + 2.5), eyeY + 27)}L${p(x(hw - 1.5), eyeY + 20)}Q${p(x(hw - 0.6), eyeY + 4)} ${p(x(hw - 2), top + 14)}Z`;
  }
  return `<path d="${d}" fill="${fill}"/>`;
}

function hairCapFor(g: Geo, hair: string, _i: number): string {
  const { top, eyeY } = g;
  switch (hair) {
    case 'buzz':
      return hairCap(g, 0.6, top + 9.5, eyeY - 2.5, 0, 0.6, 0.8);
    case 'receding':
      return hairCap(g, 1.2, top + 7, eyeY - 2, 5, 1.5);
    case 'sidepart':
      return hairCap(g, 3.2, top + 9, eyeY - 2.5, 1, 0);
    case 'tied':
      return hairCap(g, 1.6, top + 8.5, eyeY - 2.5, 0.5, 0.8);
    case 'curly':
      return hairCap(g, 4.5, top + 9.5, eyeY - 2.5, 0, 0.6, 1.8);
    case 'fade':
      return hairCap(g, 0.4, top + 10, eyeY - 2.5, 0, 0, 0.8);
    case 'mohawk':
      return hairCap(g, 0.3, top + 10, eyeY - 2.5, 0, 0, 0.6);
    default:
      return hairCap(g, 3.2, top + 9.8, eyeY - 2.5, 0, 1);
  }
}

function hairFront(g: Geo, hair: string, fill: string, col: string, crown: { y: number }, clip: string): string {
  const { top, hw } = g;
  const hl = `stroke="#fff" stroke-opacity=".2" stroke-width=".9" fill="none" stroke-linecap="round"`;
  switch (hair) {
    case 'buzz':
      crown.y = top - 0.6;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}" opacity=".78"/>`;
    case 'fade': {
      crown.y = top - 4;
      const topPart = `M${p(CX - hw + 2, top + 12)}C${p(CX - hw + 1, top - 1)} ${p(CX - 8, top - 4.5)} ${p(CX, top - 4.5)}C${p(CX + 8, top - 4.5)} ${p(CX + hw - 1, top - 1)} ${p(CX + hw - 2, top + 12)}Q${p(CX + 6, top + 7.5)} ${p(CX - 2, top + 10)}Q${p(CX - 9, top + 8)} ${p(CX - hw + 2, top + 12)}Z`;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}" opacity=".5"/><path d="${topPart}" fill="${fill}"/><path d="M${p(CX - 9, top - 1.5)}Q${p(CX - 2, top - 4)} ${p(CX + 6, top - 2)}" ${hl}/>`;
    }
    case 'quiff': {
      crown.y = top - 7;
      const q = `M${p(CX - hw + 1, top + 13)}C${p(CX - hw, top - 2)} ${p(CX - 10, top - 7)} ${p(CX + 2, top - 8)}C${p(CX + 12, top - 8.5)} ${p(CX + hw + 1, top - 2)} ${p(CX + hw - 1, top + 12)}Q${p(CX + 8, top + 4)} ${p(CX + 1, top + 6.5)}Q${p(CX - 8, top + 9)} ${p(CX - hw + 1, top + 13)}Z`;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}" opacity=".7"/><path d="${q}" fill="${fill}"/><path d="M${p(CX - 8, top - 3)}Q${p(CX, top - 7.4)} ${p(CX + 9, top - 5.5)}M${p(CX - 5, top + 1)}Q${p(CX + 2, top - 3)} ${p(CX + 10, top - 1.5)}" ${hl}/>`;
    }
    case 'curly': {
      crown.y = top - 7;
      let c = '';
      const pts = 11;
      for (let i = 0; i < pts; i++) {
        const a = Math.PI * (1.05 + (0.9 * i) / (pts - 1));
        const x = CX + Math.cos(a) * (hw + 0.5);
        const y = top + 15 + Math.sin(a) * (top + 15 - (top - 3.5));
        c += `<circle cx="${n(x)}" cy="${n(y)}" r="${i % 2 ? 3.6 : 3.1}" fill="${fill}"/>`;
      }
      for (let i = 0; i < 5; i++) c += `<circle cx="${n(CX - 9 + i * 4.5)}" cy="${n(top + 10.5 + (i % 2) * 0.8)}" r="2.6" fill="${fill}"/>`;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}"/>${c}<path d="M${p(CX - 10, top - 1)}q2 -2 4 0m3 -2q2 -2 4 0" ${hl}/>`;
    }
    case 'tied':
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}"/><path d="M${p(CX - 9, top + 8)}Q${p(CX - 6, top)} ${p(CX + 1, top - 1)}M${p(CX + 2, top + 8)}Q${p(CX + 4, top + 1)} ${p(CX + 10, top + 1)}" stroke="#000" stroke-opacity=".3" stroke-width=".7" fill="none"/><path d="M${p(CX - 10, top + 3)}Q${p(CX - 5, top - 1.2)} ${p(CX + 2, top - 1)}" ${hl}/>`;
    case 'mohawk': {
      crown.y = top - 2;
      const m = `M${p(CX - 4.5, top + 10)}L${p(CX - 5.5, top - 2)}L${p(CX - 3.5, top - 6)}L${p(CX - 1.5, top - 3.5)}L${p(CX, top - 9)}L${p(CX + 1.8, top - 4)}L${p(CX + 3.8, top - 7)}L${p(CX + 5.5, top - 2)}L${p(CX + 4.5, top + 10)}Q${p(CX, top + 11)} ${p(CX - 4.5, top + 10)}Z`;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}" opacity=".4"/><path d="${m}" fill="${fill}"/><path d="M${p(CX - 2, top - 2)}L${p(CX - 0.5, top - 6)}" ${hl}/>`;
    }
    case 'long':
      crown.y = top - 3.2;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}"/>${longStrands(g, fill)}<path d="M${p(CX - 4, top + 9.5)}Q${p(CX - 1, top + 2)} ${p(CX + 1, top - 2)}" stroke="#000" stroke-opacity=".3" stroke-width=".8" fill="none"/><path d="M${p(CX - 11, top + 1)}Q${p(CX - 6, top - 2.2)} ${p(CX - 1, top - 2.4)}" ${hl}/>`;
    case 'receding':
      crown.y = top - 1.2;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}" opacity=".85"/><path d="M${p(CX - 8, top + 1)}Q${p(CX, top - 1)} ${p(CX + 8, top + 1)}" ${hl}/>`;
    case 'sidepart':
      crown.y = top - 3.2;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}"/><path d="M${p(CX - 7, top + 9.5)}Q${p(CX - 6, top + 2)} ${p(CX - 5, top - 2.6)}" stroke="#000" stroke-opacity=".35" stroke-width=".8" fill="none"/><path d="M${p(CX - 3, top + 4)}Q${p(CX + 4, top - 2)} ${p(CX + 12, top)}" ${hl}/>`;
    default: {
      // crop: short textured top with fringe tufts
      crown.y = top - 3.2;
      const ly = top + 9.8;
      const fringe = `M${p(CX - 11, ly - 1)}l2.2 2.6l1.6 -2.2l2 2.8l1.8 -2.4l2 2.6l1.8 -2.6l2 2.6l1.7 -2.4l2 2.2l1.4 -2.6L${p(CX + 6, ly - 4)}L${p(CX - 9, ly - 4)}Z`;
      return `<rect width="120" height="120" clip-path="${clip}" fill="${fill}"/><path d="${fringe}" fill="${col}" transform="translate(0 -1)"/><path d="M${p(CX - 9, top + 0.5)}Q${p(CX - 2, top - 3)} ${p(CX + 7, top - 1)}" ${hl}/>`;
    }
  }
}

// ---------------------------------------------------------------- public API

export function avatarSvg(seed: string, opts?: AvatarOptions): string {
  return build(seed, opts).svg;
}

export function avatarTraits(seed: string, opts?: AvatarOptions): AvatarTraits {
  return build(seed, opts).traits;
}

const CACHE_MAX = 600;
const cache = new Map<string, string>();

export function avatarDataUrl(seed: string, opts?: AvatarOptions): string {
  const key = `${opts?.kind ?? 'player'}|${opts?.accent ?? ''}|${opts?.jersey ?? ''}|${seed}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(build(seed, opts).svg);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, url);
  return url;
}
