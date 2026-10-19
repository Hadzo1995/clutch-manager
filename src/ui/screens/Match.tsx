import { STAGE_LABEL } from '../../engine/season';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { completeMatchday, fixtureSnapshots, humanFixture, seedForFixture, setTactics, teamName } from '../../engine/career';
import { MapSim, mapsNeeded } from '../../engine/match';
import type { MapResult, RoundResult, SeriesResult, TeamIdx } from '../../engine/match';
import { buyRecord, explainMap, keyMoments, seriesLines, trainingAdvice } from '../../engine/report';
import type { SeriesLine } from '../../engine/report';
import { Rng, hashString } from '../../engine/rng';
import { DIVISIONS, HUMAN_ID } from '../../engine/season';
import { MATCHUP_T_WIN, TACTIC_TIPS } from '../../engine/tactics';
import { mapFamiliarity, teamStrength } from '../../engine/team';
import type { TeamSnapshot } from '../../engine/team';
import { aiVetoChoice, applyVeto, currentStep, newVeto, vetoMaps } from '../../engine/veto';
import type { VetoState } from '../../engine/veto';
import { MAPS, ECONOMY_LABEL, ECONOMY_TIPS, CT_SETUP_LABEL, FOOTSTEPS_LABEL, FOOTSTEPS_TIPS, PLAYSTYLE_LABEL, T_APPROACH_LABEL } from '../../engine/types';
import type { CTSetup, EconomyPolicy, Footsteps, MapName, Playstyle, Tactics, TApproach } from '../../engine/types';
import { Bar, useGame } from '../common';
import { RoundViewer } from '../arena/RoundViewer';
import { Avatar } from '../avatar/Avatar';
import { webglAvailable } from '../arena/Viewer3D';
import { MAP_HUE, mapArt } from '../mapart';
import { Crest } from '../crest';
import '../styles/match.css';

type Stage = 'prep' | 'live' | 'report';

/** Hue per map, used for the veto tiles and map chips. */
const hue = (m: MapName) => ({ ['--mh' as string]: MAP_HUE[m] } as CSSProperties);
const art = (m: MapName) => ({ ['--mh' as string]: MAP_HUE[m], ['--art' as string]: `url(${mapArt(m)})` } as CSSProperties);

