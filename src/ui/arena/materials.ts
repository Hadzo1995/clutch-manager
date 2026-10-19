/**
 * Procedural surface detail for the 3D map: every texture is drawn in code
 * (no image files), in greyscale, and multiplied by the map palette colour, so
 * one set of textures serves all seven maps. Static geometry samples them in
 * world space (triplanar), so stones and bricks keep their real size whatever
 * the box they sit on.
 */
import * as THREE from 'three';

type Draw = (g: CanvasRenderingContext2D, n: number, rnd: () => number) => void;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function tex(n: number, seed: number, draw: Draw): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  draw(g, n, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // Detail maps are multipliers, not colours: keep them linear so mid-grey stays mid-grey.
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Fine grain so flat colours never look like plastic. */
function grain(g: CanvasRenderingContext2D, n: number, rnd: () => number, amount: number, count = n * n / 6) {
  for (let i = 0; i < count; i++) {
    const v = rnd();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * amount})` : `rgba(0,0,0,${(0.5 - v) * amount})`;
    g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function blotches(g: CanvasRenderingContext2D, n: number, rnd: () => number, count: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * n, y = rnd() * n, r = n * (0.05 + rnd() * 0.18);
    const dark = rnd() < 0.55;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, dark ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.8})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
}

/** Flagstones: irregular stone slabs with dark joints. One texture covers 2 m. */
const stones: Draw = (g, n, rnd) => {
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, n, n);
  const rows = 4;
  const rh = n / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * rh;
    while (x < n) {
      const w = rh * (0.8 + rnd() * 1.1);
      const l = 200 + Math.floor(rnd() * 50);
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      x += w;
      // joint
      g.fillStyle = 'rgba(40,40,40,0.55)';
      g.fillRect(x - 2, r * rh, 3, rh);
    }
    g.fillStyle = 'rgba(40,40,40,0.55)';
    g.fillRect(0, r * rh - 1, n, 3);
  }
  blotches(g, n, rnd, 18, 0.12);
  grain(g, n, rnd, 0.22);
};

/** Square tiles (plazas, interiors). */
const tiles: Draw = (g, n, rnd) => {
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, n, n);
  const k = 4, s = n / k;
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
    const l = 205 + Math.floor(rnd() * 40);
    g.fillStyle = `rgb(${l},${l},${l})`; g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
  }
  g.fillStyle = 'rgba(30,30,30,0.5)';
  for (let i = 0; i <= k; i++) { g.fillRect(i * s - 1, 0, 2, n); g.fillRect(0, i * s - 1, n, 2); }
  blotches(g, n, rnd, 12, 0.1);
  grain(g, n, rnd, 0.18);
};

/** Concrete with panel seams (industrial maps). */
const concrete: Draw = (g, n, rnd) => {
  g.fillStyle = '#d2d2d2'; g.fillRect(0, 0, n, n);
  blotches(g, n, rnd, 30, 0.1);
  grain(g, n, rnd, 0.28, n * n / 3);
  g.fillStyle = 'rgba(30,30,30,0.35)';
  g.fillRect(0, 0, n, 2); g.fillRect(0, 0, 2, n);
  g.fillRect(n / 2, 0, 1, n);
};

/** Masonry blocks for walls: courses of 0.6 x 0.3 m blocks. One texture covers 2.4 m. */
const blocks: Draw = (g, n, rnd) => {
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, n, n);
  const rows = 8, rh = n / rows;
  for (let r = 0; r < rows; r++) {
    const bw = n / 4;
    const off = (r % 2) * bw / 2 + (rnd() - 0.5) * 6;
    for (let x = -bw + off; x < n + bw; x += bw * (0.85 + rnd() * 0.3)) {
      const l = 196 + Math.floor(rnd() * 52);
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.fillRect(x + 2, r * rh + 2, bw - 3, rh - 3);
      // a little bevel: lit top, shaded bottom
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 2, r * rh + 2, bw - 3, 3);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 2, r * rh + rh - 4, bw - 3, 3);
    }
  }
  blotches(g, n, rnd, 14, 0.1);
  grain(g, n, rnd, 0.2);
};

/** Smooth render/plaster with faint cracks (wall tops, houses). */
const plaster: Draw = (g, n, rnd) => {
  g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, n, n);
  blotches(g, n, rnd, 26, 0.09);
  grain(g, n, rnd, 0.16, n * n / 3);
  g.strokeStyle = 'rgba(60,60,60,0.25)'; g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    g.beginPath(); let x = rnd() * n, y = rnd() * n; g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 30; y += rnd() * 18; g.lineTo(x, y); }
    g.stroke();
  }
};

/** Wooden crate side: frame plus planks. One texture per crate face. */
const crate: Draw = (g, n, rnd) => {
  g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, n, n);
  const planks = 5, ph = n / planks;
  for (let i = 0; i < planks; i++) {
    const l = 175 + Math.floor(rnd() * 45);
    g.fillStyle = `rgb(${l},${l},${l})`; g.fillRect(0, i * ph + 1, n, ph - 2);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 6; k++) { g.beginPath(); const y = i * ph + rnd() * ph; g.moveTo(0, y); g.bezierCurveTo(n * 0.3, y + (rnd() - 0.5) * 6, n * 0.6, y + (rnd() - 0.5) * 6, n, y); g.stroke(); }
  }
  const f = n * 0.11;
  g.fillStyle = 'rgb(150,150,150)';
  g.fillRect(0, 0, n, f); g.fillRect(0, n - f, n, f); g.fillRect(0, 0, f, n); g.fillRect(n - f, 0, f, n);
  g.save(); g.translate(n / 2, n / 2); g.rotate(Math.PI / 4); g.fillRect(-n * 0.7, -f / 2, n * 1.4, f); g.restore();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (const [x, y] of [[f / 2, f / 2], [n - f / 2, f / 2], [f / 2, n - f / 2], [n - f / 2, n - f / 2]]) { g.beginPath(); g.arc(x!, y!, 3, 0, 7); g.fill(); }
  grain(g, n, rnd, 0.18);
};

/** Corrugated metal (containers, sheds). */
const ribbed: Draw = (g, n, rnd) => {
  const ribs = 16, w = n / ribs;
  for (let i = 0; i < ribs; i++) {
    const gr = g.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    gr.addColorStop(0, '#9a9a9a'); gr.addColorStop(0.5, '#e6e6e6'); gr.addColorStop(1, '#a6a6a6');
    g.fillStyle = gr; g.fillRect(i * w, 0, w, n);
  }
  blotches(g, n, rnd, 10, 0.12);
  grain(g, n, rnd, 0.14);
};

/** Water: soft ripples (tinted and animated by the material). */
const water: Draw = (g, n, rnd) => {
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * n, y = rnd() * n, r = 6 + rnd() * 20;
    g.beginPath(); g.ellipse(x, y, r, r * 0.35, 0, 0.2, Math.PI - 0.2); g.stroke();
  }
};

/** Grass / foliage patches. */
const grass: Draw = (g, n, rnd) => {
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 2600; i++) {
    const l = 120 + Math.floor(rnd() * 130);
    g.strokeStyle = `rgba(${l},${l},${l},0.8)`; g.lineWidth = 1;
    const x = rnd() * n, y = rnd() * n;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 5); g.stroke();
  }
};

/** Plaster with fallen-off patches that show brick underneath. */
const stucco: Draw = (g, n, rnd) => {
  plaster(g, n, rnd);
  for (let i = 0; i < 3; i++) {
    const cx = rnd() * n, cy = rnd() * n, rx = n * (0.06 + rnd() * 0.08), ry = rx * (0.5 + rnd() * 0.4);
    g.save();
    g.beginPath();
    for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2, rr = 0.7 + rnd() * 0.45; g.lineTo(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr); }
    g.closePath(); g.clip();
    g.fillStyle = '#9a9a9a'; g.fillRect(cx - rx * 1.3, cy - ry * 1.3, rx * 2.6, ry * 2.6);
    const bh = n / 22, bw = bh * 2.6;
    for (let y = cy - ry * 1.3, row = 0; y < cy + ry * 1.3; y += bh, row++) for (let x = cx - rx * 1.3 - (row % 2) * bw / 2; x < cx + rx * 1.3; x += bw) {
      const l = 160 + Math.floor(rnd() * 45);
      g.fillStyle = `rgb(${l},${l},${l})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
    g.restore();
    g.strokeStyle = 'rgba(40,40,40,0.35)'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(cx, cy, rx * 1.05, ry * 1.05, 0, 0, Math.PI * 2); g.stroke();
  }
};

