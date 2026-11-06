/**
 * Clutch League: one online league that runs season after season.
 *
 *  - Up to 50 managers (the cap is a setting). Each takes a seat with their
 *    own club; real organisations fill seats until the season has at least 16
 *    teams and an even number, so a season can start with any number of managers.
 *  - A season: a Swiss league stage of 14 matchdays (Bo1, one kickoff a night;
 *    each night teams with similar records meet, never the same opponent twice
 *    where it can be avoided), all teams ranked in one table, then the top 8
 *    play Bo3 quarterfinals (day 15), semifinals (16) and the grand final (17),
 *    and a 3-day off-season before the next season starts.
 *  - Every season pays the coin prizes by final placing plus the prizes the
 *    league owner lists (skins, given by hand), and its champion, runner-up and
 *    awards are kept for good.
 *
 * Like the beta tournament, the rules live here, apart from any network code,
 * so every browser (and the tests) settles each match the same way: the seed
 * comes from the league, the season, the match and both teams, and the first
 * stored result is final.
 */
import { simulateSeries } from './match';
import type { SeriesFormat, SeriesResult } from './match';
import { fingerprint, pvpTeam, resultHash, summarize, validatePvpTeam } from './pvp';
import type { PvpSummary, TeamCheck } from './pvp';
import { Rng, hashString } from './rng';
import { DIVISIONS, generateAiTeams } from './season';
import type { AiTeam } from './season';
import { aiToMatchPlayer } from './team';
import type { TeamSnapshot } from './team';
import type { Coach, MapName, PlayerProfile, Tactics } from './types';
import { addDays, cleanPrefs, prefVeto, zonedTime } from './tournament';

export const LEAGUE_VERSION = 1;
/** Most managers a league takes unless the owner sets another cap. Swiss scales, so raising it needs no other change. */
export const DEFAULT_MAX_TEAMS = 50;
export const MAX_TEAMS_LIMIT = 128;
/** Fewest teams in a season; real organisations fill up to this. */
export const MIN_TEAMS = 16;
export const SWISS_ROUNDS = 14;
export const PLAYOFF_TEAMS = 8;
export const QF_DAY = SWISS_ROUNDS + 1; // 15
export const SEMI_DAY = SWISS_ROUNDS + 2; // 16
export const FINAL_DAY = SWISS_ROUNDS + 3; // 17
export const OFF_SEASON_DAYS = 3;
export const SEASON_LENGTH = FINAL_DAY + OFF_SEASON_DAYS; // 20 days from one season's start to the next
export const DEFAULT_KICKOFF = '20:00';
export const DEFAULT_TZ = 'Europe/Berlin';
/** Results are computed this long after kickoff, so entries sent at the last second have arrived. */
export const SETTLE_DELAY_MS = 90_000;
/** In-game coins paid each season by final place (index 0 = champion), on top of the owner's prize list. */
export const PRIZE_POOL = 100_000;
/** Share of the pool by final place (index 0 = champion). Places past the list get nothing. */
export const PRIZE_SHARES = [0.4, 0.2, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05];
export const WIN_COINS = 300;
export const LOSS_COINS = 120;
/** How sharp the real organisations play (the career's Pro League level). */
export const AI_SHARPNESS = DIVISIONS[2]!.aiSharpness;
/** Fewest maps to qualify for the season MVP. */
export const MVP_MIN_MAPS = 10;

export type LeagueSlot = number; // 0..maxTeams-1

export interface League {
  version: number;
  id: string; // L + 5 characters, also the document id
  name: string;
  ownerId: string;
  createdAt: number;
  /** Day 1 of season 1, as a calendar date in `tz`. */
  firstSeasonStart: string;
  tz: string;
  kickoff: string; // HH:MM in tz
  /** How many managers can hold a seat. */
  maxTeams: number;
  /** The owner's prizes by place, written by hand (e.g. "AWP | Asiimov (Field-Tested)"); index 0 = champion. */
  prizes: string[];
  state: 'active' | 'closed';
}

export interface LeagueSeat {
  slot: LeagueSlot;
  userId: string;
  manager: string;
  team: string;
  tag: string;
  joinedAt: number;
}

/**
 * One season's line-up of teams, fixed at its first kickoff: who holds each
 * slot, and the full team of every organisation that plays in a free slot.
 * Stored once (the first write is final), so every browser plays the same AI.
 */
