import { CASES, addToCollection, rollRarity, rollPlayer, MAXED_DUPLICATE_REFUND } from '../src/engine/cases';
import { openCase, lineupValidation, setLineup, canClaimDaily } from '../src/engine/career';
import { Rng } from '../src/engine/rng';
import { RARITIES } from '../src/engine/types';
import type { OwnedCard } from '../src/engine/types';
import { newCareer, world } from './helpers';

describe('roster rules', () => {
  it('a new career starts with a legal five and a coach', () => {
    const c = newCareer();
    expect(c.lineup).toHaveLength(5);
    expect(lineupValidation(c).ok).toBe(true);
  });
  it('rejects fewer than five players', () => {
    const c = setLineup(newCareer(), newCareer().lineup.slice(0, 4));
    expect(lineupValidation(c).ok).toBe(false);
  });
  it('rejects the same card twice', () => {
    const base = newCareer();
    const l = [...base.lineup];
    l[1] = { ...l[1]!, cardId: l[0]!.cardId };
    expect(lineupValidation(setLineup(base, l)).errors.join(' ')).toMatch(/twice/);
  });
  it('rejects two players on the same role', () => {
    const base = newCareer();
    const l = base.lineup.map((s) => ({ ...s }));
    l[1]!.role = l[0]!.role;
    expect(lineupValidation(setLineup(base, l)).ok).toBe(false);
  });
  it('requires a coach', () => {
    const c = { ...newCareer(), coachId: null };
    expect(lineupValidation(c).errors.join(' ')).toMatch(/coach/);
  });
});

describe('cases', () => {
  it('publishes odds that sum to 100%', () => {
    for (const def of Object.values(CASES)) {
      expect(RARITIES.reduce((s, r) => s + def.odds[r], 0)).toBeCloseTo(100, 6);
    }
  });
  it('rolls rarities in line with the published odds', () => {
    const rng = new Rng(1);
    const n = 40000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) { const r = rollRarity(rng, CASES.standard.odds); counts[r] = (counts[r] ?? 0) + 1; }
    for (const r of RARITIES) expect(Math.abs(((counts[r] ?? 0) / n) * 100 - CASES.standard.odds[r])).toBeLessThan(1);
  });
  it('role case only gives the chosen role', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) expect(rollPlayer(rng, CASES.role, world().profileList, 'awp').record.primaryRole).toBe('awp');
  });
  it('duplicates add stars, then refund coins at max', () => {
    const cards: OwnedCard[] = [];
    const p = world().profileList[0]!;
    let id = 0;
    const make = () => `c${id++}`;
    addToCollection(cards, p, 1, make);
    for (let i = 1; i <= 5; i++) expect(addToCollection(cards, p, 1, make).starsNow).toBe(i);
    const last = addToCollection(cards, p, 1, make);
    expect(last.refund).toBe(MAXED_DUPLICATE_REFUND[p.rarity]);
    expect(cards).toHaveLength(1);
  });
  it('charges coins, blocks when broke, and allows one daily case per day', () => {
    const w = world();
    let c = newCareer();
    const coins = c.coins;
    c = openCase(w, c, 'standard').career;
    expect(c.coins).toBeLessThanOrEqual(coins - CASES.standard.price + 2000);
    c = { ...c, coins: 10 };
    expect(() => openCase(w, c, 'standard')).toThrow(/coins/);
    c = openCase(w, c, 'daily', { today: '2026-10-10' }).career;
    expect(canClaimDaily(c, '2026-10-10')).toBe(false);
    expect(() => openCase(w, c, 'daily', { today: '2026-10-10' })).toThrow();
    expect(canClaimDaily(c, '2026-10-11')).toBe(true);
  });
});