/** Large dressed sandstone blocks, softly weathered. One texture covers 2.4 m. */
const sandstone: Draw = (g, n, rnd) => {
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, n, n);
  const rows = 4, rh = n / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * rh;
    while (x < n) {
      const w = rh * (1.4 + rnd() * 1.2);
      const l = 200 + Math.floor(rnd() * 40);
      const gr = g.createLinearGradient(0, r * rh, 0, r * rh + rh);
      gr.addColorStop(0, `rgb(${l + 12},${l + 12},${l + 12})`); gr.addColorStop(1, `rgb(${l - 18},${l - 18},${l - 18})`);
      g.fillStyle = gr;
      g.beginPath(); g.roundRect(x + 2, r * rh + 2, w - 4, rh - 4, 5); g.fill();
      x += w;
    }
  }
  blotches(g, n, rnd, 24, 0.12);
  grain(g, n, rnd, 0.3, n * n / 2);
};

/** Jungle stone: irregular blocks, dark moss creeping out of the joints. */
const mossy: Draw = (g, n, rnd) => {
  sandstone(g, n, rnd);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * n, y = Math.round(rnd() * 4) * (n / 4), r = n * (0.03 + rnd() * 0.07);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(30,30,30,0.55)'); gr.addColorStop(1, 'rgba(30,30,30,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
};

/** Height field (0..1) of clay tiles: alternating convex caps and pans, each course overlapping the one below. */
function tileHeight(n: number, rnd: () => number): Float32Array {
  const h = new Float32Array(n * n);
  const cols = 4, rows = 4, cw = n / cols, rh = n / rows;
  const jitter = Array.from({ length: cols * rows }, () => rnd());
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const row = Math.floor(y / rh);
    const xs = (x + (row % 2) * cw / 2) % n;
    const col = Math.floor(xs / cw);
    const fx = (xs % cw) / cw, fy = (y % rh) / rh;
    const arch = Math.sin(fx * Math.PI);
    // Canvas y runs down the slope: each course thickens toward its lower edge.
    const v = 0.2 + 0.55 * Math.pow(arch, 0.7) + 0.25 * fy + (jitter[row * cols + col]! - 0.5) * 0.12;
    h[y * n + x] = fy > 0.94 ? v * 0.4 : v;
  }
  return h;
}