export interface LeagueSeason {
  league: string;
  season: number;
  /** Managers by slot, frozen at the season's first kickoff. */
  managers: Record<number, { userId: string; manager: string; team: string; tag: string }>;
  /** The team every organisation slot plays with all season. */
  ai: Record<number, TeamSnapshot>;
  /** Teams this season: slots 0..size-1 (managers keep their seat number; organisations fill the gaps). */
  size: number;
}

export type LeagueStage = 'league' | 'quarter' | 'semi' | 'final';
export const STAGE_LABEL: Record<LeagueStage, string> = { league: 'League', quarter: 'Quarterfinal', semi: 'Semifinal', final: 'Grand final' };

export interface LMatch {
  id: string; // s2d7m3: season 2, day 7, match 3; s2qf1, s2sf1, s2gf for the playoffs
  season: number;
  day: number; // 1..17 (14 Swiss days, then quarterfinals, semifinals, final)
  kickoff: number; // epoch ms
  home: LeagueSlot;
  away: LeagueSlot;
  format: SeriesFormat;
  stage: LeagueStage;
}

export interface LEntry {
  slot: LeagueSlot;
  userId: string;
  season: number;
  /** The matchday this entry is for: the first kickoff after it was written. */
  day: number;
  submittedAt: number;
  team: TeamSnapshot;
  teamHash: string;
  /** Maps from most to least wanted; may be partial. */
  mapPrefs: MapName[];
}

export interface LResult {
  matchId: string;
  maps: MapName[];
  summary: PvpSummary;
  hash: string;
  /** Fingerprints of the two teams used, so anyone can check the same inputs were used. */
  teamHashes: [string, string];
  computedBy: string;
  computedAt: number;
}

// ---------------------------------------------------------------- setup

export function newLeagueCode(random: () => number = Math.random): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'L' + Array.from({ length: 5 }, () => abc[Math.floor(random() * abc.length)]).join('');
}

export function newLeague(o: { id: string; name: string; ownerId: string; firstSeasonStart: string; now: number; tz?: string; kickoff?: string; maxTeams?: number; prizes?: string[] }): League {
  return {
    version: LEAGUE_VERSION,
    id: o.id,
    name: o.name.trim().slice(0, 40) || 'Clutch League',
    ownerId: o.ownerId,
    createdAt: o.now,
    firstSeasonStart: o.firstSeasonStart,
    tz: o.tz ?? DEFAULT_TZ,
    kickoff: o.kickoff ?? DEFAULT_KICKOFF,
    maxTeams: Math.max(2, Math.min(MAX_TEAMS_LIMIT, Math.round(o.maxTeams ?? DEFAULT_MAX_TEAMS))),
    prizes: cleanPrizes(o.prizes ?? []),
    state: 'active',
  };
}

