/**
 * Beta ladder: one month-long ranking for all beta players (supabase/beta.sql has the
 * ratings and the match records). A challenge is a Bo1 between the challenger's career team
 * and the defender's last published team, from a seed the database picks, so anyone holding
 * the two teams and the seed can re-run it and get the same result.
 * Bots are AI teams from the challenger's own league, renamed to the bot's ladder name.
 */
import type { Career, World } from './career';
import { aiSnapshot, humanSnapshot } from './career';
import { simulateSeries } from './match';
import type { SeriesResult } from './match';
import { pvpTeam, resultHash, summarize } from './pvp';
import type { PvpSummary } from './pvp';
import { allAiTeams } from './season';
import type { TeamSnapshot } from './team';
import { MAPS } from './types';
import type { MapName } from './types';

/** The team a manager publishes to the ladder: their career team with opponent preparation switched off. */
export function ladderTeam(world: World, c: Career): TeamSnapshot {
  return { ...humanSnapshot(world, c), prepBonus: 0 };
}

/** A bot's team: one of the challenger's league rivals, under the bot's name. */
export function botTeam(world: World, c: Career, slot: number, name: string, tag: string): TeamSnapshot {
  const teams = allAiTeams(c.season);
  const t = teams[slot % teams.length]!;
  return { ...aiSnapshot(world, c, t), name, tag, prepBonus: 0 };
}

/** The map follows from the seed, so it is fixed when the challenge starts. */
export function ladderMap(seed: number): MapName {
  return MAPS[seed % MAPS.length]!;
}

export interface LadderResult {
  seed: number;
  series: SeriesResult;
  teams: [TeamSnapshot, TeamSnapshot];
  map: MapName;
  won: boolean;
  summary: PvpSummary;
  hash: string;
}

/** Plays a ladder challenge. The challenger is always side 0. */
export function playLadder(seed: number, challenger: TeamSnapshot, defender: TeamSnapshot): LadderResult {
  const teams: [TeamSnapshot, TeamSnapshot] = [pvpTeam(challenger, 0), pvpTeam(defender, 1)];
  const map = ladderMap(seed);
  const series = simulateSeries(seed, teams, [map], 'bo1');
  return { seed, series, teams, map, won: series.winner === 0, summary: summarize(series, teams), hash: resultHash(series) };
}

/** Elo expectation and the points a result moves, matching ladder_challenge / ladder_report. */
export function eloExpected(me: number, them: number): number {
  return 1 / (1 + 10 ** ((them - me) / 400));
}
export function eloSwing(me: number, them: number): { win: number; loss: number } {
  const e = eloExpected(me, them);
  return { win: Math.max(1, Math.round(32 * (1 - e))), loss: -Math.max(1, Math.round(32 * e)) };
}
