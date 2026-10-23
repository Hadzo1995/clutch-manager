/**
 * Case openings. Odds are fixed per case, always shown to the player before
 * opening, and verified by tests. In the prototype every case costs in-game
 * coins only; there are no real-money purchases.
 *
 * Odds model: each case sets a chance per rarity, and rarity follows the player's tier
 * (ratings.ts RARITY_OF_TIER: Legend = S+++/S++, Elite = S+, Gold = S, Silver = A, Bronze = B).
 * Within a rarity every player is equally likely. caseTable() turns that into exact per-player
 * odds; the case screen shows that table and rollPlayer() draws from it.
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
    // Priced about 12% above what an average pull sells for straight away, so cases are never a coin loop.
    id: 'standard', name: 'Scout Case', price: 700, needsRole: false,
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

/** One rarity row of a case: its chance, the players it can give, and each player's chance. */
export interface CaseRow { rarity: Rarity; chance: number; players: PlayerProfile[]; perPlayer: number }

/**
 * Exactly what a case can drop and with what probability (percent). The rarity odds come from
 * the case; within a rarity every player is equally likely. If a rarity has no players (a role
 * case and a thin role), its share goes to the other rarities in proportion to their odds, so
 * the table always sums to 100. rollPlayer draws from this same table, so what the case screen
 * shows is what the roll does.
 */
export function caseTable(def: CaseDef, profiles: PlayerProfile[], role?: Role): CaseRow[] {
  const pool = def.needsRole && role ? profiles.filter((p) => p.record.primaryRole === role) : profiles;
  const rows = RARITIES.filter((r) => def.odds[r] > 0).map((r) => ({ rarity: r, odds: def.odds[r], players: pool.filter((p) => p.rarity === r) }));
  const live = rows.filter((r) => r.players.length > 0);
  if (!live.length) throw new Error(`${def.name} has no players to give${role ? ` for ${role}` : ''}`);
  const sum = live.reduce((s, r) => s + r.odds, 0);
  return live.map((r) => {
    const chance = (r.odds / sum) * 100;
    return { rarity: r.rarity, chance, players: [...r.players].sort((a, b) => b.ovr - a.ovr), perPlayer: chance / r.players.length };
  });
}

/** Picks a player for a case from caseTable: a rarity by its chance, then any player in it. */
export function rollPlayer(rng: Rng, def: CaseDef, profiles: PlayerProfile[], role?: Role): PlayerProfile {
  const table = caseTable(def, profiles, role);
  const row = rng.weighted(table, (r) => r.chance);
  return rng.pick(row.players);
}

/** Problems with the case definitions (odds that don't add up, negative odds); empty when fine. */
export function validateCases(): string[] {
  const out: string[] = [];
  for (const def of Object.values(CASES)) {
    const sum = RARITIES.reduce((s, r) => s + def.odds[r], 0);
    if (Math.abs(sum - 100) > 1e-9) out.push(`${def.name}: odds add up to ${sum}%, not 100%`);
    for (const r of RARITIES) if (!(def.odds[r] >= 0)) out.push(`${def.name}: ${r} odds ${def.odds[r]} are invalid`);
    if (def.price < 0) out.push(`${def.name}: negative price`);
  }
  return out;
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