/** Height field of ribbed metal sheets with seams between sheets. */
function metalHeight(n: number, rnd: () => number): Float32Array {
  const h = new Float32Array(n * n);
  const ribs = 8, w = n / ribs;
  const seams = [0, Math.floor(n * (0.45 + rnd() * 0.1))];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const f = (x % w) / w;
    let v = f > 0.42 && f < 0.58 ? 1 : f > 0.36 && f < 0.64 ? 0.6 : 0.2;
    if (seams.some((s) => Math.abs(y - s) < 2)) v -= 0.12;
    h[y * n + x] = v;
  }
  return h;
}

/** Draw a height field as light-from-above shading, or as a tangent-space normal map. */
function fromHeight(g: CanvasRenderingContext2D, n: number, h: Float32Array, mode: 'shade' | 'normal', strength = 2) {
  const img = g.createImageData(n, n);
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)]!;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const i = (y * n + x) * 4;
    if (mode === 'normal') {
      const l = Math.hypot(dx, dy, 1);
      // Canvas y is flipped against v, so +dy here means the surface rises toward -v.
      img.data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); img.data[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); img.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    } else {
      const v = 150 + at(x, y) * 90 - dy * 30;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
    }
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (mode === 'shade') { blotches(g, n, rng(n + 5), 14, 0.14); grain(g, n, rng(n + 9), 0.16); }
}

