import { useState } from 'react';
import { runRecoveryWeek, starterFatigue } from '../../engine/career';
import { planCost } from '../../engine/training';
import { completeMatchday, humanFixture, lineupValidation, runTrainingWeek, teamName, teamTag, aiTeamById, humanSnapshot, aiSnapshot, ordinal } from '../../engine/career';
import { HUMAN_ID, standings, DIVISIONS, cupName, CUP_START, STAGE_LABEL, isCup } from '../../engine/season';
import { teamStrength } from '../../engine/team';
import { ATTRIBUTE_LABEL } from '../../engine/types';
import type { Attribute } from '../../engine/types';
import { ACTIVITIES } from '../../engine/training';
import { today, useGame } from '../common';
import { FormPills, money, signed } from './leagueUtil';
import type { Result } from './leagueUtil';
import { Crest, orgTextStyle } from '../crest';
import '../styles/home.css';
import { buildAlerts } from '../alerts';
import { BoardPanel } from '../BoardPanel';
import { weeklyWages } from '../../engine/career';
import { MAX_SQUAD, NO_FACILITIES, facilityUpkeep } from '../../engine/economy';

export function Home({ goTo, onPlay }: { goTo: (t: 'squad' | 'train' | 'scout' | 'cases' | 'league') => void; onPlay: () => void }) {
  const { world, career: c, update, openClub, openPlayer } = useGame();
  const fixture = humanFixture(c);
  const valid = lineupValidation(c);
  const table = standings(c.season);
  const pos = table.findIndex((r) => r.teamId === HUMAN_ID) + 1;
  const me = table.find((r) => r.teamId === HUMAN_ID)!;
  const strength = valid.ok ? teamStrength(humanSnapshot(world, c)) : null;
  const opponentId = fixture ? (fixture.home === HUMAN_ID ? fixture.away : fixture.home) : null;
  const opp = opponentId ? aiTeamById(c, opponentId) : undefined;
  const oppStrength = opp ? teamStrength(aiSnapshot(world, c, opp)) : null;
  const oppPos = opponentId ? table.findIndex((r) => r.teamId === opponentId) + 1 : 0;
  const oppRow = opponentId ? table.find((r) => r.teamId === opponentId) : undefined;
  const div = DIVISIONS[c.season.division]!;
  const stageLabel = fixture ? (fixture.stage === 'league' ? `League · Week ${fixture.week}` : `${isCup(fixture.stage) ? `${cupName(c.season.division)} · ` : ''}${STAGE_LABEL[fixture.stage].replace(/^Cup (.)/, (_m, ch: string) => ch.toUpperCase())}`) : '';
  const last = c.matches[0];
  const wages = weeklyWages(world, c);
  const upkeep = facilityUpkeep(c.facilities ?? NO_FACILITIES);
  const weeklyIn = c.sponsor?.weekly ?? 0;
  const weeklyOut = wages.players + wages.coach + upkeep;
  const lineupCards = c.lineup.map((sl) => c.cards.find((x) => x.cardId === sl.cardId)).filter((x): x is NonNullable<typeof x> => !!x);
  const avgFatigue = lineupCards.length ? Math.round(lineupCards.reduce((sum, x) => sum + x.fatigue, 0) / lineupCards.length) : 0;
  const tr = c.lastTraining && c.lastTraining.week === c.season.week && c.lastTraining.season === c.season.number ? c.lastTraining : null;
  const myForm: Result[] = c.matches.slice(0, 5).reverse().map((m) => (m.won ? 'W' : 'L'));

  const cost = planCost(c.plan);
  const worn = starterFatigue(c) >= 60;
  const recover = cost > Math.max(0, c.coins) || worn;
  const quickTrain = () => {
    try {
      update(recover ? runRecoveryWeek(world, c) : runTrainingWeek(world, c), recover ? 'Recovery week done. Matchday is next.' : 'Training week done. Matchday is next.');
    } catch (e) {
      update(c, (e as Error).message);
    }
  };
  const recoverNote = recover ? <p className="hm-note">{cost > Math.max(0, c.coins) ? `Your plan costs ${cost} and you have ${c.coins}, so` : `Your starters are worn out (fatigue ${starterFatigue(c)}), so`} the quick option is a free recovery week: tactical review and two rest days. Your saved plan stays.</p> : null;

  // Mini table: a five-row window around your position.
  const winStart = Math.max(0, Math.min(table.length - 5, pos - 3));
  const mini = table.slice(winStart, winStart + 5);
  const flowMax = Math.max(1, weeklyIn, weeklyOut);
  const edge = strength !== null && oppStrength !== null ? strength - oppStrength : null;

  return (
    <>
      <Tutorial goTo={goTo} openClub={openClub} />
      <section className="hm-hero span-8" aria-label="Next match">
        {fixture && opp ? (
          <>
            <div className="hm-hero-top">
              <span className="label">{stageLabel}</span>
              <span className="chip">{fixture.format.toUpperCase()}</span>
              <span className={`chip ${c.phase === 'training' ? 'warn' : 'good'}`}>{c.phase === 'training' ? 'Training day' : 'Matchday'}</span>
            </div>
            <div className="hm-vs">
              <div className="hm-side me">
                <span className="hm-crest-row"><Crest name={c.teamName} tag={c.teamTag} mine size={52} /><span className="hm-tag">{c.teamTag}</span></span>
                <span className="hm-tname">{c.teamName}</span>
                <span className="hm-meta"><span className="num">{ordinal(pos)}</span> · <span className="num">{me.wins}-{me.losses}</span></span>
              </div>
              <div className="hm-mid" aria-hidden="true"><span>VS</span></div>
              <div className="hm-side opp">
                <span className="hm-crest-row"><Crest name={opp.name} tag={opp.tag} size={52} /><span className="hm-tag" style={orgTextStyle(opp.name)}>{opp.tag}</span></span>
                <span className="hm-tname">{opp.name}</span>
                <span className="hm-meta">{oppPos > 0 && oppRow ? <><span className="num">{ordinal(oppPos)}</span> · <span className="num">{oppRow.wins}-{oppRow.losses}</span></> : 'Cup guest'}</span>
              </div>
            </div>
            <div className="hm-str" aria-label={`Team strength: you ${strength ?? 'unknown'}, ${opp.tag} ${oppStrength}`}>
              <span className="num hm-str-v me">{strength ?? '–'}</span>
              <div className="hm-str-bars">
                <div className="hm-str-bar me"><i style={{ width: `${strength ?? 0}%` }} /></div>
                <div className="hm-str-bar opp"><i style={{ width: `${oppStrength ?? 0}%` }} /></div>
              </div>
              <span className="num hm-str-v opp">{oppStrength}</span>
              <span className="hm-str-l">
                <span className="label">Team strength</span>
                {edge !== null && <span className={`hm-edge ${edge > 0 ? 'good' : edge < 0 ? 'bad' : ''}`}>{edge === 0 ? 'Even on paper' : edge > 0 ? `+${edge} edge on paper` : `${edge} on paper`}</span>}
              </span>
            </div>
            <div className="hm-actions">
              {c.phase === 'training' ? (
                <>
                  <button className="btn ghost" onClick={() => goTo('train')}>Plan training</button>
                  <button className="btn primary" onClick={quickTrain} disabled={!valid.ok}>{recover ? 'Recovery week' : 'Run training'}</button>
                </>
              ) : (
                <button className="btn primary hm-wide" onClick={onPlay} disabled={!valid.ok}>Go to match</button>
              )}
            </div>
            {c.phase === 'training' && recoverNote}
          </>
        ) : (
          <>
            <div className="hm-hero-top"><span className="label">{c.season.week >= CUP_START ? cupName(c.season.division) : c.season.week > 7 ? 'Playoffs' : 'Bye week'}</span></div>
            <div className="hm-bye">
              <h2>{c.season.week >= CUP_START ? 'You are out of the cup' : 'No match for you this week'}</h2>
              <p className="muted small">The other teams play on. You still train, and idle cards still lose sharpness.</p>
            </div>
            <div className="hm-actions">
              {c.phase === 'training'
                ? <button className="btn primary hm-wide" onClick={quickTrain} disabled={!valid.ok}>{recover ? 'Recovery week' : 'Run training week'}</button>
                : <button className="btn primary hm-wide" onClick={() => update(completeMatchday(world, c, null), 'Week simulated.')}>Simulate the week</button>}
            </div>
            {c.phase === 'training' && recoverNote}
          </>
        )}
        {!valid.ok && <div className="hm-alert" role="alert"><span>{valid.errors[0]}</span><button className="btn small" onClick={() => goTo('squad')}>Fix squad</button></div>}
      </section>

      <NextActions goTo={goTo} openClub={openClub} openPlayer={openPlayer} />

      <button className="panel hm-tile span-4" onClick={() => goTo('league')} aria-label={`League: ${ordinal(pos)} in the ${div.name}. Open the league`}>
        <div className="hm-tile-head"><span className="label">{div.name}</span><span className="hm-go" aria-hidden="true">League ›</span></div>
        <div className="hm-kpi"><span className="hm-big">{ordinal(pos)}</span><span className="faint small">of {table.length}</span><span className="hm-kpi-r num">{me.points} <span className="faint">pts</span></span></div>
        <div className="hm-mini" role="presentation">
          {mini.map((r) => {
            const i = table.indexOf(r);
            const zone = i < 2 && c.season.division < DIVISIONS.length - 1 ? 'up' : i >= table.length - 2 && c.season.division > 0 ? 'down' : '';
            return (
              <div key={r.teamId} className={`hm-mini-row ${r.teamId === HUMAN_ID ? 'me' : ''} ${zone}`}>
                <span className="num">{i + 1}</span>
                <span className="hm-mini-n">{r.teamId === HUMAN_ID ? c.teamName : teamName(c, r.teamId)}</span>
                <span className="num faint">{r.wins}-{r.losses}</span>
                <span className="num">{r.points}</span>
              </div>
            );
          })}
        </div>
        <span className="hm-foot">Top 2 go up{c.season.division > 0 ? ' · bottom 2 go down' : ''}</span>
      </button>

      <button className="panel hm-tile span-4" onClick={openClub} aria-label={`Club money: ${c.coins} coins. Open finances`}>
        <div className="hm-tile-head"><span className="label">Club money</span><span className="hm-go" aria-hidden="true">Finances ›</span></div>
        <div className="hm-kpi"><span className={`hm-big num ${c.coins < 0 ? 'bad' : ''}`}>{money(c.coins)}</span><span className="faint small">coins</span></div>
        <div className="hm-flow">
          <div className="hm-flow-row"><span className="small muted">Income</span><div className="hm-flow-bar good"><i style={{ width: `${(weeklyIn / flowMax) * 100}%` }} /></div><span className="num good">{signed(weeklyIn)}</span></div>
          <div className="hm-flow-row"><span className="small muted">Costs</span><div className="hm-flow-bar bad"><i style={{ width: `${(weeklyOut / flowMax) * 100}%` }} /></div><span className="num bad">{signed(-weeklyOut)}</span></div>
        </div>
        <div className="hm-pair">
          <span><span className="label">Net / week</span><span className={`num ${weeklyIn - weeklyOut >= 0 ? 'good' : 'bad'}`}>{signed(weeklyIn - weeklyOut)}</span></span>
          <span><span className="label">Runway</span><span className="num">{weeklyIn >= weeklyOut ? '∞' : `${Math.max(0, Math.floor(Math.max(0, c.coins) / (weeklyOut - weeklyIn)))} wk`}</span></span>
          <span><span className="label">Sponsor</span><span className={`small ${c.sponsor ? '' : 'bad'}`}>{c.sponsor ? 'Signed' : 'None'}</span></span>
        </div>
      </button>

      <button className="panel hm-tile span-4" onClick={() => goTo('squad')} aria-label="Team form and chemistry. Open the squad">
        <div className="hm-tile-head"><span className="label">Form</span><span className="hm-go" aria-hidden="true">Squad ›</span></div>
        <div className="hm-form">
          <FormPills form={myForm} />
          {last ? <span className="small muted hm-last">Last: <span className={last.won ? 'good' : 'bad'}>{last.won ? 'W' : 'L'}</span> vs {last.opponentTag ?? teamTag(c, last.opponent)} <span className="num">{last.maps.map((m) => `${m.score[0]}-${m.score[1]}`).join(' ')}</span></span> : <span className="small faint">No matches yet</span>}
        </div>
        <div className="hm-chem">
          <div className="row spread"><span className="label">Chemistry</span><span className="num">{Math.round(c.chemistry)}<span className="faint">/100</span></span></div>
          <div className="hm-meter"><i className={c.chemistry >= 65 ? 'good' : c.chemistry < 35 ? 'bad' : ''} style={{ width: `${Math.max(0, Math.min(100, c.chemistry))}%` }} /><b style={{ left: '35%' }} /><b style={{ left: '65%' }} /></div>
        </div>
        <div className="hm-pair">
          <span><span className="label">Fatigue</span><span className={`num ${avgFatigue >= 60 ? 'bad' : ''}`}>{avgFatigue}</span></span>
          <span><span className="label">Squad</span><span className="num">{c.cards.length}/{MAX_SQUAD}</span></span>
          <span><span className="label">Rep</span><span className="num">{Math.round(c.reputation)}</span></span>
        </div>
      </button>

      <BoardPanel className="span-4" />

      {tr && (
        <section className="panel span-8" aria-label="Training result">
          <div className="panel-head"><h2>This week's training</h2></div>
          <span className="small faint">{tr.plan.sessions.map((s) => ACTIVITIES[s].name).join(' · ')}</span>
          <TrainingSummary />
        </section>
      )}

      <section className={`panel ${tr ? '' : 'span-8'}`} aria-label="News">
        <div className="panel-head"><h2>Newsroom</h2><span className="label">Season {c.season.number} · Week {Math.min(c.season.week, 12)}</span></div>
        <ul className="hm-news">{c.news.slice(0, 8).map((n, i) => <li key={i}>{n}</li>)}</ul>
      </section>
    </>
  );
}

