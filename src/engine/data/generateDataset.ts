/**
 * Synthetic demo dataset: 200 fictional players ranked 1..200.
 *
 * No real player's name or statistics are used. Values are generated from
 * distributions calibrated by hand to look like what top-200 professional
 * play typically produces (e.g. ratings roughly 0.95-1.30, ADR roughly 68-90).
 * Those ranges are general domain knowledge, not copied data, and every record
 * is labeled `kind: 'synthetic'` so it can never be mistaken for real stats.
 *
 * The importer (importer.ts) can replace this dataset with stats the developer
 * has the right to use; gameplay code never cares which one is loaded.
 */
import { Rng, clamp } from '../rng';
import type { Dataset, MapName, ObservedStats, PlayerRecord, Role } from '../types';
import { MAPS } from '../types';

export const SYNTHETIC_SNAPSHOT_DATE = '2026-10-01';
const SYNTHETIC_SOURCE = 'synthetic-calibrated-v1';

const COUNTRIES: [string, number][] = [
  ['RU', 14], ['UA', 8], ['DK', 9], ['SE', 8], ['FR', 9], ['BR', 12], ['US', 7], ['CA', 3],
  ['FI', 5], ['PL', 7], ['DE', 4], ['KZ', 4], ['BA', 3], ['RS', 3], ['LV', 3], ['EE', 2],
  ['CZ', 3], ['SK', 2], ['IL', 2], ['TR', 4], ['MN', 4], ['AU', 4], ['CN', 3], ['NO', 2],
  ['BE', 2], ['PT', 3], ['ES', 2], ['AR', 4], ['CL', 1], ['ZA', 1], ['BY', 3], ['LT', 2],
  ['UZ', 1], ['HU', 2], ['BG', 2], ['NL', 1], ['GB', 2], ['RO', 1], ['MK', 1], ['ME', 1],
];

const SYL_A = ['va', 'kr', 'zy', 'ne', 'tor', 'mi', 'ra', 'sh', 'lo', 'fe', 'qu', 'do', 'ri', 'ka', 'jo', 'xe', 'bl', 'st', 'gr', 'ze', 'ha', 'vo', 'ny', 'pe', 'sk', 'ul', 'ta', 'bo', 'ce', 'ix'];
const SYL_B = ['ex', 'on', 'yr', 'ak', 'is', 'ul', 'en', 'ox', 'ia', 'ar', 'el', 'um', 'iz', 'et', 'av', 'or', 'ik', 'ey', 'an', 'ux'];
const SYL_C = ['', '', '', 'a', 'o', 'y', 'ie', 'z', 'x', 'k', 'n', 'r', 's', 'h', 'q'];

/**
 * Handles that belong to well-known real players. The generator re-rolls if it
 * ever produces one, so a demo name can't be mistaken for a real person.
 */
const BLOCKED_HANDLES = new Set(
  [
    's1mple', 'zywoo', 'niko', 'm0nesy', 'donk', 'device', 'ropz', 'twistzz', 'electronic', 'b1t',
    'sh1ro', 'ax1le', 'jl', 'broky', 'frozen', 'xantares', 'blamef', 'spinx', 'jimpphat', 'xertion',
    'karrigan', 'apex', 'magisk', 'hunter', 'stavn', 'cadian', 'xyp9x', 'dupreeh', 'kennys', 'shox',
    'flamez', 'iM', 'w0nderful', 'mezii', 'siuhy', 'torzsi', 'hooxi', 'nexa', 'snax', 'olofmeister',
    'f0rest', 'getright', 'coldzera', 'fallen', 'fer', 'taco', 'kscerato', 'yuurih', 'art', 'naf',
    'elige', 'stewie2k', 'nitr0', 'tarik', 'skadoodle', 'gla1ve', 'perfecto', 'boombl4', 'hobbit',
    'jame', 'qikert', 'malbsmd', 'senzu', 'mzinho', 'jkaem', 'aleksib', 'sunpayus', 'brollan', 'jks',
  ].map((h) => h.toLowerCase()),
);

