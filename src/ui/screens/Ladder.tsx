/**
 * Beta ladder: one ranking for every beta player, inside the PvP tab.
 * The rules (teams, seed, Bo1) are in engine/ladder.ts; ratings and match records are kept by
 * the database (supabase/beta.sql), which counts a challenge as a loss until a win is reported.
 */
import { useCallback, useEffect, useState } from 'react';
import { lineupValidation } from '../../engine/career';
import { botTeam, eloSwing, ladderTeam, playLadder } from '../../engine/ladder';
import type { LadderResult } from '../../engine/ladder';
import { currentUser, onlineAvailable } from '../../online/supa';
import { joinLadder, ladderPlayers, myLadderId, recentMatches, reportChallenge, startChallenge } from '../../online/ladder';
import type { LadderMatch, LadderPlayer } from '../../online/ladder';
import { useGame } from '../common';
import { Pvp } from './Pvp';
import { Live, Report } from './Match';
import '../styles/ladder.css';

/** The PvP tab: the beta ladder and the 1-on-1 rooms. */
export function PvpHub() {
  const [view, setView] = useState<'ladder' | 'rooms'>('ladder');
  if (!onlineAvailable()) return <Pvp />;
  return (
    <>
      <div className="seg ladder-switch" role="group" aria-label="PvP mode">
        <button type="button" aria-pressed={view === 'ladder'} onClick={() => setView('ladder')}>Beta ladder</button>
        <button type="button" aria-pressed={view === 'rooms'} onClick={() => setView('rooms')}>1-on-1 rooms</button>
      </div>
      {view === 'ladder' ? <Ladder onRooms={() => setView('rooms')} /> : <Pvp />}
    </>
  );
}

interface Played { result: LadderResult; delta: number | null; late: boolean; opponent: LadderPlayer; view: 'live' | 'report' }

