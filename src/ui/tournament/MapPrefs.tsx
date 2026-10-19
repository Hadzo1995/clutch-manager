/** Map preferences for the tournament veto: rank the maps you want, leave the rest to your coach. */
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Career } from '../../engine/career';
import { humanSnapshot, lineupValidation } from '../../engine/career';
import { mapFamiliarity } from '../../engine/team';
import { cleanPrefs } from '../../engine/tournament';
import { MAPS } from '../../engine/types';
import type { MapName } from '../../engine/types';
import { useGame } from '../common';
import { MAP_HUE, mapArt } from '../mapart';

export function MapPrefs({ club, onChange, entryNote, goSquad }: { club: Career; onChange: (prefs: MapName[]) => void; entryNote: string; goSquad: () => void }) {
  const { world } = useGame();
  const prefs = cleanPrefs(club.tournament?.mapPrefs ?? []);
  const valid = lineupValidation(club);
  const snap = useMemo(() => (valid.ok ? humanSnapshot(world, club) : null), [world, club, valid.ok]);
  const fam = (m: MapName) => (snap ? Math.round(mapFamiliarity(snap, m)) : null);
  const unranked = [...MAPS].filter((m) => !prefs.includes(m)).sort((a, b) => (fam(b) ?? 0) - (fam(a) ?? 0));
  const move = (i: number, d: -1 | 1) => {
    const n = [...prefs];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j]!, n[i]!];
    onChange(n);
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Lineup and maps</h1>
          <p className="sub">{entryNote}</p>
        </div>
      </header>
      <section className="panel span-5">
        <div className="panel-head"><span className="label">Your five</span><button className="btn small ghost" onClick={goSquad}>Change in Squad</button></div>
        {valid.ok && snap ? (
          <ul className="tn-five">
            {snap.players.map((p) => <li key={p.id}><b>{p.handle}</b> <span className="small muted">{p.role.toUpperCase()}</span></li>)}
          </ul>
        ) : <p className="small bad">{valid.errors[0]}</p>}
        <p className="small faint">Your lineup, tactics, form and fatigue are sent as they are at the moment of sending.</p>
      </section>
      <section className="panel span-7">
        <div className="panel-head"><span className="label">Map preferences</span>{prefs.length > 0 && <button className="btn small ghost" onClick={() => onChange([])}>Clear</button>}</div>
        <p className="small muted">Rank the maps you want to play, best first. In the veto you pick from the top of your list. You ban the maps you left unranked first (your coach chooses which, by your team’s weakest), then your lowest ranked. With nothing ranked, your coach runs the whole veto.</p>
        <ol className="tn-prefs">
          {prefs.map((m, i) => (
            <li key={m} style={{ ['--art' as string]: `url(${mapArt(m)})`, ['--mh' as string]: MAP_HUE[m] } as CSSProperties}>
              <span className="num tn-rank">{i + 1}</span>
              <b>{m}</b>
              {fam(m) !== null && <span className="small muted">practice {fam(m)}</span>}
              <span className="tn-prefs-act">
                <button className="btn small ghost" aria-label={`Move ${m} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="btn small ghost" aria-label={`Move ${m} down`} disabled={i === prefs.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="btn small ghost" aria-label={`Unrank ${m}`} onClick={() => onChange(prefs.filter((x) => x !== m))}>✕</button>
              </span>
            </li>
          ))}
        </ol>
        {unranked.length > 0 && (
          <>
            <span className="label">Not ranked{prefs.length > 0 ? ' (banned first)' : ''}</span>
            <div className="row wrap" style={{ gap: 8 }}>
              {unranked.map((m) => <button key={m} className="btn small" onClick={() => onChange([...prefs, m])}>+ {m}{fam(m) !== null ? ` · ${fam(m)}` : ''}</button>)}
            </div>
          </>
        )}
      </section>
    </>
  );
}
