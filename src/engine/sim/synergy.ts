/**
 * Team synergy: how well five players work together, built from things the
 * game tracks (roles, pair familiarity, communication, map practice, coach).
 *
 * Synergy never adds aim. It changes the parts of a round that depend on
 * coordination, each with a bounded effect:
 *  - callout delay: how fast one player's sighting reaches teammates
 *  - trade response: how quickly a teammate refrags, scaled per pair
 *  - execute sync: how tightly entries and grenades are timed together
 *  - spacing: how far support players trail the entry
 *  - crossfires: whether CT holds cover the same entry from different angles
 *  - rotations: how quickly the other site reacts to a call
 */
import { clamp } from '../rng';
import type { MatchPlayer, TeamSnapshot } from '../team';
import { coordination, mapFamiliarity } from '../team';
import type { MapName, Role } from '../types';
import { ROLES } from '../types';

export interface TeamSynergy {
  /** 0..100: how well the five roles fit the players and each other. */
  roles: number;
  /** 0..100: average familiarity across the ten player pairs. */
  familiarity: number;
  /** 0..100: callouts and coordination (teamwork, IGL, coach). */
  communication: number;
  /** 0..100: shared understanding of the plan on this map. */
  tactical: number;
  /** 0..100 overall, the number shown in the HUD. */
  overall: number;
  /** Seconds before a teammate's sighting reaches the rest of the team. */
  calloutDelay: number;
  /** Spread (seconds, standard deviation) of execute timing between players. */
  executeSpread: number;
  /** Pair familiarity lookup (0..100) by MatchPlayer id. */
  pair: (a: string, b: string) => number;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Familiarity a pair has when nothing is recorded: scales with the team's chemistry. */
export function defaultPairFamiliarity(chemistry: number): number {
  return clamp(15 + chemistry * 0.6, 10, 80);
}

/** 0..100 role score: each role covered once, players in roles they know. */
export function roleSynergy(players: MatchPlayer[]): number {
  const roles = new Set<Role>(players.map((p) => p.role));
  const coverage = roles.size / ROLES.length;
  const fit = players.reduce((s, p) => s + p.roleFit, 0) / Math.max(1, players.length); // 0.88..1
  return clamp(coverage * 55 + ((fit - 0.85) / 0.15) * 45, 0, 100);
}

export function teamSynergy(team: TeamSnapshot, map: MapName): TeamSynergy {
  const ps = team.players;
  const fallback = defaultPairFamiliarity(team.chemistry);
  const pairs = team.pairs ?? {};
  const pair = (a: string, b: string) => pairs[pairKey(a, b)] ?? fallback;
  let famSum = 0, n = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { famSum += pair(ps[i]!.id, ps[j]!.id); n++; }
  const familiarity = n ? famSum / n : fallback;
  const roles = roleSynergy(ps);
  const communication = coordination(team);
  const tactical = clamp(0.6 * mapFamiliarity(team, map) + 0.4 * (team.coach?.attrs.tactics ?? 40), 0, 100);
  const overall = clamp(0.25 * roles + 0.3 * familiarity + 0.3 * communication + 0.15 * tactical, 0, 100);
  const comm01 = communication / 100, sync01 = (0.5 * familiarity + 0.3 * tactical + 0.2 * communication) / 100;
  return {
    roles: Math.round(roles), familiarity: Math.round(familiarity), communication: Math.round(communication), tactical: Math.round(tactical), overall: Math.round(overall),
    calloutDelay: 0.25 + 1.5 * (1 - (0.55 * comm01 + 0.45 * familiarity / 100)),
    executeSpread: 0.35 + 2.4 * (1 - sync01),
    pair,
  };
}
