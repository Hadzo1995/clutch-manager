/**
 * PvP: challenge another manager's career team through a room code.
 *
 * Online only. Rooms live in the hosted page's shared database (ui/pvp/net.ts);
 * the rules (validation, seed, result fingerprints) are in engine/pvp.ts. Both
 * browsers simulate the same series from the same seed and publish a result
 * fingerprint; the room completes only when the two agree. Results never touch
 * the career: no coins, no form, no table.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardById, humanSnapshot, lineupValidation, profileOf } from '../../engine/career';
import { effectiveOvr } from '../../engine/ratings';
import {
  CODE_LENGTH, configKey, defaultConfig, fingerprint, headToHead, matchSeed, newRoom, newRoomCode, normalizeCode,
  PVP_STATE_LABEL, pvpTeam, resultHash, runPvpSeries, settle, sideOf, startCheck, strengthOf, summarize, validateConfig,
} from '../../engine/pvp';
import type { PvpConfig, PvpEntry, PvpRoom, PvpState } from '../../engine/pvp';
import type { SeriesResult, TeamIdx } from '../../engine/match';
import type { TeamSnapshot } from '../../engine/team';
import { MAPS, ROLE_LABEL } from '../../engine/types';
import type { MapName } from '../../engine/types';
import { useGame } from '../common';
import { connectPvp, errorText } from '../pvp/net';
import type { PvpNet, Side } from '../pvp/net';
import { Live, Report } from './Match';
import '../styles/pvp.css';

const sideName = (s: TeamIdx): Side => (s === 0 ? 'host' : 'guest');
const STATE_CHIP: Record<PvpState, string> = { waiting: 'warn', ready: 'ct', in_progress: 't', completed: 'good', abandoned: '', disputed: 'bad' };
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** This manager's team as it would enter a room right now, with OVRs for display. */
function useMyEntry(net: PvpNet | null) {
  const { world, career: c } = useGame();
  const check = lineupValidation(c);
  const make = (side: TeamIdx, ready: boolean, config: PvpConfig | null): PvpEntry => {
    const team = pvpTeam(humanSnapshot(world, c), side);
    const ovr: Record<string, number> = {};
    c.lineup.forEach((s, i) => { const card = cardById(c, s.cardId); if (card) ovr[team.players[i]!.id] = Math.round(effectiveOvr(profileOf(world, card), card)); });
    return { userId: net?.me.id ?? '', manager: c.managerName || net?.me.name || 'Manager', team, teamHash: fingerprint(team), ready, ...(ready && config ? { readyFor: configKey(config) } : {}), ovr };
  };
  return { check, make, name: c.teamName, tag: c.teamTag };
}

export function Pvp() {
  const [net, setNet] = useState<PvpNet | null | undefined>(undefined);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => { let live = true; void connectPvp().then((n) => { if (live) setNet(n); }); return () => { live = false; }; }, []);

  if (net === undefined) return <><Head /><section className="panel"><p className="muted">Connecting to the shared room list…</p></section></>;
  if (net === null) return <><Head /><Offline /></>;
  if (code) return <RoomView key={code} net={net} code={code} onExit={() => setCode(null)} onOpen={setCode} />;
  return <Lobby net={net} onOpen={setCode} />;
}

function Head({ sub }: { sub?: string }) {
  return (
    <header className="page-head">
      <div className="stack" style={{ gap: 4 }}>
        <span className="label">Online</span>
        <h1>PvP challenges</h1>
        <p className="sub">{sub ?? 'Put your career team against another manager’s. Results are for bragging rights only: they never change your career.'}</p>
      </div>
    </header>
  );
}

function Offline() {
  return (
    <section className="panel pvp-offline">
      <h2>Online play needs the hosted page</h2>
      <p className="muted">PvP rooms are stored in the shared database of the published Clutch Manager page on claude.ai. This copy can’t reach it: it may be a saved file, the development server, or you may be signed out.</p>
      <p className="muted small">Open the game from its claude.ai link while signed in. Your opponent needs the same link, shared with them as Contributor (same organization) or Editor, so their browser may write to the room.</p>
    </section>
  );
}

// ------------------------------------------------------------------ lobby

