import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Career, Difficulty, World } from '../engine/career';
import { DIFFICULTY_LABEL, DIFFICULTY_TIP } from '../engine/career';
import { aiSnapshot, aiTeamById, canClaimDaily, createCareer, createWorld, ensureBoard, ensureContracts, humanFixture, humanSnapshot, starterCoaches } from '../engine/career';
import { HUMAN_ID } from '../engine/season';
import { coachOverall } from '../engine/data/coaches';
import { generateSyntheticDataset } from '../engine/data/generateDataset';
import { realDataset } from '../engine/data/realPlayers';
import { CUP_START, DIVISIONS } from '../engine/season';
import { COACH_ATTRIBUTES, COACH_ATTRIBUTE_LABEL } from '../engine/types';
import type { Dataset } from '../engine/types';
import { Coin, GameCtx, TabIcon, today, CountryTag } from './common';
import type { Game } from './common';
import { loadCareer, loadDataset, storeCareer } from './persist';
import { Crest, setMyCrest } from './crest';
import { CrestEditor } from './CrestEditor';
import { TitleScene } from './TitleScene';
import { music } from './music';
import { StadiumScene, stadiumOn } from './StadiumScene';
import { orgGlow, realTeamByName } from '../engine/data/realTeams';
import { mapArt } from './mapart';
import { Home } from './screens/Home';
import { Squad } from './screens/Squad';
import { Train } from './screens/Train';
import { Scout } from './screens/Scout';
import { ClubSheet } from './screens/Club';
import { Cases } from './screens/Cases';
import { Pvp } from './screens/Pvp';
import { League } from './screens/League';
import { MatchFlow } from './screens/Match';
import { PlayerSheet } from './screens/PlayerSheet';
import { Settings } from './screens/Settings';
import { onlineAvailable } from '../online/supa';
import { reducedMotion } from './motion';
import { CommandBar, PhoneHud, SeasonTrack } from './CommandBar';

const openTournament = () => { location.hash = '#tournament'; };

type Tab = 'home' | 'squad' | 'train' | 'scout' | 'cases' | 'league' | 'pvp';
const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' }, { id: 'squad', label: 'Squad' }, { id: 'train', label: 'Train' }, { id: 'scout', label: 'Scout' }, { id: 'cases', label: 'Cases' }, { id: 'league', label: 'League' }, { id: 'pvp', label: 'PvP' },
];

function weekLabel(w: number): string {
  if (w <= 7) return `Week ${w}`;
  if (w === 8) return 'Semifinals';
  if (w === 9) return 'Final';
  return `Cup ${w === CUP_START ? 'quarterfinals' : w === CUP_START + 1 ? 'semifinals' : 'final'}`;
}

function initialWorld(): World {
  const imported = loadDataset();
  if (imported) return createWorld(imported);
  // Real players are the default for new careers; a career started on the demo players keeps them.
  const demo = generateSyntheticDataset();
  if (loadCareer()?.datasetId === demo.id) return createWorld(demo);
  return createWorld(realDataset() ?? demo);
}

