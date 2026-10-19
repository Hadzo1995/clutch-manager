import { MAPS } from '../src/engine/types';
import { MAP_SOURCES, geometryFor } from '../src/maps';
import { validateMap } from '../src/maps/validate';
import { findPath } from '../src/maps/nav';

describe('map pool geometry', () => {
  for (const m of MAPS) {
    it(`${m} passes the validator`, () => {
      expect(validateMap(MAP_SOURCES[m])).toEqual([]);
    });
    it(`${m} connects both spawns to both sites`, () => {
      const g = geometryFor(m);
      for (const s of ['A', 'B'] as const) {
        expect(findPath(g, g.tSpawn[0]!, g.sites[s].center)).not.toBeNull();
        expect(findPath(g, g.ctSpawn[0]!, g.sites[s].center)).not.toBeNull();
      }
    });
  }
});
