/**
 * Converts observed statistics into game attributes.
 *
 * Method (documented in DATA_DICTIONARY.md and BALANCING.md):
 *  1. Each stat is turned into a z-score against the loaded pool.
 *  2. Attributes combine several z-scores with configurable weights. No single
 *     stat maps directly to a skill (ADR alone is not "aim").
 *  3. Role context: supports and IGLs sacrifice frags for the team, so their
 *     aim is nudged up; AWPers' kill numbers are inflated by the weapon, so their
 *     rifle aim is nudged down.
 *  4. Shrinkage: z-scores are multiplied by a confidence factor from sample size
 *     (maps / (maps + K)), pulling small samples toward the pool average.
 *  5. Fictional parameters (leadership, consistency) are seeded per player id
 *     and clearly marked as such.
 */
import { Rng, clamp, hashString } from './rng';
import type { Attribute, Attributes, Dataset, MapName, OwnedCard, PlayerProfile, PlayerRecord, Rarity, Role, Tier } from './types';
import { HLTV_STATS } from './data/hltvStats.generated';
import { ATTRIBUTES, MAPS } from './types';

export const RATING_CONFIG = {
  attributeCenter: 70,
  attributeSpread: 8.5,
  attributeMin: 35,
  attributeMax: 99,
  shrinkageK: 30,
  roleAimAdjust: { support: 0.35, igl: 0.45, awp: -0.3, entry: 0, lurker: 0 } as Record<Role, number>,
  weights: {
    aim: { kpr: 0.35, adr: 0.25, rating: 0.25, openingSuccess: 0.15 },
    entry: { openingKillsPerRound: 0.55, openingSuccess: 0.45 },
    trading: { kast: 0.4, apr: 0.3, nonOpeningKpr: 0.3 },
    utility: { utilityDamagePerRound: 0.6, flashAssistsPerRound: 0.4 },
    positioning: { invDpr: 0.5, kast: 0.3, clutchWinRate: 0.2 },
    gameSense: { kast: 0.4, rating: 0.3, invDpr: 0.3 },
    teamwork: { apr: 0.4, flashAssistsPerRound: 0.35, kast: 0.25 },
  },
  /** Share of OVR each attribute carries, per role. Each row sums to 1. */
  ovrWeights: {
    entry: { aim: 0.25, entry: 0.25, trading: 0.15, positioning: 0.05, utility: 0.05, clutch: 0.05, gameSense: 0.1, consistency: 0.1 },
    awp: { awp: 0.35, aim: 0.15, positioning: 0.15, gameSense: 0.1, clutch: 0.1, consistency: 0.15 },
    support: { utility: 0.25, trading: 0.2, teamwork: 0.2, aim: 0.1, gameSense: 0.1, positioning: 0.05, consistency: 0.1 },
    lurker: { positioning: 0.2, clutch: 0.2, gameSense: 0.2, aim: 0.2, consistency: 0.1, trading: 0.1 },
    igl: { leadership: 0.3, gameSense: 0.25, utility: 0.1, aim: 0.1, teamwork: 0.15, consistency: 0.1 },
  } as Record<Role, Partial<Record<Attribute, number>>>,
};

type StatKey =
  | 'rating' | 'kpr' | 'dpr' | 'apr' | 'adr' | 'kast' | 'openingKillsPerRound' | 'openingSuccess'
  | 'clutchWinRate' | 'utilityDamagePerRound' | 'flashAssistsPerRound' | 'nonOpeningKpr' | 'invDpr' | 'maps';

function statValue(p: PlayerRecord, key: StatKey): number | null {
  const s = p.stats;
  switch (key) {
    case 'nonOpeningKpr': return s.kpr === null || s.openingKillsPerRound === null ? null : s.kpr - s.openingKillsPerRound;
    case 'invDpr': return s.dpr === null ? null : -s.dpr;
    case 'maps': return p.provenance.sampleMaps;
    default: return s[key];
  }
}

interface PoolStats { mean: number; sd: number }

function poolStats(players: PlayerRecord[], key: StatKey): PoolStats {
  const vals = players.map((p) => statValue(p, key)).filter((v): v is number => v !== null);
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length);
  return { mean, sd: Math.sqrt(variance) || 1 };
}

