/** Runs tournament and league matches in the shared background worker (see sim.worker.ts). */
import SimWorker from './sim.worker?worker&inline';

let worker: Worker | null | undefined;
const waiting = new Map<number, { ok: (d: unknown) => void; fail: (e: Error) => void }>();
let nextId = 1;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new SimWorker();
    worker.onmessage = (e: MessageEvent) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.fail(new Error(e.data.error));
      else { const { id: _id, ...rest } = e.data; w.ok(rest); }
    };
    worker.onerror = () => { worker = null; for (const w of waiting.values()) w.fail(new Error('Match engine stopped.')); waiting.clear(); };
  } catch {
    worker = null; // no workers here: settle on the page itself
  }
  return worker;
}

/** Runs `kind`'s settleMatch(...args) in the worker, or `local()` on the page when workers are unavailable. */
export function runSim<T>(kind: 'tournament' | 'league', args: unknown[], local: () => T): Promise<T> {
  const w = getWorker();
  if (!w) return new Promise((ok, fail) => setTimeout(() => { try { ok(local()); } catch (e) { fail(e as Error); } }, 0));
  const id = nextId++;
  return new Promise((ok, fail) => { waiting.set(id, { ok: ok as (d: unknown) => void, fail }); w.postMessage({ id, kind, args }); });
}
