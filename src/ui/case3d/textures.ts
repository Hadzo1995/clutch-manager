/**
 * Canvas-drawn textures for the 3D weapon cases: the printed label on the lid, the stencil
 * on the sides, the serial plate, the moulded-plastic stipple and the soft glow sprites.
 * Everything is generated at run time (no image files), in the game's own typefaces.
 */
import * as THREE from 'three';
import type { CaseId } from '../../engine/cases';
import type { Role } from '../../engine/types';

const DISPLAY = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';
const DATA = '"JetBrains Mono", ui-monospace, monospace';

/** The role glyphs from the UI (common.tsx RoleIcon), as paths on a 24-unit grid. */
const ROLE_PATHS: Record<Role, string[]> = {
  awp: ['M12 2v5M12 17v5M2 12h5M17 12h5', 'M20 12a8 8 0 1 1-16 0a8 8 0 1 1 16 0'],
  entry: ['M4 12h13M12 6l6 6-6 6'],
  support: ['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z'],
  lurker: ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z', 'M14.5 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0'],
  igl: ['M5 21V4M5 4h11l-2 4 2 4H5'],
};

export interface CaseLook {
  /** Moulded shell colour. */
  shell: string;
  /** The belt ridges and trim, a shade deeper than the shell. */
  deep: string;
  /** Glow colour: the pedestal ring, the seam and the light inside. Matches the case colour in the UI. */
  accent: string;
  /** Corner guards and latches: black rubber and steel, or gold for the Major Case. */
  gold: boolean;
  title: string;
  kicker: string;
  stencil: string;
  serial: string;
}

export const CASE_LOOK: Record<CaseId, CaseLook> = {
  daily: { shell: '#2a7a52', deep: '#1d5a3c', accent: '#4cc38a', gold: false, title: 'DAILY DROP', kicker: 'FREE CONTAINER', stencil: 'DAILY', serial: 'CM-DLY' },
  standard: { shell: '#285d93', deep: '#1c446c', accent: '#5aa9e6', gold: false, title: 'SCOUT CASE', kicker: 'FULL PLAYER POOL', stencil: 'SCOUT', serial: 'CM-SCT' },
  role: { shell: '#b06a1c', deep: '#7f4b12', accent: '#f0a33a', gold: false, title: 'ROLE CASE', kicker: 'ONE ROLE ONLY', stencil: 'ROLE', serial: 'CM-ROL' },
  premium: { shell: '#4a2370', deep: '#33174f', accent: '#d46cff', gold: true, title: 'MAJOR CASE', kicker: 'NO BRONZE INSIDE', stencil: 'MAJOR', serial: 'CM-MJR' },
};

const ROLE_NAME: Record<Role, string> = { entry: 'ENTRY', awp: 'AWPER', support: 'SUPPORT', lurker: 'LURKER', igl: 'IGL' };
const RARITY_HEX = ['#c08552', '#a9b6c4', '#e3b23c', '#49b6ff', '#d46cff'];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A chamfered rectangle, the game's panel shape. */
function chamfer(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number) {
  g.beginPath();
  g.moveTo(x + k, y); g.lineTo(x + w - k, y); g.lineTo(x + w, y + k); g.lineTo(x + w, y + h - k);
  g.lineTo(x + w - k, y + h); g.lineTo(x + k, y + h); g.lineTo(x, y + h - k); g.lineTo(x, y + k);
  g.closePath();
}

function strokePaths(g: CanvasRenderingContext2D, paths: string[], x: number, y: number, size: number, width: number) {
  g.save();
  g.translate(x, y);
  g.scale(size / 24, size / 24);
  g.lineWidth = width / (size / 24);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const d of paths) g.stroke(new Path2D(d));
  g.restore();
}

