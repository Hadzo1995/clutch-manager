import type { SeriesResult } from '../../engine/match';
import { settleMatch } from '../../engine/league';
import type { LMatch, LResult, League } from '../../engine/league';
import type { TeamSnapshot } from '../../engine/team';
import type { MapName } from '../../engine/types';
import { runSim } from '../simWorker';

type Side = { team: TeamSnapshot; prefs: MapName[] };
type Done = { series: SeriesResult; result: LResult };

/** Plays one league match, in a background thread when the browser allows it. */
export function settle(l: League, m: LMatch, home: Side, away: Side, by: string): Promise<Done> {
  const now = Date.now();
  return runSim<Done>('league', [l, m, home, away, by, now], () => settleMatch(l, m, home, away, by, now));
}
