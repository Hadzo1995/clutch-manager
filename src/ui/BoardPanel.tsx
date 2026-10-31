import { BOARD_BONUS, BOARD_GOAL_LABEL, BOARD_GOAL_PLACE, boardMood, ordinal } from '../engine/career';
import type { SeasonSummary } from '../engine/career';
import { DIVISIONS, HUMAN_ID, standings } from '../engine/season';
import { useGame } from './common';
import './styles/board.css';

/** The board's target for this season, where the table has you now, and how confident they are. */
export function BoardPanel({ className = '' }: { className?: string }) {
  const { career: c } = useGame();
  const b = c.board && c.board.season === c.season.number ? c.board : null;
  if (!b) return null;
  const table = standings(c.season);
  const pos = table.findIndex((r) => r.teamId === HUMAN_ID) + 1;
  const row = table[pos - 1];
  const started = !!row && row.wins + row.losses > 0;
  const target = BOARD_GOAL_PLACE[b.goal];
  const onTrack = pos <= target;
  const tone = b.confidence >= 60 ? 'good' : b.confidence >= 35 ? 'warn' : 'bad';
  return (
    <section className={`panel bd ${className}`} aria-label="Board expectations">
      <div className="panel-head"><h2>Board</h2><span className={`chip ${tone}`}>{boardMood(b.confidence)}</span></div>
      <div className="bd-goal">
        <span className="label">Season {c.season.number} target</span>
        <strong>{BOARD_GOAL_LABEL[b.goal]}</strong>
      </div>
      <div className="bd-track" aria-label={`You are ${ordinal(pos)}, the target is ${ordinal(target)} or better`}>
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} className={`${i < target ? 'in' : ''}${started && i + 1 === pos ? ' me' : ''}`}>{started && i + 1 === pos ? <b>{c.teamTag}</b> : null}</i>
        ))}
      </div>
      <div className="bd-row small">
        {started ? <span className={onTrack ? 'good' : 'bad'}>{onTrack ? 'On track' : 'Off target'} · {ordinal(pos)} now</span> : <span className="muted">No league games yet</span>}
        <span className="faint">Bonus <span className="num">{BOARD_BONUS[c.season.division] ?? 500}</span> if met</span>
      </div>
      <div className="bd-conf">
        <span className="label">Confidence</span>
        <div className={`bd-meter ${tone}`} aria-hidden="true"><i style={{ width: `${b.confidence}%` }} /></div>
        <span className="num">{Math.round(b.confidence)}</span>
      </div>
      <p className="small faint">Set from your squad's strength at the start of the season. Wins and your league place move confidence; missing the target costs reputation, never your job.</p>
    </section>
  );
}

type Trophy = { key: string; kind: 'league' | 'cup' | 'promotion' | 'board'; title: string; sub: string };

export function trophiesOf(history: SeasonSummary[]): Trophy[] {
  const out: Trophy[] = [];
  for (const h of [...history].reverse()) {
    const div = DIVISIONS[h.division]!.name;
    if (h.placement === 1) out.push({ key: `l${h.season}`, kind: 'league', title: `${div} champions`, sub: `Season ${h.season}` });
    if (h.cup === 1) out.push({ key: `c${h.season}`, kind: 'cup', title: 'Clutch Cup winners', sub: `Season ${h.season} · ${div}` });
    if (h.movement === 'promoted') out.push({ key: `p${h.season}`, kind: 'promotion', title: 'Promotion', sub: `Season ${h.season} · out of the ${div}` });
    if (h.board?.met) out.push({ key: `b${h.season}`, kind: 'board', title: 'Board target met', sub: `Season ${h.season} · ${BOARD_GOAL_LABEL[h.board.goal]}` });
  }
  return out;
}

function TrophyIcon({ kind }: { kind: Trophy['kind'] }) {
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (kind === 'league') return <svg {...p}><path d="M8 4h8v5a4 4 0 01-8 0zM8 6H4v2a3 3 0 003 3M16 6h4v2a3 3 0 01-3 3M12 13v4M8 21h8M9 17h6" /></svg>;
  if (kind === 'cup') return <svg {...p}><path d="M7 3h10l-1 7a4 4 0 01-8 0zM12 14v4M8 21h8M10 18h4M5 5h2M17 5h2" /></svg>;
  if (kind === 'promotion') return <svg {...p}><path d="M12 20V5M6 11l6-6 6 6M5 21h14" /></svg>;
  return <svg {...p}><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" /></svg>;
}

/** Every title, cup, promotion and met board target, newest first. */
export function TrophyCabinet({ className = '' }: { className?: string }) {
  const { career: c } = useGame();
  const items = trophiesOf(c.history);
  const major = items.filter((t) => t.kind === 'league' || t.kind === 'cup').length;
  return (
    <section className={`panel tc ${className}`} aria-label="Trophy cabinet">
      <div className="panel-head"><h2>Trophy cabinet</h2><span className="small muted"><span className="num">{major}</span> major title{major === 1 ? '' : 's'}</span></div>
      {items.length ? (
        <ul className="tc-shelf">
          {items.map((t) => (
            <li key={t.key} className={`tc-item ${t.kind}`}>
              <span className="tc-icon"><TrophyIcon kind={t.kind} /></span>
              <span className="tc-t">{t.title}</span>
              <span className="tc-s small faint">{t.sub}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="tc-empty">
          <div className="tc-ghosts" aria-hidden="true">{(['league', 'cup', 'promotion'] as const).map((k) => <span key={k} className="tc-icon ghost"><TrophyIcon kind={k} /></span>)}</div>
          <p className="small muted">Empty for now. League titles, cup wins, promotions and met board targets land here at the end of each season.</p>
        </div>
      )}
    </section>
  );
}
