import { useState } from 'react';
import { lineupValidation, previewForClub, profileOf, runTrainingWeek, setPlan } from '../../engine/career';
import { ACTIVITIES, REPEAT_FACTORS, planCost, runTraining, totalExpectedGain, validatePlan } from '../../engine/training';
import type { Activity, ActivityId, TrainingOutcome, TrainingPlan } from '../../engine/training';
import { ATTRIBUTES, ATTRIBUTE_LABEL, MAPS, ROLE_LABEL } from '../../engine/types';
import type { Attribute, MapName } from '../../engine/types';
import { Bar, Coin, useGame } from '../common';
import { Avatar } from '../avatar/Avatar';
import { MAP_HUE, mapArt } from '../mapart';
import type { CSSProperties } from 'react';
import '../styles/train.css';

const ORDER: ActivityId[] = ['aim', 'deathmatch', 'utility', 'awp', 'entrytrade', 'clutch', 'scrims', 'review', 'mapprep', 'coaching', 'rest', 'bootcamp'];

/** Short "what it trains" tags for an activity. */
function effects(a: Activity): string[] {
  const out = (Object.entries(a.gains) as [Attribute, number][]).sort((x, y) => y[1] - x[1]).map(([k]) => ATTRIBUTE_LABEL[k]);
  if (a.focusOnly) out.push('Individual focus ×2');
  if (a.chemistry) out.push(`Chemistry +${a.chemistry}`);
  if (a.focusMapPractice) out.push('Focus map');
  if (a.allMapPractice) out.push('All maps');
  if (a.prep) out.push('Opponent prep');
  if (a.morale) out.push('Morale');
  return out;
}

function FatigueTag({ v }: { v: number }) {
  return <span className={`tr-fat ${v > 0 ? (v >= 10 ? 'hi' : '') : 'rec'}`}>{v > 0 ? '+' : ''}{v} fatigue</span>;
}

