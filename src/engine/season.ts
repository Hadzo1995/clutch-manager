/**
 * Seasons, divisions and AI teams.
 * A season: 8 teams, 7 round-robin weeks (Bo1), semifinals and final (Bo3).
 * Top 2 are promoted, bottom 2 relegated (where a division above/below exists).
 * Then a three-week cup (weeks 10-12): the top 4 of the league (always
 * including you) against 4 guest teams from the division above, Bo3 knockout.
 */
import { Rng } from './rng';
import type { SeriesFormat, SeriesResult } from './match';
import type { TeamTendencies } from './team';
import type { Coach, MapName, PlayerProfile, Role } from './types';
import { MAPS, ROLES } from './types';

export interface Division {
  id: number;
  name: string;
  rankRange: [number, number]; // which dataset ranks AI teams draw from
  aiSharpness: number;
  winReward: number;
  prizes: number[]; // by final placement 1..8
}

export const DIVISIONS: Division[] = [
  { id: 0, name: 'Open Circuit', rankRange: [120, 200], aiSharpness: 62, winReward: 350, prizes: [2500, 1600, 1100, 1100, 500, 400, 300, 200] },
  { id: 1, name: 'Challenger Series', rankRange: [70, 170], aiSharpness: 72, winReward: 450, prizes: [3500, 2200, 1500, 1500, 700, 500, 400, 300] },
  { id: 2, name: 'Pro League', rankRange: [30, 120], aiSharpness: 86, winReward: 600, prizes: [5000, 3000, 2000, 2000, 1000, 800, 600, 400] },
  { id: 3, name: 'Elite Series', rankRange: [1, 70], aiSharpness: 98, winReward: 800, prizes: [8000, 5000, 3200, 3200, 1500, 1200, 900, 600] },
];

const ORG_NAMES: [string, string][] = [
  ['Northwind', 'NWD'], ['Iron Vultures', 'IVX'], ['Polar Static', 'PST'], ['Red Meridian', 'RDM'], ['Saltmarsh', 'SLT'],
  ['Kilnworks', 'KLN'], ['Overcast', 'OVC'], ['Granite Owls', 'GRO'], ['Velvet Siege', 'VSG'], ['Copperline', 'CPL'],
  ['Hollow Point', 'HLP'], ['Nightjar', 'NJR'], ['Brass Harbor', 'BRH'], ['Lowtide', 'LTD'], ['Ashfall', 'ASH'],
  ['Quartz Union', 'QZU'], ['Blackpine', 'BPN'], ['Sundog', 'SND'], ['Echo Valley', 'ECV'], ['Riftborn', 'RFB'],
  ['Cold Forge', 'CFG'], ['Wildcard Nine', 'WC9'], ['Silent Orbit', 'SOB'], ['Atlas Pack', 'ATP'], ['Mistral', 'MSL'],
  ['Orange Hour', 'ORH'], ['Steelhead', 'STH'], ['Tundra Five', 'TD5'], ['Glasshouse', 'GLH'], ['Ninth Gate', 'N9G'],
];

export interface AiTeam {
  id: string;
  name: string;
  tag: string;
  playerIds: string[]; // in role order of `roles`
  roles: Role[];
  coachId: string;
  chemistry: number;
  mapPractice: Record<MapName, number>;
  tendencies: TeamTendencies;
  /** Guests from another division play at that division's level. */
  sharpness?: number;
  /** Set on cup guests: the division they come from. */
  guestFrom?: string;
}

export type FixtureStage = 'league' | 'semi' | 'final' | 'cup-qf' | 'cup-sf' | 'cup-final';

export const STAGE_LABEL: Record<FixtureStage, string> = {
  league: 'League', semi: 'Semifinal', final: 'Grand final', 'cup-qf': 'Cup quarterfinal', 'cup-sf': 'Cup semifinal', 'cup-final': 'Cup final',
};

export const isCup = (stage: FixtureStage) => stage.startsWith('cup');

