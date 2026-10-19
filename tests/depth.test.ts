import { describe, expect, it } from 'vitest';
import { completeMatchday, fixtureSnapshots, humanFixture, runTrainingWeek, seedForFixture } from '../src/engine/career';
import { MapSim, simulateSeries } from '../src/engine/match';
import { bigGameShift, personalityOf, traitsOf, trainingMultiplier } from '../src/engine/profile';
import { deserializeCareer, serializeCareer } from '../src/engine/save';
import { autoVeto } from '../src/engine/veto';
import { newCareer, snapshot, teamFromBand, world } from './helpers';

describe('player profiles', () => {
  it('personality is deterministic, in range, and has real effects', () => {
    const a = personalityOf('p-001');
    expect(personalityOf('p-001')).toEqual(a);
    for (const p of world().profileList) {
      const x = personalityOf(p.record.id);
      for (const v of Object.values(x)) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(20); }
    }
    expect(trainingMultiplier({ ...a, professionalism: 20 })).toBeCloseTo(1.15, 5);
    expect(trainingMultiplier({ ...a, professionalism: 1 })).toBeCloseTo(0.85, 5);
    expect(bigGameShift({ ...a, bigGame: 20 })).toBe(3);
    expect(bigGameShift({ ...a, bigGame: 1 })).toBe(-3);
  });

  it('gives most top players at least one trait', () => {
    const top = world().profileList.slice(0, 50);
    const withTraits = top.filter((p) => traitsOf(p.base, p).length > 0).length;
    expect(withTraits).toBeGreaterThan(35);
  });
});

describe('match detail', () => {
  const used = new Set<string>();
  const a = snapshot('a', teamFromBand(20, used));
  const b = snapshot('b', teamFromBand(25, used));

  it('produces consistent utility, equipment and MVP data', () => {
    const sim = new MapSim({ seed: 99, teams: [a, b], map: 'Mirage', ctFirst: 0 });
    const r = sim.playToEnd();
    let utilCount = 0;
    for (const round of r.rounds) {
      utilCount += round.utility.length;
      for (const u of round.utility) {
        expect(u.flashed).toBeGreaterThanOrEqual(0);
        expect(u.damage).toBeGreaterThanOrEqual(0);
        expect([...a.players, ...b.players].some((p) => p.id === u.playerId)).toBe(true);
      }
      expect(round.equipment[0]).toBeGreaterThan(0);
      if (round.mvpId) expect([a, b][round.winner]!.players.some((p) => p.id === round.mvpId)).toBe(true);
      if (round.planted) expect(round.planterId).toBeDefined();
      if (round.reason === 'defuse') expect(round.defuserId).toBeDefined();
      expect(round.endTime).toBeGreaterThanOrEqual(round.kills[round.kills.length - 1]?.t ?? 0);
    }
    expect(utilCount).toBeGreaterThan(r.rounds.length * 3);
    const hs = r.lines.reduce((s, l) => s + l.headshots, 0);
    const kills = r.lines.reduce((s, l) => s + l.kills, 0);
    expect(hs / kills).toBeGreaterThan(0.25);
    expect(hs / kills).toBeLessThan(0.65);
  });
});

describe('card career stats', () => {
  it('records stats, a match log and OVR history, and survives a save round trip', () => {
    const w = world();
    let c = newCareer(11);
    for (let i = 0; i < 3; i++) {
      c = runTrainingWeek(w, c);
      const f = humanFixture(c)!;
      const teams = fixtureSnapshots(w, c, f);
      c = completeMatchday(w, c, simulateSeries(seedForFixture(c, f), teams, autoVeto(f.format, teams, 0), f.format));
    }
    const card = c.cards.find((x) => x.cardId === c.lineup[0]!.cardId)!;
    expect(card.stats!.maps).toBe(3);
    expect(card.stats!.rounds).toBeGreaterThan(30);
    expect(card.log).toHaveLength(3);
    expect(card.ovrHistory).toHaveLength(3);
    const back = deserializeCareer(serializeCareer(c));
    expect(back.cards.find((x) => x.cardId === card.cardId)!.stats).toEqual(card.stats);
  });
});

describe('key moments', () => {
  it('lists pistol rounds and buy records that add up', async () => {
    const { keyMoments, buyRecord } = await import('../src/engine/report');
    const w = (await import('./helpers')).world();
    const { snapshot } = await import('./helpers');
    const ps = w.profileList;
    const a = snapshot('a', ps.slice(0, 5));
    const b = snapshot('b', ps.slice(5, 10));
    const m = simulateSeries(123, [a, b], ['Mirage'], 'bo1').maps[0]!;
    const km = keyMoments(m, 0, ['A', 'B']);
    expect(km.filter((k) => k.text.includes('pistol')).length).toBeGreaterThanOrEqual(1);
    expect(km.length).toBeLessThanOrEqual(8);
    const rec = buyRecord(m, 0);
    expect(Object.values(rec).reduce((s, r) => s + r.played, 0)).toBe(m.rounds.length);
    expect(Object.values(rec).reduce((s, r) => s + r.won, 0)).toBe(m.rounds.filter((r) => r.winner === 0).length);
  });
});