export function MatchFlow({ onClose }: { onClose: () => void }) {
  const { world, career: c, update } = useGame();
  const fixture = useMemo(() => humanFixture(c), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [stage, setStage] = useState<Stage>('prep');
  const [tactics, setTac] = useState<Tactics>({ ...c.tactics });
  const [veto, setVeto] = useState<VetoState | null>(null);
  const [series, setSeries] = useState<SeriesResult | null>(null);
  const [instant, setInstant] = useState(false);

  const baseTeams = useMemo(() => fixture ? fixtureSnapshots(world, c, fixture) : null, [fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const humanIdx: TeamIdx = fixture?.home === HUMAN_ID ? 0 : 1;
  const oppIdx: TeamIdx = humanIdx === 0 ? 1 : 0;

  useEffect(() => { if (fixture && !veto) setVeto(newVeto(fixture.format, 0)); }, [fixture, veto]);

  // AI veto steps run automatically.
  useEffect(() => {
    if (!veto || !baseTeams) return;
    const step = currentStep(veto);
    if (!step || step.team === humanIdx) return;
    const t = window.setTimeout(() => setVeto(applyVeto(veto, aiVetoChoice(veto, baseTeams[step.team], baseTeams[step.team === 0 ? 1 : 0]))), 550);
    return () => window.clearTimeout(t);
  }, [veto, baseTeams, humanIdx]);

  if (!fixture || !baseTeams) {
    return (
      <div className="fullscreen">
        <div className="inner mx-inner">
          <div className="panel mx-empty"><h2>No match this week</h2><p className="muted small">Your next fixture appears here once the schedule reaches it.</p><button className="btn" onClick={onClose}>Back</button></div>
        </div>
      </div>
    );
  }
  const teams: [TeamSnapshot, TeamSnapshot] = humanIdx === 0
    ? [{ ...baseTeams[0], tactics }, baseTeams[1]]
    : [baseTeams[0], { ...baseTeams[1], tactics }];
  const opp = baseTeams[oppIdx];
  const vetoDone = veto ? currentStep(veto) === null : false;
  const maps = veto && vetoDone ? vetoMaps(veto) : [];
  const stageLabel = `${fixture.stage === 'league' ? `League week ${fixture.week}` : STAGE_LABEL[fixture.stage]} · ${fixture.format.toUpperCase()}`;

  const start = (asInstant: boolean) => {
    update(setTactics(c, tactics));
    setInstant(asInstant);
    setStage('live');
  };

  return (
    <div className="fullscreen" role="dialog" aria-label="Match">
      <div className={`inner mx-inner mx-${stage} ${stage === 'live' ? 'wide' : ''}`}>
        {stage !== 'live' && (
          <div className="mx-topline">
            <span className="label">{stageLabel}</span>
            {stage === 'prep' && <button className="btn small ghost" onClick={onClose}>Back</button>}
          </div>
        )}
        {stage === 'prep' && veto && (
          <Prep teams={teams} humanIdx={humanIdx} opp={opp} veto={veto} setVeto={setVeto} tactics={tactics} setTactics={setTac} seedKey={fixture.id} vetoDone={vetoDone} maps={maps} onStart={start} />
        )}
        {stage === 'live' && (
          <Live teams={teams} humanIdx={humanIdx} maps={maps} format={fixture.format} seed={seedForFixture(c, fixture)} instant={instant} stageLabel={stageLabel} onFinished={(s) => { setSeries(s); setStage('report'); }} />
        )}
        {stage === 'report' && series && (
          <Report series={series} teams={teams} humanIdx={humanIdx} onContinue={() => {
            const div = DIVISIONS[c.season.division]!;
            const won = series.winner === humanIdx;
            update(completeMatchday(world, { ...c, tactics }, series), won ? `Win! +${div.winReward} coins.` : `Loss. +${Math.round(div.winReward * 0.4)} coins.`);
            onClose();
          }} />
        )}
      </div>
    </div>
  );
}

// ---------------- Prep: scouting, veto, tactics ----------------

function noisy(value: number, key: string, exact: boolean): number {
  if (exact) return value;
  const n = (new Rng(hashString(key)).next() - 0.5) * 0.24;
  return Math.max(0, Math.min(1, value + n));
}

function Prep({ teams, humanIdx, opp, veto, setVeto, tactics, setTactics, seedKey, vetoDone, maps, onStart }: {
  teams: [TeamSnapshot, TeamSnapshot]; humanIdx: TeamIdx; opp: TeamSnapshot; veto: VetoState; setVeto: (v: VetoState) => void;
  tactics: Tactics; setTactics: (t: Tactics) => void; seedKey: string; vetoDone: boolean; maps: MapName[]; onStart: (instant: boolean) => void;
}) {
  const me = teams[humanIdx];
  const exact = me.prepBonus > 0;
  const tSum = Object.values(opp.tendencies.t).reduce((a, b) => a + b, 0);
  const ctSum = Object.values(opp.tendencies.ct).reduce((a, b) => a + b, 0);
  const tShares = (Object.entries(opp.tendencies.t) as [TApproach, number][]).map(([k, v]) => [k, noisy(v / tSum, seedKey + k, exact)] as const).sort((a, b) => b[1] - a[1]);
  const ctShares = (Object.entries(opp.tendencies.ct) as [CTSetup, number][]).map(([k, v]) => [k, noisy(v / ctSum, seedKey + k, exact)] as const).sort((a, b) => b[1] - a[1]);
  const aBias = noisy(opp.tendencies.aSiteBias, seedKey + 'site', exact);
  const theirTopCT = ctShares[0]![0];
  const theirTopT = tShares[0]![0];
  const bestT = (['default', 'execute', 'rush'] as TApproach[]).sort((a, b) => MATCHUP_T_WIN[b][theirTopCT] - MATCHUP_T_WIN[a][theirTopCT])[0]!;
  const bestCT = (['standard', 'retake', 'aggro'] as CTSetup[]).sort((a, b) => MATCHUP_T_WIN[theirTopT][a] - MATCHUP_T_WIN[theirTopT][b])[0]!;
  const step = currentStep(veto);
  const sMe = teamStrength(me);
  const sOpp = teamStrength(opp);
  const myTurn = step?.team === humanIdx;

  return (
    <>
      <section className="mx-card" aria-label="Match up">
        <div className="mx-card-team">
          <Crest name={me.name} tag={me.tag} mine size={64} className="mx-crest" />
          <span className="mx-card-tag t-col">{me.tag}</span>
          <span className="mx-card-name">{me.name}</span>
        </div>
        <div className="mx-card-mid">
          <span className="mx-card-vs">VS</span>
        </div>
        <div className="mx-card-team right">
          <Crest name={opp.name} tag={opp.tag} size={64} className="mx-crest" />
          <span className="mx-card-tag ct-col">{opp.tag}</span>
          <span className="mx-card-name">{opp.name}</span>
        </div>
        <div className="mx-card-strength" aria-label={`Team strength ${sMe} against ${sOpp}`}>
          <span className="num t-col">{sMe}</span>
          <div className="mx-split" aria-hidden="true"><i className="me" style={{ flexGrow: sMe }} /><i className="them" style={{ flexGrow: sOpp }} /></div>
          <span className="num ct-col">{sOpp}</span>
          <span className="label mx-card-strength-label">Team strength</span>
        </div>
      </section>

      <section className="panel mx-veto" aria-label="Map veto">
        <div className="panel-head">
          <h2>Map veto</h2>
          <span className="small faint">{veto.format === 'bo1' ? 'Six bans, the last map is played' : 'Ban, ban, pick, pick, ban, ban, decider'}</span>
        </div>
        <ol className="mx-steps" aria-label="Veto order">
          {veto.steps.map((s, i) => {
            const d = veto.done[i];
            const state = d ? 'done' : i === veto.done.length ? 'now' : '';
            return (
              <li key={i} className={`${s.team === humanIdx ? 'me' : 'them'} ${s.action} ${state}`}>
                <span className="mx-step-who">{teams[s.team].tag} <span className="mx-step-act">{s.action}</span></span>
                <span className="mx-step-map">{d ? d.map : state === 'now' ? '…' : '—'}</span>
              </li>
            );
          })}
          <li className={`decider ${vetoDone ? 'done' : ''}`}>
            <span className="mx-step-who">Decider</span>
            <span className="mx-step-map">{vetoDone ? veto.remaining[0] : '—'}</span>
          </li>
        </ol>
        <div className={`mx-turn ${step ? (myTurn ? 'me' : 'them') : 'done'}`} role="status" style={!step && maps[0] ? art(maps[maps.length - 1]!) : undefined}>
          {step ? (
            myTurn ? (
              <>
                <span className="mx-turn-text"><b>Your {step.action}.</b> {step.action === 'ban' ? 'Remove a map you do not want to play.' : 'Choose a map you want to play.'}</span>
                <button className="btn small" onClick={() => setVeto(applyVeto(veto, aiVetoChoice(veto, me, opp)))}>Let the coach choose</button>
              </>
            ) : <span className="mx-turn-text"><b>{opp.tag}</b> {step.action === 'ban' ? 'are banning' : 'are picking'}<span className="mx-dots" aria-hidden="true"><i /><i /><i /></span></span>
          ) : <span className="mx-turn-text"><b>Veto complete.</b> Playing {maps.join(', then ')}.</span>}
        </div>
        <div className="mx-maps">
          {/* Strongest edge for you on the left, strongest for the opponent on the right. */}
          {[...MAPS].sort((a, b) => (mapFamiliarity(opp, a) - mapFamiliarity(me, a)) - (mapFamiliarity(opp, b) - mapFamiliarity(me, b))).map((m) => {
            const done = veto.done.find((d) => d.map === m);
            const mine = Math.round(mapFamiliarity(me, m));
            const theirs = Math.round(mapFamiliarity(opp, m));
            const edge = mine - theirs;
            const canAct = myTurn && !done;
            const playIdx = vetoDone ? maps.indexOf(m) : -1;
            const state = done?.step.action === 'ban' ? 'banned' : done?.step.action === 'pick' ? 'picked' : playIdx >= 0 ? 'decider' : canAct ? `open ${step!.action}` : '';
            const tag = done ? `${teams[done.step.team].tag} ${done.step.action}` : playIdx >= 0 ? 'Decider' : '';
            return (
              <button key={m} className={`mx-map ${state}`} style={art(m)} disabled={!canAct} onClick={() => setVeto(applyVeto(veto, m))}
                aria-label={`${canAct ? `${step!.action === 'ban' ? 'Ban' : 'Pick'} ` : ''}${m}. Your familiarity ${mine}, theirs ${theirs}.${tag ? ` ${tag}.` : ''}`}>
                <span className="mx-map-art" aria-hidden="true" />
                <span className="mx-map-top">
                  <span className="mx-map-name">{m}</span>
                  {tag && <span className={`mx-map-tag ${done?.step.team === humanIdx ? 'me' : done ? 'them' : ''}`}>{tag}</span>}
                </span>
                <span className="mx-map-fam"><span className="t-col num">{mine}</span><Bar value={mine} tone="t" /></span>
                <span className="mx-map-fam"><span className="ct-col num">{theirs}</span><Bar value={theirs} tone="ct" /></span>
                <span className={`mx-map-edge num ${edge > 0 ? 'good' : edge < 0 ? 'bad' : 'faint'}`}>{edge > 0 ? '+' : ''}{edge} edge</span>
                {canAct && <span className="mx-map-cta" aria-hidden="true">{step!.action}</span>}
              </button>
            );
          })}
        </div>
        <p className="small faint mx-legend"><span><i className="t" />{me.tag} familiarity</span><span><i className="ct" />{opp.tag} familiarity</span><span>Combines players' map skill, team practice and coach specialty.</span></p>
      </section>

      <div className="mx-prep-grid">
        <section className="panel mx-scout" aria-label="Scouting report">
          <div className="panel-head"><h2>Scouting · {opp.tag}</h2><span className={`chip ${exact ? 'good' : 'warn'}`}>{exact ? 'Full prep' : 'Rough estimate'}</span></div>
          {!exact && <p className="small muted">Run a Tactical review in training to get exact tendencies and a prep bonus.</p>}
          <div className="mx-tend">
            <div className="stack">
              <span className="label t-col">Their T side</span>
              {tShares.map(([k, v]) => <div key={k} className="mx-tend-row"><span>{T_APPROACH_LABEL[k]}</span><Bar value={v * 100} tone="t" /><span className="num">{Math.round(v * 100)}%</span></div>)}
              <span className="small faint">Hits A {Math.round(aBias * 100)}% · B {100 - Math.round(aBias * 100)}%</span>
            </div>
            <div className="stack">
              <span className="label ct-col">Their CT side</span>
              {ctShares.map(([k, v]) => <div key={k} className="mx-tend-row"><span>{CT_SETUP_LABEL[k].split(' ')[0]}</span><Bar value={v * 100} tone="ct" /><span className="num">{Math.round(v * 100)}%</span></div>)}
            </div>
          </div>
          <div className="mx-callout">
            <span className="label">Coach suggestion</span>
            <p className="small"><strong>{T_APPROACH_LABEL[bestT]}</strong> on T against their {CT_SETUP_LABEL[theirTopCT].toLowerCase()}, <strong>{CT_SETUP_LABEL[bestCT]}</strong> on CT against their {T_APPROACH_LABEL[theirTopT].toLowerCase()}.</p>
            {(tactics.tApproach !== bestT || tactics.ctSetup !== bestCT) && (
              <button className="btn small ghost" onClick={() => setTactics({ ...tactics, tApproach: bestT, ctSetup: bestCT })}>Use suggestion</button>
            )}
          </div>
        </section>

        <section className="panel mx-plan" aria-label="Game plan">
          <div className="panel-head"><h2>Game plan</h2><span className="small faint">You can change it at halftime and in timeouts</span></div>
          <TacticsEditor tactics={tactics} onChange={setTactics} />
        </section>
      </div>

      <div className="mx-actionbar">
        <span className="mx-actionbar-text small">
          {vetoDone ? <><span className="faint">Playing</span> {maps.map((m) => <span key={m} className="mx-mapchip" style={art(m)}>{m}</span>)}</> : <span className="muted">Finish the map veto to start the match.</span>}
        </span>
        <div className="mx-actionbar-btns">
          <button className="btn ghost" disabled={!vetoDone} onClick={() => onStart(true)}>Instant result</button>
          <button className="btn primary" disabled={!vetoDone} onClick={() => onStart(false)}>Watch live</button>
        </div>
      </div>
    </>
  );
}

export function TacticsEditor({ tactics, onChange }: { tactics: Tactics; onChange: (t: Tactics) => void }) {
  return (
    <div className="mx-tac">
      <div className="mx-tac-grid">
        <div className="mx-tac-group">
          <span className="label">Playstyle</span>
          <div className="seg" role="group" aria-label="Playstyle">
            {(['aggressive', 'balanced', 'passive'] as Playstyle[]).map((p) => <button key={p} aria-pressed={tactics.playstyle === p} onClick={() => onChange({ ...tactics, playstyle: p })}>{PLAYSTYLE_LABEL[p]}</button>)}
          </div>
          <span className="small faint">{tactics.playstyle === 'aggressive' ? 'Leans on aim, more variance, fewer trades.' : tactics.playstyle === 'passive' ? 'Leans on positioning and trading, steadier results.' : 'Even weighting of aim, positioning and game sense.'}</span>
        </div>
        <div className="mx-tac-group">
          <span className="label">Economy</span>
          <div className="seg" role="group" aria-label="Economy">
            {(['disciplined', 'standard', 'force'] as EconomyPolicy[]).map((p) => <button key={p} aria-pressed={(tactics.economy ?? 'standard') === p} onClick={() => onChange({ ...tactics, economy: p })}>{ECONOMY_LABEL[p]}</button>)}
          </div>
          <span className="small faint">{ECONOMY_TIPS[tactics.economy ?? 'standard']}</span>
        </div>
        <div className="mx-tac-group">
          <span className="label">Footsteps</span>
          <div className="seg" role="group" aria-label="Footsteps">
            {(['quiet', 'normal', 'aggressive'] as Footsteps[]).map((p) => <button key={p} aria-pressed={(tactics.footsteps ?? 'normal') === p} onClick={() => onChange({ ...tactics, footsteps: p })}>{FOOTSTEPS_LABEL[p]}</button>)}
          </div>
          <span className="small faint">{FOOTSTEPS_TIPS[tactics.footsteps ?? 'normal']}</span>
        </div>
        <div className="mx-tac-group t">
          <span className="label t-col">T side approach</span>
          <div className="seg" role="group" aria-label="T side approach">
            {(['default', 'execute', 'rush'] as TApproach[]).map((p) => <button key={p} aria-pressed={tactics.tApproach === p} onClick={() => onChange({ ...tactics, tApproach: p })}>{T_APPROACH_LABEL[p]}</button>)}
          </div>
          <span className="small faint">{TACTIC_TIPS[tactics.tApproach]}</span>
        </div>
        <div className="mx-tac-group ct">
          <span className="label ct-col">CT side setup</span>
          <div className="seg ct" role="group" aria-label="CT side setup">
            {(['standard', 'stack', 'retake', 'aggro'] as CTSetup[]).map((p) => <button key={p} aria-pressed={tactics.ctSetup === p} onClick={() => onChange({ ...tactics, ctSetup: p })}>{CT_SETUP_LABEL[p].split(' ')[0]}</button>)}
          </div>
          {tactics.ctSetup === 'stack' && (
            <div className="seg ct compact" role="group" aria-label="Site to stack">
              {(['A', 'B'] as const).map((s) => <button key={s} aria-pressed={tactics.stackSite === s} onClick={() => onChange({ ...tactics, stackSite: s })}>Stack {s}</button>)}
            </div>
          )}
          <span className="small faint">{TACTIC_TIPS[tactics.ctSetup]}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------- Live ----------------

/** Plays a series round by round. `locked` (PvP): no timeouts or plan changes, so both players' browsers play the identical series. */
export function Live({ teams: teamsProp, humanIdx, maps, format, seed, instant, stageLabel, onFinished, locked = false }: {
  teams: [TeamSnapshot, TeamSnapshot]; humanIdx: TeamIdx; maps: MapName[]; format: 'bo1' | 'bo3'; seed: number; instant: boolean; stageLabel: string; onFinished: (s: SeriesResult) => void; locked?: boolean;
}) {
  const teams = useRef(teamsProp).current; // frozen for the whole series
  // Same seed sequence as simulateSeries, so "Instant" and "Watch live" (without timeouts) agree.
  const plan = useMemo(() => {
    const rng = new Rng(seed);
    return maps.map((m) => ({ map: m, seed: rng.int(1, 2 ** 31 - 1), ctFirst: (rng.chance(0.5) ? 0 : 1) as TeamIdx }));
  }, [seed, maps]);
  const sims = useRef<MapSim[]>([]);
  const results = useRef<MapResult[]>([]);
  const [mapIdx, setMapIdx] = useState(0);
  const [round, setRound] = useState<RoundResult | null>(null);
  const [clock, setClock] = useState(0);
  const [view, setView] = useState<'3d' | '2d'>(() => { try { if (localStorage.getItem('clutch-manager.view') === '2d') return '2d'; } catch { /* storage blocked */ } return webglAvailable() ? '3d' : '2d'; });
  const [replay, setReplay] = useState<RoundResult | null>(null);
  const chooseView = (v: '3d' | '2d') => { setView(v); try { localStorage.setItem('clutch-manager.view', v); } catch { /* storage blocked */ } };
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState<null | 'timeout' | 'halftime' | 'between'>(null);
  const [draft, setDraft] = useState<Tactics>({ ...teams[humanIdx].tactics });
  const [halftimeDone, setHalftimeDone] = useState(false);
  const [, force] = useState(0);
  const oppIdx: TeamIdx = humanIdx === 0 ? 1 : 0;

  const simFor = useCallback((i: number) => {
    if (!sims.current[i]) {
      const p = plan[i]!;
      sims.current[i] = new MapSim({ seed: p.seed, teams, map: p.map, ctFirst: p.ctFirst, record: !instant });
    }
    return sims.current[i]!;
  }, [plan, teams]);

  const mapScore = (): [number, number] => {
    const s: [number, number] = [0, 0];
    for (const r of results.current) s[r.winner]++;
    return s;
  };

  const finishSeries = useCallback(() => {
    const ms = mapScore();
    onFinished({ format, maps: [...results.current], mapScore: ms, winner: ms[0] > ms[1] ? 0 : 1 });
  }, [format, onFinished]);

  const endMap = useCallback((i: number) => {
    if (results.current[i]) return;
    const sim = simFor(i);
    results.current[i] = sim.result();
    const ms = mapScore();
    force((x) => x + 1);
    if (Math.max(...ms) >= mapsNeeded(format)) finishSeries();
    else { setSheet('between'); setPaused(true); }
  }, [simFor, format, finishSeries]);

  // Instant: play everything now.
  useEffect(() => {
    if (!instant) return;
    for (let i = 0; i < plan.length; i++) {
      if (Math.max(...mapScore()) >= mapsNeeded(format)) break;
      results.current[i] = simFor(i).playToEnd();
    }
    finishSeries();
  }, [instant]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    const sim = simFor(mapIdx);
    if (sim.finished) { endMap(mapIdx); return; }
    if (sim.isHalftime && !halftimeDone) {
      if (locked) setHalftimeDone(true);
      else { setDraft({ ...sim.tactics[humanIdx] }); setSheet('halftime'); setPaused(true); animDone.current = true; return; }
    }
    setClock(0);
    animDone.current = false;
    setRound(sim.playRound());
  }, [simFor, mapIdx, halftimeDone, humanIdx, endMap, locked]);

  useEffect(() => { if (!instant && !round && !paused) next(); }, [instant, round, paused, next]);

  const animDone = useRef(false);
  const onRoundDone = useCallback(() => {
    animDone.current = true;
    setClock(Infinity);
    window.setTimeout(() => { if (!pausedRef.current && animDone.current) nextRef.current(); }, 450 / speedRef.current);
  }, []);
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const resume = () => {
    setPaused(false);
    pausedRef.current = false;
    if (animDone.current) window.setTimeout(() => nextRef.current(), 0);
  };
  const nextRef = useRef(next); nextRef.current = next;
  const speedRef = useRef(speed); speedRef.current = speed;

  if (instant) return <div className="mx-sim" role="status"><span className="mx-dots" aria-hidden="true"><i /><i /><i /></span><span className="muted">Simulating the series…</span></div>;
  const sim = simFor(mapIdx);
  const human = teams[humanIdx];
  const opp = teams[oppIdx];
  const humanSide = round ? (round.tTeam === humanIdx ? 'T' : 'CT') : sim.ctTeamFor(sim.roundNumber) === humanIdx ? 'CT' : 'T';
  const oppSide = humanSide === 'T' ? 'CT' : 'T';
  const roundOver = !!round && clock === Infinity;
  // The engine has already played the round on screen; don't spoil it in the score or the round strip.
  const live = !!round && !roundOver && sim.rounds[sim.rounds.length - 1] === round;
  const shownRounds = live ? sim.rounds.slice(0, -1) : sim.rounds;
  const shownScore: [number, number] = live ? [round!.score[0] - (round!.winner === 0 ? 1 : 0), round!.score[1] - (round!.winner === 1 ? 1 : 0)] : sim.score;
  const ms = mapScore();
  const timeoutsLeft = sim.timeoutsLeft[humanIdx];
  // Regulation is 24 rounds; overtime adds blocks of six.
  const slots = sim.rounds.length <= 24 ? 24 : 24 + 6 * Math.ceil((sim.rounds.length - 24) / 6);
  // The opponent's plan is only shown once the round is over (or in a replay).
  const reveal = roundOver || !!replay;
  const planText = round ? (round.tTeam === humanIdx
    ? `Your T: ${T_APPROACH_LABEL[round.tactics.t]}${reveal ? ` vs their ${CT_SETUP_LABEL[round.tactics.ct].toLowerCase()}` : ''}`
    : `Your CT: ${CT_SETUP_LABEL[round.tactics.ct]}${reveal ? ` vs their ${T_APPROACH_LABEL[round.tactics.t].toLowerCase()}` : ''}`) : '';
  const lastLine = roundOver && !replay ? round!.commentary[round!.commentary.length - 1] : null;

  const skipMap = () => {
    animDone.current = false;
    while (!sim.finished) sim.playRound();
    setRound(sim.rounds[sim.rounds.length - 1] ?? null);
    endMap(mapIdx);
  };

  return (
    <>
      <header className="mx-head" aria-label="Match">
        <div className="mx-head-row">
          <div className="mx-head-ctx">
            <span className={`mx-onair ${replay ? 'replay' : paused ? 'paused' : ''}`}>{replay ? 'Replay' : paused ? 'Paused' : 'Live'}</span>
            <span className="mx-head-stage">{stageLabel}</span>
          </div>
          <div className="mx-head-teams">
            <span className="mx-head-team">
              <span className={`mx-side ${humanSide.toLowerCase()}`}>{humanSide}</span>
              <b className="mx-head-tag">{human.tag}</b>
              <span className="mx-head-name">{human.name}</span>
            </span>
            <span className="mx-head-vs" aria-hidden="true">vs</span>
            <span className="mx-head-team right">
              <span className="mx-head-name">{opp.name}</span>
              <b className="mx-head-tag">{opp.tag}</b>
              <span className={`mx-side ${oppSide.toLowerCase()}`}>{oppSide}</span>
            </span>
            <span className="sr-only">Score {shownScore[humanIdx]} to {shownScore[oppIdx]}.</span>
          </div>
          <ol className="mx-head-maps" aria-label={plan.length > 1 ? `Series ${ms[humanIdx]}-${ms[oppIdx]}` : 'Map'}>
            {plan.map((p, i) => {
              const res = results.current[i];
              const state = res ? (res.winner === humanIdx ? 'won' : 'lost') : i === mapIdx ? 'now' : 'next';
              return (
                <li key={i} className={`mx-hmap ${state}`} style={hue(p.map)}>
                  <span className="mx-hmap-name">{p.map}</span>
                  {res ? <b className="num">{res.score[humanIdx]}-{res.score[oppIdx]}</b>
                    : i === mapIdx ? <b className="num">R{(replay ?? round)?.number ?? sim.roundNumber}</b> : null}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mx-strip round-strip" aria-label="Round history. Select a round to replay it.">
          {Array.from({ length: slots }, (_, i) => {
            const n = i + 1;
            const r = shownRounds[i];
            const half = n === 12 || (n > 24 && (n - 24) % 3 === 0 && n !== slots);
            const mySide = sim.ctTeamFor(n) === humanIdx ? 'ct' : 't';
            if (!r) return <span key={n} className={`mx-slot ${mySide} ${half ? 'half' : ''} ${n === shownRounds.length + 1 ? 'next' : ''}`} aria-hidden="true" />;
            const won = r.winner === humanIdx;
            return (
              <button key={n} className={`${won ? (r.tTeam === humanIdx ? 't' : 'ct') : 'lost'} ${replay?.number === r.number ? 'on' : ''} ${half ? 'half' : ''}`}
                title={`Round ${r.number}: ${won ? 'won' : 'lost'}. Replay`} aria-label={`Replay round ${r.number}, ${won ? 'won' : 'lost'}`}
                onClick={() => { setReplay(r); setPaused(true); }} />
            );
          })}
        </div>
      </header>
      {replay && (
        <div className="mx-replay" role="status">
          <span className="mx-replay-dot" aria-hidden="true" />
          <span><b>Replay · Round {replay.number}</b> <span className="muted">The match is paused.</span></span>
          <button className="btn small primary" onClick={() => { setReplay(null); resume(); }}>Back to live</button>
        </div>
      )}
      {(replay ?? round) && (
        <RoundViewer
          round={(replay ?? round)!}
          teams={teams}
          map={plan[mapIdx]!.map}
          humanIdx={humanIdx}
          history={shownRounds}
          speed={speed}
          paused={replay ? false : paused}
          replay={!!replay}
          view={view}
          onViewError={() => chooseView('2d')}
          onDone={replay ? undefined : onRoundDone}
          onTogglePause={() => (paused ? resume() : setPaused(true))}
        />
      )}

      <div className="mx-controls" role="toolbar" aria-label="Match controls">
        <div className="mx-controls-group">
          <div className="seg compact" role="group" aria-label="View">
            <button aria-pressed={view === '3d'} onClick={() => chooseView('3d')} disabled={!webglAvailable()}>3D</button>
            <button aria-pressed={view === '2d'} onClick={() => chooseView('2d')}>Radar</button>
          </div>
          <div className="seg compact" role="group" aria-label="Speed">
            {[1, 2, 4].map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}x</button>)}
          </div>
        </div>
        <div className="mx-controls-info small" aria-live="polite">
          {planText && <span className="mx-plan-text">{planText}</span>}
          {lastLine && <span className="mx-comm">{lastLine}</span>}
        </div>
        <div className="mx-controls-group">
          {!locked && <button className="btn small mx-to" aria-label="Timeout" title={`${timeoutsLeft} timeout${timeoutsLeft === 1 ? '' : 's'} left`} onClick={() => { setDraft({ ...sim.tactics[humanIdx] }); setSheet('timeout'); setPaused(true); }} disabled={timeoutsLeft <= 0 || sim.finished}>
            Timeout<span className="mx-pips" aria-hidden="true">{[0, 1].map((i) => <i key={i} className={i < timeoutsLeft ? 'on' : ''} />)}</span>
          </button>}
          <button className="btn small" onClick={() => (paused ? resume() : setPaused(true))}>{paused ? 'Resume' : 'Pause'}</button>
          <button className="btn small ghost" onClick={skipMap}>Skip map</button>
        </div>
      </div>

      {sheet && (
        <div className="overlay">
          <div className="sheet mx-sheet" role="dialog" aria-label="Tactics">
            <div className="sheet-head">
              <div className="stack" style={{ gap: 2 }}>
                <span className="label">{sheet === 'timeout' ? `Round ${sim.roundNumber} · ${timeoutsLeft} timeout${timeoutsLeft === 1 ? '' : 's'} left` : sheet === 'halftime' ? 'Sides switch' : `Map ${mapIdx + 2} of ${plan.length}`}</span>
                <h2>{sheet === 'timeout' ? 'Tactical timeout' : sheet === 'halftime' ? 'Halftime' : `Next: ${plan[mapIdx + 1]?.map}`}</h2>
              </div>
              {sheet === 'timeout' && <button className="btn small ghost" onClick={() => { setSheet(null); resume(); }}>Cancel</button>}
            </div>
            <div className="mx-sheet-score">
              <span className={`mx-sheet-tag ${humanSide === 'T' ? 't-col' : 'ct-col'}`}>{human.tag}</span>
              <span className="num">{sheet === 'between' ? `${results.current[mapIdx]?.score[humanIdx]} : ${results.current[mapIdx]?.score[oppIdx]}` : `${sim.score[humanIdx]} : ${sim.score[oppIdx]}`}</span>
              <span className={`mx-sheet-tag ${oppSide === 'T' ? 't-col' : 'ct-col'}`}>{opp.tag}</span>
              <span className="small muted mx-sheet-score-note">
                {sheet === 'between' ? `${plan[mapIdx]!.map} is done. Maps ${ms[humanIdx]}-${ms[oppIdx]}.` : sheet === 'halftime' ? 'Change the plan for free.' : 'Changing plans here also gives a short momentum boost (bigger with an adaptable coach).'}
              </span>
            </div>
            <MiniReport sim={sim} humanIdx={humanIdx} />
            {!locked && <TacticsEditor tactics={draft} onChange={setDraft} />}
            <button className="btn primary block" onClick={() => {
              if (sheet === 'timeout') sim.callTimeout(humanIdx, draft);
              if (sheet === 'halftime') { sim.setTactics(humanIdx, draft); setHalftimeDone(true); }
              if (sheet === 'between') {
                const ni = mapIdx + 1;
                const nextSim = simFor(ni);
                if (!locked) nextSim.setTactics(humanIdx, draft);
                setMapIdx(ni);
                setHalftimeDone(false);
                setRound(null);
              }
              setSheet(null);
              if (sheet === 'between') setPaused(false);
              else resume();
            }}>{sheet === 'between' ? 'Start next map' : 'Back to the server'}</button>
          </div>
        </div>
      )}
    </>
  );
}

function MiniReport({ sim, humanIdx }: { sim: MapSim; humanIdx: TeamIdx }) {
  const mine = sim.rounds.filter((r) => r.tTeam === humanIdx);
  const theirs = sim.rounds.filter((r) => r.tTeam !== humanIdx);
  const theirT: Record<string, number> = {};
  for (const r of theirs) theirT[r.tactics.t] = (theirT[r.tactics.t] ?? 0) + 1;
  const theirCT: Record<string, number> = {};
  for (const r of mine) theirCT[r.tactics.ct] = (theirCT[r.tactics.ct] ?? 0) + 1;
  if (!sim.rounds.length) return null;
  const tWon = mine.filter((r) => r.winner === humanIdx).length;
  const ctWon = theirs.filter((r) => r.winner === humanIdx).length;
  return (
    <div className="mx-mini" aria-label="What they've shown">
      <div className="mx-mini-stats">
        <div className="stat"><span className="label t-col">Your T rounds</span><span className="v num">{tWon}<small>/ {mine.length}</small></span></div>
        <div className="stat"><span className="label ct-col">Your CT rounds</span><span className="v num">{ctWon}<small>/ {theirs.length}</small></span></div>
      </div>
      <div className="mx-mini-shown small">
        <span className="label">What they've shown</span>
        <span><span className="faint">T side</span> {Object.entries(theirT).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="chip t">{T_APPROACH_LABEL[k as TApproach]} ×{v}</span>)}{!Object.keys(theirT).length && <span className="faint">—</span>}</span>
        <span><span className="faint">CT side</span> {Object.entries(theirCT).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="chip ct">{CT_SETUP_LABEL[k as CTSetup]} ×{v}</span>)}{!Object.keys(theirCT).length && <span className="faint">—</span>}</span>
      </div>
    </div>
  );
}

// ---------------- Report ----------------

function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((e) => setW(Math.round(e[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** End-of-series report. With `pvp`, there is no prize money and the action bar holds the PvP actions. */
export function Report({ series, teams, humanIdx, onContinue, pvp }: { series: SeriesResult; teams: [TeamSnapshot, TeamSnapshot]; humanIdx: TeamIdx; onContinue: () => void; pvp?: { actions: ReactNode; note: string } }) {
  const { career: c } = useGame();
  const oppIdx: TeamIdx = humanIdx === 0 ? 1 : 0;
  const won = series.winner === humanIdx;
  const lines = seriesLines(series.maps);
  const names: [string, string] = [teams[0].tag, teams[1].tag];
  const mvp = [...lines].sort((a, b) => b.rating - a.rating)[0];
  const div = DIVISIONS[c.season.division]!;
  const [mi, setMi] = useState(0);
  const m = series.maps[mi] ?? series.maps[0]!;
  const reward = won ? div.winReward : Math.round(div.winReward * 0.4);
  const reasons = explainMap(m, humanIdx, names);
  const totalRounds = series.maps.reduce((s, x) => s + x.rounds.length, 0);
  const oppName = pvp ? teams[oppIdx].name : teamName(c, teams[oppIdx].id);

  return (
    <>
      <section className={`mx-result ${won ? 'won' : 'lost'}`} aria-label="Result">
        <div className="mx-result-main">
          <span className={`mx-verdict ${won ? 'good' : 'bad'}`}>{won ? 'Victory' : 'Defeat'}</span>
          <div className="mx-result-score">
            <div className="mx-result-team">
              <Crest name={teams[humanIdx].name} tag={teams[humanIdx].tag} mine size={56} className="mx-crest" />
              <span className="mx-card-tag t-col">{teams[humanIdx].tag}</span>
              <span className="mx-card-name">{teams[humanIdx].name}</span>
            </div>
            <span className="mx-result-num num" aria-label={`${series.format === 'bo1' ? 'Rounds' : 'Maps'} ${series.format === 'bo1' ? series.maps[0]!.score[humanIdx] : series.mapScore[humanIdx]} to ${series.format === 'bo1' ? series.maps[0]!.score[oppIdx] : series.mapScore[oppIdx]}`}>
              <b className={won ? '' : 'dim'}>{series.format === 'bo1' ? series.maps[0]!.score[humanIdx] : series.mapScore[humanIdx]}</b>
              <i>–</i>
              <b className={won ? 'dim' : ''}>{series.format === 'bo1' ? series.maps[0]!.score[oppIdx] : series.mapScore[oppIdx]}</b>
            </span>
            <div className="mx-result-team right">
              <Crest name={teams[oppIdx].name} tag={teams[oppIdx].tag} size={56} className="mx-crest" />
              <span className="mx-card-tag ct-col">{teams[oppIdx].tag}</span>
              <span className="mx-card-name">{oppName}</span>
            </div>
          </div>
          <div className="mx-result-maps">
            {series.maps.map((x, i) => (
              <span key={i} className={`mx-mapchip ${x.winner === humanIdx ? 'won' : 'lost'}`} style={art(x.map)}>
                {x.map} <b className="num">{x.score[humanIdx]}-{x.score[oppIdx]}</b>
              </span>
            ))}
            <span className="small faint">{totalRounds} rounds</span>
          </div>
        </div>
        {mvp && (
          <div className="mx-mvp">
            <span className="label">Player of the match</span>
            <div className="mx-mvp-id">
              <Avatar seed={teams[mvp.team].players.find((p) => p.id === mvp.id)?.playerId ?? mvp.id} size={52} accent={mvp.team === humanIdx ? '#f0a33a' : '#5aa9e6'} />
              <div className="stack" style={{ gap: 0, minWidth: 0 }}>
                <span className="mx-mvp-name">{mvp.handle}</span>
                <span className="small faint">{teams[mvp.team].tag}</span>
              </div>
              <span className="mx-mvp-rating num">{mvp.rating.toFixed(2)}</span>
            </div>
            <div className="mx-mvp-stats num small">
              <span><span className="faint">K-D</span> {mvp.kills}-{mvp.deaths}</span>
              <span><span className="faint">ADR</span> {(mvp.damage / mvp.rounds).toFixed(0)}</span>
              <span><span className="faint">KAST</span> {Math.round((mvp.kastRounds / mvp.rounds) * 100)}%</span>
            </div>
          </div>
        )}
      </section>

      {series.maps.length > 1 && (
        <div className="mx-maptabs">
          <span className="label">Map breakdown</span>
          <div className="seg compact" role="group" aria-label="Map breakdown">
            {series.maps.map((x, i) => <button key={i} aria-pressed={mi === i} onClick={() => setMi(i)}>{x.map} {x.score[humanIdx]}-{x.score[oppIdx]}</button>)}
          </div>
        </div>
      )}

      <div className="mx-report-grid">
        <div className="mx-col">
          <Scoreboard lines={lines} teams={teams} humanIdx={humanIdx} mvpId={mvp?.id} series={series} />
          <RoundTimeline key={`tl${mi}`} map={m} humanIdx={humanIdx} tags={names} />
        </div>
        <div className="mx-col">
          <section className="panel" aria-label={`Why it went this way on ${m.map}`}>
            <div className="panel-head"><h2>Why it went this way</h2><span className="small faint">{m.map}</span></div>
            <ul className="mx-reasons">
              {reasons.map((r, j) => <li key={j} className={r.good ? 'is-good' : 'is-bad'}><span className="mx-reason-ico" aria-label={r.good ? 'Strength' : 'Weakness'}>{r.good ? '+' : '−'}</span>{r.text}</li>)}
            </ul>
          </section>
          <KeyMoments map={m} humanIdx={humanIdx} names={names} />
          <AdvicePanel series={series} humanIdx={humanIdx} teams={teams} />
        </div>
      </div>

      {pvp ? (
        <div className="mx-actionbar">
          <span className="mx-actionbar-text small faint">{pvp.note}</span>
          <div className="mx-actionbar-btns">{pvp.actions}</div>
        </div>
      ) : (
        <div className="mx-actionbar">
          <span className="mx-actionbar-text small"><span className="faint">Prize money</span> <span className="coins"><span className="coin-dot" aria-hidden="true" />+{reward}</span></span>
          <div className="mx-actionbar-btns">
            <button className="btn primary" onClick={onContinue}>Continue · +{reward} coins</button>
          </div>
        </div>
      )}
    </>
  );
}

function Scoreboard({ lines, teams, humanIdx, mvpId, series }: { lines: SeriesLine[]; teams: [TeamSnapshot, TeamSnapshot]; humanIdx: TeamIdx; mvpId?: string; series: SeriesResult }) {
  const [detail, setDetail] = useState<'core' | 'impact'>('core');
  const oppIdx: TeamIdx = humanIdx === 0 ? 1 : 0;
  const table = (team: TeamIdx) => {
    const won = series.winner === team;
    return (
      <table className={`tbl mx-sb ${team === humanIdx ? 'me' : 'them'}`}>
        <thead>
          {detail === 'core' ? (
            <tr><th className="mx-sb-team"><span className={team === humanIdx ? 't-col' : 'ct-col'}>{teams[team].tag}</span> <span className={`chip ${won ? 'good' : ''}`}>{won ? 'Won' : 'Lost'}</span></th><th>K-D</th><th className="mx-hide-s">+/-</th><th>ADR</th><th>KAST</th><th>Rating</th></tr>
          ) : (
            <tr><th className="mx-sb-team"><span className={team === humanIdx ? 't-col' : 'ct-col'}>{teams[team].tag}</span> <span className={`chip ${won ? 'good' : ''}`}>{won ? 'Won' : 'Lost'}</span></th><th>HS%</th><th>Open</th><th>Clutch</th><th className="mx-hide-s">Multi</th><th>Util</th></tr>
          )}
        </thead>
        <tbody>
          {lines.filter((l) => l.team === team).sort((a, b) => b.rating - a.rating).map((l) => {
            const diff = l.kills - l.deaths;
            return detail === 'core' ? (
              <tr key={l.id}>
                <td className="name"><PlayerTag id={l.id} handle={l.handle} teams={teams} team={team} humanIdx={humanIdx} mvp={l.id === mvpId} /></td>
                <td>{l.kills}-{l.deaths}</td>
                <td className={`mx-hide-s ${diff > 0 ? 'good' : diff < 0 ? 'bad' : 'faint'}`}>{diff > 0 ? '+' : ''}{diff}</td>
                <td>{(l.damage / l.rounds).toFixed(0)}</td>
                <td>{Math.round((l.kastRounds / l.rounds) * 100)}%</td>
                <td><span className="mx-rating"><span className={l.rating >= 1.1 ? 'good' : l.rating < 0.9 ? 'bad' : ''}>{l.rating.toFixed(2)}</span><i aria-hidden="true"><b className={l.rating >= 1.1 ? 'good' : l.rating < 0.9 ? 'bad' : ''} style={{ width: `${Math.max(4, Math.min(100, ((l.rating - 0.4) / 1.2) * 100))}%` }} /></i></span></td>
              </tr>
            ) : (
              <tr key={l.id}>
                <td className="name"><PlayerTag id={l.id} handle={l.handle} teams={teams} team={team} humanIdx={humanIdx} mvp={l.id === mvpId} /></td>
                <td>{l.kills ? Math.round((l.headshots / l.kills) * 100) : 0}%</td>
                <td>{l.openingKills}-{l.openingDeaths}</td>
                <td>{l.clutchesWon}</td>
                <td className="mx-hide-s">{l.multiKillRounds}</td>
                <td>{(l.utilityDamage / l.rounds).toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };
  return (
    <section className="panel mx-board" aria-label="Scoreboard">
      <div className="panel-head">
        <h2>Scoreboard</h2>
        <div className="seg compact" role="group" aria-label="Scoreboard columns">
          <button aria-pressed={detail === 'core'} onClick={() => setDetail('core')}>Core</button>
          <button aria-pressed={detail === 'impact'} onClick={() => setDetail('impact')}>Impact</button>
        </div>
      </div>
      {table(humanIdx)}
      {table(oppIdx)}
      <p className="small faint">{detail === 'core' ? "Rating is this game's own match rating (about 1.00 on average), not an official HLTV rating." : 'Open = opening duels won-lost. Multi = rounds with 2+ kills. Util = utility damage per round.'}</p>
    </section>
  );
}

const BUY_NAME = { pistol: 'Pistol', eco: 'Eco', force: 'Force', full: 'Full buy' } as const;

function KeyMoments({ map, humanIdx, names }: { map: MapResult; humanIdx: TeamIdx; names: [string, string] }) {
  const moments = keyMoments(map, humanIdx, names);
  const rec = buyRecord(map, humanIdx);
  return (
    <section className="panel" aria-label={`Key moments on ${map.map}`}>
      <div className="panel-head"><h2>Key moments</h2><span className="small faint">{map.map}</span></div>
      {moments.length > 0 ? (
        <ol className="mx-moments">
          {moments.map((k, i) => (
            <li key={i} className={k.good ? 'is-good' : 'is-bad'}>
              <span className="mx-moment-r num">R{k.round}</span>
              <span className="mx-moment-dot" aria-hidden="true" />
              <span className={k.good ? '' : 'muted'}>{k.text}</span>
            </li>
          ))}
        </ol>
      ) : <p className="small muted">A tight, even map without standout swings.</p>}
      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Rounds won by buy</span>
        <div className="mx-buys">
          {(['pistol', 'eco', 'force', 'full'] as const).map((b) => {
            const pct = rec[b].played ? rec[b].won / rec[b].played : 0;
            return (
              <div key={b} className="mx-buy">
                <span className="small faint">{BUY_NAME[b]}</span>
                <span className="num mx-buy-v">{rec[b].won}<small>/{rec[b].played}</small></span>
                <Bar value={pct * 100} tone={!rec[b].played ? '' : pct >= 0.5 ? 'good' : 'bad'} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Economy chart (each side's equipment value per round, mirrored) plus the round history row. */
function RoundTimeline({ map, humanIdx, tags }: { map: MapResult; humanIdx: TeamIdx; tags: [string, string] }) {
  const [sel, setSel] = useState<number | null>(null);
  const [wrap, width] = useWidth<HTMLDivElement>();
  const oppIdx: TeamIdx = humanIdx === 0 ? 1 : 0;
  const n = map.rounds.length;
  const W = Math.max(280, width || 600);
  const H = W < 520 ? 176 : 216;
  const padL = 38, padR = 6, padT = 10, padB = 22;
  const plotW = W - padL - padR;
  const mid = padT + (H - padT - padB) / 2;
  const half = mid - padT - 2;
  const bw = plotW / n;
  const maxRaw = Math.max(...map.rounds.flatMap((r) => r.equipment), 1);
  const maxEq = Math.ceil(maxRaw / 10000) * 10000;
  const k = (v: number) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`;
  const r = sel !== null ? map.rounds[sel] : null;
  const handle = (id?: string) => map.lines.find((l) => l.id === id)?.handle ?? '—';
  const labelEvery = n > 30 ? 6 : W < 520 ? 4 : 3;
  const myWins = map.rounds.filter((x) => x.winner === humanIdx).length;
  return (
    <section className="panel" aria-label={`Rounds on ${map.map}`}>
      <div className="panel-head"><h2>Rounds and economy</h2><span className="small faint">{map.map} · select a round</span></div>
      <div className="mx-econ-wrap" ref={wrap}>
        <svg className="econ mx-econ" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Equipment value per round on ${map.map}. ${tags[humanIdx]} above the line, ${tags[oppIdx]} below. ${tags[humanIdx]} won ${myWins} of ${n} rounds.`}>
          {[1, 0.5].map((f) => (
            <line key={`a${f}`} x1={padL} x2={W - padR} y1={mid - half * f} y2={mid - half * f} stroke="var(--line-soft)" />
          ))}
          {[1, 0.5].map((f) => (
            <line key={`b${f}`} x1={padL} x2={W - padR} y1={mid + half * f} y2={mid + half * f} stroke="var(--line-soft)" />
          ))}
          <text x={padL - 6} y={mid - half + 4} className="mx-ax" textAnchor="end">{k(maxEq)}</text>
          <text x={padL - 6} y={mid - half / 2 + 4} className="mx-ax" textAnchor="end">{k(maxEq / 2)}</text>
          <text x={padL - 6} y={mid + half / 2 + 4} className="mx-ax" textAnchor="end">{k(maxEq / 2)}</text>
          <text x={padL - 6} y={mid + half + 4} className="mx-ax" textAnchor="end">{k(maxEq)}</text>
          {map.rounds.map((rd, i) => {
            const mine = (rd.equipment[humanIdx] / maxEq) * half;
            const theirs = (rd.equipment[oppIdx] / maxEq) * half;
            const won = rd.winner === humanIdx;
            const x = padL + i * bw;
            const bwi = Math.max(2, bw * 0.72);
            const off = (bw - bwi) / 2;
            const dim = sel !== null && sel !== i;
            return (
              <g key={i} onClick={() => setSel(sel === i ? null : i)} className={`mx-econ-r ${sel === i ? 'on' : ''}`}>
                <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
                {sel === i && <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="var(--hover)" rx="2" />}
                <rect x={x + off} y={mid - mine - 1} width={bwi} height={Math.max(1, mine)} rx="1.5" fill="var(--t)" opacity={(won ? 1 : 0.32) * (dim ? 0.5 : 1)} />
                <rect x={x + off} y={mid + 1} width={bwi} height={Math.max(1, theirs)} rx="1.5" fill="var(--ct)" opacity={(!won ? 1 : 0.32) * (dim ? 0.5 : 1)} />
                <title>{`Round ${rd.number}: ${won ? `${tags[humanIdx]} won` : `${tags[oppIdx]} won`}. $${rd.equipment[humanIdx].toLocaleString('en-US')} vs $${rd.equipment[oppIdx].toLocaleString('en-US')}`}</title>
              </g>
            );
          })}
          <line x1={padL} x2={W - padR} y1={mid} y2={mid} stroke="var(--line-strong)" />
          {n > 12 && (
            <>
              <line x1={padL + 12 * bw} x2={padL + 12 * bw} y1={padT - 4} y2={H - padB + 2} stroke="var(--ink-3)" strokeDasharray="3 3" />
              <text x={padL + 12 * bw + 4} y={padT + 6} className="mx-ax">HALF</text>
            </>
          )}
          {n > 24 && <line x1={padL + 24 * bw} x2={padL + 24 * bw} y1={padT - 4} y2={H - padB + 2} stroke="var(--ink-3)" strokeDasharray="3 3" />}
          {map.rounds.map((rd, i) => (rd.number === 1 || rd.number % labelEvery === 0) && (
            <text key={`l${i}`} x={padL + i * bw + bw / 2} y={H - 6} className="mx-ax" textAnchor="middle">{rd.number}</text>
          ))}
        </svg>
      </div>
      <div className="mx-hist" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, marginLeft: padL, marginRight: padR }} aria-label="Round history">
        {map.rounds.map((rd, i) => (
          <button key={i} className={`${rd.winner === humanIdx ? 'won' : 'lost'} ${sel === i ? 'on' : ''}`} onClick={() => setSel(sel === i ? null : i)}
            aria-label={`Round ${rd.number}, ${rd.winner === humanIdx ? 'won' : 'lost'}`} aria-pressed={sel === i} />
        ))}
      </div>
      <div className="mx-econ-legend small">
        <span><i className="t" />{tags[humanIdx]} equipment</span>
        <span><i className="ct" />{tags[oppIdx]} equipment</span>
        <span className="faint">Faded bar = lost that round</span>
      </div>
      {r ? (
        <div className="mx-round-detail small">
          <div className="row spread wrap">
            <strong>Round {r.number} · {r.winner === humanIdx ? <span className="good">won</span> : <span className="bad">lost</span>} · {r.reason === 'bomb' ? 'bomb exploded' : r.reason === 'defuse' ? 'defused' : r.reason === 'saved' ? 'opponent saved' : r.reason === 'time' ? 'time ran out' : 'elimination'} on {r.site}</strong>
            <span className="num faint">{r.score[humanIdx]}-{r.score[oppIdx]}</span>
          </div>
          <div className="mx-rd-grid">
            <span><span className="faint">Buys</span> {BUY_NAME[r.buys[humanIdx]]} vs {BUY_NAME[r.buys[oppIdx]]}</span>
            <span className="num"><span className="faint">Value</span> ${r.equipment[humanIdx].toLocaleString('en-US')} vs ${r.equipment[oppIdx].toLocaleString('en-US')}</span>
            <span><span className="faint">Plans</span> T {T_APPROACH_LABEL[r.tactics.t]} vs CT {CT_SETUP_LABEL[r.tactics.ct]}{r.tactics.stackSite ? ` ${r.tactics.stackSite}` : ''}</span>
            <span><span className="faint">Round</span> {r.kills.length} kills · {r.utility.length} grenades · MVP {handle(r.mvpId)}</span>
          </div>
          {r.commentary.slice(0, 3).map((t, j) => <p key={j} className="muted">{t}</p>)}
        </div>
      ) : null}
    </section>
  );
}

/** Next-week advice from the match numbers plus fatigue, chemistry and sharpness. */
function AdvicePanel({ series, humanIdx, teams }: { series: SeriesResult; humanIdx: TeamIdx; teams: [TeamSnapshot, TeamSnapshot] }) {
  const { world, career: c } = useGame();
  const lineupCards = c.lineup.map((s) => c.cards.find((x) => x.cardId === s.cardId)!).filter(Boolean);
  const name = (id: string) => world.profiles.get(id)?.record.handle ?? id;
  const lines = seriesLines(series.maps).filter((l) => l.team === humanIdx).sort((a, b) => b.rating - a.rating);
  const tips = trainingAdvice(series.maps, humanIdx, {
    avgFatigue: lineupCards.reduce((s, x) => s + x.fatigue, 0) / Math.max(1, lineupCards.length) + 8 * series.maps.length,
    chemistry: c.chemistry,
    tired: lineupCards.filter((x) => x.fatigue + 8 * series.maps.length >= 60).map((x) => name(x.playerId)),
    lowSharpness: lineupCards.filter((x) => x.sharpness < 45).map((x) => name(x.playerId)),
    prepared: teams[humanIdx].prepBonus > 0,
  });
  const over = lines.filter((l) => l.rating >= 1.15);
  const under = lines.filter((l) => l.rating <= 0.85);
  return (
    <section className="panel mx-next" aria-label="What to do next">
      <div className="panel-head"><h2>What to do next</h2><span className="small faint">For next week's training</span></div>
      {(over.length > 0 || under.length > 0) && (
        <div className="mx-form">
          {over.length > 0 && <div><span className="label good">Stood out</span><span className="small">{over.map((l) => <span key={l.id} className="mx-form-p">{l.handle} <b className="num good">{l.rating.toFixed(2)}</b></span>)}</span></div>}
          {under.length > 0 && <div><span className="label bad">Below par</span><span className="small">{under.map((l) => <span key={l.id} className="mx-form-p">{l.handle} <b className="num bad">{l.rating.toFixed(2)}</b></span>)}</span></div>}
        </div>
      )}
      {tips.length ? (
        <ul className="mx-tips">{tips.map((t, i) => <li key={i}><span className="mx-tip-act">{t.activity}</span><span className="small">{t.text}</span></li>)}</ul>
      ) : <p className="small muted">No clear weakness this time. Keep the plan and protect fatigue.</p>}
      <p className="small faint">Fatigue includes this match. Advice comes from this match's numbers and your squad's condition.</p>
    </section>
  );
}

function PlayerTag({ id, handle, teams, team, humanIdx, mvp }: { id: string; handle: string; teams: [TeamSnapshot, TeamSnapshot]; team: TeamIdx; humanIdx: TeamIdx; mvp?: boolean }) {
  const { career, openPlayer } = useGame();
  const mp = teams[team].players.find((p) => p.id === id);
  const open = mp ? () => openPlayer(career.cards.some((x) => x.cardId === mp.id) ? mp.id : null, mp.playerId) : undefined;
  return <button className="ptag ptag-btn" onClick={open} disabled={!open} aria-label={`Open ${handle}'s profile`}><Avatar seed={mp?.playerId ?? id} size={24} accent={team === humanIdx ? '#f0a33a' : '#5aa9e6'} /><span>{handle}</span>{mvp && <span className="mx-mvp-badge" title="Player of the match">MVP</span>}</button>;
}
