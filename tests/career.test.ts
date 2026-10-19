import {
  completeMatchday, createWorld, currentSponsorOffers, signSponsor, fixtureSnapshots, humanFixture, lineupValidation, runTrainingWeek, seedForFixture, profileOf,
} from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { simulateSeries } from '../src/engine/match';
import { autoVeto } from '../src/engine/veto';
import { deserializeCareer, serializeCareer, SaveError } from '../src/engine/save';
import { importCsv, mergeForCareer, csvTemplate } from '../src/engine/data/importer';
import { generateSyntheticDataset } from '../src/engine/data/generateDataset';
import { cardAttributes } from '../src/engine/ratings';
import { HUMAN_ID, standings } from '../src/engine/season';
import { newCareer, world } from './helpers';

function playWeek(w: World, c: Career): Career {
  if (!c.sponsor) c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
  c = runTrainingWeek(w, c);
  const f = humanFixture(c);
  if (!f) return completeMatchday(w, c, null);
  const teams = fixtureSnapshots(w, c, f);
  const maps = autoVeto(f.format, teams, 0);
  return completeMatchday(w, c, simulateSeries(seedForFixture(c, f), teams, maps, f.format));
}

describe('cup', () => {
  it('runs a cup in weeks 10-12 with guests from the division above and pays a prize', () => {
    const w = world();
    let c = newCareer(11);
    for (let week = 0; week < 9; week++) c = playWeek(w, c);
    expect(c.season.week).toBe(10);
    expect(c.season.cupTeams).toHaveLength(4);
    const qf = c.season.fixtures.filter((f) => f.stage === 'cup-qf');
    expect(qf).toHaveLength(4);
    expect(qf.some((f) => f.home === HUMAN_ID || f.away === HUMAN_ID)).toBe(true);
    // Guests don't share players with league teams or your squad.
    const used = [...c.season.aiTeams, ...c.season.cupTeams!].flatMap((t) => t.playerIds).concat(c.cards.map((x) => x.playerId));
    expect(new Set(used).size).toBe(used.length);
    for (let week = 0; week < 3; week++) c = playWeek(w, c);
    expect(c.season.number).toBe(2);
    expect(c.ledger.some((e) => e.label.startsWith('Clutch Cup'))).toBe(true);
    expect(c.news.some((n) => n.startsWith('Clutch Cup'))).toBe(true);
  });
});

describe('career loop', () => {
  it('plays two full seasons with valid state throughout', () => {
    const w = world();
    let c = newCareer(7);
    for (let week = 0; week < 24; week++) {
      expect(lineupValidation(c).ok).toBe(true);
      c = playWeek(w, c);
      expect(c.coins).toBeGreaterThanOrEqual(0);
    }
    expect(c.history).toHaveLength(2);
    expect(c.season.number).toBe(3);
    expect(c.totals.matches).toBeGreaterThanOrEqual(14);
    const table = standings(c.season);
    expect(table).toHaveLength(8);
    expect(table.some((r) => r.teamId === HUMAN_ID)).toBe(true);
  });
  it('is deterministic for the same seed and decisions', () => {
    const w = world();
    let a = newCareer(11), b = newCareer(11);
    for (let i = 0; i < 4; i++) { a = playWeek(w, a); b = playWeek(w, b); }
    expect(b).toEqual(a);
  });
  it('requires training before the match and a match before the next week', () => {
    const w = world();
    const c = newCareer();
    expect(() => completeMatchday(w, c, null)).toThrow();
    const t = runTrainingWeek(w, c);
    expect(() => runTrainingWeek(w, t)).toThrow();
    expect(() => completeMatchday(w, t, null)).toThrow(/Play your match/);
  });
});