export interface Fixture {
  id: string;
  week: number;
  stage: FixtureStage;
  home: string; // team id ('you' for the human)
  away: string;
  format: SeriesFormat;
  result?: { winner: string; mapScore: [number, number]; maps: { map: MapName; score: [number, number] }[] };
}

export interface StandingRow { teamId: string; played: number; wins: number; losses: number; roundDiff: number; points: number }

export interface SeasonState {
  number: number;
  division: number;
  aiTeams: AiTeam[];
  fixtures: Fixture[];
  week: number; // 1..12, 13 = finished
  finished: boolean;
  placement?: number;
  /** Guest teams in this season's cup (added in week 10). */
  cupTeams?: AiTeam[];
  /** Reputation when the season started; sponsor offers are priced from it so they don't move mid-season. */
  sponsorRep?: number;
}

/** Every AI team you can meet this season: the league plus cup guests. */
export function allAiTeams(season: SeasonState): AiTeam[] {
  return [...season.aiTeams, ...(season.cupTeams ?? [])];
}

export const HUMAN_ID = 'you';
export const LEAGUE_WEEKS = 7;
export const PLAYOFF_END = 9;
export const CUP_START = 10;
export const SEASON_WEEKS = 12;
export const CUP_NAME = 'Clutch Cup';
/** Cup prize as a multiple of the division's win reward: winner, finalist, semifinal, quarterfinal. */
export const CUP_PRIZE = [6, 3, 1.5, 0.5];

function randomTendencies(rng: Rng): TeamTendencies {
  const style = rng.int(0, 3);
  const t = style === 0 ? { default: 3, execute: 1, rush: 0.5 } : style === 1 ? { default: 1, execute: 3, rush: 0.7 } : style === 2 ? { default: 1, execute: 1, rush: 2.5 } : { default: 1.5, execute: 1.5, rush: 1 };
  const cstyle = rng.int(0, 3);
  const ct = cstyle === 0 ? { standard: 3, stack: 0.5, retake: 1, aggro: 0.7 } : cstyle === 1 ? { standard: 1, stack: 0.6, retake: 3, aggro: 0.5 } : cstyle === 2 ? { standard: 1, stack: 0.8, retake: 0.6, aggro: 3 } : { standard: 2, stack: 1.5, retake: 1, aggro: 1 };
  return { t, ct, aSiteBias: Number(rng.range(0.3, 0.75).toFixed(2)) };
}

export function generateAiTeams(rng: Rng, division: Division, profiles: PlayerProfile[], coaches: Coach[], count = 7, excludeTags: string[] = []): AiTeam[] {
  const [lo, hi] = division.rankRange;
  const pool = profiles.filter((p) => p.record.rank >= lo && p.record.rank <= hi);
  const used = new Set<string>();
  const names = rng.shuffle(ORG_NAMES.filter(([, tag]) => !excludeTags.includes(tag))).slice(0, count);
  const teams: AiTeam[] = [];
  for (let i = 0; i < count; i++) {
    // Teams get progressively weaker slices of the range so the table has a spread.
    const sliceStart = Math.floor((i / count) * pool.length * 0.6);
    const slice = [...pool].sort((a, b) => a.record.rank - b.record.rank).slice(sliceStart);
    const playerIds: string[] = [];
    for (const role of ROLES) {
      const candidates = slice.filter((p) => !used.has(p.record.id) && p.record.primaryRole === role);
      const fallback = slice.filter((p) => !used.has(p.record.id) && p.record.secondaryRole === role);
      const any = slice.filter((p) => !used.has(p.record.id));
      const choiceList = candidates.length ? candidates.slice(0, 6) : fallback.length ? fallback.slice(0, 6) : any.slice(0, 6);
      const pick = rng.pick(choiceList.length ? choiceList : profiles.filter((p) => !used.has(p.record.id)));
      used.add(pick.record.id);
      playerIds.push(pick.record.id);
    }
    const mapPractice = {} as Record<MapName, number>;
    const favourites = rng.shuffle(MAPS).slice(0, 3);
    for (const m of MAPS) mapPractice[m] = favourites.includes(m) ? rng.int(60, 85) : rng.int(25, 55);
    const coachPool = coaches.filter((c) => (division.id >= 2 ? true : c.hireCost < 1500));
    const [name, tag] = names[i]!;
    teams.push({
      id: `ai-${tag.toLowerCase()}`,
      name,
      tag,
      playerIds,
      roles: [...ROLES],
      coachId: rng.pick(coachPool.length ? coachPool : coaches).id,
      chemistry: rng.int(45, 80),
      mapPractice,
      tendencies: randomTendencies(rng),
    });
  }
  return teams;
}