/** Up to 16 prize lines of at most 80 characters; trailing empty places dropped. */
export function cleanPrizes(prizes: string[]): string[] {
  const out = prizes.slice(0, 16).map((p) => String(p ?? '').trim().slice(0, 80));
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

// ---------------------------------------------------------------- time

export function seasonStart(l: League, season: number): string {
  return addDays(l.firstSeasonStart, (season - 1) * SEASON_LENGTH);
}

export function kickoffAt(l: League, season: number, day: number): number {
  return zonedTime(addDays(seasonStart(l, season), day - 1), l.kickoff, l.tz);
}

export function firstKickoff(l: League, season: number): number {
  return kickoffAt(l, season, 1);
}

export type SeasonPhase = 'preseason' | 'league' | 'playoffs' | 'offseason';

/**
 * The season a moment belongs to and where it is. A season runs from the end
 * of the previous season's final until its own final has been settled; the
 * days after that are its off-season, during which the next one is "preseason".
 */
export function seasonAt(l: League, now: number): { season: number; phase: SeasonPhase } {
  if (now < firstKickoff(l, 1)) return { season: 1, phase: 'preseason' };
  let s = 1;
  while (now >= firstKickoff(l, s + 1)) s++;
  const finalDone = kickoffAt(l, s, FINAL_DAY) + SETTLE_DELAY_MS;
  if (now >= finalDone) return { season: s + 1, phase: 'preseason' };
  if (now >= kickoffAt(l, s, QF_DAY)) return { season: s, phase: 'playoffs' };
  return { season: s, phase: 'league' };
}

/** The matchday an entry written at `at` counts for in this season (the next kickoff), or null after the final. */
export function dayFor(l: League, season: number, at: number): number | null {
  for (let d = 1; d <= FINAL_DAY; d++) if (kickoffAt(l, season, d) > at) return d;
  return null;
}

// ---------------------------------------------------------------- seats

export function seatOf(seats: LeagueSeat[], userId: string | null): LeagueSeat | null {
  if (!userId) return null;
  return seats.find((s) => s.userId === userId) ?? null;
}

/** A manager joins the lowest free slot. Joining is always open; a seat plays from the next season that has not started. */
export function canJoinLeague(l: League, seats: LeagueSeat[], userId: string): { ok: true; slot: LeagueSlot } | { ok: false; reason: string } {
  if (l.state !== 'active') return { ok: false, reason: 'This league is closed.' };
  if (seatOf(seats, userId)) return { ok: false, reason: 'You are already in this league.' };
  const taken = new Set(seats.map((s) => s.slot));
  for (let slot = 0; slot < l.maxTeams; slot++) if (!taken.has(slot)) return { ok: true, slot };
  return { ok: false, reason: `All ${l.maxTeams} seats are taken. Ask the owner to raise the cap.` };
}

/** The season a seat that joined at `joinedAt` first plays in. */
export function firstSeasonFor(l: League, joinedAt: number): number {
  let s = 1;
  while (firstKickoff(l, s) <= joinedAt) s++;
  return s;
}

// ---------------------------------------------------------------- the season's teams

/** A real organisation's team as it plays a whole league season. */
export function aiLeagueTeam(team: AiTeam, profiles: Map<string, PlayerProfile>, coaches: Map<string, Coach>, sharpness = AI_SHARPNESS): TeamSnapshot {
  const startT = (Object.entries(team.tendencies.t) as [Tactics['tApproach'], number][]).sort((a, b) => b[1] - a[1])[0]![0];
  const startCT = (Object.entries(team.tendencies.ct) as [Tactics['ctSetup'], number][]).sort((a, b) => b[1] - a[1])[0]![0];
  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    isHuman: false,
    players: team.playerIds.map((pid, i) => aiToMatchPlayer(profiles.get(pid)!, team.roles[i]!, sharpness)),
    coach: coaches.get(team.coachId) ?? null,
    chemistry: team.chemistry,
    mapPractice: { ...team.mapPractice },
    tactics: { playstyle: 'balanced', tApproach: startT, ctSetup: startCT, stackSite: team.tendencies.aSiteBias >= 0.5 ? 'B' : 'A' },
    tendencies: team.tendencies,
    prepBonus: 0,
  };
}

/**
 * The season's line-up: managers who joined before its first kickoff keep
 * their slot, and real organisations (drawn from the whole pool, seeded by the
 * league and season) fill the rest.
 */
export function buildSeason(l: League, season: number, seats: LeagueSeat[], profileList: PlayerProfile[], coaches: Coach[]): LeagueSeason {
  const start = firstKickoff(l, season);
  const managers: LeagueSeason['managers'] = {};
  for (const s of seats) if (s.joinedAt < start && s.slot >= 0 && s.slot < l.maxTeams) managers[s.slot] = { userId: s.userId, manager: s.manager, team: s.team, tag: s.tag };
  const size = seasonSize(Object.keys(managers).map(Number));
  const free = Array.from({ length: size }, (_, i) => i).filter((i) => !managers[i]);
  const rng = new Rng((hashString(`${l.id}:season:${season}`) % 2147483646) + 1);
  const division = { ...DIVISIONS[DIVISIONS.length - 1]!, rankRange: [1, 120] as [number, number] };
  const teams = free.length ? generateAiTeams(rng, division, profileList, coaches, free.length, Object.values(managers).map((m) => m.tag)) : [];
  const profiles = new Map(profileList.map((p) => [p.record.id, p]));
  const coachMap = new Map(coaches.map((c) => [c.id, c]));
  const ai: LeagueSeason['ai'] = {};
  free.forEach((slot, i) => { ai[slot] = leagueTeam(aiLeagueTeam(teams[i]!, profiles, coachMap), slot); });
  return { league: l.id, season, managers, ai, size };
}