export interface RatingContext {
  pool: Record<StatKey, PoolStats>;
  mapPool: Record<MapName, PoolStats>;
}

const STAT_KEYS: StatKey[] = [
  'rating', 'kpr', 'dpr', 'apr', 'adr', 'kast', 'openingKillsPerRound', 'openingSuccess',
  'clutchWinRate', 'utilityDamagePerRound', 'flashAssistsPerRound', 'nonOpeningKpr', 'invDpr', 'maps',
];

export function buildRatingContext(players: PlayerRecord[]): RatingContext {
  const pool = {} as Record<StatKey, PoolStats>;
  for (const k of STAT_KEYS) pool[k] = poolStats(players, k);
  const mapPool = {} as Record<MapName, PoolStats>;
  for (const m of MAPS) {
    const vals = players.flatMap((p) => {
      const mr = p.stats.mapRatings[m];
      return mr ? [mr.rating - p.stats.rating] : [];
    });
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length)) || 0.05;
    mapPool[m] = { mean, sd };
  }
  return { pool, mapPool };
}

/** z-score against the pool; a missing stat counts as average (0), never as an invented value. */
function z(ctx: RatingContext, p: PlayerRecord, key: StatKey): number {
  const ps = ctx.pool[key];
  const v = statValue(p, key);
  return v === null ? 0 : (v - ps.mean) / ps.sd;
}

/** Share of the stats this player actually has (missing stats lower confidence). */
export function completeness(p: PlayerRecord): number {
  const keys = ['kpr', 'dpr', 'apr', 'adr', 'kast', 'openingKillsPerRound', 'openingSuccess', 'awpKillShare', 'clutchWinRate', 'utilityDamagePerRound', 'flashAssistsPerRound'] as const;
  return keys.filter((k) => p.stats[k] !== null).length / keys.length;
}

function combo(ctx: RatingContext, p: PlayerRecord, weights: Partial<Record<StatKey, number>>): number {
  // A record with only an overall rating (e.g. the real-pros list, which has no per-player
  // statistics) has nothing else to tell skills apart, so every skill follows that rating.
  if (completeness(p) === 0) return z(ctx, p, 'rating');
  let total = 0;
  let wsum = 0;
  for (const [k, w] of Object.entries(weights) as [StatKey, number][]) {
    total += w * z(ctx, p, k);
    wsum += w;
  }
  return wsum ? total / wsum : 0;
}

function toAttr(zScore: number, confidence: number): number {
  const c = RATING_CONFIG;
  return Math.round(clamp(c.attributeCenter + c.attributeSpread * zScore * confidence, c.attributeMin, c.attributeMax));
}

export function confidenceFor(p: PlayerRecord): number {
  // Real-pros ratings are set by us from team level, role and stars, not measured from a
  // small sample, so they are not shrunk toward the average.
  if (p.provenance.kind === 'public') return 1;
  const n = p.provenance.sampleMaps;
  return (n / (n + RATING_CONFIG.shrinkageK)) * (0.5 + 0.5 * completeness(p));
}

export function computeBaseAttributes(ctx: RatingContext, p: PlayerRecord): Attributes {
  const c = RATING_CONFIG;
  const conf = confidenceFor(p);
  const w = c.weights;
  const role = p.primaryRole;
  const seed = new Rng(hashString(p.id));

  const aimZ = combo(ctx, p, w.aim) + c.roleAimAdjust[role];
  // AWP skill: kill share with the weapon, scaled by overall impact.
  // Unknown AWP share: estimate from role only (flagged as low-confidence in the UI via completeness).
  const share = p.stats.awpKillShare ?? (role === 'awp' ? 0.5 : p.secondaryRole === 'awp' ? 0.12 : 0.02);
  const awpRaw = 33 + 58 * (clamp(share, 0, 0.8) / 0.7) * clamp(0.9 + 0.7 * (p.stats.rating - 1.0), 0.65, 1.15);
  const clutchConf = conf * 0.7; // clutches are rare events: shrink harder
  const leadership = role === 'igl'
    ? 74 + seed.int(0, 18)
    : (p.secondaryRole === 'igl' ? 60 : 38) + seed.int(0, 20);
  const consistency = 58 + seed.int(0, 22) + 6 * clamp(z(ctx, p, 'maps'), -1.5, 1.5);

  return {
    aim: toAttr(aimZ, conf),
    awp: Math.round(clamp(awpRaw, c.attributeMin, c.attributeMax)),
    entry: toAttr(combo(ctx, p, w.entry), conf),
    trading: toAttr(combo(ctx, p, w.trading), conf),
    utility: toAttr(combo(ctx, p, w.utility), conf),
    positioning: toAttr(combo(ctx, p, w.positioning), conf),
    clutch: toAttr(z(ctx, p, 'clutchWinRate'), clutchConf),
    gameSense: toAttr(combo(ctx, p, w.gameSense) + (role === 'igl' ? 0.6 : 0), conf),
    leadership: Math.round(clamp(leadership, c.attributeMin, c.attributeMax)),
    consistency: Math.round(clamp(consistency, c.attributeMin, c.attributeMax)),
    teamwork: toAttr(combo(ctx, p, w.teamwork), conf),
  };
}

