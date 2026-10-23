import { useState } from 'react';
import type { Career } from '../../engine/career';
import { DIFFICULTY_LABEL, DIFFICULTY_TIP, ensureContracts } from '../../engine/career';
import { csvTemplate, importCsv, mergeForCareer } from '../../engine/data/importer';
import type { ImportReport } from '../../engine/data/importer';
import { generateSyntheticDataset } from '../../engine/data/generateDataset';
import { REAL_DATASET_ID, realDataset } from '../../engine/data/realPlayers';
import { ContactForm } from '../ContactForm';
import { deserializeCareer, serializeCareer } from '../../engine/save';
import type { Dataset } from '../../engine/types';
import { useGame } from '../common';
import { Crest } from '../crest';
import { CrestEditor } from '../CrestEditor';
import { music } from '../music';
import { setStadiumOn, stadiumOn } from '../StadiumScene';
import '../styles/home.css';
import { storeDataset } from '../persist';
import { providerStatuses } from '../../engine/data/providers';

export function Settings({ onClose, replaceWorld, onReset }: { onClose: () => void; replaceWorld: (d: Dataset, c: Career | null) => void; onReset: () => void }) {
  const { world, career: c, update, toast } = useGame();
  const [exportText, setExportText] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [crestOpen, setCrestOpen] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(music.on);
  const [stadium, setStadium] = useState(stadiumOn);
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [snapshot, setSnapshot] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ImportReport | null>(null);
  const ds = world.dataset;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Copy is blocked here. Select the text and copy it manually.'); }
  };

  const loadSave = (text: string) => {
    try {
      const career = deserializeCareer(text.trim());
      if (!career.cards.every((x) => world.profiles.has(x.playerId))) throw new Error('This save uses players that are not in the current dataset.');
      update(ensureContracts(world, career), 'Save loaded.');
      onClose();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const validateCsv = () => {
    if (!csv) return;
    setReport(importCsv(csv.text, { sourceName: csv.name, snapshotDate: snapshot }));
  };

  const applyCsv = () => {
    if (!report?.ok || !report.dataset) return;
    const merged = mergeForCareer(report.dataset, ds, c.cards.map((x) => x.playerId));
    storeDataset(merged.dataset);
    replaceWorld(merged.dataset, { ...c, datasetId: merged.dataset.id });
    toast(`Loaded ${report.dataset.players.length} players.${merged.kept.length ? ` Kept ${merged.kept.length} owned players missing from the file.` : ''}`);
    onClose();
  };

  const backToDemo = () => {
    const demo = generateSyntheticDataset();
    const ids = new Set(demo.players.map((p) => p.id));
    if (!c.cards.every((x) => ids.has(x.playerId))) { toast('Your collection has imported players, so this career cannot switch back. Start a new career to use the demo data.'); return; }
    storeDataset(null);
    replaceWorld(demo, { ...c, datasetId: demo.id });
    toast('Switched to the demo dataset.');
    onClose();
  };

  const useReal = () => {
    const real = realDataset();
    if (!real) { toast('The real player data failed its check in this build, so the demo players stay.'); return; }
    const ids = new Set(real.players.map((p) => p.id));
    if (!c.cards.every((x) => ids.has(x.playerId))) { toast('Your collection has demo players, so this career cannot switch. Start a new career to play with the real pros.'); return; }
    storeDataset(null);
    replaceWorld(real, { ...c, datasetId: real.id });
    toast('Switched to the real pros.');
    onClose();
  };

  const isReal = ds.id === REAL_DATASET_ID;

  const stateLabel = (st: string) => (st === 'ready' ? 'Ready' : st === 'needs-input' ? 'Needs a file' : st === 'untested' ? 'Not connected' : 'Disabled');

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet st-sheet" role="dialog" aria-label="Settings and data" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h2>Settings &amp; data</h2><button className="btn small ghost" onClick={onClose}>Close</button></div>

        <section className="st-group" aria-labelledby="st-game">
          <h3 id="st-game" className="st-h">Game</h3>
          <div className="st-card">
            <div className="st-row st-row-col">
              <div className="st-row-t"><strong>Difficulty</strong><span className="small faint">{DIFFICULTY_TIP[c.difficulty ?? 'normal']}</span></div>
              <div className="seg compact st-seg" role="group" aria-label="Difficulty level">
                {(['relaxed', 'normal', 'hard'] as const).map((d) => <button key={d} aria-pressed={(c.difficulty ?? 'normal') === d} onClick={() => update({ ...c, difficulty: d }, `Difficulty: ${DIFFICULTY_LABEL[d]}.`)}>{DIFFICULTY_LABEL[d]}</button>)}
              </div>
            </div>
          </div>
        </section>

        <section className="st-group" aria-labelledby="st-club">
          <h3 id="st-club" className="st-h">Club</h3>
          <div className="st-card">
            <div className="st-row">
              <div className="row" style={{ gap: 12 }}><Crest name={c.teamName} tag={c.teamTag} mine size={40} /><div className="st-row-t"><strong>Club crest</strong><span className="small faint">{c.crest ? 'Your own design.' : 'Generated from the club name.'}</span></div></div>
              <button className="btn small" onClick={() => setCrestOpen(true)}>Edit crest</button>
            </div>
          </div>
          <div className="st-card">
            <div className="st-row">
              <div className="st-row-t"><strong>Menu music</strong><span className="small faint">A quiet loop on the menus. It stops during matches.</span></div>
              <button className="btn small" aria-pressed={musicEnabled} onClick={() => { const v = !musicEnabled; setMusicEnabled(v); music.setEnabled(v); music.unlock(); }}>{musicEnabled ? 'On' : 'Off'}</button>
            </div>
          </div>
          <div className="st-card">
            <div className="st-row">
              <div className="st-row-t"><strong>3D arena backdrop</strong><span className="small faint">A live stadium behind the menus on larger screens. Turn it off to save battery.</span></div>
              <button className="btn small" aria-pressed={stadium} onClick={() => { const v = !stadium; setStadium(v); setStadiumOn(v); window.dispatchEvent(new Event('clutch-stadium')); }}>{stadium ? 'On' : 'Off'}</button>
            </div>
          </div>
        </section>
        {crestOpen && <CrestEditor onClose={() => setCrestOpen(false)} />}

        <section className="st-group" aria-labelledby="st-save">
          <h3 id="st-save" className="st-h">Save</h3>
          <div className="st-card">
            <div className="st-row">
              <div className="st-row-t"><strong>Autosave</strong><span className="small faint">Your career saves automatically in this browser. Export it to keep a copy or move it to another device.</span></div>
              <span className="chip good">On</span>
            </div>
            <div className="st-row">
              <div className="st-actions">
                <button className="btn small" onClick={() => setExportText(serializeCareer(c))}>Export save</button>
                <label className="btn small" htmlFor="save-file" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('save-file')?.click(); } }}>Load save file</label>
                <input id="save-file" type="file" accept=".json,application/json,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) loadSave(await f.text()); }} />
              </div>
            </div>
            {exportText && (
              <div className="st-row st-row-col">
                <div className="field st-field">
                  <label className="label" htmlFor="save-out">Save data (copy and keep it somewhere safe)</label>
                  <textarea id="save-out" readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn small" onClick={() => copy(exportText)}>Copy</button>
                </div>
              </div>
            )}
            <div className="st-row st-row-col">
              <div className="field st-field">
                <label className="label" htmlFor="save-in">Or paste save data</label>
                <textarea id="save-in" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"format":"csm-save", ...}' />
                <button className="btn small" disabled={!importText.trim()} onClick={() => loadSave(importText)}>Load pasted save</button>
              </div>
            </div>
          </div>
        </section>

        <section className="st-group" aria-labelledby="st-data">
          <h3 id="st-data" className="st-h">Player data</h3>
          <div className="st-card">
            <div className="st-row">
              <div className="st-row-t"><strong>{ds.label}</strong><span className="small faint">{ds.players.length} players · created {ds.createdAt}. {ds.isSynthetic ? 'Every player and statistic is fictional. Nothing here is live.' : isReal ? 'Real players and teams from a dated snapshot. Ratings are our own game numbers, not official statistics.' : 'A dated snapshot from your own file. Nothing here is live.'}</span></div>
              <span className={`chip ${ds.isSynthetic ? 'warn' : 'good'}`}>{ds.isSynthetic ? 'Demo' : isReal ? 'Real pros' : 'Imported'}</span>
            </div>
            <details className="st-row st-details">
              <summary><span>Import your own stats (CSV)</span><span className="st-caret" aria-hidden="true">›</span></summary>
              <div className="stack" style={{ marginTop: 10, gap: 10 }}>
                <p className="small muted">Only import data you have the right to use. Required columns: rank, handle, primary_role, rating, maps_played. Missing optional stats stay empty and are never filled in with made-up numbers. Your cards keep their training progress.</p>
                <div className="st-two">
                  <div className="field"><label className="label" htmlFor="csv-file">CSV file</label><input id="csv-file" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv({ name: f.name, text: await f.text() }); setReport(null); } }} /></div>
                  <div className="field"><label className="label" htmlFor="csv-date">Snapshot date</label><input id="csv-date" type="date" value={snapshot} onChange={(e) => setSnapshot(e.target.value)} /></div>
                </div>
                <div className="st-actions">
                  <button className="btn small" disabled={!csv} onClick={validateCsv}>Check file</button>
                  <button className="btn small ghost" onClick={() => copy(csvTemplate())}>Copy CSV header template</button>
                </div>
                {report && (
                  <div className={`st-report ${report.ok ? 'ok' : 'err'}`}>
                    <strong className={report.ok ? 'good' : 'bad'}>{report.ok ? `Valid: ${report.dataset!.players.length} players.` : `${report.errors.length} problem(s) found.`}</strong>
                    {report.errors.slice(0, 8).map((e, i) => <span key={i} className="bad">{e}</span>)}
                    {report.warnings.slice(0, 5).map((e, i) => <span key={i} className="muted">{e}</span>)}
                    {report.ok && <button className="btn small primary" onClick={applyCsv}>Use this data</button>}
                  </div>
                )}
              </div>
            </details>
            {!ds.isSynthetic && <div className="st-row"><button className="btn small ghost" onClick={backToDemo}>Switch to the fictional demo players</button></div>}
            {!isReal && <div className="st-row"><button className="btn small ghost" onClick={useReal}>Switch to the real pros</button></div>}
          </div>
        </section>

        <section className="st-group" aria-labelledby="st-credits">
          <h3 id="st-credits" className="st-h">About &amp; credits</h3>
          <div className="st-card">
            <div className="st-row st-row-col">
              <p className="small muted">Clutch Manager is a free, unofficial fan game. It is not affiliated with or endorsed by Valve, any team, player or tournament organiser. Counter-Strike and CS2 are trademarks of Valve Corporation.</p>
              <p className="small muted">Teams, rosters and team strength: <a href="https://github.com/ValveSoftware/counter-strike_regional_standings" target="_blank" rel="noreferrer">Valve Counter-Strike Regional Standings</a>. Player countries, ages and roles: <a href="https://liquipedia.net/counterstrike/" target="_blank" rel="noreferrer">Liquipedia</a>, under <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>; our derived player list is shared under the same licence.</p>
              <p className="small muted">Team logos come from Liquipedia and belong to their organisations; they are used only in this free, non-commercial university project. The 3D soldier is the rigged character from the <a href="https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf" target="_blank" rel="noreferrer">three.js examples</a> (originally from Adobe Mixamo).</p>
              <p className="small muted">Player ratings are our own game numbers (team level, role, and a few picked stars). They are opinion, not statistics. The HLTV figures on player sheets and in Scout (rating, K/D, maps, all-time career) come from a page of <a href="https://www.hltv.org/stats/players" target="_blank" rel="noreferrer">HLTV.org</a> saved on 2026-10-23; they are shown for reference and do not change the game ratings.</p>
              <p className="small muted">Are you a player and want your name removed? Use the contact form below and it will be removed in the next update.</p>
            </div>
            <details className="st-row st-details">
              <summary><span>Contact the developer</span><span className="st-caret" aria-hidden="true">›</span></summary>
              <div style={{ marginTop: 10 }}><ContactForm /></div>
            </details>
          </div>
        </section>

        <section className="st-group" aria-labelledby="st-src">
          <h3 id="st-src" className="st-h">Data sources</h3>
          <div className="st-card">
            {providerStatuses(ds).map((p) => (
              <div key={p.id} className="st-row st-src">
                <i className={`st-dot ${p.state}`} aria-hidden="true" />
                <div className="st-row-t">
                  <strong>{p.name}</strong>
                  <span className="small faint">{p.detail}</span>
                  {p.link && <a className="st-link small" href={p.link} target="_blank" rel="noreferrer">{p.link.replace('https://', '')}</a>}
                </div>
                <span className={`chip ${p.state === 'ready' ? 'good' : p.state === 'disabled' ? 'bad' : 'warn'}`}>{stateLabel(p.state)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="st-group" aria-labelledby="st-reset">
          <h3 id="st-reset" className="st-h bad">Danger zone</h3>
          <div className="st-card st-danger">
            {confirmReset ? (
              <div className="st-row st-row-col">
                <p className="small bad">This deletes the current career from this browser. Export it first if you want to keep it.</p>
                <div className="st-actions"><button className="btn small ghost" onClick={() => setConfirmReset(false)}>Keep playing</button><button className="btn small danger" onClick={onReset}>Delete and restart</button></div>
              </div>
            ) : (
              <div className="st-row">
                <div className="st-row-t"><strong>New career</strong><span className="small faint">Delete this career and start again from the first screen.</span></div>
                <button className="btn small danger" onClick={() => setConfirmReset(true)}>Start over</button>
              </div>
            )}
          </div>
        </section>
        <p className="st-foot">Clutch Manager beta · v0.9.0 · fictional demo data · not affiliated with Valve or HLTV.</p>
      </div>
    </div>
  );
}
