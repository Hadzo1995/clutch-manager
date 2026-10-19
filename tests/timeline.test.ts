import { MapSim } from '../src/engine/match';
import { parseMap } from '../src/maps/parse';
import { DUST2 } from '../src/maps/data/dust2';
import { blocksSight, isWalkable, lineOfSight } from '../src/maps/parse';
import { geometryFor } from '../src/maps';
import { MAPS } from '../src/engine/types';
import { buildTimeline, hpAt, posAt, bombAt, clockAt, aliveCount, aimAt, isSpotted, FOV, clutchOf } from '../src/ui/arena/timeline';
import { visionFan } from '../src/ui/arena/vision';
import { snapshot, teamFromBand } from './helpers';

function rounds(seed: number) {
  const used = new Set<string>();
  const teams = [snapshot('a', teamFromBand(20, used)), snapshot('b', teamFromBand(30, used))] as [ReturnType<typeof snapshot>, ReturnType<typeof snapshot>];
  const r = new MapSim({ seed, teams, map: 'Dust2', ctFirst: 0, record: true }).playToEnd();
  return { teams, rounds: r.rounds };
}

describe('round timeline', () => {
  const geo = parseMap(DUST2);
  const { teams, rounds: rs } = rounds(7);

  it('finds clutches: one survivor against two or more', () => {
    let found = 0;
    for (const r of rs) {
      const tl = buildTimeline(r, teams, geo);
      for (const team of [0, 1] as const) {
        const c = clutchOf(tl, team);
        if (!c) continue;
        found++;
        expect(aliveCount(tl, team, c.t)).toBe(1);
        expect(aliveCount(tl, team === 0 ? 1 : 0, c.t)).toBe(c.vs);
        expect(c.vs).toBeGreaterThanOrEqual(2);
        const p = tl.players.find((q) => q.id === c.id)!;
        expect(p.team).toBe(team);
        expect(p.deathT === null || p.deathT > c.t).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = buildTimeline(rs[3]!, teams, geo);
    const b = buildTimeline(rs[3]!, teams, geo);
    expect(JSON.stringify(a.players)).toBe(JSON.stringify(b.players));
    expect(JSON.stringify(a.utility)).toBe(JSON.stringify(b.utility));
  });

  it('keeps HP in step with the engine: dead at the kill, alive above 0 before', () => {
    for (const r of rs) {
      const tl = buildTimeline(r, teams, geo);
      for (const k of r.kills) {
        const v = tl.byId.get(k.victimId)!;
        expect(hpAt(v, k.t)).toBe(0);
        expect(hpAt(v, k.t - 0.01)).toBeGreaterThan(0);
      }
      for (const id of r.survivors) expect(hpAt(tl.byId.get(id)!, tl.duration)).toBeGreaterThan(0);
      // A bomb can win the round after every T is dead, so only other endings need a survivor on the winning side.
      if (r.reason !== 'bomb') expect(aliveCount(tl, r.winner, tl.duration)).toBeGreaterThan(0);
    }
  });

  it('keeps every player on walkable ground and moving at plausible speed', () => {
    let fast = 0, samples = 0;
    for (const r of rs) {
      const tl = buildTimeline(r, teams, geo);
      for (const p of tl.players) {
        let prev = posAt(p, 0);
        for (let t = 0.25; t <= tl.duration; t += 0.25) {
          const q = posAt(p, t);
          expect(isWalkable(geo, Math.floor(q[0]), Math.floor(q[1]))).toBe(true);
          const sp = Math.hypot(q[0] - prev[0], q[1] - prev[1]) / 0.25;
          samples++;
          if (sp > 9) fast++;
          prev = q;
        }
      }
    }
    // Rare sprints are allowed where the engine's timing is tight; teleports are not.
    expect(fast / samples).toBeLessThan(0.01);
  });

  it('places the bomb and runs the clock', () => {
    // A planted round that lasts at least 10 s after the plant (the clock check below needs it).
    const planted = rs.find((r) => r.planted && r.plantTime !== undefined && r.endTime > r.plantTime + 10)!;
    const tl = buildTimeline(planted, teams, geo);
    expect(bombAt(tl, planted.plantTime! + 1).state).toMatch(/planted|defusing/);
    expect(clockAt(tl, planted.plantTime! + 10).phase).toBe('bomb');
    expect(clockAt(tl, 5).label).toBe('1:50');
    const site = geo.sites[planted.site];
    const at = tl.bomb.plantAt!;
    expect(site.cells.some((c) => c[0] === Math.floor(at[0]) && c[1] === Math.floor(at[1]))).toBe(true);
  });

  it('gives every player a sampled aim and spotting for the whole round', () => {
    const tl = buildTimeline(rs[2]!, teams, geo);
    for (const p of tl.players) {
      expect(p.aim.length).toBeGreaterThan(tl.duration * 9);
      expect(p.spotted.length).toBe(p.aim.length);
      expect(Number.isFinite(aimAt(p, tl.duration / 2))).toBe(true);
    }
  });

  it('shows exactly the simulated shots: one lethal shot per gun kill, damage adds up to the hits', () => {
    for (const r of rs.slice(0, 8)) {
      const tl = buildTimeline(r, teams, geo);
      const gunKills = r.kills.filter((k) => k.weapon !== 'Molotov' && k.weapon !== 'HE Grenade');
      expect(tl.shots.filter((s) => s.lethal).length).toBe(gunKills.length);
      const shotDmg = tl.shots.reduce((sum, s) => sum + s.damage, 0);
      const hitDmg = r.hits.reduce((sum, h) => sum + h.damage, 0);
      expect(shotDmg).toBe(hitDmg);
    }
  });

  it('records a replay without changing the result', () => {
    const used = new Set<string>();
    const t2 = [snapshot('a', teamFromBand(20, used)), snapshot('b', teamFromBand(30, used))] as [ReturnType<typeof snapshot>, ReturnType<typeof snapshot>];
    const plain = new MapSim({ seed: 7, teams: t2, map: 'Dust2', ctFirst: 0 }).playToEnd();
    const rec = new MapSim({ seed: 7, teams: t2, map: 'Dust2', ctFirst: 0, record: true }).playToEnd();
    expect(rec.score).toEqual(plain.score);
    expect(JSON.stringify(rec.lines)).toBe(JSON.stringify(plain.lines));
    expect(plain.rounds[0]!.replay).toBeUndefined();
    expect(rec.rounds[0]!.replay).toBeDefined();
  });

  it('cone rays stop at walls and stay within the field of view', () => {
    const tl = buildTimeline(rs[1]!, teams, geo);
    const p = tl.players[0]!;
    const pos = posAt(p, 10), aim = aimAt(p, 10);
    const fan = visionFan(geo, pos, aim, []);
    for (const end of fan) {
      const a = Math.atan2(end[1] - pos[1], end[0] - pos[0]);
      expect(Math.abs(Math.atan2(Math.sin(a - aim), Math.cos(a - aim)))).toBeLessThanOrEqual(FOV / 2 + 1e-6);
      // Nothing on the way to the end point blocks sight.
      const len = Math.hypot(end[0] - pos[0], end[1] - pos[1]);
      for (let d = 0.3; d < len - 0.35; d += 0.3) {
        const x = Math.floor(pos[0] + Math.cos(a) * d), y = Math.floor(pos[1] + Math.sin(a) * d);
        expect(blocksSight(geo, x, y)).toBe(false);
      }
    }
  });
});

describe('vision on every map', () => {
  for (const map of MAPS) {
    it(`${map}: kills happen in line of sight, facing the victim, mostly after a spot`, () => {
      const used = new Set<string>();
      const teams = [snapshot('a', teamFromBand(20, used)), snapshot('b', teamFromBand(30, used))] as [ReturnType<typeof snapshot>, ReturnType<typeof snapshot>];
      const sim = new MapSim({ seed: 11, teams, map, ctFirst: 0, record: true }).playToEnd();
      const g = geometryFor(map);
      let n = 0, los = 0, facing = 0, spotted = 0;
      for (const r of sim.rounds.slice(0, 12)) {
        const tl = buildTimeline(r, teams, g);
        for (const k of r.kills) {
          if (k.weapon === 'Molotov' || k.weapon === 'HE Grenade') continue;
          const kt = tl.byId.get(k.killerId)!, vt = tl.byId.get(k.victimId)!;
          const a = posAt(kt, k.t), b = posAt(vt, k.t);
          n++;
          if (lineOfSight(g, [Math.floor(a[0]), Math.floor(a[1])], [Math.floor(b[0]), Math.floor(b[1])])) los++;
          const d = Math.atan2(b[1] - a[1], b[0] - a[0]) - aimAt(kt, k.t);
          if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.35) facing++;
          if (isSpotted(vt, k.t - 0.1)) spotted++;
        }
      }
      expect(los / n).toBeGreaterThan(0.95);
      // The flick onto a target happens inside one 0.1 s sample, so allow a few in mid-turn.
      expect(facing / n).toBeGreaterThan(0.9);
      expect(spotted / n).toBeGreaterThan(0.8);
    }, 30000);
  }
});
