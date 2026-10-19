/**
 * Turns a roster (cards or AI players) into the snapshot the match engine uses,
 * and computes role fit, coordination and roster validation.
 */
import { clamp } from './rng';
import { cardAttributes, fatigueFactor, sharpnessFactor } from './ratings';
import type { Attributes, Coach, MapName, OwnedCard, PlayerProfile, Role, Tactics } from './types';
import { ATTRIBUTES, MAPS, ROLES } from './types';

export interface MatchPlayer {
  id: string;
  playerId: string; // dataset player id (card id for owned cards is in id)
  handle: string;
  country: string;
  role: Role;
  roleFit: number; // 1 primary, 0.95 secondary, 0.88 off-role
  attrs: Attributes; // effective, after sharpness, fatigue, form and role fit
  mapSkill: Record<MapName, number>;
}

export interface TeamTendencies {
  t: Record<'default' | 'execute' | 'rush', number>;
  ct: Record<'standard' | 'stack' | 'retake' | 'aggro', number>;
  aSiteBias: number; // 0..1 share of T rounds that go A
}

export interface TeamSnapshot {
  id: string;
  name: string;
  tag: string;
  isHuman: boolean;
  players: MatchPlayer[];
  coach: Coach | null;
  chemistry: number; // 0..100
  mapPractice: Record<MapName, number>; // 0..100 team-level practice per map
  tactics: Tactics; // human: chosen plan. AI: starting plan, then tendencies drive it
  tendencies: TeamTendencies;
  prepBonus: number; // from tactical review against this opponent
  /** Pair familiarity 0..100 keyed by pairKey(id, id) of MatchPlayer ids; missing pairs fall back to chemistry. */
  pairs?: Record<string, number>;
}

export const ROLE_FIT = { primary: 1, secondary: 0.95, off: 0.88 };

export function roleFit(profile: PlayerProfile, role: Role): number {
  if (profile.record.primaryRole === role) return ROLE_FIT.primary;
  if (profile.record.secondaryRole === role) return ROLE_FIT.secondary;
  return ROLE_FIT.off;
}

export function effectiveAttributes(base: Attributes, opts: { sharpness: number; fatigue: number; form: number; fit: number }): Attributes {
  const mult = sharpnessFactor(opts.sharpness) * fatigueFactor(opts.fatigue) * opts.fit;
  const out = {} as Attributes;
  for (const a of ATTRIBUTES) out[a] = clamp(base[a] * mult + opts.form * 0.3, 1, 105);
  return out;
}

export function cardToMatchPlayer(profile: PlayerProfile, card: OwnedCard, role: Role): MatchPlayer {
  const fit = roleFit(profile, role);
  return {
    id: card.cardId,
    playerId: profile.record.id,
    handle: profile.record.handle,
    country: profile.record.country,
    role,
    roleFit: fit,
    attrs: effectiveAttributes(cardAttributes(profile, card), { sharpness: card.sharpness, fatigue: card.fatigue, form: card.form, fit }),
    mapSkill: profile.mapSkill,
  };
}

export function aiToMatchPlayer(profile: PlayerProfile, role: Role, sharpness: number): MatchPlayer {
  const fit = roleFit(profile, role);
  return {
    id: profile.record.id,
    playerId: profile.record.id,
    handle: profile.record.handle,
    country: profile.record.country,
    role,
    roleFit: fit,
    attrs: effectiveAttributes(profile.base, { sharpness, fatigue: 20, form: 0, fit }),
    mapSkill: profile.mapSkill,
  };
}

/**
 * How well the five play together (0..100). Chemistry, the IGL's leadership,
 * teamwork and the coach's communication all feed it.
 */
export function coordination(team: TeamSnapshot): number {
  const igl = team.players.find((p) => p.role === 'igl');
  const leadership = igl ? igl.attrs.leadership : Math.max(...team.players.map((p) => p.attrs.leadership)) * 0.7;
  const teamwork = team.players.reduce((s, p) => s + p.attrs.teamwork, 0) / team.players.length;
  const comms = team.coach ? team.coach.attrs.communication : 40;
  return clamp(0.35 * team.chemistry + 0.25 * leadership + 0.2 * teamwork + 0.2 * comms, 0, 100);
}

/** Team familiarity with a map: players' map skill plus team practice. */
export function mapFamiliarity(team: TeamSnapshot, map: MapName): number {
  const skill = team.players.reduce((s, p) => s + p.mapSkill[map], 0) / team.players.length;
  const coachBonus = team.coach && team.coach.specialtyMap === map ? 6 : 0;
  return clamp(0.6 * skill + 0.4 * team.mapPractice[map] + coachBonus, 0, 100);
}

export function teamStrength(team: TeamSnapshot): number {
  // A display number only; the engine never decides matches from it.
  const roleKey: Record<Role, (a: Attributes) => number> = {
    entry: (a) => (a.aim + a.entry + a.trading) / 3,
    awp: (a) => (a.awp * 2 + a.aim + a.positioning) / 4,
    support: (a) => (a.utility + a.trading + a.teamwork) / 3,
    lurker: (a) => (a.positioning + a.clutch + a.aim + a.gameSense) / 4,
    igl: (a) => (a.leadership + a.gameSense + a.utility) / 3,
  };
  const indiv = team.players.reduce((s, p) => s + roleKey[p.role](p.attrs), 0) / team.players.length;
  return Math.round(indiv * 0.8 + coordination(team) * 0.2);
}

export function emptyMapPractice(value = 40): Record<MapName, number> {
  const out = {} as Record<MapName, number>;
  for (const m of MAPS) out[m] = value;
  return out;
}

// ---------- Roster validation ----------

export interface LineupSlot { cardId: string; role: Role }

export interface RosterValidation { ok: boolean; errors: string[] }

export function validateLineup(lineup: LineupSlot[], ownedCards: OwnedCard[], cardPlayerId: (cardId: string) => string | undefined, coachId: string | null): RosterValidation {
  const errors: string[] = [];
  if (lineup.length !== 5) errors.push(`You need exactly 5 active players (you have ${lineup.length}).`);
  const ids = new Set<string>();
  const playerIds = new Set<string>();
  for (const slot of lineup) {
    if (!ownedCards.some((c) => c.cardId === slot.cardId)) errors.push('A lineup slot points to a card you do not own.');
    if (ids.has(slot.cardId)) errors.push('The same card is in the lineup twice.');
    ids.add(slot.cardId);
    const pid = cardPlayerId(slot.cardId);
    if (pid) {
      if (playerIds.has(pid)) errors.push('The same player is in the lineup twice.');
      playerIds.add(pid);
    }
  }
  const roles = lineup.map((s) => s.role);
  for (const r of ROLES) if (roles.filter((x) => x === r).length > 1) errors.push(`Two players are assigned the ${r} role. Each role is used once.`);
  if (!coachId) errors.push('Hire a head coach before playing.');
  return { ok: errors.length === 0, errors };
}
