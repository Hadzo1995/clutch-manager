/**
 * Player dossier and pair familiarity: the numbers the profile shows come from
 * the same functions the match engine uses, and practice builds familiarity
 * gradually and within bounds.
 */
import { pairFamiliarity, runTrainingWeek } from '../src/engine/career';
import { combatProfile, COMBAT_EFFECT, COMBAT_LABEL, COMBAT_SOURCES } from '../src/engine/sim/combat';
import { percentile, skillPool, skillRanks } from '../src/engine/scouting';
import { pairKey } from '../src/engine/sim/synergy';
import { newCareer, world } from './helpers';

describe('scouting dossier', () => {
  const w = world();
  const pool = skillPool(w.profileList.map((p) => p.base));

  it('describes every engine skill', () => {
    for (const k of Object.keys(combatProfile(w.profileList[0]!.base))) {
      expect(COMBAT_LABEL[k as keyof typeof COMBAT_LABEL]).toBeTruthy();
      expect(COMBAT_SOURCES[k as keyof typeof COMBAT_SOURCES]).toBeTruthy();
      expect(COMBAT_EFFECT[k as keyof typeof COMBAT_EFFECT]).toBeTruthy();
    }
  });

  it('ranks skills by percentile against the pool, best first', () => {
    const p = w.profileList[7]!;
    const ranks = skillRanks(p.base, pool, true);
    expect(ranks).toHaveLength(13);
    for (const r of ranks) { expect(r.pc).toBeGreaterThanOrEqual(0); expect(r.pc).toBeLessThanOrEqual(100); }
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]!.pc).toBeGreaterThanOrEqual(ranks[i]!.pc);
    expect(skillRanks(p.base, pool, false).some((r) => r.k === 'sniping')).toBe(false);
  });

  it('better aim shows up as better gunplay percentiles', () => {
    const p = w.profileList.find((x) => x.base.aim < 80)!;
    const sharp = { ...p.base, aim: p.base.aim + 15 };
    const before = Object.fromEntries(skillRanks(p.base, pool, true).map((r) => [r.k, r.pc]));
    const after = Object.fromEntries(skillRanks(sharp, pool, true).map((r) => [r.k, r.pc]));
    for (const k of ['reflexes', 'precision', 'crosshair']) expect(after[k]).toBeGreaterThan(before[k]!);
    expect(after.utility).toBe(before.utility); // aim does not feed utility
  });

  it('percentile counts the share of the pool strictly below', () => {
    expect(percentile([1, 2, 3, 4], 3)).toBe(50);
    expect(percentile([1, 2, 3, 4], 0)).toBe(0);
    expect(percentile([1, 2, 3, 4], 9)).toBe(100);
    expect(percentile([], 5)).toBe(0);
  });
});

describe('pair familiarity', () => {
  it('a bootcamp raises it most for lineup pairs, with diminishing returns and a cap', () => {
    const w = world();
    let c = newCareer(5);
    const [a, b] = c.lineup.map((s) => s.cardId);
    const bench = c.cards.find((k) => !c.lineup.some((s) => s.cardId === k.cardId));
    const start = pairFamiliarity(c, a!, b!);
    const benchStart = bench ? pairFamiliarity(c, a!, bench.cardId) : 0;
    const gains: number[] = [];
    let prev = start;
    for (let i = 0; i < 12; i++) {
      c = runTrainingWeek(w, { ...c, coins: 1e6, phase: 'training', plan: { ...c.plan, sessions: ['bootcamp'] } });
      const now = pairFamiliarity(c, a!, b!);
      gains.push(now - prev);
      prev = now;
      expect(now).toBeLessThanOrEqual(100);
    }
    expect(gains[0]!).toBeGreaterThan(3);
    expect(gains[gains.length - 1]!).toBeLessThan(gains[0]!); // diminishing returns
    expect(prev).toBeGreaterThan(start + 20);
    // Bench pairs only follow team chemistry; lineup pairs also get the practice itself.
    if (bench) expect(pairFamiliarity(c, a!, bench.cardId) - benchStart).toBeLessThan(prev - start);
    expect(c.pairs?.[pairKey(a!, b!)]).toBe(prev);
    expect(start).toBeLessThan(80);
  });

  it('scrims build it much more slowly than a bootcamp', () => {
    const w = world();
    const c = newCareer(6);
    const [a, b] = c.lineup.map((s) => s.cardId);
    const scrim = runTrainingWeek(w, { ...c, plan: { ...c.plan, sessions: ['scrims', 'rest', 'rest'] } });
    const camp = runTrainingWeek(w, { ...c, coins: 1e6, plan: { ...c.plan, sessions: ['bootcamp'] } });
    const base = pairFamiliarity(c, a!, b!);
    expect(pairFamiliarity(scrim, a!, b!) - base).toBeGreaterThan(0);
    expect(pairFamiliarity(camp, a!, b!) - base).toBeGreaterThan(2 * (pairFamiliarity(scrim, a!, b!) - base));
  });
});