function Ladder({ onRooms }: { onRooms: () => void }) {
  const { world, career: c } = useGame();
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [rows, setRows] = useState<LadderPlayer[] | null>(null);
  const [matches, setMatches] = useState<LadderMatch[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [played, setPlayed] = useState<Played | null>(null);
  const check = lineupValidation(c);

  const load = useCallback(async () => {
    try {
      const u = await currentUser();
      setMe(u ? myLadderId(u.id) : null);
      if (!u) return;
      // Keep the published team current, so whoever challenges you meets the team you have now.
      if (check.ok) await joinLadder(c.managerName || 'Manager', c.teamName, c.teamTag, ladderTeam(world, c));
      const [r, m] = await Promise.all([ladderPlayers(), recentMatches(myLadderId(u.id))]);
      setRows(r); setMatches(m); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [c, world, check.ok]);
  useEffect(() => { void load(); }, [load]);

  const challenge = async (opp: LadderPlayer) => {
    if (!check.ok) { setErr(check.errors[0] ?? 'Your lineup is not complete.'); return; }
    setBusy(opp.id); setErr(null);
    try {
      const mine = ladderTeam(world, c);
      await joinLadder(c.managerName || 'Manager', c.teamName, c.teamTag, mine);
      const ch = await startChallenge(opp.id);
      const def = ch.defenderTeam ?? botTeam(world, c, ch.botSlot ?? 0, opp.team, opp.tag);
      const result = playLadder(ch.seed, mine, def);
      let delta: number | null = null;
      try { delta = await reportChallenge(ch.id, result.won, result.summary, result.hash, ch.defenderTeam ? null : def); } catch { /* shown as unconfirmed */ }
      setPlayed({ result, delta, late: result.won && delta !== null && delta < 0, opponent: opp, view: 'live' });
      void load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  if (played) {
    const { result, delta, opponent } = played;
    if (played.view === 'live') {
      return (
        <div className="fullscreen" role="dialog" aria-label="Ladder match">
          <div className="inner mx-inner mx-live wide">
            <Live teams={result.teams} humanIdx={0} maps={[result.map]} format="bo1" seed={result.seed} instant={false} stageLabel={`Beta ladder · ${c.teamTag} vs ${opponent.tag}`} locked onFinished={() => setPlayed({ ...played, view: 'report' })} />
          </div>
        </div>
      );
    }
    return (
      <div className="fullscreen" role="dialog" aria-label="Ladder result">
        <div className="inner mx-inner mx-report">
          <Report series={result.series} teams={result.teams} humanIdx={0} onContinue={() => setPlayed(null)} pvp={{
            note: delta === null ? 'The result couldn’t be sent, so the ladder counts this challenge as a loss.'
              : played.late ? 'This result arrived too late, so it counts as a loss.'
              : `Ladder rating ${delta >= 0 ? '+' : ''}${delta}. Ladder results don’t change your career.`,
            actions: <button className="btn primary" onClick={() => setPlayed(null)}>Back to the ladder</button>,
          }} />
        </div>
      </div>
    );
  }

  const mine = rows?.find((r) => r.id === me);
  const rank = mine ? rows!.indexOf(mine) + 1 : null;
  const nameOf = (id: string) => rows?.find((r) => r.id === id)?.team ?? 'Unknown team';
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Closed beta</span>
          <h1>Beta ladder</h1>
          <p className="sub">Challenge any team on the ladder: a Bo1 between your career team and theirs. Win to climb. Up to 10 challenges a day, and each team at most twice. Results never change your career.</p>
        </div>
        {mine && <div className="ladder-me"><span className="label">You <span className="beta-badge">Beta tester</span></span><b className="num">#{rank}</b><span className="num">{mine.rating}</span><span className="faint small num">{mine.wins}–{mine.losses}</span></div>}
      </header>
      {me === null && <section className="panel"><p className="muted">Sign in to play the ladder.</p><button className="btn small" onClick={onRooms}>Sign in from 1-on-1 rooms</button></section>}
      {!check.ok && <p className="small bad">{check.errors[0]} Fix your lineup to join the ladder.</p>}
      {err && <p className="small bad" role="alert">{err}</p>}
      {me && rows === null && !err && <section className="panel"><p className="muted">Loading the ladder…</p></section>}
      {rows && (
        <section className="panel flush">
          <div className="scroll-x">
            <table className="tbl ladder-tbl">
              <thead><tr><th>#</th><th>Team</th><th>Rating</th><th>W–L</th><th aria-label="Challenge" /></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const swing = mine ? eloSwing(mine.rating, r.rating) : null;
                  const isMe = r.id === me;
                  return (
                    <tr key={r.id} className={isMe ? 'me' : ''}>
                      <td>{i + 1}</td>
                      <td className="name"><b>{r.team}</b> <span className="faint">{r.tag}</span>{r.botSlot !== null && <span className="chip">Bot</span>}<div className="faint small">{r.botSlot !== null ? 'Practice team' : r.manager}</div></td>
                      <td>{r.rating}</td>
                      <td>{r.wins}–{r.losses}</td>
                      <td>{!isMe && (
                        <button className="btn small" disabled={!!busy || !mine || !check.ok || (r.botSlot === null && !r.hasTeam)} onClick={() => void challenge(r)} title={swing ? `Win +${swing.win}, lose ${swing.loss}` : undefined}>
                          {busy === r.id ? 'Playing…' : 'Challenge'}
                        </button>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length <= 1 && <p className="muted small ladder-empty">No other teams yet. When other beta players open the ladder, they appear here.</p>}
        </section>
      )}
      {matches.length > 0 && (
        <section className="panel">
          <h2>Your recent ladder matches</h2>
          <ul className="ladder-log">
            {matches.map((m) => {
              const mineC = m.challenger === me;
              const won = mineC ? m.status === 'won' : m.status !== 'won';
              const pts = mineC ? m.delta : -m.delta;
              const score = m.summary ? (mineC ? m.summary.mapScore : [...m.summary.mapScore].reverse()) : null;
              const map = m.summary?.maps[0]?.map;
              const round = m.summary?.maps[0]?.score;
              return (
                <li key={m.id}>
                  <span className={`chip ${won ? 'good' : 'bad'}`}>{won ? 'Won' : 'Lost'}</span>
                  <span>{mineC ? 'vs' : 'defended vs'} <b>{nameOf(mineC ? m.defender : m.challenger)}</b>{map && round && score ? <span className="faint"> · {map} {mineC ? round.join('–') : [...round].reverse().join('–')}</span> : null}</span>
                  <span className={`num ${pts >= 0 ? 'good' : 'bad'}`}>{pts >= 0 ? '+' : ''}{pts}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {!busy && rows && mine && <p className="small faint">Your ladder team updates to your current lineup each time you open this page or challenge someone.</p>}
    </>
  );
}
