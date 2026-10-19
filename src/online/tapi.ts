/**
 * Beta tournament storage on Supabase. The tables and the rules that keep
 * the tournament fair are in supabase/schema.sql; this file only reads and
 * writes them and turns rows back into the engine's types.
 *
 * Nothing read from the server is trusted blindly: entries are checked
 * against the schedule and the seat list, and results are recomputed in
 * every browser (see verifyResult).
 */
import type { Career } from '../engine/career';
import { deserializeCareer, serializeCareer } from '../engine/save';
import { SETTLE_DELAY_MS, firstKickoff, kickoffAt, slotFor } from '../engine/tournament';
import type { Seat, SeatInfo, TEntry, TResult, Tournament } from '../engine/tournament';
import { nowMs, supa } from './supa';

type Fail = { ok: false; reason: string };

interface TournamentRow { id: string; owner_id: string; first_kickoff: string; data: Tournament }
interface SeatRow { tournament_id: string; seat: number; user_id: string; info: Omit<SeatInfo, 'userId' | 'joinedAt'>; joined_at: string }
interface EntryRow { id: number; tournament_id: string; seat: number; user_id: string; slot: number; kickoff_at: string; submitted_at: string; data: Pick<TEntry, 'team' | 'teamHash' | 'mapPrefs'> }
interface ResultRow { tournament_id: string; match_id: string; data: TResult; created_by: string }

function errText(e: { message?: string; code?: string } | null | undefined): string {
  const m = e?.message ?? '';
  if (/already started/i.test(m)) return m;
  if (/fetch|network/i.test(m)) return 'Can’t reach the game server. Check your connection.';
  if (/JWT|not authenticated|permission|row-level security/i.test(m)) return 'Your sign-in has expired or you don’t have access. Sign in again.';
  return m || 'Something went wrong. Try again.';
}

function withSeats(row: TournamentRow, seats: SeatRow[]): Tournament {
  const t: Tournament = { ...row.data, id: row.id, ownerId: row.owner_id, seats: [null, null, null, null] };
  for (const s of seats) {
    if (s.seat < 0 || s.seat > 3) continue;
    t.seats[s.seat] = { manager: String(s.info?.manager ?? 'Manager').slice(0, 24), team: String(s.info?.team ?? `Team ${s.seat + 1}`).slice(0, 22), tag: String(s.info?.tag ?? 'TBD').slice(0, 4), userId: s.user_id, joinedAt: Date.parse(s.joined_at) };
  }
  return t;
}

export async function loadTournament(id: string): Promise<Tournament | null> {
  const sb = await supa();
  const [t, s] = await Promise.all([
    sb.from('tournaments').select('*').eq('id', id).maybeSingle(),
    sb.from('tournament_seats').select('*').eq('tournament_id', id),
  ]);
  if (t.error) throw new Error(errText(t.error));
  if (s.error) throw new Error(errText(s.error));
  return t.data ? withSeats(t.data as TournamentRow, (s.data ?? []) as SeatRow[]) : null;
}

/** Tournaments this account has a seat in, newest first. */
export async function myTournaments(userId: string): Promise<Tournament[]> {
  const sb = await supa();
  const mine = await sb.from('tournament_seats').select('tournament_id').eq('user_id', userId);
  if (mine.error) throw new Error(errText(mine.error));
  const ids = (mine.data ?? []).map((r) => r.tournament_id as string);
  if (!ids.length) return [];
  const [t, s] = await Promise.all([
    sb.from('tournaments').select('*').in('id', ids),
    sb.from('tournament_seats').select('*').in('tournament_id', ids),
  ]);
  if (t.error) throw new Error(errText(t.error));
  if (s.error) throw new Error(errText(s.error));
  const seats = (s.data ?? []) as SeatRow[];
  return ((t.data ?? []) as TournamentRow[]).map((row) => withSeats(row, seats.filter((x) => x.tournament_id === row.id))).sort((a, b) => b.createdAt - a.createdAt);
}

const seatInfo = (i: SeatInfo) => ({ manager: i.manager, team: i.team, tag: i.tag });

export async function createTournament(t: Tournament): Promise<{ ok: true } | Fail> {
  const sb = await supa();
  const owner = t.seats[0];
  if (!owner) return { ok: false, reason: 'The organiser takes the first seat.' };
  const ins = await sb.from('tournaments').insert({ id: t.id, owner_id: t.ownerId, first_kickoff: new Date(firstKickoff(t)).toISOString(), data: { ...t, seats: [] } });
  if (ins.error) return { ok: false, reason: ins.error.code === '23505' ? 'That code is taken. Try again.' : errText(ins.error) };
  const seat = await sb.from('tournament_seats').insert({ tournament_id: t.id, seat: 0, user_id: t.ownerId, info: seatInfo(owner) });
  return seat.error ? { ok: false, reason: errText(seat.error) } : { ok: true };
}

