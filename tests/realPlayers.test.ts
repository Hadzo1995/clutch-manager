import { describe, expect, it } from 'vitest';
import { completeMatchday, createCareer, createWorld, currentSponsorOffers, humanFixture, lineupValidation, runTrainingWeek, seedForFixture, signSponsor, starterCoaches } from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { simulateSeries } from '../src/engine/match';
import { autoVeto } from '../src/engine/veto';
import { fixtureSnapshots } from '../src/engine/career';
import { REAL_DATASET_ID, realDataset } from '../src/engine/data/realPlayers';
import { ROLES } from '../src/engine/types';

function playWeek(w: World, c: Career): Career {
  if (!c.sponsor) c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
  c = runTrainingWeek(w, c);
  const f = humanFixture(c);
  if (!f) return completeMatchday(w, c, null);
  const teams = fixtureSnapshots(w, c, f);
  const maps = autoVeto(f.format, teams, 0);
  return completeMatchday(w, c, simulateSeries(seedForFixture(c, f), teams, maps, f.format));
}

describe('real players dataset', () => {
  it('validates and keeps provenance honest', () => {
    const d = realDataset()!;
    expect(d).not.toBeNull();
    expect(d.id).toBe(REAL_DATASET_ID);
    expect(d.isSynthetic).toBe(false);
    expect(d.players.length).toBe(320);
    expect(new Set(d.players.map((p) => p.id)).size).toBe(320);
    for (const r of ROLES) expect(d.players.filter((p) => p.primaryRole === r).length).toBeGreaterThanOrEqual(8);
    for (const p of d.players) {
      expect(p.provenance.kind).toBe('public');
      expect(p.provenance.source).not.toMatch(/hltv/i);
      // Only our own rating is set; no outside per-player statistics are filled in.
      expect([p.stats.kpr, p.stats.adr, p.stats.kast, p.stats.awpKillShare]).toEqual([null, null, null, null]);
    }
  });
  it('builds a world and plays a full season', () => {
    const w = createWorld(realDataset()!);
    let c = createCareer(w, { managerName: 'Test', teamName: 'Testers', teamTag: 'TST', coachId: starterCoaches(w)[0]!.id, seed: 9, today: '2026-10-10' });
    for (let week = 0; week < 12; week++) {
      expect(lineupValidation(c).ok).toBe(true);
      c = playWeek(w, c);
    }
    expect(c.season.number).toBe(2);
    expect(c.history).toHaveLength(1);
  });
});
