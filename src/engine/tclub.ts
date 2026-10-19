/**
 * A manager's club for a beta tournament: a fresh career-shaped club with the
 * same starting coins as everyone else, run day by day instead of week by week.
 *  - One training session per tournament day (the usual plan and its effects).
 *  - Cases as usual (the daily drop resets each calendar day).
 *  - After each of the club's matches: coins, fatigue, sharpness, morale and
 *    player stats, applied once per match from the deterministic result.
 *  - A night's rest takes some fatigue off everyone at the start of each day.
 * Transfers and the season (AI league, wages, sponsors) are not used here.
 */
import { addNews, bestPlayer, cardById, createCareer, money, recordCardMatch, runTrainingWeek } from './career';
import type { Career, World } from './career';
import type { SeriesResult } from './match';
import { clamp } from './rng';
import { LOSS_COINS, WIN_COINS } from './tournament';
import type { Seat, TMatch, Tournament } from './tournament';

export const NIGHT_REST = 18;
/** Fatigue per map played. Lower than a league week (8): three matches a day would otherwise wear out any five. */
export const FATIGUE_PER_MAP = 5;

export function createClub(world: World, t: Tournament, seat: Seat, o: { manager: string; team: string; tag: string; coachId: string; today: string }): Career {
  const c = createCareer(world, { managerName: o.manager, teamName: o.team, teamTag: o.tag, coachId: o.coachId, seed: t.clubSeed + seat * 7919, today: o.today });
  c.tournament = { id: t.id, seat, applied: [] };
  c.news = [];
  addNews(c, `${c.teamName} enter ${t.name}.`);
  return c;
}

export function canTrainToday(c: Career, today: string): boolean {
  return c.tournament?.lastTrainDate !== today;
}

/** Today's training session: the club's plan, once per calendar day. */
export function trainToday(world: World, c: Career, today: string): Career {
  if (!c.tournament) throw new Error('Not a tournament club');
  if (!canTrainToday(c, today)) throw new Error('Your squad has already trained today.');
  const n = runTrainingWeek(world, { ...c, phase: 'training' });
  n.phase = 'training';
  n.tournament = { ...n.tournament!, lastTrainDate: today };
  return n;
}

/** Overnight recovery, once for each tournament day reached. */
export function restUpTo(c: Career, day: number): Career {
  const done = c.tournament?.restedDay ?? 1;
  if (!c.tournament || day <= done) return c;
  const n = structuredClone(c);
  for (const card of n.cards) card.fatigue = clamp(card.fatigue - NIGHT_REST * (day - done), 0, 100);
  n.tournament!.restedDay = day;
  return n;
}

/** Puts one settled match on the club's books. Idempotent per match id. */
export function applyMatch(_world: World, c: Career, t: Tournament, m: TMatch, series: SeriesResult, oppName: string, oppTag: string): Career {
  const tc = c.tournament;
  if (!tc || tc.id !== t.id) throw new Error('Not this tournament’s club');
  if (tc.applied.includes(m.id)) return c;
  const mySide: 0 | 1 = m.home === tc.seat ? 0 : 1;
  if (m.home !== tc.seat && m.away !== tc.seat) throw new Error('Not this club’s match');
  let n = restUpTo(c, m.day);
  n = structuredClone(n);
  const prefix = `s${tc.seat}-`;
  // Player ids in a tournament match are prefixed by seat; strip ours to find our cards.
  const mine: SeriesResult = { ...series, maps: series.maps.map((mp) => ({ ...mp, lines: mp.lines.map((l) => (l.id.startsWith(prefix) ? { ...l, id: l.id.slice(prefix.length) } : l)) })) };
  const won = series.winner === mySide;
  const mapsMine = series.maps.map((mp) => ({ map: mp.map, score: (mySide === 0 ? mp.score : [mp.score[1], mp.score[0]]) as [number, number] }));
  money(n, won ? WIN_COINS : LOSS_COINS, 'match', `${won ? 'Win' : 'Loss'} vs ${oppTag}`);
  n.totals.matches++;
  if (won) n.totals.wins++; else n.totals.losses++;
  const mvp = bestPlayer(mine.maps, mySide);
  const played = new Set(mine.maps.flatMap((mp) => mp.lines.map((l) => l.id)));
  n.matches = [{ id: m.id, season: 1, week: m.day, stage: 'league' as const, opponent: oppTag, opponentName: oppName, opponentTag: oppTag, won, mapScore: (mySide === 0 ? series.mapScore : [series.mapScore[1], series.mapScore[0]]) as [number, number], maps: mapsMine, mvpCardId: mvp }, ...n.matches].slice(0, 60);
  for (const card of n.cards) {
    if (!played.has(card.cardId)) continue;
    card.matchesPlayed++;
    card.sharpness = clamp(card.sharpness + 3, 0, 100);
    card.fatigue = clamp(card.fatigue + FATIGUE_PER_MAP * series.maps.length, 0, 100);
    card.morale = clamp(card.morale + (won ? 3 : -2), 0, 100);
    recordCardMatch(card, mine, mySide, { season: 1, week: m.day, opponent: oppTag, mvp: mvp === card.cardId });
  }
  n.chemistry = clamp(n.chemistry + 1, 0, 100);
  addNews(n, `Day ${m.day}: ${won ? 'win' : 'loss'} vs ${oppName} (${mapsMine.map((x) => `${x.score[0]}-${x.score[1]} ${x.map}`).join(', ')}). +${won ? WIN_COINS : LOSS_COINS} coins.`);
  n.tournament = { ...n.tournament!, applied: [...n.tournament!.applied, m.id] };
  return n;
}

/** A match settled by forfeit: no rounds were played, so only the record and the coins change. */
export function applyForfeit(c: Career, t: Tournament, m: TMatch, won: boolean, oppName: string): Career {
  const tc = c.tournament;
  if (!tc || tc.id !== t.id || tc.applied.includes(m.id)) return c;
  const n = structuredClone(restUpTo(c, m.day));
  money(n, won ? WIN_COINS : 0, 'match', `${won ? 'Forfeit win' : 'Forfeit loss'} vs ${oppName}`);
  n.totals.matches++;
  if (won) n.totals.wins++; else n.totals.losses++;
  addNews(n, `Day ${m.day}: ${won ? `${oppName} had no lineup in, so you win by forfeit` : 'your lineup never reached the server, so this match was lost by forfeit'}.`);
  n.tournament = { ...n.tournament!, applied: [...n.tournament!.applied, m.id] };
  return n;
}

export { cardById };