export function computeMapSkill(ctx: RatingContext, p: PlayerRecord): Record<MapName, number> {
  const out = {} as Record<MapName, number>;
  for (const m of MAPS) {
    const mr = p.stats.mapRatings[m];
    if (!mr) {
      out[m] = 55; // missing data: unfamiliar map, not a fabricated stat
      continue;
    }
    const conf = mr.maps / (mr.maps + 8);
    const mz = ((mr.rating - p.stats.rating) - ctx.mapPool[m].mean) / ctx.mapPool[m].sd;
    out[m] = Math.round(clamp(72 + 6 * mz * conf + Math.min(8, mr.maps / 4), 40, 95));
  }
  return out;
}

/** Weighted attribute sum for a role, before calibration. */
export function rawOvr(attrs: Attributes, role: Role): number {
  const weights = RATING_CONFIG.ovrWeights[role];
  let total = 0;
  for (const [k, w] of Object.entries(weights) as [Attribute, number][]) total += attrs[k] * w;
  return total;
}

/**
 * OVR is calibrated per role so an AWPer's huge AWP number doesn't make every
 * AWPer look better than every IGL. Each role's raw scores are mapped onto the
 * same scale (center 76, spread 6 per standard deviation).
 */
export function ovrFor(attrs: Attributes, role: Role, calib: OvrCalibration, max = 99): number {
  const c = calib[role];
  return Math.round(clamp(76 + 6 * ((rawOvr(attrs, role) - c.mean) / c.sd), 40, max));
}

export type OvrCalibration = Record<Role, { mean: number; sd: number }>;

export function buildOvrCalibration(rows: { attrs: Attributes; role: Role }[]): OvrCalibration {
  const out = {} as OvrCalibration;
  for (const role of ['entry', 'awp', 'support', 'lurker', 'igl'] as Role[]) {
    const vals = rows.filter((r) => r.role === role).map((r) => rawOvr(r.attrs, role));
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 70;
    const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 3 : 3;
    out[role] = { mean, sd };
  }
  return out;
}

// ---------- Tiers and caps ----------

/** Tiers, best first, with the share of the player pool in each (cumulative) and the hard OVR cap. */
export const TIERS: { tier: Tier; cap: number; start: number }[] = [
  { tier: 'S+++', cap: 100, start: 86 },
  { tier: 'S++', cap: 97, start: 84 },
  { tier: 'S+', cap: 94, start: 82 },
  { tier: 'S', cap: 91, start: 80 },
  { tier: 'A', cap: 87, start: 78 },
  { tier: 'B', cap: 83, start: 75 },
  { tier: 'C', cap: 79, start: 72 },
];
/**
 * Starting OVR comes from the tier (plus a little of the player's current level within it), so
 * a card's tier and its numbers agree. The starts average out near the old pool average, so
 * attribute levels in the match engine stay where they were; only who is good moves.
 */
const TIER_START = Object.fromEntries(TIERS.map((t) => [t.tier, t.start])) as Record<Tier, number>;
const START_SPREAD = 0.35;

