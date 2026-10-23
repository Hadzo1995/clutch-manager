import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../avatar/Avatar';
import { setLineup } from '../../engine/career';
import { attributeCap, cardAttributes, cardOvr, completeness, effectiveOvr, MAX_STARS } from '../../engine/ratings';
import { PERSONALITY_HELP, PERSONALITY_LABEL, personalityOf, personalityWord, scoutingLine, traitsOf } from '../../engine/profile';
import type { Personality } from '../../engine/profile';
import { roleFit } from '../../engine/team';
import type { LineupSlot } from '../../engine/team';
import { ATTRIBUTES, ATTRIBUTE_LABEL, ATTRIBUTE_ORIGIN, MAPS, ROLES, ROLE_LABEL } from '../../engine/types';
import type { Attribute, CardStats, OwnedCard, PlayerRecord } from '../../engine/types';
import { OvrBadge, RarityChip, RoleIcon, Stars, fmt, useGame, CountryTag, OrgTag } from '../common';
import { AttributeRadar, FormPills, KPI, Meter, RatingBar, TrendChart } from '../charts';
import { ContractPanel, TransferPanel } from './Transfer';
import { playerStatus } from '../../engine/career';
import { marketValue } from '../../engine/economy';
import { DossierTab, MapResults } from './Dossier';

const ORIGIN_LABEL = { observed: 'From stats', inferred: 'Estimated', fictional: 'Game value' } as const;
type Tab = 'overview' | 'dossier' | 'attributes' | 'career' | 'data';
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', dossier: 'Dossier', attributes: 'Attributes', career: 'Career', data: 'Data' };

/** Attributes grouped the way a coach reads them. Every attribute appears exactly once. */
const GROUPS: { name: string; keys: Attribute[] }[] = [
  { name: 'Firepower', keys: ['aim', 'awp', 'entry', 'clutch'] },
  { name: 'Tactical', keys: ['trading', 'utility', 'positioning', 'gameSense'] },
  { name: 'Mental', keys: ['leadership', 'consistency', 'teamwork'] },
];

