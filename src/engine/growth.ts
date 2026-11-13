/**
 * Growth from playing well: after every map, each of your players earns
 * attribute points from their match rating, so the way to grind a player up is
 * to field them where they shine.
 *
 *  - Rating 1.15 or higher: a big gain; 0.95 to 1.15: a small one; 0.85 to
 *    0.95: a trace. Below 0.85 nothing grows and form drops for the next games.
 *  - The gain goes to the attributes the player's role uses, plus extras for
 *    what they did: opening kills train Entry, clutches train Clutch, a high
 *    KAST trains Consistency.
 *  - Playing their own role, with good chemistry and rested, multiplies it;
 *    off-role or exhausted players gain little.
 *  - Like training, gains slow down as a player nears their tier cap and never
 *    go past it.
 */
import type { MapResult, PlayerLine } from './match';
import { matchRating } from './match';
import { clamp } from './rng';
import { attributeCap, cardAttributes } from './ratings';
import type { Attribute, OwnedCard, PlayerProfile, Role } from './types';

/** Where a role's match experience goes (weights sum to 1). */
export const ROLE_GROWTH: Record<Role, Partial<Record<Attribute, number>>> = {
  entry: { entry: 0.45, aim: 0.35, trading: 0.2 },
  awp: { awp: 0.5, aim: 0.25, positioning: 0.25 },
  support: { utility: 0.45, teamwork: 0.3, trading: 0.25 },
  lurker: { positioning: 0.4, gameSense: 0.35, clutch: 0.25 },
  igl: { leadership: 0.45, gameSense: 0.35, utility: 0.2 },
};

/** Attribute points per map before multipliers. */
export function ratingPoints(rating: number): number {
  if (rating >= 1.15) return 0.6 + Math.min(0.4, (rating - 1.15) * 1.5);
  if (rating >= 0.95) return 0.25;
  if (rating >= 0.85) return 0.05;
  return 0;
}

export function roleFitGrowth(profile: PlayerProfile, role: Role): number {
  if (profile.record.primaryRole === role) return 1;
  if (profile.record.secondaryRole === role) return 0.7;
  return 0.4;
}

export function fatigueGrowth(fatigue: number): number {
  if (fatigue >= 80) return 0.2;
  if (fatigue >= 60) return 0.5;
  return 1;
}

export function chemistryGrowth(chemistry: number): number {
  return 0.8 + 0.4 * clamp(chemistry, 0, 100) / 100;
}

export interface MapGrowth { rating: number; gains: Partial<Record<Attribute, number>>; formDelta: number }

/** What one map does for one player. Pure: the caller adds `gains` to the card's growth. */
export function growthFromMap(profile: PlayerProfile, card: OwnedCard, role: Role, line: PlayerLine, rounds: number, chemistry: number): MapGrowth {
  const rating = matchRating(line, rounds);
  const base = ratingPoints(rating) * roleFitGrowth(profile, role) * fatigueGrowth(card.fatigue) * chemistryGrowth(chemistry);
  const weights: Partial<Record<Attribute, number>> = { ...ROLE_GROWTH[role] };
  if (rounds > 0) {
    if (line.openingKills / rounds >= 0.15) weights.entry = (weights.entry ?? 0) + 0.2;
    if (line.clutchesWon > 0) weights.clutch = (weights.clutch ?? 0) + 0.15 * Math.min(2, line.clutchesWon);
    if (line.kastRounds / rounds >= 0.75) weights.consistency = (weights.consistency ?? 0) + 0.2;
  }
  const current = cardAttributes(profile, card);
  const gains: Partial<Record<Attribute, number>> = {};
  if (base > 0) {
    for (const [attr, w] of Object.entries(weights) as [Attribute, number][]) {
      const cap = attributeCap(profile, card, attr);
      const room = Math.max(0, cap - profile.base[attr]);
      const headroom = room <= 0 ? 0 : Math.pow(clamp((cap - current[attr]) / room, 0, 1), 1.3);
      const d = Number((base * w * headroom).toFixed(2));
      if (d > 0) gains[attr] = d;
    }
  }
  const formDelta = rating >= 1.15 ? 1 : rating < 0.85 ? -1 : 0;
  return { rating, gains, formDelta };
}

/**
 * Applies a whole series to the cards that played (ids already stripped of any
 * prefix). Returns the total points each card gained, for the news line.
 */
export function applyPlayGrowth(cards: OwnedCard[], roleOf: (card: OwnedCard) => Role, profileOf: (card: OwnedCard) => PlayerProfile, maps: MapResult[], chemistry: number): Record<string, number> {
  const total: Record<string, number> = {};
  for (const m of maps) {
    const rounds = m.rounds.length;
    for (const line of m.lines) {
      const card = cards.find((c) => c.cardId === line.id);
      if (!card) continue;
      const g = growthFromMap(profileOf(card), card, roleOf(card), line, rounds, chemistry);
      for (const [a, v] of Object.entries(g.gains) as [Attribute, number][]) {
        card.growth[a] = Number(((card.growth[a] ?? 0) + v).toFixed(2));
        total[card.cardId] = (total[card.cardId] ?? 0) + v;
      }
      card.form = clamp(card.form + g.formDelta, -10, 10);
    }
  }
  return total;
}
