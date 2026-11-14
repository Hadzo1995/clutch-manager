import type { SeriesResult } from '../../engine/match';
import { settleMatch } from '../../engine/tournament';
import type { TEntry, TMatch, TResult, Tournament } from '../../engine/tournament';
import { runSim } from '../simWorker';

type Done = { series: SeriesResult; result: TResult };

/** Plays one tournament match, in a background thread when the browser allows it. */
export function settle(t: Tournament, m: TMatch, home: TEntry, away: TEntry, by: string): Promise<Done> {
  const now = Date.now();
  return runSim<Done>('tournament', [t, m, home, away, by, now], () => settleMatch(t, m, home, away, by, now));
}
