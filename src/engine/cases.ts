/**
 * Case openings. Odds are fixed per case, always shown to the player before
 * opening, and verified by tests. In the prototype every case costs in-game
 * coins only; there are no real-money purchases.
 */
import type { Rng } from './rng';
import { MAX_STARS } from './ratings';
import type { OwnedCard, PlayerProfile, Rarity, Role } from './types';
import { RARITIES } from './types';

export type CaseId = 'daily' | 'standard' | 'role' | 'premium';

export interface CaseDef {
  id: CaseId;
  name: string;
  price: number; // coins
  odds: Record<Rarity, number>; // percentages summing to 100
  needsRole: boolean;
  description: string;
}

export const CASES: Record<CaseId, CaseDef> = {
  daily: {
    id: 'daily', name: 'Daily Drop', price: 0, needsRole: false,
    odds: { legend: 0.5, elite: 4.5, gold: 20, silver: 35, bronze: 40 },
    description: 'One free case per day.',
  },
  standard: {
    id: 'standard', name: 'Scout Case', price: 600, needsRole: false,
    odds: { legend: 1, elite: 6, gold: 23, silver: 35, bronze: 35 },
    description: 'Any player from the full pool.',
  },
  role: {
    id: 'role', name: 'Role Case', price: 1000, needsRole: true,
    odds: { legend: 1, elite: 6, gold: 23, silver: 35, bronze: 35 },
    description: 'Same odds as the Scout Case, but you pick the role.',
  },
  premium: {
    id: 'premium', name: 'Major Case', price: 2200, needsRole: false,
    odds: { legend: 3, elite: 17, gold: 45, silver: 35, bronze: 0 },
    description: 'No bronze cards. Better shot at Elite and Legend.',
  },
};

/** Coins refunded when a duplicate arrives for a card already at max stars. */
export const MAXED_DUPLICATE_REFUND: Record<Rarity, number> = { bronze: 100, silver: 200, gold: 400, elite: 900, legend: 2000 };

export function rollRarity(rng: Rng, odds: Record<Rarity, number>): Rarity {
  return rng.weighted(RARITIES, (r) => odds[r]);
}

/** Picks a player for a case. Falls back to the nearest rarity if a role filter empties a tier. */
export function rollPlayer(rng: Rng, def: CaseDef, profiles: PlayerProfile[], role?: Role): PlayerProfile {
  const pool = def.needsRole && role ? profiles.filter((p) => p.record.primaryRole === role) : profiles;
  if (pool.length === 0) throw new Error('No players available for this case');
  const rarity = rollRarity(rng, def.odds);
  const order = [rarity, ...RARITIES.filter((r) => r !== rarity).sort((a, b) => Math.abs(RARITIES.indexOf(a) - RARITIES.indexOf(rarity)) - Math.abs(RARITIES.indexOf(b) - RARITIES.indexOf(rarity)))];
  for (const r of order) {
    const tier = pool.filter((p) => p.rarity === r);
    if (tier.length) return rng.pick(tier);
  }
  return rng.pick(pool);
}

export interface CaseOutcome {
  profile: PlayerProfile;
  duplicate: boolean;
  starsNow: number;
  refund: number;
  newCard?: OwnedCard;
  /** The squad was full: the pull waits in `career.pendingPull` for the manager's choice. */
  pendingFull?: boolean;
}

/**
 * Adds a pulled player to the collection. Duplicates are never wasted: they add
 * a star (raising the card's development ceiling) or, at max stars, refund coins.
 */
export function addToCollection(cards: OwnedCard[], profile: PlayerProfile, week: number, makeId: () => string): CaseOutcome {
  const existing = cards.find((c) => c.playerId === profile.record.id);
  if (existing) {
    if (existing.stars < MAX_STARS) {
      existing.stars++;
      existing.sharpness = Math.min(100, existing.sharpness + 5);
      return { profile, duplicate: true, starsNow: existing.stars, refund: 0 };
    }
    return { profile, duplicate: true, starsNow: existing.stars, refund: MAXED_DUPLICATE_REFUND[profile.rarity] };
  }
  const card: OwnedCard = {
    cardId: makeId(),
    playerId: profile.record.id,
    acquiredWeek: week,
    growth: {},
    stars: 0,
    sharpness: 60,
    fatigue: 10,
    morale: 65,
    form: 0,
    matchesPlayed: 0,
  };
  cards.push(card);
  return { profile, duplicate: false, starsNow: 0, refund: 0, newCard: card };
}
