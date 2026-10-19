/**
 * Weekly training. A plan has 3 sessions (a bootcamp fills all 3).
 *
 * Anti-exploit rules (tested in tests/training.test.ts):
 *  - diminishing returns as an attribute approaches the card's cap
 *  - repeating an activity in the same week gives 100% / 50% / 25%
 *  - high fatigue cuts gains, and fatigue builds with intense sessions
 *  - at most +WEEKLY_ATTR_CAP per attribute per week
 *  - younger players develop faster, veterans slower
 */
import { personalityOf, trainingMultiplier } from './profile';
import { Rng, clamp } from './rng';
import { attributeCap, cardAttributes } from './ratings';
import type { Attribute, Coach, CoachAttribute, MapName, OwnedCard, PlayerProfile, Role } from './types';
import { ATTRIBUTES, MAPS } from './types';

export type ActivityId =
  | 'aim' | 'deathmatch' | 'utility' | 'awp' | 'entrytrade' | 'clutch'
  | 'scrims' | 'review' | 'mapprep' | 'coaching' | 'rest' | 'bootcamp';

export interface Activity {
  id: ActivityId;
  name: string;
  description: string;
  slots: 1 | 3;
  cost: number;
  fatigue: number; // added to each active player (negative = recovery)
  gains: Partial<Record<Attribute, number>>; // relative weights per session
  roleMultiplier?: Partial<Record<Role, number>>; // default 1
  coachAttr: CoachAttribute;
  chemistry?: number;
  focusMapPractice?: number;
  allMapPractice?: number;
  prep?: number; // logit bonus for the next match
  morale?: number;
  focusOnly?: boolean; // only trains each player's individual focus
}

export const ACTIVITIES: Record<ActivityId, Activity> = {
  aim: { id: 'aim', name: 'Aim training', description: 'Mechanical drills. Raises aim and consistency.', slots: 1, cost: 0, fatigue: 6, gains: { aim: 1, consistency: 0.3 }, coachAttr: 'development' },
  deathmatch: { id: 'deathmatch', name: 'Deathmatch', description: 'High-intensity duels. Aim, entry and trading, but tiring.', slots: 1, cost: 0, fatigue: 10, gains: { aim: 0.7, entry: 0.4, trading: 0.3 }, coachAttr: 'development' },
  utility: { id: 'utility', name: 'Utility lab', description: 'Smokes, flashes and molotov lineups. Best for supports and IGLs.', slots: 1, cost: 0, fatigue: 5, gains: { utility: 1, teamwork: 0.3 }, roleMultiplier: { support: 1.2, igl: 1.15, awp: 0.8 }, coachAttr: 'tactics' },
  awp: { id: 'awp', name: 'AWP practice', description: 'Flicks and angle holding. Only really helps AWPers.', slots: 1, cost: 0, fatigue: 6, gains: { awp: 1.2, positioning: 0.3 }, roleMultiplier: { awp: 1, entry: 0.3, support: 0.3, lurker: 0.4, igl: 0.3 }, coachAttr: 'development' },
  entrytrade: { id: 'entrytrade', name: 'Entry & trade drills', description: 'First contact and refrags. Entry and trading.', slots: 1, cost: 0, fatigue: 9, gains: { entry: 0.8, trading: 0.8 }, roleMultiplier: { entry: 1.2, support: 1.1, awp: 0.7 }, coachAttr: 'development' },
  clutch: { id: 'clutch', name: 'Clutch scenarios', description: '1vX situations. Clutch, consistency and game sense.', slots: 1, cost: 0, fatigue: 6, gains: { clutch: 1, consistency: 0.4, gameSense: 0.2 }, roleMultiplier: { lurker: 1.2 }, coachAttr: 'development' },
  scrims: { id: 'scrims', name: 'Team scrims', description: 'Practice matches on your focus map. Chemistry, game sense, map practice.', slots: 1, cost: 150, fatigue: 12, gains: { gameSense: 0.5, teamwork: 0.5, trading: 0.3 }, coachAttr: 'tactics', chemistry: 3, focusMapPractice: 4 },
  review: { id: 'review', name: 'Tactical review', description: 'Demo study of your next opponent. Gives a prep bonus for the next match.', slots: 1, cost: 0, fatigue: 2, gains: { gameSense: 0.5, leadership: 0.4 }, roleMultiplier: { igl: 1.5 }, coachAttr: 'mapPrep', chemistry: 1, prep: 0.06 },
  mapprep: { id: 'mapprep', name: 'Map preparation', description: 'Set plays and positions on your focus map.', slots: 1, cost: 0, fatigue: 4, gains: { positioning: 0.2, utility: 0.2 }, coachAttr: 'mapPrep', focusMapPractice: 8 },
  coaching: { id: 'coaching', name: '1-on-1 coaching', description: 'Each player works only on their individual focus, at double speed.', slots: 1, cost: 300, fatigue: 4, gains: {}, coachAttr: 'development', focusOnly: true },
  rest: { id: 'rest', name: 'Rest day', description: 'Recover fatigue and lift morale. No skill gains.', slots: 1, cost: 0, fatigue: -20, gains: {}, coachAttr: 'motivation', morale: 4 },
  bootcamp: {
    id: 'bootcamp', name: 'Bootcamp', description: 'A full week away together. Big chemistry and map practice boost, game sense, teamwork and prep. Expensive and tiring.',
    slots: 3, cost: 2000, fatigue: 18, gains: { gameSense: 0.6, teamwork: 0.8, utility: 0.4, trading: 0.4 }, coachAttr: 'motivation',
    chemistry: 10, allMapPractice: 4, focusMapPractice: 8, prep: 0.05, morale: 6,
  },
};

