import { Avatar } from '../avatar/Avatar';
import { MAX_SQUAD, coachWage } from '../../engine/economy';
import { useState } from 'react';
import { autoLineup, hireCoach, humanSnapshot, lineupValidation, profileOf, setLineup, setTactics } from '../../engine/career';
import { TacticsEditor } from './Match';
import { coachOverall } from '../../engine/data/coaches';
import { cardOvr, effectiveOvr } from '../../engine/ratings';
import { coordination, roleFit, teamStrength } from '../../engine/team';
import type { LineupSlot } from '../../engine/team';
import { COACH_ATTRIBUTES, COACH_ATTRIBUTE_LABEL, RARITIES, ROLES, ROLE_LABEL } from '../../engine/types';
import type { Coach, OwnedCard, PlayerProfile, Rarity, Role } from '../../engine/types';
import { Coin, OvrBadge, PlayerCard, RARITY_LABEL, RoleIcon, useGame, CountryTag } from '../common';
import { Meter } from '../charts';

type Sort = 'ovr' | 'sharp' | 'new';

const fitLabel = (fit: number) => (fit === 1 ? 'Main role' : fit >= 0.95 ? 'Second role' : 'Off-role');
const chemTone = (v: number) => (v >= 65 ? 'good' : v < 35 ? 'bad' : 'warn');

