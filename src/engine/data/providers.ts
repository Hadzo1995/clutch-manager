/**
 * Player data providers. Gameplay never talks to a data source directly: it
 * reads a normalized `Dataset`, and each provider below turns one source into
 * that shape (or explains why it can't).
 *
 * Status of each provider in this build:
 * - synthetic: working. 200 fictional players, the offline default.
 * - csv: working. A file the user has the right to use, validated by importer.ts.
 * - leetify: adapter + normalization written and unit-tested against a fixture
 *   shaped like the documented public API. It has NOT been run against the live
 *   API (no network from the build machine, and the published artifact's CSP
 *   blocks outside requests). Leetify covers players' own matchmaking games, not
 *   pro matches, so it enriches records; it cannot build a pro ranking alone.
 * - hltv: disabled on purpose. HLTV has no public API and its terms forbid
 *   scraping and commercial use, so there is no adapter that fetches from it.
 *
 * Keys are passed in at runtime and never stored in source or in saves.
 */
import type { Dataset, ObservedStats, PlayerRecord } from '../types';
import { generateSyntheticDataset } from './generateDataset';
import { importCsv } from './importer';

export type ProviderId = 'synthetic' | 'csv' | 'leetify' | 'hltv';

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  state: 'ready' | 'needs-input' | 'untested' | 'disabled';
  /** One sentence a player can read in Settings. */
  detail: string;
  /** Where the terms or docs for this source live. */
  link?: string;
}

export interface ProviderResult {
  ok: boolean;
  dataset?: Dataset;
  errors: string[];
  warnings: string[];
}

export interface PlayerDataProvider {
  readonly id: ProviderId;
  status(): ProviderStatus;
  load(): Promise<ProviderResult>;
}

export class SyntheticProvider implements PlayerDataProvider {
  readonly id = 'synthetic' as const;
  constructor(private seed?: number) {}
  status(): ProviderStatus {
    return { id: this.id, name: 'Demo players', state: 'ready', detail: '200 fictional players with generated stats. Works offline.' };
  }
  async load(): Promise<ProviderResult> {
    return { ok: true, dataset: generateSyntheticDataset(this.seed), errors: [], warnings: [] };
  }
}

export class CsvProvider implements PlayerDataProvider {
  readonly id = 'csv' as const;
  constructor(private file?: { name: string; text: string; snapshotDate: string }) {}
  status(): ProviderStatus {
    return this.file
      ? { id: this.id, name: 'Your CSV file', state: 'ready', detail: `${this.file.name}, snapshot ${this.file.snapshotDate}.` }
      : { id: this.id, name: 'Your CSV file', state: 'needs-input', detail: 'Import a file you have the right to use. Missing stats stay empty.' };
  }
  async load(): Promise<ProviderResult> {
    if (!this.file) return { ok: false, errors: ['No file chosen.'], warnings: [] };
    const r = importCsv(this.file.text, { sourceName: this.file.name, snapshotDate: this.file.snapshotDate });
    return { ok: r.ok, dataset: r.dataset, errors: r.errors, warnings: r.warnings };
  }
}

export class HltvProvider implements PlayerDataProvider {
  readonly id = 'hltv' as const;
  status(): ProviderStatus {
    return {
      id: this.id, name: 'HLTV', state: 'disabled',
      detail: 'No public API, and the site terms forbid scraping and commercial use. Use a licensed source or your own CSV.',
      link: 'https://www.hltv.org/terms',
    };
  }
  async load(): Promise<ProviderResult> {
    return { ok: false, errors: ['HLTV is disabled: no public API and its terms forbid scraping.'], warnings: [] };
  }
}

// ---------------------------------------------------------------------------
// Leetify

export const LEETIFY_BASE = 'https://api-public.cs-prod.leetify.com';

/** The subset of a Leetify `/v3/profile` response the adapter reads. Every field is optional on purpose. */
export interface LeetifyProfile {
  steam64_id?: string;
  name?: string;
  total_matches?: number;
  winrate?: number;
  rating?: { aim?: number; positioning?: number; utility?: number; clutch?: number; opening?: number; ct_leetify?: number; t_leetify?: number };
  stats?: {
    accuracy_head?: number;
    reaction_time_ms?: number;
    preaim?: number;
    ct_opening_duel_success_percentage?: number;
    t_opening_duel_success_percentage?: number;
    trade_kills_success_percentage?: number;
    flashbang_hit_foe_per_flashbang?: number;
    he_foes_damage_avg?: number;
  };
}

