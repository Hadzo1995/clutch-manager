/**
 * Settles tournament and league matches off the main thread (a Bo3 takes a second or two).
 * One worker for both: each inlined worker bundles the whole match engine, so sharing it keeps
 * one copy of the engine in the download instead of two.
 */
import { settleMatch as settleTournament } from '../engine/tournament';
import { settleMatch as settleLeague } from '../engine/league';

self.onmessage = (e: MessageEvent) => {
  const { id, kind, args } = e.data as { id: number; kind: 'tournament' | 'league'; args: unknown[] };
  try {
    const run = (kind === 'tournament' ? settleTournament : settleLeague) as (...a: unknown[]) => object;
    postMessage({ id, ...run(...args) });
  } catch (err) {
    postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
