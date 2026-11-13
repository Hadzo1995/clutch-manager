/**
 * Clutch League storage on Supabase. The tables and the rules that keep the
 * league fair are in supabase/league.sql; this file only reads and writes
 * them and turns rows back into the engine's types.
 *
 * Nothing read from the server is trusted blindly: entries are checked
 * against the calendar and the seat list, and results are recomputed in
 * every browser (see verifyResult).
 */
import type { Career } from '../engine/career';
import { deserializeCareer, serializeCareer } from '../engine/save';
import { FINAL_DAY, firstKickoff, kickoffAt } from '../engine/league';
import type { LEntry, LResult, League, LeagueSeason, LeagueSeat } from '../engine/league';
import { nowMs, supa } from './supa';

type Fail = { ok: false; reason: string };

interface LeagueRow { id: string; owner_id: string; first_kickoff: string; data: League }
interface SeatRow { league_id: string; slot: number; user_id: string; info: { manager?: string; team?: string; tag?: string }; joined_at: string }
interface EntryRow { id: number; league_id: string; slot: number; user_id: string; season: number; day: number; kickoff_at: string; submitted_at: string; data: Pick<LEntry, 'team' | 'teamHash' | 'mapPrefs'> }
interface ResultRow { league_id: string; season: number; match_id: string; data: LResult; created_by: string }

function errText(e: { message?: string; code?: string } | null | undefined): string {
  const m = e?.message ?? '';
  if (/already started|seats are taken|closed|calendar/i.test(m)) return m;
  if (/fetch|network/i.test(m)) return 'Can’t reach the game server. Check your connection.';
  if (/JWT|not authenticated|permission|row-level security/i.test(m)) return 'Your sign-in has expired or you don’t have access. Sign in again.';
  return m || 'Something went wrong. Try again.';
}

const toLeague = (row: LeagueRow): League => ({ ...row.data, id: row.id, ownerId: row.owner_id });
const toSeat = (s: SeatRow): LeagueSeat => ({
  slot: s.slot, userId: s.user_id, joinedAt: Date.parse(s.joined_at),
  manager: String(s.info?.manager ?? 'Manager').slice(0, 24), team: String(s.info?.team ?? `Team ${s.slot + 1}`).slice(0, 22), tag: String(s.info?.tag ?? 'TBD').slice(0, 4),
});

export async function loadLeague(id: string): Promise<{ league: League; seats: LeagueSeat[] } | null> {
  const sb = await supa();
  const [l, s] = await Promise.all([
    sb.from('leagues').select('*').eq('id', id).maybeSingle(),
    sb.from('league_seats').select('*').eq('league_id', id),
  ]);
  if (l.error) throw new Error(errText(l.error));
  if (s.error) throw new Error(errText(s.error));
  return l.data ? { league: toLeague(l.data as LeagueRow), seats: ((s.data ?? []) as SeatRow[]).map(toSeat) } : null;
}

/** Leagues this account has a seat in, newest first. */
export async function myLeagues(userId: string): Promise<{ league: League; seats: number }[]> {
  const sb = await supa();
  const mine = await sb.from('league_seats').select('league_id').eq('user_id', userId);
  if (mine.error) throw new Error(errText(mine.error));
  const ids = (mine.data ?? []).map((r) => r.league_id as string);
  if (!ids.length) return [];
  const [l, s] = await Promise.all([
    sb.from('leagues').select('*').in('id', ids),
    sb.from('league_seats').select('league_id').in('league_id', ids),
  ]);
  if (l.error) throw new Error(errText(l.error));
  if (s.error) throw new Error(errText(s.error));
  const counts = new Map<string, number>();
  for (const r of s.data ?? []) counts.set(r.league_id as string, (counts.get(r.league_id as string) ?? 0) + 1);
  return ((l.data ?? []) as LeagueRow[]).map((row) => ({ league: toLeague(row), seats: counts.get(row.id) ?? 0 })).sort((a, b) => b.league.createdAt - a.league.createdAt);
}

const seatInfo = (s: Pick<LeagueSeat, 'manager' | 'team' | 'tag'>) => ({ manager: s.manager, team: s.team, tag: s.tag });

export async function createLeague(l: League): Promise<{ ok: true } | Fail> {
  const sb = await supa();
  const ins = await sb.from('leagues').insert({ id: l.id, owner_id: l.ownerId, first_kickoff: new Date(firstKickoff(l, 1)).toISOString(), data: l });
  if (ins.error) return { ok: false, reason: ins.error.code === '23505' ? 'That code is taken. Try again.' : errText(ins.error) };
  return { ok: true };
}

