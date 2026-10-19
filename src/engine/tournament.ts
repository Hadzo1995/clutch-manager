/**
 * Beta tournament: four managers, seven days, everyone plays everyone once a
 * day at fixed kickoffs (20:00, 21:00, 22:00 Central European time). Bo1 on
 * days 1-6, Bo3 on day 7.
 *
 * Like PvP, the rules live here, apart from any network code, so every
 * browser (and the tests) settles each match the same way:
 *  - Before a kickoff each manager submits an entry: their team as built in
 *    their tournament club, plus their map preferences for the veto.
 *  - An entry counts for the first kickoff after it was submitted. A manager
 *    who submits nothing for a kickoff plays with their latest earlier entry
 *    (and their join entry if there is none), so no match ever waits.
 *  - The veto runs from the preferences (ban your least wanted map, pick your
 *    most wanted), with the coach's choice for anything left unranked.
 *  - The seed comes from the tournament id, the match id and both entries, so
 *    once kickoff passes anyone can compute the result and everyone gets the
 *    same one. Results are stored with a fingerprint; a mismatch is a dispute.
 */
import { simulateSeries } from './match';
import type { SeriesFormat, SeriesResult, TeamIdx } from './match';
import { fingerprint, pvpTeam, resultHash, summarize, validatePvpTeam } from './pvp';
import type { PvpSummary, TeamCheck } from './pvp';
import { hashString } from './rng';
import { mapFamiliarity } from './team';
import type { TeamSnapshot } from './team';
import { MAPS } from './types';
import type { MapName } from './types';
import { aiVetoChoice, applyVeto, currentStep, newVeto, vetoMaps } from './veto';

export const TOURNAMENT_VERSION = 1;
export const SEATS = 4;
export const TOURNAMENT_DAYS = 7;
export const DEFAULT_KICKOFFS = ['20:00', '21:00', '22:00'] as const;
export const DEFAULT_TZ = 'Europe/Berlin';
/** Results are computed this long after kickoff, so entries sent at the last second have arrived. */
export const SETTLE_DELAY_MS = 90_000;
export const WIN_COINS = 300;
export const LOSS_COINS = 120;

export type Seat = 0 | 1 | 2 | 3;

export interface SeatInfo { userId: string; manager: string; team: string; tag: string; joinedAt: number }

export interface Tournament {
  version: number;
  id: string; // short code, also the document id
  name: string;
  ownerId: string;
  createdAt: number;
  /** First day, as a calendar date in `tz` (YYYY-MM-DD). */
  startDate: string;
  tz: string;
  kickoffs: string[]; // HH:MM in tz
  days: number;
  /** Format of each day's matches, index 0 = day 1. */
  formats: SeriesFormat[];
  seats: (SeatInfo | null)[];
  /** Same starting coins for everyone; clubs are created from this seed and the seat. */
  clubSeed: number;
  state: 'open' | 'running' | 'finished' | 'cancelled';
}

export interface TMatch {
  id: string; // d3k1a: day 3, kickoff 1, game a
  day: number; // 1..days
  slot: number; // kickoff index across the tournament: (day-1)*kickoffs + k
  kickoff: number; // epoch ms
  home: Seat;
  away: Seat;
  format: SeriesFormat;
}

export interface TEntry {
  seat: Seat;
  userId: string;
  /** The kickoff slot this entry is for: the first kickoff after it was written. */
  slot: number;
  submittedAt: number;
  team: TeamSnapshot;
  teamHash: string;
  /** Maps from most to least wanted; may be partial. */
  mapPrefs: MapName[];
}

export interface TResult {
  matchId: string;
  maps: MapName[];
  summary: PvpSummary;
  hash: string;
  /** Fingerprints of the two entries used, so anyone can check the same inputs were used. */
  entryHashes: [string, string];
  computedBy: string;
  computedAt: number;
}

// ---------------------------------------------------------------- time