/**
 * Teams in a season: every manager's seat, filled with organisations up to at
 * least MIN_TEAMS and to an even number (so nobody sits a night out).
 */
export function seasonSize(managerSlots: number[]): number {
  const highest = managerSlots.length ? Math.max(...managerSlots) + 1 : 0;
  const n = Math.max(MIN_TEAMS, highest, managerSlots.length);
  return n % 2 ? n + 1 : n;
}

export function slotName(s: LeagueSeason, slot: LeagueSlot): { name: string; tag: string; manager?: string } {
  const m = s.managers[slot];
  if (m) return { name: m.team, tag: m.tag, manager: m.manager };
  const t = s.ai[slot];
  return { name: t?.name ?? `Team ${slot + 1}`, tag: t?.tag ?? `T${slot + 1}` };
}

/** Each slot's players get their own id prefix, so ids never collide, even when two teams field the same real player. */
export function leagueTeam(snap: TeamSnapshot, slot: LeagueSlot): TeamSnapshot {
  const prefix = `l${slot}-`;
  const base = snap.isHuman ? pvpTeam(snap, 0) : snap;
  const strip = (id: string) => id.replace(/^h-/, '').replace(/^l\d+-/, '');
  const players = base.players.map((p) => ({ ...p, id: prefix + strip(p.id) }));
  const pairs: Record<string, number> = {};
  for (const [k, v] of Object.entries(base.pairs ?? {})) {
    const [a, b] = k.split('|').map((x) => prefix + strip(x ?? '')) as [string, string];
    pairs[a < b ? `${a}|${b}` : `${b}|${a}`] = v;
  }
  return { ...base, id: `slot-${slot}`, players, pairs };
}

// ---------------------------------------------------------------- schedule (Swiss)

/**
 * The Swiss league stage, as far as it is known: day 1 pairs a seeded shuffle
 * (top half against bottom half); each later day is paired once every match of
 * the day before has a result, from the table at that point: teams are taken
 * from the top, each meeting the highest-placed team it has not played yet.
 */
export function swissMatches(l: League, s: LeagueSeason, results: Record<string, LResult>): LMatch[] {
  const out: LMatch[] = [];
  const size = s.size;
  const rounds = Math.min(SWISS_ROUNDS, size - 1);
  const rng = new Rng((hashString(`${l.id}:swiss:${s.season}`) % 2147483646) + 1);
  const seedOrder = rng.shuffle(Array.from({ length: size }, (_, i) => i));
  const homes = new Map<number, number>();
  const met = new Set<string>();
  const metKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  for (let day = 1; day <= rounds; day++) {
    let order: number[];
    if (day === 1) order = seedOrder;
    else {
      const prev = out.filter((m) => m.day === day - 1);
      if (!prev.every((m) => results[m.id])) break;
      const table = standings(out, results, size);
      order = table.map((r) => r.slot);
    }
    const pairs = day === 1
      ? Array.from({ length: size / 2 }, (_, i) => [order[i]!, order[i + size / 2]!] as [number, number])
      : pairSwiss(order, (a, b) => met.has(metKey(a, b)));
    pairs.forEach(([a, b], i) => {
      // Whoever has been home less often is home (bans first); ties go to the higher-placed team.
      const [home, away] = (homes.get(b) ?? 0) < (homes.get(a) ?? 0) ? [b, a] : [a, b];
      homes.set(home, (homes.get(home) ?? 0) + 1);
      met.add(metKey(a, b));
      out.push({ id: `s${s.season}d${day}m${i}`, season: s.season, day, kickoff: kickoffAt(l, s.season, day), home, away, format: 'bo1', stage: 'league' });
    });
  }
  return out;
}

/**
 * Pairs an ordered list top-down, each team with the next team it has not
 * met, backtracking when the tail can't be paired. In a small league late in
 * the season a rematch-free night may not exist; then it allows the fewest
 * rematches that work (1, then 2, ...).
 */