/** `daily`: tournament clubs train once a calendar day instead of once a week. */
export function Train({ goHome, daily }: { goHome: () => void; daily?: { done: boolean; run: () => void } }) {
  const { world, career: c, update, toast } = useGame();
  const [editing, setEditing] = useState<number | null>(null);
  const [pinned, setPinned] = useState<{ plan: TrainingPlan; outcome: TrainingOutcome } | null>(null);
  const plan = c.plan;
  const valid = lineupValidation(c);
  const coach = c.coachId ? world.coachById.get(c.coachId) ?? null : null;
  const members = valid.ok ? c.lineup.map((s) => { const card = c.cards.find((x) => x.cardId === s.cardId)!; return { card, profile: profileOf(world, card) }; }) : [];
  const preview = valid.ok && validatePlan(plan).length === 0 ? previewForClub(c, runTraining(plan, members, coach)) : null;
  const isBootcamp = plan.sessions[0] === 'bootcamp';
  const done = daily ? daily.done : c.phase !== 'training';
  const unit = daily ? 'day' : 'week';
  const cost = planCost(plan);

  const setSessions = (sessions: ActivityId[]) => update(setPlan(c, { ...plan, sessions }));
  const chooseActivity = (slot: number, id: ActivityId) => {
    if (id === 'bootcamp') setSessions(['bootcamp']);
    else {
      const base: ActivityId[] = isBootcamp ? ['aim', 'scrims', 'review'] : [...plan.sessions];
      base[slot] = id;
      setSessions(base);
    }
    setEditing(null);
  };

  const run = () => {
    if (daily) { daily.run(); return; }
    try {
      update(runTrainingWeek(world, c), 'Training week done. Matchday is next.');
      goHome();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const repeatOf = (i: number) => plan.sessions.slice(0, i).filter((s) => s === plan.sessions[i]).length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Training</h1>
          <p className="sub">Plan three sessions, set each player's focus, then run the {unit}.</p>
        </div>
        <div className="tr-head-meta">
          <span className="small faint">{daily ? 'Cost' : 'Week cost'}</span>
          <span className="num tr-head-cost">{cost > 0 ? <Coin amount={cost} /> : 'Free'}</span>
        </div>
      </header>
      {done && <div className="tr-done" role="status">{daily ? <><b>Today's training is done.</b> Your squad can train again tomorrow.</> : <><b>This week's training is done.</b> Play the match from Home, then plan next week.</>}</div>}

      <div className="tr-col span-7">
        <section className="panel" aria-label="Weekly plan">
          <div className="panel-head"><h2>Weekly plan</h2><span className="small faint">Repeats give 100%, then 50%, then 25%</span></div>
          <div className={`tr-slots ${isBootcamp ? 'one' : ''}`}>
            {(isBootcamp ? ['bootcamp' as ActivityId] : plan.sessions).map((id, i) => {
              const a = ACTIVITIES[id];
              const rep = isBootcamp ? 0 : repeatOf(i);
              return (
                <button key={i} className="tr-slot" style={actStyle(id)} onClick={() => setEditing(i)} disabled={done} aria-label={`${isBootcamp ? 'Whole week' : `Session ${i + 1}`}: ${a.name}. Change`}>
                  <span className="tr-slot-top">
                    <span className="label">{isBootcamp ? 'Whole week' : `Session ${i + 1}`}</span>
                    {rep > 0 && <span className="chip warn">{Math.round((REPEAT_FACTORS[rep] ?? 0.25) * 100)}% effect</span>}
                  </span>
                  <ActIcon id={id} className="tr-slot-ico" />
                  <strong className="tr-slot-name">{a.name}</strong>
                  <span className="tr-slot-fx small">{effects(a).slice(0, 3).join(' · ') || 'Recovery'}</span>
                  <span className="tr-slot-foot">
                    <FatigueTag v={a.fatigue} />
                    {a.cost > 0 && <Coin amount={a.cost} />}
                    <span className="tr-slot-edit" aria-hidden="true">Change</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="stack tr-mappick" style={{ gap: 8 }}>
            <span className="label" id="tr-map-label">Focus map · used by scrims, map prep and bootcamp</span>
            <div className="tr-maps" role="radiogroup" aria-labelledby="tr-map-label">
              {MAPS.map((m) => (
                <button key={m} role="radio" aria-checked={plan.focusMap === m} className="tr-map" style={{ ['--art' as string]: `url(${mapArt(m as MapName)})`, ['--mh' as string]: MAP_HUE[m as MapName] } as CSSProperties} disabled={done} onClick={() => update(setPlan(c, { ...plan, focusMap: m as MapName }))}>
                  <span className="tr-map-name">{m}</span>
                  <span className="tr-map-v num">{Math.round(c.mapPractice[m])}</span>
                  <Bar value={c.mapPractice[m]} tone={plan.focusMap === m ? 't' : ''} />
                </button>
              ))}
            </div>
          </div>
        </section>

        {valid.ok && (
          <section className="panel" aria-label="Individual focus">
            <div className="panel-head"><h2>Individual focus</h2><span className="small faint">+60% on the focus, -15% elsewhere</span></div>
            <div className="tr-players">
              {members.map(({ card, profile }) => (
                <div key={card.cardId} className="tr-player">
                  <Avatar seed={card.playerId} size={36} />
                  <div className="tr-player-id">
                    <span className="tr-player-name">{profile.record.handle}</span>
                    <span className="small faint">{ROLE_LABEL[profile.record.primaryRole]}</span>
                  </div>
                  <div className="tr-player-fat" title={`${Math.round(card.fatigue)} fatigue`}>
                    <span className="small faint">Fatigue <b className={`num ${card.fatigue >= 60 ? 'bad' : card.fatigue >= 40 ? 'warn-col' : ''}`}>{Math.round(card.fatigue)}</b></span>
                    <Bar value={card.fatigue} tone={card.fatigue >= 60 ? 'bad' : card.fatigue >= 40 ? 'warn' : 'good'} />
                  </div>
                  <select className="inline" id={`focus-${card.cardId}`} aria-label={`Focus for ${profile.record.handle}`} disabled={done} value={plan.individualFocus[card.cardId] ?? ''} onChange={(e) => update(setPlan(c, { ...plan, individualFocus: { ...plan.individualFocus, [card.cardId]: (e.target.value || null) as Attribute | null } }))}>
                    <option value="">No focus</option>
                    {ATTRIBUTES.map((a) => <option key={a} value={a}>{ATTRIBUTE_LABEL[a]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>
        )}
        {!valid.ok && <p className="bad small">{valid.errors[0]}</p>}
      </div>

      <div className="tr-col tr-side span-5">
        {preview && (
          <section className="panel tr-effect" aria-label="Expected effect">
            <div className="panel-head"><h2>Expected effect</h2><span className="small faint">Average outcome; results vary</span></div>
            <OutcomeSummary outcome={preview} plan={plan} />
            {pinned && (
              <div className="tr-compare">
                <div className="panel-head"><span className="label">Compared with pinned plan</span><button className="btn small ghost" onClick={() => setPinned(null)}>Clear</button></div>
                <p className="small muted">{pinned.plan.sessions.map((s) => ACTIVITIES[s].name).join(' · ')}</p>
                <CompareRow a={preview} b={pinned.outcome} />
              </div>
            )}
            <div className="tr-actions">
              <button className="btn ghost" onClick={() => { setPinned({ plan: structuredClone(plan), outcome: preview }); toast('Plan pinned. Change the sessions to compare.'); }}>Pin to compare</button>
              <button className="btn primary tr-run" onClick={run} disabled={done || c.coins < cost}>{cost > 0 ? `Run ${unit} · ${cost} coins` : `Run ${unit}`}</button>
            </div>
            {!done && c.coins < cost && <p className="small bad">Not enough coins for this plan.</p>}
          </section>
        )}
      </div>

      {preview && !done && (
        <div className="tr-runbar" role="region" aria-label="Run the training week">
          <div className="tr-runbar-info">
            <span className="small faint">{plan.sessions.map((s) => ACTIVITIES[s].name).join(' · ')}</span>
            <span className="tr-runbar-kpis small"><b className="num good">+{totalExpectedGain(preview)}</b> skill pts<span className="faint"> · </span>{cost > 0 ? <Coin amount={cost} /> : <span className="good">Free</span>}</span>
          </div>
          <button className="btn primary" onClick={run} disabled={c.coins < cost}>Run {unit}</button>
        </div>
      )}

      {editing !== null && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="sheet" role="dialog" aria-label="Choose a session" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <div className="stack" style={{ gap: 2 }}><span className="label">{isBootcamp ? 'Whole week' : `Session ${editing + 1}`}</span><h2>Choose an activity</h2></div>
              <button className="btn small ghost" onClick={() => setEditing(null)}>Close</button>
            </div>
            <p className="small muted">Repeating a session in the same week gives 100%, then 50%, then 25%. A bootcamp takes the whole week.</p>
            <div className="tr-acts">
              {ORDER.map((id) => {
                const a = ACTIVITIES[id];
                const elsewhere = !isBootcamp && plan.sessions.some((s, i) => s === id && i !== editing);
                return (
                  <button key={id} className={`tr-act ${id === 'bootcamp' ? 'wide' : ''}`} style={actStyle(id)} aria-pressed={isBootcamp ? id === 'bootcamp' : plan.sessions[editing] === id} onClick={() => chooseActivity(editing, id)}>
                    <span className="tr-act-top"><strong><ActIcon id={id} className="tr-act-ico" />{a.name}</strong><span className="row small" style={{ gap: 8 }}>{a.cost > 0 && <Coin amount={a.cost} />}<FatigueTag v={a.fatigue} /></span></span>
                    <span className="small muted">{a.description}</span>
                    <span className="tr-act-tags">
                      {effects(a).map((t) => <span key={t} className="chip">{t}</span>)}
                      {elsewhere && <span className="chip warn">Already planned</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OutcomeSummary({ outcome, plan }: { outcome: TrainingOutcome; plan: TrainingPlan }) {
  const { world, career: c } = useGame();
  const fats = Object.values(outcome.fatigueAfter);
  const avgFat = Math.round(fats.reduce((a, b) => a + b, 0) / Math.max(1, fats.length));
  const mapDelta = Math.round(outcome.mapPracticeDelta[plan.focusMap] ?? 0);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="tr-kpis">
        <div className="stat"><span className="label">Skill pts</span><span className="v num good">+{totalExpectedGain(outcome)}</span></div>
        <div className="stat"><span className="label">Chemistry</span><span className={`v num ${outcome.chemistryDelta > 0 ? 'good' : ''}`}>+{outcome.chemistryDelta}</span></div>
        <div className="stat"><span className="label">{plan.focusMap}</span><span className={`v num ${mapDelta > 0 ? 'good' : ''}`}>+{mapDelta}</span></div>
        <div className="stat"><span className="label">Fatigue</span><span className={`v num ${avgFat >= 60 ? 'bad' : ''}`}>{avgFat}</span></div>
      </div>
      <div className="tr-out">
        {c.lineup.map((s) => {
          const card = c.cards.find((x) => x.cardId === s.cardId)!;
          const p = world.profiles.get(card.playerId)!;
          const g = Object.entries(outcome.gains[s.cardId] ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 3);
          const fat = outcome.fatigueAfter[s.cardId] ?? 0;
          return (
            <div key={s.cardId} className="tr-out-row">
              <span className="tr-out-name">{p.record.handle}</span>
              <span className="tr-out-gains small">{g.length ? g.map(([a, v]) => <span key={a}>{ATTRIBUTE_LABEL[a as Attribute]} <b className="num good">+{(v ?? 0).toFixed(2)}</b></span>) : <span className="faint">No skill gains</span>}</span>
              <span className={`tr-out-fat num small ${fat >= 60 ? 'bad' : 'faint'}`} title="Fatigue by matchday">{Math.round(fat)}</span>
            </div>
          );
        })}
        <div className="tr-out-legend small faint"><span>Top gains this week</span><span>Fatigue by matchday</span></div>
      </div>
      {(outcome.prepBonus > 0 || fats.some((f) => f >= 60)) && (
        <div className="row wrap">
          {outcome.prepBonus > 0 && <span className="chip good">Opponent prep</span>}
          {fats.some((f) => f >= 60) && <span className="chip bad">Players getting tired</span>}
        </div>
      )}
    </div>
  );
}

function CompareRow({ a, b }: { a: TrainingOutcome; b: TrainingOutcome }) {
  const avgFat = (o: TrainingOutcome) => Math.round(Object.values(o.fatigueAfter).reduce((x, y) => x + y, 0) / Math.max(1, Object.values(o.fatigueAfter).length));
  const rows: [string, string | number, string | number][] = [
    ['Attribute points', totalExpectedGain(a), totalExpectedGain(b)],
    ['Chemistry', `+${a.chemistryDelta}`, `+${b.chemistryDelta}`],
    ['Avg fatigue after', avgFat(a), avgFat(b)],
    ['Prep bonus', a.prepBonus > 0 ? 'Yes' : 'No', b.prepBonus > 0 ? 'Yes' : 'No'],
    ['Cost', a.cost, b.cost],
  ];
  return (
    <table className="tbl"><thead><tr><th></th><th>Current</th><th>Pinned</th></tr></thead>
      <tbody>{rows.map(([k, x, y]) => <tr key={k}><td className="name">{k}</td><td>{x}</td><td>{y}</td></tr>)}</tbody>
    </table>
  );
}

/** Activity families, each with its own colour: mechanics (amber-red), tactics (blue), recovery (green), coaching (violet), bootcamp (gold). */
const ACT_KIND: Record<ActivityId, [string, string]> = {
  aim: ['#f0a33a', 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 100 8 4 4 0 000-8z'],
  deathmatch: ['#f06a5f', 'M5 19L19 5M15 5h4v4M9 19H5v-4M5 5l5 5M19 19l-5-5'],
  awp: ['#f0a33a', 'M3 12h12M15 9v6l6-3zM6 9v6'],
  entrytrade: ['#f06a5f', 'M4 12h12M12 6l6 6-6 6M4 6v12'],
  clutch: ['#e8c547', 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z'],
  utility: ['#5aa9e6', 'M8 14a5 5 0 1010 0 5 5 0 00-10 0zM13 9V5M11 5h4M6 6l2 2'],
  scrims: ['#5aa9e6', 'M4 18l6-6-6-6M12 18h8M12 6h8M12 12h5'],
  review: ['#5aa9e6', 'M3 5h18v11H3zM8 20h8M12 16v4M7 12l3-3 3 2 4-4'],
  mapprep: ['#5aa9e6', 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15'],
  coaching: ['#b58cff', 'M12 4a4 4 0 110 8 4 4 0 010-8zM4 21c0-4 4-6 8-6s8 2 8 6'],
  rest: ['#4cc38a', 'M20 14A8 8 0 0110 4a8 8 0 1010 10z'],
  bootcamp: ['#e3b23c', 'M3 20l9-16 9 16zM9 20l3-6 3 6'],
} as Record<ActivityId, [string, string]>;
const actStyle = (id: ActivityId) => ({ ['--ac' as string]: ACT_KIND[id]?.[0] ?? '#f0a33a' } as CSSProperties);
function ActIcon({ id, className }: { id: ActivityId; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ACT_KIND[id]?.[1] ?? ''} /></svg>;
}
