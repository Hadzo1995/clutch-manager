import { useEffect } from 'react';
import { Avatar } from '../avatar/Avatar';
import { playerStatus } from '../../engine/career';
import { baseWage, marketValue } from '../../engine/economy';
import { personalityOf } from '../../engine/profile';
import { ATTRIBUTES, ATTRIBUTE_LABEL, MAPS, ROLE_LABEL } from '../../engine/types';
import type { PlayerProfile } from '../../engine/types';
import { OvrBadge, RoleIcon, fmt, useGame, CountryTag } from '../common';
import { DuelBar } from '../charts';

const GAME_VALUE_GROUPS = new Set(['Overview', 'Personality']);

interface Row { label: string; a: number | null; b: number | null; lowerBetter?: boolean; fmt?: (n: number) => string; group: string; max?: number }

/** Two players side by side: butterfly bars per metric, the better side lit in its colour. */
export function CompareSheet({ ids, onClose }: { ids: [string, string]; onClose: () => void }) {
  const { world, career: c, openPlayer } = useGame();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const a = world.profiles.get(ids[0]);
  const b = world.profiles.get(ids[1]);
  if (!a || !b) return null;
  const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
  const rows: Row[] = [
    { group: 'Overview', label: 'Overall', a: a.ovr, b: b.ovr, max: 100 },
    { group: 'Overview', label: 'Potential', a: a.potential, b: b.potential, max: 100 },
    { group: 'Overview', label: 'Age', a: a.record.age, b: b.record.age, lowerBetter: true },
    { group: 'Overview', label: 'Market value', a: marketValue(a), b: marketValue(b), lowerBetter: true, fmt },
    { group: 'Overview', label: 'Wage / week', a: baseWage(a), b: baseWage(b), lowerBetter: true, fmt },
    ...ATTRIBUTES.map((k) => ({ group: 'Attributes', label: ATTRIBUTE_LABEL[k], a: a.base[k], b: b.base[k], max: 100 })),
    { group: 'Source stats', label: 'Rating', a: a.record.stats.rating, b: b.record.stats.rating, fmt: (n: number) => n.toFixed(2) },
    { group: 'Source stats', label: 'ADR', a: a.record.stats.adr, b: b.record.stats.adr, fmt: (n: number) => n.toFixed(1) },
    { group: 'Source stats', label: 'KAST %', a: pct(a.record.stats.kast), b: pct(b.record.stats.kast), max: 100 },
    { group: 'Source stats', label: 'Opening duels %', a: pct(a.record.stats.openingSuccess), b: pct(b.record.stats.openingSuccess), max: 100 },
    { group: 'Source stats', label: 'Clutch win %', a: pct(a.record.stats.clutchWinRate), b: pct(b.record.stats.clutchWinRate), max: 100 },
    { group: 'Source stats', label: 'AWP kill share %', a: pct(a.record.stats.awpKillShare), b: pct(b.record.stats.awpKillShare), max: 100 },
    { group: 'Personality', label: 'Professionalism', a: personalityOf(a.record.id).professionalism, b: personalityOf(b.record.id).professionalism, max: 20 },
    { group: 'Personality', label: 'Big-game mentality', a: personalityOf(a.record.id).bigGame, b: personalityOf(b.record.id).bigGame, max: 20 },
    ...MAPS.map((m) => ({ group: 'Map skill', label: m, a: a.mapSkill[m], b: b.mapSkill[m], max: 100 })),
  ];
  const groups = [...new Set(rows.map((r) => r.group))];
  const wins = (side: 1 | 2) => rows.filter((r) => r.a !== null && r.b !== null && r.a !== r.b && ((r.lowerBetter ? r.a < r.b : r.a > r.b) === (side === 1))).length;
  const st = (id: string) => { const s = playerStatus(c, id); return s.owner === 'you' ? 'Your squad' : s.owner === 'ai' ? s.teamTag : 'Free agent'; };
  const head = (p: PlayerProfile, side: 'a' | 'b', w: number) => (
    <button className={`cmp-p ${side}`} onClick={() => { onClose(); openPlayer(null, p.record.id); }} aria-label={`Open ${p.record.handle}'s profile`}>
      <Avatar seed={p.record.id} size={56} accent={side === 'a' ? '#f0a33a' : '#5aa9e6'} className={`ava-ring ${p.rarity}`} />
      <span className="cmp-id">
        <strong>{p.record.handle}</strong>
        <span className="small muted"><CountryTag cc={p.record.country} /> <RoleIcon role={p.record.primaryRole} /> {ROLE_LABEL[p.record.primaryRole]}</span>
        <span className="small faint">{st(p.record.id)} · {p.record.age}y</span>
      </span>
      <OvrBadge value={p.ovr} rarity={p.rarity} size="sm" />
      <span className="cmp-wins small"><b className="num">{w}</b> wins</span>
    </button>
  );
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet cmp-sheet" role="dialog" aria-modal="true" aria-label="Compare players" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2>Compare</h2><button className="btn small ghost" onClick={onClose}>Close</button></div>
        <div className="cmp-heads">
          {head(a, 'a', wins(1))}
          <span className="cmp-vs" aria-hidden="true">VS</span>
          {head(b, 'b', wins(2))}
        </div>
        <div role="table" aria-label={`${a.record.handle} versus ${b.record.handle}`} className="cmp-table">
          {groups.map((g) => (
            <section key={g} className="cmp-group" role="rowgroup">
              <h3 className="label cmp-gh">{g}{GAME_VALUE_GROUPS.has(g) && <span className="cmp-gv" data-tip={g === 'Personality' ? 'Invented for the game, not real-world facts.' : 'Potential, value and wage are game values, not real-world figures.'} tabIndex={0}>game values</span>}</h3>
              {rows.filter((r) => r.group === g).map((r) => (
                <DuelBar key={r.label} label={r.label} a={r.a} b={r.b} max={r.max} lowerBetter={r.lowerBetter} format={r.fmt} />
              ))}
            </section>
          ))}
        </div>
        <p className="small faint">Lit bars mark the better value; ↓ means lower is better. Source stats come from the active dataset (fictional demo data unless you imported your own). "—" means no data, never a guess.</p>
      </div>
    </div>
  );
}
