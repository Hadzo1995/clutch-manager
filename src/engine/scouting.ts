/**
 * Scouting maths for the player dossier: each match-engine skill ranked against
 * a pool of players. Pure functions so the numbers in the profile are testable.
 */
import { combatProfile } from './sim/combat';
import type { CombatProfile } from './sim/combat';
import type { Attributes } from './types';

export type Skill = keyof CombatProfile;

export interface SkillRank { k: Skill; v: number; pc: number }

/** Sorted skill values across a pool, built once per pool. */
export function skillPool(pool: Attributes[]): Record<Skill, number[]> {
  const out = {} as Record<Skill, number[]>;
  for (const a of pool) {
    const cp = combatProfile(a);
    for (const k of Object.keys(cp) as Skill[]) (out[k] ??= []).push(cp[k]);
  }
  for (const k of Object.keys(out) as Skill[]) out[k].sort((x, y) => x - y);
  return out;
}

/** Share of the pool (0..100) strictly below this value. */
export function percentile(sorted: number[], v: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid]! < v) lo = mid + 1; else hi = mid; }
  return Math.round((lo / Math.max(1, sorted.length)) * 100);
}

/**
 * Every skill with its value and percentile, best first. Sniping only counts
 * for players who AWP (primary or secondary role), otherwise it would dominate
 * riflers' weaknesses for no reason.
 */
export function skillRanks(attrs: Attributes, pool: Record<Skill, number[]>, awps: boolean): SkillRank[] {
  const cp = combatProfile(attrs);
  return (Object.keys(cp) as Skill[])
    .filter((k) => k !== 'sniping' || awps)
    .map((k) => ({ k, v: cp[k], pc: percentile(pool[k] ?? [], cp[k]) }))
    .sort((a, b) => b.pc - a.pc || b.v - a.v);
}
