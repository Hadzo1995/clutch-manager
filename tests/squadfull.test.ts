import { describe, expect, it } from 'vitest';
import { benchCards, openCase, pullSalePrice, resolvePull } from '../src/engine/career';
import { CASES } from '../src/engine/cases';
import type { CaseId } from '../src/engine/cases';
import { MAX_SQUAD } from '../src/engine/economy';
import { newCareer, world } from './helpers';

function fullSquad() {
  const w = world();
  const c = newCareer(21);
  const owned = new Set(c.cards.map((x) => x.playerId));
  const extra = w.profileList.filter((p) => !owned.has(p.record.id)).slice(150, 150 + MAX_SQUAD - c.cards.length);
  return { w, c: { ...c, coins: 1_000_000, cards: [...c.cards, ...extra.map((p, i) => ({ ...c.cards[0]!, cardId: `bench${i}`, playerId: p.record.id }))] } };
}

describe('full squad case pulls', () => {
  it('squad holds five starters and three on the bench', () => {
    expect(MAX_SQUAD).toBe(8);
  });
  it('a new pull with a full squad waits for a choice; selling a benched player signs it', () => {
    const { w, c } = fullSquad();
    let r = openCase(w, c, 'standard');
    for (let i = 0; i < 20 && !r.outcome.pendingFull; i++) r = openCase(w, { ...c, rngState: (c.rngState ?? 1) + i + 1 } as typeof c, 'standard');
    expect(r.outcome.pendingFull).toBe(true);
    const pend = r.career.pendingPull!;
    expect(r.career.cards).toHaveLength(MAX_SQUAD);
    expect(() => openCase(w, r.career, 'standard')).toThrow(/Decide/);
    const bench = benchCards(r.career);
    expect(bench).toHaveLength(MAX_SQUAD - 5);
    const after = resolvePull(w, r.career, { sellCardId: bench[0]!.cardId });
    expect(after.pendingPull).toBeUndefined();
    expect(after.cards).toHaveLength(MAX_SQUAD);
    expect(after.cards.some((x) => x.playerId === pend.playerId)).toBe(true);
    expect(after.cards.some((x) => x.cardId === bench[0]!.cardId)).toBe(false);
    expect(after.coins).toBeGreaterThan(r.career.coins);
    // Starters can't be sold for a pull.
    expect(() => resolvePull(w, r.career, { sellCardId: r.career.lineup[0]!.cardId! })).toThrow();
  });
  it('selling the pull pays coins and keeps the squad', () => {
    const { w, c } = fullSquad();
    let r = openCase(w, c, 'standard');
    for (let i = 0; i < 20 && !r.outcome.pendingFull; i++) r = openCase(w, { ...c, rngState: (c.rngState ?? 1) + i + 1 } as typeof c, 'standard');
    const price = pullSalePrice(w, r.career.pendingPull!.playerId);
    const after = resolvePull(w, r.career, 'sell-pull');
    expect(after.coins).toBe(r.career.coins + price);
    expect(after.cards.map((x) => x.cardId)).toEqual(r.career.cards.map((x) => x.cardId));
  });
  it('selling pulls straight away loses money on average (no coin loop)', () => {
    const w = world();
    for (const id of ['standard', 'premium'] as CaseId[]) {
      const def = CASES[id];
      let total = 0;
      for (const p of w.profileList) total += pullSalePrice(w, p.record.id) * (def.odds[p.rarity] / 100) / w.profileList.filter((q) => q.rarity === p.rarity).length;
      expect(total).toBeLessThan(def.price);
    }
  });
});
