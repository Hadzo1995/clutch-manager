/**
 * Online rooms for PvP, on the artifact page's shared database (claude.ai's
 * `db` capability) with who-is-online from its `room` capability. There is no
 * server of our own: both players' browsers read and write the same room
 * documents, and the rules in engine/pvp.ts decide what is valid.
 *
 * Layout (all small JSON documents):
 *   rooms/<CODE>               the room: state, config, seed, summary
 *   rooms/<CODE>/seats/host    host's locked team, ready flag, result fingerprint
 *   rooms/<CODE>/seats/guest   guest's, written only by the guest
 *
 * Outside claude.ai (a saved copy, the dev server) `connectPvp()` resolves
 * null and the PvP screen explains that online play needs the hosted page.
 */
import type { PvpEntry, PvpRoom } from '../../engine/pvp';
import { canJoin } from '../../engine/pvp';

/* Minimal shapes of the capabilities we use (see the platform's type definitions). */
interface Snap { exists: boolean; data(): Record<string, unknown> | undefined }
interface QSnap { docs: Snap[] }
interface DocRef {
  get(): Promise<Snap>;
  set(d: Record<string, unknown>): Promise<void>;
  update(d: Record<string, unknown>): Promise<void>;
  acquire(o: { holder: string; ttlMs?: number }): Promise<{ acquired: boolean; expiresAt?: string }>;
  onSnapshot(next: (s: Snap) => void, err?: (e: { code: string; message: string }) => void): () => void;
}
interface Query { where(f: string, op: string, v: unknown): Query; limit(n: number): Query; get(): Promise<QSnap> }
interface DB { doc(p: string): DocRef; collection(p: string): Query }
interface Peer { presence: Record<string, unknown> }
interface NamedRoom { presence(p: Record<string, unknown>): Promise<void>; peers(): readonly Peer[]; onPeers(h: (c: { peers: readonly Peer[] }) => void): () => void; leave(): Promise<void> }
interface RoomCap { join(name: string): Promise<NamedRoom> }
interface UserCap { me(): Promise<{ id: string | null; name: string }>; can(n: string): Promise<boolean | null> }
type ClaudeWin = { claude?: { use(name: string): Promise<unknown> } };

export type Side = 'host' | 'guest';

export interface PvpNet {
  me: { id: string; name: string };
  /** False when the platform said this viewer may not write shared data (view-only access). */
  canWrite: boolean | null;
  watchRoom(code: string, cb: (room: PvpRoom | null) => void, onError: (msg: string) => void): () => void;
  watchSeats(code: string, cb: (host: PvpEntry | null, guest: PvpEntry | null) => void, onError: (msg: string) => void): () => void;
  getRoom(code: string): Promise<PvpRoom | null>;
  createRoom(room: PvpRoom, host: PvpEntry): Promise<void>;
  /** Claims the guest seat under a short lease so two people can't both join. */
  join(code: string, entry: PvpEntry, name: string, tag: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  setSeat(code: string, side: Side, entry: PvpEntry): Promise<void>;
  updateRoom(code: string, patch: Partial<PvpRoom>): Promise<void>;
  myRooms(): Promise<PvpRoom[]>;
  /** Ids of the people who have this room open right now (empty if presence is unavailable). */
  watchOnline(code: string, cb: (ids: string[]) => void): () => void;
}

export function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code;
  switch (code) {
    case 'invalid_argument': return 'The shared database refused the write. You may only have view access to this page; ask its owner to share it with you as Contributor or Editor.';
    case 'resource_exhausted': return 'Too many requests in a short time. Wait a moment and try again.';
    case 'quota_exceeded': return 'The shared database is full. Delete old rooms or ask the page owner.';
    case 'revoked': return 'Your access to this page changed. Reload it.';
    case 'unavailable': return 'Connection problem. Check your network and try again.';
    default: return (e as { message?: string })?.message ?? 'Something went wrong.';
  }
}

async function retry<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) {
    if ((e as { code?: string })?.code !== 'unavailable') throw e;
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    return f();
  }
}

/** Plain JSON for the store: drops undefined fields the way the fingerprints do. */
const plain = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

const asRoom = (s: Snap): PvpRoom | null => (s.exists ? (s.data() as unknown as PvpRoom) : null);
const asEntry = (s: Snap): PvpEntry | null => (s.exists ? (s.data() as unknown as PvpEntry) : null);

