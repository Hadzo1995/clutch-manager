/**
 * The career calendar. Season 1 kicks off on Tuesday 1 December 2026 and every game week is one
 * calendar week, so week w of a season is played on the same weekday as the kickoff. A season is
 * twelve weeks (league, playoffs, cup) followed by a two-week off-season, so season 2 starts
 * fourteen weeks after season 1.
 *
 * Dates are in-game: they don't follow the real clock, and a career can be played as fast or as
 * slowly as you like. Pure functions on ISO dates (YYYY-MM-DD), computed in UTC so the day never
 * shifts with the browser's time zone.
 */
import { SEASON_WEEKS } from './season';

/** The first league's opening matchday. */
export const LEAGUE_KICKOFF = '2026-12-01';
/** Weeks between two seasons' kickoffs: the season itself plus the off-season. */
export const OFFSEASON_WEEKS = 2;
export const WEEKS_PER_SEASON = SEASON_WEEKS + OFFSEASON_WEEKS;

const DAY = 86_400_000;

function parse(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return iso(parse(date) + days * DAY);
}

/** Kickoff date of a season (1-based). */
export function seasonStart(season: number, kickoff = LEAGUE_KICKOFF): string {
  return addDays(kickoff, (season - 1) * WEEKS_PER_SEASON * 7);
}

/** Matchday of a week of a season. Weeks past the end land in the off-season. */
export function matchDate(season: number, week: number, kickoff = LEAGUE_KICKOFF): string {
  return addDays(seasonStart(season, kickoff), (Math.max(1, week) - 1) * 7);
}

/** The last matchday of a season (the cup final). */
export function seasonEnd(season: number, kickoff = LEAGUE_KICKOFF): string {
  return matchDate(season, SEASON_WEEKS, kickoff);
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 1 Dec 2026", or without the year: "Tue 1 Dec". */
export function formatDate(date: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const d = new Date(parse(date));
  const parts = [`${d.getUTCDate()} ${MO[d.getUTCMonth()]}`];
  if (opts.weekday !== false) parts.unshift(WD[d.getUTCDay()]!);
  if (opts.year !== false) parts.push(String(d.getUTCFullYear()));
  return parts.join(' ');
}

/** "1 Dec 2026 – 16 Feb 2027": a season's span. */
export function seasonSpan(season: number, kickoff = LEAGUE_KICKOFF): string {
  return `${formatDate(seasonStart(season, kickoff), { weekday: false })} – ${formatDate(seasonEnd(season, kickoff), { weekday: false })}`;
}
