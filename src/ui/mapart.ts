/**
 * Map key art drawn from the real playable geometry (src/maps): a tactical radar with height shading,
 * lit wall edges, bombsites and spawns. Used by the veto board, map chips and the onboarding backdrop.
 * Read-only use of the map data; rendered once per map and size, cached as a data URL.
 */
import type { MapName } from '../engine/types';
import { geometryFor } from '../maps';

const cache = new Map<string, string>();

/** Hue per map for UI accents (matches the 3D palettes' feel). */
export const MAP_HUE: Record<MapName, number> = { Mirage: 36, Inferno: 14, Nuke: 200, Ancient: 128, Anubis: 44, Dust2: 30, Cache: 84 };

export function mapArt(map: MapName, px = 3): string {
  const key = `${map}:${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return '';
  const g = geometryFor(map);
  const cv = document.createElement('canvas');
  cv.width = g.w * px; cv.height = g.h * px;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  const hue = MAP_HUE[map];
  const walk = (k: string | undefined) => k === 'floor' || k === 'low' || k === 'rail';
  let maxH = 1;
  for (let i = 0; i < g.kind.length; i++) if (walk(g.kind[i])) maxH = Math.max(maxH, g.height[i] ?? 0);
  // Floors: height shaded, slightly lighter on high ground.
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      const k = g.kind[i];
      if (!walk(k)) continue;
      const hgt = Math.max(0, g.height[i] ?? 0) / maxH;
      const l = 30 + hgt * 26 + (k === 'low' ? -7 : 0);
      ctx.fillStyle = `hsl(${hue} ${22 + hgt * 18}% ${l}%)`;
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
  // Lit edges where walkable space meets solid space.
  ctx.fillStyle = `hsla(${hue} 80% 88% / 0.95)`;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      if (!walk(g.kind[i])) continue;
      if (y === 0 || !walk(g.kind[i - g.w])) ctx.fillRect(x * px, y * px, px, 1);
      if (y === g.h - 1 || !walk(g.kind[i + g.w])) ctx.fillRect(x * px, (y + 1) * px - 1, px, 1);
      if (x === 0 || !walk(g.kind[i - 1])) ctx.fillRect(x * px, y * px, 1, px);
      if (x === g.w - 1 || !walk(g.kind[i + 1])) ctx.fillRect((x + 1) * px - 1, y * px, 1, px);
    }
  }
  // Bombsites: soft glow, ring and letter.
  for (const s of ['A', 'B'] as const) {
    const r = g.sites[s];
    const [cx, cy] = r.center;
    const R = Math.max(r.rect[2], r.rect[3]) * px * 0.55;
    const grad = ctx.createRadialGradient(cx * px, cy * px, 0, cx * px, cy * px, R * 1.4);
    grad.addColorStop(0, 'rgba(255, 92, 72, 0.45)');
    grad.addColorStop(1, 'rgba(255, 92, 72, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx * px - R * 1.4, cy * px - R * 1.4, R * 2.8, R * 2.8);
    ctx.strokeStyle = 'rgba(255, 140, 120, 0.9)';
    ctx.lineWidth = Math.max(1, px * 0.6);
    ctx.beginPath(); ctx.arc(cx * px, cy * px, Math.max(px * 4, R * 0.5), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(px * 7)}px 'Chakra Petch', 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, cx * px, cy * px + px * 0.4);
  }
  // Spawns: a small amber (T) and blue (CT) marker.
  const mark = (cells: [number, number][], color: string) => {
    if (!cells.length) return;
    const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
    const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx * px, cy * px, px * 2.2, 0, Math.PI * 2); ctx.fill();
  };
  mark(g.tSpawn, '#f0a33a');
  mark(g.ctSpawn, '#5aa9e6');
  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