export function pairSwiss(order: number[], played: (a: number, b: number) => boolean): [number, number][] {
  const solve = (left: number[], rematches: number, budget: { n: number }): [number, number][] | null => {
    if (!left.length) return [];
    if (--budget.n < 0) return null;
    const [a, ...rest] = left as [number, ...number[]];
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i]!;
      const cost = played(a, b) ? 1 : 0;
      if (cost > rematches) continue;
      const tail = solve([...rest.slice(0, i), ...rest.slice(i + 1)], rematches - cost, budget);
      if (tail) return [[a, b], ...tail];
    }
    return null;
  };
  for (let k = 0; k <= order.length / 2; k++) {
    const p = solve(order, k, { n: 50_000 });
    if (p) return p;
  }
  return Array.from({ length: order.length / 2 }, (_, i) => [order[2 * i]!, order[2 * i + 1]!] as [number, number]);
}

/** Quarterfinals (1 v 8, 4 v 5, 2 v 7, 3 v 6) once the Swiss stage is complete, then semifinals and the final as results come in. */
export function playoffMatches(l: League, s: LeagueSeason, results: Record<string, LResult>): LMatch[] {
  const swiss = swissMatches(l, s, results);
  const rounds = Math.min(SWISS_ROUNDS, s.size - 1);
  if (!swiss.length || swiss[swiss.length - 1]!.day < rounds || !swiss.every((m) => results[m.id])) return [];
  const table = standings(swiss, results, s.size);
  const seed = (i: number) => table[i]!.slot;
  const n = s.season;
  const mk = (id: string, day: number, home: number, away: number, stage: LeagueStage): LMatch => ({ id: `s${n}${id}`, season: n, day, kickoff: kickoffAt(l, n, day), home, away, format: 'bo3', stage });
  const winner = (m: LMatch) => { const r = results[m.id]; return r ? (r.summary.winner === 0 ? m.home : m.away) : null; };
  const qf = [mk('qf1', QF_DAY, seed(0), seed(7), 'quarter'), mk('qf2', QF_DAY, seed(3), seed(4), 'quarter'), mk('qf3', QF_DAY, seed(1), seed(6), 'quarter'), mk('qf4', QF_DAY, seed(2), seed(5), 'quarter')];
  const w = qf.map(winner);
  if (w.some((x) => x === null)) return qf;
  const sf = [mk('sf1', SEMI_DAY, w[0]!, w[1]!, 'semi'), mk('sf2', SEMI_DAY, w[2]!, w[3]!, 'semi')];
  const ws = sf.map(winner);
  if (ws.some((x) => x === null)) return [...qf, ...sf];
  return [...qf, ...sf, mk('gf', FINAL_DAY, ws[0]!, ws[1]!, 'final')];
}

/** Every match of the season known so far. */
export function seasonMatches(l: League, s: LeagueSeason, results: Record<string, LResult>): LMatch[] {
  return [...swissMatches(l, s, results), ...playoffMatches(l, s, results)];
}

// ---------------------------------------------------------------- entries

export function makeEntry(slot: LeagueSlot, userId: string, season: number, day: number, team: TeamSnapshot, mapPrefs: MapName[], now: number): LEntry {
  const t = leagueTeam(team, slot);
  return { slot, userId, season, day, submittedAt: now, team: t, teamHash: fingerprint(t), mapPrefs: cleanPrefs(mapPrefs) };
}

export function checkEntry(e: LEntry | null | undefined): TeamCheck {
  if (!e) return { ok: false, errors: ['No entry.'] };
  const errors = [...validatePvpTeam(e.team).errors];
  if (e.teamHash !== fingerprint(e.team)) errors.push('Team changed after it was submitted.');
  return { ok: errors.length === 0, errors };
}

/**
 * The entry a manager plays a match with: their latest valid entry for this
 * matchday or an earlier one (in this or an earlier season), never one written
 * after kickoff. A manager who never sent a lineup has none and forfeits.
 */
export function entryFor(entries: LEntry[], slot: LeagueSlot, match: LMatch): LEntry | null {
  let best: LEntry | null = null;
  const key = (e: LEntry) => e.season * 100 + e.day;
  const mk = match.season * 100 + match.day;
  for (const e of entries) {
    if (e.slot !== slot || key(e) > mk || e.submittedAt >= match.kickoff) continue;
    if (!checkEntry(e).ok) continue;
    if (!best || key(e) > key(best) || (key(e) === key(best) && e.submittedAt > best.submittedAt)) best = e;
  }
  return best;
}

