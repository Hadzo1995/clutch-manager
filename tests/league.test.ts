import { describe, expect, it } from 'vitest';
import { autoLineup, humanSnapshot } from '../src/engine/career';
import {
  DEFAULT_MAX_TEAMS, FINAL_DAY, PLAYOFF_TEAMS, QF_DAY, SWISS_ROUNDS,
  buildSeason, canJoinLeague, checkEntry, cleanPrizes, dayFor, entryFor, finalPlacings, firstSeasonFor, kickoffAt, makeEntry, newLeague,
  pairSwiss, playoffMatches, prizeFor, seasonAt, seasonAwards, seasonMatches, seasonSize, settleMatch, sideFor, standings, swissMatches, verifyResult,
} from '../src/engine/league';
import type { LResult, League, LeagueSeason, LeagueSeat, LMatch } from '../src/engine/league';
import { Rng } from '../src/engine/rng';
import { newCareer, world } from './helpers';

const NOW = Date.UTC(2026, 10, 1, 10);

function league(over: Partial<Parameters<typeof newLeague>[0]> = {}): League {
  return newLeague({ id: 'LBETA1', name: 'Clutch League', ownerId: 'u0', firstSeasonStart: '2026-11-10', now: NOW, prizes: ['AWP | Asiimov', 'AK-47 | Redline', ''], ...over });
}

function seats(n: number, joinedAt = NOW): LeagueSeat[] {
  return Array.from({ length: n }, (_, i) => ({ slot: i, userId: `u${i}`, manager: `M${i}`, team: `Team ${i}`, tag: `T${i}`, joinedAt }));
}

/** A season line-up without building real teams: enough for schedule and table tests. */
function fakeSeason(size: number, season = 1): LeagueSeason {
  const managers: LeagueSeason['managers'] = {};
  for (let i = 0; i < size; i++) managers[i] = { userId: `u${i}`, manager: `M${i}`, team: `Team ${i}`, tag: `T${i}` };
  return { league: 'LBETA1', season, managers, ai: {}, size };
}

/** A made-up result where the stronger slot (lower number) usually wins. */
function fakeResult(m: LMatch, rng: Rng): LResult {
  const homeWins = rng.next() < (m.home < m.away ? 0.7 : 0.3);
  const maps = m.format === 'bo3' ? 2 : 1;
  const score: [number, number] = homeWins ? [13, rng.int(3, 11)] : [rng.int(3, 11), 13];
  return {
    matchId: m.id, maps: [], hash: m.id, teamHashes: ['a', 'b'], computedBy: 'test', computedAt: 0,
    summary: {
      winner: homeWins ? 0 : 1, mapScore: homeWins ? [maps, 0] : [0, maps],
      maps: Array.from({ length: maps }, () => ({ map: 'Mirage' as const, score, winner: (homeWins ? 0 : 1) as 0 | 1 })),
      players: [
        { id: `l${m.home}-star`, handle: `star${m.home}`, team: 0, kills: 20 + (m.home % 5), deaths: 15, adr: 80, rating: 1 + (20 - m.home) / 40 },
        { id: `l${m.away}-star`, handle: `star${m.away}`, team: 1, kills: 20 + (m.away % 5), deaths: 15, adr: 80, rating: 1 + (20 - m.away) / 40 },
      ],
    },
  };
}

/** Plays a whole season with made-up results. */
function playSeason(l: League, s: LeagueSeason, seed = 7): Record<string, LResult> {
  const rng = new Rng(seed);
  const results: Record<string, LResult> = {};
  for (let guard = 0; guard < 40; guard++) {
    const open = seasonMatches(l, s, results).filter((m) => !results[m.id]);
    if (!open.length) break;
    for (const m of open) results[m.id] = fakeResult(m, rng);
  }
  return results;
}

describe('league setup and seats', () => {
  it('holds 50 managers by default, more when the owner raises the cap', () => {
    const l = league();
    expect(l.maxTeams).toBe(DEFAULT_MAX_TEAMS);
    expect(canJoinLeague(l, seats(49), 'new')).toEqual({ ok: true, slot: 49 });
    const full = canJoinLeague(l, seats(50), 'new');
    expect(full.ok).toBe(false);
    expect(canJoinLeague({ ...l, maxTeams: 64 }, seats(50), 'new')).toEqual({ ok: true, slot: 50 });
    expect(canJoinLeague(l, seats(3), 'u1').ok).toBe(false);
  });
  it('a seat taken during a season plays from the next one', () => {
    const l = league();
    expect(firstSeasonFor(l, NOW)).toBe(1);
    expect(firstSeasonFor(l, kickoffAt(l, 1, 3))).toBe(2);
  });
  it('prize lines are trimmed and capped', () => {
    expect(cleanPrizes(['  AWP | Asiimov ', '', 'x'.repeat(200), ''])).toEqual(['AWP | Asiimov', '', 'x'.repeat(80)]);
    expect(league().prizes).toEqual(['AWP | Asiimov', 'AK-47 | Redline']);
  });
  it('seasons have at least 16 teams and an even number', () => {
    expect(seasonSize([])).toBe(16);
    expect(seasonSize([0, 1, 2])).toBe(16);
    expect(seasonSize(Array.from({ length: 49 }, (_, i) => i))).toBe(50);
    expect(seasonSize(Array.from({ length: 33 }, (_, i) => i))).toBe(34);
    expect(seasonSize([0, 40])).toBe(42); // a manager keeps a high seat number
  });
});