/** The owner's edits: name, prize list, seat cap, and (before season 1) the calendar. */
export async function updateLeague(l: League): Promise<{ ok: true } | Fail> {
  const sb = await supa();
  const r = await sb.from('leagues').update({ first_kickoff: new Date(firstKickoff(l, 1)).toISOString(), data: l }).eq('id', l.id).select('id');
  if (r.error) return { ok: false, reason: errText(r.error) };
  return r.data?.length ? { ok: true } : { ok: false, reason: 'Only the league owner can change this.' };
}

/** Takes the lowest free seat. Two managers joining at once both end up seated or told it's full. */
export async function joinLeague(id: string, me: Omit<LeagueSeat, 'slot' | 'joinedAt'>): Promise<{ ok: true; slot: number } | Fail> {
  const sb = await supa();
  for (let attempt = 0; attempt < 5; attempt++) {
    const got = await loadLeague(id);
    if (!got) return { ok: false, reason: 'No league with that code.' };
    const already = got.seats.find((s) => s.userId === me.userId);
    if (already) return { ok: true, slot: already.slot };
    const taken = new Set(got.seats.map((s) => s.slot));
    let free = -1;
    for (let i = 0; i < got.league.maxTeams; i++) if (!taken.has(i)) { free = i; break; }
    if (free < 0) return { ok: false, reason: `All ${got.league.maxTeams} seats are taken. Ask the owner to raise the cap.` };
    const r = await sb.from('league_seats').insert({ league_id: id, slot: free, user_id: me.userId, info: seatInfo(me) });
    if (!r.error) return { ok: true, slot: free };
    if (r.error.code !== '23505') return { ok: false, reason: errText(r.error) };
  }
  return { ok: false, reason: 'Couldn’t get a seat. Try again.' };
}

// ---------------------------------------------------------------- seasons

export async function fetchSeason(id: string, season: number): Promise<LeagueSeason | null> {
  const sb = await supa();
  const r = await sb.from('league_seasons').select('data').eq('league_id', id).eq('season', season).maybeSingle();
  if (r.error) throw new Error(errText(r.error));
  const d = r.data?.data as LeagueSeason | undefined;
  return d && d.league === id && d.season === season ? d : null;
}

/** Stores the season's line-up unless someone already did, and returns the one that stands. */
export async function storeSeason(s: LeagueSeason, userId: string): Promise<LeagueSeason> {
  const sb = await supa();
  const ins = await sb.from('league_seasons').upsert({ league_id: s.league, season: s.season, data: s, created_by: userId }, { onConflict: 'league_id,season', ignoreDuplicates: true });
  if (ins.error && ins.error.code !== '23505') throw new Error(errText(ins.error));
  return (await fetchSeason(s.league, s.season)) ?? s;
}

// ---------------------------------------------------------------- entries

/**
 * Sends a lineup and map preferences for the next kickoff. The database stamps
 * the time and refuses a kickoff that has started; if this device's clock is
 * a little behind, the entry moves on to the following night.
 */
export async function submitEntry(l: League, e: LEntry): Promise<{ ok: true; day: number } | Fail> {
  const sb = await supa();
  let day = e.day;
  for (let attempt = 0; attempt < 2 && day <= FINAL_DAY; attempt++, day++) {
    const r = await sb.from('league_entries').insert({
      league_id: l.id, slot: e.slot, user_id: e.userId, season: e.season, day,
      kickoff_at: new Date(kickoffAt(l, e.season, day)).toISOString(),
      data: { team: e.team, teamHash: e.teamHash, mapPrefs: e.mapPrefs },
    });
    if (!r.error) return { ok: true, day };
    if (!/already started/i.test(r.error.message)) return { ok: false, reason: errText(r.error) };
  }
  return { ok: false, reason: 'That kickoff has already started.' };
}

function toEntry(l: League, seats: LeagueSeat[], r: EntryRow): LEntry | null {
  // Rows that don't fit the calendar or the seat list are ignored, whatever they contain.
  if (r.day < 1 || r.day > FINAL_DAY || r.season < 1) return null;
  if (Math.abs(Date.parse(r.kickoff_at) - kickoffAt(l, r.season, r.day)) > 1000) return null;
  if (!seats.some((s) => s.slot === r.slot && s.userId === r.user_id)) return null;
  if (!r.data?.team || !Array.isArray(r.data.mapPrefs)) return null;
  return { slot: r.slot, userId: r.user_id, season: r.season, day: r.day, submittedAt: Date.parse(r.submitted_at), team: r.data.team, teamHash: r.data.teamHash, mapPrefs: r.data.mapPrefs };
}