/**
 * Card rarity follows the tier, so a case's rarity odds are odds on real quality:
 * Legend = S+++ and S++ (15 players), Elite = S+ (20), Gold = S (40), Silver = A (80), Bronze = B.
 */
export const RARITY_OF_TIER: Record<Tier, Rarity> = { 'S+++': 'legend', 'S++': 'legend', 'S+': 'elite', S: 'gold', A: 'silver', B: 'bronze', C: 'bronze' };

export const TIER_CAP = Object.fromEntries(TIERS.map((t) => [t.tier, t.cap])) as Record<Tier, number>;

/**
 * How good a player really is, for tiering. Players with HLTV numbers (last 12 months, big
 * events) rank by that rating, pulled toward 1.00 for small samples (a 1.30 over 20 maps is not
 * a 1.30 over 200), and always above players HLTV has no big-event numbers for, who follow by
 * the dataset's own rating. HLTV is only the reference; its numbers are not shown in the game.
 */
function tierScore(p: PlayerRecord): number {
  const h = HLTV_STATS[p.id];
  if (h && h.maps > 0 && h.rating !== null) {
    const k = 40;
    return 10 + (h.rating * h.maps + 1.0 * k) / (h.maps + k);
  }
  return p.stats.rating;
}

/**
 * Skills from HLTV's attribute scores (0..100, big events, last 12 months) where we have them:
 * entry from the entrying score, AWP from the share of kills with a sniper, utility from the
 * flashbang score. Blended with the rating-based value so one number never decides a skill.
 */
function applyHltvSkills(id: string, base: Attributes): Attributes {
  const h = HLTV_STATS[id];
  if (!h) return base;
  const c = RATING_CONFIG;
  const out = { ...base };
  const fromScore = (score: number) => 35 + 0.6 * clamp(score, 0, 100);
  const mix = (cur: number, target: number) => Math.round(clamp(0.4 * cur + 0.6 * target, c.attributeMin, c.attributeMax));
  if (h.entry?.score != null) out.entry = mix(base.entry, fromScore(h.entry.score));
  if (h.flash?.score != null) out.utility = mix(base.utility, fromScore(h.flash.score));
  if (h.sniping?.killShare != null) {
    // Same curve as computeBaseAttributes uses for an AWP kill share.
    const share = h.sniping.killShare;
    const rating = h.rating ?? 1;
    out.awp = Math.round(clamp(33 + 58 * (clamp(share, 0, 0.8) / 0.7) * clamp(0.9 + 0.7 * (rating - 1.0), 0.65, 1.15), c.attributeMin, c.attributeMax));
  }
  return out;
}

/**
 * Players per role in each tier, doubling down the ladder (5, 10, 20, 40, 80 across the five
 * roles); everyone else in a role is B. C is unused for now.
 */
export const PER_ROLE: Partial<Record<Tier, number>> = { 'S+++': 1, 'S++': 2, 'S+': 4, S: 8, A: 16 };

/**
 * Tier per player id, decided per role: within each role players are ranked by HLTV (the
 * reference) and handed out by PER_ROLE, best first. Every role gets the same tier ladder.
 */
function assignTiers(records: PlayerRecord[]): Map<string, Tier> {
  const out = new Map<string, Tier>();
  const roles = [...new Set(records.map((r) => r.primaryRole))];
  for (const role of roles) {
    const ranked = records.filter((r) => r.primaryRole === role).sort((a, b) => tierScore(b) - tierScore(a) || a.rank - b.rank);
    let i = 0;
    for (const t of TIERS) {
      const k = PER_ROLE[t.tier];
      if (k === undefined) continue;
      for (const r of ranked.slice(i, i + k)) out.set(r.id, t.tier);
      i += k;
    }
    for (const r of ranked.slice(i)) out.set(r.id, 'B');
  }
  for (const r of records) if (TIER_OVERRIDES[r.handle]) out.set(r.id, TIER_OVERRIDES[r.handle]!);
  return out;
}

/** Hand-set tiers by handle, applied after the ranking (for the cases the numbers get wrong). */
export const TIER_OVERRIDES: Record<string, Tier> = {};

