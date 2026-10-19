import type { SeriesResult } from '../../engine/match';
import { settleMatch } from '../../engine/tournament';
import type { TEntry, TMatch, TResult, Tournament } from '../../engine/tournament';
import SimWorker from './sim.worker?worker&inline';

type Done = { series: SeriesResult; result: TResult };
let worker: Worker | null | undefined;
const waiting = new Map<number, { ok: (d: Done) => void; fail: (e: Error) => void }>();
let nextId = 1;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new SimWorker();
    worker.onmessage = (e: MessageEvent) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.fail(new Error(e.data.error)); else w.ok({ series: e.data.series, result: e.data.result });
    };
    worker.onerror = () => { worker = null; for (const w of waiting.values()) w.fail(new Error('Match engine stopped.')); waiting.clear(); };
  } catch {
    worker = null; // no workers here: settle on the page itself
  }
  return worker;
}

/** Plays one tournament match, in a background thread when the browser allows it. */
export function settle(t: Tournament, m: TMatch, home: TEntry, away: TEntry, by: string): Promise<Done> {
  const now = Date.now();
  const w = getWorker();
  if (!w) return new Promise((ok, fail) => setTimeout(() => { try { ok(settleMatch(t, m, home, away, by, now)); } catch (e) { fail(e as Error); } }, 0));
  const id = nextId++;
  return new Promise((ok, fail) => { waiting.set(id, { ok, fail }); w.postMessage({ id, t, m, home, away, by, now }); });
}