/** Offset of `tz` from UTC at a given instant, in minutes (CET +60, CEST +120). */
export function tzOffsetMinutes(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/** Epoch ms of a wall-clock date and time in `tz` (handles the switch to winter time). */
export function zonedTime(date: string, hhmm: string, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMinutes(tz, guess) * 60000;
  t = guess - tzOffsetMinutes(tz, t) * 60000; // second pass settles a DST change between guess and answer
  return t;
}

export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** Today's calendar date in `tz`. */
export function dateIn(tz: string, at: number): string {
  return new Date(at + tzOffsetMinutes(tz, at) * 60000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- setup

export function newTournamentCode(random: () => number = Math.random): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'T' + Array.from({ length: 5 }, () => abc[Math.floor(random() * abc.length)]).join('');
}

export function newTournament(o: { id: string; name: string; owner: SeatInfo; startDate: string; now: number; tz?: string; kickoffs?: string[]; clubSeed?: number }): Tournament {
  const days = TOURNAMENT_DAYS;
  return {
    version: TOURNAMENT_VERSION,
    id: o.id,
    name: o.name.trim().slice(0, 40) || 'Beta Cup',
    ownerId: o.owner.userId,
    createdAt: o.now,
    startDate: o.startDate,
    tz: o.tz ?? DEFAULT_TZ,
    kickoffs: [...(o.kickoffs ?? DEFAULT_KICKOFFS)],
    days,
    formats: Array.from({ length: days }, (_, i) => (i === days - 1 ? 'bo3' : 'bo1')),
    seats: [o.owner, null, null, null],
    clubSeed: o.clubSeed ?? (hashString(o.id) % 2147483646) + 1,
    state: 'open',
  };
}

export function validateStart(t: Pick<Tournament, 'startDate' | 'tz' | 'kickoffs'>, now: number): TeamCheck {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.startDate)) errors.push('Pick a start date.');
  else if (zonedTime(t.startDate, t.kickoffs[0]!, t.tz) <= now) errors.push('The first kickoff must be in the future.');
  return { ok: errors.length === 0, errors };
}

export function seatOf(t: Tournament, userId: string | null): Seat | null {
  if (!userId) return null;
  const i = t.seats.findIndex((s) => s?.userId === userId);
  return i >= 0 ? (i as Seat) : null;
}

/** First free seat, if the tournament can still be joined. */
export function canJoinTournament(t: Tournament, userId: string, now: number): { ok: true; seat: Seat } | { ok: false; reason: string } {
  if (seatOf(t, userId) !== null) return { ok: false, reason: 'You are already in this tournament.' };
  if (t.state !== 'open') return { ok: false, reason: 'This tournament is no longer taking managers.' };
  if (firstKickoff(t) <= now) return { ok: false, reason: 'The tournament has already started.' };
  const i = t.seats.findIndex((s) => !s);
  if (i < 0) return { ok: false, reason: 'All four seats are taken.' };
  return { ok: true, seat: i as Seat };
}

export function isFull(t: Tournament): boolean {
  return t.seats.every((s) => !!s);
}

// ---------------------------------------------------------------- schedule

/** The three rounds of a 4-team round robin (circle method). Every pair meets once per day. */
const ROUNDS: [Seat, Seat][][] = [
  [[0, 3], [1, 2]],
  [[0, 2], [3, 1]],
  [[0, 1], [2, 3]],
];

export function firstKickoff(t: Tournament): number {
  return zonedTime(t.startDate, t.kickoffs[0]!, t.tz);
}

export function kickoffAt(t: Tournament, slot: number): number {
  const per = t.kickoffs.length;
  const day = Math.floor(slot / per);
  return zonedTime(addDays(t.startDate, day), t.kickoffs[slot % per]!, t.tz);
}

export function schedule(t: Tournament): TMatch[] {
  const out: TMatch[] = [];
  for (let day = 1; day <= t.days; day++) {
    // Rotate the round order each day so nobody always faces the same opponent first.
    for (let k = 0; k < t.kickoffs.length; k++) {
      const round = ROUNDS[(k + day - 1) % ROUNDS.length]!;
      const slot = (day - 1) * t.kickoffs.length + k;
      round.forEach(([a, b], g) => {
        const swap = day % 2 === 0; // alternate who is home (bans first)
        out.push({
          id: `d${day}k${k}${'ab'[g]}`,
          day, slot, kickoff: kickoffAt(t, slot),
          home: swap ? b : a, away: swap ? a : b,
          format: t.formats[day - 1] ?? 'bo1',
        });
      });
    }
  }
  return out;
}

/** The kickoff slot an entry written at `at` counts for (the next kickoff), or null after the last one. */
export function slotFor(t: Tournament, at: number): number | null {
  const total = t.days * t.kickoffs.length;
  for (let s = 0; s < total; s++) if (kickoffAt(t, s) > at) return s;
  return null;
}

export function lastKickoff(t: Tournament): number {
  return kickoffAt(t, t.days * t.kickoffs.length - 1);
}

// ---------------------------------------------------------------- entries

