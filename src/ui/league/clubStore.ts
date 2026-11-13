/** Where a manager's league club is kept: on this device, and online so it follows them to another one. */
import type { Career } from '../../engine/career';
import { deserializeCareer, serializeCareer } from '../../engine/save';
import { nowMs } from '../../online/supa';
import { loadClubRemote, saveClubRemote } from '../../online/lapi';

const key = (id: string, uid: string) => `clutch-manager.l.${id}.${uid}.club`;

function loadLocal(id: string, uid: string): { club: Career; at: number } | null {
  try {
    const raw = localStorage.getItem(key(id, uid));
    if (!raw) return null;
    const { at, save } = JSON.parse(raw) as { at: number; save: string };
    return { club: deserializeCareer(save), at };
  } catch {
    return null;
  }
}

/** The newer of this device's copy and the online copy. */
export async function loadClub(id: string, uid: string): Promise<Career | null> {
  const local = loadLocal(id, uid);
  let remote: { club: Career; at: number } | null = null;
  try { remote = await loadClubRemote(id, uid); } catch { /* offline: use this device's copy */ }
  const best = !remote ? local : !local ? remote : remote.at > local.at + 1000 ? remote : local;
  return best?.club ?? null;
}

let timer: number | undefined;
let pending: (() => Promise<void>) | null = null;

/** Saves on this device at once and online shortly after (or at once with `now`). */
export async function saveClub(id: string, uid: string, club: Career, now = false): Promise<boolean> {
  let stored = true;
  try { localStorage.setItem(key(id, uid), JSON.stringify({ at: nowMs(), save: serializeCareer(club) })); } catch { stored = false; }
  pending = () => saveClubRemote(id, uid, club);
  window.clearTimeout(timer);
  if (now) { const p = pending; pending = null; await p(); return stored; }
  timer = window.setTimeout(() => { const p = pending; pending = null; p?.().catch(() => { /* retried with the next change */ }); }, 4000);
  return stored;
}

/** Sends any online save still waiting (when the page is being hidden). */
export function flushClub() {
  window.clearTimeout(timer);
  const p = pending; pending = null;
  p?.().catch(() => {});
}
