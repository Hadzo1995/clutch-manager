import { useEffect, useRef, useState } from 'react';
import { aiTeamById, humanFixture, lineupValidation } from '../engine/career';
import { CUP_START, HUMAN_ID } from '../engine/season';
import { buildAlerts } from './alerts';
import type { AlertTarget } from './alerts';
import { Coin, today, useGame } from './common';
import { Crest } from './crest';
import './styles/hud.css';

type Go = (t: 'squad' | 'train' | 'scout' | 'cases' | 'league') => void;

/** Weeks of a season and what they are: seven league weeks, playoffs, then the cup. */
const SEASON: { w: number; kind: 'league' | 'playoff' | 'cup'; label: string }[] = [
  ...Array.from({ length: 7 }, (_, i) => ({ w: i + 1, kind: 'league' as const, label: `League week ${i + 1}` })),
  { w: 8, kind: 'playoff', label: 'Semifinals' }, { w: 9, kind: 'playoff', label: 'Final' },
  { w: CUP_START, kind: 'cup', label: 'Cup quarterfinals' }, { w: CUP_START + 1, kind: 'cup', label: 'Cup semifinals' }, { w: CUP_START + 2, kind: 'cup', label: 'Cup final' },
];

/**
 * The desktop HUD across the top of every screen: where the season is, the next opponent,
 * what needs attention, and the one action that moves the week on.
 */
export function CommandBar({ weekText, goTo, onPlay }: { weekText: string; goTo: Go; onPlay: () => void }) {
  const { world, career: c, openClub, openPlayer } = useGame();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [open]);

  const alerts = buildAlerts(world, c, today());
  const urgent = alerts.filter((a) => a.tone === 'urgent').length;
  const go = (t: AlertTarget) => { setOpen(false); if (typeof t === 'object') openPlayer(t.cardId); else if (t === 'club') openClub(); else goTo(t); };
  const f = humanFixture(c);
  const opp = f ? aiTeamById(c, f.home === HUMAN_ID ? f.away : f.home) : undefined;
  const ok = lineupValidation(c).ok;
  const week = c.season.week;

  return (
    <div className="cmd" role="region" aria-label="Season status">
      <div className="cmd-season">
        <div className="cmd-row"><span className="label">Season {c.season.number}</span><b>{weekText}</b></div>
        <ol className="cmd-track" aria-label={`Week ${week} of ${SEASON.length}`}>
          {SEASON.map((s) => <li key={s.w} className={`${s.kind}${s.w < week ? ' done' : s.w === week ? ' now' : ''}`} title={s.label} />)}
        </ol>
      </div>
      <button type="button" className="cmd-next" onClick={() => goTo('league')} aria-label={opp ? `Next match against ${opp.name}. Open the league` : 'Open the league'}>
        {f && opp ? <>
          <span className="label">Next</span>
          <Crest name={opp.name} tag={opp.tag} size={26} />
          <span className="cmd-opp"><b>{opp.tag}</b><span className="faint small">{opp.name}</span></span>
          <span className="chip">{f.format.toUpperCase()}</span>
        </> : <><span className="label">Next</span><span className="small muted">No match this week</span></>}
      </button>
      <div className="cmd-right">
        <span className={`cmd-phase ${c.phase === 'training' ? 'train' : 'match'}`}>{c.phase === 'training' ? 'Training day' : 'Matchday'}</span>
        <div className="cmd-alerts" ref={ref}>
          <button type="button" className={`cmd-bell${urgent ? ' urgent' : ''}`} aria-expanded={open} aria-haspopup="true" aria-label={`${alerts.length} things need you`} onClick={() => setOpen(!open)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20.5a2 2 0 004 0" /></svg>
            {alerts.length > 0 && <b className="num">{alerts.length}</b>}
          </button>
          {open && (
            <div className="cmd-pop" role="menu">
              <div className="cmd-pop-h"><span className="label">Needs you</span><span className="small faint">{alerts.length ? `${alerts.length} item${alerts.length === 1 ? '' : 's'}` : 'All clear'}</span></div>
              {alerts.length ? alerts.map((a) => (
                <button key={a.key} role="menuitem" className={`cmd-item ${a.tone}`} onClick={() => go(a.target)}>
                  <i aria-hidden="true" /><span>{a.text}</span><em>{a.cta} ›</em>
                </button>
              )) : <p className="small muted cmd-clear">Nothing needs you right now. Train, then play.</p>}
            </div>
          )}
        </div>
        <button type="button" className="cmd-coins" onClick={openClub} aria-label={`Club finances, balance ${c.coins}`}><Coin amount={c.coins} /></button>
        {c.phase === 'training'
          ? <button type="button" className="btn primary small cmd-go" onClick={() => goTo('train')}>Plan the week</button>
          : f ? <button type="button" className="btn primary small cmd-go" onClick={onPlay} disabled={!ok}>Go to match</button>
          : null}
      </div>
    </div>
  );
}