export const SESSION_BASE_GAIN = 0.45;
export const WEEKLY_ATTR_CAP = 1.5;
export const REPEAT_FACTORS = [1, 0.5, 0.25];

export interface TrainingPlan {
  sessions: ActivityId[]; // 3 entries, or ['bootcamp']
  focusMap: MapName;
  individualFocus: Record<string, Attribute | null>; // by cardId
}

export interface TrainingMember { card: OwnedCard; profile: PlayerProfile }

export interface TrainingOutcome {
  gains: Record<string, Partial<Record<Attribute, number>>>; // by cardId
  fatigueAfter: Record<string, number>;
  chemistryDelta: number;
  mapPracticeDelta: Partial<Record<MapName, number>>;
  prepBonus: number;
  moraleDelta: number;
  cost: number;
}

export function planSlotsUsed(plan: TrainingPlan): number {
  return plan.sessions.reduce((s, id) => s + ACTIVITIES[id].slots, 0);
}

export function validatePlan(plan: TrainingPlan): string[] {
  const errors: string[] = [];
  const used = planSlotsUsed(plan);
  if (used !== 3) errors.push(`A week has 3 training slots (this plan uses ${used}).`);
  if (plan.sessions.includes('bootcamp') && plan.sessions.length !== 1) errors.push('A bootcamp takes the whole week.');
  return errors;
}

export function planCost(plan: TrainingPlan): number {
  return plan.sessions.reduce((s, id) => s + ACTIVITIES[id].cost, 0);
}

function ageFactor(age: number): number {
  if (age <= 20) return 1.3;
  if (age <= 23) return 1.1;
  if (age <= 26) return 0.9;
  if (age <= 29) return 0.7;
  return 0.5;
}

function coachFactor(coach: Coach | null, attr: CoachAttribute): number {
  const v = coach ? coach.attrs[attr] : 35;
  return 0.7 + (v / 100) * 0.6;
}

function fatiguePenalty(fatigue: number): number {
  if (fatigue >= 80) return 0.3;
  if (fatigue >= 60) return 0.6;
  return 1;
}

/**
 * Runs a training week. With `rng` omitted it returns expected values
 * (used for the plan comparison preview, no randomness).
 */
