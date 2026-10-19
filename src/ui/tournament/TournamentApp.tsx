/**
 * The beta tournament: sign in, create or join a tournament, then manage a
 * fresh tournament club through the week. Lives beside the career game and
 * shares its screens (Squad, Train, Cases) through a nested game context.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Career, World } from '../../engine/career';
import { createWorld, starterCoaches } from '../../engine/career';
import { coachOverall } from '../../engine/data/coaches';
import { generateSyntheticDataset } from '../../engine/data/generateDataset';
import { realDataset } from '../../engine/data/realPlayers';
import { createClub } from '../../engine/tclub';
import { addDays, dateIn, firstKickoff, newTournament, newTournamentCode, statusAt, validateStart } from '../../engine/tournament';
import type { Seat, SeatInfo, Tournament } from '../../engine/tournament';
import { currentUser, nowMs, onAuth, onlineAvailable, signIn, signOut, signUp, syncClock } from '../../online/supa';
import type { Me } from '../../online/supa';
import { createTournament, joinTournament, loadTournament, myTournaments } from '../../online/tapi';
import { BrandMark } from '../App';
import { CountryTag } from '../common';
import { saveClub, sendFirstEntry } from './clubStore';
import { TournamentView } from './TournamentView';
import '../styles/tournament.css';

let tWorld: World | null = null;
/** Every manager's club comes from the same built-in player list, whatever their career uses. */
export function tournamentWorld(): World {
  tWorld ??= createWorld(realDataset() ?? generateSyntheticDataset());
  return tWorld;
}

const CURRENT_KEY = 'clutch-manager.t.current';
function codeFromHash(): string | null {
  const m = /^#tournament\/(T[A-Z0-9]{5})$/i.exec(location.hash);
  return m ? m[1]!.toUpperCase() : null;
}
function readCurrent(): string | null {
  try { return localStorage.getItem(CURRENT_KEY); } catch { return null; }
}
function writeCurrent(id: string | null) {
  try { if (id) localStorage.setItem(CURRENT_KEY, id); else localStorage.removeItem(CURRENT_KEY); } catch { /* fine */ }
}