let pending: Promise<PvpNet | null> | null = null;

export function connectPvp(): Promise<PvpNet | null> {
  pending ??= (async () => {
    const c = (window as unknown as ClaudeWin).claude;
    if (!c?.use) return null;
    const [db, user, room] = await Promise.all([c.use('db'), c.use('user'), c.use('room').catch(() => null)]) as [DB | null, UserCap | null, RoomCap | null];
    if (!db || !user) return null;
    const me = await user.me();
    if (!me.id) return null;
    const canWrite = await user.can('data.write').catch(() => null);
    return makeNet(db, room, { id: me.id, name: me.name || 'You' }, canWrite);
  })().catch(() => null);
  return pending;
}

function makeNet(db: DB, roomCap: RoomCap | null, me: { id: string; name: string }, canWrite: boolean | null): PvpNet {
  const roomRef = (code: string) => db.doc(`rooms/${code}`);
  const seatRef = (code: string, side: Side) => db.doc(`rooms/${code}/seats/${side}`);
  return {
    me,
    canWrite,
    watchRoom(code, cb, onError) {
      return roomRef(code).onSnapshot((s) => cb(asRoom(s)), (e) => onError(errorText(e)));
    },
    watchSeats(code, cb, onError) {
      let host: PvpEntry | null = null, guest: PvpEntry | null = null;
      const u1 = seatRef(code, 'host').onSnapshot((s) => { host = asEntry(s); cb(host, guest); }, (e) => onError(errorText(e)));
      const u2 = seatRef(code, 'guest').onSnapshot((s) => { guest = asEntry(s); cb(host, guest); }, (e) => onError(errorText(e)));
      return () => { u1(); u2(); };
    },
    async getRoom(code) {
      return asRoom(await retry(() => roomRef(code).get()));
    },
    async createRoom(room, host) {
      const existing = await retry(() => roomRef(room.code).get());
      if (existing.exists) throw new Error('That room code is taken. Try again.');
      await retry(() => seatRef(room.code, 'host').set(plain(host)));
      await retry(() => roomRef(room.code).set(plain(room)));
    },
    async join(code, entry, name, tag) {
      const ref = roomRef(code);
      const lease = await retry(() => ref.acquire({ holder: me.id, ttlMs: 5000 }));
      if (!lease.acquired) return { ok: false, reason: 'Someone else is joining this room right now. Try again in a few seconds.' };
      const room = asRoom(await retry(() => ref.get()));
      const check = canJoin(room, me.id);
      if (!check.ok) return check;
      await retry(() => seatRef(code, 'guest').set(plain(entry)));
      if (room!.guestId !== me.id) {
        await retry(() => ref.update({ guestId: me.id, names: [room!.names[0], name], tags: [room!.tags[0], tag], state: 'ready' }));
      }
      return { ok: true };
    },
    async setSeat(code, side, entry) {
      await retry(() => seatRef(code, side).set(plain(entry)));
    },
    async updateRoom(code, patch) {
      await retry(() => roomRef(code).update(plain(patch)));
    },
    async myRooms() {
      const col = db.collection('rooms');
      const [a, b] = await Promise.all([
        retry(() => col.where('hostId', '==', me.id).limit(100).get()),
        retry(() => col.where('guestId', '==', me.id).limit(100).get()),
      ]);
      const out = new Map<string, PvpRoom>();
      for (const s of [...a.docs, ...b.docs]) { const r = asRoom(s); if (r) out.set(r.code, r); }
      return [...out.values()].sort((x, y) => y.createdAt - x.createdAt);
    },
    watchOnline(code, cb) {
      if (!roomCap) { cb([]); return () => {}; }
      let named: NamedRoom | null = null, stop: (() => void) | null = null, closed = false;
      roomCap.join(`pvp-${code.toLowerCase()}`).then(async (r) => {
        if (closed) { void r.leave(); return; }
        named = r;
        await r.presence({ uid: me.id });
        const emit = (peers: readonly Peer[]) => cb([...new Set(peers.map((p) => String(p.presence?.uid ?? '')).filter(Boolean))]);
        emit(r.peers());
        stop = r.onPeers((c) => emit(c.peers));
      }).catch(() => cb([]));
      return () => { closed = true; stop?.(); void named?.leave(); };
    },
  };
}