/** Every attribute moved by the same amount, kept inside the engine's 35..99 range. */
function shiftAttributes(a: Attributes, down: number): Attributes {
  const out = {} as Attributes;
  for (const k of ATTRIBUTES) out[k] = clamp(Math.round(a[k] - down), 35, 99);
  return out;
}

/** Hard ceiling: the tier's cap, and never below today's OVR. */
function potentialFor(tier: Tier, ovr: number): number {
  return Math.max(ovr, TIER_CAP[tier]);
}

export function buildProfiles(dataset: Dataset): Map<string, PlayerProfile> {
  const ctx = buildRatingContext(dataset.players);
  const withBase = dataset.players.map((record) => ({ record, base: applyHltvSkills(record.id, computeBaseAttributes(ctx, record)) }));
  const calib = buildOvrCalibration(withBase.map((r) => ({ attrs: r.base, role: r.record.primaryRole })));
  const prelim = withBase.map(({ record, base }) => ({
    record,
    base,
    mapSkill: computeMapSkill(ctx, record),
    ovr: ovrFor(base, record.primaryRole, calib),
    calib,
  }));
  const tiers = assignTiers(dataset.players);
  const sorted = [...prelim].sort((a, b) => b.ovr - a.ovr || a.record.rank - b.record.rank);
  const out = new Map<string, PlayerProfile>();
  const tierMean = new Map<Tier, number>();
  for (const t of TIERS) {
    const v = prelim.filter((x) => tiers.get(x.record.id) === t.tier).map((x) => x.ovr);
    tierMean.set(t.tier, v.length ? v.reduce((x, y) => x + y, 0) / v.length : 76);
  }
  sorted.forEach((pr) => {
    const tier = tiers.get(pr.record.id) ?? 'C';
    const rarity = RARITY_OF_TIER[tier];
    const target = Math.round(clamp(TIER_START[tier] + (pr.ovr - tierMean.get(tier)!) * START_SPREAD, 55, TIER_CAP[tier] - 5));
    const base = shiftAttributes(pr.base, ((pr.ovr - target) * calib[pr.record.primaryRole].sd) / 6);
    const ovr = ovrFor(base, pr.record.primaryRole, calib);
    out.set(pr.record.id, { ...pr, base, ovr, rarity, tier, potential: potentialFor(tier, ovr) });
  });
  return out;
}

// ---------- Card-level helpers (base + growth) ----------

export const MAX_STARS = 5;

/** Highest value an attribute can reach through development for this card. */
export function attributeCap(profile: PlayerProfile, card: OwnedCard, attr: Attribute): number {
  const headroom = (profile.potential - profile.ovr) * 1.8 + 3 + card.stars * 2;
  return Math.min(99, profile.base[attr] + Math.max(3, Math.round(headroom)));
}

export function cardAttributes(profile: PlayerProfile, card: OwnedCard): Attributes {
  const out = {} as Attributes;
  for (const a of ATTRIBUTES) {
    out[a] = Math.min(attributeCap(profile, card, a), profile.base[a] + (card.growth[a] ?? 0));
  }
  return out;
}

export function cardRole(profile: PlayerProfile, card: OwnedCard): Role {
  return card.roleOverride ?? profile.record.primaryRole;
}

export function cardOvr(profile: PlayerProfile, card: OwnedCard): number {
  // The tier cap is hard: training, coach and synergy can take a player up to it, never past.
  return Math.min(profile.potential, ovrFor(cardAttributes(profile, card), profile.record.primaryRole, profile.calib, 100));
}

/**
 * Sharpness multiplier on match performance. An idle card loses sharpness,
 * which is how an actively developed player can outplay a stronger idle card (C22).
 */
export function sharpnessFactor(sharpness: number): number {
  return 0.88 + 0.15 * clamp(sharpness, 0, 100) / 100;
}

export function fatigueFactor(fatigue: number): number {
  return fatigue <= 40 ? 1 : 1 - 0.0025 * (fatigue - 40); // 100 fatigue -> 0.85
}

/** OVR the card actually plays at right now. */
export function effectiveOvr(profile: PlayerProfile, card: OwnedCard): number {
  return Math.round(cardOvr(profile, card) * sharpnessFactor(card.sharpness) * fatigueFactor(card.fatigue) + card.form * 0.3);
}