function makeHandle(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    let h = rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C);
    if (rng.chance(0.25)) h += rng.pick(SYL_B);
    if (rng.chance(0.12)) h = h.replace(/o/, '0');
    if (rng.chance(0.08)) h = h.replace(/i/, '1');
    if (h.length < 3 || h.length > 9) continue;
    const style = rng.next();
    if (style < 0.45) h = h[0]!.toUpperCase() + h.slice(1);
    else if (style < 0.55) h = h.toUpperCase();
    else if (style < 0.65) h = h.slice(0, -1) + h.slice(-1).toUpperCase();
    const key = h.toLowerCase();
    if (BLOCKED_HANDLES.has(key) || used.has(key)) continue;
    used.add(key);
    return h;
  }
  throw new Error('Could not generate a unique handle');
}

const ROLE_RATING_SHIFT: Record<Role, number> = { awp: 0.03, entry: -0.01, lurker: 0.0, support: -0.03, igl: -0.07 };

function chooseRoles(rng: Rng, rank: number): [Role, Role] {
  // Stars skew toward AWP/entry/lurk; IGLs and supports skew lower in individual rankings.
  const q = 1 - (rank - 1) / 199;
  const primary = rng.weighted<Role>(['entry', 'awp', 'support', 'lurker', 'igl'], (r) => {
    switch (r) {
      case 'awp': return 0.9 + 0.6 * q;
      case 'entry': return 1.0 + 0.3 * q;
      case 'lurker': return 0.9 + 0.2 * q;
      case 'support': return 1.1 - 0.3 * q;
      case 'igl': return 1.1 - 0.7 * q;
    }
  });
  const secondaryOptions: Record<Role, Role[]> = {
    entry: ['support', 'lurker'],
    awp: ['lurker', 'support', 'igl'],
    support: ['entry', 'igl', 'lurker'],
    lurker: ['entry', 'awp', 'support'],
    igl: ['support', 'lurker', 'awp'],
  };
  return [primary, rng.pick(secondaryOptions[primary])];
}

