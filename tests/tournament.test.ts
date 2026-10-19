import { describe, expect, it } from 'vitest';
import { autoLineup, canClaimDaily, humanSnapshot, openCase, starterCoaches } from '../src/engine/career';
import type { Career } from '../src/engine/career';
import { applyMatch, createClub, trainToday } from '../src/engine/tclub';
import {
  addDays, canJoinTournament, dateIn, entryFor, kickoffAt, makeEntry, newTournament, playMatch, resultFor, schedule, slotFor, standings, statusAt, verifyResult, zonedTime,
} from '../src/engine/tournament';
import type { Seat, TEntry, TResult, Tournament } from '../src/engine/tournament';
import { MAPS } from '../src/engine/types';
import type { MapName } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { world } from './helpers';


function setup(startDate = '2026-10-24'): Tournament {
  const now = Date.UTC(2026, 9, 20, 10);
  let t = newTournament({ id: 'TBETA1', name: 'Beta Cup', owner: { userId: 'u0', manager: 'Amar', team: 'Team 0', tag: 'T0', joinedAt: now }, startDate, now });
  for (let i = 1; i < 4; i++) {
    const j = canJoinTournament(t, `u${i}`, now);
    if (!j.ok) throw new Error(j.reason);
    t = { ...t, seats: t.seats.map((s, k) => (k === j.seat ? { userId: `u${i}`, manager: `Friend ${i}`, team: `Team ${i}`, tag: `T${i}`, joinedAt: now } : s)) };
  }
  return t;
}