function TrainingSummary() {
  const { world, career: c } = useGame();
  const tr = c.lastTraining!;
  const rows = c.lineup.map((s) => {
    const card = c.cards.find((x) => x.cardId === s.cardId)!;
    const p = world.profiles.get(card.playerId)!;
    const gains = Object.entries(tr.outcome.gains[s.cardId] ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 2);
    return { handle: p.record.handle, gains, fatigue: card.fatigue };
  });
  return (
    <div className="hm-train">
      <div className="hm-train-row hm-train-h label"><span>Player</span><span>Top gains</span><span>Fatigue</span></div>
      {rows.map((r) => (
        <div key={r.handle} className="hm-train-row">
          <span className="hm-train-n">{r.handle}</span>
          <span className="small muted">{r.gains.length ? r.gains.map(([a, v]) => `${ATTRIBUTE_LABEL[a as Attribute]} +${(v ?? 0).toFixed(1)}`).join(', ') : 'No gains'}</span>
          <span className={`num small ${r.fatigue >= 60 ? 'bad' : 'faint'}`} title="Fatigue">{Math.round(r.fatigue)}</span>
        </div>
      ))}
      <div className="row wrap">
        {tr.outcome.chemistryDelta > 0 && <span className="chip good">Chemistry +{tr.outcome.chemistryDelta}</span>}
        {tr.outcome.prepBonus > 0 && <span className="chip good">Opponent prep ready</span>}
        {tr.outcome.cost > 0 && <span className="chip">Cost {tr.outcome.cost}</span>}
      </div>
    </div>
  );
}