/**
 * Every lineup this account may see for a season (its own, and everyone's once
 * the kickoff has passed), plus each manager's latest lineup from earlier
 * seasons, which plays until they send a new one.
 */
export async function fetchEntries(l: League, seats: LeagueSeat[], season: number): Promise<LEntry[]> {
  const sb = await supa();
  const rows: EntryRow[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from('league_entries').select('*').eq('league_id', l.id).eq('season', season).order('id').range(from, from + 999);
    if (r.error) throw new Error(errText(r.error));
    rows.push(...((r.data ?? []) as EntryRow[]));
    if ((r.data ?? []).length < 1000) break;
  }
  if (season > 1) {
    // One older lineup per seat is enough: the latest before this season.
    for (const s of seats) {
      const r = await sb.from('league_entries').select('*').eq('league_id', l.id).eq('slot', s.slot).lt('season', season).order('id', { ascending: false }).limit(1);
      if (!r.error) rows.push(...((r.data ?? []) as EntryRow[]));
    }
  }
  return rows.map((r) => toEntry(l, seats, r)).filter((e): e is LEntry => !!e);
}

// ---------------------------------------------------------------- results

export async function fetchResults(id: string, season: number): Promise<{ results: Record<string, LResult>; flags: { matchId: string; userId: string; agrees: boolean }[] }> {
  const sb = await supa();
  const rows: ResultRow[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from('league_results').select('*').eq('league_id', id).eq('season', season).range(from, from + 999);
    if (r.error) throw new Error(errText(r.error));
    rows.push(...((r.data ?? []) as ResultRow[]));
    if ((r.data ?? []).length < 1000) break;
  }
  const f = await sb.from('league_flags').select('*').eq('league_id', id).like('match_id', `s${season}%`);
  if (f.error) throw new Error(errText(f.error));
  const results: Record<string, LResult> = {};
  for (const row of rows) if (row.data?.matchId === row.match_id) results[row.match_id] = row.data;
  return { results, flags: (f.data ?? []).map((x) => ({ matchId: x.match_id as string, userId: x.user_id as string, agrees: !!x.agrees })) };
}

/** Stores a result unless someone already did (the first one stays). */
export async function storeResult(id: string, season: number, r: LResult, userId: string): Promise<void> {
  const sb = await supa();
  const ins = await sb.from('league_results').upsert({ league_id: id, season, match_id: r.matchId, data: r, created_by: userId }, { onConflict: 'league_id,match_id', ignoreDuplicates: true });
  if (ins.error && ins.error.code !== '23505') throw new Error(errText(ins.error));
}

export async function flagResult(id: string, matchId: string, userId: string, agrees: boolean): Promise<void> {
  const sb = await supa();
  const ins = await sb.from('league_flags').upsert({ league_id: id, match_id: matchId, user_id: userId, agrees }, { onConflict: 'league_id,match_id,user_id', ignoreDuplicates: true });
  if (ins.error && ins.error.code !== '23505') throw new Error(errText(ins.error));
}

// ---------------------------------------------------------------- the manager's club

export async function loadClubRemote(id: string, userId: string): Promise<{ club: Career; at: number } | null> {
  const sb = await supa();
  const r = await sb.from('league_clubs').select('data, updated_at').eq('league_id', id).eq('user_id', userId).maybeSingle();
  if (r.error) throw new Error(errText(r.error));
  if (!r.data) return null;
  try {
    return { club: deserializeCareer(JSON.stringify(r.data.data)), at: Date.parse(r.data.updated_at as string) };
  } catch {
    return null;
  }
}

export async function saveClubRemote(id: string, userId: string, club: Career): Promise<void> {
  const sb = await supa();
  const r = await sb.from('league_clubs').upsert({ league_id: id, user_id: userId, data: JSON.parse(serializeCareer(club)), updated_at: new Date().toISOString() });
  if (r.error) throw new Error(errText(r.error));
}

// ---------------------------------------------------------------- live updates

/** Calls `onChange` when a seat is taken, a season is set, a result lands or the owner edits the league. */
export async function watchLeague(id: string, onChange: () => void): Promise<() => void> {
  const sb = await supa();
  const ch = sb.channel(`l-${id}`);
  for (const table of ['league_seats', 'league_results', 'league_seasons', 'leagues'] as const) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: table === 'leagues' ? `id=eq.${id}` : `league_id=eq.${id}` }, () => onChange());
  }
  ch.subscribe();
  return () => { void sb.removeChannel(ch); };
}

export { nowMs };