export function Squad() {
  const { world, career: c, update, openPlayer } = useGame();
  const [picking, setPicking] = useState<Role | null>(null);
  const [market, setMarket] = useState(false);
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [rarityFilter, setRarityFilter] = useState<Rarity | 'all'>('all');
  const [sort, setSort] = useState<Sort>('ovr');
  const valid = lineupValidation(c);
  const snap = valid.ok ? humanSnapshot(world, c) : null;
  const coach = c.coachId ? world.coachById.get(c.coachId) : undefined;
  const slotFor = (role: Role) => c.lineup.find((s) => s.role === role);
  const wages = c.cards.reduce((sum, x) => sum + (x.contract?.wage ?? 0), 0);

  const assign = (role: Role, cardId: string) => {
    const next: LineupSlot[] = c.lineup.filter((s) => s.role !== role && s.cardId !== cardId);
    next.push({ cardId, role });
    update(setLineup(c, next), 'Lineup updated. New players cost some chemistry at the next training.');
    setPicking(null);
  };

  const collection = c.cards
    .map((card) => ({ card, p: profileOf(world, card) }))
    .filter(({ p }) => (roleFilter === 'all' || p.record.primaryRole === roleFilter) && (rarityFilter === 'all' || p.rarity === rarityFilter))
    .sort((a, b) => sort === 'ovr' ? effectiveOvr(b.p, b.card) - effectiveOvr(a.p, a.card) : sort === 'sharp' ? b.card.sharpness - a.card.sharpness : b.card.acquiredWeek - a.card.acquiredWeek || b.card.cardId.localeCompare(a.card.cardId));
  const roleCount = (r: Role) => c.cards.filter((card) => profileOf(world, card).record.primaryRole === r).length;

  const chem = Math.round(c.chemistry);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Squad</h1>
          <div className="sub"><span className="num">{c.cards.length}/{MAX_SQUAD}</span> players · wages <span className="num">{wages}</span>/wk</div>
        </div>
        <button className="btn small" onClick={() => update(setLineup(c, autoLineup(world, c)), 'Best available lineup selected.')}>
          <svg className="btn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4" /></svg>
          Auto-pick best five
        </button>
      </header>

      <section className="panel xi-panel" aria-labelledby="xi-h">
        <div className="xi-head">
          <h2 id="xi-h">Starting five</h2>
          <div className="xi-kpis">
            <div className="xi-kpi" data-tip="Overall team rating used by the match engine." tabIndex={0}>
              <span className="label">Strength</span><b className="num">{snap ? teamStrength(snap) : '—'}</b>
              {snap && <Meter value={teamStrength(snap)} tone="t" size="sm" />}
            </div>
            <div className="xi-kpi" data-tip="How well the five work together: role fit, coach and chemistry." tabIndex={0}>
              <span className="label">Coordination</span><b className="num">{snap ? Math.round(coordination(snap)) : '—'}</b>
              {snap && <Meter value={coordination(snap)} tone="ct" size="sm" />}
            </div>
            <div className="xi-kpi" data-tip="Grows when the same five play together; lineup changes cost some." tabIndex={0}>
              <span className="label">Chemistry</span><b className={`num tone-${chemTone(chem)}`}>{chem}</b>
              <Meter value={chem} tone={chemTone(chem)} size="sm" />
            </div>
          </div>
        </div>

        <ol className={`xi chem-${chemTone(chem)}`} aria-label="Starting five by role">
          {ROLES.map((role) => {
            const slot = slotFor(role);
            const card = slot ? c.cards.find((x) => x.cardId === slot.cardId) : undefined;
            const p = card ? profileOf(world, card) : undefined;
            return <XiSlot key={role} role={role} card={card} p={p} onOpen={() => card && openPlayer(card.cardId)} onPick={() => setPicking(role)} />;
          })}
        </ol>
        {!valid.ok && <p className="small bad xi-err" role="alert">{valid.errors.join(' ')}</p>}
        <p className="small faint">Each role is used once. Off-role players play at about 88% of their level; their secondary role at 95%. The links between slots show team chemistry.</p>
      </section>

      <section className="panel sq-coach" aria-labelledby="coach-h">
        <div className="panel-head"><h2 id="coach-h">Head coach</h2><button className="btn small ghost" onClick={() => setMarket(true)}>Coach market</button></div>
        {coach ? <CoachBlock coach={coach} /> : (
          <div className="empty-state">
            <p className="muted">No coach. Hire one before your next match.</p>
            <button className="btn small primary" onClick={() => setMarket(true)}>Find a coach</button>
          </div>
        )}
      </section>

      <section className="panel sq-plan" aria-labelledby="plan-h">
        <div className="panel-head"><h2 id="plan-h">Game plan</h2><span className="small faint">Saved as your default · fine-tune it in match prep, at halftime and in timeouts</span></div>
        <TacticsEditor tactics={c.tactics} onChange={(t) => update(setTactics(c, t))} />
      </section>

      <section className="panel sq-coll" aria-labelledby="coll-h">
        <div className="panel-head"><h2 id="coll-h">Collection</h2><span className="small muted"><span className="num">{collection.length}</span> shown · <span className="pc-legend">✓</span> in starting five</span></div>
        <div className="coll-tools">
          <div className="chipset" role="group" aria-label="Filter by role">
            <button aria-pressed={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>All <span className="num">{c.cards.length}</span></button>
            {ROLES.map((r) => (
              <button key={r} aria-pressed={roleFilter === r} onClick={() => setRoleFilter(r)} aria-label={`${ROLE_LABEL[r]} (${roleCount(r)})`} title={ROLE_LABEL[r]}>
                <RoleIcon role={r} /><span className="chip-txt">{ROLE_LABEL[r]}</span> <span className="num">{roleCount(r)}</span>
              </button>
            ))}
          </div>
          <div className="coll-tools-r">
            <select className="inline" id="sq-rarity" aria-label="Filter by rarity" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value as Rarity | 'all')}>
              <option value="all">All rarities</option>{RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}
            </select>
            <div className="seg compact" role="group" aria-label="Sort">
              {([['ovr', 'Best'], ['sharp', 'Sharpest'], ['new', 'Newest']] as const).map(([k, l]) => <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
            </div>
          </div>
        </div>
        <div className="cards dense">
          {collection.map(({ card }) => (
            <PlayerCard key={card.cardId} world={world} card={card} compact selected={c.lineup.some((s) => s.cardId === card.cardId)} onClick={() => openPlayer(card.cardId)} />
          ))}
        </div>
        {collection.length === 0 && (
          <div className="empty-state"><p className="muted small">No cards match these filters.</p><button className="btn small ghost" onClick={() => { setRoleFilter('all'); setRarityFilter('all'); }}>Clear filters</button></div>
        )}
      </section>

      {picking && (
        <div className="overlay" onClick={() => setPicking(null)}>
          <div className="sheet" role="dialog" aria-label={`Choose ${ROLE_LABEL[picking]}`} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 className="row"><RoleIcon role={picking} /> Choose your {ROLE_LABEL[picking]}</h2>
              <button className="btn small ghost" onClick={() => setPicking(null)}>Close</button>
            </div>
            <p className="small muted">Ranked by how well each player would perform in this role right now (level × role fit, after sharpness and fatigue).</p>
            <div className="pick-list" role="list">
              {c.cards
                .map((card) => ({ card, p: profileOf(world, card) }))
                .map((x) => ({ ...x, fit: roleFit(x.p, picking), eff: effectiveOvr(x.p, x.card) }))
                .sort((a, b) => b.eff * b.fit - a.eff * a.fit)
                .map(({ card, p, fit, eff }, i) => {
                  const current = slotFor(picking)?.cardId === card.cardId;
                  const elsewhere = c.lineup.find((s) => s.cardId === card.cardId && s.role !== picking);
                  return (
                    <button key={card.cardId} role="listitem" className={`pick-row${current ? ' current' : ''}`} onClick={() => assign(picking, card.cardId)}>
                      <span className="pick-rank num">{i + 1}</span>
                      <Avatar seed={p.record.id} size={40} accent="#f0a33a" className={`ava-ring ${p.rarity}`} />
                      <span className="pick-who">
                        <strong>{p.record.handle} {current && <span className="chip t">Current</span>}</strong>
                        <span className="small muted"><CountryTag cc={p.record.country} /> {ROLE_LABEL[p.record.primaryRole]}{current ? '' : elsewhere ? ` · starting ${ROLE_LABEL[elsewhere.role]}` : ' · bench'}</span>
                      </span>
                      <span className="pick-val"><b className="num">{Math.round(eff * fit)}</b><small className={`fit-${fit === 1 ? 'main' : fit >= 0.95 ? 'second' : 'off'}`}>{fitLabel(fit)}</small></span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {market && (
        <div className="overlay" onClick={() => setMarket(false)}>
          <div className="sheet" role="dialog" aria-label="Coach market" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h2>Coach market</h2><div className="row"><Coin amount={c.coins} /><button className="btn small ghost" onClick={() => setMarket(false)}>Close</button></div></div>
            <p className="small muted">Hiring costs a one-off fee plus a weekly wage. Coaches change training speed, map prep, tactics, timeouts and team coordination. Hiring someone new costs a little chemistry.</p>
            <div className="coach-list">
              {[...world.coaches].sort((a, b) => b.hireCost - a.hireCost).map((co) => {
                const mine = co.id === c.coachId;
                return (
                  <article className={`coach-card${mine ? ' mine' : ''}`} key={co.id}>
                    <div className="coach-card-head">
                      <Avatar seed={co.id} kind="coach" size={44} accent={mine ? '#f0a33a' : '#7d8a99'} />
                      <div className="stack" style={{ gap: 0, minWidth: 0 }}>
                        <strong className="ellip"><CountryTag cc={co.country} /> {co.name}</strong>
                        <span className="small faint">Specialty {co.specialtyMap} · <span className="num">{coachWage(co)}</span>/wk</span>
                      </div>
                      <OvrBadge value={coachOverall(co)} size="sm" />
                    </div>
                    <p className="small muted">{co.blurb}</p>
                    <div className="coach-mini">
                      {COACH_ATTRIBUTES.map((a) => <Meter key={a} value={co.attrs[a]} tone={co.attrs[a] >= 75 ? 'good' : 'ct'} size="sm" label={COACH_ATTRIBUTE_LABEL[a]} />)}
                    </div>
                    {mine ? <span className="chip t" style={{ alignSelf: 'flex-start' }}>Your coach</span> : (
                      <button className="btn small" disabled={c.coins < co.hireCost} onClick={() => { update(hireCoach(world, c, co.id), `${co.name} hired.`); setMarket(false); }}>
                        Hire for <Coin amount={co.hireCost} />
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function XiSlot({ role, card, p, onOpen, onPick }: { role: Role; card?: OwnedCard; p?: PlayerProfile; onOpen: () => void; onPick: () => void }) {
  const fit = p ? roleFit(p, role) : 1;
  if (!card || !p) {
    return (
      <li className="xi-slot empty">
        <div className="xi-role"><RoleIcon role={role} /><span>{ROLE_LABEL[role]}</span></div>
        <button className="xi-body xi-choose" onClick={onPick}><span className="xi-plus" aria-hidden="true">+</span><span>Choose a player</span></button>
      </li>
    );
  }
  const eff = effectiveOvr(p, card);
  const sharp = Math.round(card.sharpness);
  const fat = Math.round(card.fatigue);
  return (
    <li className={`xi-slot ${p.rarity}${fit < 1 ? ' offrole' : ''}`}>
      <div className="xi-role">
        <RoleIcon role={role} /><span>{ROLE_LABEL[role]}</span>
        {fit < 1 && <span className="xi-fit" title={fit >= 0.95 ? 'Secondary role: plays at 95%' : 'Off-role: plays at 88%'}>{fit >= 0.95 ? '2nd' : 'Off'}</span>}
      </div>
      <button className="xi-body" onClick={onOpen} aria-label={`${p.record.handle}, ${ROLE_LABEL[role]}, overall ${cardOvr(p, card)}. Open profile`}>
        <span className="xi-ava"><Avatar seed={p.record.id} size={64} accent="#f0a33a" /></span>
        <span className="xi-id">
          <span className="xi-handle">{p.record.handle}</span><span className="xi-flag"><CountryTag cc={p.record.country} /></span>
          <span className="xi-meta"><CountryTag cc={p.record.country} /> {p.record.age}y · {RARITY_LABEL[p.rarity]}</span>
        </span>
        <span className="xi-ovr"><OvrBadge value={cardOvr(p, card)} rarity={p.rarity} size="sm" /><small title="Plays at today, after sharpness, fatigue and form">today <b className="num">{eff}</b></small></span>
        <span className="xi-cond">
          <Meter value={sharp} tone={sharp >= 70 ? 'good' : sharp < 35 ? 'bad' : 'warn'} size="sm" label="Sharp" />
          <Meter value={fat} tone={fat >= 60 ? 'bad' : fat >= 35 ? 'warn' : 'good'} size="sm" label="Fatigue" />
        </span>
      </button>
      <button className="xi-swap" onClick={onPick} aria-label={`Change ${ROLE_LABEL[role]}`} title={`Change ${ROLE_LABEL[role]}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>
        <span>Swap</span>
      </button>
    </li>
  );
}

function CoachBlock({ coach }: { coach: Coach }) {
  return (
    <div className="coach-block">
      <div className="coach-id">
        <Avatar seed={coach.id} kind="coach" size={56} accent="#f0a33a" className="coach-ava" />
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <h3 className="ellip"><CountryTag cc={coach.country} /> {coach.name}</h3>
          <span className="small faint">Specialty <b className="muted">{coach.specialtyMap}</b> · <span className="num">{coachWage(coach)}</span>/wk</span>
        </div>
        <OvrBadge value={coachOverall(coach)} />
      </div>
      <p className="small muted coach-blurb">{coach.blurb}</p>
      <div className="coach-chart">
        <div className="coach-bars">
          {COACH_ATTRIBUTES.map((a) => <Meter key={a} value={coach.attrs[a]} tone={coach.attrs[a] >= 75 ? 'good' : 'ct'} label={COACH_ATTRIBUTE_LABEL[a]} />)}
        </div>
      </div>
    </div>
  );
}
