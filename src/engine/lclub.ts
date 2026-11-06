/**
 * A manager's club in the Clutch League. It is career-shaped (squad, coach,
 * coins, cases, training) and lives from season to season:
 *  - One training session per calendar day.
 *  - After each of the club's matches: coins, fatigue, sharpness, morale and
 *    player stats, applied once per match from the deterministic result.
 *  - A night's rest takes some fatigue off everyone at the start of each day.
 *  - When a season ends: its prize coins and a line in the trophy cabinet.
 *  - When a new season starts: every player goes back to their baseline (the
 *    real-world numbers from the latest Major), so everyone grinds from the
 *    same start. The squad, coins, coach, crest and trophies stay.
 * Transfers and the career season (AI league, wages, sponsors) are not used here.
 */
import { addNews, bestPlayer, createCareer, money, profileOf, recordCardMatch, runTrainingWeek } from './career';
import { applyPlayGrowth } from './growth';
import { cardRole } from './ratings';
import type { Career, World } from './career';
import type { SeriesResult } from './match';
import { clamp } from './rng';
import { LOSS_COINS, STAGE_LABEL, WIN_COINS, prizeFor } from './league';
import type { LMatch, League, LeagueSlot } from './league';
import type { MapName } from './types';

export const NIGHT_REST = 18;
export const FATIGUE_PER_MAP = 6;

export interface LeagueClubState {
  id: string;
  slot: LeagueSlot;
  /** The season the squad is currently set up for (players reset to baseline at its start). */
  season: number;
  /** Match ids already on the books. */
  applied: string[];
  /** Seasons whose final placing (and prize) is on the books. */
  closed: number[];
  trophies: { season: number; place: number; teams: number; coins: number; prize?: string }[];
  lastTrainDate?: string;
  restedDate?: string;
  mapPrefs?: MapName[];
}

export type LeagueClub = Career & { league: LeagueClubState };

export function isLeagueClub(c: Career): c is LeagueClub {
  return !!(c as Partial<LeagueClub>).league;
}

export function createLeagueClub(world: World, l: League, slot: LeagueSlot, season: number, o: { manager: string; team: string; tag: string; coachId: string; today: string; seed: number }): LeagueClub {
  const c = createCareer(world, { managerName: o.manager, teamName: o.team, teamTag: o.tag, coachId: o.coachId, seed: o.seed, today: o.today }) as LeagueClub;
  c.league = { id: l.id, slot, season, applied: [], closed: [], trophies: [] };
  c.news = [];
  addNews(c, `${c.teamName} join ${l.name}. Your first season is season ${season}.`);
  return c;
}

export function canTrainToday(c: LeagueClub, today: string): boolean {
  return c.league.lastTrainDate !== today;
}

/** Today's training session: the club's plan, once per calendar day. */
export function trainToday(world: World, c: LeagueClub, today: string): LeagueClub {
  if (!canTrainToday(c, today)) throw new Error('Your squad has already trained today.');
  const n = runTrainingWeek(world, { ...c, phase: 'training' }) as LeagueClub;
  n.phase = 'training';
  n.league = { ...n.league, lastTrainDate: today };
  return n;
}

/** Overnight recovery, once per calendar day. */
export function restOvernight(c: LeagueClub, today: string): LeagueClub {
  if (c.league.restedDate === today) return c;
  const n = structuredClone(c);
  if (c.league.restedDate) for (const card of n.cards) card.fatigue = clamp(card.fatigue - NIGHT_REST, 0, 100);
  n.league.restedDate = today;
  return n;
}

/**
 * Starts a new season for the club: every player's grind resets to their
 * baseline and fatigue clears. Idempotent per season.
 */
export function startSeason(c: LeagueClub, season: number): LeagueClub {
  if (c.league.season >= season) return c;
  const n = structuredClone(c);
  for (const card of n.cards) {
    card.growth = {};
    card.fatigue = 0;
    card.form = 0;
    card.ovrHistory = [];
  }
  n.league.season = season;
  addNews(n, `Season ${season} begins. Every player is back to their real-world baseline: grind them up by playing well.`);
  return n;
}

