/**
 * Club economy: market values, wages, contracts, sponsors, reputation and the
 * money ledger. All amounts are in-game coins. Nothing here is a real-world
 * salary or fee: values are generated from game ratings.
 */
import { clamp, hashString } from './rng';
import { personalityOf } from './profile';
import type { Coach, OwnedCard, PlayerProfile } from './types';

// ---------- Values and wages ----------

/** Market value from overall, with a premium for headroom (potential above overall) and youth. */
export function marketValue(p: PlayerProfile, ovr = p.ovr): number {
  const base = 200 * Math.pow(1.13, ovr - 60);
  const headroom = 1 + clamp(p.potential - ovr, 0, 12) / 30;
  const age = p.record.age <= 20 ? 1.15 : p.record.age >= 29 ? 0.85 : 1;
  return Math.max(100, Math.round((base * headroom * age) / 50) * 50);
}

/** Weekly wage a player expects, before negotiation modifiers. */
export function baseWage(p: PlayerProfile, ovr = p.ovr): number {
  // Stars take a bigger share: 3% of value up to 80 OVR, rising to 4.5% at 95.
  const share = 0.03 + clamp(ovr - 80, 0, 15) * 0.001;
  return Math.max(15, Math.round((200 * Math.pow(1.13, ovr - 60) * share) / 5) * 5);
}

// ---------- Facilities ----------

export type FacilityId = 'training' | 'analysis' | 'medical';
export const FACILITY_IDS: FacilityId[] = ['training', 'analysis', 'medical'];
export const FACILITY_MAX = 3;

export const FACILITIES: Record<FacilityId, { name: string; effect: (level: number) => string; cost: number[]; upkeep: number[] }> = {
  training: { name: 'Training ground', effect: (l) => `+${l * 8}% training gains`, cost: [3000, 8000, 18000], upkeep: [0, 40, 100, 220] },
  analysis: { name: 'Analysis room', effect: (l) => `+${l * 25}% opponent prep from tactical review`, cost: [2500, 7000, 15000], upkeep: [0, 30, 80, 180] },
  medical: { name: 'Recovery centre', effect: (l) => `${l * 4} extra fatigue recovered each week`, cost: [2000, 6000, 14000], upkeep: [0, 25, 70, 160] },
};

export type Facilities = Record<FacilityId, number>;
export const NO_FACILITIES: Facilities = { training: 0, analysis: 0, medical: 0 };

export function facilityUpkeep(f: Facilities): number {
  return FACILITY_IDS.reduce((s, id) => s + FACILITIES[id].upkeep[f[id]]!, 0);
}

export function coachWage(coach: Coach): number {
  return Math.max(20, Math.round(coach.hireCost / 20 / 5) * 5);
}

export const MAX_SQUAD = 8; // five starters and three on the bench
export const MIN_SQUAD = 5;
export const CONTRACT_LENGTHS = [9, 18, 27] as const; // weeks; a season is 9 weeks
export const SALE_SHARE = 0.4; // share of market value an AI club pays for your player
export const SEVERANCE_WEEKS = 4; // releasing a player pays up to this many weeks of wages

export interface Contract {
  wage: number; // coins per week
  weeksLeft: number;
}

export function defaultContract(p: PlayerProfile): Contract {
  return { wage: baseWage(p), weeksLeft: 18 };
}

export function severance(card: OwnedCard): number {
  const c = card.contract;
  return c ? c.wage * Math.min(c.weeksLeft, SEVERANCE_WEEKS) : 0;
}

// ---------- Reputation ----------

export function reputationLabel(rep: number): string {
  if (rep >= 80) return 'World-class';
  if (rep >= 60) return 'Respected';
  if (rep >= 40) return 'Established';
  if (rep >= 20) return 'Rising';
  return 'Unknown';
}

// ---------- Negotiation ----------

export interface Demand {
  askingFee: number; // what the selling club wants (0 for free agents is replaced by a signing fee)
  wage: number; // weekly wage the player wants for an 18-week deal
  interest: 'high' | 'medium' | 'low' | 'none';
  reason: string;
}

/**
 * What a player and their club want. Deterministic per player, season and week,
 * so retrying the same offer gives the same answer.
 */
export function demandFor(p: PlayerProfile, ctx: { onTeam: boolean; division: number; reputation: number; season: number; week: number }): Demand {
  const value = marketValue(p);
  const pers = personalityOf(p.record.id);
  const jitter = (hashString(`${p.record.id}:${ctx.season}:${ctx.week}`) % 1000) / 1000; // 0..1
  const askingFee = ctx.onTeam ? Math.round((value * (1.05 + 0.15 * jitter)) / 50) * 50 : Math.round((value * 0.25) / 50) * 50;
  // Ambitious players want more from small clubs; top players want a big stage.
  const prestigeGap = clamp((100 - p.record.rank) / 100, 0, 1) - (ctx.reputation / 100 + ctx.division * 0.12);
  const wageMult = 1 + (pers.ambition - 10) / 40 + Math.max(0, prestigeGap) * 0.6;
  const wage = Math.max(15, Math.round((baseWage(p) * wageMult) / 5) * 5);
  let interest: Demand['interest'] = 'high';
  let reason = 'Keen to join.';
  if (prestigeGap > 0.55) { interest = 'none'; reason = 'Wants a bigger stage than your club offers right now. Raise your reputation or division.'; }
  else if (prestigeGap > 0.3) { interest = 'low'; reason = 'Doubts your project. Expect to pay well above the usual wage.'; }
  else if (prestigeGap > 0.1) { interest = 'medium'; reason = 'Open to talks.'; }
  return { askingFee, wage, interest, reason };
}