export function App() {
  const [world, setWorld] = useState<World>(initialWorld);
  const [career, setCareer] = useState<Career | null>(() => {
    const c = loadCareer();
    return c && c.cards.every((card) => world.profiles.has(card.playerId)) ? ensureBoard(world, ensureContracts(world, c)) : null;
  });
  const [tab, setTab] = useState<Tab>('home');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ cardId: string | null; playerId?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);
  const [crestOpen, setCrestOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const toastTimer = useRef<number>();

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const update = useCallback((next: Career, msg?: string) => {
    setCareer(next);
    if (!storeCareer(next)) setSaveFailed(true);
    if (msg) toast(msg);
  }, [toast]);

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  // Menu music: unlocked by the first gesture, silent while a match is on screen.
  const [musicEnabled, setMusicEnabled] = useState(music.on);
  useEffect(() => {
    const unlock = () => music.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);
  useEffect(() => { music.want(!matchOpen); }, [matchOpen]);
  // The 3D arena behind the menus (desktop; Settings can turn it off).
  const [stadium, setStadium] = useState(() => stadiumOn() && typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches);
  useEffect(() => {
    const on = () => setStadium(stadiumOn() && !!window.matchMedia?.('(min-width: 1024px)').matches);
    window.addEventListener('clutch-stadium', on);
    return () => window.removeEventListener('clutch-stadium', on);
  }, []);
  const toggleMusic = () => { const v = !musicEnabled; setMusicEnabled(v); music.setEnabled(v); };

  // Player cards tilt toward the pointer (CSS reads --rx/--ry/--mx/--my; see premium.css).
  useEffect(() => {
    if (!window.matchMedia?.('(hover: hover)').matches || reducedMotion()) return;
    let last: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('button.pcard.pc') as HTMLElement | null;
      if (last && last !== el) { last.style.removeProperty('--rx'); last.style.removeProperty('--ry'); }
      last = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${((x - 0.5) * 14).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - y) * 12).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => document.removeEventListener('pointermove', move);
  }, []);

  const replaceWorld = useCallback((dataset: Dataset, nextCareer: Career | null) => {
    setWorld(createWorld(dataset));
    setCareer(nextCareer);
    storeCareer(nextCareer);
  }, []);

  // Every crest marked as the player's own follows the design saved in the career.
  setMyCrest(career?.crest);

  const game: Game | null = useMemo(() => career ? {
    world, career, update, toast,
    openPlayer: (cardId, playerId) => setPlayer(cardId || playerId ? { cardId, playerId } : null),
    openClub: () => setClubOpen(true),
  } : null, [world, career, update, toast]);

  // Your starting five for the arena backdrop (handles and roles only).
  const stageFive = useMemo(() => {
    if (!career) return [];
    try { return humanSnapshot(world, career).players.map((p) => ({ id: p.id, handle: p.handle, role: p.role })); } catch { return []; }
  }, [world, career]);
  // Your next opponent's five, at the other booth.
  const stageOpp = useMemo(() => {
    if (!career) return undefined;
    try {
      const f = humanFixture(career);
      const opp = f ? aiTeamById(career, f.home === HUMAN_ID ? f.away : f.home) : undefined;
      if (!opp) return undefined;
      const snap = aiSnapshot(world, career, opp);
      const org = realTeamByName(opp.name);
      return { tag: snap.tag, color: org ? orgGlow(org) : undefined, five: snap.players.map((p) => ({ id: p.id, handle: p.handle, role: p.role })) };
    } catch { return undefined; }
  }, [world, career]);

  if (!career || !game) {
    return <Onboarding world={world} onStart={(c) => { update(c, 'Career started. The guide at the top walks you through week 1.'); setTab('home'); window.scrollTo(0, 0); }} />;
  }

  const div = DIVISIONS[career.season.division]!;
  const dailyReady = canClaimDaily(career, today());

  return (
    <GameCtx.Provider value={game}>
      <div className={`app${stadium ? ' has-stadium' : ''}`}>
        {stadium && <><StadiumScene teamName={career.teamName} teamTag={career.teamTag} active={!matchOpen} five={stageFive} opponent={stageOpp} /><i className="stadium-shade" aria-hidden="true" /></>}
        <aside className="sidebar" aria-label="Club">
          <div className="wordmark"><BrandMark />Clutch<b>/</b>Manager</div>
          <div className="side-team">
            <button type="button" className="crest-btn" aria-label="Edit club crest" title="Edit club crest" onClick={() => setCrestOpen(true)}><Crest name={career.teamName} tag={career.teamTag} mine size={46} /></button>
            <div style={{ minWidth: 0 }}>
              <div className="team-name">{career.teamName}</div>
              <div className="small muted">{div.name}</div>
              <div className="small faint">Season {career.season.number} · {weekLabel(career.season.week)}</div>
            </div>
          </div>
          <nav className="side-nav" aria-label="Main">
            {TABS.map((t) => (
              <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                <TabIcon name={t.id} />
                <span>{t.label}</span>
                {t.id === 'cases' && dailyReady ? <span className="dot" aria-label="Free daily case available" /> : <span />}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            {onlineAvailable() && <button className="btn" onClick={openTournament}><span className="small">Beta tournament</span><TabIcon name="league" /></button>}
            <button className="btn ghost" onClick={() => setClubOpen(true)} aria-label={`Club finances, balance ${career.coins}`}><span className="small muted">Club finances</span><Coin amount={career.coins} /></button>
            <button className="btn ghost" onClick={toggleMusic} aria-pressed={musicEnabled}><span className="small muted">Music</span><span className="small">{musicEnabled ? 'On' : 'Off'}</span></button>
            <button className="btn ghost" onClick={() => setSettingsOpen(true)}><span className="small muted">Settings &amp; data</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg></button>
          </div>
        </aside>
        <header className="topbar">
          <div className="team">
            <Crest name={career.teamName} tag={career.teamTag} mine size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="team-name">{career.teamName}</div>
              <div className="small muted">{div.name} · S{career.season.number} · {weekLabel(career.season.week)}</div>
            </div>
          </div>
          {onlineAvailable() && <button className="icon-btn" aria-label="Beta tournament" title="Beta tournament" onClick={openTournament}><TabIcon name="league" /></button>}
          <PhoneHud goTo={setTab} />
          <button className="coin-btn" aria-label={`Club finances, balance ${career.coins}`} onClick={() => setClubOpen(true)}><Coin amount={career.coins} /></button>
          <button className="icon-btn" aria-label="Settings and data" onClick={() => setSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <SeasonTrack />
        </header>
        <main>
          <CommandBar weekText={weekLabel(career.season.week)} goTo={setTab} onPlay={() => setMatchOpen(true)} />
          {saveFailed && <div className="demo-banner">This browser is blocking storage, so progress will be lost when you close the page. Use Settings → Export save to keep it.</div>}
          {tab === 'home' && <Home goTo={setTab} onPlay={() => setMatchOpen(true)} />}
          {tab === 'squad' && <Squad />}
          {tab === 'train' && <Train goHome={() => setTab('home')} />}
          {tab === 'scout' && <Scout />}
          {tab === 'cases' && <Cases goSquad={() => setTab('squad')} />}
          {tab === 'league' && <League />}
          {tab === 'pvp' && <Pvp />}
        </main>
        <div className="tabbar">
          <nav aria-label="Main">
            {TABS.map((t) => (
              <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
                <TabIcon name={t.id} />
                {t.label}
                {t.id === 'cases' && dailyReady && <span className="dot" aria-label="Free daily case available" />}
              </button>
            ))}
          </nav>
        </div>
        {matchOpen && <MatchFlow onClose={() => { setMatchOpen(false); setTab('home'); }} />}
        {player && <PlayerSheet cardId={player.cardId} playerId={player.playerId} onClose={() => setPlayer(null)} />}
        {clubOpen && <ClubSheet onClose={() => setClubOpen(false)} />}
        {crestOpen && <CrestEditor onClose={() => setCrestOpen(false)} />}
        {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} replaceWorld={replaceWorld} onReset={() => { setCareer(null); storeCareer(null); setSettingsOpen(false); }} />}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  );
}

function Onboarding({ world, onStart }: { world: World; onStart: (c: Career) => void }) {
  const coaches = starterCoaches(world);
  const [manager, setManager] = useState('');
  const [team, setTeam] = useState('');
  const [tag, setTag] = useState('');
  const [coachId, setCoachId] = useState(coaches[0]!.id);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  // Live 3D flyover behind the brand column on desktop; phones keep the light map-art backdrop.
  const [scene, setScene] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches);
  const previewTag = tag || (team ? team.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() : 'NVA');
  const steps: [string, string][] = [
    ['Build', 'Open cases and sign players into a five-player roster with a head coach.'],
    ['Train', 'Plan the week: drills, map practice, rest. Chemistry and fatigue matter.'],
    ['Out-think', 'Win the veto, set tactics, call timeouts and watch it play out round by round.'],
    ['Climb', `Top two go up. Four divisions from the ${DIVISIONS[0]!.name} to the ${DIVISIONS[DIVISIONS.length - 1]!.name}.`],
  ];
  return (
    <div className="ob">
      <div className="ob-brand">
        <div className={`ob-backdrop${scene ? ' has-scene' : ''}`} aria-hidden="true">
          {scene
            ? <TitleScene onFail={() => setScene(false)} />
            : (['Inferno', 'Mirage', 'Dust2'] as const).map((m) => <i key={m} style={{ backgroundImage: `url(${mapArt(m)})` }} />)}
        </div>
        <div className="ob-brand-in">
          <div className="label">CS2 esports manager · beta</div>
          <div className="wordmark ob-mark"><BrandMark />Clutch<b>/</b>Manager</div>
          <p className="ob-pitch">Run a Counter-Strike team from the bottom of the ladder to the big stage.</p>
          <ol className="ob-steps">
            {steps.map(([t, d], i) => <li key={t}><span className="ob-n num">{String(i + 1).padStart(2, '0')}</span><div><strong>{t}</strong><span>{d}</span></div></li>)}
          </ol>
          <ol className="ob-ladder" aria-label="Divisions">
            {DIVISIONS.map((d, i) => <li key={d.id} className={i === 0 ? 'on' : ''}><i aria-hidden="true" />{d.name}</li>)}
          </ol>
          {onlineAvailable() && <p className="ob-data"><button type="button" className="btn small" onClick={openTournament}>Playing in the beta tournament? Go there</button></p>}
          <p className="ob-data">
            {world.dataset.isSynthetic
              ? 'Demo data: all 200 players are fictional, with statistics generated to resemble top-200 pro play. No real player names or stats are used.'
              : `Dataset: ${world.dataset.label}. ${world.dataset.players.length} players.`}
          </p>
        </div>
      </div>
      <form className="ob-form" onSubmit={(e) => {
        e.preventDefault();
        onStart(createCareer(world, { managerName: manager, teamName: team || 'Nova Five', teamTag: tag || (team ? team.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) : 'NVA'), coachId, today: today(), difficulty }));
      }}>
        <div className="ob-form-head">
          <h1>Found your club</h1>
          <p className="small muted">Three quick choices. Everything except the coach can be changed later.</p>
        </div>
        <fieldset className="ob-set">
          <legend className="ob-legend"><span className="num">1</span>Identity</legend>
          <div className="field"><label className="label" htmlFor="ob-manager">Your name</label><input id="ob-manager" value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Manager" maxLength={24} autoComplete="off" /></div>
          <div className="ob-team">
            <div className="field"><label className="label" htmlFor="ob-team">Team name</label><input id="ob-team" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Nova Five" maxLength={22} autoComplete="off" /></div>
            <div className="field"><label className="label" htmlFor="ob-tag">Tag</label><input id="ob-tag" className="ob-tag-in" value={tag} onChange={(e) => setTag(e.target.value.toUpperCase().slice(0, 4))} placeholder="NVA" maxLength={4} autoComplete="off" /></div>
          </div>
          <div className="ob-preview" aria-hidden="true"><Crest name={team || 'Nova Five'} tag={previewTag} mine size={40} /><span className="tag">{previewTag}</span><span className="team-name">{team || 'Nova Five'}</span><span className="faint small">{DIVISIONS[0]!.name} · Season 1</span></div>
        </fieldset>
        <fieldset className="ob-set">
          <legend className="ob-legend"><span className="num">2</span>Difficulty</legend>
          <div className="seg" role="group" aria-label="Difficulty">
            {(['relaxed', 'normal', 'hard'] as const).map((d) => <button type="button" key={d} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>{DIFFICULTY_LABEL[d]}</button>)}
          </div>
          <span className="small faint">{DIFFICULTY_TIP[difficulty]} You can change it later in Settings.</span>
        </fieldset>
        <fieldset className="ob-set">
          <legend className="ob-legend"><span className="num">3</span>Head coach <span className="faint">· free</span></legend>
          <div className="ob-coaches" role="radiogroup" aria-label="Head coach">
            {coaches.map((c) => {
              const on = coachId === c.id;
              return (
                <button type="button" key={c.id} role="radio" aria-checked={on} className={`ob-coach ${on ? 'on' : ''}`} onClick={() => setCoachId(c.id)}>
                  <span className="ob-radio" aria-hidden="true" />
                  <div className="ob-coach-main">
                    <div className="ob-coach-head"><strong><CountryTag cc={c.country} /> {c.name}</strong><span className="ob-ovr num" aria-label={`Overall ${coachOverall(c)}`}>{coachOverall(c)}</span></div>
                    <p className="small muted">{c.blurb}</p>
                    <div className="ob-attrs">
                      {COACH_ATTRIBUTES.map((a) => (
                        <div key={a} className="ob-attr">
                          <span>{COACH_ATTRIBUTE_LABEL[a]}</span>
                          <i aria-hidden="true"><b style={{ width: `${c.attrs[a]}%` }} /></i>
                          <span className="num">{c.attrs[a]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </fieldset>
        <button className="btn primary block ob-go" type="submit">Start career</button>
      </form>
    </div>
  );
}

/** The game's mark: a crosshair inside a chamfered frame, amber on graphite. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 2 H24 L30 8 V24 L24 30 H8 L2 24 V8 Z" fill="url(#bm-g)" stroke="#f6b14f" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="#1b1206" strokeWidth="2.2" />
      <path d="M16 5.5 V11 M16 21 V26.5 M5.5 16 H11 M21 16 H26.5" stroke="#1b1206" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.6" fill="#1b1206" />
      <defs><linearGradient id="bm-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffc56a" /><stop offset="1" stopColor="#e08c22" /></linearGradient></defs>
    </svg>
  );
}