export function PlayerSheet({ cardId, playerId, onClose }: { cardId: string | null; playerId?: string; onClose: () => void }) {
  const { world, career: c, update } = useGame();
  const [tab, setTab] = useState<Tab>('overview');
  const card = cardId ? c.cards.find((x) => x.cardId === cardId) : c.cards.find((x) => x.playerId === playerId);
  const p = world.profiles.get(card?.playerId ?? playerId ?? '');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!p) return null;
  const attrs = card ? cardAttributes(p, card) : p.base;
  const slot = card ? c.lineup.find((x) => x.cardId === card.cardId) : undefined;
  const pers = personalityOf(p.record.id);
  const traits = traitsOf(attrs, p);
  const st = playerStatus(c, p.record.id);
  const ovr = card ? cardOvr(p, card) : p.ovr;
  const today = card ? effectiveOvr(p, card) : undefined;

  const putIn = (role: (typeof ROLES)[number]) => {
    if (!card) return;
    const next: LineupSlot[] = c.lineup.filter((x) => x.role !== role && x.cardId !== card.cardId);
    next.push({ cardId: card.cardId, role });
    update(setLineup(c, next), `${p.record.handle} is your ${ROLE_LABEL[role]}.`);
    onClose();
  };
  const bench = () => {
    if (!card) return;
    update(setLineup(c, c.lineup.filter((x) => x.cardId !== card.cardId)), `${p.record.handle} moved to the bench.`);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet ps" role="dialog" aria-modal="true" aria-label={p.record.handle} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head ps-head">
          <div className="sheet-id">
            <Avatar seed={p.record.id} size={56} accent="#f0a33a" className={`sheet-ava ava-ring ${p.rarity}`} />
            <div className="stack" style={{ gap: 3, minWidth: 0 }}>
              <h1 className="ps-name">{p.record.handle}</h1>
              <span className="ps-sub">
                <CountryTag cc={p.record.country} /> <OrgTag team={p.record.team} full /> · {p.record.age}y · <RoleIcon role={p.record.primaryRole} /> {ROLE_LABEL[p.record.primaryRole]}<span className="faint"> / {ROLE_LABEL[p.record.secondaryRole]}</span>
              </span>
            </div>
          </div>
          <button className="icon-btn ps-close" onClick={onClose} aria-label="Close profile">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <section className={`ps-hero ${p.rarity}`} aria-label="Ratings summary">
          <div className="ps-hero-main">
            <OvrBadge value={ovr} rarity={p.rarity} size="lg" />
            <div className="ps-hero-txt">
              <div className="row wrap" style={{ gap: 6 }}>
                <RarityChip rarity={p.rarity} />
                <span className="chip">#{p.record.rank} ranked</span>
                {st.owner === 'you' ? <span className="chip t">{slot ? `Starting ${ROLE_LABEL[slot.role]}` : 'Your squad'}</span> : st.owner === 'ai' ? <span className="chip ct">{st.teamTag}</span> : <span className="chip good">Free agent</span>}
              </div>
              <div className="ps-pot" data-tip="Potential is a game estimate of the card's ceiling, not a real-world prediction." tabIndex={0}><span className="label">Potential</span> <b className="num">{p.potential}</b>{card && ovr !== p.ovr && <span className="small faint"> · base {p.ovr}</span>}</div>
              <RatingBar ovr={ovr} potential={p.potential} today={today} />
            </div>
          </div>
          <div className="ps-kpis">
            {card ? <>
              <KPI label="Today" value={today} tone={today! < ovr ? 'warn' : 'good'} tip="Plays at today, after sharpness, fatigue and form." />
              <KPI label="Value" value={fmt(marketValue(p))} tip="Game market value in coins, not a real-world fee." />
              <KPI label="Stars" value={<Stars n={card.stars} />} sub={<span className="num">{card.stars}/{MAX_STARS}</span>} />
              <KPI label="Matches" value={card.matchesPlayed} />
            </> : <>
              <KPI label="Age" value={p.record.age} />
              <KPI label="Value" value={fmt(marketValue(p))} tip="Game market value in coins, not a real-world fee." />
              <KPI label="Rating" value={p.record.stats.rating.toFixed(2)} tip="Source rating from the active dataset." />
              <KPI label="Maps" value={p.record.provenance.sampleMaps} tip="Sample size behind the source stats." />
            </>}
          </div>
        </section>

        <div className="ps-tabs" role="tablist" aria-label="Profile sections">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
          ))}
        </div>

        <div className="ps-body" role="tabpanel" key={tab}>
          {tab === 'overview' && (
            <>
              {card && <ConditionPanel card={card} />}
              {card && (
                <div className="panel inset">
                  <div className="panel-head"><h3>Lineup role</h3>{slot ? <span className="small muted">Now: {ROLE_LABEL[slot.role]}</span> : <span className="small faint">On the bench</span>}</div>
                  <div className="role-pick" role="group" aria-label="Put in the lineup as">
                    {ROLES.map((r) => {
                      const fit = roleFit(p, r);
                      return (
                        <button key={r} aria-pressed={slot?.role === r} onClick={() => putIn(r)} className={fit === 1 ? 'main' : fit >= 0.95 ? 'second' : 'off'}>
                          <RoleIcon role={r} /><span>{ROLE_LABEL[r]}</span><small className="num">{Math.round(fit * 100)}%</small>
                        </button>
                      );
                    })}
                  </div>
                  {slot && <button className="btn small ghost" onClick={bench} style={{ alignSelf: 'flex-start' }}>Move to bench</button>}
                </div>
              )}
              {card ? <ContractPanel cardId={card.cardId} onLeft={onClose} /> : st.owner !== 'you' && <TransferPanel playerId={p.record.id} />}
              <div className="panel inset">
                <h3>Scouting report</h3>
                <p className="small">{scoutingLine(attrs, ATTRIBUTE_LABEL)}</p>
                {traits.length ? (
                  <div className="traits">
                    {traits.map((t) => <div key={t.id} className={`trait ${t.tone}`}><strong className="small">{t.name}</strong><span className="small muted">{t.description}</span></div>)}
                  </div>
                ) : <p className="small faint">No standout traits yet. Training can change that.</p>}
              </div>
              <div className="panel inset">
                <div className="panel-head"><h3>Personality</h3><span className="chip warn">Game values</span></div>
                <div className="pers-grid">
                  {(Object.keys(PERSONALITY_LABEL) as (keyof Personality)[]).map((k) => (
                    <div key={k} className="pers2" data-tip={PERSONALITY_HELP[k]} tabIndex={0}>
                      <div className="row spread small"><span>{PERSONALITY_LABEL[k]}</span><span className="faint">{personalityWord(pers[k])} <b className="num muted">{pers[k]}</b></span></div>
                      <Meter value={pers[k]} max={20} tone={pers[k] >= 13 ? 'good' : pers[k] <= 6 ? 'bad' : 'ink'} />
                    </div>
                  ))}
                </div>
                <p className="small faint">Invented for the game; stays the same when player data is updated. Hover or focus a trait for what it does.</p>
              </div>
            </>
          )}

          {tab === 'dossier' && <DossierTab playerId={p.record.id} card={card} attrs={attrs} />}

          {tab === 'attributes' && (
            <>
              <div className="panel inset">
                <div className="panel-head"><h3>Shape</h3>
                  <span className="legend small"><i className="lg-fill" /> now{card && <><i className="lg-dash" /> base</>}</span>
                </div>
                <AttributeRadar size={340} axes={ATTRIBUTES.map((a) => ({ key: a, label: ATTRIBUTE_LABEL[a], value: attrs[a], base: card ? p.base[a] : undefined }))} />
              </div>
              <div className="panel inset">
                <div className="panel-head"><h3>Attributes</h3><span className="legend small"><i className="lg-gain" /> trained{card && <><i className="lg-ghost" /> cap</>}</span></div>
                <div className="attr-groups">
                  {GROUPS.map((g) => {
                    const avg = Math.round(g.keys.reduce((s, k) => s + attrs[k], 0) / g.keys.length);
                    return (
                      <div key={g.name} className="attr-group">
                        <div className="attr-group-h"><span className="label">{g.name}</span><span className="num small muted">avg {avg}</span></div>
                        {g.keys.map((a) => {
                          const cap = card ? attributeCap(p, card, a) : undefined;
                          const origin = ATTRIBUTE_ORIGIN[a];
                          return (
                            <Meter key={a} value={attrs[a]} base={card ? p.base[a] : undefined} ghost={cap} tone="auto"
                              label={<>{ATTRIBUTE_LABEL[a]} <span className={`origin ${origin}`} title={ORIGIN_LABEL[origin]} role="img" aria-label={ORIGIN_LABEL[origin]} /></>}
                              display={<>{Math.round(attrs[a])}{cap ? <span className="cap">/{Math.round(cap)}</span> : null}</>}
                              title={cap ? `${ATTRIBUTE_LABEL[a]}: ${Math.round(attrs[a])}, training cap ${Math.round(cap)}` : undefined} />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <p className="small faint origin-key"><span className="origin observed" /> from stats <span className="origin inferred" /> estimated from several stats <span className="origin fictional" /> game value with no public measurement.{card ? ' The small number is the training cap; more stars raise it.' : ''}</p>
              </div>
              <div className="panel inset">
                <div className="panel-head"><h3>Map skill</h3><span className="small faint">best first</span></div>
                <div className="map-grid">
                  {[...MAPS].sort((a, b) => p.mapSkill[b] - p.mapSkill[a]).map((m) => {
                    const has = !!p.record.stats.mapRatings[m];
                    return <Meter key={m} value={p.mapSkill[m]} tone={has ? 'auto' : 'ink'} label={<>{m}{!has && <span className="faint"> · est.</span>}</>} title={has ? undefined : 'No map data: estimated'} />;
                  })}
                </div>
              </div>
            </>
          )}

          {tab === 'career' && (card ? <CareerTab card={card} /> : <div className="panel inset empty-state"><p className="small muted">Career stats appear once this player is in your collection and plays for you. See the Data tab for source stats.</p></div>)}

          {tab === 'data' && <DataTab profileId={p.record.id} />}
        </div>
      </div>
    </div>
  );
}

function ConditionPanel({ card }: { card: OwnedCard }) {
  const sharp = Math.round(card.sharpness), fat = Math.round(card.fatigue), mor = Math.round(card.morale);
  return (
    <div className="panel inset">
      <div className="panel-head"><h3>Condition</h3>
        <span className={`chip ${card.form > 0 ? 'good' : card.form < 0 ? 'bad' : ''}`} title="Form: -10 to +10">Form <span className="num">{card.form > 0 ? '+' : ''}{card.form}</span></span>
      </div>
      <div className="cond-grid">
        <Meter value={sharp} label="Sharpness" tone={sharp >= 70 ? 'good' : sharp < 35 ? 'bad' : 'warn'} />
        <Meter value={fat} label="Fatigue" tone={fat >= 60 ? 'bad' : fat >= 35 ? 'warn' : 'good'} />
        <Meter value={mor} label="Morale" tone={mor >= 65 ? 'good' : mor < 35 ? 'bad' : 'ct'} />
      </div>
      <p className="small faint">Idle players lose sharpness every week. Training and matches bring it back; rest lowers fatigue.</p>
    </div>
  );
}

function CareerTab({ card }: { card: OwnedCard }) {
  const st: CardStats | undefined = card.stats;
  const log = card.log ?? [];
  const ovr = card.ovrHistory ?? [];
  const dev = ovr.length > 1 ? <div className="panel inset"><TrendChart label="Development · card OVR by week" values={ovr} digits={0} /></div> : null;
  if (!st || st.maps === 0) {
    return <>
      <div className="panel inset empty-state"><p className="small muted">No matches for your team yet. Play a match with this player in the lineup.</p></div>
      {dev}
    </>;
  }
  const r = st.rounds || 1;
  const avg = st.ratingSum / st.maps;
  const kd = st.kills - st.deaths;
  const rows: [string, string][] = [
    ['Kills / round', (st.kills / r).toFixed(2)],
    ['Headshot %', st.kills ? `${Math.round((st.headshots / st.kills) * 100)}%` : '—'],
    ['Opening duels', `${st.openingKills}-${st.openingDeaths}`],
    ['Clutches won', String(st.clutchesWon)],
    ['Multi-kill rounds', String(st.multiKillRounds)],
    ['Utility dmg / round', (st.utilityDamage / r).toFixed(1)],
    ['Enemies flashed', String(st.enemiesFlashed)],
    ['Match MVPs', String(st.mvps)],
  ];
  const games = [...log].reverse();
  return (
    <>
      <div className="kpi-row five">
        <KPI label="Maps" value={st.maps} />
        <KPI label="Rating" value={avg.toFixed(2)} tone={avg >= 1.1 ? 'good' : avg < 0.9 ? 'bad' : undefined} tip="This game's own formula, about 1.00 on average (not HLTV's)." />
        <KPI label="K-D" value={`${kd >= 0 ? '+' : ''}${kd}`} tone={kd > 0 ? 'good' : kd < 0 ? 'bad' : undefined} sub={<span className="num">{st.kills}-{st.deaths}</span>} />
        <KPI label="ADR" value={(st.damage / r).toFixed(1)} />
        <KPI label="KAST" value={`${Math.round((st.kastRounds / r) * 100)}%`} />
      </div>
      {games.length > 0 && (
        <div className="panel inset">
          <div className="panel-head"><h3>Form</h3><span className="small faint">{games.length === 1 ? 'last map' : `last ${Math.min(10, games.length)} maps, newest right`}</span></div>
          <FormPills games={games.map((l) => ({ won: l.won, rating: l.rating, title: `${l.map} v ${l.opponent} ${l.score[0]}-${l.score[1]} · ${l.kills}-${l.deaths}, rating ${l.rating.toFixed(2)}` }))} />
          {games.length > 1 && <TrendChart label="Rating by map" values={games.map((l) => l.rating)} digits={2} mid={1} midLabel="1.00 = average" summary="avg" />}
        </div>
      )}
      <MapResults card={card} />
      {dev}
      <div className="panel inset">
        <h3>Details</h3>
        <dl className="kv">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}
        </dl>
      </div>
      {log.length > 0 && (
        <div className="panel inset">
          <h3>Recent maps</h3>
          <table className="tbl ps-log">
            <thead><tr><th>Map</th><th>Score</th><th>K-D</th><th>ADR</th><th>Rtg</th></tr></thead>
            <tbody>
              {log.slice(0, 10).map((l, i) => (
                <tr key={i}>
                  <td className="name">{l.map} <span className="faint">v {l.opponent}</span></td>
                  <td><span className={`res ${l.won ? 'w' : 'l'}`}>{l.score[0]}-{l.score[1]}</span></td>
                  <td>{l.kills}-{l.deaths}</td>
                  <td>{l.adr}</td>
                  <td className={l.rating >= 1.1 ? 'good' : l.rating < 0.9 ? 'bad' : ''}>{l.rating.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type StatKey = 'rating' | 'kpr' | 'dpr' | 'apr' | 'adr' | 'kast' | 'openingKillsPerRound' | 'openingSuccess' | 'awpKillShare' | 'clutchWinRate' | 'utilityDamagePerRound' | 'flashAssistsPerRound';
const DATA_ROWS: { key: StatKey; label: string; fmt: (n: number) => string; lowerBetter?: boolean }[] = [
  { key: 'rating', label: 'Rating (source)', fmt: (n) => n.toFixed(2) },
  { key: 'kpr', label: 'Kills / round', fmt: (n) => n.toFixed(2) },
  { key: 'dpr', label: 'Deaths / round', fmt: (n) => n.toFixed(2), lowerBetter: true },
  { key: 'apr', label: 'Assists / round', fmt: (n) => n.toFixed(2) },
  { key: 'adr', label: 'ADR', fmt: (n) => n.toFixed(1) },
  { key: 'kast', label: 'KAST', fmt: (n) => `${(n * 100).toFixed(1)}%` },
  { key: 'openingKillsPerRound', label: 'Opening kills / round', fmt: (n) => n.toFixed(3) },
  { key: 'openingSuccess', label: 'Opening duels won', fmt: (n) => `${(n * 100).toFixed(1)}%` },
  { key: 'awpKillShare', label: 'AWP kill share', fmt: (n) => `${(n * 100).toFixed(1)}%` },
  { key: 'clutchWinRate', label: 'Clutch win rate', fmt: (n) => `${(n * 100).toFixed(1)}%` },
  { key: 'utilityDamagePerRound', label: 'Utility damage / round', fmt: (n) => n.toFixed(1) },
  { key: 'flashAssistsPerRound', label: 'Flash assists / round', fmt: (n) => n.toFixed(3) },
];

function DataTab({ profileId }: { profileId: string }) {
  const { world } = useGame();
  const p = world.profiles.get(profileId)!;
  const s = p.record.stats;
  const conf = completeness(p.record);
  // Percentile of each stat against everyone in the database: the bar answers "is that good?".
  const dist = useMemo(() => {
    const out = {} as Record<StatKey, number[]>;
    for (const row of DATA_ROWS) {
      out[row.key] = world.profileList.map((x) => (x.record.stats as PlayerRecord['stats'])[row.key] as number | null).filter((v): v is number => v !== null && v !== undefined).sort((a, b) => a - b);
    }
    return out;
  }, [world]);
  const pctile = (key: StatKey, v: number, lower?: boolean) => {
    const arr = dist[key];
    if (!arr.length) return 50;
    let below = 0;
    for (const x of arr) if (lower ? x > v : x < v) below++;
    return Math.round((below / arr.length) * 100);
  };
  return (
    <div className="panel inset">
      <div className="panel-head"><h3>Observed stats</h3><span className={`chip ${p.record.provenance.kind === 'synthetic' ? 'warn' : 'good'}`}>{p.record.provenance.kind === 'synthetic' ? 'Synthetic demo' : p.record.provenance.kind === 'public' ? 'Real player · our rating' : 'Imported'}</span></div>
      <div className="data-head small faint" aria-hidden="true"><span>Stat</span><span>Percentile vs all {world.profileList.length} players</span><span>Value</span></div>
      <div className="data-rows">
        {DATA_ROWS.map((row) => {
          const v = (s as PlayerRecord['stats'])[row.key] as number | null;
          if (v === null || v === undefined) return <div key={row.key} className="data-row nodata"><span>{row.label}</span><span className="faint small">no data</span><span className="faint num">—</span></div>;
          const pc = pctile(row.key, v, row.lowerBetter);
          return (
            <div key={row.key} className="data-row">
              <span>{row.label}</span>
              <Meter value={pc} tone={pc >= 80 ? 'good' : pc >= 50 ? 'ct' : pc >= 25 ? 'warn' : 'bad'} size="sm" />
              <span className="num">{row.fmt(v)} <small className="faint">p{pc}</small></span>
            </div>
          );
        })}
      </div>
      <p className="small faint">
        Source: {p.record.provenance.source} · snapshot {p.record.provenance.snapshotDate} · {p.record.provenance.sampleMaps} {p.record.provenance.kind === 'public' ? 'team matches counted by Valve' : 'maps'} · data completeness {Math.round(conf * 100)}%.
        {p.record.provenance.kind === 'synthetic' && ' This player and these numbers are fictional.'}
        {p.record.provenance.kind === 'public' && ' The rating is our own game number, not an official statistic.'}
      </p>
    </div>
  );
}
