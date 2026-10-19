/**
 * Club crest editor: shape, pattern, emblem and colour, with a live preview. Saves into the career;
 * "Use generated" goes back to the badge made from the club name.
 */
import { useState } from 'react';
import { CREST_HUES, CREST_PARTS, Crest, MY_HUE, crestLook } from './crest';
import type { CrestDesign } from './crest';
import { useGame } from './common';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function CrestEditor({ onClose }: { onClose: () => void }) {
  const { career: c, update } = useGame();
  const generated = crestLook(c.teamName, MY_HUE);
  const [d, setD] = useState<CrestDesign>(c.crest ?? { shield: generated.shield, split: generated.split, emblem: generated.emblem, hue: generated.hue });
  const set = (k: keyof CrestDesign, v: number) => setD((x) => ({ ...x, [k]: v }));
  const rows: { key: keyof CrestDesign; label: string; values: number[] }[] = [
    { key: 'shield', label: 'Shape', values: range(CREST_PARTS.shields) },
    { key: 'split', label: 'Pattern', values: range(CREST_PARTS.splits) },
    { key: 'emblem', label: 'Emblem', values: range(CREST_PARTS.emblems) },
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet ce-sheet" role="dialog" aria-label="Club crest" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2>Club crest</h2><button className="btn small ghost" onClick={onClose}>Close</button></div>
        <div className="ce-body">
          <div className="ce-preview">
            <Crest name={c.teamName} tag={c.teamTag} design={d} size={156} />
            <span className="team-name">{c.teamName}</span>
            <span className="small faint">Shown in the sidebar, on match day and in the league table.</span>
          </div>
          <div className="ce-controls">
            {rows.map((r) => (
              <div className="ce-row" key={r.key}>
                <span className="label">{r.label}</span>
                <div className="ce-opts" role="group" aria-label={r.label}>
                  {r.values.map((v) => (
                    <button key={v} type="button" className="ce-opt" aria-pressed={d[r.key] === v} aria-label={`${r.label} ${v + 1}`} onClick={() => set(r.key, v)}>
                      <Crest name={c.teamName} tag="" design={{ ...d, [r.key]: v }} size={44} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="ce-row">
              <span className="label">Colour</span>
              <div className="ce-opts" role="group" aria-label="Colour">
                {CREST_HUES.map((h) => (
                  <button key={h} type="button" className="ce-swatch" aria-pressed={d.hue === h} aria-label={`Colour ${h}`} style={{ background: `linear-gradient(160deg, hsl(${h} 68% 52%), hsl(${h} 58% 28%))` }} onClick={() => set('hue', h)} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="ce-foot">
          <button className="btn ghost" onClick={() => { const { crest: _drop, ...rest } = c; update(rest, 'Crest reset to the generated badge.'); onClose(); }}>Use generated</button>
          <button className="btn primary" onClick={() => { update({ ...c, crest: d }, 'Crest saved.'); onClose(); }}>Save crest</button>
        </div>
      </div>
    </div>
  );
}
