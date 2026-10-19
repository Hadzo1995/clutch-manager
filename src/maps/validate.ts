/** Checks a map is usable by the viewer. Returns a list of problems (empty = fine). */
import { findPath } from './nav';
import { parseMap } from './parse';
import { FLAT_PROPS, FRAME_PROPS, OUTDOOR_PROPS, SOLID_PROPS } from './types';
import type { MapSource } from './types';

export function validateMap(src: MapSource): string[] {
  const errs: string[] = [];
  if (src.size[0] < 70 || src.size[0] > 170 || src.size[1] < 70 || src.size[1] > 170) errs.push(`size ${src.size.join('x')} outside 70-170`);
  let g;
  try { g = parseMap(src); } catch (e) { return [...errs, (e as Error).message]; }
  for (const r of src.rooms) {
    const hs = r.length === 5 ? [r[4]] : r.length === 7 ? [r[4], r[5]] : [0];
    if (hs.some((h) => h < 0 || h > 12)) errs.push(`room ${r.slice(0, 4).join(',')} height outside 0-12 m`);
  }
  for (const p of src.props ?? []) {
    const [px, py, pw, ph] = p.rect;
    const where = `prop ${p.kind} at ${p.rect.join(',')}${p.note ? ` (${p.note})` : ''}`;
    if (pw < 1 || ph < 1 || px < 0 || py < 0 || px + pw > g.w || py + ph > g.h) { errs.push(`${where} is outside the map or empty`); continue; }
    const kinds = new Set<string>();
    for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) kinds.add(g.kind[y * g.w + x]!);
    if ((SOLID_PROPS as readonly string[]).includes(p.kind)) {
      if (kinds.has('floor')) errs.push(`${where} covers walkable floor (solid props must sit on cover or wall cells)`);
    } else if ((OUTDOOR_PROPS as readonly string[]).includes(p.kind)) {
      if (kinds.has('floor')) errs.push(`${where} stands on walkable floor (outdoor props go on walls, cover or outside the map)`);
    } else if (!(FLAT_PROPS as readonly string[]).includes(p.kind) && !(FRAME_PROPS as readonly string[]).includes(p.kind)) errs.push(`${where}: unknown kind`);
  }
  if (g.tSpawn.length < 5) errs.push('need at least 5 T spawn cells');
  if (g.ctSpawn.length < 5) errs.push('need at least 5 CT spawn cells');
  const ids = new Set<string>();
  for (const r of g.regions) {
    if (ids.has(r.id)) errs.push(`duplicate region id ${r.id}`);
    ids.add(r.id);
    const area = r.rect[2] * r.rect[3];
    if (r.cells.length < (r.code ? 20 : Math.max(2, area * 0.3))) errs.push(`region ${r.id} is mostly not walkable (${r.cells.length}/${area})`);
  }
  // Grid maps mark only the radar's plant zone as the site, which is smaller than a hand-drawn site room.
  const minSite = g.regionCode ? 50 : 120;
  if (g.sites.A.cells.length < minSite) errs.push(`A site too small (< ${minSite} walkable cells)`);
  if (g.sites.B.cells.length < minSite) errs.push(`B site too small (< ${minSite} walkable cells)`);
  if (g.regions.length < (src.grid ? 16 : 20)) errs.push(`only ${g.regions.length} regions (want at least 20 named callouts)`);
  for (const z of ['A', 'B'] as const) if (src.lanes.filter((l) => l.zone === z).length < 2) errs.push(`want at least 2 T lanes into ${z}`);
  const t = g.tSpawn[0], c = g.ctSpawn[0];
  if (!t || !c) return errs;
  for (const r of g.regions) {
    if (!findPath(g, t, r.center)) errs.push(`region ${r.id} not reachable from T spawn`);
    if (!findPath(g, c, r.center)) errs.push(`region ${r.id} not reachable from CT spawn`);
    // Drops are one way: nobody may get stuck in a region they can't walk out of.
    if (!findPath(g, r.center, t)) errs.push(`no way back from ${r.id} to T spawn`);
    if (!findPath(g, r.center, c)) errs.push(`no way back from ${r.id} to CT spawn`);
  }
  for (const zone of ['A', 'B', 'Mid'] as const) {
    if (!src.lanes.some((l) => l.zone === zone)) errs.push(`no T lane for ${zone}`);
    for (const id of src.ctHolds[zone] ?? []) if (!ids.has(id)) errs.push(`ctHolds.${zone} unknown region ${id}`);
    if (!(src.ctHolds[zone] ?? []).length) errs.push(`ctHolds.${zone} empty`);
  }
  for (const l of src.lanes) {
    for (const id of l.via) if (!ids.has(id)) errs.push(`lane ${l.zone} unknown region ${id}`);
    const last = g.regionById.get(l.via[l.via.length - 1]!);
    if (last && l.zone !== 'Mid' && last.site !== l.zone) errs.push(`lane ${l.zone} must end on the ${l.zone} site region`);
  }
  // Spawns should be far apart (each side takes roughly 10-25 s to reach a site).
  const ta = findPath(g, t, g.sites.A.center), tb = findPath(g, t, g.sites.B.center);
  const ca = findPath(g, c, g.sites.A.center), cb = findPath(g, c, g.sites.B.center);
  if (ta && tb && ca && cb) {
    // Grid maps are traced at 32 units per cell, so their real routes run longer than the hand-drawn maps'.
    const tMax = src.grid ? 180 : 160, ctMax = src.grid ? 140 : 100;
    for (const [name, p] of [['T→A', ta], ['T→B', tb]] as const) if (p.length < 50 || p.length > tMax) errs.push(`${name} path is ${p.length} cells (want 50-${tMax})`);
    for (const [name, p] of [['CT→A', ca], ['CT→B', cb]] as const) if (p.length < 10 || p.length > ctMax) errs.push(`${name} path is ${p.length} cells (want 10-${ctMax})`);
  }
  return errs;
}

/** ASCII picture of a map, for checking a layout by eye. */
export function toAscii(src: MapSource): string {
  const g = parseMap(src);
  const ch: Record<string, string> = { void: ' ', wall: '#', low: 'x', tall: 'X', rail: '=' };
  const rows: string[] = [];
  for (let y = 0; y < g.h; y++) {
    let row = '';
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      const k = g.kind[i]!;
      if (k !== 'floor') { row += ch[k]; continue; }
      if (g.tSpawn.some((c) => c[0] === x && c[1] === y)) row += 'T';
      else if (g.ctSpawn.some((c) => c[0] === x && c[1] === y)) row += 'C';
      else if (g.sites.A.cells.some((c) => c[0] === x && c[1] === y)) row += 'a';
      else if (g.sites.B.cells.some((c) => c[0] === x && c[1] === y)) row += 'b';
      else { const hh = g.height[i]!; row += hh === 0 ? '.' : hh >= 10 ? '+' : String(Math.round(hh)) === '0' ? ',' : String(Math.round(hh)); }
    }
    rows.push(row);
  }
  return rows.join('\n');
}
