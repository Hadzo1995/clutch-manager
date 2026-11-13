/**
 * The Clutch League: sign in, create or join a league, then run your club
 * season after season. Lives beside the career game (address #league) and
 * shares its screens (Squad, Train, Cases) through a nested game context.
 */
import { useEffect, useState } from 'react';
import { starterCoaches } from '../../engine/career';
import { createLeagueClub } from '../../engine/lclub';
import type { LeagueClub } from '../../engine/lclub';
import { DEFAULT_MAX_TEAMS, MAX_TEAMS_LIMIT, firstKickoff, firstSeasonFor, newLeague, newLeagueCode, seasonAt } from '../../engine/league';
import type { League } from '../../engine/league';
import { hashString } from '../../engine/rng';
import { addDays, dateIn } from '../../engine/tournament';
import { currentUser, nowMs, onAuth, onlineAvailable, signOut, syncClock } from '../../online/supa';
import type { Me } from '../../online/supa';
import { createLeague, joinLeague, loadLeague, myLeagues } from '../../online/lapi';
import { BrandMark } from '../App';
import { AuthForm, ClubFields, clubOk, fmtDay, fmtTime, tournamentWorld } from '../tournament/TournamentApp';
import type { ClubChoice } from '../tournament/TournamentApp';
import { saveClub } from './clubStore';
import { LeagueView } from './LeagueView';
import '../styles/tournament.css';
import '../styles/league.css';

const CURRENT_KEY = 'clutch-manager.l.current';
function codeFromHash(): string | null {
  const m = /^#league\/(L[A-Z0-9]{5})$/i.exec(location.hash);
  return m ? m[1]!.toUpperCase() : null;
}
function readCurrent(): string | null {
  try { return localStorage.getItem(CURRENT_KEY); } catch { return null; }
}
function writeCurrent(id: string | null) {
  try { if (id) localStorage.setItem(CURRENT_KEY, id); else localStorage.removeItem(CURRENT_KEY); } catch { /* fine */ }
}

export const PHASE_LABEL = { preseason: 'starting soon', league: 'league stage', playoffs: 'playoffs', offseason: 'off-season' } as const;

export function LeagueApp({ onExit }: { onExit: () => void }) {
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

  const open = (id: string | null) => { writeCurrent(id); setCurrent(id); if (!id && codeFromHash()) history.replaceState(null, '', '#league'); };

  let body;
  if (!onlineAvailable()) body = <main className="tn-main"><section className="panel"><h2>The league needs the online version</h2><p className="muted">This copy of the game isn’t connected to the league server. Open the game from the link the league owner shared.</p></section></main>;
  else if (me === undefined) body = <p className="muted small tn-loading">Connecting…</p>;
  else if (!me) body = <AuthForm />;
  else if (current && !(joinCode && joinCode !== current)) body = <LeagueView id={current} me={me} onLeave={() => open(null)} />;
  else body = <LeagueHome me={me} joinCode={joinCode} onOpen={open} />;

  return (
    <div className="tn-app">
      <header className="tn-top">
        <div className="wordmark"><BrandMark />Clutch<b>/</b>Manager <span className="tn-badge">Clutch League</span></div>
        <div className="row" style={{ gap: 8 }}>
          {me && <button className="btn small ghost" onClick={() => { open(null); void signOut(); }} title={me.email}>Sign out</button>}
          <button className="btn small" onClick={onExit}>Career game</button>
        </div>
      </header>
      {body}
    </div>
  );
}

/** Builds the club for the next season this seat plays, and saves it here and online. */
export async function startLeagueClub(l: League, slot: number, me: Me, v: ClubChoice, joinedAt: number): Promise<LeagueClub> {
  const world = tournamentWorld();
  const season = firstSeasonFor(l, joinedAt);
  const club = createLeagueClub(world, l, slot, season, {
    manager: v.manager.trim(), team: v.team.trim(), tag: v.tag, coachId: v.coachId, today: dateIn(l.tz, nowMs()),
    // Same seed for every club, so everyone starts with an equally strong squad.
    seed: (hashString(`${l.id}:club`) % 2147483646) + 1,
  });
  await saveClub(l.id, me.id, club, true);
  return club;
}