/** The emblem for each case, drawn in a circle on the label. */
function emblem(g: CanvasRenderingContext2D, id: CaseId, role: Role | undefined, cx: number, cy: number, r: number, color: string) {
  g.save();
  g.strokeStyle = color; g.fillStyle = color;
  g.lineWidth = 7;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0.18; g.beginPath(); g.arc(cx, cy, r - 12, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  if (id === 'daily') {
    g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r * 0.55, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx, cy - r * 0.38); g.lineTo(cx, cy); g.lineTo(cx + r * 0.28, cy + r * 0.18); g.stroke();
  } else if (id === 'standard') {
    // Crosshair: the scout's scope.
    g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r * 0.5, 0, Math.PI * 2); g.stroke();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      g.beginPath(); g.moveTo(cx + dx * r * 0.25, cy + dy * r * 0.25); g.lineTo(cx + dx * r * 0.78, cy + dy * r * 0.78); g.stroke();
    }
    g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill();
  } else if (id === 'role' && role) {
    strokePaths(g, ROLE_PATHS[role], cx - r * 0.62, cy - r * 0.62, r * 1.24, 9);
  } else if (id === 'role') {
    g.font = `700 ${Math.round(r)}px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', cx, cy + 4);
  } else {
    // Major: a five-pointed star.
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r * 0.66 : r * 0.28;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  g.restore();
}

/**
 * The printed label on the lid: case name, kicker, emblem and the five rarity ticks.
 * Laid out for a panel with an aspect of about 1.55:1.
 */
export function labelTexture(id: CaseId, role?: Role): THREE.CanvasTexture {
  const look = CASE_LOOK[id];
  const W = 1024, H = 660;
  const [c, g] = canvas(W, H);
  // Base: dark printed vinyl with a faint diagonal hatch.
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b2129'); bg.addColorStop(1, '#0f1318');
  chamfer(g, 6, 6, W - 12, H - 12, 46);
  g.fillStyle = bg; g.fill();
  g.save(); g.clip();
  g.globalAlpha = 0.05; g.strokeStyle = '#ffffff'; g.lineWidth = 3;
  for (let x = -H; x < W; x += 22) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
  g.globalAlpha = 1;
  // A wash of the case colour from the emblem side.
  const wash = g.createRadialGradient(230, H * 0.52, 20, 230, H * 0.52, 520);
  wash.addColorStop(0, look.accent + '55'); wash.addColorStop(1, look.accent + '00');
  g.fillStyle = wash; g.fillRect(0, 0, W, H);
  g.restore();
  // Border in the accent colour, gold leaf on the Major Case.
  chamfer(g, 6, 6, W - 12, H - 12, 46);
  g.lineWidth = 10; g.strokeStyle = look.gold ? '#e8c35a' : look.accent; g.stroke();
  chamfer(g, 30, 30, W - 60, H - 60, 32);
  g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.14)'; g.stroke();

  emblem(g, id, role, 230, H * 0.5, 140, look.gold ? '#f2cf6a' : look.accent);

  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = 'rgba(233, 238, 243, 0.62)';
  g.font = `600 34px ${DISPLAY}`;
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '6px';
  g.fillText(`CLUTCH / ${look.kicker}`, 420, 214);
  g.fillStyle = '#f4f6f8';
  const title = id === 'role' && role ? 'ROLE CASE' : look.title;
  let size = 112;
  g.font = `700 ${size}px ${DISPLAY}`;
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '2px';
  while (g.measureText(title).width > W - 470 && size > 60) { size -= 4; g.font = `700 ${size}px ${DISPLAY}`; }
  g.fillText(title, 416, 330);
  if (id === 'role') {
    g.fillStyle = look.accent;
    g.font = `700 64px ${DISPLAY}`;
    g.fillText(role ? ROLE_NAME[role] : 'PICK A ROLE', 420, 410);
  }
  // Rarity ticks along the bottom: bronze to legend (no bronze in the Major Case).
  const ticks = id === 'premium' ? RARITY_HEX.slice(1) : RARITY_HEX;
  ticks.forEach((hex, i) => {
    g.fillStyle = hex;
    chamfer(g, 420 + i * 92, 470, 78, 18, 5);
    g.fill();
  });
  g.fillStyle = 'rgba(233, 238, 243, 0.4)';
  g.font = `500 28px ${DATA}`;
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '3px';
  g.fillText(`${look.serial}-${id === 'role' && role ? ROLE_NAME[role].slice(0, 3) : '000'} · CONTAINER`, 420, 560);
  return texture(c);
}

/** Painted stencil letters for the sides of the case, slightly worn. */
export function stencilTexture(id: CaseId): THREE.CanvasTexture {
  const W = 1024, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = 'rgba(240, 244, 248, 0.82)';
  g.font = `700 168px ${DISPLAY}`;
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '22px';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(CASE_LOOK[id].stencil, W / 2, H / 2 + 8);
  // Stencil bridges: thin horizontal gaps through every letter.
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(0, H / 2 + 2, W, 10);
  // Wear: scattered specks of missing paint.
  let s = 1337;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.75;
    g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.6 + rnd() * 3.2, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  return texture(c);
}

/** The small serial plate on the front of the body. */
export function plateTexture(id: CaseId): THREE.CanvasTexture {
  const look = CASE_LOOK[id];
  const W = 512, H = 128;
  const [c, g] = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#d9dee4'); grd.addColorStop(0.5, '#aab3bd'); grd.addColorStop(1, '#7d8792');
  chamfer(g, 2, 2, W - 4, H - 4, 18);
  g.fillStyle = look.gold ? '#d9b04a' : grd; g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#1a1e24';
  g.font = `600 46px ${DATA}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${look.serial}·0001`, W / 2, H / 2 + 2);
  for (const x of [22, W - 22]) { g.beginPath(); g.arc(x, H / 2, 7, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fill(); }
  return texture(c);
}

/** Fine stipple for moulded plastic, used as a bump and roughness map (linear data). */
export function stippleTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  let s = 4242;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 5200; i++) {
    const v = Math.round(90 + rnd() * 90);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.arc(rnd() * S, rnd() * S, 0.5 + rnd() * 1.6, 0, Math.PI * 2); g.fill();
  }
  const t = texture(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** Egg-crate foam for the inside of the case. */
export function foamTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#16191e'; g.fillRect(0, 0, S, S);
  const step = 32;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const grd = g.createRadialGradient(x + step / 2, y + step / 2, 1, x + step / 2, y + step / 2, step * 0.62);
      grd.addColorStop(0, '#2a2f37'); grd.addColorStop(1, '#121519');
      g.fillStyle = grd; g.fillRect(x, y, step, step);
    }
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 3);
  return t;
}

/** A soft round sprite: white in the middle, fading out. Tinted by the material colour. */
export function glowTexture(hard = 0): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(Math.min(0.9, 0.12 + hard), 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return texture(c);
}

/** A soft ring of light for the floor around the pedestal. */
export function ringTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.42, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return texture(c);
}

/** A blob shadow: dark in the middle, transparent at the edge. */
export function shadowTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return texture(c);
}

/** Whether the label's typefaces are ready, so the canvas text is drawn in Chakra Petch. */
export async function fontsReady(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`700 112px ${DISPLAY}`), document.fonts.load(`600 34px ${DISPLAY}`), document.fonts.load(`500 28px ${DATA}`)]),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
  } catch { /* fall back to the system face */ }
}