type Goto = (t: 'squad' | 'train' | 'scout' | 'cases' | 'league') => void;

const TUTORIAL_KEY = 'clutch-manager.tutorial.v1';
const TUTORIAL: { title: string; text: string; cta?: string; go?: 'squad' | 'train' | 'scout' | 'league' | 'club' }[] = [
  { title: 'Your week', text: 'Every week has two steps: train, then play. "Run training" uses your saved plan; "Plan training" lets you change it. After training, "Go to match" starts the veto and the game.' },
  { title: 'The to-do list', text: 'Home lists what needs you now: a sponsor to sign, tired players, expiring contracts, bids for your players. Start by signing a sponsor: it pays every week.', cta: 'Open the club', go: 'club' },
  { title: 'Five players, one coach', text: 'Squad is where you pick five starters and give each a role (entry, AWP, support, lurker, IGL). Players off their role play worse. Changing the five costs chemistry.', cta: 'Open squad', go: 'squad' },
  { title: 'Find better players', text: 'Scout shows every player. Filter by role and price, shortlist, compare two, and make an offer. Every player costs a weekly wage, so watch the club balance.', cta: 'Open scouting', go: 'scout' },
  { title: 'The season', text: 'Seven league weeks, Bo3 playoffs for the top four, then the Clutch Cup against guests from the division above. Top two go up a division. Good luck.', cta: 'See the league', go: 'league' },
];

