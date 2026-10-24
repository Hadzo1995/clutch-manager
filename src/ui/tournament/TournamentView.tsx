/**
 * One tournament: the lobby before day 1, then the table, the schedule, your
 * lineup and map preferences, and your club's Squad, Train and Cases screens.
 *
 * This browser also does its share of the work: once a kickoff has passed
 * (plus a short settle delay) it plays its own matches from both entries,
 * puts them on the club's books, and stores the result if nobody has yet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Career } from '../../engine/career';
import { humanSnapshot, lineupValidation, starterCoaches } from '../../engine/career';
import { fingerprint } from '../../engine/pvp';
import type { SeriesResult } from '../../engine/match';
import { applyForfeit, applyMatch, canTrainToday, restUpTo, trainToday } from '../../engine/tclub';
import {
  SETTLE_DELAY_MS, addDays, dateIn, entryFor, firstKickoff, forfeitResult, isForfeit, kickoffAt, makeEntry, matchSeedFor, schedule, seatOf, slotFor, standings, statusAt, validateStart,
} from '../../engine/tournament';
import type { Seat, TEntry, TMatch, TResult, Tournament } from '../../engine/tournament';
import { nowMs } from '../../online/supa';
import type { Me } from '../../online/supa';
import { fetchEntries, fetchResults, flagResult, loadTournament, storeResult, submitEntry, updateTournament, watchTournament } from '../../online/tapi';
import { GameCtx, TabIcon } from '../common';
import type { Game } from '../common';
import { Cases } from '../screens/Cases';
import { Live, Report } from '../screens/Match';
import { PlayerSheet } from '../screens/PlayerSheet';
import { Squad } from '../screens/Squad';
import { Train } from '../screens/Train';
import { ClubFields, STATUS_LABEL, clubOk, fmtDay, fmtTime, startClub, tournamentWorld } from './TournamentApp';
import type { ClubChoice } from './TournamentApp';
import { flushClub, loadClub, saveClub } from './clubStore';
import { MapPrefs } from './MapPrefs';
import { settle } from './sim';

type Tab = 'overview' | 'maps' | 'squad' | 'train' | 'cases';
const TABS: { id: Tab; label: string; icon: Parameters<typeof TabIcon>[0]['name'] }[] = [
  { id: 'overview', label: 'Tournament', icon: 'league' }, { id: 'maps', label: 'Lineup', icon: 'pvp' }, { id: 'squad', label: 'Squad', icon: 'squad' }, { id: 'train', label: 'Train', icon: 'train' }, { id: 'cases', label: 'Cases', icon: 'cases' },
];

/** Results this browser computed, kept so each match is only played once here. */
type Local = Record<string, { key: string; result: TResult | null }>;
const localKey = (id: string, uid: string) => `clutch-manager.t.${id}.${uid}.local`;
function readLocal(id: string, uid: string): Local {
  try { return JSON.parse(localStorage.getItem(localKey(id, uid)) ?? '{}') as Local; } catch { return {}; }
}
function writeLocal(id: string, uid: string, l: Local) {
  try { localStorage.setItem(localKey(id, uid), JSON.stringify(l)); } catch { /* recomputed next time */ }
}

