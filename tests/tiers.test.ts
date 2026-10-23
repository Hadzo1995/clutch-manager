import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/engine/career';
import { realDataset } from '../src/engine/data/realPlayers';
import { TIER_CAP, cardOvr } from '../src/engine/ratings';
import type { OwnedCard } from '../src/engine/types';
import { ATTRIBUTES } from '../src/engine/types';

describe('tiers and caps', () => {
  const w = createWorld(realDataset()!);
  it('every player has a tier, the pyramid narrows to the top, and caps never sit below OVR', () => {
    const count = (t: string) => w.profileList.filter((p) => p.tier === t).length;
    expect(count('S+++')).toBeGreaterThanOrEqual(1);
    expect(count('S+++')).toBeLessThanOrEqual(count('S++'));
    expect(count('S')).toBeLessThan(count('A'));
    for (const p of w.profileList) expect(p.potential).toBe(Math.max(p.ovr, TIER_CAP[p.tier]));
    const zywoo = w.profileList.find((p) => p.record.handle === 'ZywOo')!;
    expect(zywoo.tier.startsWith('S')).toBe(true);
  });
  it('development stops at the cap: a maxed-out card reads the tier cap, not more', () => {
    const p = w.profileList.find((x) => x.tier === 'A')!;
    const growth = Object.fromEntries(ATTRIBUTES.map((a) => [a, 60])) as OwnedCard['growth'];
    const card = { cardId: 'c1', playerId: p.record.id, acquiredWeek: 1, growth, stars: 5, sharpness: 100, fatigue: 0, form: 0, morale: 70 } as unknown as OwnedCard;
    expect(cardOvr(p, card)).toBe(p.potential);
    expect(cardOvr(p, card)).toBeLessThanOrEqual(TIER_CAP.A > p.ovr ? TIER_CAP.A : p.ovr);
  });
});