/** Flat roof membrane: sheet seams, patches, drain stains. */
const roofFlat: Draw = (g, n, rnd) => {
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, n, n);
  blotches(g, n, rnd, 34, 0.14);
  grain(g, n, rnd, 0.3, n * n / 2);
  g.fillStyle = 'rgba(40,40,40,0.25)';
  for (let i = 0; i < 4; i++) g.fillRect(0, Math.floor(i * n / 4), n, 2);
  for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},0.1)`; g.fillRect(rnd() * n, rnd() * n, 20 + rnd() * 50, 14 + rnd() * 30); }
};

/** Wind-rippled sand. */
const sand: Draw = (g, n, rnd) => {
  g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, n, n);
  g.lineWidth = 2;
  for (let i = 0; i < 28; i++) {
    const y0 = rnd() * n;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255,0.2' : '0,0,0,0.12'})`;
    g.beginPath(); g.moveTo(0, y0);
    for (let x = 0; x <= n; x += 16) g.lineTo(x, y0 + Math.sin(x / n * Math.PI * 2 * 2 + i) * 6);
    g.stroke();
  }
  blotches(g, n, rnd, 16, 0.1);
  grain(g, n, rnd, 0.3, n * n / 2);
};

/** Jungle floor: dark grass, leaf litter and dirt. */
const jungle: Draw = (g, n, rnd) => {
  grass(g, n, rnd);
  for (let i = 0; i < 220; i++) {
    const l = 60 + Math.floor(rnd() * 90);
    g.fillStyle = `rgba(${l},${l},${l},0.7)`;
    g.beginPath(); g.ellipse(rnd() * n, rnd() * n, 2 + rnd() * 4, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  blotches(g, n, rnd, 20, 0.2);
};

/** Worn asphalt with patches and a painted line. */
const asphalt: Draw = (g, n, rnd) => {
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, n, n);
  grain(g, n, rnd, 0.5, n * n);
  blotches(g, n, rnd, 18, 0.16);
  g.strokeStyle = 'rgba(20,20,20,0.4)'; g.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) { g.beginPath(); let x = rnd() * n, y = rnd() * n; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
};

/** Window and door atlas cells (4 x 2), in colour. */
export const WINDOW = { shutterGreen: 0, shutterOpen: 1, arch: 2, square: 3, industrial: 4, doorWood: 5, doorMetal: 6, ornament: 7 } as const;
function windowAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const cell = (i: number, draw: (x: number, y: number) => void) => { g.save(); g.translate((i % 4) * 128, Math.floor(i / 4) * 128); draw(0, 0); g.restore(); };
  const slats = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let k = y + 4; k < y + h; k += 7) g.fillRect(x + 2, k, w - 4, 2);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };
  cell(0, () => { g.fillStyle = '#e8dcc4'; g.fillRect(14, 6, 100, 116); slats(22, 14, 41, 100, '#4f6f45'); slats(65, 14, 41, 100, '#4f6f45'); g.fillStyle = '#d9cbb0'; g.fillRect(10, 112, 108, 10); });
  cell(1, () => { g.fillStyle = '#e8dcc4'; g.fillRect(30, 6, 68, 116); g.fillStyle = '#20252a'; g.fillRect(38, 14, 52, 98); g.fillStyle = '#3a4a52'; g.fillRect(42, 18, 20, 44); g.fillRect(66, 18, 20, 44); slats(4, 14, 26, 100, '#7a4e2e'); slats(98, 14, 26, 100, '#7a4e2e'); g.fillStyle = '#d9cbb0'; g.fillRect(26, 112, 76, 10); });
  cell(2, () => {
    g.fillStyle = '#efe4cf'; g.beginPath(); g.moveTo(22, 124); g.lineTo(22, 50); g.arc(64, 50, 42, Math.PI, 0); g.lineTo(106, 124); g.fill();
    g.fillStyle = '#1d2226'; g.beginPath(); g.moveTo(32, 118); g.lineTo(32, 52); g.arc(64, 52, 32, Math.PI, 0); g.lineTo(96, 118); g.fill();
    g.strokeStyle = '#3c6f86'; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 22); g.lineTo(64, 118); g.moveTo(32, 70); g.lineTo(96, 70); g.stroke();
  });
  cell(3, () => { g.fillStyle = '#5a3d24'; g.fillRect(26, 22, 76, 12); g.fillStyle = '#211c18'; g.fillRect(34, 34, 60, 62); g.fillStyle = '#3d2c1c'; for (let x = 40; x < 94; x += 12) g.fillRect(x, 34, 4, 62); g.fillStyle = '#d8c39a'; g.fillRect(30, 96, 68, 8); });
  cell(4, () => { g.fillStyle = '#5d646b'; g.fillRect(8, 20, 112, 88); for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 4; xx++) { g.fillStyle = (xx + yy) % 3 ? '#405260' : '#55707f'; g.fillRect(14 + xx * 27, 26 + yy * 27, 23, 23); } });
  cell(5, () => { g.fillStyle = '#e6d8bc'; g.beginPath(); g.moveTo(16, 128); g.lineTo(16, 40); g.arc(64, 40, 48, Math.PI, 0); g.lineTo(112, 128); g.fill(); g.fillStyle = '#6b4426'; g.beginPath(); g.moveTo(26, 128); g.lineTo(26, 42); g.arc(64, 42, 38, Math.PI, 0); g.lineTo(102, 128); g.fill(); g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 34; x < 100; x += 11) g.fillRect(x, 20, 2, 108); g.fillStyle = '#2b2b2b'; g.fillRect(86, 80, 6, 6); });
  cell(6, () => { g.fillStyle = '#3d4247'; g.fillRect(6, 8, 116, 120); for (let y = 14; y < 126; y += 6) { g.fillStyle = y % 12 ? '#8c939a' : '#767d84'; g.fillRect(10, y, 108, 4); } });
  cell(7, () => { g.fillStyle = '#d9c08c'; g.fillRect(4, 40, 120, 48); g.fillStyle = '#2f8f95'; g.fillRect(4, 44, 120, 8); g.fillRect(4, 76, 120, 8); g.fillStyle = '#7a4b2a'; for (let x = 12; x < 120; x += 22) { g.beginPath(); g.arc(x, 64, 6, 0, Math.PI * 2); g.fill(); g.fillRect(x + 8, 58, 4, 12); } });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface SurfaceSet {
  stones: THREE.CanvasTexture; tiles: THREE.CanvasTexture; concrete: THREE.CanvasTexture; blocks: THREE.CanvasTexture;
  plaster: THREE.CanvasTexture; crate: THREE.CanvasTexture; ribbed: THREE.CanvasTexture; water: THREE.CanvasTexture; grass: THREE.CanvasTexture;
  /** Plaster with patches where it has fallen off and the brick shows (Inferno). */
  stucco: THREE.CanvasTexture;
  /** Large dressed sandstone blocks (Dust2, Anubis). */
  sandstone: THREE.CanvasTexture;
  /** Old jungle stone with moss in the joints (Ancient). */
  mossy: THREE.CanvasTexture;
  /** Clay roof tiles in courses (UV mapped: u along the eave, v up the slope). */
  roofTiles: THREE.CanvasTexture; roofTilesN: THREE.CanvasTexture;
  /** Standing-seam / corrugated metal roofing (UV mapped like roofTiles). */
  metalRoof: THREE.CanvasTexture; metalRoofN: THREE.CanvasTexture;
  /** Flat roof membrane: seams, patches and stains. */
  roofFlat: THREE.CanvasTexture;
  sand: THREE.CanvasTexture; jungle: THREE.CanvasTexture; asphalt: THREE.CanvasTexture;
  /** Colour atlas of windows and doors, 4 x 2 cells (see WINDOW). */
  windows: THREE.CanvasTexture;
}

