/** Settles tournament matches off the main thread (a Bo3 takes a second or two). */
import { settleMatch } from '../../engine/tournament';

self.onmessage = (e: MessageEvent) => {
  const { id, t, m, home, away, by, now } = e.data;
  try {
    postMessage({ id, ...settleMatch(t, m, home, away, by, now) });
  } catch (err) {
    postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
