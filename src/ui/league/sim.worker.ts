/** Settles league matches off the main thread (a Bo3 takes a second or two). */
import { settleMatch } from '../../engine/league';

self.onmessage = (e: MessageEvent) => {
  const { id, l, m, home, away, by, now } = e.data;
  try {
    postMessage({ id, ...settleMatch(l, m, home, away, by, now) });
  } catch (err) {
    postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
