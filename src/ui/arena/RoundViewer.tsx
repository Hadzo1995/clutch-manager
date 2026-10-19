/**
 * Spectator view of one round: the 3D (or 2D radar) stage, a broadcast-style
 * HUD (score bug, clock, bomb, kill feed, team panels with live HP, weapons,
 * armour and economy) and playback controls (play/pause, scrub, camera).
 *
 * The stage and the HUD both read the same RoundTimeline at the same time t,
 * so what the panels say always matches what the map shows.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoundResult, TeamIdx } from '../../engine/match';
import type { TeamSnapshot } from '../../engine/team';
import type { MapName } from '../../engine/types';
import { geometryFor } from '../../maps';
import { Avatar } from '../avatar/Avatar';
import { Crest } from '../crest';
import { RoleIcon, useGame } from '../common';
import { ROLE_LABEL } from '../../engine/types';
import type { UtilityKind } from '../../engine/match';
import { BOMB_SECONDS, aliveCount, bombAt, buildTimeline, clockAt, clutchOf, hpAt, isSpotted, weaponAt } from './timeline';
import type { PlayerTrack, RoundTimeline } from './timeline';
import { matchAudio, matchSoundOn, setMatchSound } from './matchAudio';
import { RoundStory, TacticsCard } from './RoundStory';
import { Viewer2D } from './Viewer2D';
import { Viewer3D } from './Viewer3D';
import type { CameraMode, Tilt } from './Viewer3D';

export interface RoundViewerProps {
  round: RoundResult;
  teams: [TeamSnapshot, TeamSnapshot];
  map: MapName;
  humanIdx: TeamIdx;
  /** Rounds already played on this map, for the K-D column. */
  history: RoundResult[];
  speed: number;
  /** Paused by the match flow (timeout, halftime, between maps). */
  paused: boolean;
  view: '3d' | '2d';
  onViewError: () => void;
  /** Live rounds call this once when the round has played out. Replays don't. */
  onDone?: () => void;
  replay?: boolean;
  onTogglePause?: () => void;
}

const BUY_LABEL: Record<string, string> = { pistol: 'Pistol', eco: 'Eco', force: 'Force buy', full: 'Full buy' };

function cssColors() {
  const css = getComputedStyle(document.documentElement);
  return { t: css.getPropertyValue('--t').trim() || '#f0a33a', ct: css.getPropertyValue('--ct').trim() || '#5aa9e6' };
}