describe('tournament schedule and time', () => {
  it('kickoffs follow Central European time across the switch to winter time', () => {
    // 24 Oct 2026 is summer time (UTC+2), 25 Oct winter time (UTC+1).
    expect(new Date(zonedTime('2026-10-24', '20:00', 'Europe/Berlin')).toISOString()).toBe('2026-10-24T18:00:00.000Z');
    expect(new Date(zonedTime('2026-10-25', '20:00', 'Europe/Berlin')).toISOString()).toBe('2026-10-25T19:00:00.000Z');
    expect(new Date(zonedTime('2026-10-25', '22:00', 'Europe/Berlin')).toISOString()).toBe('2026-10-25T21:00:00.000Z');
    expect(dateIn('Europe/Berlin', Date.UTC(2026, 9, 25, 23, 30))).toBe('2026-10-26');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('everyone plays everyone once a day, 21 matches each, Bo3 on the last day', () => {
    const t = setup();
    const s = schedule(t);
    expect(s).toHaveLength(42);
    for (let seat = 0; seat < 4; seat++) expect(s.filter((m) => m.home === seat || m.away === seat)).toHaveLength(21);
    for (let day = 1; day <= 7; day++) {
      const pairs = s.filter((m) => m.day === day).map((m) => [m.home, m.away].sort().join('-'));
      expect(new Set(pairs).size).toBe(6);
      for (let k = 0; k < 3; k++) {
        const slot = s.filter((m) => m.day === day && m.slot === (day - 1) * 3 + k);
        expect(new Set(slot.flatMap((m) => [m.home, m.away])).size).toBe(4); // nobody plays twice at once
      }
    }
    expect(s.filter((m) => m.format === 'bo3').every((m) => m.day === 7)).toBe(true);
    expect(s.filter((m) => m.day === 7).every((m) => m.format === 'bo3')).toBe(true);
    expect(new Date(s[0]!.kickoff).toISOString()).toBe('2026-10-24T18:00:00.000Z');
    expect(new Date(s[41]!.kickoff).toISOString()).toBe('2026-10-30T21:00:00.000Z');
  });
  it('no fifth manager, no joining after the start', () => {
    const t = setup();
    expect(canJoinTournament(t, 'u9', Date.UTC(2026, 9, 20)).ok).toBe(false);
    const open = { ...t, seats: [t.seats[0]!, null, null, null] };
    expect(canJoinTournament(open, 'u9', kickoffAt(t, 0) + 1).ok).toBe(false);
  });
});

describe('a full week with four bot managers', () => {
  it('plays all 42 matches, every browser agrees, and the clubs and table add up', () => {
    const w = world();
    const t = setup();
    const coach = starterCoaches(w)[0]!.id;
    const clubs: Career[] = ([0, 1, 2, 3] as Seat[]).map((seat) => createClub(w, t, seat, { manager: `M${seat}`, team: `Team ${seat}`, tag: `T${seat}`, coachId: coach, today: '2026-10-20' }));
    const rng = new Rng(77);
    const entries: TEntry[] = [];
    const results: Record<string, TResult> = {};
    const sched = schedule(t);
    const prefs = (seat: number): MapName[] => [...MAPS].sort((a, b) => ((a.charCodeAt(1) * (seat + 3)) % 7) - ((b.charCodeAt(1) * (seat + 3)) % 7));

    // Everyone submits once before the tournament (as the game does on joining).
    clubs.forEach((c, seat) => entries.push(makeEntry(seat as Seat, `u${seat}`, 0, humanSnapshot(w, c), prefs(seat), Date.UTC(2026, 9, 21))));

    let lateIgnored = 0, fallbacks = 0;
    for (let slot = 0; slot < 21; slot++) {
      const ko = kickoffAt(t, slot);
      const today = dateIn(t.tz, ko);
      // Before kickoff: bots manage their clubs; seat 3 skips most days to test the fallback.
      clubs.forEach((c, seat) => {
        if (seat === 3 && slot % 4 !== 0) return;
        let n = c;
        if (n.tournament!.lastTrainDate !== today) n = trainToday(w, n, today);
        if (canClaimDaily(n, today)) n = openCase(w, n, 'daily', { today }).career;
        if (n.pendingPull) n = { ...n, pendingPull: undefined };
        n = { ...n, lineup: autoLineup(w, n) };
        clubs[seat] = n;
        const at = ko - (5 + Math.floor(rng.next() * 50)) * 60_000;
        expect(slotFor(t, at)).toBe(slot);
        entries.push(makeEntry(seat as Seat, `u${seat}`, slot, humanSnapshot(w, n), prefs(seat), at));
      });
      // Seat 1 tries to sneak a change in after kickoff: it must not count.
      entries.push({ ...makeEntry(1, 'u1', slot, humanSnapshot(w, clubs[1]!), ['Nuke'], ko + 60_000) });

      for (const m of sched.filter((x) => x.slot === slot)) {
        const home = entryFor(entries, m.home, m)!;
        const away = entryFor(entries, m.away, m)!;
        expect(home && away).toBeTruthy();
        if (home.submittedAt >= m.kickoff || away.submittedAt >= m.kickoff) throw new Error('late entry used');
        if (m.home === 1 || m.away === 1) lateIgnored++;
        if ((m.home === 3 && home.slot < slot) || (m.away === 3 && away.slot < slot)) fallbacks++;
        const r = resultFor(t, m, home, away, `u${m.home}`, m.kickoff + 100_000);
        // A second browser with its own copy of the inputs gets the same result.
        expect(verifyResult(t, m, JSON.parse(JSON.stringify(r)), JSON.parse(JSON.stringify(home)), JSON.parse(JSON.stringify(away)))).toBe(true);
        results[m.id] = r;
        const { series } = playMatch(t, m, home, away);
        expect(r.maps).toHaveLength(m.format === 'bo3' ? 3 : 1);
        for (const seat of [m.home, m.away]) {
          const opp = seat === m.home ? m.away : m.home;
          clubs[seat] = applyMatch(w, clubs[seat]!, t, m, series, `Team ${opp}`, `T${opp}`);
          // Applying the same match twice changes nothing.
          expect(applyMatch(w, clubs[seat]!, t, m, series, `Team ${opp}`, `T${opp}`)).toBe(clubs[seat]);
        }
      }
    }
    expect(Object.keys(results)).toHaveLength(42);
    expect(lateIgnored).toBe(21);
    expect(fallbacks).toBeGreaterThan(0);
    const table = standings(t, results);
    expect(table.reduce((s, r) => s + r.played, 0)).toBe(84);
    expect(table.reduce((s, r) => s + r.wins, 0)).toBe(42);
    expect(table.reduce((s, r) => s + r.points, 0)).toBe(126);
    for (const r of table) expect(r.played).toBe(21);
    for (const c of clubs) {
      expect(c.tournament!.applied).toHaveLength(21);
      expect(c.totals.matches).toBe(21);
      expect(c.coins).toBeGreaterThan(0);
      for (const card of c.cards) expect(card.fatigue).toBeLessThanOrEqual(100);
    }
    expect(statusAt(t, kickoffAt(t, 20) + 10 * 60_000)).toBe('finished');
    // Not every match goes the same way: the table isn't decided by seat order.
    console.log('final table', table.map((r) => `T${r.seat} ${r.wins}-${r.losses} (${r.points} pts, maps ${r.mapsWon}-${r.mapsLost})`).join(' | '));
    console.log('fatigue of starters at the end', clubs.map((c) => Math.round(c.lineup.reduce((s, l) => s + c.cards.find((x) => x.cardId === l.cardId)!.fatigue, 0) / 5)).join(', '));
    expect(new Set(table.map((r) => r.wins)).size).toBeGreaterThan(1);
  }, 600_000);
});
