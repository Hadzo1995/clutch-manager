import { generateSyntheticDataset } from '../src/engine/data/generateDataset';
import { buildProfiles, completeness, confidenceFor } from '../src/engine/ratings';
import { ATTRIBUTES } from '../src/engine/types';
import { Rng } from '../src/engine/rng';

describe('seeded rng', () => {
  it('repeats exactly for the same seed', () => {
    const a = new Rng(5); const b = new Rng(5);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('synthetic dataset', () => {
  const ds = generateSyntheticDataset();
  it('has 200 uniquely ranked, uniquely named players', () => {
    expect(ds.players).toHaveLength(200);
    expect(new Set(ds.players.map((p) => p.id)).size).toBe(200);
    expect(new Set(ds.players.map((p) => p.handle.toLowerCase())).size).toBe(200);
    expect(ds.players.map((p) => p.rank)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });
  it('labels every record as synthetic with provenance', () => {
    expect(ds.isSynthetic).toBe(true);
    for (const p of ds.players) {
      expect(p.provenance.kind).toBe('synthetic');
      expect(p.provenance.sampleMaps).toBeGreaterThan(0);
      expect(p.provenance.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('is deterministic', () => {
    expect(generateSyntheticDataset()).toEqual(ds);
  });
  it('keeps stats in plausible ranges', () => {
    for (const p of ds.players) {
      expect(p.stats.rating).toBeGreaterThan(0.8);
      expect(p.stats.rating).toBeLessThan(1.45);
      expect(p.stats.adr!).toBeGreaterThan(55);
      expect(p.stats.kast!).toBeLessThan(0.81);
    }
  });
  it('leaves some maps missing instead of inventing them', () => {
    const withGaps = ds.players.filter((p) => Object.keys(p.stats.mapRatings).length < 7);
    expect(withGaps.length).toBe(200);
  });
});

describe('stat to attribute conversion', () => {
  const ds = generateSyntheticDataset();
  const profiles = [...buildProfiles(ds).values()];
  it('keeps every attribute inside 35..99', () => {
    for (const p of profiles) for (const a of ATTRIBUTES) {
      expect(p.base[a]).toBeGreaterThanOrEqual(35);
      expect(p.base[a]).toBeLessThanOrEqual(99);
    }
  });
  it('rarity follows tier: per role 3 legend (S+++ 1, S++ 2), 4 elite, 8 gold, 16 silver, the rest bronze', () => {
    const count = (r: string) => profiles.filter((p) => p.rarity === r).length;
    expect([count('legend'), count('elite'), count('gold'), count('silver')]).toEqual([15, 20, 40, 80]);
    expect(count('bronze')).toBe(profiles.length - 155);
  });
  it('does not let one role dominate the top of the ratings', () => {
    const top40 = [...profiles].sort((a, b) => b.ovr - a.ovr).slice(0, 40);
    const roles = new Set(top40.map((p) => p.record.primaryRole));
    expect(roles.size).toBe(5);
    for (const r of roles) expect(top40.filter((p) => p.record.primaryRole === r).length).toBeLessThanOrEqual(16);
  });
  it('treats missing stats as unknown and lowers confidence', () => {
    const p = structuredClone(ds.players[0]!);
    const before = confidenceFor(p);
    p.stats.clutchWinRate = null; p.stats.awpKillShare = null; p.stats.adr = null;
    expect(completeness(p)).toBeLessThan(1);
    expect(confidenceFor(p)).toBeLessThan(before);
    const ds2 = { ...ds, players: [p, ...ds.players.slice(1)] };
    expect(() => buildProfiles(ds2)).not.toThrow();
  });
});