let cached: SurfaceSet | null = null;
let users = 0;

/** Shared textures (drawn once, reused across maps and viewers). */
export function surfaces(): SurfaceSet {
  users++;
  if (!cached) {
    cached = {
      stones: tex(256, 11, stones), tiles: tex(256, 12, tiles), concrete: tex(256, 13, concrete), blocks: tex(256, 14, blocks),
      plaster: tex(256, 15, plaster), crate: tex(128, 16, crate), ribbed: tex(128, 17, ribbed), water: tex(256, 18, water), grass: tex(256, 19, grass),
      stucco: tex(256, 21, stucco), sandstone: tex(256, 22, sandstone), mossy: tex(256, 23, mossy),
      roofTiles: tex(256, 24, (g, n, r) => fromHeight(g, n, tileHeight(n, r), 'shade')), roofTilesN: tex(256, 24, (g, n, r) => fromHeight(g, n, tileHeight(n, r), 'normal', 3.2)),
      metalRoof: tex(256, 25, (g, n, r) => fromHeight(g, n, metalHeight(n, r), 'shade')), metalRoofN: tex(256, 25, (g, n, r) => fromHeight(g, n, metalHeight(n, r), 'normal', 2.2)),
      roofFlat: tex(256, 26, roofFlat), sand: tex(256, 27, sand), jungle: tex(256, 28, jungle), asphalt: tex(256, 29, asphalt),
      windows: windowAtlas(),
    };
  }
  return cached;
}