/** What we keep from one Leetify profile: source values as numbers, plus where and when they came from. */
export interface LeetifySnapshot {
  steam64: string;
  name: string | null;
  fetchedAt: string;
  matches: number | null;
  aim: number | null;
  positioning: number | null;
  utility: number | null;
  clutch: number | null;
  opening: number | null;
  openingDuelSuccess: number | null; // 0..1
  headshotAccuracy: number | null; // 0..1
  reactionMs: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Leetify reports percentages as 0..100 in some fields and 0..1 in others; normalise to 0..1. */
const frac = (v: unknown): number | null => {
  const n = num(v);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
};

export function normalizeLeetify(p: LeetifyProfile, fetchedAt: string): LeetifySnapshot | null {
  if (!p.steam64_id || !/^\d{17}$/.test(p.steam64_id)) return null;
  const ct = frac(p.stats?.ct_opening_duel_success_percentage);
  const t = frac(p.stats?.t_opening_duel_success_percentage);
  return {
    steam64: p.steam64_id,
    name: typeof p.name === 'string' ? p.name : null,
    fetchedAt,
    matches: num(p.total_matches),
    aim: num(p.rating?.aim),
    positioning: num(p.rating?.positioning),
    utility: num(p.rating?.utility),
    clutch: num(p.rating?.clutch),
    opening: num(p.rating?.opening),
    openingDuelSuccess: ct !== null && t !== null ? (ct + t) / 2 : ct ?? t,
    headshotAccuracy: frac(p.stats?.accuracy_head),
    reactionMs: num(p.stats?.reaction_time_ms),
  };
}

/**
 * Adds the Leetify values that mean the same thing as a game stat to a record.
 * Only fields with a direct equivalent are used (opening duel success); the rest
 * stay on the snapshot for display. Existing values are never overwritten, and
 * the provenance says the record was enriched.
 */
export function enrichWithLeetify(record: PlayerRecord, snap: LeetifySnapshot): PlayerRecord {
  const stats: ObservedStats = { ...record.stats };
  const added: string[] = [];
  if (stats.openingSuccess === null && snap.openingDuelSuccess !== null) { stats.openingSuccess = Number(snap.openingDuelSuccess.toFixed(3)); added.push('opening_success'); }
  if (!added.length) return record;
  return { ...record, stats, provenance: { ...record.provenance, source: `${record.provenance.source}+leetify(${added.join(',')}@${snap.fetchedAt.slice(0, 10)})` } };
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class LeetifyProvider {
  readonly id = 'leetify' as const;
  constructor(private opts: { apiKey?: string; fetch?: FetchLike; now?: () => string } = {}) {}

  status(): ProviderStatus {
    return {
      id: this.id, name: 'Leetify', state: 'untested',
      detail: 'Adapter written and tested offline against sample data only. Covers players\' own matchmaking games, not pro matches. Not connected in this build.',
      link: 'https://leetify.com/app/developer',
    };
  }

  /** Fetches one profile. Errors are returned, never thrown, and rate-limit responses are not retried. */
  async profile(steam64: string): Promise<{ ok: true; snapshot: LeetifySnapshot } | { ok: false; error: string }> {
    if (!/^\d{17}$/.test(steam64)) return { ok: false, error: `"${steam64}" is not a 17-digit Steam64 id.` };
    const f = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!f) return { ok: false, error: 'No network available.' };
    const headers: Record<string, string> = {};
    if (this.opts.apiKey) headers._leetify_key = this.opts.apiKey;
    try {
      const res = await f(`${LEETIFY_BASE}/v3/profile?steam64_id=${steam64}`, { headers });
      if (res.status === 429) return { ok: false, error: 'Leetify rate limit reached. Try again later.' };
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'Leetify refused the request. Check the API key.' };
      if (res.status === 404) return { ok: false, error: 'No Leetify profile for that Steam id.' };
      if (!res.ok) return { ok: false, error: `Leetify returned HTTP ${res.status}.` };
      const snap = normalizeLeetify((await res.json()) as LeetifyProfile, (this.opts.now ?? (() => new Date().toISOString()))());
      return snap ? { ok: true, snapshot: snap } : { ok: false, error: 'The response did not look like a Leetify profile.' };
    } catch (e) {
      return { ok: false, error: `Network error: ${(e as Error).message}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Cache

export interface KeyValueStore { get(key: string): string | null; set(key: string, value: string): void }

export const REFRESH_DAYS = 30;

/** Timestamped cache so a monthly refresh can tell what is stale without refetching. */
export class SnapshotCache<T> {
  constructor(private store: KeyValueStore, private prefix: string, private maxAgeDays = REFRESH_DAYS) {}
  get(key: string, now: Date = new Date()): { value: T; fetchedAt: string; stale: boolean } | null {
    try {
      const raw = this.store.get(this.prefix + key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as { value: T; fetchedAt: string };
      const age = (now.getTime() - new Date(entry.fetchedAt).getTime()) / 86400000;
      return { ...entry, stale: !(age >= 0 && age < this.maxAgeDays) };
    } catch {
      return null;
    }
  }
  put(key: string, value: T, fetchedAt: string): void {
    try { this.store.set(this.prefix + key, JSON.stringify({ value, fetchedAt })); } catch { /* storage full or blocked: cache is optional */ }
  }
}

/** Every source the game knows about, in the order Settings shows them. */
export function providerStatuses(active: Dataset): ProviderStatus[] {
  const csv = new CsvProvider().status();
  const synth = new SyntheticProvider().status();
  return [
    active.isSynthetic ? { ...synth, detail: `${synth.detail} Active now.` } : synth,
    active.isSynthetic ? csv : { ...csv, state: 'ready', detail: `Active now: ${active.label}.` },
    new LeetifyProvider().status(),
    new HltvProvider().status(),
  ];
}