/** What a slot brings to a match: the manager's entry, or the organisation's season team. */
export function sideFor(s: LeagueSeason, entries: LEntry[], slot: LeagueSlot, match: LMatch): { team: TeamSnapshot; prefs: MapName[] } | null {
  if (s.managers[slot]) {
    const e = entryFor(entries, slot, match);
    return e ? { team: e.team, prefs: e.mapPrefs } : null;
  }
  const t = s.ai[slot];
  return t ? { team: t, prefs: [] } : null;
}

// ---------------------------------------------------------------- playing a match

export function matchSeed(l: League, m: LMatch, home: TeamSnapshot, away: TeamSnapshot): number {
  return (hashString(`${l.id}:${m.id}:${fingerprint(home)}:${fingerprint(away)}`) % 2147483646) + 1;
}

export function playMatch(l: League, m: LMatch, home: { team: TeamSnapshot; prefs: MapName[] }, away: { team: TeamSnapshot; prefs: MapName[] }): { series: SeriesResult; maps: MapName[]; teams: [TeamSnapshot, TeamSnapshot] } {
  const teams: [TeamSnapshot, TeamSnapshot] = [home.team, away.team];
  const maps = prefVeto(m.format, teams, [home.prefs, away.prefs]);
  const series = simulateSeries(matchSeed(l, m, home.team, away.team), teams, maps, m.format);
  return { series, maps, teams };
}

/** Plays the match once and returns both the full series (for the club and the replay) and the stored result. */
export function settleMatch(l: League, m: LMatch, home: { team: TeamSnapshot; prefs: MapName[] }, away: { team: TeamSnapshot; prefs: MapName[] }, by: string, now: number): { series: SeriesResult; result: LResult } {
  const { series, maps, teams } = playMatch(l, m, home, away);
  return { series, result: { matchId: m.id, maps, summary: summarize(series, teams), hash: resultHash(series), teamHashes: [fingerprint(home.team), fingerprint(away.team)], computedBy: by, computedAt: now } };
}

/** A side with no team at all (a manager who never sent a lineup) loses 0-1 without a round played. */
export function forfeitResult(m: LMatch, home: unknown, away: unknown, by: string, now: number): LResult | null {
  if ((home && away) || (!home && !away)) return null;
  const winner = home ? 0 : 1;
  return {
    matchId: m.id, maps: [], hash: `forfeit-${winner}`, computedBy: by, computedAt: now,
    summary: { mapScore: winner === 0 ? [1, 0] : [0, 1], winner, maps: [], players: [] },
    teamHashes: ['', ''],
  };
}

export const isForfeit = (r: LResult) => r.hash.startsWith('forfeit');

/** Whether a stored result matches what this browser computes from the same teams. */
export function verifyResult(l: League, m: LMatch, r: LResult, home: { team: TeamSnapshot; prefs: MapName[] } | null, away: { team: TeamSnapshot; prefs: MapName[] } | null): boolean {
  if (!home || !away) return forfeitResult(m, home, away, '', 0)?.hash === r.hash;
  if (r.teamHashes[0] !== fingerprint(home.team) || r.teamHashes[1] !== fingerprint(away.team)) return false;
  return resultHash(playMatch(l, m, home, away).series) === r.hash;
}

export function readyToSettle(m: LMatch, now: number): boolean {
  return now >= m.kickoff + SETTLE_DELAY_MS;
}

// ---------------------------------------------------------------- table

export interface LeagueRow { slot: LeagueSlot; played: number; wins: number; losses: number; mapsWon: number; mapsLost: number; roundsWon: number; roundsLost: number; points: number; buchholz: number }

/**
 * League stage only. Win = 3 points. Ties: points, then Buchholz (the points
 * of everyone you played, so a hard schedule counts), then round difference,
 * then rounds won.
 */
