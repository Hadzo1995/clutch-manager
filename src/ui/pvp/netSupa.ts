/**
 * Online rooms for PvP on the game's own Supabase project (hosted builds, see online/supa.ts),
 * so friends can play 1-on-1 with an account on the site instead of a claude.ai account.
 * Same PvpNet contract as the claude.ai version in net.ts; the tables and rules are in
 * supabase/pvp.sql.
 *
 * Rooms and seats are re-read every couple of seconds while a screen watches them (a room
 * changes a handful of times per match, so polling is plenty), and who has the room open
 * comes from a Supabase presence channel.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { PvpEntry, PvpRoom } from '../../engine/pvp';
import { canJoin } from '../../engine/pvp';
import { currentUser, supa } from '../../online/supa';
import type { PvpNet, Side } from './net';

const POLL_MS = 1500;

/** Plain JSON for the database: drops undefined fields the way the fingerprints do. */
const plain = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

function fail(error: { message?: string } | null): never {
  const m = error?.message ?? '';
  if (/fetch|network/i.test(m)) throw new Error('Can’t reach the game server. Check your connection.');
  if (/row-level security|permission/i.test(m)) throw new Error('The server refused that change. Reload the page and try again.');
  throw new Error(m || 'Something went wrong. Try again.');
}

/** Calls `read` every POLL_MS and reports only when the JSON changed. Errors are reported once per run of failures. */
function poll<T>(read: () => Promise<T>, cb: (v: T) => void, onError: (msg: string) => void): () => void {
  let last = '\u0000', stopped = false, failing = false, timer = 0;
  const tick = async () => {
    try {
      const v = await read();
      failing = false;
      const s = JSON.stringify(v);
      if (!stopped && s !== last) { last = s; cb(v); }
    } catch (e) {
      if (!stopped && !failing) { failing = true; onError((e as Error).message); }
    }
    if (!stopped) timer = window.setTimeout(() => void tick(), POLL_MS);
  };
  void tick();
  return () => { stopped = true; window.clearTimeout(timer); };
}

/** The Supabase room service for the signed-in player, or null when nobody is signed in. */
export async function connectSupaPvp(): Promise<PvpNet | null> {
  const me = await currentUser();
  if (!me) return null;
  const sb = await supa();
  const name = me.email.split('@')[0] || 'Manager';

  const readRoom = async (code: string): Promise<PvpRoom | null> => {
    const { data, error } = await sb.from('pvp_rooms').select('data').eq('code', code).maybeSingle();
    if (error) fail(error);
    return (data?.data as PvpRoom | undefined) ?? null;
  };
  const readSeats = async (code: string): Promise<[PvpEntry | null, PvpEntry | null]> => {
    const { data, error } = await sb.from('pvp_seats').select('side, data').eq('code', code);
    if (error) fail(error);
    const of = (s: Side) => (data?.find((r) => r.side === s)?.data as PvpEntry | undefined) ?? null;
    return [of('host'), of('guest')];
  };
  const writeSeat = async (code: string, side: Side, entry: PvpEntry) => {
    const { error } = await sb.from('pvp_seats').upsert({ code, side, user_id: me.id, data: plain(entry), updated_at: new Date().toISOString() });
    if (error) fail(error);
  };
  const patch = async (code: string, p: Partial<PvpRoom>) => {
    const { error } = await sb.rpc('pvp_patch', { p_code: code, p_patch: plain(p) });
    if (error) fail(error);
  };

  return {
    me: { id: me.id, name },
    canWrite: true,
    watchRoom: (code, cb, onError) => poll(() => readRoom(code), cb, onError),
    watchSeats: (code, cb, onError) => poll(() => readSeats(code), ([h, g]) => cb(h, g), onError),
    getRoom: readRoom,
    async createRoom(room, host) {
      const { error } = await sb.from('pvp_rooms').insert({ code: room.code, host_id: me.id, data: plain(room) });
      if (error) {
        if ((error as { code?: string }).code === '23505') throw new Error('That room code is taken. Try again.');
        fail(error);
      }
      await writeSeat(room.code, 'host', host);
    },
    async join(code, entry, joinName, tag) {
      const room = await readRoom(code);
      const check = canJoin(room, me.id);
      if (!check.ok) return check;
      const { data: got, error } = await sb.rpc('pvp_claim_guest', { p_code: code });
      if (error) fail(error);
      if (!got) return { ok: false, reason: 'Someone else took this room first.' };
      await writeSeat(code, 'guest', entry);
      if (room!.guestId !== me.id) {
        await patch(code, { guestId: me.id, names: [room!.names[0], joinName], tags: [room!.tags[0], tag], state: 'ready' });
      }
      return { ok: true };
    },
    setSeat: writeSeat,
    updateRoom: patch,
    async myRooms() {
      const { data, error } = await sb.from('pvp_rooms').select('data').or(`host_id.eq.${me.id},guest_id.eq.${me.id}`).order('created_at', { ascending: false }).limit(100);
      if (error) fail(error);
      return (data ?? []).map((r) => r.data as PvpRoom);
    },
    watchOnline(code, cb) {
      let ch: RealtimeChannel | null = sb.channel(`pvp-${code.toLowerCase()}`, { config: { presence: { key: me.id } } });
      const emit = () => cb(Object.keys(ch?.presenceState() ?? {}));
      ch.on('presence', { event: 'sync' }, emit).subscribe((status) => {
        if (status === 'SUBSCRIBED') void ch?.track({ uid: me.id });
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') cb([]);
      });
      return () => { const c = ch; ch = null; if (c) void sb.removeChannel(c); };
    },
  };
}
