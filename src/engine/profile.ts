/**
 * Deeper player profiles: personality (game values, no public measurement)
 * and play-style traits (labels derived from attributes and stats).
 *
 * Personality is fictional and deterministic per player id, so it stays the
 * same across data refreshes. It has real effects:
 *  - professionalism scales training gains,
 *  - temperament scales how much form swings week to week,
 *  - big-game rating shifts performance in playoff matches.
 */
import { Rng, hashString } from './rng';
import type { Attribute, PlayerProfile } from './types';

export interface Personality {
  professionalism: number; // 1..20
  temperament: number; // 1..20, high = steady
  bigGame: number; // 1..20, high = rises in playoffs
  ambition: number; // 1..20, flavour plus morale after wins
}

export const PERSONALITY_LABEL: Record<keyof Personality, string> = {
  professionalism: 'Professionalism',
  temperament: 'Temperament',
  bigGame: 'Big-game mentality',
  ambition: 'Ambition',
};

export const PERSONALITY_HELP: Record<keyof Personality, string> = {
  professionalism: 'Training gains: ±15% between 1 and 20.',
  temperament: 'Form swings: steady players change less week to week.',
  bigGame: 'Playoffs: up to ±3 on every attribute in semis and finals.',
  ambition: 'Extra morale after wins, a bigger dip after losses.',
};

export function personalityOf(playerId: string): Personality {
  const rng = new Rng(hashString('personality:' + playerId));
  const roll = () => Math.round(Math.max(1, Math.min(20, rng.normal(11, 4))));
  return { professionalism: roll(), temperament: roll(), bigGame: roll(), ambition: roll() };
}

/** Training multiplier from professionalism: 0.85 at 1, 1.0 at ~10.5, 1.15 at 20. */
export function trainingMultiplier(p: Personality): number {
  return 0.85 + ((p.professionalism - 1) / 19) * 0.3;
}

/** Form noise multiplier from temperament: 1.5 at 1, 0.6 at 20. */
export function formVolatility(p: Personality): number {
  return 1.5 - ((p.temperament - 1) / 19) * 0.9;
}

/** Attribute shift in playoff matches: -3 at 1, +3 at 20. */
export function bigGameShift(p: Personality): number {
  return Math.round(((p.bigGame - 10.5) / 9.5) * 3 * 10) / 10;
}

export function personalityWord(v: number): string {
  if (v >= 17) return 'Outstanding';
  if (v >= 13) return 'Good';
  if (v >= 9) return 'Average';
  if (v >= 5) return 'Poor';
  return 'Very poor';
}

// ---------- Traits ----------

export interface Trait {
  id: string;
  name: string;
  description: string;
  tone: 'good' | 'bad' | 'neutral';
}

interface TraitRule extends Trait {
  test: (a: Record<Attribute, number>, p: PlayerProfile) => boolean;
}

const s = (p: PlayerProfile) => p.record.stats;

const RULES: TraitRule[] = [
  { id: 'headhunter', name: 'Headhunter', description: 'Elite raw aim; wins most straight-up duels.', tone: 'good', test: (a) => a.aim >= 84 },
  { id: 'big-green', name: 'Primary AWPer', description: 'Takes the AWP on full buys and holds angles with it.', tone: 'neutral', test: (a, p) => a.awp >= 80 || (s(p).awpKillShare ?? 0) >= 0.35 },
  { id: 'door-opener', name: 'Door opener', description: 'Wins the first duel of the round more often than most.', tone: 'good', test: (a, p) => a.entry >= 82 || (s(p).openingSuccess ?? 0) >= 0.56 },
  { id: 'trade-machine', name: 'Trade machine', description: 'Punishes the enemy right after a teammate falls.', tone: 'good', test: (a) => a.trading >= 82 },
  { id: 'nade-wizard', name: 'Utility wizard', description: 'Smokes, flashes and molotovs land where they should.', tone: 'good', test: (a, p) => a.utility >= 82 || (s(p).utilityDamagePerRound ?? 0) >= 9 },
  { id: 'anchor', name: 'Site anchor', description: 'Holds a site alone and buys time for the rotate.', tone: 'good', test: (a) => a.positioning >= 82 },
  { id: 'ice-veins', name: 'Ice in the veins', description: 'Thrives when it is 1vX.', tone: 'good', test: (a, p) => a.clutch >= 84 || (s(p).clutchWinRate ?? 0) >= 0.16 },
  { id: 'shot-caller', name: 'Shot-caller', description: 'Organises the team; raises coordination as IGL.', tone: 'good', test: (a) => a.leadership >= 82 },
  { id: 'reader', name: 'Reads the game', description: 'Rotates early and is rarely caught out.', tone: 'good', test: (a) => a.gameSense >= 84 },
  { id: 'metronome', name: 'Metronome', description: 'Very little variance from map to map.', tone: 'good', test: (a) => a.consistency >= 84 },
  { id: 'streaky', name: 'Streaky', description: 'Big highs, quiet lows. More variance in duels.', tone: 'bad', test: (a) => a.consistency <= 60 },
  { id: 'lone-wolf', name: 'Lone wolf', description: 'Strong individually, weaker in team play and trades.', tone: 'bad', test: (a) => a.teamwork <= 58 && a.aim >= 72 },
  { id: 'glue', name: 'Glue player', description: 'Flashes, trades and supports others. Stats undersell them.', tone: 'good', test: (a) => a.teamwork >= 82 && a.utility >= 72 },
];

export function traitsOf(attrs: Record<Attribute, number>, profile: PlayerProfile, max = 4): Trait[] {
  const out: Trait[] = [];
  for (const r of RULES) {
    if (r.test(attrs, profile)) out.push({ id: r.id, name: r.name, description: r.description, tone: r.tone });
    if (out.length >= max) break;
  }
  return out;
}

/** Short scouting summary from the two best and the weakest attribute. */
export function scoutingLine(attrs: Record<Attribute, number>, labels: Record<Attribute, string>): string {
  const sorted = (Object.entries(attrs) as [Attribute, number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = sorted;
  const worst = sorted[sorted.length - 1]!;
  return `Best at ${labels[best![0]].toLowerCase()} and ${labels[second![0]].toLowerCase()}; weakest at ${labels[worst[0]].toLowerCase()}.`;
}
