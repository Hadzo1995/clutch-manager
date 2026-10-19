/**
 * The map pool as playable geometry. Layouts are original block-outs that
 * follow each map's well-known structure (lanes, sites, connectors); they are
 * not traced from or derived from Valve's map files. See MAPS.md in the docs.
 */
import type { MapName } from '../engine/types';
import { ANCIENT } from './data/ancient';
import { ANUBIS } from './data/anubis';
import { CACHE } from './data/cache';
import { DUST2 } from './data/dust2';
import { INFERNO } from './data/inferno';
import { MIRAGE } from './data/mirage';
import { NUKE } from './data/nuke';
import { parseMap } from './parse';
import type { MapGeometry, MapSource } from './types';

export const MAP_SOURCES: Record<MapName, MapSource> = {
  Mirage: MIRAGE, Inferno: INFERNO, Nuke: NUKE, Ancient: ANCIENT, Anubis: ANUBIS, Dust2: DUST2, Cache: CACHE,
};

const cache = new Map<MapName, MapGeometry>();

export function geometryFor(map: MapName): MapGeometry {
  let g = cache.get(map);
  if (!g) { g = parseMap(MAP_SOURCES[map]); cache.set(map, g); }
  return g;
}
