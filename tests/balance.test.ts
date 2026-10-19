/**
 * Balance checks over large batches of synthetic matches.
 * Thresholds are deliberately loose; exact numbers are reported in BALANCING.md.
 */
import { MapSim } from '../src/engine/match';
import type { TeamSnapshot } from '../src/engine/team';
import type { CTSetup, MapName, TApproach } from '../src/engine/types';
import { MAPS } from '../src/engine/types';
import { snapshot, teamFromBand, world } from './helpers';

function winRate(a: TeamSnapshot, b: TeamSnapshot, n = 120, map?: MapName): { win: number; avgRoundsWonA: number } {
  let wins = 0, rounds = 0;
  for (let s = 1; s <= n; s++) {
    const r = new MapSim({ seed: s * 7919, teams: [a, b], map: map ?? MAPS[s % MAPS.length]!, ctFirst: (s % 2) as 0 | 1 }).playToEnd();
    if (r.winner === 0) wins++;
    rounds += r.score[0];
  }
  return { win: wins / n, avgRoundsWonA: rounds / n };
}

describe('balance', () => {
  it('stronger teams win more often, but upsets still happen', () => {
    const used = new Set<string>();
    const strong = snapshot('s', teamFromBand(0, used));
    const mid = snapshot('m', teamFromBand(40, used));
    const weak = snapshot('w', teamFromBand(120, used));
    const sm = winRate(strong, mid).win;
    const sw = winRate(strong, weak).win;
    const mw = winRate(mid, weak).win;
    expect(sm).toBeGreaterThan(0.55);
    expect(sm).toBeLessThan(0.92);
    expect(sw).toBeGreaterThan(sm);
    expect(mw).toBeGreaterThan(0.6);
    expect(sw).toBeLessThan(1); // never literally unbeatable
  });

  it('equal teams are close to 50/50', () => {
    const used = new Set<string>();
    const a = snapshot('a', teamFromBand(50, used));
    const b = snapshot('b', teamFromBand(50, used));
    const w = winRate(a, b, 200).win;
    expect(w).toBeGreaterThan(0.38);
    expect(w).toBeLessThan(0.62);
  });

  it('five stars in the wrong roles do not automatically beat a balanced team', () => {
    // Five of the best AWPers (one can AWP; the rest play off-role) vs a balanced lineup a bit lower in OVR.
    const list = [...world().profileList].sort((a, b) => b.ovr - a.ovr);
    const awpers = list.filter((p) => p.record.primaryRole === 'awp' && p.record.secondaryRole !== 'igl').slice(0, 5);
    const stars = snapshot('stars', awpers, ['awp', 'igl', 'entry', 'support', 'lurker'], { chemistry: 30 });
    const used = new Set(awpers.map((p) => p.record.id));
    const balanced = snapshot('bal', teamFromBand(15, used), undefined, { chemistry: 70 });
    const avg = (t: TeamSnapshot) => t.players.length;
    expect(avg(stars)).toBe(5);
    const w = winRate(balanced, stars).win;
    expect(w).toBeGreaterThan(0.5);
  });

  // T-side round win rate of team A (A plays T first, 12 rounds) with fixed plans on both sides.
  function tRate(tApproach: TApproach, ctSetup: CTSetup, maps: MapName[], n: number): number {
    const used = new Set<string>();
    const a = snapshot('a', teamFromBand(40, used));
    const b = snapshot('b', teamFromBand(40, used));
    let w = 0, all = 0;
    for (const map of maps) for (let s = 1; s <= n; s++) {
      const A = { ...a, tactics: { ...a.tactics, tApproach, ctSetup: 'standard' as const } };
      const B = { ...b, tactics: { ...b.tactics, tApproach: 'default' as const, ctSetup, stackSite: (s % 2 ? 'A' : 'B') as 'A' | 'B' } };
      const sim = new MapSim({ seed: s * 101 + map.length, teams: [A, B], map, ctFirst: 1 });
      for (let i = 0; i < 12; i++) { const r = sim.playRound(); all++; if (r.winnerSide === 'T') w++; }
    }
    return w / all;
  }

  it('tactical counters matter: rush into a retake setup does worse than rush into aggressive CTs', () => {
    const maps: MapName[] = ['Mirage', 'Dust2', 'Inferno'];
    const vsRetake = tRate('rush', 'retake', maps, 20);
    const vsAggro = tRate('rush', 'aggro', maps, 20);
    expect(vsAggro).toBeGreaterThan(vsRetake + 0.05);
  });

  it('no T approach dominates against a standard setup', () => {
    const maps: MapName[] = ['Mirage', 'Dust2', 'Nuke'];
    for (const tp of ['default', 'execute', 'rush'] as const) {
      const r = tRate(tp, 'standard', maps, 16);
      expect(r).toBeGreaterThan(0.4);
      expect(r).toBeLessThan(0.6);
    }
  });

  it('map familiarity and chemistry give a real but not decisive edge', () => {
    const used = new Set<string>();
    const players = teamFromBand(60, used);
    const prepared = snapshot('p', players, undefined, { chemistry: 90, mapPractice: Object.fromEntries(MAPS.map((m) => [m, 90])) as TeamSnapshot['mapPractice'] });
    const unprepared = snapshot('u', teamFromBand(60, used), undefined, { chemistry: 30, mapPractice: Object.fromEntries(MAPS.map((m) => [m, 20])) as TeamSnapshot['mapPractice'] });
    const w = winRate(prepared, unprepared).win;
    expect(w).toBeGreaterThan(0.58);
    expect(w).toBeLessThan(0.97);
  });
});