export function runTraining(plan: TrainingPlan, members: TrainingMember[], coach: Coach | null, rng?: Rng): TrainingOutcome {
  const gains: TrainingOutcome['gains'] = {};
  const fatigueAfter: Record<string, number> = {};
  let chemistryDelta = 0;
  const mapPracticeDelta: Partial<Record<MapName, number>> = {};
  let prepBonus = 0;
  let moraleDelta = 0;

  for (const m of members) {
    gains[m.card.cardId] = {};
    fatigueAfter[m.card.cardId] = m.card.fatigue;
  }

  const seen = new Map<ActivityId, number>();
  for (const id of plan.sessions) {
    const act = ACTIVITIES[id];
    const nth = seen.get(id) ?? 0;
    seen.set(id, nth + 1);
    const repeat = REPEAT_FACTORS[Math.min(nth, REPEAT_FACTORS.length - 1)]!;
    const cf = coachFactor(coach, act.coachAttr);

    for (const m of members) {
      const cid = m.card.cardId;
      const role = m.card.roleOverride ?? m.profile.record.primaryRole;
      const roleMult = act.roleMultiplier?.[role] ?? 1;
      const focus = plan.individualFocus[cid] ?? null;
      const current = cardAttributes(m.profile, m.card);
      const fatigueNow = fatigueAfter[cid]!;
      const g = gains[cid]!;
      const weights: Partial<Record<Attribute, number>> = act.focusOnly ? (focus ? { [focus]: 2.2 } : {}) : act.gains;
      for (const [attr, w] of Object.entries(weights) as [Attribute, number][]) {
        const cap = attributeCap(m.profile, m.card, attr);
        const cur = current[attr] + (g[attr] ?? 0);
        const room = Math.max(0, cap - m.profile.base[attr]);
        const headroom = room <= 0 ? 0 : Math.pow(clamp((cap - cur) / room, 0, 1), 1.3);
        const focusMult = act.focusOnly ? 1 : focus === attr ? 1.6 : focus ? 0.85 : 1;
        const noise = rng ? rng.range(0.6, 1.4) : 1;
        const delta = SESSION_BASE_GAIN * trainingMultiplier(personalityOf(m.profile.record.id)) * w * roleMult * cf * ageFactor(m.profile.record.age) * headroom * fatiguePenalty(fatigueNow) * repeat * focusMult * noise;
        g[attr] = (g[attr] ?? 0) + delta;
      }
      fatigueAfter[cid] = clamp(fatigueNow + act.fatigue, 0, 100);
    }
    chemistryDelta += (act.chemistry ?? 0) * repeat * coachFactor(coach, 'communication');
    if (act.focusMapPractice) mapPracticeDelta[plan.focusMap] = (mapPracticeDelta[plan.focusMap] ?? 0) + act.focusMapPractice * repeat * coachFactor(coach, 'mapPrep');
    if (act.allMapPractice) for (const map of MAPS) mapPracticeDelta[map] = (mapPracticeDelta[map] ?? 0) + act.allMapPractice;
    if (act.prep) prepBonus += act.prep * repeat * coachFactor(coach, 'mapPrep');
    moraleDelta += (act.morale ?? 0) * coachFactor(coach, 'motivation');
  }

  // Weekly cap and rounding to 2 decimals for clean saves.
  for (const cid of Object.keys(gains)) {
    const g = gains[cid]!;
    for (const a of ATTRIBUTES) {
      if (g[a] === undefined) continue;
      g[a] = Number(Math.min(WEEKLY_ATTR_CAP, g[a]!).toFixed(2));
      if (g[a] === 0) delete g[a];
    }
  }

  return {
    gains,
    fatigueAfter,
    chemistryDelta: Number(chemistryDelta.toFixed(1)),
    mapPracticeDelta,
    prepBonus: Number(Math.min(0.15, prepBonus).toFixed(3)),
    moraleDelta: Math.round(moraleDelta),
    cost: planCost(plan),
  };
}

/** Sum of expected attribute points across the five (for comparing plans). */
export function totalExpectedGain(outcome: TrainingOutcome): number {
  return Number(Object.values(outcome.gains).reduce((s, g) => s + Object.values(g).reduce((a, b) => a + (b ?? 0), 0), 0).toFixed(1));
}

export function defaultPlan(focusMap: MapName = 'Mirage'): TrainingPlan {
  return { sessions: ['aim', 'scrims', 'review'], focusMap, individualFocus: {} };
}
