/**
 * Cloud copy of the career for beta players (beta_saves in supabase/beta.sql), so a career
 * follows its manager between devices. The browser save stays the one the game plays from:
 * on start the newer of the two copies wins, then every save is sent up a few seconds later.
 */
import { onCareerStored, rawSave, storeRawSave } from '../ui/persist';
import { supa } from './supa';

const savedAt = (raw: string | null): number => {
  if (!raw) return 0;
  const m = /"savedAt":"([^"]+)"/.exec(raw.slice(0, 200));
  return m ? Date.parse(m[1]!) || 0 : 0;
};

/** Brings the cloud copy into this browser when it is newer. Gives up after a few seconds and keeps the local one. */
export async function pullCloudSave(timeoutMs = 6000): Promise<'cloud' | 'local' | 'none'> {
  const work = (async () => {
    const sb = await supa();
    const { data: s } = await sb.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return 'none' as const;
    const { data, error } = await sb.from('beta_saves').select('data, saved_at').eq('user_id', uid).maybeSingle();
    if (error || !data) return 'none' as const;
    const local = rawSave();
    if (Date.parse(data.saved_at as string) > savedAt(local)) { storeRawSave(data.data as string); return 'cloud' as const; }
    return 'local' as const;
  })();
  const timeout = new Promise<'none'>((r) => setTimeout(() => r('none'), timeoutMs));
  try { return await Promise.race([work, timeout]); } catch { return 'none'; }
}

/** Sends each save up (debounced), and deletes the cloud copy when the career is reset. Returns a stop function. */
export function startCloudSave(delayMs = 4000): () => void {
  let timer: number | undefined;
  let pending: string | null | undefined;
  const flush = async () => {
    window.clearTimeout(timer); timer = undefined;
    if (pending === undefined) return;
    const raw = pending; pending = undefined;
    try {
      const sb = await supa();
      const { data: s } = await sb.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) return;
      if (raw === null) await sb.from('beta_saves').delete().eq('user_id', uid);
      else await sb.from('beta_saves').upsert({ user_id: uid, data: raw, saved_at: new Date(savedAt(raw) || Date.now()).toISOString(), updated_at: new Date().toISOString() });
    } catch { /* the next save tries again */ }
  };
  const off = onCareerStored((raw) => {
    pending = raw;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void flush(); }, raw === null ? 0 : delayMs);
  });
  const hide = () => { if (document.visibilityState === 'hidden') void flush(); };
  document.addEventListener('visibilitychange', hide);
  // A career that exists only in this browser (made before the beta, or offline) goes up once.
  const local = rawSave();
  if (local) { pending = local; timer = window.setTimeout(() => { void flush(); }, delayMs); }
  return () => { off(); document.removeEventListener('visibilitychange', hide); void flush(); };
}