/** Circle-method round robin for 8 teams: 7 weeks, 4 matches each. */
export function roundRobin(teamIds: string[]): [string, string][][] {
  const ids = [...teamIds];
  const n = ids.length;
  const weeks: [string, string][][] = [];
  for (let w = 0; w < n - 1; w++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]!;
      const b = ids[n - 1 - i]!;
      pairs.push(w % 2 === 0 ? [a, b] : [b, a]);
    }
    weeks.push(pairs);
    ids.splice(1, 0, ids.pop()!);
  }
  return weeks;
}

export function newSeason(rng: Rng, number: number, divisionId: number, profiles: PlayerProfile[], coaches: Coach[]): SeasonState {
  const division = DIVISIONS[divisionId]!;
  const aiTeams = generateAiTeams(rng, division, profiles, coaches);
  const ids = [HUMAN_ID, ...aiTeams.map((t) => t.id)];
  const fixtures: Fixture[] = [];
  roundRobin(rng.shuffle(ids)).forEach((pairs, wi) => {
    pairs.forEach(([home, away], pi) => fixtures.push({ id: `s${number}-w${wi + 1}-${pi}`, week: wi + 1, stage: 'league', home, away, format: 'bo1' }));
  });
  return { number, division: divisionId, aiTeams, fixtures, week: 1, finished: false };
}

export function standings(season: SeasonState): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  const ids = [HUMAN_ID, ...season.aiTeams.map((t) => t.id)];
  for (const id of ids) rows.set(id, { teamId: id, played: 0, wins: 0, losses: 0, roundDiff: 0, points: 0 });
  for (const f of season.fixtures) {
    if (f.stage !== 'league' || !f.result) continue;
    const h = rows.get(f.home)!;
    const a = rows.get(f.away)!;
    h.played++; a.played++;
    const rd = f.result.maps.reduce((s, m) => s + m.score[0] - m.score[1], 0);
    h.roundDiff += rd; a.roundDiff -= rd;
    if (f.result.winner === f.home) { h.wins++; h.points += 3; a.losses++; } else { a.wins++; a.points += 3; h.losses++; }
  }
  return [...rows.values()].sort((x, y) => y.points - x.points || y.roundDiff - x.roundDiff || x.teamId.localeCompare(y.teamId));
}

/** Adds playoff fixtures once the league is over. */
export function schedulePlayoffs(season: SeasonState): void {
  const table = standings(season);
  if (season.week === LEAGUE_WEEKS + 1 && !season.fixtures.some((f) => f.stage === 'semi')) {
    const [a, b, c, d] = table.slice(0, 4).map((r) => r.teamId) as [string, string, string, string];
    season.fixtures.push({ id: `s${season.number}-sf1`, week: 8, stage: 'semi', home: a, away: d, format: 'bo3' });
    season.fixtures.push({ id: `s${season.number}-sf2`, week: 8, stage: 'semi', home: b, away: c, format: 'bo3' });
  }
  if (season.week === LEAGUE_WEEKS + 2 && !season.fixtures.some((f) => f.stage === 'final')) {
    const semis = season.fixtures.filter((f) => f.stage === 'semi');
    const w1 = semis[0]?.result?.winner;
    const w2 = semis[1]?.result?.winner;
    if (w1 && w2) season.fixtures.push({ id: `s${season.number}-final`, week: 9, stage: 'final', home: w1, away: w2, format: 'bo3' });
  }
}

