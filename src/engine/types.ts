// Core domain types. Pure data: no React, no browser APIs.

export const ROLES = ['entry', 'awp', 'support', 'lurker', 'igl'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  entry: 'Entry',
  awp: 'AWPer',
  support: 'Support',
  lurker: 'Lurker',
  igl: 'IGL',
};

/**
 * Active Duty pool used by the game. Reported in news coverage (June-July 2026) as Cache replacing
 * Overpass for Premier Season 5; Valve's own notes were not checked. Change it here only.
 */
export const MAPS = ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust2', 'Cache'] as const;
export type MapName = (typeof MAPS)[number];

export const ATTRIBUTES = [
  'aim',
  'awp',
  'entry',
  'trading',
  'utility',
  'positioning',
  'clutch',
  'gameSense',
  'leadership',
  'consistency',
  'teamwork',
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Attributes = Record<Attribute, number>;

export const ATTRIBUTE_LABEL: Record<Attribute, string> = {
  aim: 'Aim',
  awp: 'AWP',
  entry: 'Entry',
  trading: 'Trading',
  utility: 'Utility',
  positioning: 'Positioning',
  clutch: 'Clutch',
  gameSense: 'Game sense',
  leadership: 'Leadership',
  consistency: 'Consistency',
  teamwork: 'Teamwork',
};

/**
 * How each attribute is obtained (see DATA_DICTIONARY.md).
 * observed  = computed mostly from one family of recorded stats
 * inferred  = combined from several stats with assumptions
 * fictional = a gameplay parameter with no reliable public measurement
 */
export const ATTRIBUTE_ORIGIN: Record<Attribute, 'observed' | 'inferred' | 'fictional'> = {
  aim: 'inferred',
  awp: 'observed',
  entry: 'observed',
  trading: 'inferred',
  utility: 'observed',
  positioning: 'inferred',
  clutch: 'observed',
  gameSense: 'inferred',
  leadership: 'fictional',
  consistency: 'fictional',
  teamwork: 'inferred',
};

export type Rarity = 'bronze' | 'silver' | 'gold' | 'elite' | 'legend';
/** Career tier: how good a player can ever become. Sets the hard OVR cap (TIER_CAP in ratings.ts). */
export type Tier = 'S+++' | 'S++' | 'S+' | 'S' | 'A' | 'B' | 'C';
export const RARITIES: Rarity[] = ['bronze', 'silver', 'gold', 'elite', 'legend'];

/** Where a statistic came from. Every imported stat block carries one. */
export interface Provenance {
  source: string; // e.g. "synthetic-calibrated-v1" or "manual-import:my-file.csv"
  kind: 'synthetic' | 'licensed' | 'manual-import' | 'public'; // public: real players from public sources with our own ratings
  collectedAt: string; // ISO date
  snapshotDate: string; // ISO date the ranking refers to
  sampleMaps: number;
  confidence: number; // 0..1, grows with sample size
}

/**
 * Real-world-shaped observations. Stored separately from game attributes.
 * Optional stats are null when the source doesn't provide them: they are never
 * invented. Attribute conversion treats a null as "unknown" (pool average, lower confidence).
 */
export interface ObservedStats {
  rating: number; // source rating (NOT an official HLTV rating unless licensed and labeled)
  kpr: number | null;
  dpr: number | null;
  apr: number | null;
  adr: number | null;
  kast: number | null; // 0..1
  openingKillsPerRound: number | null;
  openingSuccess: number | null; // 0..1, share of opening duels won
  awpKillShare: number | null; // 0..1, share of kills with the AWP
  clutchWinRate: number | null; // 0..1, 1vX rounds won
  utilityDamagePerRound: number | null;
  flashAssistsPerRound: number | null;
  mapRatings: Partial<Record<MapName, { rating: number; maps: number }>>;
}

export const OPTIONAL_STATS = [
  'kpr', 'dpr', 'apr', 'adr', 'kast', 'openingKillsPerRound', 'openingSuccess', 'awpKillShare',
  'clutchWinRate', 'utilityDamagePerRound', 'flashAssistsPerRound',
] as const;

export interface PlayerRecord {
  id: string; // stable internal id
  rank: number; // 1..N in the agreed ranking for this snapshot
  handle: string; // display name (fictional in the demo dataset)
  country: string; // ISO-3166 alpha-2
  age: number;
  primaryRole: Role;
  secondaryRole: Role;
  /** Real organisation from the standings snapshot (real-pro dataset only). */
  team?: string;
  stats: ObservedStats;
  provenance: Provenance;
}

export interface Dataset {
  id: string;
  label: string;
  version: number;
  isSynthetic: boolean;
  createdAt: string;
  players: PlayerRecord[];
}

/** Game-side view derived from a PlayerRecord by ratings.ts. */
export interface PlayerProfile {
  record: PlayerRecord;
  base: Attributes;
  mapSkill: Record<MapName, number>;
  ovr: number;
  rarity: Rarity;
  /** Career tier from real-world performance (HLTV as the reference where available). */
  tier: Tier;
  /** Hard OVR ceiling: the tier's cap, never below today's OVR. */
  potential: number;
  /** Per-role OVR calibration of the dataset this profile came from. */
  calib: Record<Role, { mean: number; sd: number }>;
}

/** A player card the manager owns. Development is stored as growth on top of base attributes. */
export interface OwnedCard {
  cardId: string;
  playerId: string;
  acquiredWeek: number;
  growth: Partial<Attributes>;
  stars: number; // duplicates add stars (0..5), each raises potential
  sharpness: number; // 0..100, rises when active, decays when idle
  fatigue: number; // 0..100
  morale: number; // 0..100
  form: number; // -10..10
  matchesPlayed: number;
  roleOverride?: Role;
  /** Contract with your club (added in beta; older saves get one on load). */
  contract?: import('./economy').Contract;
  /** Career totals with your team (added in v0.2; missing on older saves). */
  stats?: CardStats;
  /** Most recent matches first, capped. */
  log?: CardLogEntry[];
  /** Card OVR after each training week, oldest first, capped. */
  ovrHistory?: number[];
}

export interface CardStats {
  maps: number;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
  openingKills: number;
  openingDeaths: number;
  clutchesWon: number;
  multiKillRounds: number;
  kastRounds: number;
  utilityDamage: number;
  enemiesFlashed: number;
  ratingSum: number; // sum of per-map ratings, divide by maps
  mvps: number;
}

export interface CardLogEntry {
  season: number;
  week: number;
  opponent: string; // team tag
  map: MapName;
  won: boolean;
  score: [number, number]; // ours first
  kills: number;
  deaths: number;
  adr: number;
  rating: number;
}

export const COACH_ATTRIBUTES = [
  'tactics',
  'development',
  'mapPrep',
  'motivation',
  'adaptability',
  'communication',
] as const;
export type CoachAttribute = (typeof COACH_ATTRIBUTES)[number];

export const COACH_ATTRIBUTE_LABEL: Record<CoachAttribute, string> = {
  tactics: 'Tactics',
  development: 'Development',
  mapPrep: 'Map prep',
  motivation: 'Motivation',
  adaptability: 'Adaptability',
  communication: 'Communication',
};

export interface Coach {
  id: string;
  name: string;
  country: string;
  attrs: Record<CoachAttribute, number>;
  specialtyMap: MapName;
  hireCost: number;
  blurb: string;
}

export type TApproach = 'default' | 'execute' | 'rush';
export type CTSetup = 'standard' | 'stack' | 'retake' | 'aggro';
export type Playstyle = 'aggressive' | 'balanced' | 'passive';
/** Buy discipline: save harder for full buys, standard, or force-buy more often. */
export type EconomyPolicy = 'disciplined' | 'standard' | 'force';
/** Footstep discipline: how far players walk (silent, slow) before a spot instead of running (heard). */
export type Footsteps = 'quiet' | 'normal' | 'aggressive';

export interface Tactics {
  playstyle: Playstyle;
  tApproach: TApproach;
  ctSetup: CTSetup;
  /** Which site to overload when ctSetup is 'stack'. */
  stackSite: 'A' | 'B';
  /** Buy discipline (defaults to standard). */
  economy?: EconomyPolicy;
  /** Footstep discipline (defaults to normal). */
  footsteps?: Footsteps;
}

export const FOOTSTEPS_LABEL: Record<Footsteps, string> = { quiet: 'Quiet', normal: 'Normal', aggressive: 'Aggressive' };
export const FOOTSTEPS_TIPS: Record<Footsteps, string> = {
  quiet: 'Walk silently further into every spot, CT holds and rotations included. Rarely heard coming, but slower to arrive.',
  normal: 'Run between spots and walk the last stretch; careful players start walking earlier.',
  aggressive: 'Run almost all the way in. Faster timings, but running steps carry about 20 m and enemies who hear them get the edge.',
}

export const ECONOMY_LABEL: Record<EconomyPolicy, string> = { disciplined: 'Disciplined', standard: 'Standard', force: 'Force-happy' };
export const ECONOMY_TIPS: Record<EconomyPolicy, string> = {
  disciplined: 'Full-saves after lost rounds so the next buy is complete. Fewer half-buys, but you concede more eco rounds.',
  standard: 'Buys when the money is there, forces only when it matters.',
  force: 'Forces with pistols and SMGs more often. Can steal rounds and break their economy, but leaves you poorer.',
};

export const T_APPROACH_LABEL: Record<TApproach, string> = {
  default: 'Default',
  execute: 'Execute',
  rush: 'Rush',
};
export const CT_SETUP_LABEL: Record<CTSetup, string> = {
  standard: 'Standard',
  stack: 'Stack a site',
  retake: 'Retake',
  aggro: 'Aggressive info',
};
export const PLAYSTYLE_LABEL: Record<Playstyle, string> = {
  aggressive: 'Aggressive',
  balanced: 'Balanced',
  passive: 'Passive',
};