describe('season calendar', () => {
  it('14 Swiss nights, playoffs on days 15-17, three days off, then the next season', () => {
    const l = league();
    expect(new Date(kickoffAt(l, 1, 1)).toISOString()).toBe('2026-11-10T19:00:00.000Z');
    expect(seasonAt(l, NOW)).toEqual({ season: 1, phase: 'preseason' });
    expect(seasonAt(l, kickoffAt(l, 1, 5) + 1)).toEqual({ season: 1, phase: 'league' });
    expect(seasonAt(l, kickoffAt(l, 1, QF_DAY) + 1)).toEqual({ season: 1, phase: 'playoffs' });
    expect(seasonAt(l, kickoffAt(l, 1, FINAL_DAY) + 3_600_000)).toEqual({ season: 2, phase: 'preseason' });
    expect(seasonAt(l, kickoffAt(l, 2, 1) + 1)).toEqual({ season: 2, phase: 'league' });
    expect(dayFor(l, 1, NOW)).toBe(1);
    expect(dayFor(l, 1, kickoffAt(l, 1, 1))).toBe(2);
    expect(dayFor(l, 1, kickoffAt(l, 1, FINAL_DAY))).toBeNull();
  });
});

describe('Swiss league stage', () => {
  it('pairs without rematches where it can, backtracking when greedy pairing gets stuck', () => {
    const played = new Set(['0-1', '2-3']);
    const has = (a: number, b: number) => played.has(a < b ? `${a}-${b}` : `${b}-${a}`);
    const pairs = pairSwiss([0, 1, 2, 3], has);
    expect(pairs.every(([a, b]) => !has(a, b))).toBe(true);
    // With 1-3 also played, only 0-2 + 1-3... is blocked, so backtracking lands on 0-3 + 1-2.
    played.add('1-3');
    const p2 = pairSwiss([0, 1, 2, 3], has);
    expect(p2).toHaveLength(2);
    expect(p2.every(([a, b]) => !has(a, b))).toBe(true);
  });

  for (const size of [16, 50]) {
    it(`${size} teams: one match a night each, 14 nights, (almost) no rematches, one table`, () => {
      const l = league();
      const s = fakeSeason(size);
      const results = playSeason(l, s);
      const swiss = swissMatches(l, s, results);
      expect(swiss).toHaveLength((size / 2) * SWISS_ROUNDS);
      for (let day = 1; day <= SWISS_ROUNDS; day++) {
        const slots = swiss.filter((m) => m.day === day).flatMap((m) => [m.home, m.away]);
        expect(new Set(slots).size).toBe(size);
      }
      const pairs = swiss.map((m) => [m.home, m.away].sort((a, b) => a - b).join('-'));
      // 50 teams never meet twice; 16 teams play 14 of their 15 possible opponents, so a late night can force a rematch or two.
      expect(pairs.length - new Set(pairs).size).toBeLessThanOrEqual(size === 50 ? 0 : 4);
      const table = standings(swiss, results, size);
      expect(table).toHaveLength(size);
      expect(table.every((r) => r.played === SWISS_ROUNDS && r.points === r.wins * 3)).toBe(true);
      // Home and away stay balanced: nobody hosts more than 8 of 14.
      for (let slot = 0; slot < size; slot++) expect(swiss.filter((m) => m.home === slot).length).toBeLessThanOrEqual(8);
    });
  }

  it('the next night is only paired once every result of the night before is in', () => {
    const l = league();
    const s = fakeSeason(16);
    const rng = new Rng(3);
    const results: Record<string, LResult> = {};
    expect(swissMatches(l, s, results).map((m) => m.day)).toEqual(Array(8).fill(1));
    const day1 = swissMatches(l, s, results);
    for (const m of day1.slice(0, 7)) results[m.id] = fakeResult(m, rng);
    expect(swissMatches(l, s, results)).toHaveLength(8);
    results[day1[7]!.id] = fakeResult(day1[7]!, rng);
    expect(swissMatches(l, s, results)).toHaveLength(16);
  });

  it('playoffs: top 8 in Bo3 quarterfinals (1v8, 4v5, 2v7, 3v6), then semifinals and the final', () => {
    const l = league();
    const s = fakeSeason(16);
    const results = playSeason(l, s);
    const swiss = swissMatches(l, s, results);
    const top = standings(swiss, results, 16).slice(0, PLAYOFF_TEAMS).map((r) => r.slot);
    const po = playoffMatches(l, s, results);
    expect(po.map((m) => m.stage)).toEqual(['quarter', 'quarter', 'quarter', 'quarter', 'semi', 'semi', 'final']);
    expect(po.every((m) => m.format === 'bo3')).toBe(true);
    expect(po.slice(0, 4).map((m) => [m.home, m.away])).toEqual([[top[0], top[7]], [top[3], top[4]], [top[1], top[6]], [top[2], top[5]]]);
    expect(po[6]!.day).toBe(FINAL_DAY);
  });

  it('final placings: champion, runner-up, semifinalists, quarterfinalists, then the table; prizes follow', () => {
    const l = league();
    const s = fakeSeason(16);
    const results = playSeason(l, s);
    const placings = finalPlacings(l, s, results)!;
    expect(new Set(placings).size).toBe(16);
    const final = playoffMatches(l, s, results).find((m) => m.stage === 'final')!;
    const champ = results[final.id]!.summary.winner === 0 ? final.home : final.away;
    expect(placings[0]).toBe(champ);
    expect(prizeFor(1)).toBe(40_000);
    expect(prizeFor(8)).toBe(5_000);
    expect(prizeFor(9)).toBe(0);
    expect(finalPlacings(l, s, {})).toBeNull();
  });

  it('season awards: MVP needs 10 maps, top fragger counts kills', () => {
    const l = league();
    const s = fakeSeason(16);
    const results = playSeason(l, s);
    const { mvp, topFragger } = seasonAwards(seasonMatches(l, s, results), results);
    expect(mvp!.maps).toBeGreaterThanOrEqual(10);
    expect(mvp!.handle).toBe('star0');
    expect(topFragger).not.toBeNull();
  });
});