export function releaseSurfaces() {
  users = Math.max(0, users - 1);
  if (users === 0 && cached) { for (const t of Object.values(cached)) t.dispose(); cached = null; }
}

/** Which floor look a map uses. */
export function floorStyle(map: string): keyof SurfaceSet {
  if (map === 'Nuke' || map === 'Cache') return 'concrete';
  if (map === 'Mirage' || map === 'Anubis') return 'tiles';
  return 'stones';
}

/**
 * A standard material whose map is sampled in world space: `top` on surfaces
 * facing up, `side` on walls. `scale` is texture repeats per metre.
 */
export function worldMaterial(opts: { top: THREE.Texture; side?: THREE.Texture; topScale: number; sideScale?: number; roughness?: number; metalness?: number; color?: THREE.ColorRepresentation; baseShade?: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0.02 });
  const uniforms = {
    tpTop: { value: opts.top },
    tpSide: { value: opts.side ?? opts.top },
    tpTopScale: { value: opts.topScale },
    tpSideScale: { value: opts.sideScale ?? opts.topScale },
    tpBaseShade: { value: opts.baseShade ?? 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;\nvarying float vTpLocalY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vTpLocalY = position.y;
        vec4 tpW = vec4(transformed, 1.0);
        vec3 tpN = objectNormal;
        #ifdef USE_INSTANCING
          tpW = instanceMatrix * tpW;
          tpN = mat3(instanceMatrix) * tpN;
        #endif
        tpW = modelMatrix * tpW;
        vTpPos = tpW.xyz;
        vTpNrm = normalize(mat3(modelMatrix) * tpN);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;\nvarying float vTpLocalY;\nuniform float tpBaseShade;\nuniform sampler2D tpTop;\nuniform sampler2D tpSide;\nuniform float tpTopScale;\nuniform float tpSideScale;')
      .replace('#include <map_fragment>', `
        vec3 tpB = pow(abs(normalize(vTpNrm)), vec3(6.0));
        tpB /= (tpB.x + tpB.y + tpB.z + 1e-5);
        vec3 tpX = texture2D(tpSide, vTpPos.zy * tpSideScale).rgb;
        vec3 tpY = texture2D(tpTop, vTpPos.xz * tpTopScale).rgb;
        vec3 tpZ = texture2D(tpSide, vTpPos.xy * tpSideScale).rgb;
        diffuseColor.rgb *= tpX * tpB.x + tpY * tpB.y + tpZ * tpB.z;
        // Contact shading: side faces darken toward the bottom of each block.
        diffuseColor.rgb *= mix(1.0, mix(1.0 - tpBaseShade, 1.0, smoothstep(-0.5, 0.15, vTpLocalY)), 1.0 - tpB.y);`);
  };
  mat.customProgramCacheKey = () => `tp-${opts.baseShade ?? 0}-${opts.top.uuid}-${(opts.side ?? opts.top).uuid}-${opts.topScale}-${opts.sideScale ?? opts.topScale}`;
  return mat;
}
