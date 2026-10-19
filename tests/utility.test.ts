import { describe, expect, it } from 'vitest';
import { MapSim } from '../src/engine/match';
import { geometryFor } from '../src/maps';
import { MAPS } from '../src/engine/types';
import { airTime, apexHeight, flightAt, FLASH_POP_H, NADE_GRAVITY, RELEASE_H, SETTLE } from '../src/engine/sim/flight';
import type { FlightSpec } from '../src/engine/sim/flight';
import { buildTimeline } from '../src/ui/arena/timeline';
import { WALL_HEIGHT } from '../src/maps/types';
import { activeSmokes } from '../src/ui/arena/vision';
import { snapshot, teamFromBand } from './helpers';

const spec = (kind: FlightSpec['kind'], d = 20, fromH = 0, atH = 0): FlightSpec => {
  const throwT = 10;
  return { kind, from: [5, 5], at: [5 + d, 5], throwT, popT: throwT + airTime(d) + SETTLE[kind], fromH, atH };
};

describe('grenade flight model', () => {
  it('starts in the hand and ends at the simulated rest point at the pop time', () => {
    for (const kind of ['smoke', 'flash', 'he', 'molotov'] as const) {
      const s = spec(kind, 24, 1, 3);
      const a = flightAt(s, s.throwT);
      expect(a.x).toBeCloseTo(5); expect(a.h).toBeCloseTo(1 + RELEASE_H);
      const b = flightAt(s, s.popT);
      expect(b.x).toBeCloseTo(29); expect(b.y).toBeCloseTo(5);
      expect(b.phase).toBe('done');
      expect(b.h).toBeCloseTo(kind === 'flash' ? 3 + FLASH_POP_H : 3.08);
    }
  });

  it('follows a ballistic arc (constant downward acceleration) while in the air', () => {
    const s = spec('smoke', 30);
    const dt = 0.05;
    const h = (t: number) => flightAt(s, t).h;
    for (let t = s.throwT + 0.1; t < s.throwT + airTime(30) - 0.1; t += 0.2) {
      const acc = (h(t + dt) - 2 * h(t) + h(t - dt)) / (dt * dt);
      expect(acc).toBeCloseTo(-NADE_GRAVITY, 3);
    }
    // Long throws arc high, short ones stay low.
    expect(apexHeight(spec('smoke', 34))).toBeGreaterThan(5);
    expect(apexHeight(spec('flash', 6))).toBeLessThan(3.5);
  });

  it('moves steadily along the throw line and never jumps', () => {
    for (const kind of ['smoke', 'flash', 'he'] as const) {
      const s = spec(kind, 22);
      let prev = flightAt(s, s.throwT);
      for (let t = s.throwT + 0.02; t <= s.popT + 0.001; t += 0.02) {
        const p = flightAt(s, t);
        expect(Math.hypot(p.x - prev.x, p.y - prev.y, p.h - prev.h)).toBeLessThan(0.6);
        expect(p.x).toBeGreaterThanOrEqual(prev.x - 1e-9);
        prev = p;
      }
    }
  });

  it('smokes land, roll to a stop and only then pop; flashes burst in the air', () => {
    const s = spec('smoke', 20);
    const landing = flightAt(s, s.popT - SETTLE.smoke + 0.01);
    expect(landing.phase).toBe('roll');
    expect(landing.x).toBeLessThan(25);
    const f = spec('flash', 20);
    expect(flightAt(f, f.popT - 0.01).phase).toBe('air');
    expect(flightAt(f, f.popT - 0.01).h).toBeGreaterThan(FLASH_POP_H - 0.2);
  });
});

describe('grenades in a simulated round', () => {
  const used = new Set<string>();
  const teams = [snapshot('a', teamFromBand(20, used)), snapshot('b', teamFromBand(30, used))];
  it('pop times in the engine come from the shared flight model, and the viewer uses the same flight', () => {
    let n = 0;
    for (const map of MAPS) {
      const geo = geometryFor(map);
      const sim = new MapSim({ seed: 5, teams: teams as any, map, ctFirst: 0, record: true }).playToEnd();
      for (const r of sim.rounds.slice(0, 6)) {
        const tl = buildTimeline(r, teams as any, geo);
        for (const u of r.utility) {
          if (!u.from || !u.at) continue;
          const d = Math.hypot(u.at[0] - u.from[0], u.at[1] - u.from[1]);
          // Times are stored to 0.1 s, and the flight time is set from the aimed spot, not the (slightly off) landing spot.
          expect(Math.abs((u.landT ?? u.t) - u.t - (airTime(d) + SETTLE[u.kind]))).toBeLessThan(0.35);
          n++;
        }
        for (const u of tl.utility) {
          expect(u.flight.popT).toBe(u.t);
          expect(u.flight.throwT).toBe(u.throwT);
          const end = flightAt(u.flight, u.t);
          expect(end.x).toBeCloseTo(u.at[0]); expect(end.y).toBeCloseTo(u.at[1]);
          if (u.kind === 'smoke') {
            // Vision blocking starts exactly when the smoke pops and ends when it expires.
            expect(activeSmokes(tl, u.t - 0.05).some((s) => s.at === u.at)).toBe(false);
            expect(activeSmokes(tl, u.t + 0.05).some((s) => s.at === u.at)).toBe(true);
            expect(activeSmokes(tl, u.t + u.duration + 0.1).some((s) => s.at === u.at)).toBe(false);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(50);
  }, 60000);

  it('drawn arcs clear the walls they fly over (apart from leaving the hand and landing)', () => {
    for (const map of MAPS) {
      const geo = geometryFor(map);
      let total = 0, clipped = 0;
      const sim = new MapSim({ seed: 2, teams: teams as any, map, ctFirst: 0, record: true }).playToEnd();
      for (const r of sim.rounds) for (const u of buildTimeline(r, teams as any, geo).utility) {
        total++;
        const D = Math.hypot(u.at[0] - u.from[0], u.at[1] - u.from[1]);
        let worst = 0;
        for (let t = u.throwT; t < u.t; t += 0.04) {
          const p = flightAt(u.flight, t);
          const dd = Math.hypot(p.x - u.from[0], p.y - u.from[1]);
          if (p.phase !== 'air' || dd < 2.2 || D - dd < 2.2) continue;
          const i = Math.floor(p.y) * geo.w + Math.floor(p.x), k = geo.kind[i];
          if (k === 'wall' || k === 'void') worst = Math.max(worst, geo.height[i]! + WALL_HEIGHT * 0.8 - p.h);
        }
        if (worst > 0.05) clipped++;
      }
      expect(clipped / total, map).toBeLessThan(0.06);
    }
  }, 120000);

  it('flashes blind players only at or after the moment the flash pops', () => {
    const geo = geometryFor('Mirage');
    let checked = 0;
    // Two maps' worth of rounds, so there are enough flashes to check.
    for (const seed of [9, 10]) for (const r of new MapSim({ seed, teams: teams as any, map: 'Mirage', ctFirst: 0, record: true }).playToEnd().rounds) {
      const tl = buildTimeline(r, teams as any, geo);
      const pops = tl.utility.filter((u) => u.kind === 'flash').map((u) => u.t);
      for (const p of tl.players) for (const b of p.blinded) {
        const start = Array.isArray(b) ? b[0] : b;
        expect(pops.some((t) => Math.abs(t - start) < 0.11)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  }, 60000);
});