/** Takes the first free seat. Two friends joining at once both end up seated or told it's full. */
export async function joinTournament(id: string, me: SeatInfo): Promise<{ ok: true; seat: Seat } | Fail> {
  const sb = await supa();
  for (let attempt = 0; attempt < 4; attempt++) {
    const t = await loadTournament(id);
    if (!t) return { ok: false, reason: 'No tournament with that code.' };
    const already = t.seats.findIndex((s) => s?.userId === me.userId);
    if (already >= 0) return { ok: true, seat: already as Seat };
    if (nowMs() >= firstKickoff(t)) return { ok: false, reason: 'This tournament has already started.' };
    const free = t.seats.findIndex((s) => !s);
    if (free < 0) return { ok: false, reason: 'All four seats are taken.' };
    const r = await sb.from('tournament_seats').insert({ tournament_id: id, seat: free, user_id: me.userId, info: seatInfo(me) });
    if (!r.error) return { ok: true, seat: free as Seat };
    if (r.error.code !== '23505') return { ok: false, reason: errText(r.error) };
    // Someone took that seat a moment ago (or this account joined from another tab): look again.
  }
  return { ok: false, reason: 'Couldn’t get a seat. Try again.' };
}

/** The organiser can move the start date until the first kickoff. */
export async function updateTournament(t: Tournament): Promise<{ ok: true } | Fail> {
  const sb = await supa();
  const r = await sb.from('tournaments').update({ first_kickoff: new Date(firstKickoff(t)).toISOString(), data: { ...t, seats: [] } }).eq('id', t.id).select('id');
  if (r.error) return { ok: false, reason: errText(r.error) };
  return r.data?.length ? { ok: true } : { ok: false, reason: 'Only the organiser can change this, and only before it starts.' };
}

// ---------------------------------------------------------------- entries

/**
 * Sends a lineup and map preferences for the next kickoff. The database stamps
 * the time and refuses a kickoff that has started; if this device's clock is
 * a little behind, the entry moves on to the following kickoff.
 */
export async function submitEntry(t: Tournament, e: TEntry): Promise<{ ok: true; slot: number } | Fail> {
  const sb = await supa();
  let slot = slotFor(t, nowMs());
  if (slot === null) return { ok: false, reason: 'The tournament is over.' };
  for (let attempt = 0; attempt < 2 && slot < t.days * t.kickoffs.length; attempt++, slot++) {
    const r = await sb.from('tournament_entries').insert({
      tournament_id: t.id, seat: e.seat, user_id: e.userId, slot,
      kickoff_at: new Date(kickoffAt(t, slot)).toISOString(),
      data: { team: e.team, teamHash: e.teamHash, mapPrefs: e.mapPrefs },
    });
    if (!r.error) return { ok: true, slot };
    if (!/already started/i.test(r.error.message)) return { ok: false, reason: errText(r.error) };
  }
  return { ok: false, reason: 'That kickoff has already started.' };
}

function toEntry(t: Tournament, r: EntryRow): TEntry | null {
  // Rows that don't fit the schedule or the seat list are ignored, whatever they contain.
  if (r.slot < 0 || r.slot >= t.days * t.kickoffs.length) return null;
  if (Math.abs(Date.parse(r.kickoff_at) - kickoffAt(t, r.slot)) > 1000) return null;
  if (t.seats[r.seat]?.userId !== r.user_id) return null;
  if (!r.data?.team || !Array.isArray(r.data.mapPrefs)) return null;
  return { seat: r.seat as Seat, userId: r.user_id, slot: r.slot, submittedAt: Date.parse(r.submitted_at), team: r.data.team, teamHash: r.data.teamHash, mapPrefs: r.data.mapPrefs };
}

interface EntryCache { upTo: number; entries: TEntry[] }
const cacheKey = (id: string, userId: string) => `clutch-manager.t.${id}.${userId}.entries`;

function readCache(id: string, userId: string): EntryCache {
  try {
    const raw = localStorage.getItem(cacheKey(id, userId));
    if (raw) return JSON.parse(raw) as EntryCache;
  } catch { /* storage blocked: fetch everything */ }
  return { upTo: -1, entries: [] };
}

/**
 * Every entry this account may see: its own, and everyone's once their kickoff
 * has passed. Entries never change after kickoff, so settled kickoffs are kept
 * on this device and not fetched again.
 */