/** Final placement 1..8: champion, finalist, semifinalists by league position, then league order. */
export function finalPlacements(season: SeasonState): string[] {
  const table = standings(season).map((r) => r.teamId);
  const final = season.fixtures.find((f) => f.stage === 'final');
  const semis = season.fixtures.filter((f) => f.stage === 'semi');
  if (!final?.result) return table;
  const champion = final.result.winner;
  const finalist = final.home === champion ? final.away : final.home;
  const semiLosers = semis.map((s) => (s.result!.winner === s.home ? s.away : s.home)).sort((a, b) => table.indexOf(a) - table.indexOf(b));
  const top = [champion, finalist, ...semiLosers];
  return [...top, ...table.filter((t) => !top.includes(t))];
}

export function seriesToFixtureResult(f: Fixture, series: SeriesResult): Fixture['result'] {
  return {
    winner: series.winner === 0 ? f.home : f.away,
    mapScore: series.mapScore,
    maps: series.maps.map((m) => ({ map: m.map, score: m.score })),
  };
}

/**
 * Builds the cup quarterfinals (week 10). `hosts` are the league's top 4 plus
 * you if you finished lower (replacing the 4th), in final league order;
 * guests are sorted strongest first. The best host meets the weakest guest.
 */
export function scheduleCupQuarterfinals(season: SeasonState, guests: AiTeam[], guestStrength: (t: AiTeam) => number): void {
  if (season.fixtures.some((f) => f.stage === 'cup-qf')) return;
  const order = finalPlacements(season);
  let hosts = order.slice(0, 4);
  if (!hosts.includes(HUMAN_ID)) hosts = [...hosts.slice(0, 3), HUMAN_ID];
  const sorted = [...guests].sort((a, b) => guestStrength(b) - guestStrength(a));
  season.cupTeams = sorted;
  hosts.forEach((h, i) => {
    season.fixtures.push({ id: `s${season.number}-cqf${i + 1}`, week: CUP_START, stage: 'cup-qf', home: h, away: sorted[3 - i]!.id, format: 'bo3' });
  });
}

/** Adds the next cup round once the previous one has results. */
export function advanceCup(season: SeasonState): void {
  const winners = (stage: FixtureStage) => season.fixtures.filter((f) => f.stage === stage).map((f) => f.result?.winner);
  if (season.week === CUP_START + 1 && !season.fixtures.some((f) => f.stage === 'cup-sf')) {
    const w = winners('cup-qf');
    if (w.length === 4 && w.every(Boolean)) {
      season.fixtures.push({ id: `s${season.number}-csf1`, week: CUP_START + 1, stage: 'cup-sf', home: w[0]!, away: w[3]!, format: 'bo3' });
      season.fixtures.push({ id: `s${season.number}-csf2`, week: CUP_START + 1, stage: 'cup-sf', home: w[1]!, away: w[2]!, format: 'bo3' });
    }
  }
  if (season.week === CUP_START + 2 && !season.fixtures.some((f) => f.stage === 'cup-final')) {
    const w = winners('cup-sf');
    if (w.length === 2 && w.every(Boolean)) season.fixtures.push({ id: `s${season.number}-cfinal`, week: CUP_START + 2, stage: 'cup-final', home: w[0]!, away: w[1]!, format: 'bo3' });
  }
}

/** How far a team got in the cup: 1 winner, 2 finalist, 3 semifinal, 4 quarterfinal, null not in it. */
export function cupResult(season: SeasonState, teamId: string): 1 | 2 | 3 | 4 | null {
  const cup = season.fixtures.filter((f) => isCup(f.stage) && (f.home === teamId || f.away === teamId));
  if (!cup.length) return null;
  const final = cup.find((f) => f.stage === 'cup-final');
  if (final?.result) return final.result.winner === teamId ? 1 : 2;
  if (final) return 2;
  if (cup.some((f) => f.stage === 'cup-sf')) return 3;
  return 4;
}