export function makeEntry(seat: Seat, userId: string, slot: number, team: TeamSnapshot, mapPrefs: MapName[], now: number): TEntry {
  const t = tournamentTeam(team, seat);
  return { seat, userId, slot, submittedAt: now, team: t, teamHash: fingerprint(t), mapPrefs: cleanPrefs(mapPrefs) };
}

/** Each seat's players get their own id prefix, so ids never collide in any pairing. */
export function tournamentTeam(snap: TeamSnapshot, seat: Seat): TeamSnapshot {
  const base = pvpTeam(snap, 0);
  const prefix = `s${seat}-`;
  const players = base.players.map((p) => ({ ...p, id: prefix + p.id.replace(/^h-/, '') }));
  const pairs: Record<string, number> = {};
  for (const [k, v] of Object.entries(base.pairs ?? {})) {
    const [a, b] = k.split('|').map((x) => prefix + (x ?? '').replace(/^h-/, '')) as [string, string];
    pairs[a < b ? `${a}|${b}` : `${b}|${a}`] = v;
  }
  return { ...base, id: `seat-${seat}`, players, pairs };
}

export function cleanPrefs(prefs: MapName[]): MapName[] {
  return [...new Set(prefs.filter((m) => (MAPS as readonly string[]).includes(m)))];
}

export function checkEntry(e: TEntry | null | undefined): TeamCheck {
  if (!e) return { ok: false, errors: ['No entry.'] };
  const errors = [...validatePvpTeam(e.team).errors];
  if (e.teamHash !== fingerprint(e.team)) errors.push('Team changed after it was submitted.');
  return { ok: errors.length === 0, errors };
}

/**
 * The entry a seat plays a match with: its latest valid entry for this kickoff
 * or an earlier one, never one written after kickoff.
 */
export function entryFor(entries: TEntry[], seat: Seat, match: TMatch): TEntry | null {
  let best: TEntry | null = null;
  for (const e of entries) {
    if (e.seat !== seat || e.slot > match.slot || e.submittedAt >= match.kickoff) continue;
    if (!checkEntry(e).ok) continue;
    if (!best || e.slot > best.slot || (e.slot === best.slot && e.submittedAt > best.submittedAt)) best = e;
  }
  return best;
}

// ---------------------------------------------------------------- playing a match

/** Veto from both preference lists; the coach decides for maps a manager didn't rank. */
export function prefVeto(format: SeriesFormat, teams: [TeamSnapshot, TeamSnapshot], prefs: [MapName[], MapName[]]): MapName[] {
  let v = newVeto(format, 0);
  while (currentStep(v)) {
    const s = currentStep(v)!;
    const mine = prefs[s.team].filter((m) => v.remaining.includes(m));
    let choice: MapName;
    if (s.action === 'pick' && mine.length) choice = mine[0]!;
    else if (s.action === 'ban') {
      // Ban an unranked map first (the manager doesn't want it), else the least wanted ranked one.
      const unranked = v.remaining.filter((m) => !prefs[s.team].includes(m));
      choice = unranked.length && prefs[s.team].length
        ? pickByCoach(v, teams, s.team, unranked)
        : mine.length ? mine[mine.length - 1]! : aiVetoChoice(v, teams[s.team], teams[1 - s.team as TeamIdx]);
    } else choice = aiVetoChoice(v, teams[s.team], teams[1 - s.team as TeamIdx]);
    v = applyVeto(v, choice);
  }
  return vetoMaps(v);
}

/** The coach bans, among `among`, the map where this team is weakest against this opponent. */
function pickByCoach(_v: ReturnType<typeof newVeto>, teams: [TeamSnapshot, TeamSnapshot], team: TeamIdx, among: MapName[]): MapName {
  const edge = (m: MapName) => mapFamiliarity(teams[team], m) - mapFamiliarity(teams[1 - team as TeamIdx], m);
  return [...among].sort((a, b) => edge(a) - edge(b) || a.localeCompare(b))[0]!;
}

export function matchSeedFor(t: Tournament, m: TMatch, home: TEntry, away: TEntry): number {
  return (hashString(`${t.id}:${m.id}:${home.teamHash}:${away.teamHash}`) % 2147483646) + 1;
}

export function playMatch(t: Tournament, m: TMatch, home: TEntry, away: TEntry): { series: SeriesResult; maps: MapName[]; teams: [TeamSnapshot, TeamSnapshot] } {
  const teams: [TeamSnapshot, TeamSnapshot] = [home.team, away.team];
  const maps = prefVeto(m.format, teams, [home.mapPrefs, away.mapPrefs]);
  const series = simulateSeries(matchSeedFor(t, m, home, away), teams, maps, m.format);
  return { series, maps, teams };
}