export async function fetchEntries(t: Tournament, userId: string): Promise<TEntry[]> {
  const sb = await supa();
  const cache = readCache(t.id, userId);
  const rows: EntryRow[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from('tournament_entries').select('*').eq('tournament_id', t.id).gt('slot', cache.upTo).order('id').range(from, from + 999);
    if (r.error) throw new Error(errText(r.error));
    rows.push(...((r.data ?? []) as EntryRow[]));
    if ((r.data ?? []).length < 1000) break;
  }
  const fresh = rows.map((r) => toEntry(t, r)).filter((e): e is TEntry => !!e);
  // A kickoff counts as settled once its results are due everywhere.
  let upTo = cache.upTo;
  const total = t.days * t.kickoffs.length;
  while (upTo + 1 < total && kickoffAt(t, upTo + 1) + SETTLE_DELAY_MS <= nowMs()) upTo++;
  const keep: EntryCache = { upTo, entries: [...cache.entries, ...fresh.filter((e) => e.slot <= upTo)] };
  try { localStorage.setItem(cacheKey(t.id, userId), JSON.stringify(keep)); } catch { /* fine: refetch next time */ }
  return [...cache.entries, ...fresh];
}

// ---------------------------------------------------------------- results

export async function fetchResults(t: Tournament): Promise<{ results: Record<string, TResult>; flags: { matchId: string; userId: string; agrees: boolean }[] }> {
  const sb = await supa();
  const [r, f] = await Promise.all([
    sb.from('tournament_results').select('*').eq('tournament_id', t.id),
    sb.from('tournament_flags').select('*').eq('tournament_id', t.id),
  ]);
  if (r.error) throw new Error(errText(r.error));
  if (f.error) throw new Error(errText(f.error));
  const results: Record<string, TResult> = {};
  for (const row of (r.data ?? []) as ResultRow[]) if (row.data?.matchId === row.match_id) results[row.match_id] = row.data;
  return { results, flags: (f.data ?? []).map((x) => ({ matchId: x.match_id as string, userId: x.user_id as string, agrees: !!x.agrees })) };
}

/** Stores a result unless someone already did (the first one stays). */
export async function storeResult(t: Tournament, r: TResult, userId: string): Promise<void> {
  const sb = await supa();
  const ins = await sb.from('tournament_results').upsert({ tournament_id: t.id, match_id: r.matchId, data: r, created_by: userId }, { onConflict: 'tournament_id,match_id', ignoreDuplicates: true });
  if (ins.error && ins.error.code !== '23505') throw new Error(errText(ins.error));
}

export async function flagResult(t: Tournament, matchId: string, userId: string, agrees: boolean): Promise<void> {
  const sb = await supa();
  const ins = await sb.from('tournament_flags').upsert({ tournament_id: t.id, match_id: matchId, user_id: userId, agrees }, { onConflict: 'tournament_id,match_id,user_id', ignoreDuplicates: true });
  if (ins.error && ins.error.code !== '23505') throw new Error(errText(ins.error));
}

// ---------------------------------------------------------------- the manager's club

export async function loadClubRemote(t: Tournament, userId: string): Promise<{ club: Career; at: number } | null> {
  const sb = await supa();
  const r = await sb.from('tournament_clubs').select('data, updated_at').eq('tournament_id', t.id).eq('user_id', userId).maybeSingle();
  if (r.error) throw new Error(errText(r.error));
  if (!r.data) return null;
  try {
    return { club: deserializeCareer(JSON.stringify(r.data.data)), at: Date.parse(r.data.updated_at as string) };
  } catch {
    return null;
  }
}

export async function saveClubRemote(t: Tournament, userId: string, club: Career): Promise<void> {
  const sb = await supa();
  const r = await sb.from('tournament_clubs').upsert({ tournament_id: t.id, user_id: userId, data: JSON.parse(serializeCareer(club)), updated_at: new Date().toISOString() });
  if (r.error) throw new Error(errText(r.error));
}

// ---------------------------------------------------------------- live updates

/** Calls `onChange` when a seat is taken, a result lands or the organiser edits the tournament. */
export async function watchTournament(id: string, onChange: () => void): Promise<() => void> {
  const sb = await supa();
  const ch = sb.channel(`t-${id}`);
  for (const table of ['tournament_seats', 'tournament_results', 'tournaments'] as const) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: table === 'tournaments' ? `id=eq.${id}` : `tournament_id=eq.${id}` }, () => onChange());
  }
  ch.subscribe();
  return () => { void sb.removeChannel(ch); };
}