export function TournamentApp({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [current, setCurrent] = useState<string | null>(() => readCurrent());
  const joinCode = codeFromHash();

  useEffect(() => {
    if (!onlineAvailable()) return;
    let stop: (() => void) | undefined;
    void syncClock();
    currentUser().then(setMe, () => setMe(null));
    onAuth(setMe).then((s) => { stop = s; }, () => {});
    return () => stop?.();
  }, []);

  const open = (id: string | null) => { writeCurrent(id); setCurrent(id); if (!id && codeFromHash()) history.replaceState(null, '', '#tournament'); };

  let body;
  if (!onlineAvailable()) body = <Unavailable />;
  else if (me === undefined) body = <p className="muted small tn-loading">Connecting…</p>;
  else if (!me) body = <AuthForm />;
  else if (current && !(joinCode && joinCode !== current)) body = <TournamentView id={current} me={me} onLeave={() => open(null)} />;
  else body = <TournamentHome me={me} joinCode={joinCode} onOpen={open} />;

  return (
    <div className="tn-app">
      <header className="tn-top">
        <div className="wordmark"><BrandMark />Clutch<b>/</b>Manager <span className="tn-badge">Beta tournament</span></div>
        <div className="row" style={{ gap: 8 }}>
          {me && <button className="btn small ghost" onClick={() => { open(null); void signOut(); }} title={me.email}>Sign out</button>}
          <button className="btn small" onClick={onExit}>Career game</button>
        </div>
      </header>
      {body}
    </div>
  );
}

function Unavailable() {
  return (
    <main className="tn-main">
      <section className="panel">
        <h2>The tournament needs the online version</h2>
        <p className="muted">This copy of the game isn’t connected to the tournament server. Open the game from the link the organiser shared.</p>
      </section>
    </main>
  );
}

// ------------------------------------------------------------------ sign in

function AuthForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') {
        const r = await signIn(email, password);
        if (!r.ok) setMsg({ bad: true, text: r.reason });
      } else {
        const r = await signUp(email, password);
        if (!r.ok) setMsg({ bad: true, text: r.reason });
        else if (r.needsConfirm) setMsg({ bad: false, text: 'Account created. Check your inbox for the confirmation link, then sign in.' });
      }
    } catch (e) {
      setMsg({ bad: true, text: (e as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <main className="tn-main tn-narrow">
      <section className="panel">
        <div className="seg" role="group" aria-label="Account">
          <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
          <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>Create account</button>
        </div>
        <h1>{mode === 'in' ? 'Sign in to play' : 'Create your account'}</h1>
        <p className="small muted">An account keeps your seat and your club, on any device. Your email is only used to sign in; other managers never see it.</p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="field"><span className="label">Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span className="label">Password</span><input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button type="submit" className={`btn primary${busy ? ' loading' : ''}`} disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        </form>
        {msg && <p className={`small ${msg.bad ? 'bad' : 'good'}`} role="alert">{msg.text}</p>}
      </section>
    </main>
  );
}

// ------------------------------------------------------------------ create / join

interface ClubChoice { manager: string; team: string; tag: string; coachId: string }

function ClubFields({ value, onChange }: { value: ClubChoice; onChange: (v: ClubChoice) => void }) {
  const coaches = starterCoaches(tournamentWorld());
  return (
    <>
      <div className="tn-fields">
        <label className="field"><span className="label">Your name</span><input value={value.manager} maxLength={24} required onChange={(e) => onChange({ ...value, manager: e.target.value })} placeholder="Manager" autoComplete="nickname" /></label>
        <label className="field"><span className="label">Team name</span><input value={value.team} maxLength={22} required onChange={(e) => onChange({ ...value, team: e.target.value })} placeholder="Nova Five" autoComplete="off" /></label>
        <label className="field tn-tag"><span className="label">Tag</span><input value={value.tag} maxLength={4} required onChange={(e) => onChange({ ...value, tag: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })} placeholder="NVA" autoComplete="off" /></label>
      </div>
      <fieldset className="tn-coaches">
        <legend className="label">Head coach</legend>
        {coaches.map((c) => (
          <label key={c.id} className={`tn-coach${value.coachId === c.id ? ' on' : ''}`}>
            <input type="radio" name="tn-coach" checked={value.coachId === c.id} onChange={() => onChange({ ...value, coachId: c.id })} />
            <span><CountryTag cc={c.country} /> <b>{c.name}</b> <span className="faint num">{coachOverall(c)}</span></span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

function clubOk(v: ClubChoice): string | null {
  if (!v.manager.trim()) return 'Enter your name.';
  if (!v.team.trim()) return 'Enter a team name.';
  if (v.tag.length < 2) return 'The tag needs 2 to 4 letters or digits.';
  return null;
}

/** Builds the club, saves it here and online, and sends the first lineup so the manager is never without one. */
async function startClub(t: Tournament, seat: Seat, me: Me, v: ClubChoice): Promise<Career> {
  const world = tournamentWorld();
  const club = createClub(world, t, seat, { manager: v.manager.trim(), team: v.team.trim(), tag: v.tag, coachId: v.coachId, today: dateIn(t.tz, nowMs()) });
  await saveClub(t, me.id, club, true);
  await sendFirstEntry(world, t, seat, me.id, club);
  return club;
}

function TournamentHome({ me, joinCode, onOpen }: { me: Me; joinCode: string | null; onOpen: (id: string) => void }) {
  const world = tournamentWorld();
  const [list, setList] = useState<Tournament[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'join' | 'create'>(joinCode ? 'join' : 'create');
  const [club, setClub] = useState<ClubChoice>({ manager: '', team: '', tag: '', coachId: starterCoaches(world)[0]!.id });
  const tomorrow = addDays(dateIn('Europe/Berlin', nowMs()), 1);
  const [name, setName] = useState('Beta Cup');
  const [startDate, setStartDate] = useState(tomorrow);
  const [code, setCode] = useState(joinCode ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { myTournaments(me.id).then(setList, (e) => setListErr((e as Error).message)); }, [me.id]);

  const info = (): SeatInfo => ({ userId: me.id, manager: club.manager.trim(), team: club.team.trim(), tag: club.tag, joinedAt: nowMs() });

  const create = async () => {
    setErr(null);
    const bad = clubOk(club);
    if (bad) { setErr(bad); return; }
    setBusy(true);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const t = newTournament({ id: newTournamentCode(), name, owner: info(), startDate, now: nowMs() });
        const v = validateStart(t, nowMs());
        if (!v.ok) { setErr(v.errors[0]!); return; }
        const r = await createTournament(t);
        if (!r.ok) { if (/taken/.test(r.reason) && attempt < 2) continue; setErr(r.reason); return; }
        await startClub(t, 0, me, club);
        onOpen(t.id);
        return;
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const join = async () => {
    setErr(null);
    const id = code.trim().toUpperCase();
    if (!/^T[A-Z0-9]{5}$/.test(id)) { setErr('A tournament code is a T followed by 5 letters or digits.'); return; }
    const bad = clubOk(club);
    if (bad) { setErr(bad); return; }
    setBusy(true);
    try {
      const r = await joinTournament(id, info());
      if (!r.ok) { setErr(r.reason); return; }
      const t = await loadTournament(id);
      if (!t) { setErr('No tournament with that code.'); return; }
      await startClub(t, r.seat, me, club);
      onOpen(id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const firstKo = useMemo(() => {
    try { return firstKickoff(newTournament({ id: 'TXXXXX', name, owner: info(), startDate, now: 0 })); } catch { return null; }
  }, [startDate]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="tn-main">
      <header className="page-head">
        <div>
          <span className="label">Four managers · seven days · three matches a day</span>
          <h1>Beta tournament</h1>
          <p className="sub">Everyone plays everyone once a day at 20:00, 21:00 and 22:00 Central European time. Best of one, then best of three on day 7. Signed in as {me.email}.</p>
        </div>
      </header>

      {list && list.length > 0 && (
        <section className="panel">
          <div className="panel-head"><span className="label">Your tournaments</span></div>
          <ul className="tn-list">
            {list.map((t) => (
              <li key={t.id}>
                <button className="tn-list-item" onClick={() => onOpen(t.id)}>
                  <b>{t.name}</b>
                  <span className="mono small">{t.id}</span>
                  <span className="small muted">{t.seats.filter(Boolean).length}/4 managers · {STATUS_LABEL[statusAt(t, nowMs())]} · starts {fmtDay(firstKickoff(t))}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {listErr && <p className="small bad">{listErr}</p>}

      <section className="panel">
        <div className="seg" role="group" aria-label="Create or join">
          <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create a tournament</button>
          <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>Join with a code</button>
        </div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void (mode === 'create' ? create() : join()); }}>
          {mode === 'create' ? (
            <div className="tn-fields">
              <label className="field"><span className="label">Tournament name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field"><span className="label">Day 1</span><input type="date" min={tomorrow} value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>
            </div>
          ) : (
            <label className="field"><span className="label">Tournament code</span><input className="mono" value={code} maxLength={6} placeholder="T7KQ2M" onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} /></label>
          )}
          {mode === 'create' && firstKo && <p className="small muted">First kickoff {fmtDay(firstKo)}, {fmtTime(firstKo)} your time. Friends can join until then.</p>}
          <h2 className="tn-sub">Your tournament club</h2>
          <p className="small muted">A new club just for this tournament, built the same way for everyone. Your career save is not touched.</p>
          <ClubFields value={club} onChange={setClub} />
          <button type="submit" className={`btn primary${busy ? ' loading' : ''}`} disabled={busy}>{mode === 'create' ? 'Create tournament' : 'Join tournament'}</button>
          {err && <p className="small bad" role="alert">{err}</p>}
        </form>
      </section>
    </main>
  );
}

export { ClubFields, clubOk, startClub };
export type { ClubChoice };

export const STATUS_LABEL = { open: 'waiting to start', running: 'in progress', finished: 'finished', cancelled: 'cancelled' } as const;
export const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