export function RoundViewer(props: RoundViewerProps) {
  const { round, teams, map, humanIdx, history, speed, paused, view, onViewError, onDone, replay } = props;
  const geo = useMemo(() => geometryFor(map), [map]);
  const tl = useMemo<RoundTimeline>(() => buildTimeline(round, teams, geo), [round, teams, geo]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const mini = useRef<Viewer2D | null>(null);
  const [showMini, setShowMini] = useState<boolean>(() => { try { return localStorage.getItem('clutch-manager.minimap') !== 'off'; } catch { return true; } });
  const stage = useRef<Viewer3D | Viewer2D | null>(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [localPaused, setLocalPaused] = useState(false);
  const [camMode, setCamMode] = useState<CameraMode>('overview');
  const [tilt, setTilt] = useState<Tilt>(() => { try { return localStorage.getItem('clutch-manager.tilt') === 'top' ? 'top' : 'iso'; } catch { return 'iso'; } });
  const [followId, setFollowId] = useState<string | null>(null);
  const [labels, setLabels] = useState(true);
  const [vision, setVision] = useState<boolean>(() => { try { return localStorage.getItem('clutch-manager.vision') !== 'off'; } catch { return true; } });
  const [radar, setRadar] = useState<boolean>(() => { try { return localStorage.getItem('clutch-manager.soundradar') !== 'off'; } catch { return true; } });
  const doneFired = useRef(false);
  const tlRef = useRef(tl); tlRef.current = tl;
  const followRef = useRef(followId); followRef.current = followId;
  const labelsRef = useRef(labels); labelsRef.current = labels;
  const visionRef = useRef(vision); visionRef.current = vision;
  const radarRef = useRef(radar); radarRef.current = radar;
  const live = useRef({ speed, paused, localPaused, onDone, replay, duration: tl.duration });
  live.current = { speed, paused, localPaused, onDone, replay, duration: tl.duration };

  // Stage lifetime: one renderer per map and view.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (view === '3d') {
        const v = new Viewer3D(canvas, geo, cssColors(), {
          onCameraMode: (m) => setCamMode(m),
          onPick: (id) => setFollowId(id),
          onContextLost: () => onViewError(),
        });
        v.setTilt(tilt);
        v.resetView(true);
        stage.current = v;
      } else {
        stage.current = new Viewer2D(canvas, geo, cssColors());
      }
      stage.current.setTimeline(tlRef.current);
      stage.current.followId = followRef.current;
      stage.current.showLabels = labelsRef.current;
      stage.current.showVision = visionRef.current;
      stage.current.showSound = radarRef.current;
      // Carry a follow chosen in radar view over to the 3D camera.
      if (stage.current instanceof Viewer3D) {
        if (followRef.current && tlRef.current.byId.has(followRef.current)) stage.current.follow(followRef.current);
        else setCamMode('overview');
      }
    } catch {
      try { stage.current?.dispose(); } catch { /* half-built viewer */ }
      stage.current = null;
      onViewError();
      return;
    }
    return () => { stage.current?.dispose(); stage.current = null; };
  }, [geo, view]);

  // Corner radar while watching in 3D.
  useEffect(() => {
    const c = miniRef.current;
    if (!c || view !== '3d' || !showMini || camMode === 'overview') return;
    const m = new Viewer2D(c, geo, cssColors());
    m.mini = true; m.showLabels = false; m.showVision = false; m.showSound = radarRef.current;
    m.setTimeline(tlRef.current);
    m.followId = followRef.current;
    mini.current = m;
    return () => { m.dispose(); mini.current = null; };
  }, [geo, view, showMini, camMode === 'overview']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('clutch-manager.minimap', showMini ? 'on' : 'off'); } catch { /* storage blocked */ } }, [showMini]); // eslint-disable-line react-hooks/exhaustive-deps

  // New round: rewind before paint (so the next round's result never flashes),
  // and come back to the same moment of the live round after watching a replay.
  const savedLive = useRef<{ from: RoundTimeline; n: number; t: number; done: boolean } | null>(null);
  const [seen, setSeen] = useState({ tl, n: round.number, replay: !!replay });
  if (tl !== seen.tl) {
    if (!seen.replay && savedLive.current?.from !== seen.tl) savedLive.current = { from: seen.tl, n: seen.n, t: tRef.current, done: doneFired.current };
    const back = !replay && savedLive.current?.n === round.number ? savedLive.current : null;
    tRef.current = back ? back.t : 0;
    doneFired.current = back ? back.done : false;
    setSeen({ tl, n: round.number, replay: !!replay });
    setT(tRef.current);
    setLocalPaused(false);
    if (followId && !tl.byId.has(followId)) setFollowId(null);
  }
  const firstTl = useRef(true);
  useEffect(() => {
    if (firstTl.current) { firstTl.current = false; return; }
    stage.current?.setTimeline(tl);
    mini.current?.setTimeline(tl);
  }, [tl]);

  // Observer auto-switch: a moment after the followed player dies, move to a living teammate
  // (or anyone alive), like a broadcast observer. Only while playing, not while scrubbing paused.
  const sawAlive = useRef<string | null>(null);
  useEffect(() => {
    if (!followId) return;
    const p = tl.byId.get(followId);
    if (!p) return;
    if (p.deathT === null || p.deathT > t) { sawAlive.current = followId; return; }
    // Only when we watched them die; picking a dead player on purpose keeps them.
    // Not when the user has taken the 3D camera elsewhere (panned, double-clicked out).
    if (!playing || (view === '3d' && camMode !== 'follow') || sawAlive.current !== followId || t - p.deathT < 1.6 || t >= round.endTime) return;
    const alive = (q: typeof p) => q.deathT === null || q.deathT > t;
    const next = tl.players.find((q) => q.team === p.team && alive(q)) ?? tl.players.find(alive);
    setFollowId(next ? next.id : null);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mini.current) mini.current.followId = followId; }, [followId]);
  useEffect(() => { if (stage.current) stage.current.followId = followId; if (stage.current instanceof Viewer3D && followId) stage.current.follow(followId); }, [followId]);
  useEffect(() => { if (stage.current) stage.current.showLabels = labels; }, [labels]);
  useEffect(() => { if (stage.current) stage.current.showVision = vision; try { localStorage.setItem('clutch-manager.vision', vision ? 'on' : 'off'); } catch { /* private mode */ } }, [vision]);
  useEffect(() => {
    if (stage.current) stage.current.showSound = radar;
    if (mini.current) mini.current.showSound = radar;
    try { localStorage.setItem('clutch-manager.soundradar', radar ? 'on' : 'off'); } catch { /* private mode */ }
  }, [radar]);

  // Frame loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      const halted = L.paused || L.localPaused;
      if (!halted) tRef.current = Math.min(L.duration, tRef.current + dt * L.speed);
      const tt = tRef.current;
      stage.current?.render(tt);
      mini.current?.render(tt);
      if (now - lastHud > 90 || halted) { lastHud = now; setT(tt); }
      if (tt >= L.duration && !L.replay && !doneFired.current) { doneFired.current = true; setT(tt); L.onDone?.(); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seek = (v: number) => { tRef.current = Math.max(0, Math.min(tl.duration, v)); setT(tRef.current); };
  const playing = !(paused || localPaused) && t < tl.duration;
  const togglePlay = () => {
    if (t >= tl.duration - 0.01) { seek(0); setLocalPaused(false); return; }
    if (replay || !props.onTogglePause || localPaused) setLocalPaused((p) => !p);
    else props.onTogglePause();
  };

  // Keyboard: Space play/pause, 1-5 follow your players, 6-0 the opponents, Esc overview, V vision, N name tags, R sound radar, M minimap.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (e.repeat) return;
    // Ignore keys while a dialog that doesn't hold this viewer is open (the live match itself sits in one).
    const me = canvasRef.current;
    if ([...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some((d) => !me || !d.contains(me))) return;
    const k = e.key.toLowerCase();
    const inViewer = !!(el && el.closest('.tv'));
    if (k === ' ' && (!el || el.tagName !== 'BUTTON' || inViewer)) { e.preventDefault(); togglePlay(); return; }
    if (k === 'escape') { setFollowId(null); setCamera('overview'); return; }
    if (k === 'v') { setVision((x) => !x); return; }
    if (k === 'n') { setLabels((x) => !x); return; }
    if (k === 'r') { setRadar((x) => !x); return; }
    if (k === 'm' && view === '3d') { setShowMini((x) => !x); return; }
    const d = '1234567890'.indexOf(k);
    if (d >= 0) {
      const team = d < 5 ? humanIdx : (humanIdx === 0 ? 1 : 0);
      const p = tl.players.filter((q) => q.team === team)[d % 5];
      if (p) { setFollowId(p.id); setCamMode('follow'); }
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const setCamera = (m: CameraMode) => {
    const s = stage.current;
    if (s instanceof Viewer3D) {
      if (m === 'follow' && !followId) {
        const first = tl.players.find((p) => p.team === humanIdx && (p.deathT === null || p.deathT > tRef.current));
        if (first) setFollowId(first.id);
      }
      if (m === 'overview') setFollowId(null);
      s.setMode(m);
    }
    setCamMode(m);
  };
  const chooseTilt = (v: Tilt) => {
    setTilt(v);
    try { localStorage.setItem('clutch-manager.tilt', v); } catch { /* storage blocked */ }
    if (stage.current instanceof Viewer3D) stage.current.setTilt(v);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (stage.current instanceof Viewer2D) setFollowId(stage.current.pick(e.clientX, e.clientY, tRef.current));
  };

  const oppIdx: TeamIdx = humanIdx === 0 ? 1 : 0;
  const clock = clockAt(tl, t);
  const bomb = bombAt(tl, t);
  const over = t >= round.endTime;
  const before: [number, number] = [round.score[0] - (round.winner === 0 ? 1 : 0), round.score[1] - (round.winner === 1 ? 1 : 0)];
  const score = over ? round.score : before;
  const sideOf = (ti: TeamIdx) => (round.tTeam === ti ? 'T' : 'CT');
  const handle = (id?: string) => tl.byId.get(id ?? '')?.handle ?? '';
  const feed = tl.feed.filter((f) => f.t <= t && t - f.t < 9).slice(-5);
  const wonClutch = useMemo(() => clutchOf(tl, round.winner), [tl, round.winner]);
  // A lone survivor against one or more opponents: call out the clutch like a broadcast would.
  const clutch = (() => {
    if (over) return null;
    const a0 = aliveCount(tl, 0, t), a1 = aliveCount(tl, 1, t);
    const lone: TeamIdx | null = a0 === 1 && a1 >= 1 ? 0 : a1 === 1 && a0 >= 1 ? 1 : null;
    if (lone === null) return null;
    const p = tl.players.find((q) => q.team === lone && (q.deathT === null || q.deathT > t));
    return p ? { name: p.handle, side: p.side, vs: lone === 0 ? a1 : a0 } : null;
  })();

  // Sound: fire the events the playhead crossed since the last HUD tick (not on seeks or big jumps).
  const [sound, setSound] = useState(matchSoundOn);
  const lastT = useRef(0);
  const beeps = useMemo(() => {
    const out: number[] = [];
    if (round.plantTime === undefined) return out;
    for (let x = 0; x < BOMB_SECONDS; x += Math.max(0.12, 1 - 0.9 * (x / BOMB_SECONDS))) out.push(round.plantTime + x);
    return out.filter((b) => b < round.endTime);
  }, [round]);
  useEffect(() => {
    const prev = lastT.current;
    lastT.current = t;
    const dt = t - prev;
    if (!sound || dt <= 0 || dt > 1.5 || !(playing)) return;
    const a = matchAudio();
    a.resume();
    const crossed = (x: number) => prev < x && x <= t;
    if (crossed(0.05)) a.roundStart();
    for (const k of round.kills) if (crossed(k.t)) { a.shot(k.weapon, k.killerTeam === humanIdx ? -0.35 : 0.35); if (k.headshot) a.headshot(); }
    if (round.plantTime !== undefined && crossed(round.plantTime)) a.plant();
    else if (beeps.some(crossed)) a.beep();
    if (crossed(round.endTime)) {
      if (round.reason === 'bomb') a.explode();
      else if (round.reason === 'defuse') a.defuse();
      a.roundEnd(round.winner === humanIdx);
    }
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSound = () => { const v = !sound; setSound(v); setMatchSound(v); if (v) matchAudio().resume(); };

  // Map K-D before this round, plus this round so far.
  const kd = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const r of history) {
      if (r.number >= round.number) continue;
      for (const k of r.kills) {
        const a = m.get(k.killerId) ?? [0, 0]; a[0]++; m.set(k.killerId, a);
        const b = m.get(k.victimId) ?? [0, 0]; b[1]++; m.set(k.victimId, b);
      }
    }
    return m;
  }, [history, round.number]);

  const teamPanel = (ti: TeamIdx) => {
    const side = sideOf(ti);
    const players = tl.players.filter((p) => p.team === ti);
    const alive = aliveCount(tl, ti, t);
    return (
      <section className={`tv-team ${side === 'T' ? 't' : 'ct'} ${ti === humanIdx ? 'mine' : ''}`} key={ti} aria-label={`${teams[ti].name}, ${side === 'T' ? 'Terrorists' : 'Counter-terrorists'}`}>
        <header className="tv-team-head">
          <span className={`tv-side ${side === 'T' ? 't' : 'ct'}`}>{side}</span>
          <span className="tv-tag">{teams[ti].tag}</span>
          <span className="tv-alive num" aria-label={`${alive} of ${players.length} alive`}>{alive}<span className="faint">/{players.length}</span></span>
          <span className="tv-eco">
            <span className={`tv-buy ${round.buys[ti]}`}>{BUY_LABEL[round.buys[ti]]}</span>
            <span className="num">${round.equipment[ti].toLocaleString('en-US')}</span>
          </span>
        </header>
        <div className="tv-rows">
          {players.map((p) => <PlayerRow key={p.id} p={p} t={t} tl={tl} teams={teams} kd={kd.get(p.id) ?? [0, 0]} followed={followId === p.id} mvp={over && round.mvpId === p.id} onClick={() => { setFollowId(followId === p.id ? null : p.id); if (followId === p.id) setCamera('overview'); else setCamMode('follow'); }} />)}
        </div>
      </section>
    );
  };

  const followed = followId ? tl.byId.get(followId) : undefined;
  const alivePips = (ti: TeamIdx) => {
    const ps = tl.players.filter((p) => p.team === ti);
    return <span className="tv-pips" aria-hidden="true">{ps.map((p) => <i key={p.id} className={p.deathT !== null && p.deathT <= t ? 'off' : ''} />)}</span>;
  };

  const reasonText = round.reason === 'bomb' ? 'Bomb exploded' : round.reason === 'defuse' ? 'Bomb defused' : round.reason === 'saved' ? 'Opponents saved' : round.reason === 'time' ? 'Time ran out before a plant' : round.winnerSide === 'T' ? 'Counter-terrorists eliminated' : 'Terrorists eliminated';
  const ticks = useMemo(() => [
    ...round.kills.map((k) => ({ t: k.t, cls: tl.byId.get(k.killerId)?.side === 'T' ? 't' : 'ct' })),
    ...(round.plantTime !== undefined ? [{ t: round.plantTime, cls: 'bomb' }] : []),
  ], [round, tl]);

  return (
    <div className="tv">
      <div className="tv-stage-wrap">
        <div className={`tv-stage ${view}`}>
          <i className="tv-vignette" aria-hidden="true" />
          <canvas key={view} ref={canvasRef} className="tv-canvas" onClick={onCanvasClick} role="img" aria-label={`Round ${round.number} on ${map}, ${view === '3d' ? '3D view: drag to pan, scroll or pinch to zoom, right-drag to rotate, click a player to follow' : 'radar view: click a player to highlight'}`} />

          <div className={`tv-bug ${clock.phase}`} aria-live="off">
            <div className={`tv-bug-team ${sideOf(humanIdx) === 'T' ? 't' : 'ct'}`}>
              <span className="bug-side" aria-hidden="true" />
              <Crest name={teams[humanIdx].name} tag={teams[humanIdx].tag} mine size={26} className="bug-crest" />
              <span className="bug-tag">{teams[humanIdx].tag}</span>
              {alivePips(humanIdx)}
              <span className="sc num">{score[humanIdx]}</span>
            </div>
            <div className={`tv-clock ${clock.phase}`}>
              <span className="num tv-clock-time">{clock.phase === 'bomb' || (over && round.planted) ? <BombIcon /> : null}{clock.label}</span>
              <span className="tv-round">{over ? 'ROUND OVER' : clock.phase === 'bomb' ? 'BOMB PLANTED' : `ROUND ${round.number}`}</span>
              {clock.phase === 'bomb' && <i className="tv-bombbar" style={{ width: `${Math.max(0, Math.min(1, clock.seconds / BOMB_SECONDS)) * 100}%` }} />}
            </div>
            <div className={`tv-bug-team right ${sideOf(oppIdx) === 'T' ? 't' : 'ct'}`}>
              <span className="sc num">{score[oppIdx]}</span>
              {alivePips(oppIdx)}
              <span className="bug-tag">{teams[oppIdx].tag}</span>
              <Crest name={teams[oppIdx].name} tag={teams[oppIdx].tag} size={26} className="bug-crest" />
              <span className="bug-side" aria-hidden="true" />
            </div>
          </div>

          <div className="tv-under-bug">
            {(bomb.state === 'carried' && bomb.progress > 0) || bomb.state === 'defusing' ? (
              <div className={`tv-progress ${bomb.state === 'defusing' ? 'ct' : 't'}`}>
                <span>{bomb.state === 'defusing' ? `${handle(bomb.carrier ?? undefined)} defusing` : `${handle(bomb.carrier ?? undefined)} planting`}</span>
                <i style={{ width: `${Math.round(bomb.progress * 100)}%` }} />
              </div>
            ) : null}
            {clutch && (
              <div className={`tv-clutch ${clutch.side === 'T' ? 't' : 'ct'}`} role="status">
                <b className="num">1v{clutch.vs}</b><span>{clutch.name}</span>
              </div>
            )}
          </div>

          {t < 3.5 && !over && (
            <div className="tv-intro" role="status" key={`intro-${round.number}`}>
              <span className="tv-intro-round">Round {round.number}</span>
              <div className="tv-intro-row">
                {[humanIdx, oppIdx].map((ti, k) => (
                  <span key={ti} className={`tv-intro-team ${sideOf(ti) === 'T' ? 't' : 'ct'} ${k ? 'right' : ''}`}>
                    <Crest name={teams[ti].name} tag={teams[ti].tag} mine={ti === humanIdx} size={44} />
                    <span className="tv-intro-id"><b>{teams[ti].tag}</b><span className={`tv-buy ${round.buys[ti]}`}>{sideOf(ti)} · {BUY_LABEL[round.buys[ti]]}</span></span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="tv-feed" aria-live="polite">
            {feed.map((f) => f.kind === 'kill' ? (
              <div key={`k-${f.t}-${f.victimId}`} className={`tv-kill ${tl.byId.get(f.killerId!)?.team === humanIdx ? 'mine' : ''}`}>
                <span className={tl.byId.get(f.killerId!)?.side === 'T' ? 't-col' : 'ct-col'}>{handle(f.killerId)}</span>
                {f.assisterId && <span className="faint">+ {handle(f.assisterId)}</span>}
                <span className="w">{f.weapon}{f.headshot ? <HeadshotIcon /> : null}</span>
                <span className={tl.byId.get(f.victimId!)?.side === 'T' ? 't-col' : 'ct-col'}>{handle(f.victimId)}</span>
              </div>
            ) : (
              <div key={`e-${f.t}-${f.kind}`} className={`tv-kill ev ${f.kind}`}><BombIcon /><span>{f.text}{f.killerId ? ` · ${handle(f.killerId)}` : ''}</span></div>
            ))}
          </div>

          {over && (
            <div className={`tv-banner ${round.winnerSide === 'T' ? 't' : 'ct'}`}>
              <Crest name={teams[round.winner].name} tag={teams[round.winner].tag} mine={round.winner === humanIdx} size={46} className="tv-banner-crest" />
              <strong>{teams[round.winner].tag} win the round</strong>
              <span>{reasonText}{round.mvpId ? ` · MVP ${handle(round.mvpId)}` : ''}</span>
              {wonClutch && <em className="tv-banner-clutch">1v{wonClutch.vs} clutch · {handle(wonClutch.id)}</em>}
            </div>
          )}

          <div className="tv-cam" role="toolbar" aria-label="Camera and overlays">
            {view === '3d' && <div className="tv-cam-group">
              <button aria-pressed={camMode === 'overview'} onClick={() => setCamera('overview')} data-tip="Whole map (Esc)" aria-keyshortcuts="Escape"><CamIcon kind="overview" /><span>Overview</span></button>
              <button aria-pressed={camMode === 'follow'} onClick={() => setCamera('follow')} data-tip="Follow a player (1–5 yours, 6–0 theirs)"><CamIcon kind="follow" /><span>Follow</span></button>
              <button aria-pressed={tilt === 'top'} onClick={() => chooseTilt(tilt === 'top' ? 'iso' : 'top')} data-tip="Top-down camera"><CamIcon kind="top" /><span>Top</span></button>
            </div>}
            <div className="tv-cam-group">
              <button aria-pressed={vision} onClick={() => setVision(!vision)} data-tip="View cones: where each player looks (V)" aria-keyshortcuts="V"><CamIcon kind="vision" /><span>Vision</span></button>
              <button aria-pressed={labels} onClick={() => setLabels(!labels)} data-tip="Name tags and callouts (N)" aria-keyshortcuts="N"><CamIcon kind="tags" /><span>Tags</span></button>
              <button aria-pressed={radar} onClick={() => setRadar(!radar)} data-tip="Pace rings: small when walking (silent), 20 m when running, how far the steps carry (R)" aria-keyshortcuts="R"><CamIcon kind="steps" /><span>Steps</span></button>
              <button aria-pressed={sound} onClick={toggleSound} data-tip="Match sounds" aria-label="Match sounds"><SoundIcon on={sound} /><span>Sound</span></button>
              {view === '3d' && <button aria-pressed={showMini} onClick={() => setShowMini(!showMini)} data-tip="Minimap when zoomed in or following (M)" aria-keyshortcuts="M" aria-label="Minimap"><CamIcon kind="radar" /><span>Minimap</span></button>}
            </div>
            {view === '3d' && <div className="tv-cam-group">
              <button onClick={() => (stage.current as Viewer3D | null)?.zoomBy(0.8)} aria-label="Zoom in" data-tip="Zoom in">+</button>
              <button onClick={() => (stage.current as Viewer3D | null)?.zoomBy(1.25)} aria-label="Zoom out" data-tip="Zoom out">−</button>
            </div>}
          </div>
          {view === '3d' && showMini && camMode !== 'overview' && (
            <canvas ref={miniRef} className="tv-minimap" role="img" aria-label="Radar: click a player to follow"
              onClick={(e) => { const id = mini.current?.pick(e.clientX, e.clientY, tRef.current) ?? null; if (id) { setFollowId(id); setCamMode('follow'); } }} />
          )}
          {followed && <FollowCard p={followed} t={t} tl={tl} teams={teams} onProfile={() => setLocalPaused(true)} onClose={() => { setFollowId(null); setCamera('overview'); }} />}
        </div>

        <div className="tv-transport">
          <button className="tv-play" onClick={togglePlay} aria-label={t >= tl.duration - 0.01 ? 'Replay round' : playing ? 'Pause' : 'Play'}>
            {t >= tl.duration - 0.01 ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="tv-scrub">
            <input type="range" min={0} max={tl.duration} step={0.05} value={Math.min(t, tl.duration)} onChange={(e) => seek(Number(e.target.value))} aria-label="Round timeline" />
            <div className="tv-ticks" aria-hidden="true">
              {ticks.filter((k) => replay || k.t <= t).map((k, i) => <i key={i} className={k.cls} style={{ left: `${(k.t / tl.duration) * 100}%` }} />)}
            </div>
          </div>
          <span className="tv-time num">{fmt(t)}{replay && <span className="faint"> / {fmt(tl.duration)}</span>}</span>
        </div>
      </div>

      <div className="tv-teams">
        {teamPanel(humanIdx)}
        {teamPanel(oppIdx)}
        <RoundStory round={round} teams={teams} t={t} sideOf={sideOf} humanIdx={humanIdx} onSeek={(v) => { setLocalPaused(true); seek(v); }} />
        <TacticsCard round={round} teams={teams} t={t} humanIdx={humanIdx} sideOf={sideOf} />
      </div>
    </div>
  );
}

function fmt(s: number): string { const v = Math.floor(s); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; }

const UTIL_ORDER: UtilityKind[] = ['smoke', 'flash', 'molotov', 'he'];
const UTIL_LABEL: Record<UtilityKind, string> = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE grenade' };

/** Grenades a player still holds at time t (the ones they throw later this round). */
function utilLeft(tl: RoundTimeline, id: string, t: number): UtilityKind[] {
  const left = [...(tl.round.loadouts?.[id]?.nades ?? [])];
  for (const u of tl.utility) if (u.playerId === id && u.throwT <= t) { const i = left.indexOf(u.kind); if (i >= 0) left.splice(i, 1); }
  return left.sort((a, b) => UTIL_ORDER.indexOf(a) - UTIL_ORDER.indexOf(b));
}

function PlayerRow({ p, t, tl, teams, kd, followed, mvp, onClick }: { p: PlayerTrack; t: number; tl: RoundTimeline; teams: [TeamSnapshot, TeamSnapshot]; kd: [number, number]; followed: boolean; mvp: boolean; onClick: () => void }) {
  const hp = hpAt(p, t);
  const dead = hp <= 0;
  const killsNow = tl.round.kills.filter((k) => k.killerId === p.id && k.t <= t).length;
  const deathsNow = tl.round.kills.some((k) => k.victimId === p.id && k.t <= t) ? 1 : 0;
  const mp = teams[p.team].players.find((x) => x.id === p.id);
  const bomb = bombAt(tl, t);
  const carrying = bomb.state === 'carried' && bomb.carrier === p.id;
  const color = p.side === 'T' ? '#f0a33a' : '#5aa9e6';
  const nades = dead ? [] : utilLeft(tl, p.id, t);
  const spotted = !dead && isSpotted(p, t);
  const weapon = weaponAt(p, t);
  return (
    <button className={`tv-row ${dead ? 'dead' : ''} ${followed ? 'followed' : ''} ${mvp ? 'mvp' : ''} ${spotted ? 'spotted' : ''}`} onClick={onClick} aria-pressed={followed} aria-label={`${p.handle}, ${ROLE_LABEL[p.role]}, ${dead ? 'dead' : `${hp} HP`}, ${weapon}. Follow on the map.`}>
      <span className="tv-ava-wrap">
        <Avatar seed={mp?.playerId ?? p.id} size={36} accent={color} className="tv-ava" />
        <span className="tv-role" title={ROLE_LABEL[p.role]}><RoleIcon role={p.role} /></span>
      </span>
      <span className="tv-main">
        <span className="tv-name">
          <span className="n">{p.handle}</span>
          {carrying && <BombIcon />}
          {spotted && <EyeIcon />}
          {mvp && <span className="tv-mvp">MVP</span>}
          <span className="tv-kd num">{killsNow ? <b>{killsNow}K</b> : null}<span>{kd[0] + killsNow}<i>/</i>{kd[1] + deathsNow}</span></span>
        </span>
        <span className="tv-hp" aria-hidden="true">
          <i className={hp > 50 ? 'ok' : hp > 20 ? 'mid' : 'low'} style={{ width: `${hp}%` }} />
        </span>
        <span className="tv-sub">
          <b className="num tv-hpn">{dead ? '—' : hp}</b>
          <span className="w">{dead ? 'Dead' : weapon}</span>
          <span className="tv-kit" aria-hidden="true">
            {nades.map((k, i) => <UtilIcon key={i} kind={k} />)}
            {!dead && p.armor && <ArmorIcon helmet={p.helmet} />}
            {!dead && p.kit && <KitIcon />}
          </span>
        </span>
      </span>
    </button>
  );
}

function FollowCard({ p, t, tl, teams, onClose, onProfile }: { p: PlayerTrack; t: number; tl: RoundTimeline; teams: [TeamSnapshot, TeamSnapshot]; onClose: () => void; onProfile: () => void }) {
  const { career, openPlayer } = useGame();
  const hp = hpAt(p, t);
  const dead = hp <= 0;
  const mp = teams[p.team].players.find((x) => x.id === p.id);
  const kills = tl.round.kills.filter((k) => k.killerId === p.id && k.t <= t).length;
  const dmg = tl.shots.filter((s) => s.from === p.id && s.hit && s.t <= t).reduce((a, s) => a + s.damage, 0);
  const color = p.side === 'T' ? '#f0a33a' : '#5aa9e6';
  const nades = dead ? [] : utilLeft(tl, p.id, t);
  return (
    <div className={`tv-follow ${p.side === 'T' ? 't' : 'ct'} ${dead ? 'dead' : ''}`} role="status" aria-label={`Following ${p.handle}`}>
      <Avatar seed={mp?.playerId ?? p.id} size={44} accent={color} className="tv-follow-ava" />
      <div className="tv-follow-body">
        <div className="tv-follow-top">
          <span className="tv-follow-name">{p.handle}</span>
          <span className="tv-follow-role"><RoleIcon role={p.role} />{ROLE_LABEL[p.role]}</span>
          {!dead && isSpotted(p, t) && <span className="tv-follow-spot"><EyeIcon /> Spotted</span>}
        </div>
        <div className="tv-follow-stats">
          <span className="hp"><b className="num">{dead ? 0 : hp}</b><small>HP</small></span>
          <span className="tv-follow-bar"><i className={hp > 50 ? 'ok' : hp > 20 ? 'mid' : 'low'} style={{ width: `${hp}%` }} /></span>
          <span><b>{dead ? 'Dead' : weaponAt(p, t)}</b></span>
          <span className="tv-kit">{nades.map((k, i) => <UtilIcon key={i} kind={k} />)}{!dead && p.armor && <ArmorIcon helmet={p.helmet} />}{!dead && p.kit && <KitIcon />}</span>
          <span className="num"><b>{kills}</b><small>K</small></span>
          <span className="num dmg"><b>{dmg}</b><small>DMG</small></span>
        </div>
      </div>
      <div className="tv-follow-acts">
        <button className="tv-follow-x" onClick={onClose} aria-label="Stop following">×</button>
        {mp && <button className="tv-follow-pro" onClick={() => { onProfile(); openPlayer(career.cards.some((x) => x.cardId === mp.id) ? mp.id : null, mp.playerId); }} aria-label={`Open ${p.handle}'s profile`} title="Profile (pauses the round)">Profile</button>}
      </div>
    </div>
  );
}

function UtilIcon({ kind }: { kind: UtilityKind }) {
  return (
    <svg className={`ico util ${kind}`} viewBox="0 0 16 16" role="img" aria-label={UTIL_LABEL[kind]}>
      {kind === 'smoke' && <><rect x="5" y="2" width="6" height="2" rx="0.5" fill="currentColor" /><rect x="4" y="4.5" width="8" height="10" rx="2" fill="currentColor" /></>}
      {kind === 'flash' && <><rect x="6" y="1.5" width="4" height="2.5" rx="0.5" fill="currentColor" /><rect x="5" y="4.5" width="6" height="10" rx="1.5" fill="currentColor" /><path d="M8 6.5 6.8 9.5h2.4L8 12.5" stroke="#0b0f14" strokeWidth="1.1" fill="none" /></>}
      {kind === 'molotov' && <><path d="M7 1.5h2v3l2 2.5v6.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7l2-2.5Z" fill="currentColor" /><path d="M8 0.5c1 .8 1 1.6 0 2" stroke="currentColor" strokeWidth="1" fill="none" /></>}
      {kind === 'he' && <><circle cx="8" cy="9.5" r="5" fill="currentColor" /><rect x="6.5" y="2" width="3" height="3" fill="currentColor" /></>}
    </svg>
  );
}

function CamIcon({ kind }: { kind: 'overview' | 'follow' | 'top' | 'vision' | 'tags' | 'radar' | 'steps' }) {
  const c = { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className: 'ico' };
  switch (kind) {
    case 'overview': return <svg {...c}><path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" /><rect x="5.5" y="5.5" width="5" height="5" rx="1" /></svg>;
    case 'follow': return <svg {...c}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" /></svg>;
    case 'top': return <svg {...c}><path d="M8 1.5 14 5 8 8.5 2 5Z" /><path d="M2 8.5 8 12l6-3.5" /></svg>;
    case 'vision': return <svg {...c}><path d="M3 13 8 3l5 10" /><path d="M5 9h6" opacity="0.6" /></svg>;
    case 'radar': return <svg {...c}><circle cx="8" cy="8" r="6" /><path d="M8 8 12 4" /><circle cx="8" cy="8" r="2.5" opacity="0.6" /></svg>;
    case 'steps': return <svg {...c}><circle cx="8" cy="8" r="1.6" fill="currentColor" /><path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8" /><path d="M2.4 2.4a8 8 0 0 0 0 11.2M13.6 2.4a8 8 0 0 1 0 11.2" opacity="0.55" /></svg>;
    case 'tags': return <svg {...c}><rect x="2" y="4" width="12" height="6" rx="1.5" /><path d="M8 10v3" /></svg>;
  }
}

// Small inline icons (original drawings).
function EyeIcon() { return <svg className="ico eye" viewBox="0 0 16 16" role="img" aria-label="spotted"><path d="M1 8c2-3.4 4.4-5 7-5s5 1.6 7 5c-2 3.4-4.4 5-7 5S3 11.4 1 8z" fill="currentColor" /><circle cx="8" cy="8" r="2.4" fill="#0b0f14" /></svg>; }
function SoundIcon({ on }: { on: boolean }) {
  return <svg className="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" />{on ? <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}</svg>;
}

function BombIcon() { return <svg className="ico bomb" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="5" width="12" height="8" rx="1.5" fill="currentColor" /><rect x="5" y="3" width="6" height="2" fill="currentColor" /><circle cx="11" cy="9" r="1.4" fill="#0b0f14" /></svg>; }
function HeadshotIcon() { return <svg className="ico hs" viewBox="0 0 16 16" aria-label="headshot"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="8" r="1.8" fill="currentColor" /></svg>; }
function ArmorIcon({ helmet }: { helmet: boolean }) { return <svg className="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 13.5 3.5v4.2c0 3.2-2.4 5.6-5.5 6.8C4.9 13.3 2.5 10.9 2.5 7.7V3.5Z" fill="currentColor" opacity={helmet ? 1 : 0.55} />{helmet && <path d="M5 8h6" stroke="#0b0f14" strokeWidth="1.6" />}</svg>; }
function KitIcon() { return <svg className="ico kit" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12 9.5 5.5M8 3.5l4.5 4.5M10.5 2.5l3 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5Z" fill="currentColor" /></svg>; }
function PauseIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" fill="currentColor" /><rect x="9.5" y="2.5" width="3" height="11" fill="currentColor" /></svg>; }
function ReplayIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M2.5 1.8v3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>; }