function LeagueHome({ me, joinCode, onOpen }: { me: Me; joinCode: string | null; onOpen: (id: string) => void }) {
  const world = tournamentWorld();
  const [list, setList] = useState<{ league: League; seats: number }[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'join' | 'create'>(joinCode ? 'join' : 'create');
  const [club, setClub] = useState<ClubChoice>({ manager: '', team: '', tag: '', coachId: starterCoaches(world)[0]!.id });
  const tomorrow = addDays(dateIn('Europe/Berlin', nowMs()), 1);
  const [name, setName] = useState('Clutch League');
  const [start, setStart] = useState(tomorrow);
  const [cap, setCap] = useState(DEFAULT_MAX_TEAMS);
  const [prizes, setPrizes] = useState('');
  const [code, setCode] = useState(joinCode ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { myLeagues(me.id).then(setList, (e) => setListErr((e as Error).message)); }, [me.id]);

  const seatFor = (slot: number) => ({ slot, userId: me.id, manager: club.manager.trim(), team: club.team.trim(), tag: club.tag, joinedAt: nowMs() });

  const create = async () => {
    setErr(null);
    const bad = clubOk(club);
    if (bad) { setErr(bad); return; }
    setBusy(true);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const l = newLeague({ id: newLeagueCode(), name, ownerId: me.id, firstSeasonStart: start, now: nowMs(), maxTeams: cap, prizes: prizes.split('\n') });
        if (firstKickoff(l, 1) <= nowMs()) { setErr('The first season must start in the future.'); return; }
        const r = await createLeague(l);
        if (!r.ok) { if (/taken/.test(r.reason) && attempt < 2) continue; setErr(r.reason); return; }
        const j = await joinLeague(l.id, seatFor(0));
        if (!j.ok) { setErr(j.reason); return; }
        await startLeagueClub(l, j.slot, me, club, nowMs());
        onOpen(l.id);
        return;
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const join = async () => {
    setErr(null);
    const id = code.trim().toUpperCase();
    if (!/^L[A-Z0-9]{5}$/.test(id)) { setErr('A league code is an L followed by 5 letters or digits.'); return; }
    const bad = clubOk(club);
    if (bad) { setErr(bad); return; }
    setBusy(true);
    try {
      const r = await joinLeague(id, seatFor(0));
      if (!r.ok) { setErr(r.reason); return; }
      const got = await loadLeague(id);
      if (!got) { setErr('No league with that code.'); return; }
      const seat = got.seats.find((s) => s.userId === me.id);
      await startLeagueClub(got.league, r.slot, me, club, seat?.joinedAt ?? nowMs());
      onOpen(id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const preview = (() => { try { return firstKickoff(newLeague({ id: 'LXXXXX', name, ownerId: me.id, firstSeasonStart: start, now: 0 }), 1); } catch { return null; } })();

  return (
    <main className="tn-main">
      <header className="page-head">
        <div>
          <span className="label">Up to {DEFAULT_MAX_TEAMS} managers · 14 league nights · top-8 playoffs</span>
          <h1>Clutch League</h1>
          <p className="sub">One league that runs season after season. Every night at 20:00 Central European time each team plays a team with a similar record. After 14 nights the top 8 play the playoffs for the title and the prizes. Every new season your players start again from their real-world numbers, and you grind them up by playing well. Signed in as {me.email}.</p>
        </div>
      </header>

      {list && list.length > 0 && (
        <section className="panel">
          <div className="panel-head"><span className="label">Your leagues</span></div>
          <ul className="tn-list">
            {list.map(({ league: l, seats }) => {
              const at = seasonAt(l, nowMs());
              return (
                <li key={l.id}>
                  <button className="tn-list-item" onClick={() => onOpen(l.id)}>
                    <b>{l.name}</b>
                    <span className="mono small">{l.id}</span>
                    <span className="small muted">{seats}/{l.maxTeams} managers · season {at.season}, {PHASE_LABEL[at.phase]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {listErr && <p className="small bad">{listErr}</p>}

      <section className="panel">
        <div className="seg" role="group" aria-label="Create or join">
          <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create a league</button>
          <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>Join with a code</button>
        </div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void (mode === 'create' ? create() : join()); }}>
          {mode === 'create' ? (
            <>
              <div className="tn-fields">
                <label className="field"><span className="label">League name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
                <label className="field"><span className="label">Season 1 starts</span><input type="date" min={tomorrow} value={start} onChange={(e) => setStart(e.target.value)} required /></label>
                <label className="field tn-tag"><span className="label">Seats</span><input type="number" min={2} max={MAX_TEAMS_LIMIT} value={cap} onChange={(e) => setCap(Number(e.target.value) || DEFAULT_MAX_TEAMS)} /></label>
              </div>
              <label className="field"><span className="label">Prizes (one line per place, champion first)</span>
                <textarea rows={4} value={prizes} onChange={(e) => setPrizes(e.target.value)} placeholder={'AWP | Asiimov (Field-Tested)\nAK-47 | Redline (Minimal Wear)\nUSP-S | Kill Confirmed'} />
              </label>
              <p className="small faint">You hand the prizes out yourself. Entry stays free, so the league is a plain skill contest. You can edit the prize list and the seat count later.</p>
            </>
          ) : (
            <label className="field"><span className="label">League code</span><input className="mono" value={code} maxLength={6} placeholder="L7KQ2M" onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} /></label>
          )}
          {mode === 'create' && preview && <p className="small muted">First kickoff {fmtDay(preview)}, {fmtTime(preview)} your time. Managers can join any time; a seat plays from the next season that hasn’t started.</p>}
          <h2 className="tn-sub">Your league club</h2>
          <p className="small muted">A club just for this league, built the same way for everyone. Your career save is not touched.</p>
          <ClubFields value={club} onChange={setClub} />
          <button type="submit" className={`btn primary${busy ? ' loading' : ''}`} disabled={busy}>{mode === 'create' ? 'Create league' : 'Join league'}</button>
          {err && <p className="small bad" role="alert">{err}</p>}
        </form>
      </section>
    </main>
  );
}