describe('teams and matches', () => {
  it('managers keep their seat, organisations fill the rest, fixed for the season', () => {
    const w = world();
    const l = league();
    const st = seats(3);
    st.push({ slot: 3, userId: 'late', manager: 'Late', team: 'Late', tag: 'LTE', joinedAt: kickoffAt(l, 1, 1) + 5 });
    const s = buildSeason(l, 1, st, w.profileList, w.coaches);
    expect(s.size).toBe(16);
    expect(Object.keys(s.managers).map(Number)).toEqual([0, 1, 2]);
    expect(Object.keys(s.ai)).toHaveLength(13);
    expect(s.ai[3]).toBeDefined(); // the late seat is an organisation this season
    expect(Object.values(s.ai).every((t) => t.players.length === 5 && t.players.every((p) => p.id.startsWith(`l`)))).toBe(true);
    expect(buildSeason(l, 1, st, w.profileList, w.coaches)).toEqual(s);
    expect(buildSeason(l, 2, st, w.profileList, w.coaches).managers[3]?.userId).toBe('late');
  });

  it('a manager plays with their latest lineup sent before kickoff; a result checks out in any browser', () => {
    const w = world();
    const l = league();
    const s = buildSeason(l, 1, seats(2), w.profileList, w.coaches);
    const c = newCareer(11);
    c.lineup = autoLineup(w, c);
    const snap = humanSnapshot(w, c);
    const m = swissMatches(l, s, {}).find((x) => s.managers[x.home] || s.managers[x.away])!;
    const mgr = s.managers[m.home] ? m.home : m.away;
    const early = makeEntry(mgr, `u${mgr}`, 1, 1, snap, ['Mirage', 'Inferno'], m.kickoff - 60_000);
    const late = { ...makeEntry(mgr, `u${mgr}`, 1, 1, snap, ['Nuke'], m.kickoff + 1) };
    expect(checkEntry(early).ok).toBe(true);
    expect(entryFor([early, late], mgr, m)).toBe(early);
    expect(entryFor([], mgr, m)).toBeNull();
    const home = sideFor(s, [early], m.home, m)!;
    const away = sideFor(s, [early], m.away, m)!;
    const { result } = settleMatch(l, m, home, away, 'u0', m.kickoff + 100_000);
    expect(result.summary.mapScore[0] + result.summary.mapScore[1]).toBe(1);
    expect(verifyResult(l, m, result, home, away)).toBe(true);
    expect(verifyResult(l, m, { ...result, hash: 'nope' }, home, away)).toBe(false);
  });
});
