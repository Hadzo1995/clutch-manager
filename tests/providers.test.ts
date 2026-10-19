import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/leetify-profile.json';
import {
  CsvProvider, HltvProvider, LeetifyProvider, SnapshotCache, SyntheticProvider, enrichWithLeetify, normalizeLeetify, providerStatuses,
} from '../src/engine/data/providers';
import type { LeetifyProfile } from '../src/engine/data/providers';
import { csvTemplate } from '../src/engine/data/importer';

const fixture = fixtureJson as LeetifyProfile;
const NOW = '2026-10-10T12:00:00.000Z';

describe('providers', () => {
  it('synthetic provider loads 200 fictional players', async () => {
    const r = await new SyntheticProvider().load();
    expect(r.ok).toBe(true);
    expect(r.dataset!.players).toHaveLength(200);
    expect(r.dataset!.players.every((p) => p.provenance.kind === 'synthetic')).toBe(true);
  });

  it('csv provider asks for a file and reports validation errors', async () => {
    expect(new CsvProvider().status().state).toBe('needs-input');
    const r = await new CsvProvider({ name: 'empty.csv', text: csvTemplate(), snapshotDate: '2026-10-01' }).load();
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('hltv is disabled and never fetches', async () => {
    expect(new HltvProvider().status().state).toBe('disabled');
    expect((await new HltvProvider().load()).ok).toBe(false);
  });

  it('normalizes a leetify profile fixture', () => {
    const s = normalizeLeetify(fixture, NOW)!;
    expect(s.steam64).toBe('76561190000000001');
    expect(s.openingDuelSuccess).toBeCloseTo(0.51, 5);
    expect(s.headshotAccuracy).toBeCloseTo(0.215, 5);
    expect(s.aim).toBe(71.2);
    expect(normalizeLeetify({ ...fixture, steam64_id: 'abc' }, NOW)).toBeNull();
    expect(normalizeLeetify({ steam64_id: '76561190000000001' }, NOW)!.openingDuelSuccess).toBeNull();
  });

  it('enrichment fills only empty matching stats and records the source', async () => {
    const ds = (await new SyntheticProvider().load()).dataset!;
    const rec = { ...ds.players[0]!, stats: { ...ds.players[0]!.stats, openingSuccess: null } };
    const out = enrichWithLeetify(rec, normalizeLeetify(fixture, NOW)!);
    expect(out.stats.openingSuccess).toBeCloseTo(0.51, 3);
    expect(out.stats.rating).toBe(rec.stats.rating);
    expect(out.provenance.source).toContain('leetify(opening_success@2026-10-10)');
    const untouched = enrichWithLeetify(ds.players[0]!, normalizeLeetify(fixture, NOW)!);
    expect(untouched).toBe(ds.players[0]);
  });

  it('leetify client sends the key as a header and maps HTTP errors', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const ok = new LeetifyProvider({ apiKey: 'test-key', now: () => NOW, fetch: async (url, init) => { calls.push({ url, headers: init?.headers }); return { ok: true, status: 200, json: async () => fixture }; } });
    const r = await ok.profile('76561190000000001');
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=76561190000000001');
    expect(calls[0]!.headers?._leetify_key).toBe('test-key');
    for (const [status, text] of [[429, 'rate limit'], [401, 'API key'], [404, 'No Leetify profile'], [500, 'HTTP 500']] as const) {
      const p = new LeetifyProvider({ fetch: async () => ({ ok: false, status, json: async () => ({}) }) });
      const e = await p.profile('76561190000000001');
      expect(e.ok).toBe(false);
      if (!e.ok) expect(e.error).toContain(text);
    }
    const bad = await new LeetifyProvider({ fetch: async () => { throw new Error('offline'); } }).profile('76561190000000001');
    expect(bad.ok).toBe(false);
    expect((await ok.profile('123')).ok).toBe(false);
  });

  it('cache marks entries stale after the refresh window', () => {
    const mem = new Map<string, string>();
    const cache = new SnapshotCache<number>({ get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) }, 'x:', 30);
    cache.put('a', 5, '2026-09-01T00:00:00Z');
    expect(cache.get('a', new Date('2026-09-20T00:00:00Z'))).toMatchObject({ value: 5, stale: false });
    expect(cache.get('a', new Date('2026-10-05T00:00:00Z'))!.stale).toBe(true);
    expect(cache.get('missing')).toBeNull();
    mem.set('x:broken', '{');
    expect(cache.get('broken')).toBeNull();
  });

  it('lists every provider with an honest state', async () => {
    const ds = (await new SyntheticProvider().load()).dataset!;
    const st = providerStatuses(ds);
    expect(st.map((s) => s.id)).toEqual(['synthetic', 'csv', 'leetify', 'hltv']);
    expect(st.find((s) => s.id === 'leetify')!.state).toBe('untested');
  });
});