export function standings(matches: LMatch[], results: Record<string, LResult>, size: number): LeagueRow[] {
  const rows: LeagueRow[] = Array.from({ length: size }, (_, slot) => ({ slot, played: 0, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsWon: 0, roundsLost: 0, points: 0, buchholz: 0 }));
  const opponents = new Map<number, number[]>();
  for (const m of matches) {
    if (m.stage !== 'league') continue;
    const r = results[m.id];
    if (!r) continue;
    const sides: [LeagueSlot, LeagueSlot] = [m.home, m.away];
    sides.forEach((slot, i) => {
      const row = rows[slot]!;
      row.played++;
      if (r.summary.winner === i) { row.wins++; row.points += 3; } else row.losses++;
      row.mapsWon += r.summary.mapScore[i]!; row.mapsLost += r.summary.mapScore[1 - i]!;
      for (const mp of r.summary.maps) { row.roundsWon += mp.score[i]!; row.roundsLost += mp.score[1 - i]!; }
      opponents.set(slot, [...(opponents.get(slot) ?? []), sides[1 - i]!]);
    });
  }
  for (const row of rows) row.buchholz = (opponents.get(row.slot) ?? []).reduce((t, o) => t + rows[o]!.points, 0);
  return rows.sort((a, b) => b.points - a.points
    || b.buchholz - a.buchholz
    || (b.roundsWon - b.roundsLost) - (a.roundsWon - a.roundsLost)
    || b.roundsWon - a.roundsWon
    || a.slot - b.slot);
}

/**
 * Final placing of every slot once the final is in: champion, runner-up, the
 * beaten semifinalists, then the beaten quarterfinalists (each pair by league
 * position), then the rest of the table. Null while the season is still on.
 */
export function finalPlacings(l: League, s: LeagueSeason, results: Record<string, LResult>): LeagueSlot[] | null {
  const all = seasonMatches(l, s, results);
  const final = all.find((m) => m.stage === 'final');
  const fr = final && results[final.id];
  if (!final || !fr) return null;
  const table = standings(all, results, s.size).map((r) => r.slot);
  const loser = (m: LMatch) => (results[m.id]!.summary.winner === 0 ? m.away : m.home);
  const byTable = (a: number, b: number) => table.indexOf(a) - table.indexOf(b);
  const champion = fr.summary.winner === 0 ? final.home : final.away;
  const top = [
    champion, loser(final),
    ...all.filter((m) => m.stage === 'semi').map(loser).sort(byTable),
    ...all.filter((m) => m.stage === 'quarter').map(loser).sort(byTable),
  ];
  return [...top, ...table.filter((x) => !top.includes(x))];
}

/** Coins paid for a final place (1 = champion). */
export function prizeFor(place: number): number {
  return Math.round(PRIZE_POOL * (PRIZE_SHARES[place - 1] ?? 0));
}

// ---------------------------------------------------------------- awards

export interface PlayerSeason { id: string; handle: string; slot: LeagueSlot; maps: number; kills: number; deaths: number; ratingSum: number }

/** Every player's season, from the stored results (forfeits count for nothing). */
export function playerSeasons(matches: LMatch[], results: Record<string, LResult>): PlayerSeason[] {
  const acc = new Map<string, PlayerSeason>();
  for (const m of matches) {
    const r = results[m.id];
    if (!r || isForfeit(r)) continue;
    const maps = r.summary.maps.length;
    for (const p of r.summary.players) {
      const slot = p.team === 0 ? m.home : m.away;
      const key = `${slot}:${p.id}`;
      const row = acc.get(key) ?? { id: p.id, handle: p.handle, slot, maps: 0, kills: 0, deaths: 0, ratingSum: 0 };
      row.maps += maps; row.kills += p.kills; row.deaths += p.deaths; row.ratingSum += p.rating * maps;
      acc.set(key, row);
    }
  }
  return [...acc.values()];
}

export const avgRating = (p: PlayerSeason) => (p.maps ? p.ratingSum / p.maps : 0);

/** Season MVP (best average rating over at least MVP_MIN_MAPS maps) and top fragger. */
export function seasonAwards(matches: LMatch[], results: Record<string, LResult>): { mvp: PlayerSeason | null; topFragger: PlayerSeason | null } {
  const all = playerSeasons(matches, results);
  const qualified = all.filter((p) => p.maps >= MVP_MIN_MAPS);
  const mvp = [...qualified].sort((a, b) => avgRating(b) - avgRating(a) || b.kills - a.kills)[0] ?? null;
  const topFragger = [...all].sort((a, b) => b.kills - a.kills || avgRating(b) - avgRating(a))[0] ?? null;
  return { mvp, topFragger };
}
