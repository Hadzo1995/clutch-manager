/**
 * Closed beta access (supabase/beta.sql). The database decides: while its beta_settings row
 * exists, only accounts that redeemed an invite code play, inside the beta window.
 * Builds without Supabase, and databases where beta.sql was never run, have no gate.
 */
import { onlineAvailable, supa } from './supa';

export interface BetaStatus {
  gate: boolean;
  startsAt: number;
  endsAt: number;
  maxPlayers: number;
  players: number;
  invited: boolean;
  /** The database clock when asked, so a wrong device clock can't open or close the beta. */
  now: number;
}

export type BetaAccess =
  | { kind: 'open' }
  | { kind: 'signed-out'; s: BetaStatus }
  | { kind: 'need-code'; s: BetaStatus; reason?: string }
  | { kind: 'not-started'; s: BetaStatus }
  | { kind: 'ended'; s: BetaStatus }
  | { kind: 'in'; s: BetaStatus }
  | { kind: 'offline' };

const CACHE = 'clutch-manager.beta';
const PENDING = 'clutch-manager.beta-code';
/** Why the code typed at sign-up didn't work, shown on the enter-code screen. */
let pendingError: string | undefined;
export const SURVEYS = { week2: 14, final: 26 } as const;
export type SurveyId = keyof typeof SURVEYS;

function read(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function write(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } }

export async function betaStatus(): Promise<BetaStatus | null> {
  const sb = await supa();
  const { data, error } = await sb.rpc('beta_status');
  if (error) {
    // The function doesn't exist: beta.sql isn't installed, so there is no beta gate.
    if (error.code === 'PGRST202' || /could not find the function|does not exist/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  const d = data as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : 0);
  return {
    gate: d.gate === true, startsAt: t(d.starts_at), endsAt: t(d.ends_at), maxPlayers: Number(d.max_players ?? 0),
    players: Number(d.players ?? 0), invited: d.invited === true, now: t(d.now) || Date.now(),
  };
}

/** Which screen the player gets. Remembers a granted place, so a player who loses the connection keeps playing the career. */
export async function betaAccess(signedIn: boolean): Promise<BetaAccess> {
  if (!onlineAvailable()) return { kind: 'open' };
  let s: BetaStatus | null;
  try { s = await betaStatus(); } catch {
    const cached = Number(read(CACHE) ?? 0);
    return cached > Date.now() ? { kind: 'in', s: { gate: true, startsAt: 0, endsAt: cached, maxPlayers: 0, players: 0, invited: true, now: Date.now() } } : { kind: 'offline' };
  }
  if (!s || !s.gate) { write(CACHE, null); return { kind: 'open' }; }
  if (!signedIn) return { kind: 'signed-out', s };
  if (!s.invited) {
    // A code typed at sign-up is redeemed here, once the new account has its first session.
    const pending = read(PENDING);
    if (!pending) return { kind: 'need-code', s, reason: pendingError };
    write(PENDING, null); // taken before the await, so a second check running alongside doesn't try it again
    const r = await redeemInvite(pending);
    if (r.ok) return betaAccess(true);
    pendingError = r.reason;
    return { kind: 'need-code', s, reason: r.reason };
  }
  if (s.now < s.startsAt) return { kind: 'not-started', s };
  if (s.now >= s.endsAt) { write(CACHE, null); return { kind: 'ended', s }; }
  write(CACHE, String(s.endsAt));
  return { kind: 'in', s };
}

/** Keeps the code for after the email confirmation, when the new account first signs in. */
export function rememberInvite(code: string) { write(PENDING, code.trim() || null); }

export async function redeemInvite(code: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const sb = await supa();
    const { data, error } = await sb.rpc('beta_redeem', { invite: code });
    if (!error && data === 'ok') { write(PENDING, null); pendingError = undefined; return { ok: true }; }
    const reason = error?.message ?? String(data ?? '');
    if (/already used|full|ended/i.test(reason)) write(PENDING, null);
    return { ok: false, reason: /fetch|network/i.test(reason) ? 'Can’t reach the game server. Check your connection.' : reason || 'That code didn’t work.' };
  } catch {
    return { ok: false, reason: 'Can’t reach the game server. Check your connection.' };
  }
}

/** One play session for today, for the daily players count. Best effort. */
export async function betaPing(): Promise<void> {
  try { const sb = await supa(); await sb.rpc('beta_ping'); } catch { /* not worth bothering the player */ }
}

export const betaDay = (s: BetaStatus, now = Date.now()) => Math.max(1, Math.floor((now - s.startsAt) / 86_400_000) + 1);
export const betaDays = (s: BetaStatus) => Math.max(1, Math.round((s.endsAt - s.startsAt) / 86_400_000));

/** The survey due on this beta day that the player hasn't answered or dismissed, if any. */
export function dueSurvey(s: BetaStatus, now = Date.now()): SurveyId | null {
  const day = betaDay(s, now);
  const due = (Object.keys(SURVEYS) as SurveyId[]).filter((id) => day >= SURVEYS[id]).pop();
  return due && !read(`${CACHE}.survey.${due}`) ? due : null;
}
export function markSurvey(id: SurveyId) { write(`${CACHE}.survey.${id}`, '1'); }

export async function sendSurvey(id: SurveyId, answers: Record<string, string | number>): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const sb = await supa();
    const { data } = await sb.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return { ok: false, reason: 'Sign in again to send the survey.' };
    const { error } = await sb.from('beta_surveys').insert({ user_id: uid, survey: id, answers });
    if (error && !/duplicate/i.test(error.message)) return { ok: false, reason: 'Sending failed. Check your connection and try again.' };
    markSurvey(id);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Sending failed. Check your connection and try again.' };
  }
}
