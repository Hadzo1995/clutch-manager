import { describe, expect, it } from 'vitest';
import { autoLineup, humanSnapshot, profileOf, starterCoaches } from '../src/engine/career';
import { growthFromMap, ratingPoints } from '../src/engine/growth';
import { applyMatch, closeSeason, createLeagueClub, startSeason, trainToday, canTrainToday, restOvernight } from '../src/engine/lclub';
import type { LeagueClub } from '../src/engine/lclub';
import { buildSeason, makeEntry, newLeague, settleMatch, sideFor, swissMatches } from '../src/engine/league';
import type { PlayerLine } from '../src/engine/match';
import { cardAttributes } from '../src/engine/ratings';
import { world } from './helpers';

const NOW = Date.UTC(2026, 10, 1, 10);
const l = newLeague({ id: 'LBETA1', name: 'Clutch League', ownerId: 'u0', firstSeasonStart: '2026-11-10', now: NOW, prizes: ['AWP | Asiimov'] });

function club(): LeagueClub {
  const w = world();
  const c = createLeagueClub(w, l, 0, 1, { manager: 'Amar', team: 'Nova', tag: 'NVA', coachId: starterCoaches(w)[0]!.id, today: '2026-11-09', seed: 99 });
  c.lineup = autoLineup(w, c);
  return c;
}

function line(over: Partial<PlayerLine>): PlayerLine {
  return { id: 'x', handle: 'x', kills: 0, deaths: 0, assists: 0, damage: 0, headshots: 0, openingKills: 0, openingDeaths: 0, clutchesWon: 0, multiKillRounds: 0, kastRounds: 0, utilityDamage: 0, enemiesFlashed: 0, ...over } as PlayerLine;
}

describe('growth from playing well', () => {
  it('a great map grows the role’s attributes, a poor one grows nothing and costs form', () => {
    const w = world();
    const c = club();
    const card = c.cards.find((x) => x.cardId === c.lineup[0]!.cardId)!;
    const p = profileOf(w, card);
    const role = p.record.primaryRole;
    const great = growthFromMap(p, card, role, line({ kills: 30, deaths: 12, damage: 2600, kastRounds: 19, openingKills: 5, clutchesWon: 1, multiKillRounds: 5 }), 22, 70);
    const poor = growthFromMap(p, card, role, line({ kills: 6, deaths: 18, damage: 800, kastRounds: 9 }), 22, 70);
    expect(great.rating).toBeGreaterThan(1.15);
    expect(Object.values(great.gains).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(0.4);
    expect(great.formDelta).toBe(1);
    expect(poor.rating).toBeLessThan(0.85);
    expect(poor.gains).toEqual({});
    expect(poor.formDelta).toBe(-1);
    // Off-role and exhausted players gain far less from the same map.
    const offRole = (['entry', 'awp', 'support', 'lurker', 'igl'] as const).find((r) => r !== p.record.primaryRole && r !== p.record.secondaryRole)!;
    const tired = growthFromMap(p, { ...card, fatigue: 90 }, offRole, line({ kills: 30, deaths: 12, damage: 2600, kastRounds: 19, openingKills: 5, clutchesWon: 1, multiKillRounds: 5 }), 22, 70);
    const sum = (g: typeof great.gains) => Object.values(g).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum(tired.gains)).toBeLessThan(sum(great.gains) * 0.2);
    expect(ratingPoints(1.0)).toBeLessThan(ratingPoints(1.2));
  });
});

describe('league club through a season', () => {
  it('plays a match, grows from it, closes the season with its prize, and resets to baseline next season', () => {
    const w = world();
    let c = club();
    const s = buildSeason(l, 1, [{ slot: 0, userId: 'u0', manager: 'Amar', team: 'Nova', tag: 'NVA', joinedAt: NOW }], w.profileList, w.coaches);
    const m = swissMatches(l, s, {}).find((x) => x.home === 0 || x.away === 0)!;
    const e = makeEntry(0, 'u0', 1, 1, humanSnapshot(w, c), [], m.kickoff - 1000);
    const { series } = settleMatch(l, m, sideFor(s, [e], m.home, m)!, sideFor(s, [e], m.away, m)!, 'u0', m.kickoff + 100_000);
    const before = c.cards.reduce((t, card) => t + Object.values(card.growth).reduce((a, b) => a + (b ?? 0), 0), 0);
    c = applyMatch(w, c, m, series, 'Opp', 'OPP');
    expect(applyMatch(w, c, m, series, 'Opp', 'OPP')).toBe(c); // once per match
    expect(c.totals.matches).toBe(1);
    expect(c.cards.filter((x) => x.stats?.maps).length).toBe(5);
    const after = c.cards.reduce((t, card) => t + Object.values(card.growth).reduce((a, b) => a + (b ?? 0), 0), 0);
    expect(after).toBeGreaterThanOrEqual(before);

    const coins = c.coins;
    c = closeSeason(c, l, 1, 1, 16);
    expect(c.coins).toBe(coins + 40_000);
    expect(c.league.trophies).toEqual([{ season: 1, place: 1, teams: 16, coins: 40_000, prize: 'AWP | Asiimov' }]);
    expect(closeSeason(c, l, 1, 1, 16)).toBe(c);

    c.cards[0]!.growth = { aim: 5 };
    const reset = startSeason(c, 2);
    expect(reset.cards.every((x) => Object.keys(x.growth).length === 0)).toBe(true);
    expect(reset.league.season).toBe(2);
    expect(reset.coins).toBe(c.coins);
    expect(reset.league.trophies).toHaveLength(1);
    expect(cardAttributes(profileOf(w, reset.cards[0]!), reset.cards[0]!)).toEqual(profileOf(w, reset.cards[0]!).base);
    expect(startSeason(reset, 2)).toBe(reset);
  });

  it('trains once a day and rests overnight', () => {
    const w = world();
    let c = club();
    expect(canTrainToday(c, '2026-11-10')).toBe(true);
    c = trainToday(w, c, '2026-11-10');
    expect(canTrainToday(c, '2026-11-10')).toBe(false);
    expect(() => trainToday(w, c, '2026-11-10')).toThrow();
    c = restOvernight(c, '2026-11-10');
    c.cards[0]!.fatigue = 50;
    c = restOvernight(c, '2026-11-11');
    expect(c.cards[0]!.fatigue).toBe(32);
    expect(restOvernight(c, '2026-11-11')).toBe(c);
  });
});
