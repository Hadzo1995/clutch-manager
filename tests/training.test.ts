import { runTraining, WEEKLY_ATTR_CAP, validatePlan } from '../src/engine/training';
import type { TrainingPlan } from '../src/engine/training';
import { attributeCap, cardAttributes, effectiveOvr } from '../src/engine/ratings';
import { runTrainingWeek, profileOf, setPlan } from '../src/engine/career';
import { Rng } from '../src/engine/rng';
import { ATTRIBUTES } from '../src/engine/types';
import type { OwnedCard, PlayerProfile } from '../src/engine/types';
import { newCareer, world } from './helpers';

function freshCard(p: PlayerProfile, over: Partial<OwnedCard> = {}): OwnedCard {
  return { cardId: 'x', playerId: p.record.id, acquiredWeek: 0, growth: {}, stars: 0, sharpness: 80, fatigue: 0, morale: 60, form: 0, matchesPlayed: 0, ...over };
}
const young = () => world().profileList.find((p) => p.record.age <= 20)!;

describe('training plans', () => {
  it('requires exactly 3 slots, bootcamp alone', () => {
    expect(validatePlan({ sessions: ['aim', 'aim'], focusMap: 'Mirage', individualFocus: {} })).not.toHaveLength(0);
    expect(validatePlan({ sessions: ['bootcamp', 'aim'], focusMap: 'Mirage', individualFocus: {} })).not.toHaveLength(0);
    expect(validatePlan({ sessions: ['bootcamp'], focusMap: 'Mirage', individualFocus: {} })).toHaveLength(0);
  });
  it('repeating the same session has diminishing returns', () => {
    const p = young();
    const one = runTraining({ sessions: ['aim', 'rest', 'rest'], focusMap: 'Mirage', individualFocus: {} }, [{ card: freshCard(p), profile: p }], null);
    const three = runTraining({ sessions: ['aim', 'aim', 'aim'], focusMap: 'Mirage', individualFocus: {} }, [{ card: freshCard(p), profile: p }], null);
    expect(three.gains.x!.aim!).toBeLessThan(one.gains.x!.aim! * 1.8);
  });
  it('never exceeds the weekly cap on any attribute', () => {
    const p = young();
    const plan: TrainingPlan = { sessions: ['coaching', 'coaching', 'aim'], focusMap: 'Mirage', individualFocus: { x: 'aim' } };
    const rng = new Rng(9);
    for (let i = 0; i < 50; i++) {
      const out = runTraining(plan, [{ card: freshCard(p), profile: p }], world().coaches[0]!, rng);
      for (const a of ATTRIBUTES) expect(out.gains.x![a] ?? 0).toBeLessThanOrEqual(WEEKLY_ATTR_CAP);
    }
  });
  it('high fatigue cuts gains', () => {
    const p = young();
    const fresh = runTraining({ sessions: ['aim', 'clutch', 'utility'], focusMap: 'Mirage', individualFocus: {} }, [{ card: freshCard(p), profile: p }], null);
    const tired = runTraining({ sessions: ['aim', 'clutch', 'utility'], focusMap: 'Mirage', individualFocus: {} }, [{ card: freshCard(p, { fatigue: 85 }), profile: p }], null);
    expect(tired.gains.x!.aim!).toBeLessThan(fresh.gains.x!.aim! * 0.5);
  });
  it('cannot be exploited for unlimited growth: 300 weeks stays under the cap', () => {
    const p = young();
    const card = freshCard(p);
    const rng = new Rng(4);
    for (let w = 0; w < 300; w++) {
      const out = runTraining({ sessions: ['coaching', 'aim', 'deathmatch'], focusMap: 'Mirage', individualFocus: { x: 'aim' } }, [{ card, profile: p }], null, rng);
      for (const [k, v] of Object.entries(out.gains.x!)) card.growth[k as 'aim'] = (card.growth[k as 'aim'] ?? 0) + (v ?? 0);
    }
    const attrs = cardAttributes(p, card);
    for (const a of ATTRIBUTES) expect(attrs[a]).toBeLessThanOrEqual(attributeCap(p, card, a));
  });
  it('three weeks of aim work give a clear but bounded gain (training is the main lever, 2026-10-23)', () => {
    const w = world();
    let c = newCareer();
    const before = c.cards.map((card) => cardAttributes(profileOf(w, card), card).aim);
    for (let i = 0; i < 3; i++) {
      c = setPlan(c, { sessions: ['aim', 'aim', 'deathmatch'], focusMap: 'Mirage', individualFocus: {} });
      c = runTrainingWeek(w, c);
      c = { ...c, phase: 'training' };
    }
    const after = c.cards.map((card) => cardAttributes(profileOf(w, card), card).aim);
    for (let i = 0; i < before.length; i++) expect(after[i]! - before[i]!).toBeLessThanOrEqual(3 * 2.5);
  });
  it('an active, trained gold card can outplay an idle legend (C22)', () => {
    const list = world().profileList;
    const legend = list.find((p) => p.rarity === 'legend')!;
    const gold = [...list].filter((p) => p.rarity === 'gold').sort((a, b) => b.ovr - a.ovr)[0]!;
    const idleLegend = freshCard(legend, { sharpness: 0 });
    const goldCard = freshCard(gold, { sharpness: 100, stars: 3 });
    for (const a of ATTRIBUTES) goldCard.growth[a] = 4;
    expect(effectiveOvr(gold, goldCard)).toBeGreaterThan(effectiveOvr(legend, idleLegend));
  });
});
