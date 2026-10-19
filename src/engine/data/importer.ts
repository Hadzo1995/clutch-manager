/**
 * Manual data import (CSV). Use only for data you have the right to use.
 *
 * - Validates every row and reports problems instead of guessing.
 * - Missing optional stats stay null (never invented).
 * - Duplicate ids/handles are rejected.
 * - Every record gets provenance (source name, snapshot date, sample size).
 * - Merging into a career keeps card development: cards store growth on top of
 *   base attributes, and owned players missing from the new file are kept from
 *   the old dataset (marked as not refreshed).
 */
import type { Dataset, MapName, ObservedStats, PlayerRecord, Role } from '../types';
import { MAPS, OPTIONAL_STATS, ROLES } from '../types';

export const CSV_COLUMNS = {
  required: ['rank', 'handle', 'primary_role', 'rating', 'maps_played'],
  optional: [
    'id', 'country', 'age', 'secondary_role',
    'kpr', 'dpr', 'apr', 'adr', 'kast', 'opening_kills_per_round', 'opening_success', 'awp_kill_share',
    'clutch_win_rate', 'utility_damage_per_round', 'flash_assists_per_round',
    ...MAPS.flatMap((m) => [`map_${m.toLowerCase()}_rating`, `map_${m.toLowerCase()}_maps`]),
  ],
};

const STAT_COLUMN: Record<(typeof OPTIONAL_STATS)[number], string> = {
  kpr: 'kpr', dpr: 'dpr', apr: 'apr', adr: 'adr', kast: 'kast',
  openingKillsPerRound: 'opening_kills_per_round', openingSuccess: 'opening_success', awpKillShare: 'awp_kill_share',
  clutchWinRate: 'clutch_win_rate', utilityDamagePerRound: 'utility_damage_per_round', flashAssistsPerRound: 'flash_assists_per_round',
};

/** Plausible ranges. Values outside are rejected as likely data errors. */
const RANGES: Record<string, [number, number]> = {
  rating: [0.3, 2.5], kpr: [0.2, 1.5], dpr: [0.2, 1.2], apr: [0, 0.5], adr: [20, 150], kast: [0.3, 1],
  openingKillsPerRound: [0, 0.4], openingSuccess: [0, 1], awpKillShare: [0, 1], clutchWinRate: [0, 1],
  utilityDamagePerRound: [0, 40], flashAssistsPerRound: [0, 0.5],
};

export interface ImportReport {
  ok: boolean;
  dataset?: Dataset;
  errors: string[];
  warnings: string[];
  rowCount: number;
}

