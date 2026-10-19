import { MapSim, matchRating, simulateSeries } from '../src/engine/match';
import { autoVeto } from '../src/engine/veto';
import { snapshot, teamFromBand } from './helpers';

function pair() {
  const used = new Set<string>();
  return [snapshot('a', teamFromBand(20, used)), snapshot('b', teamFromBand(30, used))] as const;
}

describe('match engine', () => {
  it('replays identically with the same seed', () => {
    const [a, b] = pair();
    const r1 = new MapSim({ seed: 123, teams: [a, b], map: 'Inferno', ctFirst: 0 }).playToEnd();
    const r2 = new MapSim({ seed: 123, teams: [a, b], map: 'Inferno', ctFirst: 0 }).playToEnd();
    expect(r2).toEqual(r1);
  });
  it('different seeds give different matches', () => {
    const [a, b] = pair();
    const scores = new Set<string>();
    for (let s = 1; s <= 20; s++) scores.add(new MapSim({ seed: s, teams: [a, b], map: 'Inferno', ctFirst: 0 }).playToEnd().score.join('-'));
    expect(scores.size).toBeGreaterThan(5);
  });
  it('produces valid CS2 scorelines (MR12, MR3 overtime)', () => {
    const [a, b] = pair();
    for (let s = 1; s <= 60; s++) {
      const r = new MapSim({ seed: s, teams: [a, b], map: 'Nuke', ctFirst: (s % 2) as 0 | 1 }).playToEnd();
      const [x, y] = r.score;
      const hi = Math.max(x, y), lo = Math.min(x, y);
      if (lo < 12) expect(hi).toBe(13);
      else expect((hi - 13) % 3).toBe(0);
      expect(r.rounds.length).toBe(x + y);
    }
  });
  it('keeps kill and death totals consistent', () => {
    const [a, b] = pair();
    const r = new MapSim({ seed: 9, teams: [a, b], map: 'Mirage', ctFirst: 0 }).playToEnd();
    const kills = (t: number) => r.lines.filter((l) => l.team === t).reduce((s, l) => s + l.kills, 0);
    const deaths = (t: number) => r.lines.filter((l) => l.team === t).reduce((s, l) => s + l.deaths, 0);
    expect(kills(0)).toBe(deaths(1));
    expect(kills(1)).toBe(deaths(0));
    for (const round of r.rounds) expect(round.kills.length).toBeLessThanOrEqual(10);
  });
  it('supports timeouts that change tactics mid-map, limited to two', () => {
    const [a, b] = pair();
    const sim = new MapSim({ seed: 5, teams: [a, b], map: 'Mirage', ctFirst: 0 });
    for (let i = 0; i < 4; i++) sim.playRound();
    expect(sim.callTimeout(0, { ...a.tactics, ctSetup: 'retake' })).toBe(true);
    expect(sim.callTimeout(0, { ...a.tactics, ctSetup: 'aggro' })).toBe(true);
    expect(sim.callTimeout(0, { ...a.tactics })).toBe(false);
    expect(sim.tactics[0].ctSetup).toBe('aggro');
  });
  it('plays Bo3 series to two map wins with a full veto', () => {
    const [a, b] = pair();
    const maps = autoVeto('bo3', [a, b], 0);
    expect(new Set(maps).size).toBe(3);
    const s = simulateSeries(77, [a, b], maps, 'bo3');
    expect(Math.max(...s.mapScore)).toBe(2);
    expect(s.maps.length).toBeGreaterThanOrEqual(2);
  });
  it('uses its own rating formula averaging about 1.00', () => {
    const [a, b] = pair();
    const ratings: number[] = [];
    for (let s = 1; s <= 30; s++) {
      const r = new MapSim({ seed: s, teams: [a, b], map: 'Ancient', ctFirst: 0 }).playToEnd();
      for (const l of r.lines) ratings.push(matchRating(l, r.rounds.length));
    }
    const avg = ratings.reduce((x, y) => x + y, 0) / ratings.length;
    expect(avg).toBeGreaterThan(0.93);
    expect(avg).toBeLessThan(1.07);
  });
});