/** Plays the match once and returns both the full series (for the club and the replay) and the stored result. */
export function settleMatch(t: Tournament, m: TMatch, home: TEntry, away: TEntry, by: string, now: number): { series: SeriesResult; result: TResult } {
  const { series, maps, teams } = playMatch(t, m, home, away);
  return { series, result: { matchId: m.id, maps, summary: summarize(series, teams), hash: resultHash(series), entryHashes: [fingerprint(home), fingerprint(away)], computedBy: by, computedAt: now } };
}

export function resultFor(t: Tournament, m: TMatch, home: TEntry, away: TEntry, by: string, now: number): TResult {
  return settleMatch(t, m, home, away, by, now).result;
}

/**
 * A seat with no valid entry at all loses by forfeit (0-1 in maps, no rounds).
 * Only possible if a manager's join entry never reached the server.
 */
export function forfeitResult(m: TMatch, home: TEntry | null, away: TEntry | null, by: string, now: number): TResult | null {
  if ((home && away) || (!home && !away)) return null;
  const winner: TeamIdx = home ? 0 : 1;
  return {
    matchId: m.id, maps: [], hash: `forfeit-${winner}`, computedBy: by, computedAt: now,
    summary: { mapScore: winner === 0 ? [1, 0] : [0, 1], winner, maps: [], players: [] },
    entryHashes: [home ? fingerprint(home) : 'none', away ? fingerprint(away) : 'none'],
  };
}

export const isForfeit = (r: TResult) => r.hash.startsWith('forfeit');

/** Whether a stored result matches what this browser computes from the same entries. */
export function verifyResult(t: Tournament, m: TMatch, r: TResult, home: TEntry | null, away: TEntry | null): boolean {
  if (!home || !away) return forfeitResult(m, home, away, '', 0)?.hash === r.hash;
  if (r.entryHashes[0] !== fingerprint(home) || r.entryHashes[1] !== fingerprint(away)) return false;
  return resultHash(playMatch(t, m, home, away).series) === r.hash;
}

export function readyToSettle(m: TMatch, now: number): boolean {
  return now >= m.kickoff + SETTLE_DELAY_MS;
}

// ---------------------------------------------------------------- table

export interface StandingRow { seat: Seat; played: number; wins: number; losses: number; mapsWon: number; mapsLost: number; roundsWon: number; roundsLost: number; points: number }

/** Win = 3 points. Ties: points, then head-to-head wins, then map difference, then round difference. */
export function standings(t: Tournament, results: Record<string, TResult>): StandingRow[] {
  const rows: StandingRow[] = ([0, 1, 2, 3] as Seat[]).map((seat) => ({ seat, played: 0, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsWon: 0, roundsLost: 0, points: 0 }));
  const h2h = new Map<string, number>();
  for (const m of schedule(t)) {
    const r = results[m.id];
    if (!r) continue;
    const sides: [Seat, Seat] = [m.home, m.away];
    sides.forEach((seat, i) => {
      const row = rows[seat]!;
      row.played++;
      const won = r.summary.winner === i;
      if (won) { row.wins++; row.points += 3; h2h.set(`${seat}>${sides[1 - i]}`, (h2h.get(`${seat}>${sides[1 - i]}`) ?? 0) + 1); } else row.losses++;
      row.mapsWon += r.summary.mapScore[i]!; row.mapsLost += r.summary.mapScore[1 - i]!;
      for (const mp of r.summary.maps) { row.roundsWon += mp.score[i]!; row.roundsLost += mp.score[1 - i]!; }
    });
  }
  return rows.sort((a, b) => b.points - a.points
    || (h2h.get(`${b.seat}>${a.seat}`) ?? 0) - (h2h.get(`${a.seat}>${b.seat}`) ?? 0)
    || (b.mapsWon - b.mapsLost) - (a.mapsWon - a.mapsLost)
    || (b.roundsWon - b.roundsLost) - (a.roundsWon - a.roundsLost)
    || a.seat - b.seat);
}

export function statusAt(t: Tournament, now: number): 'open' | 'running' | 'finished' | 'cancelled' {
  if (t.state === 'cancelled') return 'cancelled';
  if (now < firstKickoff(t)) return 'open';
  if (now >= lastKickoff(t) + SETTLE_DELAY_MS) return 'finished';
  return 'running';
}
