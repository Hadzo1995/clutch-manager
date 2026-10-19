/**
 * Connection to the game's own Supabase project (hosted builds only).
 * The URL and the public anon key come from the build environment
 * (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY); both are public by design,
 * and every rule that matters is enforced by the database (supabase/schema.sql).
 * Builds without them (the single-file artifact) simply have no online features.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';

interface Env { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }
const env: Env = (import.meta as unknown as { env?: Env }).env ?? {};

export function onlineAvailable(): boolean {
  return !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
}

let client: Promise<SupabaseClient> | null = null;

export function supa(): Promise<SupabaseClient> {
  if (!onlineAvailable()) return Promise.reject(new Error('Online play is not set up in this version of the game.'));
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'clutch-manager.auth' } }));
  return client;
}

export interface Me { id: string; email: string }

const toMe = (s: Session | null): Me | null => (s?.user ? { id: s.user.id, email: s.user.email ?? '' } : null);

export async function currentUser(): Promise<Me | null> {
  const sb = await supa();
  const { data } = await sb.auth.getSession();
  return toMe(data.session);
}

export async function onAuth(fn: (me: Me | null) => void): Promise<() => void> {
  const sb = await supa();
  const { data } = sb.auth.onAuthStateChange((_e, s) => fn(toMe(s)));
  return () => data.subscription.unsubscribe();
}

/** Plain-language versions of the auth errors players actually hit. */
function authError(e: { message?: string } | null): string {
  const m = e?.message ?? '';
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/already registered|already exists/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/password.*(6|characters)/i.test(m)) return 'Use a password of at least 6 characters.';
  if (/email.*invalid|invalid.*email/i.test(m)) return 'That email address doesn’t look right.';
  if (/not confirmed/i.test(m)) return 'This account still needs its email confirmed.';
  if (/rate|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  if (/fetch|network/i.test(m)) return 'Can’t reach the game server. Check your connection.';
  return m || 'Something went wrong. Try again.';
}

export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sb = await supa();
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  return error ? { ok: false, reason: authError(error) } : { ok: true };
}

export async function signUp(email: string, password: string): Promise<{ ok: true; needsConfirm: boolean } | { ok: false; reason: string }> {
  const sb = await supa();
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
  if (error) return { ok: false, reason: authError(error) };
  return { ok: true, needsConfirm: !data.session };
}

export async function signOut(): Promise<void> {
  const sb = await supa();
  await sb.auth.signOut();
}

// ---------------------------------------------------------------- clock

let offset = 0;
/** This device's clock corrected to the database's (the clock that decides what is on time). */
export function nowMs(): number { return Date.now() + offset; }

export async function syncClock(): Promise<void> {
  try {
    const sb = await supa();
    const t0 = Date.now();
    const { data, error } = await sb.rpc('server_time');
    const t1 = Date.now();
    if (error || typeof data !== 'string') return;
    const server = Date.parse(data);
    if (Number.isFinite(server) && t1 - t0 < 5000) offset = server - (t0 + t1) / 2;
  } catch { /* keep the device clock */ }
}
