import {
  completeMatchday, currentSponsorOffers, dismissSeasonReview, fixtureSnapshots, humanFixture, openCase, resolvePull, runTrainingWeek, seedForFixture, signSponsor,
} from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { LEAGUE_KICKOFF, formatDate, matchDate, seasonEnd, seasonStart } from '../src/engine/calendar';
import { simulateSeries } from '../src/engine/match';
import { autoVeto } from '../src/engine/veto';
import { deserializeCareer, serializeCareer } from '../src/engine/save';
import { MAX_SQUAD } from '../src/engine/economy';
import { newCareer, world } from './helpers';

function playWeek(w: World, c: Career): Career {
  if (!c.sponsor) c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
  c = runTrainingWeek(w, c);
  const f = humanFixture(c);
  if (!f) return completeMatchday(w, c, null);
  const teams = fixtureSnapshots(w, c, f);
  return completeMatchday(w, c, simulateSeries(seedForFixture(c, f), teams, autoVeto(f.format, teams, 0), f.format));
}

describe('calendar', () => {
  it('opens season 1 on Tuesday 1 December 2026 with weekly matchdays', () => {
    expect(LEAGUE_KICKOFF).toBe('2026-12-01');
    expect(formatDate(matchDate(1, 1))).toBe('Tue 1 Dec 2026');
    expect(matchDate(1, 2)).toBe('2026-12-08');
    expect(matchDate(1, 7)).toBe('2027-01-12'); // last league round
    expect(seasonEnd(1)).toBe('2027-02-16'); // cup final, week 12
  });
  it('starts each later season after a two-week break, on the same weekday', () => {
    expect(seasonStart(2)).toBe('2027-03-09');
    expect(formatDate(seasonStart(2))).toMatch(/^Tue /);
    expect(formatDate(seasonStart(5))).toMatch(/^Tue /);
  });
});

describe('season review', () => {
  it('is written when a season ends, survives a save, and is dismissed once', () => {
    const w = world();
    let c = newCareer(21);
    for (let i = 0; i < 12; i++) {
      expect(c.seasonReview).toBeUndefined();
      c = playWeek(w, c);
    }
    expect(c.season.number).toBe(2);
    const r = c.seasonReview!;
    expect(r.season).toBe(1);
    expect(r.seen).toBe(false);
    expect(r.table).toHaveLength(8);
    expect(r.table.filter((t) => t.mine)).toHaveLength(1);
    expect(r.placement).toBe(c.history[0]!.placement);
    expect(r.prize).toBe(c.history[0]!.prize);
    expect(r.wins + r.losses).toBe(c.history[0]!.wins + c.history[0]!.losses);
    expect(r.nextDivision).toBe(c.season.division);
    expect(r.coinsAfter).toBe(c.coins);
    if (r.mvp) expect(c.cards.some((x) => x.cardId === r.mvp!.cardId)).toBe(true);
    const back = deserializeCareer(serializeCareer(c));
    expect(back.seasonReview).toEqual(r);
    const d = dismissSeasonReview(c);
    expect(d.seasonReview!.seen).toBe(true);
    expect(dismissSeasonReview(d)).toBe(d);
  });
});

describe('case inventory', () => {
  it('records every opening and settles a full-squad pull when the manager chooses', () => {
    const w = world();
    let c = newCareer(5);
    c = { ...c, coins: 100_000 };
    let n = 0;
    while (c.cards.length < MAX_SQUAD && n < 40) {
      c = openCase(w, c, 'standard').career; n++;
      expect(c.drops).toHaveLength(Math.min(n, 40));
      expect(['new', 'star', 'refund']).toContain(c.drops![0]!.result);
    }
    // Keep opening until a new player arrives with the squad full.
    while (!c.pendingPull && n < 80) { c = openCase(w, c, 'standard').career; n++; }
    expect(c.pendingPull).toBeTruthy();
    expect(c.drops![0]!.result).toBe('pending');
    expect(c.drops![0]!.playerId).toBe(c.pendingPull!.playerId);
    const pid = c.pendingPull!.playerId;
    const sold = resolvePull(w, c, 'sell-pull');
    const d = sold.drops!.find((x) => x.playerId === pid)!;
    expect(d.result).toBe('sold');
    expect(d.coins).toBeGreaterThan(0);
    expect(sold.coins - c.coins).toBe(d.coins);
  });
});

describe('team tags', () => {
  it('never gives an AI team your tag, including real orgs that share it', async () => {
    const { createCareer, createWorld, starterCoaches } = await import('../src/engine/career');
    const { realDataset } = await import('../src/engine/data/realPlayers');
    const ds = realDataset();
    if (!ds) return;
    const w = createWorld(ds);
    const tags = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) {
      const c = createCareer(w, { managerName: 'T', teamName: 'Saw Test', teamTag: 'saw', coachId: starterCoaches(w)[0]!.id, seed, today: '2026-11-01' });
      for (const t of c.season.aiTeams) { expect(t.tag).not.toBe('SAW'); tags.add(t.tag); }
    }
    expect(tags.size).toBeGreaterThan(7);
  });
});