/** Tournament day (1-based) at a moment, by the calendar in the tournament's time zone. */
export function dayOf(t: Tournament, at: number): number {
  const d = dateIn(t.tz, at);
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${t.startDate}T00:00:00Z`)) / 86_400_000);
  return diff + 1;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function TournamentView({ id, me, onLeave }: { id: string; me: Me; onLeave: () => void }) {
  const world = tournamentWorld();
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [entries, setEntries] = useState<TEntry[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [stored, setStored] = useState<Record<string, TResult>>({});
  const [flags, setFlags] = useState<{ matchId: string; userId: string; agrees: boolean }[]>([]);
  const [local, setLocal] = useState<Local>(() => readLocal(id, me.id));
  const [err, setErr] = useState<string | null>(null);
  const [club, setClub] = useState<Career | null | undefined>(undefined);
  const clubRef = useRef(club);
  clubRef.current = club;
  const [tab, setTab] = useState<Tab>('overview');
  const [now, setNow] = useState(nowMs());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ cardId: string | null; playerId?: string } | null>(null);
  const [watching, setWatching] = useState<TMatch | null>(null);
  const toastTimer = useRef<number>();

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3600);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const nt = await loadTournament(id);
      if (!nt) { setT(null); return; }
      const at = nowMs();
      const [es, rs] = await Promise.all([fetchEntries(nt, me.id), fetchResults(nt)]);
      setT(nt); setEntries(es); setFetchedAt(at); setStored(rs.results); setFlags(rs.flags); setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id, me.id]);

  // First load, live updates, a slow safety refresh, and a refresh whenever the tab comes back.
  useEffect(() => {
    void refresh();
    let last = 0, queued: number | undefined;
    const soon = () => {
      const wait = Math.max(0, last + 3000 - Date.now());
      window.clearTimeout(queued);
      queued = window.setTimeout(() => { last = Date.now(); void refresh(); }, wait);
    };
    let stop: (() => void) | undefined;
    watchTournament(id, soon).then((s) => { stop = s; }, () => {});
    const slow = window.setInterval(soon, 120_000);
    const tick = window.setInterval(() => setNow(nowMs()), 10_000);
    const vis = () => { if (document.visibilityState === 'visible') soon(); else flushClub(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop?.(); window.clearInterval(slow); window.clearInterval(tick); window.clearTimeout(queued); document.removeEventListener('visibilitychange', vis); flushClub(); };
  }, [id, refresh]);

  // Wake up right when the next kickoff's results are due.
  useEffect(() => {
    if (!t) return;
    const next = schedule(t).map((m) => m.kickoff + SETTLE_DELAY_MS + 2000).find((x) => x > nowMs());
    if (!next) return;
    const h = window.setTimeout(() => { setNow(nowMs()); void refresh(); }, Math.min(next - nowMs(), 2 ** 30));
    return () => window.clearTimeout(h);
  }, [t, fetchedAt, refresh]);

  const seat = t ? seatOf(t, me.id) : null;

  // The club: loaded once the tournament is known.
  useEffect(() => {
    if (!t || club !== undefined) return;
    if (seat === null) { setClub(null); return; }
    loadClub(t, me.id).then(setClub, () => setClub(null));
  }, [t, seat, club, me.id]);

  const updateClub = useCallback((next: Career, msg?: string) => {
    setClub(next);
    clubRef.current = next;
    if (t) void saveClub(t, me.id, next).then((ok) => { if (!ok) toast('This browser is blocking storage. Your club is still saved online.'); });
    if (msg) toast(msg);
  }, [t, me.id, toast]);

  // Overnight rest when a new tournament day begins.
  const day = t ? dayOf(t, now) : 0;
  useEffect(() => {
    if (!t || !club?.tournament || day < 2 || day > t.days) return;
    if ((club.tournament.restedDay ?? 1) < day) updateClub(restUpTo(club, day));
  }, [t, club, day, updateClub]);

  // ------------------------------------------------------------ settling matches
  const working = useRef(false);
  useEffect(() => {
    if (!t || !club || seat === null || working.current) return;
    const late = (m: TMatch) => fetchedAt >= m.kickoff + SETTLE_DELAY_MS + 180_000;
    const job = schedule(t).find((m) => {
      if (fetchedAt < m.kickoff + SETTLE_DELAY_MS) return false; // entries fetched before this kickoff settled may be incomplete
      const mine = m.home === seat || m.away === seat;
      if (mine && !club.tournament!.applied.includes(m.id)) return true;
      if (!local[m.id]) return mine || (!stored[m.id] && late(m));
      return !stored[m.id] && !!local[m.id]!.result && (mine || late(m));
    });
    if (!job) return;
    working.current = true;
    void (async () => {
      try {
        const home = entryFor(entries, job.home, job), away = entryFor(entries, job.away, job);
        const key = `${home ? fingerprint(home) : 'none'}:${away ? fingerprint(away) : 'none'}`;
        let result: TResult | null = local[job.id]?.key === key ? local[job.id]!.result : null;
        let series: SeriesResult | null = null;
        const mine = job.home === seat || job.away === seat;
        const needApply = mine && !clubRef.current!.tournament!.applied.includes(job.id);
        if (!result || (needApply && home && away)) {
          if (home && away) ({ series, result } = await settle(t, job, home, away, me.id));
          else result = forfeitResult(job, home, away, me.id, nowMs());
          const nl = { ...readLocal(t.id, me.id), [job.id]: { key, result } };
          writeLocal(t.id, me.id, nl); setLocal(nl);
        }
        if (needApply) {
          const c = clubRef.current!;
          const opp = job.home === seat ? job.away : job.home;
          const o = t.seats[opp];
          const oppName = o?.team ?? `Seat ${opp + 1}`, oppTag = o?.tag ?? `S${opp + 1}`;
          if (series) updateClub(applyMatch(world, c, t, job, series, oppName, oppTag));
          else if (result) updateClub(applyForfeit(c, t, job, result.summary.winner === (job.home === seat ? 0 : 1), oppName));
          else updateClub({ ...c, tournament: { ...c.tournament!, applied: [...c.tournament!.applied, job.id] } }); // nobody had a lineup in
        }
        if (result && !stored[job.id]) {
          await storeResult(t, result, me.id);
          const rs = await fetchResults(t);
          setStored(rs.results); setFlags(rs.flags);
          const s = rs.results[job.id];
          if (s && mine && s.hash !== result.hash) await flagResult(t, job.id, me.id, false);
        } else if (result && mine && stored[job.id] && stored[job.id]!.hash !== result.hash && !flags.some((f) => f.matchId === job.id && f.userId === me.id)) {
          await flagResult(t, job.id, me.id, false);
          setFlags((f) => [...f, { matchId: job.id, userId: me.id, agrees: false }]);
        }
      } catch (e) {
        setErr(`A match couldn’t be settled yet: ${(e as Error).message}`);
      } finally {
        working.current = false;
        setNow(nowMs());
      }
    })();
  }, [t, club, seat, entries, stored, local, flags, fetchedAt, me.id, world, updateClub]);

  // ------------------------------------------------------------ your entry for the next kickoff
  const desired = useMemo(() => {
    if (!club || seat === null || !lineupValidation(club).ok) return null;
    try { return makeEntry(seat, me.id, 0, humanSnapshot(world, club), club.tournament?.mapPrefs ?? [], 0); } catch { return null; }
  }, [club, seat, me.id, world]);
  const mineLatest = useMemo(() => {
    let best: TEntry | null = null;
    for (const e of entries) if (e.seat === seat && (!best || e.slot > best.slot || (e.slot === best.slot && e.submittedAt > best.submittedAt))) best = e;
    return best;
  }, [entries, seat]);
  const upToDate = !!desired && !!mineLatest && mineLatest.teamHash === desired.teamHash && sameList(mineLatest.mapPrefs, desired.mapPrefs);
  const nextSlot = t ? slotFor(t, now) : null;
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const lastTry = useRef<{ key: string; at: number } | null>(null);

  const send = useCallback(async () => {
    if (!t || !desired || nextSlot === null) return;
    const k = `${desired.teamHash}:${desired.mapPrefs.join(',')}`;
    lastTry.current = { key: k, at: Date.now() };
    setSending(true); setSendErr(null);
    try {
      const r = await submitEntry(t, { ...desired, submittedAt: nowMs() });
      if (!r.ok) { setSendErr(r.reason); return; }
      setEntries(await fetchEntries(t, me.id));
    } catch (e) {
      setSendErr((e as Error).message);
    } finally { setSending(false); }
  }, [t, desired, nextSlot, me.id]);

  useEffect(() => {
    if (!desired || upToDate || sending || nextSlot === null || fetchedAt === 0) return;
    const k = `${desired.teamHash}:${desired.mapPrefs.join(',')}`;
    if (lastTry.current?.key === k && Date.now() - lastTry.current.at < 60_000) return;
    const h = window.setTimeout(() => void send(), 5000);
    return () => window.clearTimeout(h);
  }, [desired, upToDate, sending, nextSlot, fetchedAt, send]);

  // ------------------------------------------------------------ rendering
  const game: Game | null = useMemo(() => club ? {
    world, career: club, update: updateClub, toast,
    openPlayer: (cardId, playerId) => setPlayer(cardId || playerId ? { cardId, playerId } : null),
    openClub: () => setTab('squad'),
  } : null, [world, club, updateClub, toast]);

  if (t === undefined) return <main className="tn-main"><p className="muted small">{err ?? 'Loading the tournament…'}</p>{err && <button className="btn" onClick={onLeave}>Back</button>}</main>;
  if (t === null) return <main className="tn-main"><section className="panel"><h2>Tournament not found</h2><p className="muted">No tournament has the code {id}.</p><button className="btn" onClick={onLeave}>Back</button></section></main>;

  const status = statusAt(t, now);
  const results: Record<string, TResult> = {};
  for (const [mid, l] of Object.entries(local)) if (l.result) results[mid] = l.result;
  Object.assign(results, stored);
  const disputed = new Set(flags.filter((f) => !f.agrees).map((f) => f.matchId));
  for (const [mid, l] of Object.entries(local)) if (stored[mid] && l.result && stored[mid]!.hash !== l.result.hash) disputed.add(mid);

  const started = status !== 'open';
  const lockNote = !started ? `Opens on day 1 (${fmtDay(firstKickoff(t))}), so every club starts the same.` : null;
  const daily = club ? { done: !canTrainToday(club, dateIn(t.tz, now)) || status === 'finished', run: () => { try { updateClub(trainToday(world, club, dateIn(t.tz, nowMs())), 'Training done. Your squad can train again tomorrow.'); } catch (e) { toast((e as Error).message); } } } : undefined;

  const overview = (
    <Overview t={t} me={me} seat={seat} now={now} results={results} disputed={disputed} entries={entries}
      entryState={{ desired: !!desired, upToDate, sending, sendErr, nextSlot, lineupError: club ? lineupValidation(club).errors[0] ?? null : null, lastAt: mineLatest?.submittedAt ?? null, send: () => void send() }}
      onWatch={setWatching} onEdited={refresh} goTab={setTab} />
  );

  let body;
  if (seat !== null && club === null) body = <MissingClub t={t} seat={seat} me={me} onReady={setClub} />;
  else if (!game) body = overview;
  else body = (
    <GameCtx.Provider value={game}>
      {tab === 'overview' && overview}
      {tab === 'maps' && <MapPrefs club={club!} onChange={(prefs) => updateClub({ ...club!, tournament: { ...club!.tournament!, mapPrefs: prefs } })} entryNote={entryLine(t, nextSlot, desired !== null, upToDate, sending, sendErr)} goSquad={() => setTab('squad')} />}
      {tab === 'squad' && <Squad />}
      {tab === 'train' && (lockNote ? <Locked title="Training" note={lockNote} /> : <Train goHome={() => setTab('overview')} daily={daily} />)}
      {tab === 'cases' && (lockNote ? <Locked title="Cases" note={lockNote} /> : <Cases goSquad={() => setTab('squad')} />)}
      {player && <PlayerSheet cardId={player.cardId} playerId={player.playerId} onClose={() => setPlayer(null)} />}
      {watching && <Watch t={t} m={watching} entries={entries} seat={seat} result={results[watching.id] ?? null} onClose={() => setWatching(null)} />}
    </GameCtx.Provider>
  );

  return (
    <>
      <div className="tn-bar">
        <button className="btn small ghost" onClick={onLeave} aria-label="All tournaments">‹</button>
        <div className="tn-bar-title"><b>{t.name}</b><span className="small muted">{STATUS_LABEL[status]}{started && status !== 'finished' ? ` · day ${Math.min(Math.max(day, 1), t.days)} of ${t.days}` : ''}</span></div>
        {club && <span className="small muted tn-coins">{club.coins.toLocaleString('en-US')} coins</span>}
      </div>
      {game && (
        <nav className="tn-tabs" aria-label="Tournament">
          {TABS.map((x) => <button key={x.id} aria-current={tab === x.id ? 'page' : undefined} onClick={() => setTab(x.id)}><TabIcon name={x.icon} /><span>{x.label}</span></button>)}
        </nav>
      )}
      <main className="tn-main">
        {err && <p className="small bad tn-err" role="alert">{err} <button className="btn small ghost" onClick={() => void refresh()}>Retry</button></p>}
        {body}
      </main>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </>
  );
}

function entryLine(t: Tournament, nextSlot: number | null, ready: boolean, upToDate: boolean, sending: boolean, sendErr: string | null): string {
  if (nextSlot === null) return 'The tournament is over.';
  const ko = `${fmtDay(kickoffAt(t, nextSlot))}, ${fmtTime(kickoffAt(t, nextSlot))}`;
  if (!ready) return `Your lineup isn’t complete, so the last one you sent will play at ${ko}.`;
  if (sendErr) return `Not sent: ${sendErr}`;
  if (sending) return 'Sending…';
  if (upToDate) return `Your lineup and map preferences are in for the ${ko} kickoff.`;
  return `Changes are sent automatically in a few seconds, in time for ${ko}.`;
}

function Locked({ title, note }: { title: string; note: string }) {
  return <section className="panel"><h1>{title}</h1><p className="muted">{note}</p></section>;
}

function MissingClub({ t, seat, me, onReady }: { t: Tournament; seat: Seat; me: Me; onReady: (c: Career) => void }) {
  const s = t.seats[seat]!;
  const [v, setV] = useState<ClubChoice>({ manager: s.manager, team: s.team, tag: s.tag, coachId: starterCoaches(tournamentWorld())[0]!.id });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>Set up your club on this device</h2>
      <p className="muted small">Your seat is saved, but your club isn’t on this device or online yet. Every club starts the same way, so nothing is lost by setting it up again.</p>
      <ClubFields value={v} onChange={setV} />
      <button className={`btn primary${busy ? ' loading' : ''}`} disabled={busy} onClick={() => {
        const bad = clubOk(v);
        if (bad) { setErr(bad); return; }
        setBusy(true); setErr(null);
        startClub(t, seat, me, v).then(onReady, (e) => setErr((e as Error).message)).finally(() => setBusy(false));
      }}>Set up club</button>
      {err && <p className="small bad">{err}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ overview

interface EntryState { desired: boolean; upToDate: boolean; sending: boolean; sendErr: string | null; nextSlot: number | null; lineupError: string | null; lastAt: number | null; send: () => void }

function Countdown({ to }: { to: number }) {
  const [n, setN] = useState(nowMs());
  useEffect(() => { const h = window.setInterval(() => setN(nowMs()), 1000); return () => window.clearInterval(h); }, []);
  const s = Math.max(0, Math.round((to - n) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <span className="num">{d > 0 ? `${d}d ` : ''}{d > 0 || h > 0 ? `${h}h ` : ''}{m}m {String(sec).padStart(2, '0')}s</span>;
}

function Overview({ t, me, seat, now, results, disputed, entries, entryState: es, onWatch, onEdited, goTab }: {
  t: Tournament; me: Me; seat: Seat | null; now: number; results: Record<string, TResult>; disputed: Set<string>; entries: TEntry[]; entryState: EntryState;
  onWatch: (m: TMatch) => void; onEdited: () => void; goTab: (t: Tab) => void;
}) {
  const status = statusAt(t, now);
  const sched = useMemo(() => schedule(t), [t]);
  const table = standings(t, results);
  const name = (s: Seat) => t.seats[s]?.team ?? `Open seat ${s + 1}`;
  const tag = (s: Seat) => t.seats[s]?.tag ?? `S${s + 1}`;
  const nextMine = seat === null ? undefined : sched.find((m) => m.kickoff > now && (m.home === seat || m.away === seat));
  const [day, setDay] = useState(() => Math.min(Math.max(dayOf(t, now), 1), t.days));
  const link = `${location.origin}${location.pathname}#tournament/${t.id}`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(`${what} copied.`); } catch { setCopied('Copying is blocked here. Select it and copy it yourself.'); }
  };

  return (
    <>
      {status === 'open' && (
        <section className="panel tn-lobby">
          <div className="panel-head"><span className="label">Lobby</span><span className="chip">{t.seats.filter(Boolean).length}/4 managers</span></div>
          <p>First kickoff <b>{fmtDay(firstKickoff(t))}, {fmtTime(firstKickoff(t))}</b> · starts in <Countdown to={firstKickoff(t)} /></p>
          <ol className="tn-seats">
            {t.seats.map((s, i) => <li key={i} className={s ? 'taken' : ''}>{s ? <><span className="tag">{s.tag}</span> <b>{s.team}</b> <span className="small muted">{s.manager}{s.userId === me.id ? ' (you)' : ''}</span></> : <span className="muted small">Open seat</span>}</li>)}
          </ol>
          <div className="tn-share">
            <span className="small muted">Send your friends the code or the link. They sign up, then join.</span>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn small mono" onClick={() => void copy(t.id, 'Code')} title="Copy the code">{t.id}</button>
              <input className="tn-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
              <button className="btn small" onClick={() => void copy(link, 'Link')}>Copy link</button>
            </div>
            {copied && <span className="small muted" role="status">{copied}</span>}
          </div>
          {t.ownerId === me.id && <StartEditor t={t} onSaved={onEdited} />}
          {t.seats.some((s) => !s) && <p className="small faint">A seat still empty at the first kickoff loses its matches by forfeit.</p>}
        </section>
      )}

      {seat !== null && status !== 'finished' && (
        <section className="panel span-6">
          <div className="panel-head"><span className="label">Your next match</span></div>
          {nextMine ? (
            <>
              <p className="tn-next"><span className="tag">{tag(seat)}</span> vs <span className="tag">{tag(nextMine.home === seat ? nextMine.away : nextMine.home)}</span> <b>{name(nextMine.home === seat ? nextMine.away : nextMine.home)}</b></p>
              <p className="small muted">{fmtDay(nextMine.kickoff)}, {fmtTime(nextMine.kickoff)} · {nextMine.format.toUpperCase()} · in <Countdown to={nextMine.kickoff} /></p>
            </>
          ) : <p className="muted small">No more matches.</p>}
          <p className={`small ${es.sendErr || es.lineupError ? 'bad' : es.upToDate ? 'good' : 'muted'}`}>
            {es.lineupError ? `Lineup problem: ${es.lineupError} Until it’s fixed, your last sent lineup plays.` : es.sendErr ? `Not sent: ${es.sendErr}` : es.sending ? 'Sending your lineup…' : es.upToDate ? `Lineup and map preferences are in${es.lastAt ? ` (sent ${fmtTime(es.lastAt)})` : ''}.` : 'You have changes that aren’t sent yet. They go automatically in a few seconds.'}
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn small" onClick={() => goTab('maps')}>Lineup and maps</button>
            {!es.upToDate && es.desired && <button className={`btn small primary${es.sending ? ' loading' : ''}`} disabled={es.sending} onClick={es.send}>Send now</button>}
          </div>
          <p className="small faint">Whatever is sent before kickoff plays. Changes after kickoff count for the next match.</p>
        </section>
      )}

      <section className={`panel ${seat !== null && status !== 'finished' ? 'span-6' : ''}`}>
        <div className="panel-head"><span className="label">Table</span><span className="small faint">Win 3 pts · then head-to-head, maps, rounds</span></div>
        <div className="scroll-x">
          <table className="tbl tn-table">
            <thead><tr><th>#</th><th>Team</th><th className="num">P</th><th className="num">W</th><th className="num">L</th><th className="num">Maps</th><th className="num">Rounds</th><th className="num">Pts</th></tr></thead>
            <tbody>
              {table.map((r, i) => (
                <tr key={r.seat} className={r.seat === seat ? 'me' : ''}>
                  <td className="num">{i + 1}</td>
                  <td><span className="tag">{tag(r.seat)}</span> {name(r.seat)}</td>
                  <td className="num">{r.played}</td><td className="num">{r.wins}</td><td className="num">{r.losses}</td>
                  <td className="num">{r.mapsWon}–{r.mapsLost}</td>
                  <td className="num">{r.roundsWon - r.roundsLost > 0 ? '+' : ''}{r.roundsWon - r.roundsLost}</td>
                  <td className="num"><b>{r.points}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="label">Schedule</span>
          <div className="seg tn-days" role="group" aria-label="Day">
            {Array.from({ length: t.days }, (_, i) => <button key={i} aria-pressed={day === i + 1} onClick={() => setDay(i + 1)}>{i + 1}</button>)}
          </div>
        </div>
        <p className="small muted">Day {day} · {fmtDay(kickoffAt(t, (day - 1) * t.kickoffs.length))} · {(t.formats[day - 1] ?? 'bo1').toUpperCase()}</p>
        <ul className="tn-sched">
          {sched.filter((m) => m.day === day).map((m) => {
            const r = results[m.id];
            const mine = seat !== null && (m.home === seat || m.away === seat);
            const due = now >= m.kickoff + SETTLE_DELAY_MS;
            const canWatch = !!r && !isForfeit(r) && seat !== null && !!entryFor(entries, m.home, m) && !!entryFor(entries, m.away, m);
            return (
              <li key={m.id} className={mine ? 'mine' : ''}>
                <span className="num small tn-ko">{fmtTime(m.kickoff)}</span>
                <span className={`tn-side${r && r.summary.winner === 0 ? ' won' : ''}`}><span className="tag">{tag(m.home)}</span></span>
                <span className="num tn-score">{r ? `${r.summary.mapScore[0]}–${r.summary.mapScore[1]}` : due ? '…' : 'vs'}</span>
                <span className={`tn-side${r && r.summary.winner === 1 ? ' won' : ''}`}><span className="tag">{tag(m.away)}</span></span>
                <span className="tn-act">
                  {r && isForfeit(r) && <span className="chip">Forfeit</span>}
                  {disputed.has(m.id) && <span className="chip bad" title="Two browsers computed different results for this match">Disputed</span>}
                  {r && r.maps.length > 0 && <span className="small faint">{r.summary.maps.map((x) => `${x.map} ${x.score[0]}-${x.score[1]}`).join(' · ')}</span>}
                  {canWatch && <button className="btn small ghost" onClick={() => onWatch(m)}>Watch</button>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function StartEditor({ t, onSaved }: { t: Tournament; onSaved: () => void }) {
  const [date, setDate] = useState(t.startDate);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const min = addDays(dateIn(t.tz, nowMs()), 1);
  return (
    <form className="row wrap tn-start" style={{ gap: 8 }} onSubmit={(e) => {
      e.preventDefault();
      const next = { ...t, startDate: date };
      const v = validateStart(next, nowMs());
      if (!v.ok) { setMsg(v.errors[0]!); return; }
      setBusy(true); setMsg(null);
      updateTournament(next).then((r) => { setMsg(r.ok ? 'Start date changed.' : r.reason); if (r.ok) onSaved(); }, (e) => setMsg((e as Error).message)).finally(() => setBusy(false));
    }}>
      <label className="field"><span className="label">Day 1 (organiser)</span><input type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <button type="submit" className={`btn small${busy ? ' loading' : ''}`} disabled={busy || date === t.startDate}>Change start</button>
      {msg && <span className="small muted">{msg}</span>}
    </form>
  );
}

// ------------------------------------------------------------------ watching a match

function Watch({ t, m, entries, seat, result, onClose }: { t: Tournament; m: TMatch; entries: TEntry[]; seat: Seat | null; result: TResult | null; onClose: () => void }) {
  const home = entryFor(entries, m.home, m), away = entryFor(entries, m.away, m);
  const [series, setSeries] = useState<SeriesResult | null>(null);
  if (!home || !away || !result) return null;
  const teams = [{ ...home.team, name: t.seats[m.home]?.team ?? home.team.name, tag: t.seats[m.home]?.tag ?? home.team.tag }, { ...away.team, name: t.seats[m.away]?.team ?? away.team.name, tag: t.seats[m.away]?.tag ?? away.team.tag }] as [typeof home.team, typeof away.team];
  const side = seat === m.away ? 1 : 0;
  if (!series) {
    return (
      <div className="fullscreen" role="dialog" aria-label="Tournament match">
        <div className="inner mx-inner mx-live wide">
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn small ghost" onClick={onClose}>Close</button></div>
          <Live teams={teams} humanIdx={side} maps={result.maps} format={m.format} seed={matchSeedFor(t, m, home, away)} instant={false} stageLabel={`${t.name} · day ${m.day}`} locked onFinished={setSeries} />
        </div>
      </div>
    );
  }
  return (
    <div className="fullscreen" role="dialog" aria-label="Tournament result">
      <div className="inner mx-inner mx-report">
        <Report series={series} teams={teams} humanIdx={side} onContinue={onClose} pvp={{
          note: series.winner === result.summary.winner ? 'This replay matches the stored result.' : 'This replay differs from the stored result, so the match is marked as disputed.',
          actions: <button className="btn primary" onClick={onClose}>Back to the tournament</button>,
        }} />
      </div>
    </div>
  );
}