function Tutorial({ goTo, openClub }: { goTo: Goto; openClub: () => void }) {
  const read = () => { try { return Number(localStorage.getItem(TUTORIAL_KEY) ?? '0'); } catch { return 0; } };
  const [step, setStep] = useState<number>(read);
  const save = (v: number) => { setStep(v); try { localStorage.setItem(TUTORIAL_KEY, String(v)); } catch { /* storage blocked: tutorial just shows again next time */ } };
  if (step >= TUTORIAL.length) return null;
  const t = TUTORIAL[step]!;
  return (
    <section className="panel hm-tut" aria-label="Getting started">
      <div className="hm-tut-steps" aria-hidden="true">{TUTORIAL.map((_, i) => <i key={i} className={i < step ? 'done' : i === step ? 'on' : ''} />)}</div>
      <div className="hm-tut-body">
        <span className="label">Getting started · {step + 1}/{TUTORIAL.length}</span>
        <h3>{t.title}</h3>
        <p className="small muted">{t.text}</p>
      </div>
      <div className="hm-tut-actions">
        <button className="btn small ghost" onClick={() => save(TUTORIAL.length)}>Skip</button>
        {t.go && <button className="btn small" onClick={() => (t.go === 'club' ? openClub() : goTo(t.go!))}>{t.cta}</button>}
        <button className="btn small primary" onClick={() => save(step + 1)}>{step === TUTORIAL.length - 1 ? 'Done' : 'Next'}</button>
      </div>
    </section>
  );
}

