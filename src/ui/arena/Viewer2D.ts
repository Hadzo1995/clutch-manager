/**
 * 2D radar renderer: the fallback when WebGL is unavailable, and the minimap.
 * Draws the same MapGeometry and RoundTimeline as the 3D view, so both always
 * agree on positions, HP, utility and the bomb.
 */
import { flightAt } from '../../engine/sim/flight';
import type { MapGeometry } from '../../maps/types';
import { BOMB_SECONDS, HEAR_RUN, WALK_RING, aimAt, blindAmount, bombAt, hpAt, isSpotted, paceAt, posAt } from './timeline';
import { activeSmokes, visionFan } from './vision';
import type { RoundTimeline } from './timeline';

export interface RadarColors { t: string; ct: string }

/** Pre-rendered map layer (cached per geometry + size). */
const layerCache = new WeakMap<MapGeometry, Map<number, HTMLCanvasElement>>();

export function drawMapLayer(geo: MapGeometry, px: number, colors: RadarColors): HTMLCanvasElement {
  let byPx = layerCache.get(geo);
  if (!byPx) { byPx = new Map(); layerCache.set(geo, byPx); }
  const hit = byPx.get(px);
  if (hit) return hit;
  // Keep only a few sizes per map; resizing would otherwise pile up canvases.
  while (byPx.size >= 4) byPx.delete(byPx.keys().next().value!);
  const s = px / Math.max(geo.w, geo.h);
  const c = document.createElement('canvas');
  c.width = Math.round(geo.w * s); c.height = Math.round(geo.h * s);
  const g = c.getContext('2d')!;
  const pal = geo.palette;
  const siteCells = new Set<number>();
  for (const r of [geo.sites.A, geo.sites.B]) for (const [x, y] of r.cells) siteCells.add(y * geo.w + x);
  const tSp = new Set(geo.tSpawn.map(([x, y]) => y * geo.w + x));
  const ctSp = new Set(geo.ctSpawn.map(([x, y]) => y * geo.w + x));
  // Radar look: a cool slate floor tinted toward the map palette, lighter where higher.
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < geo.w * geo.h; i++) if (geo.kind[i] !== 'void' && geo.kind[i] !== 'wall') { hMin = Math.min(hMin, geo.height[i]!); hMax = Math.max(hMax, geo.height[i]!); }
  const hSpan = Math.max(1, hMax - hMin);
  const base = mix(pal.floor, '#7d8b98', 0.62);
  const walk = (i: number) => { const k = geo.kind[i]; return k === 'floor' || k === 'low' || k === 'tall' || k === 'rail'; };
  for (let y = 0; y < geo.h; y++) for (let x = 0; x < geo.w; x++) {
    const i = y * geo.w + x;
    if (!walk(i)) continue;
    const k = geo.kind[i];
    const h = (geo.height[i]! - hMin) / hSpan;
    let col = shade(base, -0.38 + h * 0.42);
    if (siteCells.has(i)) col = mix(col, pal.accent, 0.3);
    else if (tSp.has(i)) col = mix(col, colors.t, 0.25);
    else if (ctSp.has(i)) col = mix(col, colors.ct, 0.25);
    if (k === 'low') col = shade(col, -0.32);
    else if (k === 'tall') col = shade(col, -0.5);
    g.fillStyle = col;
    g.fillRect(Math.floor(x * s), Math.floor(y * s), Math.ceil(s) + (s < 3 ? 0.5 : 0), Math.ceil(s) + (s < 3 ? 0.5 : 0));
  }
  // Edges: bright outline where walkable space meets walls, darker lines at ledges.
  const lw = Math.max(1, s * 0.22);
  g.lineCap = 'square';
  const edge = (x0: number, y0: number, x1: number, y1: number) => { g.moveTo(x0 * s, y0 * s); g.lineTo(x1 * s, y1 * s); };
  g.beginPath(); g.strokeStyle = 'rgba(214,224,233,0.7)'; g.lineWidth = lw;
  for (let y = 0; y < geo.h; y++) for (let x = 0; x < geo.w; x++) {
    const i = y * geo.w + x;
    if (!walk(i)) continue;
    if (x === 0 || !walk(i - 1)) edge(x, y, x, y + 1);
    if (x === geo.w - 1 || !walk(i + 1)) edge(x + 1, y, x + 1, y + 1);
    if (y === 0 || !walk(i - geo.w)) edge(x, y, x + 1, y);
    if (y === geo.h - 1 || !walk(i + geo.w)) edge(x, y + 1, x + 1, y + 1);
  }
  g.stroke();
  g.beginPath(); g.strokeStyle = 'rgba(5,8,11,0.55)'; g.lineWidth = Math.max(1, s * 0.16);
  for (let y = 0; y < geo.h; y++) for (let x = 0; x < geo.w; x++) {
    const i = y * geo.w + x;
    if (!walk(i)) continue;
    const h = geo.height[i]!;
    if (x < geo.w - 1 && walk(i + 1) && Math.abs(geo.height[i + 1]! - h) > 0.65) edge(x + 1, y, x + 1, y + 1);
    if (y < geo.h - 1 && walk(i + geo.w) && Math.abs(geo.height[i + geo.w]! - h) > 0.65) edge(x, y + 1, x + 1, y + 1);
  }
  g.stroke();
  // Site letters
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const k of ['A', 'B'] as const) {
    const r = geo.sites[k];
    g.font = `700 ${Math.round(s * 9)}px "Chakra Petch", system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.fillText(k, (r.center[0] + 0.5) * s, (r.center[1] + 0.5) * s);
  }
  byPx.set(px, c);
  return c;
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: [number, number, number]): string { return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`; }
function mix(a: string, b: string, t: number): string { const x = parse(a), y = parse(b); return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
function shade(a: string, k: number): string { return k >= 0 ? mix(a, '#ffffff', k) : mix(a, '#000000', -k); }

export class Viewer2D {
  private ctx: CanvasRenderingContext2D;
  private tl: RoundTimeline | null = null;
  private ro: ResizeObserver;
  followId: string | null = null;
  showLabels = true;
  showVision = true;
  /** Pace rings: small around walkers, out to 20 m (how far steps carry) around runners; who heard whom. */
  showSound = true;
  /** Corner radar: tighter framing, smaller marks, no names. */
  mini = false;
  private bg: { key: string; c: HTMLCanvasElement } | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly geo: MapGeometry, readonly colors: RadarColors) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  setTimeline(tl: RoundTimeline) { this.tl = tl; }

  /** Background, faint 8 m grid and the map with a soft drop shadow, baked once per size. */
  private backdrop(W: number, H: number, layer: HTMLCanvasElement, ox: number, oy: number, s: number): HTMLCanvasElement {
    const key = `${W}x${H}|${layer.width}|${this.mini}`;
    if (this.bg?.key === key) return this.bg.c;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    grad.addColorStop(0, '#111821'); grad.addColorStop(1, '#080b10');
    g.fillStyle = this.mini ? '#0a0e13' : grad; g.fillRect(0, 0, W, H);
    if (!this.mini) {
      g.strokeStyle = 'rgba(160,190,220,0.045)'; g.lineWidth = 1;
      g.beginPath();
      const step = 8 * s;
      for (let x = ox % step; x < W; x += step) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, H); }
      for (let y = oy % step; y < H; y += step) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); }
      g.stroke();
    }
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = this.mini ? 6 : 22; g.shadowOffsetY = this.mini ? 1 : 6;
    g.drawImage(layer, ox, oy);
    g.restore();
    this.bg = { key, c };
    return c;
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
  }

  render(t: number) {
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    const geo = this.geo;
    const side = this.mini ? Math.min(W, H) : Math.min(W, H * 0.9);
    const layer = drawMapLayer(geo, Math.round(side), this.colors);
    const ox = (W - layer.width) / 2, oy = (H - layer.height) / 2 + (this.mini ? 0 : H * 0.03);
    const s = layer.width / geo.w;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.backdrop(W, H, layer, ox, oy, s), 0, 0);
    const tl = this.tl;
    if (!tl) return;
    const P = (v: [number, number]) => [ox + v[0] * s, oy + v[1] * s] as const;

    // Utility
    for (const u of tl.utility) {
      if (t < u.throwT) continue;
      const [x, y] = P(u.at);
      if (t < u.t) {
        // Same simulated flight as the 3D view: a trail from the hand to the grenade, gone when it pops.
        const tint = u.side === 'T' ? this.colors.t : this.colors.ct;
        g.strokeStyle = tint; g.globalAlpha = 0.85; g.lineWidth = Math.max(1, s * 0.18); g.setLineDash([s * 0.6, s * 0.4]);
        g.beginPath();
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
          const f = flightAt(u.flight, u.throwT + ((t - u.throwT) * i) / steps);
          const [px, py] = P([f.x, f.y]);
          if (i) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        const f = flightAt(u.flight, t);
        const [gx, gy] = P([f.x, f.y]);
        // Higher in the arc = drawn a little bigger.
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(gx, gy, s * (0.32 + Math.min(0.3, Math.max(0, f.h - u.flight.atH) * 0.04)), 0, 7); g.fill();
        g.strokeStyle = 'rgba(8,11,15,0.8)'; g.lineWidth = 1; g.stroke();
        continue;
      }
      const since = t - u.t;
      const r = u.radius * s;
      if (u.kind === 'smoke' && since < u.duration) {
        const a = Math.min(1, (u.duration - since) / 2);
        g.fillStyle = `rgba(205,212,220,${0.85 * a})`; g.beginPath(); g.arc(x, y, r * Math.min(1, 0.4 + since / 1.3), 0, 7); g.fill();
        g.strokeStyle = u.side === 'T' ? this.colors.t : this.colors.ct; g.lineWidth = Math.max(1, s * 0.2); g.globalAlpha = 0.7 * a; g.stroke(); g.globalAlpha = 1;
      } else if (u.kind === 'molotov' && since < u.duration) {
        const a = Math.min(1, (u.duration - since) / 1.2);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(255,170,60,${0.9 * a})`); gr.addColorStop(1, `rgba(255,60,0,${0.25 * a})`);
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      } else if (u.kind === 'flash' && since < 0.6) {
        g.fillStyle = `rgba(255,255,255,${1 - since / 0.6})`; g.beginPath(); g.arc(x, y, s * (1 + since * 8), 0, 7); g.fill();
      } else if (u.kind === 'he' && since < 0.6) {
        g.strokeStyle = `rgba(255,160,64,${1 - since / 0.6})`; g.lineWidth = s * 0.5; g.beginPath(); g.arc(x, y, r * (0.3 + since * 1.4), 0, 7); g.stroke();
      }
    }

    // Tracers
    for (const sh of tl.shots) {
      if (sh.t > t) break;
      if (sh.t < t - 0.1) continue;
      const a = tl.byId.get(sh.from), b = tl.byId.get(sh.to);
      if (!a || !b) continue;
      const [ax, ay] = P(posAt(a, t)), [bx, by] = P(posAt(b, t));
      g.strokeStyle = sh.lethal ? 'rgba(255,140,100,0.95)' : 'rgba(255,220,120,0.85)'; g.lineWidth = Math.max(1, s * 0.15);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }

    // Bomb
    const b = bombAt(tl, t);
    if (b.at && b.state !== 'carried') {
      const [x, y] = P(b.at);
      const blink = b.state === 'planted' || b.state === 'defusing' ? Math.sin((t - (tl.bomb.plantT ?? 0)) * Math.PI * 2 * (BOMB_SECONDS - (t - (tl.bomb.plantT ?? 0)) > 10 ? 1 : 4)) > 0 : false;
      g.fillStyle = b.state === 'defused' ? '#5aa9e6' : blink ? '#ff3b30' : '#a32a22';
      g.fillRect(x - s * 0.5, y - s * 0.35, s, s * 0.7);
      if (b.state === 'exploded') { g.fillStyle = 'rgba(255,120,30,0.35)'; g.beginPath(); g.arc(x, y, s * 8, 0, 7); g.fill(); }
    }

    // Pace rings: a small ring around a walking player, a large faint one out to 20 m (how far
    // the steps carry) around a running one. Dashed lines show who heard a runner and turned on them.
    if (this.showSound) {
      tl.players.forEach((p, i) => {
        const pace = paceAt(p, t);
        if (pace === 'still') return;
        const [x, y] = P(posAt(p, t));
        const run = pace === 'run';
        const R = (run ? HEAR_RUN : WALK_RING) * s;
        g.strokeStyle = g.fillStyle = p.side === 'T' ? this.colors.t : this.colors.ct;
        g.globalAlpha = run ? 0.025 : 0.05;
        g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
        g.globalAlpha = run ? 0.22 : 0.35;
        g.lineWidth = Math.max(1, s * 0.1);
        g.beginPath(); g.arc(x, y, R, 0, 7); g.stroke();
        if (run) {
          const ph = (t * 0.8 + i * 0.137) % 1;
          g.globalAlpha = (1 - ph) * 0.14;
          g.beginPath(); g.arc(x, y, Math.max(1, R * ph), 0, 7); g.stroke();
        }
      });
      g.setLineDash([s * 0.7, s * 0.5]);
      for (const h of tl.heard) {
        if (t < h.t || t > h.t + 1.8) continue;
        const a = tl.byId.get(h.listener), b = tl.byId.get(h.source);
        if (!a || !b || (a.deathT !== null && t >= a.deathT) || (b.deathT !== null && t >= b.deathT)) continue;
        const [ax, ay] = P(posAt(a, t)), [bx, by] = P(posAt(b, t));
        g.strokeStyle = a.side === 'T' ? this.colors.t : this.colors.ct;
        g.globalAlpha = 0.6 * (1 - (t - h.t) / 1.8);
        g.lineWidth = Math.max(1, s * 0.2);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
      g.setLineDash([]); g.globalAlpha = 1;
    }

    // View cones, under everything that moves.
    if (this.showVision) {
      const smokes = activeSmokes(tl, t);
      for (const p of tl.players) {
        if (p.deathT !== null && t >= p.deathT) continue;
        const pos = posAt(p, t);
        const fan = visionFan(geo, pos, aimAt(p, t), smokes);
        g.fillStyle = p.side === 'T' ? this.colors.t : this.colors.ct; g.globalAlpha = 0.17;
        g.beginPath(); const [x0, y0] = P(pos); g.moveTo(x0, y0);
        for (const v of fan) { const [x, y] = P(v); g.lineTo(x, y); }
        g.closePath(); g.fill(); g.globalAlpha = 1;
      }
    }

    // Callouts: biggest regions first, skipping any that would overlap.
    if (this.showLabels) {
      const fs = Math.max(9, Math.round(s * 0.95));
      g.font = `600 ${fs}px "Chakra Petch", system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const boxes: [number, number, number, number][] = [];
      // Player dots and name tags win: callouts under them are skipped.
      if (!this.mini) {
        const nfs = Math.max(10, Math.round(s * 1.15));
        const r = Math.max(4.5, s * 0.9);
        for (const p of tl.players) {
          if (p.deathT !== null && t >= p.deathT) continue;
          const [x, y] = P(posAt(p, t));
          const w = g.measureText(p.handle).width * (nfs / fs) / 2 + 4;
          boxes.push([x, y - r * 0.8 - nfs / 2, Math.max(w, r * 1.5), nfs / 2 + r * 1.3]);
        }
      }
      const regs = geo.regions.filter((r) => !r.site && r.zone !== 'TS' && r.zone !== 'CTS').sort((a, b) => b.cells.length - a.cells.length);
      for (const r of regs) {
        const text = r.name.toUpperCase();
        const [x, y] = P([r.center[0] + 0.5, r.center[1] + 0.5]);
        const w = g.measureText(text).width / 2 + 3, h = fs / 2 + 2;
        if (boxes.some(([bx, by, bw, bh]) => Math.abs(bx - x) < bw + w && Math.abs(by - y) < bh + h)) continue;
        boxes.push([x, y, w, h]);
        g.fillStyle = 'rgba(232,238,244,0.6)';
        g.fillText(text, x, y);
      }
    }

    // Players
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    const placed: [number, number, number][] = [];
    for (const p of tl.players) {
      const [x, y] = P(posAt(p, t));
      const col = p.side === 'T' ? this.colors.t : this.colors.ct;
      const dead = p.deathT !== null && t >= p.deathT;
      const r = this.mini ? Math.max(3.2, s * 1.1) : Math.max(4.5, s * 0.9);
      if (dead) {
        g.strokeStyle = 'rgba(200,210,220,0.55)'; g.lineWidth = Math.max(1.5, s * 0.2);
        g.beginPath(); g.moveTo(x - r * 0.7, y - r * 0.7); g.lineTo(x + r * 0.7, y + r * 0.7); g.moveTo(x + r * 0.7, y - r * 0.7); g.lineTo(x - r * 0.7, y + r * 0.7); g.stroke();
        continue;
      }
      const hd = aimAt(p, t);
      g.fillStyle = col; g.globalAlpha = 0.55;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, r * 2.4, hd - 0.4, hd + 0.4); g.closePath(); g.fill();
      g.globalAlpha = 1;
      if (isSpotted(p, t)) { g.strokeStyle = '#ff5a4f'; g.lineWidth = Math.max(1.5, r * 0.3); g.beginPath(); g.arc(x, y, r * 2.0, 0, 7); g.stroke(); }
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = col; g.fill();
      g.lineWidth = Math.max(1.5, r * 0.3); g.strokeStyle = this.followId === p.id ? '#ffffff' : '#0a0e13'; g.stroke();
      const hp = hpAt(p, t);
      g.strokeStyle = hp > 50 ? '#4cc38a' : hp > 20 ? '#e8c547' : '#f06a5f'; g.lineWidth = Math.max(1.5, r * 0.28);
      g.beginPath(); g.arc(x, y, r * 1.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (hp / 100)); g.stroke();
      if (blindAmount(p, t) > 0.2) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x, y, r * 0.6, 0, 7); g.fill(); }
      if (b.state === 'carried' && b.carrier === p.id) { g.fillStyle = '#ff3b30'; g.fillRect(x + r * 0.6, y + r * 0.2, r * 0.9, r * 0.6); }
      if (!this.mini && (this.showLabels || this.followId === p.id)) {
        const fs = Math.max(10, Math.round(s * 1.15));
        g.font = `600 ${fs}px "Chakra Petch", system-ui, sans-serif`;
        const w = g.measureText(p.handle).width / 2 + 4;
        let ly = y - r * 1.7;
        for (let k = 0; k < 6; k++) {
          const hit = placed.find(([px, py, pw]) => Math.abs(px - x) < pw + w && Math.abs(py - ly) < fs + 1);
          if (!hit) break;
          ly = hit[1] - fs - 2;
        }
        placed.push([x, ly, w]);
        g.fillStyle = 'rgba(8,11,15,0.72)';
        g.beginPath(); g.roundRect(x - w, ly - fs - 1, w * 2, fs + 3, 3); g.fill();
        g.fillStyle = this.followId === p.id ? '#ffffff' : 'rgba(238,243,247,0.95)';
        g.fillText(p.handle, x, ly + 1);
      }
    }
  }

  /** Nearest living player to a click, in CSS pixels. */
  pick(clientX: number, clientY: number, t: number): string | null {
    if (!this.tl) return null;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, rect.width);
    const W = this.canvas.width, H = this.canvas.height;
    const side = Math.round(this.mini ? Math.min(W, H) : Math.min(W, H * 0.9));
    const s = Math.round(this.geo.w * (side / Math.max(this.geo.w, this.geo.h))) / this.geo.w;
    const ox = (W - this.geo.w * s) / 2, oy = (H - Math.round(this.geo.h * (side / Math.max(this.geo.w, this.geo.h)))) / 2 + (this.mini ? 0 : H * 0.03);
    const x = (clientX - rect.left) * dpr, y = (clientY - rect.top) * dpr;
    let best: string | null = null, bd = 28 * dpr;
    for (const p of this.tl.players) {
      if (p.deathT !== null && t >= p.deathT) continue;
      const q = posAt(p, t);
      const d = Math.hypot(ox + q[0] * s - x, oy + q[1] * s - y);
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  dispose() { this.ro.disconnect(); }
}
