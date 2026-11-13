/**
 * One league: the season table, nightly fixtures, playoffs, prizes, awards and
 * the hall of champions, plus your club's Lineup, Squad, Train and Cases.
 *
 * This browser does its share of the work: once a kickoff has passed (plus a
 * short settle delay) it plays its own matches, puts them on the club's books
 * and stores the result if nobody has yet. Matches nobody has settled a few
 * minutes after they were due are played by whoever is online, so the Swiss
 * pairings for the next night can be drawn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Career } from '../../engine/career';
import { humanSnapshot, lineupValidation, starterCoaches } from '../../engine/career';
import { applyForfeit, applyMatch, canTrainToday, closeSeason, isLeagueClub, ordinalPlace, restOvernight, startSeason, trainToday } from '../../engine/lclub';
import type { LeagueClub } from '../../engine/lclub';
import {
  FINAL_DAY, MAX_TEAMS_LIMIT, MVP_MIN_MAPS, PLAYOFF_TEAMS, PRIZE_SHARES, QF_DAY, SETTLE_DELAY_MS, STAGE_LABEL, SWISS_ROUNDS,
  avgRating, buildSeason, cleanPrizes, dayFor, finalPlacings, firstKickoff, forfeitResult, isForfeit, kickoffAt, makeEntry, matchSeed,
  playerSeasons, prizeFor, seasonAt, seasonAwards, seasonMatches, seatOf, sideFor, slotName, standings,
} from '../../engine/league';
import type { LEntry, LMatch, LResult, League, LeagueSeason, LeagueSeat } from '../../engine/league';
import type { SeriesResult } from '../../engine/match';
import { fingerprint } from '../../engine/pvp';
import { dateIn } from '../../engine/tournament';
import { nowMs } from '../../online/supa';
import type { Me } from '../../online/supa';
import { fetchEntries, fetchResults, fetchSeason, flagResult, loadLeague, storeResult, storeSeason, submitEntry, updateLeague, watchLeague } from '../../online/lapi';
import { GameCtx, TabIcon } from '../common';
import type { Game } from '../common';
import { Cases } from '../screens/Cases';
import { Live, Report } from '../screens/Match';
import { PlayerSheet } from '../screens/PlayerSheet';
import { Squad } from '../screens/Squad';
import { Train } from '../screens/Train';
import { MapPrefs } from '../tournament/MapPrefs';
import { ClubFields, clubOk, fmtDay, fmtTime, tournamentWorld } from '../tournament/TournamentApp';
import type { ClubChoice } from '../tournament/TournamentApp';
import { PHASE_LABEL, startLeagueClub } from './LeagueApp';
import { flushClub, loadClub, saveClub } from './clubStore';
import { settle } from './sim';

type Tab = 'overview' | 'maps' | 'squad' | 'train' | 'cases';
const TABS: { id: Tab; label: string; icon: Parameters<typeof TabIcon>[0]['name'] }[] = [
  { id: 'overview', label: 'League', icon: 'league' }, { id: 'maps', label: 'Lineup', icon: 'pvp' }, { id: 'squad', label: 'Squad', icon: 'squad' }, { id: 'train', label: 'Train', icon: 'train' }, { id: 'cases', label: 'Cases', icon: 'cases' },
];

/** Results this browser computed, kept so each match is only played once here. */
type Local = Record<string, { key: string; result: LResult | null }>;
const localKey = (id: string, uid: string) => `clutch-manager.l.${id}.${uid}.local`;
function readLocal(id: string, uid: string): Local {
  try { return JSON.parse(localStorage.getItem(localKey(id, uid)) ?? '{}') as Local; } catch { return {}; }
}
function writeLocal(id: string, uid: string, l: Local) {
  try { localStorage.setItem(localKey(id, uid), JSON.stringify(l)); } catch { /* recomputed next time */ }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
type Side = { team: LEntry['team']; prefs: LEntry['mapPrefs'] };

/** The season whose matches are being played or were played last (0 before season 1 starts). */
export function activeSeason(l: League, now: number): number {
  const at = seasonAt(l, now);
  if (at.phase !== 'preseason') return at.season;
  return now >= firstKickoff(l, 1) ? at.season - 1 : 0;
}

/** The season of the next kickoff, and its day. */
export function nextKickoff(l: League, now: number): { season: number; day: number } {
  const at = seasonAt(l, now);
  const d = dayFor(l, at.season, now);
  return d ? { season: at.season, day: d } : { season: at.season + 1, day: 1 };
}

export function LeagueView({ id, me, onLeave }: { id: string; me: Me; onLeave: () => void }) {
  const world = tournamentWorld();
  const [league, setLeague] = useState<League | null | undefined>(undefined);
  const [seats, setSeats] = useState<LeagueSeat[]>([]);
  const [now, setNow] = useState(nowMs());
  const active = league ? activeSeason(league, now) : 0;
  const [viewSeason, setViewSeason] = useState<number | null>(null);
  const shown = viewSeason ?? Math.max(1, active || 1);
  const [sDoc, setSDoc] = useState<LeagueSeason | null>(null);
  const [provisional, setProvisional] = useState(false);
  const [entries, setEntries] = useState<LEntry[]>([]);
  const [stored, setStored] = useState<Record<string, LResult>>({});
  const [flags, setFlags] = useState<{ matchId: string; userId: string; agrees: boolean }[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [local, setLocal] = useState<Local>(() => readLocal(id, me.id));
  const [err, setErr] = useState<string | null>(null);
  const [club, setClub] = useState<LeagueClub | null | undefined>(undefined);
  const clubRef = useRef(club);
  clubRef.current = club;
  const [tab, setTab] = useState<Tab>('overview');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ cardId: string | null; playerId?: string } | null>(null);
  const [watching, setWatching] = useState<LMatch | null>(null);
  const toastTimer = useRef<number>();

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3600);
  }, []);

  const mySeat = seatOf(seats, me.id);

  const refresh = useCallback(async () => {
    try {
      const got = await loadLeague(id);
      if (!got) { setLeague(null); return; }
      const at = nowMs();
      const season = viewSeason ?? Math.max(1, activeSeason(got.league, at) || 1);
      let doc = await fetchSeason(id, season);
      let prov = false;
      if (!doc) {
        doc = buildSeason(got.league, season, got.seats, world.profileList, world.coaches);
        // Once the season has started, the first seated manager online fixes its line-up for everyone.
        if (at >= firstKickoff(got.league, season) && seatOf(got.seats, me.id)) doc = await storeSeason(doc, me.id);
        else prov = true;
      }
      const [es, rs] = await Promise.all([fetchEntries(got.league, got.seats, season), fetchResults(id, season)]);
      setLeague(got.league); setSeats(got.seats); setSDoc(doc); setProvisional(prov); setEntries(es); setStored(rs.results); setFlags(rs.flags); setFetchedAt(at); setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [id, me.id, viewSeason, world]);

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
    watchLeague(id, soon).then((s) => { stop = s; }, () => {});
    const slow = window.setInterval(soon, 120_000);
    const tick = window.setInterval(() => setNow(nowMs()), 10_000);
    const vis = () => { if (document.visibilityState === 'visible') soon(); else flushClub(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop?.(); window.clearInterval(slow); window.clearInterval(tick); window.clearTimeout(queued); document.removeEventListener('visibilitychange', vis); flushClub(); };
  }, [id, refresh]);

  // Wake up right when the next results are due.
  useEffect(() => {
    if (!league) return;
    const nk = nextKickoff(league, nowMs());
    const due = kickoffAt(league, nk.season, nk.day) + SETTLE_DELAY_MS + 2000;
    const h = window.setTimeout(() => { setNow(nowMs()); void refresh(); }, Math.min(Math.max(1000, due - nowMs()), 2 ** 30));
    return () => window.clearTimeout(h);
  }, [league, fetchedAt, refresh]);

  // The club: loaded once the league is known.
  useEffect(() => {
    if (!league || club !== undefined) return;
    if (!mySeat) { setClub(null); return; }
    loadClub(id, me.id).then((c) => setClub(c && isLeagueClub(c) ? c : null), () => setClub(null));
  }, [league, mySeat, club, id, me.id]);

  const updateClub = useCallback((next: Career, msg?: string) => {
    if (!isLeagueClub(next)) return;
    setClub(next);
    clubRef.current = next;
    void saveClub(id, me.id, next).then((ok) => { if (!ok) toast('This browser is blocking storage. Your club is still saved online.'); });
    if (msg) toast(msg);
  }, [id, me.id, toast]);

  // Overnight rest, and a fresh start for the squad once the next kickoff belongs to a new season.
  const today = league ? dateIn(league.tz, now) : '';
  const nk = league ? nextKickoff(league, now) : null;
  useEffect(() => {
    if (!league || !club || !nk) return;
    let next = restOvernight(club, today);
    if (nk.season > next.league.season) next = startSeason(next, nk.season);
    if (next !== club) updateClub(next);
  }, [league, club, today, nk?.season]); // eslint-disable-line react-hooks/exhaustive-deps

  // Season prizes: close any season this club played whose final is in.
  useEffect(() => {
    if (!league || !club || !sDoc || provisional) return;
    const mine = Object.entries(sDoc.managers).find(([, m]) => m.userId === me.id);
    if (!mine || club.league.closed.includes(sDoc.season)) return;
    const results: Record<string, LResult> = { ...stored };
    const placings = finalPlacings(league, sDoc, results);
    if (!placings) return;
    const place = placings.indexOf(Number(mine[0])) + 1;
    if (place > 0) updateClub(closeSeason(club, league, sDoc.season, place, sDoc.size), place === 1 ? `Champions of season ${sDoc.season}!` : `Season ${sDoc.season} finished ${ordinalPlace(place)}.`);
  }, [league, club, sDoc, provisional, stored, me.id, updateClub]);

  // ------------------------------------------------------------ settling matches
  const working = useRef(false);
  const results = useMemo(() => {
    const r: Record<string, LResult> = {};
    for (const [mid, l] of Object.entries(local)) if (l.result && mid.startsWith(`s${shown}`)) r[mid] = l.result;
    return Object.assign(r, stored);
  }, [local, stored, shown]);
  const matches = useMemo(() => (league && sDoc ? seasonMatches(league, sDoc, results) : []), [league, sDoc, results]);
  const mySlot = sDoc ? Number(Object.entries(sDoc.managers).find(([, m]) => m.userId === me.id)?.[0] ?? -1) : -1;

  useEffect(() => {
    if (!league || !sDoc || provisional || !mySeat || working.current) return;
    if (shown !== active) return; // only the season being played is settled here
    const late = (m: LMatch) => fetchedAt >= m.kickoff + SETTLE_DELAY_MS + 180_000;
    const c = clubRef.current;
    const job = matches.find((m) => {
      if (fetchedAt < m.kickoff + SETTLE_DELAY_MS) return false; // lineups fetched before this kickoff settled may be incomplete
      const mine = m.home === mySlot || m.away === mySlot;
      if (mine && c && !c.league.applied.includes(m.id)) return true;
      if (!local[m.id]) return mine || (!stored[m.id] && late(m));
      return !stored[m.id] && !!local[m.id]!.result && (mine || late(m));
    });
    if (!job) return;
    working.current = true;
    void (async () => {
      try {
        const home = sideFor(sDoc, entries, job.home, job), away = sideFor(sDoc, entries, job.away, job);
        const key = `${home ? fingerprint(home.team) : 'none'}:${away ? fingerprint(away.team) : 'none'}`;
        let result: LResult | null = local[job.id]?.key === key ? local[job.id]!.result : null;
        let series: SeriesResult | null = null;
        const mine = job.home === mySlot || job.away === mySlot;
        const needApply = mine && !!clubRef.current && !clubRef.current.league.applied.includes(job.id);
        if (!result || (needApply && home && away)) {
          if (home && away) ({ series, result } = await settle(league, job, home, away, me.id));
          else result = forfeitResult(job, home, away, me.id, nowMs());
          const nl = { ...readLocal(id, me.id), [job.id]: { key, result } };
          writeLocal(id, me.id, nl); setLocal(nl);
        }
        if (needApply) {
          const cl = clubRef.current!;
          const opp = slotName(sDoc, job.home === mySlot ? job.away : job.home);
          if (series) updateClub(applyMatch(world, cl, job, series, opp.name, opp.tag));
          else if (result) updateClub(applyForfeit(cl, job, result.summary.winner === (job.home === mySlot ? 0 : 1), opp.name));
          else updateClub({ ...cl, league: { ...cl.league, applied: [...cl.league.applied, job.id] } } as LeagueClub);
        }
        if (result && !stored[job.id]) {
          await storeResult(id, job.season, result, me.id);
          const rs = await fetchResults(id, job.season);
          setStored(rs.results); setFlags(rs.flags);
          const s = rs.results[job.id];
          if (s && mine && s.hash !== result.hash) await flagResult(id, job.id, me.id, false);
        } else if (result && mine && stored[job.id] && stored[job.id]!.hash !== result.hash && !flags.some((f) => f.matchId === job.id && f.userId === me.id)) {
          await flagResult(id, job.id, me.id, false);
          setFlags((f) => [...f, { matchId: job.id, userId: me.id, agrees: false }]);
        }
      } catch (e) {
        setErr(`A match couldn’t be settled yet: ${(e as Error).message}`);
      } finally {
        working.current = false;
        setNow(nowMs());
      }
    })();
  }, [league, sDoc, provisional, mySeat, shown, active, matches, entries, stored, local, flags, fetchedAt, mySlot, me.id, id, world, updateClub]);

  // ------------------------------------------------------------ your lineup for the next kickoff
  const desired = useMemo(() => {
    if (!club || !mySeat || !nk || !lineupValidation(club).ok) return null;
    try { return makeEntry(mySeat.slot, me.id, nk.season, nk.day, humanSnapshot(world, club), club.league.mapPrefs ?? [], 0); } catch { return null; }
  }, [club, mySeat, me.id, world, nk?.season, nk?.day]); // eslint-disable-line react-hooks/exhaustive-deps
  const mineLatest = useMemo(() => {
    let best: LEntry | null = null;
    const k = (e: LEntry) => e.season * 100 + e.day;
    for (const e of entries) if (mySeat && e.slot === mySeat.slot && (!best || k(e) > k(best) || (k(e) === k(best) && e.submittedAt > best.submittedAt))) best = e;
    return best;
  }, [entries, mySeat]);
  const upToDate = !!desired && !!mineLatest && mineLatest.teamHash === desired.teamHash && sameList(mineLatest.mapPrefs, desired.mapPrefs);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const lastTry = useRef<{ key: string; at: number } | null>(null);

  const send = useCallback(async () => {
    if (!league || !desired || !mySeat) return;
    lastTry.current = { key: `${desired.teamHash}:${desired.mapPrefs.join(',')}`, at: Date.now() };
    setSending(true); setSendErr(null);
    try {
      const r = await submitEntry(league, { ...desired, submittedAt: nowMs() });
      if (!r.ok) { setSendErr(r.reason); return; }
      if (desired.season === shown) setEntries(await fetchEntries(league, seats, shown));
      else setEntries((es) => [...es, { ...desired, day: r.day, submittedAt: nowMs() }]);
    } catch (e) {
      setSendErr((e as Error).message);
    } finally { setSending(false); }
  }, [league, desired, mySeat, seats, shown]);

  useEffect(() => {
    if (!desired || upToDate || sending || fetchedAt === 0) return;
    const k = `${desired.teamHash}:${desired.mapPrefs.join(',')}`;
    if (lastTry.current?.key === k && Date.now() - lastTry.current.at < 60_000) return;
    const h = window.setTimeout(() => void send(), 5000);
    return () => window.clearTimeout(h);
  }, [desired, upToDate, sending, fetchedAt, send]);

  // ------------------------------------------------------------ rendering
  const game: Game | null = useMemo(() => club ? {
    world, career: club, update: updateClub, toast,
    openPlayer: (cardId, playerId) => setPlayer(cardId || playerId ? { cardId, playerId } : null),
    openClub: () => setTab('squad'),
  } : null, [world, club, updateClub, toast]);

  if (league === undefined) return <main className="tn-main"><p className="muted small">{err ?? 'Loading the league…'}</p>{err && <button className="btn" onClick={onLeave}>Back</button>}</main>;
  if (league === null) return <main className="tn-main"><section className="panel"><h2>League not found</h2><p className="muted">No league has the code {id}.</p><button className="btn" onClick={onLeave}>Back</button></section></main>;

  const at = seasonAt(league, now);
  const disputed = new Set(flags.filter((f) => !f.agrees).map((f) => f.matchId));
  for (const [mid, l] of Object.entries(local)) if (stored[mid] && l.result && stored[mid]!.hash !== l.result.hash) disputed.add(mid);
  const lineupError = club ? lineupValidation(club).errors[0] ?? null : null;
  const koText = nk ? `${fmtDay(kickoffAt(league, nk.season, nk.day))}, ${fmtTime(kickoffAt(league, nk.season, nk.day))}` : '';
  const entryNote = !desired ? `Your lineup isn’t complete, so the last one you sent plays at ${koText}.` : sendErr ? `Not sent: ${sendErr}` : sending ? 'Sending…' : upToDate ? `Your lineup and map preferences are in for ${koText}.` : `Changes are sent automatically in a few seconds, in time for ${koText}.`;
  const daily = club ? { done: !canTrainToday(club, today), run: () => { try { updateClub(trainToday(world, club, dateIn(league.tz, nowMs())), 'Training done. Your squad can train again tomorrow.'); } catch (e) { toast((e as Error).message); } } } : undefined;

  const overview = sDoc ? (
    <Overview l={league} seats={seats} s={sDoc} provisional={provisional} me={me} mySlot={mySlot} mySeat={mySeat} now={now} matches={matches} results={results} disputed={disputed} entries={entries}
      active={active} shown={shown} setShown={(n) => setViewSeason(n)} club={club ?? null}
      entryLine={lineupError ? `Lineup problem: ${lineupError} Until it’s fixed, your last sent lineup plays.` : entryNote} entryOk={upToDate && !lineupError}
      canSend={!upToDate && !!desired} sending={sending} send={() => void send()}
      onWatch={setWatching} onEdited={refresh} goTab={setTab} />
  ) : <p className="muted small">Loading the season…</p>;

  let body;
  if (mySeat && club === null) body = <MissingClub l={league} seat={mySeat} me={me} onReady={(c) => setClub(c)} />;
  else if (!game) body = overview;
  else body = (
    <GameCtx.Provider value={game}>
      {tab === 'overview' && overview}
      {tab === 'maps' && <MapPrefs club={club!} prefs={club!.league.mapPrefs ?? []} onChange={(prefs) => updateClub({ ...club!, league: { ...club!.league, mapPrefs: prefs } } as LeagueClub)} entryNote={entryNote} goSquad={() => setTab('squad')} />}
      {tab === 'squad' && <Squad />}
      {tab === 'train' && <Train goHome={() => setTab('overview')} daily={daily} />}
      {tab === 'cases' && <Cases goSquad={() => setTab('squad')} />}
      {player && <PlayerSheet cardId={player.cardId} playerId={player.playerId} onClose={() => setPlayer(null)} />}
      {watching && sDoc && <Watch l={league} s={sDoc} m={watching} entries={entries} mySlot={mySlot} result={results[watching.id] ?? null} onClose={() => setWatching(null)} />}
    </GameCtx.Provider>
  );

  return (
    <>
      <div className="tn-bar">
        <button className="btn small ghost" onClick={onLeave} aria-label="All leagues">‹</button>
        <div className="tn-bar-title"><b>{league.name}</b><span className="small muted">Season {at.season} · {PHASE_LABEL[at.phase]}{at.phase === 'league' ? ` · night ${Math.min(dayFor(league, at.season, now) ?? FINAL_DAY, SWISS_ROUNDS + 1) - 1} of ${SWISS_ROUNDS} played` : ''}</span></div>
        {club && <span className="small muted tn-coins">{club.coins.toLocaleString('en-US')} coins</span>}
      </div>
      {game && (
        <nav className="tn-tabs" aria-label="League">
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

function MissingClub({ l, seat, me, onReady }: { l: League; seat: LeagueSeat; me: Me; onReady: (c: LeagueClub) => void }) {
  const [v, setV] = useState<ClubChoice>({ manager: seat.manager, team: seat.team, tag: seat.tag, coachId: starterCoaches(tournamentWorld())[0]!.id });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>Set up your club on this device</h2>
      <p className="muted small">Your seat is saved, but your club isn’t on this device or online yet. Every club starts the same way.</p>
      <ClubFields value={v} onChange={setV} />
      <button className={`btn primary${busy ? ' loading' : ''}`} disabled={busy} onClick={() => {
        const bad = clubOk(v);
        if (bad) { setErr(bad); return; }
        setBusy(true); setErr(null);
        startLeagueClub(l, seat.slot, me, v, seat.joinedAt).then(onReady, (e) => setErr((e as Error).message)).finally(() => setBusy(false));
      }}>Set up club</button>
      {err && <p className="small bad">{err}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ overview

function Countdown({ to }: { to: number }) {
  const [n, setN] = useState(nowMs());
  useEffect(() => { const h = window.setInterval(() => setN(nowMs()), 1000); return () => window.clearInterval(h); }, []);
  const s = Math.max(0, Math.round((to - n) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <span className="num">{d > 0 ? `${d}d ` : ''}{d > 0 || h > 0 ? `${h}h ` : ''}{m}m {String(sec).padStart(2, '0')}s</span>;
}

export function Overview(p: {
  l: League; seats: LeagueSeat[]; s: LeagueSeason; provisional: boolean; me: Me; mySlot: number; mySeat: LeagueSeat | null; now: number; matches: LMatch[]; results: Record<string, LResult>; disputed: Set<string>; entries: LEntry[];
  active: number; shown: number; setShown: (n: number) => void; club: LeagueClub | null;
  entryLine: string; entryOk: boolean; canSend: boolean; sending: boolean; send: () => void;
  onWatch: (m: LMatch) => void; onEdited: () => void; goTab: (t: Tab) => void;
}) {
  const { l, s, now, matches, results, mySlot } = p;
  const at = seasonAt(l, now);
  const table = standings(matches, results, s.size);
  const nm = (slot: number) => slotName(s, slot);
  const lastDay = matches.reduce((d, m) => Math.max(d, m.day), 1);
  const currentDay = Math.min(Math.max(1, (dayFor(l, s.season, now) ?? FINAL_DAY + 1) - 1), lastDay);
  const [day, setDay] = useState(currentDay);
  useEffect(() => setDay(currentDay), [s.season]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextMine = mySlot >= 0 ? matches.find((m) => m.kickoff > now && (m.home === mySlot || m.away === mySlot)) : undefined;
  const link = `${location.origin}${location.pathname}#league/${l.id}`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(`${what} copied.`); } catch { setCopied('Copying is blocked here. Select it and copy it yourself.'); }
  };
  const placings = finalPlacings(l, s, results);
  const awards = seasonAwards(matches, results);
  const leaders = playerSeasons(matches, results).filter((x) => x.maps >= Math.min(MVP_MIN_MAPS, Math.max(1, lastDay - 1))).sort((a, b) => avgRating(b) - avgRating(a)).slice(0, 10);
  const playoffs = matches.filter((m) => m.stage !== 'league');
  const seasonsToShow = Array.from({ length: Math.max(p.active, 1) + (at.phase === 'preseason' && p.active < at.season ? 1 : 0) }, (_, i) => i + 1);
  const myRow = mySlot >= 0 ? table.findIndex((r) => r.slot === mySlot) + 1 : 0;

  return (
    <>
      <section className="panel lg-hero">
        <div className="panel-head">
          <span className="label">Season {s.season}{p.provisional ? ' · line-up not final until the first kickoff' : ''}</span>
          {seasonsToShow.length > 1 && (
            <div className="seg tn-days" role="group" aria-label="Season">
              {seasonsToShow.map((n) => <button key={n} aria-pressed={p.shown === n} onClick={() => p.setShown(n)}>S{n}</button>)}
            </div>
          )}
        </div>
        {at.season === s.season && at.phase === 'preseason' ? (
          <p>First kickoff <b>{fmtDay(firstKickoff(l, s.season))}, {fmtTime(firstKickoff(l, s.season))}</b> · in <Countdown to={firstKickoff(l, s.season)} /></p>
        ) : placings ? (
          <p className="lg-champ">Champion: <span className="tag">{nm(placings[0]!).tag}</span> <b>{nm(placings[0]!).name}</b>{nm(placings[0]!).manager ? <span className="small muted"> ({nm(placings[0]!).manager})</span> : null}</p>
        ) : (
          <p>{at.phase === 'playoffs' ? 'Playoffs' : `League stage, night ${currentDay} of ${SWISS_ROUNDS}`}{myRow ? <> · you are <b>{ordinalPlace(myRow)}</b> of {s.size}</> : null}</p>
        )}
        <p className="small muted">{Object.keys(s.managers).length} managers and {s.size - Object.keys(s.managers).length} real organisations · {p.seats.length}/{l.maxTeams} seats taken · 14 Swiss nights, then top {PLAYOFF_TEAMS} in Bo3 playoffs (days {QF_DAY}–{FINAL_DAY})</p>
        <div className="tn-share">
          <span className="small muted">Invite managers with the code or the link. A seat taken now plays from the next season that hasn’t started.</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn small mono" onClick={() => void copy(l.id, 'Code')} title="Copy the code">{l.id}</button>
            <input className="tn-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <button className="btn small" onClick={() => void copy(link, 'Link')}>Copy link</button>
          </div>
          {copied && <span className="small muted" role="status">{copied}</span>}
        </div>
      </section>

      {p.mySeat && (
        <section className="panel span-6">
          <div className="panel-head"><span className="label">Your next match</span></div>
          {nextMine ? (
            <>
              <p className="tn-next"><span className="tag">{nm(mySlot).tag}</span> vs <span className="tag">{nm(nextMine.home === mySlot ? nextMine.away : nextMine.home).tag}</span> <b>{nm(nextMine.home === mySlot ? nextMine.away : nextMine.home).name}</b></p>
              <p className="small muted">{STAGE_LABEL[nextMine.stage]} · {fmtDay(nextMine.kickoff)}, {fmtTime(nextMine.kickoff)} · {nextMine.format.toUpperCase()} · in <Countdown to={nextMine.kickoff} /></p>
            </>
          ) : mySlot < 0 ? <p className="small muted">Your seat plays from season {s.season + 1}. Set up your lineup now: it carries over.</p>
            : <p className="small muted">{at.phase === 'league' ? 'Tonight’s pairings are drawn once last night’s results are in.' : 'No match scheduled yet.'}</p>}
          <p className={`small ${p.entryOk ? 'good' : 'muted'}`}>{p.entryLine}</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn small" onClick={() => p.goTab('maps')}>Lineup and maps</button>
            {p.canSend && <button className={`btn small primary${p.sending ? ' loading' : ''}`} disabled={p.sending} onClick={p.send}>Send now</button>}
          </div>
          <p className="small faint">Players grow from their match rating: a rating of 1.15 or more gives the biggest gain. Field them in their own role, rested.</p>
        </section>
      )}

      <section className={`panel ${p.mySeat ? 'span-6' : ''}`}>
        <div className="panel-head"><span className="label">Prizes</span></div>
        <ol className="lg-prizes">
          {PRIZE_SHARES.map((_, i) => (
            <li key={i}><span className="num">{ordinalPlace(i + 1)}</span> <b>{l.prizes[i] || '—'}</b> <span className="small muted">+{prizeFor(i + 1).toLocaleString('en-US')} coins</span>
              {placings && <span className="small"> · {nm(placings[i]!).tag}</span>}</li>
          ))}
          {l.prizes.slice(PRIZE_SHARES.length).map((pr, i) => <li key={`x${i}`}><span className="num">{ordinalPlace(PRIZE_SHARES.length + i + 1)}</span> <b>{pr || '—'}</b></li>)}
        </ol>
        <p className="small faint">Skins are handed out by the league owner. Coins go straight to your club.</p>
      </section>

      <section className="panel">
        <div className="panel-head"><span className="label">Table</span><span className="small faint">Win 3 pts · ties: opponents’ points, rounds · top {PLAYOFF_TEAMS} to the playoffs</span></div>
        <div className="scroll-x">
          <table className="tbl tn-table">
            <thead><tr><th>#</th><th>Team</th><th className="num">P</th><th className="num">W</th><th className="num">L</th><th className="num" title="Opponents’ points">Opp</th><th className="num">Rounds</th><th className="num">Pts</th></tr></thead>
            <tbody>
              {table.map((r, i) => (
                <tr key={r.slot} className={`${r.slot === mySlot ? 'me' : ''}${i === PLAYOFF_TEAMS - 1 ? ' lg-cut' : ''}`}>
                  <td className="num">{i + 1}</td>
                  <td><span className="tag">{nm(r.slot).tag}</span> {nm(r.slot).name}{nm(r.slot).manager ? <span className="small muted"> · {nm(r.slot).manager}</span> : null}</td>
                  <td className="num">{r.played}</td><td className="num">{r.wins}</td><td className="num">{r.losses}</td>
                  <td className="num">{r.buchholz}</td>
                  <td className="num">{r.roundsWon - r.roundsLost > 0 ? '+' : ''}{r.roundsWon - r.roundsLost}</td>
                  <td className="num"><b>{r.points}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {playoffs.length > 0 && (
        <section className="panel">
          <div className="panel-head"><span className="label">Playoffs</span></div>
          <div className="lg-bracket">
            {(['quarter', 'semi', 'final'] as const).map((stage) => (
              <div key={stage}>
                <span className="label">{STAGE_LABEL[stage]}</span>
                <ul className="lg-round">{playoffs.filter((m) => m.stage === stage).map((m) => <MatchLine key={m.id} {...p} m={m} nm={nm} />)}</ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <span className="label">Fixtures</span>
          <div className="seg tn-days" role="group" aria-label="Night">
            {Array.from({ length: lastDay }, (_, i) => <button key={i} aria-pressed={day === i + 1} onClick={() => setDay(i + 1)}>{i + 1}</button>)}
          </div>
        </div>
        <p className="small muted">{day <= SWISS_ROUNDS ? `Night ${day}` : STAGE_LABEL[day === QF_DAY ? 'quarter' : day === FINAL_DAY ? 'final' : 'semi']} · {fmtDay(kickoffAt(l, s.season, day))}, {fmtTime(kickoffAt(l, s.season, day))}{day < SWISS_ROUNDS && lastDay === day && at.season === s.season ? ' · the next night is drawn when these results are in' : ''}</p>
        <ul className="tn-sched">
          {matches.filter((m) => m.day === day).map((m) => <MatchLine key={m.id} {...p} m={m} nm={nm} />)}
        </ul>
      </section>

      <section className="panel span-6">
        <div className="panel-head"><span className="label">Season awards</span></div>
        {placings ? (
          <p>MVP: <b>{awards.mvp?.handle ?? '—'}</b>{awards.mvp ? <span className="small muted"> ({nm(awards.mvp.slot).tag}, rating {avgRating(awards.mvp).toFixed(2)} over {awards.mvp.maps} maps)</span> : null}<br />
            Top fragger: <b>{awards.topFragger?.handle ?? '—'}</b>{awards.topFragger ? <span className="small muted"> ({nm(awards.topFragger.slot).tag}, {awards.topFragger.kills} kills)</span> : null}</p>
        ) : <p className="small muted">The MVP (best rating over at least {MVP_MIN_MAPS} maps) and the top fragger are crowned after the final.</p>}
        <table className="tbl">
          <thead><tr><th>Player</th><th>Team</th><th className="num">Maps</th><th className="num">K–D</th><th className="num">Rating</th></tr></thead>
          <tbody>
            {leaders.map((x) => (
              <tr key={`${x.slot}:${x.id}`} className={x.slot === mySlot ? 'me' : ''}><td>{x.handle}</td><td><span className="tag">{nm(x.slot).tag}</span></td><td className="num">{x.maps}</td><td className="num">{x.kills}–{x.deaths}</td><td className="num"><b>{avgRating(x).toFixed(2)}</b></td></tr>
            ))}
            {!leaders.length && <tr><td colSpan={5} className="small muted">No maps played yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <HallOfChampions l={l} active={p.active} club={p.club} />

      {l.ownerId === p.me.id && <OwnerSettings l={l} onSaved={p.onEdited} />}
    </>
  );
}

function MatchLine(p: { m: LMatch; nm: (slot: number) => { name: string; tag: string }; results: Record<string, LResult>; disputed: Set<string>; mySlot: number; now: number; s: LeagueSeason; entries: LEntry[]; mySeat: LeagueSeat | null; onWatch: (m: LMatch) => void }) {
  const { m, nm } = p;
  const r = p.results[m.id];
  const mine = m.home === p.mySlot || m.away === p.mySlot;
  const due = p.now >= m.kickoff + SETTLE_DELAY_MS;
  const canWatch = !!r && !isForfeit(r) && !!p.mySeat && !!sideFor(p.s, p.entries, m.home, m) && !!sideFor(p.s, p.entries, m.away, m);
  return (
    <li className={mine ? 'mine' : ''}>
      <span className={`tn-side${r && r.summary.winner === 0 ? ' won' : ''}`}><span className="tag">{nm(m.home).tag}</span></span>
      <span className="num tn-score">{r ? `${r.summary.mapScore[0]}–${r.summary.mapScore[1]}` : due ? '…' : 'vs'}</span>
      <span className={`tn-side${r && r.summary.winner === 1 ? ' won' : ''}`}><span className="tag">{nm(m.away).tag}</span></span>
      <span className="tn-act">
        {r && isForfeit(r) && <span className="chip">Forfeit</span>}
        {p.disputed.has(m.id) && <span className="chip bad" title="Two browsers computed different results for this match">Disputed</span>}
        {r && r.maps.length > 0 && <span className="small faint">{r.summary.maps.map((x) => `${x.map} ${x.score[0]}-${x.score[1]}`).join(' · ')}</span>}
        {canWatch && <button className="btn small ghost" onClick={() => p.onWatch(m)}>Watch</button>}
      </span>
    </li>
  );
}

/** Champions of every finished season, read once and kept on this device. */
function HallOfChampions({ l, active, club }: { l: League; active: number; club: LeagueClub | null }) {
  type Row = { season: number; champion: string; runnerUp: string; score: string; mvp: string; prize?: string };
  const key = `clutch-manager.l.${l.id}.hall`;
  const [rows, setRows] = useState<Row[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '[]') as Row[]; } catch { return []; } });
  useEffect(() => {
    let off = false;
    void (async () => {
      const have = new Set(rows.map((r) => r.season));
      const add: Row[] = [];
      for (let n = 1; n <= active; n++) {
        if (have.has(n)) continue;
        try {
          const s = await fetchSeason(l.id, n);
          if (!s) continue;
          const { results } = await fetchResults(l.id, n);
          const placings = finalPlacings(l, s, results);
          if (!placings) continue;
          const all = seasonMatches(l, s, results);
          const final = all.find((m) => m.stage === 'final')!;
          const fr = results[final.id]!;
          const champ = slotName(s, placings[0]!), ru = slotName(s, placings[1]!);
          const champIdx = placings[0] === final.home ? 0 : 1;
          const mvp = seasonAwards(all, results).mvp;
          add.push({ season: n, champion: `${champ.name}${champ.manager ? ` (${champ.manager})` : ''}`, runnerUp: ru.name, score: `${fr.summary.mapScore[champIdx]}–${fr.summary.mapScore[1 - champIdx]}`, mvp: mvp ? `${mvp.handle} (${avgRating(mvp).toFixed(2)})` : '—', ...(l.prizes[0] ? { prize: l.prizes[0] } : {}) });
        } catch { /* try again next time */ }
      }
      if (off || !add.length) return;
      const next = [...rows, ...add].sort((a, b) => b.season - a.season);
      setRows(next);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* fine */ }
    })();
    return () => { off = true; };
  }, [l, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const cabinet = club?.league.trophies ?? [];
  return (
    <section className="panel span-6">
      <div className="panel-head"><span className="label">Hall of champions</span></div>
      {rows.length ? (
        <table className="tbl">
          <thead><tr><th>Season</th><th>Champion</th><th className="num">Final</th><th>Runner-up</th><th>MVP</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.season}><td className="num">S{r.season}</td><td><b>{r.champion}</b>{r.prize ? <div className="small faint">{r.prize}</div> : null}</td><td className="num">{r.score}</td><td>{r.runnerUp}</td><td>{r.mvp}</td></tr>)}</tbody>
        </table>
      ) : <p className="small muted">The first champion is crowned after season 1’s grand final.</p>}
      {cabinet.length > 0 && (
        <>
          <span className="label">Your trophy cabinet</span>
          <ul className="lg-cabinet">{[...cabinet].reverse().map((t) => <li key={t.season}>S{t.season}: <b>{ordinalPlace(t.place)}</b> of {t.teams}{t.prize ? ` · ${t.prize}` : ''}{t.coins ? ` · ${t.coins.toLocaleString('en-US')} coins` : ''}</li>)}</ul>
        </>
      )}
    </section>
  );
}

function OwnerSettings({ l, onSaved }: { l: League; onSaved: () => void }) {
  const [name, setName] = useState(l.name);
  const [cap, setCap] = useState(l.maxTeams);
  const [prizes, setPrizes] = useState(l.prizes.join('\n'));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="panel-head"><span className="label">League settings (owner)</span></div>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        setBusy(true); setMsg(null);
        const next: League = { ...l, name: name.trim().slice(0, 40) || l.name, maxTeams: Math.max(2, Math.min(MAX_TEAMS_LIMIT, Math.round(cap))), prizes: cleanPrizes(prizes.split('\n')) };
        updateLeague(next).then((r) => { setMsg(r.ok ? 'Saved.' : r.reason); if (r.ok) onSaved(); }, (er) => setMsg((er as Error).message)).finally(() => setBusy(false));
      }}>
        <div className="tn-fields">
          <label className="field"><span className="label">Name</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field tn-tag"><span className="label">Seats</span><input type="number" min={2} max={MAX_TEAMS_LIMIT} value={cap} onChange={(e) => setCap(Number(e.target.value) || l.maxTeams)} /></label>
        </div>
        <label className="field"><span className="label">Prizes (one line per place, champion first)</span><textarea rows={4} value={prizes} onChange={(e) => setPrizes(e.target.value)} /></label>
        <p className="small faint">More managers want in? Raise the seat count: the Swiss format works the same with 64 or 100 teams.</p>
        <button type="submit" className={`btn small${busy ? ' loading' : ''}`} disabled={busy}>Save settings</button>
        {msg && <span className="small muted">{msg}</span>}
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ watching a match

function Watch({ l, s, m, entries, mySlot, result, onClose }: { l: League; s: LeagueSeason; m: LMatch; entries: LEntry[]; mySlot: number; result: LResult | null; onClose: () => void }) {
  const home = sideFor(s, entries, m.home, m) as Side | null, away = sideFor(s, entries, m.away, m) as Side | null;
  const [series, setSeries] = useState<SeriesResult | null>(null);
  if (!home || !away || !result) return null;
  const named = (slot: number, t: Side['team']) => ({ ...t, name: slotName(s, slot).name, tag: slotName(s, slot).tag });
  const teams = [named(m.home, home.team), named(m.away, away.team)] as [Side['team'], Side['team']];
  const side = mySlot === m.away ? 1 : 0;
  if (!series) {
    return (
      <div className="fullscreen" role="dialog" aria-label="League match">
        <div className="inner mx-inner mx-live wide">
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn small ghost" onClick={onClose}>Close</button></div>
          <Live teams={teams} humanIdx={side} maps={result.maps} format={m.format === 'bo3' ? 'bo3' : 'bo1'} seed={matchSeed(l, m, home.team, away.team)} instant={false} stageLabel={`${l.name} · S${m.season} · ${m.stage === 'league' ? `night ${m.day}` : STAGE_LABEL[m.stage]}`} locked onFinished={setSeries} />
        </div>
      </div>
    );
  }
  return (
    <div className="fullscreen" role="dialog" aria-label="League result">
      <div className="inner mx-inner mx-report">
        <Report series={series} teams={teams} humanIdx={side} onContinue={onClose} pvp={{
          note: series.winner === result.summary.winner ? 'This replay matches the stored result.' : 'This replay differs from the stored result, so the match is marked as disputed.',
          actions: <button className="btn primary" onClick={onClose}>Back to the league</button>,
        }} />
      </div>
    </div>
  );
}