/** The manager's to-do list, built from real career state. */
function NextActions({ goTo, openClub, openPlayer }: { goTo: Goto; openClub: () => void; openPlayer: (cardId: string | null, playerId?: string) => void }) {
  const { world, career: c } = useGame();
  const items = buildAlerts(world, c, today()).map((a) => ({
    ...a,
    go: () => (typeof a.target === 'object' ? openPlayer(a.target.cardId) : a.target === 'club' ? openClub() : goTo(a.target)),
  }));
  return (
    <section className="panel hm-todo span-4" aria-label="To do">
      <div className="panel-head"><h2>To do</h2>{items.length > 0 && <span className="chip">{items.length}</span>}</div>
      {items.length ? (
        <div className="hm-todo-list">
          {items.slice(0, 5).map((i) => (
            <button key={i.key} className={`hm-todo-item ${i.tone}`} onClick={i.go}>
              <i aria-hidden="true" />
              <span className="hm-todo-t">{i.text}</span>
              <span className="hm-todo-cta">{i.cta} ›</span>
            </button>
          ))}
          {items.length > 5 && <span className="small faint">+{items.length - 5} more</span>}
        </div>
      ) : (
        <div className="hm-clear"><span className="hm-check" aria-hidden="true">✓</span><span className="small muted">Nothing needs you right now. Train, then play.</span></div>
      )}
    </section>
  );
}