function generateStats(rng: Rng, rank: number, primary: Role, secondary: Role, sampleMaps: number): ObservedStats {
  const q = 1 - (rank - 1) / 199;
  const rating = clamp(0.96 + 0.32 * Math.pow(q, 1.35) + ROLE_RATING_SHIFT[primary] + rng.normal(0, 0.025), 0.82, 1.42);

  const kprShift: Record<Role, number> = { awp: 0.02, entry: 0.01, lurker: 0, support: -0.03, igl: -0.03 };
  const dprShift: Record<Role, number> = { awp: -0.04, entry: 0.04, lurker: -0.01, support: 0.01, igl: 0.01 };
  const aprBase: Record<Role, number> = { support: 0.17, igl: 0.15, entry: 0.13, awp: 0.07, lurker: 0.11 };
  const adrShift: Record<Role, number> = { entry: 3, awp: -4, support: -2, lurker: 0, igl: -1 };
  const opkBase: Record<Role, number> = { entry: 0.13, awp: 0.12, lurker: 0.08, support: 0.06, igl: 0.07 };
  const utilBase: Record<Role, number> = { support: 8.5, igl: 7, entry: 6, lurker: 5, awp: 3 };
  const flashBase: Record<Role, number> = { support: 0.07, igl: 0.06, entry: 0.035, lurker: 0.03, awp: 0.02 };

  const kpr = clamp(0.35 + 0.33 * rating + kprShift[primary] + rng.normal(0, 0.015), 0.5, 0.95);
  const dpr = clamp(0.95 - 0.27 * rating + dprShift[primary] + rng.normal(0, 0.012), 0.5, 0.78);
  const apr = clamp(aprBase[primary] + rng.normal(0, 0.015), 0.04, 0.24);
  const adr = clamp(40 + 37 * rating + adrShift[primary] + rng.normal(0, 2.2), 58, 100);
  const kast = clamp(0.6 + 0.11 * rating + (primary === 'support' ? 0.01 : 0) + rng.normal(0, 0.01), 0.62, 0.8);
  const openingKillsPerRound = clamp(opkBase[primary] * (0.75 + 0.3 * rating) + rng.normal(0, 0.008), 0.03, 0.2);
  const openingSuccess = clamp(
    0.42 + 0.13 * ((rating - 0.9) / 0.4) + (primary === 'awp' ? 0.06 : 0) + (primary === 'entry' ? -0.03 : 0) + rng.normal(0, 0.025),
    0.3, 0.7,
  );
  let awpKillShare: number;
  if (primary === 'awp') awpKillShare = clamp(rng.normal(0.64, 0.06), 0.45, 0.8);
  else if (secondary === 'awp') awpKillShare = clamp(rng.normal(0.18, 0.05), 0.06, 0.32);
  else awpKillShare = clamp(rng.normal(0.025, 0.015), 0, 0.08);
  const clutchWinRate = clamp(0.08 + 0.08 * ((rating - 0.9) / 0.4) + (primary === 'lurker' ? 0.03 : 0) + rng.normal(0, 0.02), 0.02, 0.25);
  const utilityDamagePerRound = clamp(utilBase[primary] + rng.normal(0, 1.1), 1, 14);
  const flashAssistsPerRound = clamp(flashBase[primary] + rng.normal(0, 0.008), 0.005, 0.12);

  // Each player has a 5-6 map pool; the rest are missing on purpose (exercises missing-data handling).
  const poolSize = rng.chance(0.6) ? 6 : 5;
  const mapPool = rng.shuffle(MAPS).slice(0, poolSize);
  const mapRatings: Partial<Record<MapName, { rating: number; maps: number }>> = {};
  const shares = mapPool.map(() => rng.range(0.6, 1.4));
  const shareSum = shares.reduce((a, b) => a + b, 0);
  mapPool.forEach((m, i) => {
    const maps = Math.max(2, Math.round((sampleMaps * (shares[i] as number)) / shareSum));
    mapRatings[m] = { rating: Number(clamp(rating + rng.normal(0, 0.07), 0.7, 1.6).toFixed(2)), maps };
  });

  return {
    rating: Number(rating.toFixed(2)),
    kpr: Number(kpr.toFixed(2)),
    dpr: Number(dpr.toFixed(2)),
    apr: Number(apr.toFixed(2)),
    adr: Number(adr.toFixed(1)),
    kast: Number(kast.toFixed(3)),
    openingKillsPerRound: Number(openingKillsPerRound.toFixed(3)),
    openingSuccess: Number(openingSuccess.toFixed(3)),
    awpKillShare: Number(awpKillShare.toFixed(3)),
    clutchWinRate: Number(clutchWinRate.toFixed(3)),
    utilityDamagePerRound: Number(utilityDamagePerRound.toFixed(1)),
    flashAssistsPerRound: Number(flashAssistsPerRound.toFixed(3)),
    mapRatings,
  };
}

export function generateSyntheticDataset(seed = 20261001, count = 200): Dataset {
  const rng = new Rng(seed);
  const used = new Set<string>();
  const players: PlayerRecord[] = [];
  for (let rank = 1; rank <= count; rank++) {
    const [primaryRole, secondaryRole] = chooseRoles(rng, rank);
    const q = 1 - (rank - 1) / Math.max(1, count - 1);
    const sampleMaps = Math.round(clamp(rng.normal(55 + 60 * q, 18), 18, 160));
    const age = Math.round(clamp(rng.normal(23.5, 3), 16, 34));
    players.push({
      id: `syn-${String(rank).padStart(3, '0')}`,
      rank,
      handle: makeHandle(rng, used),
      country: rng.weighted(COUNTRIES, (c) => c[1])[0],
      age,
      primaryRole,
      secondaryRole,
      stats: generateStats(rng, rank, primaryRole, secondaryRole, sampleMaps),
      provenance: {
        source: SYNTHETIC_SOURCE,
        kind: 'synthetic',
        collectedAt: SYNTHETIC_SNAPSHOT_DATE,
        snapshotDate: SYNTHETIC_SNAPSHOT_DATE,
        sampleMaps,
        confidence: Number((sampleMaps / (sampleMaps + 30)).toFixed(2)),
      },
    });
  }
  return {
    id: 'synthetic-top200',
    label: 'Demo dataset: 200 fictional players (synthetic stats)',
    version: 1,
    isSynthetic: true,
    createdAt: SYNTHETIC_SNAPSHOT_DATE,
    players,
  };
}