/** Minimal CSV parser with quoted-field support. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function toRole(v: string | undefined): Role | null {
  const s = (v ?? '').trim().toLowerCase();
  const aliases: Record<string, Role> = { awper: 'awp', sniper: 'awp', rifler: 'entry', entry: 'entry', lurk: 'lurker', lurker: 'lurker', support: 'support', igl: 'igl', 'in-game leader': 'igl', awp: 'awp' };
  return aliases[s] ?? (ROLES.includes(s as Role) ? (s as Role) : null);
}

export function importCsv(text: string, opts: { sourceName: string; snapshotDate: string; label?: string; now?: string }): ImportReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, errors: ['The file needs a header row and at least one player row.'], warnings, rowCount: 0 };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  for (const col of CSV_COLUMNS.required) if (!header.includes(col)) errors.push(`Missing required column "${col}".`);
  if (errors.length) return { ok: false, errors, warnings, rowCount: rows.length - 1 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.snapshotDate)) errors.push('Snapshot date must look like 2026-10-01.');

  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const num = (r: string[], name: string, line: number, required: boolean, key?: string): number | null => {
    const raw = col(r, name);
    if (raw === '') {
      if (required) errors.push(`Row ${line}: "${name}" is required.`);
      return null;
    }
    const v = Number(raw.replace('%', ''));
    if (!Number.isFinite(v)) { errors.push(`Row ${line}: "${name}" is not a number (${raw}).`); return null; }
    let value = v;
    if (raw.endsWith('%')) value = v / 100;
    const range = RANGES[key ?? name];
    if (range && (value < range[0] || value > range[1])) { errors.push(`Row ${line}: "${name}" = ${raw} is outside the plausible range ${range[0]}-${range[1]}.`); return null; }
    return value;
  };

  const players: PlayerRecord[] = [];
  const seenIds = new Set<string>();
  const seenHandles = new Set<string>();
  const seenRanks = new Set<number>();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const handle = col(r, 'handle');
    if (!handle) { errors.push(`Row ${line}: handle is empty.`); return; }
    const rank = num(r, 'rank', line, true);
    const rating = num(r, 'rating', line, true);
    const mapsPlayed = num(r, 'maps_played', line, true);
    const primary = toRole(col(r, 'primary_role'));
    if (!primary) errors.push(`Row ${line}: primary_role must be one of entry, awp, support, lurker, igl.`);
    const secondaryRaw = col(r, 'secondary_role');
    const secondary = secondaryRaw ? toRole(secondaryRaw) : null;
    if (secondaryRaw && !secondary) errors.push(`Row ${line}: secondary_role "${secondaryRaw}" is not a known role.`);
    const id = col(r, 'id') || `imp-${handle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (seenIds.has(id)) errors.push(`Row ${line}: duplicate id "${id}".`);
    if (seenHandles.has(handle.toLowerCase())) errors.push(`Row ${line}: duplicate handle "${handle}".`);
    if (rank !== null && seenRanks.has(rank)) warnings.push(`Row ${line}: rank ${rank} appears more than once.`);
    seenIds.add(id); seenHandles.add(handle.toLowerCase());
    if (rank !== null) seenRanks.add(rank);

    const stats: ObservedStats = {
      rating: rating ?? 0,
      kpr: null, dpr: null, apr: null, adr: null, kast: null, openingKillsPerRound: null, openingSuccess: null,
      awpKillShare: null, clutchWinRate: null, utilityDamagePerRound: null, flashAssistsPerRound: null,
      mapRatings: {},
    };
    let missing = 0;
    for (const key of OPTIONAL_STATS) {
      const v = num(r, STAT_COLUMN[key], line, false, key);
      if (v === null) missing++;
      stats[key] = v;
    }
    if (missing > 0) warnings.push(`Row ${line} (${handle}): ${missing} optional stat(s) missing. They stay empty and lower the confidence of derived attributes.`);
    for (const m of MAPS) {
      const mr = num(r, `map_${m.toLowerCase()}_rating`, line, false, 'rating');
      const mm = num(r, `map_${m.toLowerCase()}_maps`, line, false, 'maps');
      if (mr !== null && mm !== null && mm > 0) stats.mapRatings[m as MapName] = { rating: mr, maps: mm };
    }
    const ageRaw = num(r, 'age', line, false, 'age');
    if (rank === null || rating === null || mapsPlayed === null || !primary) return;
    players.push({
      id,
      rank,
      handle,
      country: (col(r, 'country') || 'UN').toUpperCase().slice(0, 2),
      age: ageRaw !== null ? Math.round(ageRaw) : 24,
      primaryRole: primary,
      secondaryRole: secondary ?? (primary === 'support' ? 'entry' : 'support'),
      stats,
      provenance: {
        source: `manual-import:${opts.sourceName}`,
        kind: 'manual-import',
        collectedAt: (opts.now ?? new Date().toISOString()).slice(0, 10),
        snapshotDate: opts.snapshotDate,
        sampleMaps: mapsPlayed,
        confidence: Number((mapsPlayed / (mapsPlayed + 30)).toFixed(2)),
      },
    });
    if (ageRaw === null) warnings.push(`Row ${line} (${handle}): no age given, development uses a neutral age of 24.`);
  });

  if (players.length < 40 && errors.length === 0) errors.push(`Only ${players.length} valid players. The game needs at least 40 to build leagues.`);
  for (const role of ROLES) {
    if (players.filter((p) => p.primaryRole === role).length < 8 && errors.length === 0) errors.push(`At least 8 players with primary role "${role}" are needed.`);
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 50), warnings: warnings.slice(0, 50), rowCount: rows.length - 1 };
  players.sort((a, b) => a.rank - b.rank);
  const dataset: Dataset = {
    id: `import-${opts.sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${opts.snapshotDate}`,
    label: opts.label ?? `Imported: ${opts.sourceName} (snapshot ${opts.snapshotDate})`,
    version: 1,
    isSynthetic: false,
    createdAt: (opts.now ?? new Date().toISOString()).slice(0, 10),
    players,
  };
  return { ok: true, dataset, errors, warnings: warnings.slice(0, 50), rowCount: rows.length - 1 };
}

/**
 * Builds the dataset a career should use after a refresh: the new file, plus any
 * owned players the new file no longer contains (kept from the old dataset).
 */
export function mergeForCareer(next: Dataset, previous: Dataset, ownedPlayerIds: string[]): { dataset: Dataset; kept: string[] } {
  const nextIds = new Set(next.players.map((p) => p.id));
  const kept = previous.players.filter((p) => ownedPlayerIds.includes(p.id) && !nextIds.has(p.id));
  const maxRank = next.players.reduce((m, p) => Math.max(m, p.rank), 0);
  return {
    dataset: { ...next, version: next.version + previous.version, players: [...next.players, ...kept.map((p, i) => ({ ...p, rank: maxRank + i + 1 }))] },
    kept: kept.map((p) => p.handle),
  };
}

export function csvTemplate(): string {
  const header = [...CSV_COLUMNS.required, ...CSV_COLUMNS.optional];
  return header.join(',') + '\n';
}