export function wageForLength(wage18: number, weeks: number): number {
  // Short deals cost a little more per week, long deals a little less; players like security.
  const mult = weeks <= 9 ? 1.08 : weeks >= 27 ? 0.95 : 1;
  return Math.round((wage18 * mult) / 5) * 5;
}

export interface OfferTerms { fee: number; wage: number; weeks: number }
export type OfferResult =
  | { ok: true }
  | { ok: false; reason: string; counter?: { fee: number; wage: number } };

export function judgeOffer(d: Demand, terms: OfferTerms): OfferResult {
  if (!CONTRACT_LENGTHS.includes(terms.weeks as (typeof CONTRACT_LENGTHS)[number])) return { ok: false, reason: 'Contract length must be 9, 18 or 27 weeks.' };
  if (terms.fee < 0 || terms.wage <= 0 || !Number.isFinite(terms.fee) || !Number.isFinite(terms.wage)) return { ok: false, reason: 'Fee and wage must be positive numbers.' };
  const needWage = Math.round(wageForLength(d.wage, terms.weeks) * (d.interest === 'none' ? 9 : d.interest === 'low' ? 1.35 : 1));
  const feeOk = terms.fee >= d.askingFee;
  const wageOk = terms.wage >= needWage;
  if (d.interest === 'none') return { ok: false, reason: d.reason };
  if (feeOk && wageOk) return { ok: true };
  const parts: string[] = [];
  if (!feeOk) parts.push(`the club wants at least ${d.askingFee}`);
  if (!wageOk) parts.push(`the player wants ${needWage} a week`);
  return { ok: false, reason: `Rejected: ${parts.join(' and ')}.`, counter: { fee: Math.max(terms.fee, d.askingFee), wage: Math.max(terms.wage, needWage) } };
}

// ---------- Sponsors ----------

export type SponsorGoal = 'top4' | 'top2' | 'win-title' | 'avoid-relegation';
export const SPONSOR_GOAL_LABEL: Record<SponsorGoal, string> = {
  top4: 'Reach the playoffs (top 4)',
  top2: 'Finish in the top 2',
  'win-title': 'Win the division',
  'avoid-relegation': 'Finish 6th or better',
};

export interface Sponsor {
  id: string;
  name: string;
  style: 'steady' | 'performance' | 'ambitious';
  weekly: number;
  winBonus: number;
  goal: SponsorGoal;
  goalBonus: number;
}

const SPONSOR_NAMES = ['Kestrel Energy', 'Bitforge Peripherals', 'Northline Telecom', 'Pulse Hydration', 'Vanta Chairs', 'Cobalt Bank', 'Arcbyte Cloud', 'Mono Apparel', 'Lumen Displays', 'Gridlock Logistics', 'Hexa Mice', 'Saltfish VPN'];

export function sponsorOffers(season: number, division: number, reputation: number, seed: number): Sponsor[] {
  const base = [120, 200, 320, 500][division] ?? 120;
  const scale = base * (0.8 + reputation / 250);
  const h = hashString(`sponsor:${seed}:${season}`);
  const names = [0, 1, 2].map((i) => SPONSOR_NAMES[(h + i * 5) % SPONSOR_NAMES.length]!);
  const r = (x: number) => Math.round(x / 10) * 10;
  return [
    { id: `s${season}-steady`, name: names[0]!, style: 'steady', weekly: r(scale * 1.1), winBonus: r(scale * 0.1), goal: 'avoid-relegation', goalBonus: r(scale * 2) },
    { id: `s${season}-performance`, name: names[1]!, style: 'performance', weekly: r(scale * 0.55), winBonus: r(scale * 0.7), goal: 'top4', goalBonus: r(scale * 3) },
    { id: `s${season}-ambitious`, name: names[2]!, style: 'ambitious', weekly: r(scale * 0.6), winBonus: r(scale * 0.25), goal: division >= 3 ? 'win-title' : 'top2', goalBonus: r(scale * 9) },
  ];
}

export function sponsorGoalMet(goal: SponsorGoal, placement: number): boolean {
  if (goal === 'win-title') return placement === 1;
  if (goal === 'top2') return placement <= 2;
  if (goal === 'top4') return placement <= 4;
  return placement <= 6;
}

// ---------- Ledger ----------

export type LedgerKind = 'facilities' | 'match' | 'prize' | 'sponsor' | 'wages' | 'transfer' | 'sale' | 'release' | 'case' | 'training' | 'coach' | 'refund';

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  facilities: 'Facilities',
  match: 'Match income', prize: 'Prize money', sponsor: 'Sponsorship', wages: 'Wages', transfer: 'Transfer fees',
  sale: 'Player sales', release: 'Severance', case: 'Cases', training: 'Training & bootcamps', coach: 'Coach hiring', refund: 'Duplicate refunds',
};

export interface LedgerEntry {
  season: number;
  week: number;
  kind: LedgerKind;
  amount: number; // + income, - expense
  label: string;
}