function Lobby({ net, onOpen }: { net: PvpNet; onOpen: (code: string) => void }) {
  const me = useMyEntry(net);
  const preview = useMemo(() => me.make(0, false, null), [me.make]); // eslint-disable-line react-hooks/exhaustive-deps
  const [config, setConfig] = useState<PvpConfig>(defaultConfig());
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PvpRoom[] | null>(null);
  const [roomsErr, setRoomsErr] = useState<string | null>(null);

  useEffect(() => { net.myRooms().then(setRooms, (e) => setRoomsErr(errorText(e))); }, [net]);

  const cfgCheck = validateConfig(config);
  const create = async () => {
    setErr(null);
    if (!me.check.ok) { setErr(me.check.errors[0] ?? 'Your lineup is not complete.'); return; }
    if (!cfgCheck.ok) { setErr(cfgCheck.errors[0]!); return; }
    setBusy('create');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = newRoomCode();
        try {
          await net.createRoom(newRoom(code, net.me.id, me.name, me.tag, config, Date.now()), { ...me.make(0, false, null), userId: net.me.id });
          onOpen(code);
          return;
        } catch (e) { if (!(e instanceof Error) || !e.message.includes('taken') || attempt === 2) throw e; }
      }
    } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };
  const join = async () => {
    setErr(null);
    const code = normalizeCode(joinCode);
    if (!code) { setErr(`A room code has ${CODE_LENGTH} letters and digits.`); return; }
    if (!me.check.ok) { setErr(me.check.errors[0] ?? 'Your lineup is not complete.'); return; }
    setBusy('join');
    try {
      const res = await net.join(code, { ...me.make(1, false, null), userId: net.me.id }, me.name, me.tag);
      if (res.ok) onOpen(code); else setErr(res.reason);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };

  const opponents = useMemo(() => {
    const by = new Map<string, { name: string; rooms: PvpRoom[] }>();
    for (const r of rooms ?? []) {
      const side = sideOf(r, net.me.id);
      if (side === null || r.state !== 'completed') continue;
      const oppId = side === 0 ? r.guestId : r.hostId;
      if (!oppId) continue;
      const e = by.get(oppId) ?? { name: r.names[side === 0 ? 1 : 0] || 'Opponent', rooms: [] };
      e.rooms.push(r); by.set(oppId, e);
    }
    return [...by.values()].map((o) => ({ name: o.name, ...headToHead(o.rooms, net.me.id) }));
  }, [rooms, net.me.id]);

  return (
    <>
      <Head />
      {net.canWrite === false && <p className="pvp-note bad">This page is shared with you as view-only, so you can look around but not create or join rooms. Ask the page owner to share it with you as Contributor or Editor.</p>}
      <section className="panel span-5">
        <div className="panel-head"><span className="label">Your team</span><span className="chip">Strength {strengthOf(preview.team)}</span></div>
        <TeamCard entry={preview} name={me.name} tag={me.tag} />
        {!me.check.ok && <ul className="pvp-errors">{me.check.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <p className="small faint">The team plays exactly as built: lineup, roles, coach, tactics, form, chemistry and map practice. Opponent preparation is switched off for both sides.</p>
      </section>
      <section className="panel span-7">
        <div className="panel-head"><span className="label">Create a room</span></div>
        <ConfigEditor config={config} onChange={setConfig} />
        <button className={`btn primary${busy === 'create' ? ' loading' : ''}`} disabled={!!busy || !me.check.ok || !cfgCheck.ok || net.canWrite === false} onClick={() => void create()}>Create room</button>
        <div className="pvp-or"><span>or</span></div>
        <div className="panel-head"><span className="label">Join with a code</span></div>
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void join(); }}>
          <label className="field pvp-code-field">
            <span className="sr-only">Room code</span>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="e.g. K7QM2P" maxLength={CODE_LENGTH + 2} autoComplete="off" spellCheck={false} aria-label="Room code" />
          </label>
          <button type="submit" className={`btn${busy === 'join' ? ' loading' : ''}`} disabled={!!busy || !joinCode.trim() || net.canWrite === false}>Join</button>
        </form>
        {err && <p className="pvp-note bad" role="alert">{err}</p>}
      </section>
      <section className="panel">
        <div className="panel-head">
          <span className="label">Your rooms</span>
          {opponents.length > 0 && <span className="row wrap small">{opponents.map((o) => <span key={o.name} className="chip">{o.name} {o.wins}–{o.losses}</span>)}</span>}
        </div>
        {roomsErr && <p className="pvp-note bad">{roomsErr}</p>}
        {!rooms && !roomsErr && <p className="muted small">Loading…</p>}
        {rooms && rooms.length === 0 && <p className="muted small">No rooms yet. Create one and send the code to a friend.</p>}
        {rooms && rooms.length > 0 && (
          <div className="scroll-x">
            <table className="tbl pvp-history">
              <thead><tr><th>When</th><th>Code</th><th>Opponent</th><th>Maps</th><th>State</th><th className="num">Result</th><th /></tr></thead>
              <tbody>
                {rooms.map((r) => {
                  const side = sideOf(r, net.me.id) ?? 0;
                  const opp = r.names[side === 0 ? 1 : 0] || '—';
                  const res = r.summary ? `${r.summary.mapScore[side]}–${r.summary.mapScore[side === 0 ? 1 : 0]}` : '';
                  const won = r.summary ? r.summary.winner === side : null;
                  return (
                    <tr key={r.code}>
                      <td className="small">{when(r.createdAt)}</td>
                      <td className="mono">{r.code}</td>
                      <td>{opp}</td>
                      <td className="small">{r.config.format.toUpperCase()} · {r.config.maps.join(', ')}</td>
                      <td><span className={`chip ${STATE_CHIP[r.state]}`}>{PVP_STATE_LABEL[r.state]}</span></td>
                      <td className={`num ${won === null ? '' : won ? 'up' : 'down'}`}>{res}</td>
                      <td><button className="btn small ghost" onClick={() => onOpen(r.code)}>Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ConfigEditor({ config, onChange, disabled }: { config: PvpConfig; onChange: (c: PvpConfig) => void; disabled?: boolean }) {
  const need = config.format === 'bo1' ? 1 : 3;
  const toggle = (m: MapName) => {
    if (config.maps.includes(m)) onChange({ ...config, maps: config.maps.filter((x) => x !== m) });
    else if (need === 1) onChange({ ...config, maps: [m] });
    else if (config.maps.length < need) onChange({ ...config, maps: [...config.maps, m] });
  };
  return (
    <div className="stack pvp-config">
      <div className="seg" role="group" aria-label="Format">
        {(['bo1', 'bo3'] as const).map((f) => (
          <button key={f} type="button" disabled={disabled} aria-pressed={config.format === f} onClick={() => onChange({ format: f, maps: f === 'bo1' ? config.maps.slice(0, 1) : config.maps.slice(0, 3) })}>{f === 'bo1' ? 'Best of 1' : 'Best of 3'}</button>
        ))}
      </div>
      <div className="pvp-maps" role="group" aria-label={`Pick ${need} map${need > 1 ? 's' : ''}`}>
        {MAPS.map((m) => {
          const i = config.maps.indexOf(m);
          return (
            <button key={m} type="button" className={`pvp-map${i >= 0 ? ' on' : ''}`} aria-pressed={i >= 0} disabled={disabled || (i < 0 && need > 1 && config.maps.length >= need)} onClick={() => toggle(m)}>
              <span>{m}</span>{i >= 0 && need > 1 && <b className="num">{i === 2 ? 'Decider' : `Map ${i + 1}`}</b>}
            </button>
          );
        })}
      </div>
      <p className="small faint">{need === 1 ? 'Pick the map.' : `Pick three maps in play order (${config.maps.length}/3). The third is played only at 1–1.`}</p>
    </div>
  );
}

function TeamCard({ entry, name, tag, online, ready }: { entry: PvpEntry | null; name: string; tag: string; online?: boolean | null; ready?: boolean }) {
  if (!entry) return <div className="pvp-team empty"><p className="muted small">Waiting for a team…</p></div>;
  const t = entry.team;
  const ovr = entry.ovr ?? {};
  return (
    <div className="pvp-team">
      <div className="row spread">
        <div className="stack" style={{ gap: 2 }}>
          <strong className="pvp-team-name"><span className="pvp-tag">{tag || t.tag}</span> {name || t.name}</strong>
          <span className="small muted">Manager {entry.manager}{online !== undefined && online !== null && <> · <span className={online ? 'up' : 'faint'}>{online ? 'online' : 'offline'}</span></>}</span>
        </div>
        {ready !== undefined && <span className={`chip ${ready ? 'good' : ''}`}>{ready ? 'Ready' : 'Not ready'}</span>}
      </div>
      <div className="pvp-kpis">
        <div><span className="label">Strength</span><b className="num">{strengthOf(t)}</b></div>
        <div><span className="label">Chemistry</span><b className="num">{Math.round(t.chemistry)}</b></div>
        <div><span className="label">Coach</span><b>{t.coach?.name ?? 'None'}</b></div>
      </div>
      <table className="tbl pvp-roster">
        <thead><tr><th>Player</th><th>Role</th><th className="num">OVR</th><th className="num">Aim</th></tr></thead>
        <tbody>
          {t.players.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.handle}</strong></td>
              <td className="small">{ROLE_LABEL[p.role]}{p.roleFit < 1 && <span className="faint">{p.roleFit >= 0.95 ? ' (2nd)' : ' (off)'}</span>}</td>
              <td className="num">{ovr[p.id] ?? '—'}</td>
              <td className="num">{Math.round(p.attrs.aim)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ room

function RoomView({ net, code, onExit, onOpen }: { net: PvpNet; code: string; onExit: () => void; onOpen: (code: string) => void }) {
  const { toast } = useGame();
  const me = useMyEntry(net);
  const [room, setRoom] = useState<PvpRoom | null | undefined>(undefined);
  const [seats, setSeats] = useState<[PvpEntry | null, PvpEntry | null]>([null, null]);
  const [online, setOnline] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [view, setView] = useState<'room' | 'live' | 'report'>('room');
  const [instant, setInstant] = useState(false);

  useEffect(() => net.watchRoom(code, setRoom, setErr), [net, code]);
  useEffect(() => net.watchSeats(code, (h, g) => setSeats([h, g]), setErr), [net, code]);
  useEffect(() => net.watchOnline(code, setOnline), [net, code]);

  const side = room ? sideOf(room, net.me.id) : null;
  const [host, guest] = seats;
  const mine = side === null ? null : seats[side];
  const theirs = side === null ? null : seats[side === 0 ? 1 : 0];

  // The series, once started: computed locally from the shared seed and both locked teams.
  const series = useMemo<SeriesResult | null>(() => {
    if (!room || room.seed === null || !host || !guest) return null;
    if (room.state !== 'in_progress' && room.state !== 'completed' && room.state !== 'disputed') return null;
    try { return runPvpSeries(room, host, guest); } catch { return null; }
  }, [room?.seed, room?.state, host?.teamHash, guest?.teamHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Publish our result fingerprint, then settle the room when both are in.
  const posted = useRef(false);
  useEffect(() => {
    if (!room || !series || side === null || !mine || room.state !== 'in_progress') return;
    const h = resultHash(series);
    if (mine.resultHash !== h && !posted.current) {
      posted.current = true;
      net.setSeat(code, sideName(side), { ...mine, resultHash: h }).catch((e) => { posted.current = false; setErr(errorText(e)); });
      return;
    }
    const outcome = settle(room, host, guest);
    if (outcome) {
      const teams: [TeamSnapshot, TeamSnapshot] = [host!.team, guest!.team];
      net.updateRoom(code, outcome === 'completed'
        ? { state: 'completed', endedAt: Date.now(), summary: summarize(series, teams), resultHash: h }
        : { state: 'disputed', endedAt: Date.now() }).catch((e) => setErr(errorText(e)));
    }
  }, [room, series, side, mine, host, guest, net, code]);

  if (room === undefined) return <><Head sub={`Room ${code}`} /><section className="panel"><p className="muted">Opening room {code}…</p></section></>;
  if (room === null) return <><Head sub={`Room ${code}`} /><section className="panel"><p className="pvp-note bad">No room with code {code}. It may have been typed wrong.</p><button className="btn" onClick={onExit}>Back to PvP</button></section></>;

  const oppIdx: TeamIdx = side === 1 ? 0 : 1;
  const oppId = side === 0 ? room.guestId : side === 1 ? room.hostId : null;
  const oppOnline = online === null || !oppId ? null : online.includes(oppId);
  const editable = side === 0 && (room.state === 'waiting' || room.state === 'ready');
  const myReady = !!mine?.ready && mine.readyFor === configKey(room.config);
  const check = startCheck(room, host, guest);
  const preStart = room.state === 'waiting' || room.state === 'ready';

  const act = async (f: () => Promise<void>) => {
    setErr(null); setBusy(true);
    try { await f(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const setReady = (ready: boolean) => act(async () => {
    if (side === null) return;
    if (ready && !me.check.ok) throw new Error(me.check.errors[0] ?? 'Your lineup is not complete.');
    // Ready locks the team as it is right now; un-ready keeps the last team but allows refreshing it.
    let fresh: PvpEntry;
    if (ready || !mine) fresh = me.make(side, ready, room.config);
    else { const { readyFor: _was, ...rest } = mine; fresh = { ...rest, ready: false }; }
    await net.setSeat(code, sideName(side), { ...fresh, userId: net.me.id });
  });
  const refreshTeam = () => act(async () => { if (side !== null) await net.setSeat(code, sideName(side), { ...me.make(side, false, null), userId: net.me.id }); });
  const changeConfig = (c: PvpConfig) => act(async () => { await net.updateRoom(code, { config: c }); });
  const start = () => act(async () => {
    // Re-read before writing so two clicks (or a stale screen) can't start twice or start a changed room.
    const fresh = await net.getRoom(code);
    if (!fresh || fresh.state !== 'ready') throw new Error(`The room is ${fresh ? PVP_STATE_LABEL[fresh.state].toLowerCase() : 'gone'}.`);
    const c2 = startCheck(fresh, host, guest);
    if (!c2.ok) throw new Error(c2.errors[0]);
    await net.updateRoom(code, { state: 'in_progress', seed: matchSeed(code, host!.teamHash, guest!.teamHash), startedAt: Date.now() });
    setConfirmStart(false);
  });
  const abandon = () => act(async () => { await net.updateRoom(code, { state: 'abandoned', abandonedBy: net.me.id, endedAt: Date.now() }); });
  const rematch = () => act(async () => {
    const fresh = await net.getRoom(code);
    if (fresh?.rematchCode) {
      // The other side already offered a rematch: take the open seat in it.
      const target = await net.getRoom(fresh.rematchCode);
      if (target && sideOf(target, net.me.id) === null) {
        const res = await net.join(fresh.rematchCode, { ...me.make(1, false, null), userId: net.me.id }, me.name, me.tag);
        if (!res.ok) throw new Error(res.reason);
      }
      onOpen(fresh.rematchCode);
      return;
    }
    const nc = newRoomCode();
    await net.createRoom({ ...newRoom(nc, net.me.id, me.name, me.tag, room.config, Date.now()), rematchOf: code }, { ...me.make(0, false, null), userId: net.me.id });
    await net.updateRoom(code, { rematchCode: nc });
    onOpen(nc);
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); toast('Room code copied.'); } catch { toast('Copy is blocked here. Select the code and copy it.'); }
  };

  const teams: [TeamSnapshot, TeamSnapshot] | null = host && guest ? [host.team, guest.team] : null;
  if (view === 'live' && series && teams && room.seed !== null) {
    return (
      <div className="fullscreen" role="dialog" aria-label="PvP match">
        <div className="inner mx-inner mx-live wide">
          <Live teams={teams} humanIdx={side ?? 0} maps={room.config.maps} format={room.config.format} seed={room.seed} instant={instant} stageLabel={`PvP · ${room.names[0]} vs ${room.names[1]}`} locked onFinished={() => setView('report')} />
        </div>
      </div>
    );
  }
  if (view === 'report' && series && teams) {
    return (
      <div className="fullscreen" role="dialog" aria-label="PvP result">
        <div className="inner mx-inner mx-report">
          <Report series={series} teams={teams} humanIdx={side ?? 0} onContinue={() => setView('room')} pvp={{
            note: room.state === 'completed' ? 'Both games produced the same result. PvP results do not change your career.' : room.state === 'disputed' ? 'The two games disagree about this result, so it is not counted.' : 'Waiting for your opponent’s game to confirm this result.',
            actions: <>
              <button className="btn" onClick={() => setView('room')}>Back to room</button>
              {side !== null && (room.state === 'completed' || room.state === 'disputed') && <button className="btn primary" disabled={busy} onClick={() => { setView('room'); void rematch(); }}>Rematch</button>}
            </>,
          }} />
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">PvP room</span>
          <h1 className="row wrap" style={{ gap: 12 }}>
            <button className="pvp-code" onClick={() => void copy()} title="Copy the room code">{code}</button>
            <span className={`chip ${STATE_CHIP[room.state]}`}>{PVP_STATE_LABEL[room.state]}</span>
          </h1>
          <p className="sub">{room.names[0] || 'Host'} vs {room.names[1] || '…'} · {room.config.format.toUpperCase()} · {room.config.maps.join(', ')}{room.rematchOf ? ` · rematch of ${room.rematchOf}` : ''}</p>
        </div>
        <button className="btn ghost" onClick={onExit}>All rooms</button>
      </header>

      {err && <p className="pvp-note bad" role="alert">{err}</p>}
      {side === null && room.state === 'waiting' && (
        <section className="panel"><p>This room is waiting for an opponent.</p>
          <button className="btn primary" disabled={busy || !me.check.ok} onClick={() => void act(async () => { const r = await net.join(code, { ...me.make(1, false, null), userId: net.me.id }, me.name, me.tag); if (!r.ok) throw new Error(r.reason); })}>Join with {me.name}</button>
        </section>
      )}
      {side === null && room.state !== 'waiting' && <p className="pvp-note">You are watching this room. It belongs to two other managers.</p>}
      {room.state === 'waiting' && side === 0 && <p className="pvp-note">Send the code <b className="mono">{code}</b> to your opponent. They open PvP on this page and join with it.</p>}
      {room.state === 'abandoned' && <p className="pvp-note">This room was closed by {room.abandonedBy === room.hostId ? room.names[0] : room.names[1] || 'a player'} before the match started.</p>}
      {room.state === 'disputed' && <p className="pvp-note bad">The two games computed different results for this match, so it is not counted. This points to different game versions; both players should reload the page and play a rematch.</p>}

      <section className="panel span-6">
        <div className="panel-head"><span className="label">Host</span></div>
        <TeamCard entry={host} name={room.names[0]} tag={room.tags[0]} online={room.hostId === net.me.id ? true : online ? online.includes(room.hostId) : null} ready={preStart ? !!host?.ready && host.readyFor === configKey(room.config) : undefined} />
      </section>
      <section className="panel span-6">
        <div className="panel-head"><span className="label">Challenger</span></div>
        <TeamCard entry={guest} name={room.names[1]} tag={room.tags[1]} online={room.guestId === net.me.id ? true : online && room.guestId ? online.includes(room.guestId) : null} ready={preStart && guest ? !!guest.ready && guest.readyFor === configKey(room.config) : undefined} />
      </section>

      {host && guest && <Comparison host={host} guest={guest} />}

      {preStart && side !== null && (
        <section className="panel">
          <div className="panel-head"><span className="label">Match settings</span>{!editable && <span className="small faint">Set by the host</span>}</div>
          <ConfigEditor config={room.config} onChange={(c) => { if (validateConfig(c).ok || c.maps.length < (c.format === 'bo1' ? 1 : 3)) void changeConfig(c); }} disabled={!editable || busy} />
          {editable && <p className="small faint">Changing the settings un-readies both teams.</p>}
          <div className="row wrap">
            {!myReady
              ? <button className="btn primary" disabled={busy || !me.check.ok || !validateConfig(room.config).ok} onClick={() => void setReady(true)}>Lock team and ready up</button>
              : <button className="btn" disabled={busy} onClick={() => void setReady(false)}>Not ready</button>}
            {!myReady && <button className="btn ghost" disabled={busy} onClick={() => void refreshTeam()}>Refresh team from career</button>}
            {side === 0 && !confirmStart && <button className="btn ct" disabled={busy || !check.ok} onClick={() => setConfirmStart(true)}>Start match</button>}
            <button className="btn danger ghost" disabled={busy} onClick={() => void abandon()}>{side === 0 ? 'Close room' : 'Leave room'}</button>
          </div>
          {!me.check.ok && <ul className="pvp-errors">{me.check.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {side === 0 && !check.ok && room.state === 'ready' && <ul className="pvp-errors muted">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {side === 1 && myReady && <p className="small muted">You’re ready. The host starts the match.</p>}
          {confirmStart && (
            <div className="pvp-confirm" role="alertdialog" aria-label="Confirm start">
              <p><b>Start {room.config.format.toUpperCase()} on {room.config.maps.join(', ')}?</b> Both teams are locked as shown. The result is fixed by the room code and the two teams.</p>
              <div className="row"><button className="btn primary" disabled={busy} onClick={() => void start()}>Confirm start</button><button className="btn ghost" onClick={() => setConfirmStart(false)}>Cancel</button></div>
            </div>
          )}
        </section>
      )}

      {(room.state === 'in_progress' || room.state === 'completed' || room.state === 'disputed') && (
        <section className="panel">
          <div className="panel-head"><span className="label">Match</span>{room.startedAt && <span className="small faint">Started {when(room.startedAt)}</span>}</div>
          {!series && <p className="pvp-note bad">This match can’t be replayed here: one of the locked teams is missing.</p>}
          {series && (
            <>
              <div className="pvp-score">
                <span className="pvp-score-team">{room.tags[0] || room.names[0]}</span>
                <b className="num">{room.state === 'in_progress' && !room.summary ? '?' : series.mapScore[0]}</b>
                <span className="faint">–</span>
                <b className="num">{room.state === 'in_progress' && !room.summary ? '?' : series.mapScore[1]}</b>
                <span className="pvp-score-team">{room.tags[1] || room.names[1]}</span>
              </div>
              {room.state === 'in_progress' && (
                <p className="small muted">{theirs?.resultHash ? 'Both games have the result; confirming…' : oppOnline === false ? `${room.names[oppIdx] || 'Your opponent'} is offline. Their game confirms the result when they open this room again; you can watch it now.` : `Waiting for ${room.names[oppIdx] || 'your opponent'}’s game to confirm the result.`}</p>
              )}
              <div className="row wrap">
                <label className="row small"><input type="checkbox" checked={instant} onChange={(e) => setInstant(e.target.checked)} /> Skip the round-by-round view</label>
                <button className="btn primary" onClick={() => setView('live')}>{room.state === 'in_progress' ? 'Watch the match' : 'Watch again'}</button>
                <button className="btn" onClick={() => setView('report')}>Final scoreboard</button>
                {side !== null && (room.state === 'completed' || room.state === 'disputed') && <button className="btn" disabled={busy} onClick={() => void rematch()}>{room.rematchCode ? `Go to rematch ${room.rematchCode}` : 'Rematch'}</button>}
              </div>
              {room.state === 'completed' && room.summary && <Scoreboard room={room} />}
            </>
          )}
        </section>
      )}
    </>
  );
}

function Comparison({ host, guest }: { host: PvpEntry; guest: PvpEntry }) {
  const rows: [string, number, number][] = [
    ['Strength', strengthOf(host.team), strengthOf(guest.team)],
    ['Chemistry', Math.round(host.team.chemistry), Math.round(guest.team.chemistry)],
    ['Average aim', avg(host.team.players.map((p) => p.attrs.aim)), avg(guest.team.players.map((p) => p.attrs.aim))],
    ['Average game sense', avg(host.team.players.map((p) => p.attrs.gameSense)), avg(guest.team.players.map((p) => p.attrs.gameSense))],
  ];
  return (
    <section className="panel">
      <div className="panel-head"><span className="label">Head to head</span></div>
      <div className="pvp-compare">
        {rows.map(([k, a, b]) => (
          <div key={k} className="pvp-cmp-row">
            <b className={`num ${a > b ? 'up' : ''}`}>{a}</b>
            <span className="pvp-cmp-bar"><i style={{ width: `${(100 * a) / Math.max(1, a + b)}%` }} /></span>
            <span className="small muted">{k}</span>
            <span className="pvp-cmp-bar r"><i style={{ width: `${(100 * b) / Math.max(1, a + b)}%` }} /></span>
            <b className={`num ${b > a ? 'up' : ''}`}>{b}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

const avg = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length));

function Scoreboard({ room }: { room: PvpRoom }) {
  const s = room.summary!;
  return (
    <div className="stack">
      <div className="row wrap small">{s.maps.map((m) => <span key={m.map} className="chip">{m.map} {m.score[0]}–{m.score[1]}</span>)}</div>
      <div className="scroll-x">
        <table className="tbl pvp-board">
          <thead><tr><th>Player</th><th>Team</th><th className="num">K</th><th className="num">D</th><th className="num">ADR</th><th className="num">Rating</th></tr></thead>
          <tbody>
            {[...s.players].sort((a, b) => b.rating - a.rating).map((p) => (
              <tr key={p.id}><td><strong>{p.handle}</strong></td><td className="small">{room.tags[p.team] || room.names[p.team]}</td><td className="num">{p.kills}</td><td className="num">{p.deaths}</td><td className="num">{p.adr}</td><td className="num">{p.rating.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