/** Puts one settled match on the club's books. Idempotent per match id. */
export function applyMatch(world: World, c: LeagueClub, m: LMatch, series: SeriesResult, oppName: string, oppTag: string): LeagueClub {
  const lc = c.league;
  if (lc.applied.includes(m.id)) return c;
  if (m.home !== lc.slot && m.away !== lc.slot) throw new Error('Not this club’s match');
  const mySide: 0 | 1 = m.home === lc.slot ? 0 : 1;
  const n = structuredClone(c);
  const prefix = `l${lc.slot}-`;
  // Player ids in a league match are prefixed by slot; strip ours to find our cards.
  const mine: SeriesResult = { ...series, maps: series.maps.map((mp) => ({ ...mp, lines: mp.lines.map((l) => (l.id.startsWith(prefix) ? { ...l, id: l.id.slice(prefix.length) } : l)) })) };
  const won = series.winner === mySide;
  const mapsMine = series.maps.map((mp) => ({ map: mp.map, score: (mySide === 0 ? mp.score : [mp.score[1], mp.score[0]]) as [number, number] }));
  money(n, won ? WIN_COINS : LOSS_COINS, 'match', `${won ? 'Win' : 'Loss'} vs ${oppTag}`);
  n.totals.matches++;
  if (won) n.totals.wins++; else n.totals.losses++;
  const mvp = bestPlayer(mine.maps, mySide);
  const played = new Set(mine.maps.flatMap((mp) => mp.lines.map((l) => l.id)));
  const stage: 'league' | 'semi' | 'final' = m.stage === 'league' ? 'league' : m.stage === 'final' ? 'final' : 'semi';
  n.matches = [{ id: m.id, season: m.season, week: m.day, stage, opponent: oppTag, opponentName: oppName, opponentTag: oppTag, won, mapScore: (mySide === 0 ? series.mapScore : [series.mapScore[1], series.mapScore[0]]) as [number, number], maps: mapsMine, mvpCardId: mvp }, ...n.matches].slice(0, 60);
  for (const card of n.cards) {
    if (!played.has(card.cardId)) continue;
    card.matchesPlayed++;
    card.sharpness = clamp(card.sharpness + 3, 0, 100);
    card.fatigue = clamp(card.fatigue + FATIGUE_PER_MAP * series.maps.length, 0, 100);
    card.morale = clamp(card.morale + (won ? 3 : -2), 0, 100);
    recordCardMatch(card, mine, mySide, { season: m.season, week: m.day, opponent: oppTag, mvp: mvp === card.cardId });
  }
  // Growth from playing well (before chemistry moves, so the match is judged as it was played).
  const roleOf = (card: typeof n.cards[number]) => n.lineup.find((s) => s.cardId === card.cardId)?.role ?? cardRole(profileOf(world, card), card);
  // A match from a season the squad has already moved on from (settled late) still counts on the books, but grows nobody.
  const grown = m.season < lc.season ? {} : applyPlayGrowth(n.cards.filter((card) => played.has(card.cardId)), roleOf, (card) => profileOf(world, card), mine.maps, c.chemistry);
  n.chemistry = clamp(n.chemistry + 1, 0, 100);
  const best = Object.entries(grown).sort((a, b) => b[1] - a[1])[0];
  const label = m.stage === 'league' ? `Day ${m.day}` : STAGE_LABEL[m.stage];
  addNews(n, `${label}: ${won ? 'win' : 'loss'} vs ${oppName} (${mapsMine.map((x) => `${x.score[0]}-${x.score[1]} ${x.map}`).join(', ')}). +${won ? WIN_COINS : LOSS_COINS} coins.`);
  if (best && best[1] >= 0.3) {
    const card = n.cards.find((x) => x.cardId === best[0])!;
    addNews(n, `${profileOf(world, card).record.handle} grew most from that match: +${best[1].toFixed(1)} attribute points.`);
  }
  n.league = { ...n.league, applied: [...n.league.applied, m.id] };
  return n;
}

/** A match settled by forfeit: no rounds were played, so only the record and the coins change. */
export function applyForfeit(c: LeagueClub, m: LMatch, won: boolean, oppName: string): LeagueClub {
  if (c.league.applied.includes(m.id)) return c;
  const n = structuredClone(c);
  money(n, won ? WIN_COINS : 0, 'match', `${won ? 'Forfeit win' : 'Forfeit loss'} vs ${oppName}`);
  n.totals.matches++;
  if (won) n.totals.wins++; else n.totals.losses++;
  addNews(n, won ? `${oppName} had no lineup in, so you win by forfeit.` : 'Your lineup never reached the server, so this match was lost by forfeit.');
  n.league = { ...n.league, applied: [...n.league.applied, m.id] };
  return n;
}

/** Books the season's final placing and its prize. Idempotent per season. */
export function closeSeason(c: LeagueClub, l: League, season: number, place: number, teams: number): LeagueClub {
  if (c.league.closed.includes(season)) return c;
  const n = structuredClone(c);
  const coins = prizeFor(place);
  const prize = l.prizes[place - 1] || undefined;
  if (coins) money(n, coins, 'prize', `${l.name} season ${season}: ${ordinalPlace(place)}`);
  if (place === 1) n.totals.titles++;
  n.league.closed = [...n.league.closed, season];
  n.league.trophies = [...n.league.trophies, { season, place, teams, coins, ...(prize ? { prize } : {}) }];
  addNews(n, place === 1
    ? `Champions of ${l.name} season ${season}!${coins ? ` +${coins.toLocaleString('en-US')} coins.` : ''}${prize ? ` Prize: ${prize}.` : ''}`
    : `Season ${season} over: ${ordinalPlace(place)} of ${teams}.${coins ? ` +${coins.toLocaleString('en-US')} coins.` : ''}${prize ? ` Prize: ${prize}.` : ''}`);
  return n;
}

export function ordinalPlace(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}
