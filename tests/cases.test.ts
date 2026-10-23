/**
 * Case odds: the table the case screen shows is the table the roll uses, every case sums to
 * 100%, every rarity maps to real players, and a large simulation lands on the shown odds.
 */
import { describe, expect, it } from 'vitest';
import { CASES, caseTable, rollPlayer, validateCases } from '../src/engine/cases';
import type { CaseDef } from '../src/engine/cases';
import { createCareer, createWorld, openCase, starterCoaches } from '../src/engine/career';
import { realDataset } from '../src/engine/data/realPlayers';
import { RARITY_OF_TIER } from '../src/engine/ratings';
import { Rng } from '../src/engine/rng';
import { ROLES } from '../src/engine/types';

const w = createWorld(realDataset()!);

describe('case definitions and tables', () => {
  it('every case is valid and its table sums to 100%', () => {
    expect(validateCases()).toEqual([]);
    for (const def of Object.values(CASES)) {
      for (const role of def.needsRole ? ROLES : [undefined]) {
        const t = caseTable(def, w.profileList, role);
        expect(t.reduce((s, r) => s + r.chance, 0)).toBeCloseTo(100, 9);
        expect(t.reduce((s, r) => s + r.perPlayer * r.players.length, 0)).toBeCloseTo(100, 9);
        for (const r of t) {
          expect(r.players.length).toBeGreaterThan(0);
          for (const p of r.players) expect(p.rarity).toBe(r.rarity);
          if (role) for (const p of r.players) expect(p.record.primaryRole).toBe(role);
        }
      }
    }
  });

  it('with real players every rarity exists in every role, so shown odds are the case odds', () => {
    for (const def of Object.values(CASES)) for (const role of ROLES) {
      const t = caseTable(def, w.profileList, def.needsRole ? role : undefined);
      for (const r of t) expect(r.chance).toBeCloseTo(def.odds[r.rarity], 9);
    }
  });

  it('rarity follows the tier, and no player appears twice', () => {
    for (const p of w.profileList) expect(p.rarity).toBe(RARITY_OF_TIER[p.tier]);
    const t = caseTable(CASES.standard, w.profileList);
    const ids = t.flatMap((r) => r.players.map((p) => p.record.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(w.profileList.filter((p) => CASES.standard.odds[p.rarity] > 0).length);
  });

  it('an empty rarity hands its share to the others in proportion, never to nothing', () => {
    const def: CaseDef = { ...CASES.standard, odds: { legend: 50, elite: 0, gold: 50, silver: 0, bronze: 0 } };
    const noLegends = w.profileList.filter((p) => p.rarity !== 'legend');
    const t = caseTable(def, noLegends);
    expect(t).toHaveLength(1);
    expect(t[0]!.rarity).toBe('gold');
    expect(t[0]!.chance).toBeCloseTo(100, 9);
    expect(() => caseTable(def, [])).toThrow();
  });
});

describe('the roll matches the table', () => {
  for (const id of ['daily', 'standard', 'premium'] as const) {
    it(`${CASES[id].name}: 60,000 opens land within 0.4 points of every rarity's odds`, () => {
      const def = CASES[id];
      const t = caseTable(def, w.profileList);
      const rng = new Rng(2026);
      const n = 60000;
      const counts: Record<string, number> = {};
      for (let i = 0; i < n; i++) { const p = rollPlayer(rng, def, w.profileList); counts[p.rarity] = (counts[p.rarity] ?? 0) + 1; }
      for (const r of t) expect(Math.abs(((counts[r.rarity] ?? 0) / n) * 100 - r.chance)).toBeLessThan(0.4);
      expect(Object.keys(counts).every((r) => t.some((x) => x.rarity === r))).toBe(true);
    });
  }

  it('within a rarity every player is equally likely (no favourites)', () => {
    const t = caseTable(CASES.premium, w.profileList);
    const legends = t.find((r) => r.rarity === 'legend')!;
    const rng = new Rng(7);
    const counts = new Map<string, number>();
    let n = 0;
    for (let i = 0; i < 200000; i++) { const p = rollPlayer(rng, CASES.premium, w.profileList); if (p.rarity === 'legend') { n++; counts.set(p.record.id, (counts.get(p.record.id) ?? 0) + 1); } }
    const expected = n / legends.players.length;
    for (const p of legends.players) expect(Math.abs((counts.get(p.record.id) ?? 0) - expected) / expected).toBeLessThan(0.3);
  });

  it('the role case only ever gives the chosen role', () => {
    const rng = new Rng(3);
    for (const role of ROLES) for (let i = 0; i < 300; i++) expect(rollPlayer(rng, CASES.role, w.profileList, role).record.primaryRole).toBe(role);
  });
});

describe('opening to inventory', () => {
  it('the pulled player is exactly the card that lands in the collection, and the price is charged once', () => {
    let c = createCareer(w, { managerName: 'T', teamName: 'Testers', teamTag: 'TST', coachId: starterCoaches(w)[0]!.id, seed: 5, today: '2026-10-23' });
    c = { ...c, coins: 100000 };
    for (let i = 0; i < 25; i++) {
      const before = c.coins, cardsBefore = c.cards.length;
      const r = openCase(w, c, 'standard');
      const got = r.outcome.profile.record.id;
      if (r.outcome.pendingFull) {
        expect(r.career.pendingPull?.playerId).toBe(got);
        break;
      }
      expect(r.career.cards.some((x) => x.playerId === got)).toBe(true);
      expect(r.career.cards.length).toBe(cardsBefore + (r.outcome.duplicate ? 0 : 1));
      expect(r.career.coins).toBe(before - CASES.standard.price + r.outcome.refund);
      c = r.career;
    }
  });
});