describe('saves', () => {
  it('round-trips a career exactly', () => {
    const w = world();
    let c = newCareer(3);
    c = playWeek(w, c);
    expect(deserializeCareer(serializeCareer(c))).toEqual(c);
  });
  it('rejects garbage and newer versions with a clear error', () => {
    expect(() => deserializeCareer('not json')).toThrow(SaveError);
    expect(() => deserializeCareer(JSON.stringify({ format: 'other' }))).toThrow(SaveError);
    expect(() => deserializeCareer(JSON.stringify({ format: 'csm-save', version: 999, career: {} }))).toThrow(/newer/);
  });
  it('fills defaults for fields missing from older saves', () => {
    const c = newCareer();
    const raw = JSON.parse(serializeCareer(c));
    delete raw.career.news; delete raw.career.cards[0].stars;
    const back = deserializeCareer(JSON.stringify(raw));
    expect(back.news).toEqual([]);
    expect(back.cards[0]!.stars).toBe(0);
  });
});

function csvFromDataset(rows = 60, dropStats = false): string {
  const ds = generateSyntheticDataset(99, rows);
  const header = 'id,rank,handle,country,age,primary_role,secondary_role,rating,maps_played,kpr,dpr,adr,kast,awp_kill_share,map_mirage_rating,map_mirage_maps';
  const lines = ds.players.map((p) => [p.id, p.rank, p.handle, p.country, p.age, p.primaryRole, p.secondaryRole, p.stats.rating, p.provenance.sampleMaps,
    dropStats ? '' : p.stats.kpr, p.stats.dpr, p.stats.adr, p.stats.kast, p.stats.awpKillShare, '1.05', '12'].join(','));
  return [header, ...lines].join('\n');
}

describe('data import', () => {
  it('imports a valid CSV with provenance and leaves missing stats empty', () => {
    const rep = importCsv(csvFromDataset(200, true), { sourceName: 'my-stats.csv', snapshotDate: '2026-09-30', now: '2026-10-10' });
    expect(rep.ok).toBe(true);
    const p = rep.dataset!.players[0]!;
    expect(p.provenance.kind).toBe('manual-import');
    expect(p.provenance.source).toBe('manual-import:my-stats.csv');
    expect(p.stats.kpr).toBeNull();
    expect(p.stats.clutchWinRate).toBeNull();
    expect(rep.warnings.length).toBeGreaterThan(0);
    expect(() => createWorld(rep.dataset!)).not.toThrow();
  });
  it('rejects bad rows instead of guessing', () => {
    const bad = csvFromDataset(200).replace(/,awp,/, ',sniperx,').replace(/\n(syn-002),2,/, '\n$1,2,');
    const rep = importCsv(bad + '\nsyn-999,300,Dup,US,20,entry,support,9.9,10,,,,,,,', { sourceName: 'x', snapshotDate: '2026-09-30' });
    expect(rep.ok).toBe(false);
    expect(rep.errors.join(' ')).toMatch(/plausible range|role/);
  });
  it('requires the core columns', () => {
    const rep = importCsv('handle,rating\nabc,1.0', { sourceName: 'x', snapshotDate: '2026-09-30' });
    expect(rep.ok).toBe(false);
    expect(rep.errors.join(' ')).toMatch(/rank/);
  });
  it('a data refresh keeps card development and players missing from the new file', () => {
    const w = world();
    let c = newCareer(5);
    c = runTrainingWeek(w, c);
    const card = c.cards[0]!;
    const growthBefore = { ...card.growth };
    const merged = mergeForCareer(importCsv(csvFromDataset(200), { sourceName: 'new.csv', snapshotDate: '2026-11-01' }).dataset!, w.dataset, c.cards.map((x) => x.playerId));
    const w2 = createWorld(merged.dataset);
    expect(c.cards.every((x) => w2.profiles.has(x.playerId))).toBe(true);
    expect(c.cards[0]!.growth).toEqual(growthBefore);
    expect(() => cardAttributes(profileOf(w2, card), card)).not.toThrow();
  });
  it('ships a CSV template with the required columns', () => {
    expect(csvTemplate()).toMatch(/^rank,handle,primary_role,rating,maps_played/);
  });
});
