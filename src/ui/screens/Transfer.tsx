/** Contract management for your players and transfer offers for everyone else. */
import { useState } from 'react';
import {
  MAX_OFFERS_PER_WEEK, acceptBid, cardById, declineBid, teamName, demandOf, makeOffer, offersLeft, playerStatus, releaseCard, renewContract, renewalDemand, salePrice, toggleShortlist,
} from '../../engine/career';
import { CONTRACT_LENGTHS, MAX_SQUAD, MIN_SQUAD, marketValue, severance, wageForLength } from '../../engine/economy';
import type { OfferResult } from '../../engine/economy';
import { sellCard } from '../../engine/career';
import { fmt, useGame } from '../common';
import { KPI, Meter } from '../charts';

export function ContractPanel({ cardId, onLeft }: { cardId: string; onLeft: () => void }) {
  const { world, career: c, update, toast } = useGame();
  const [confirm, setConfirm] = useState<null | 'sell' | 'release'>(null);
  const [weeks, setWeeks] = useState<number>(18);
  const card = cardById(c, cardId);
  if (!card) return null;
  const ct = card.contract;
  const demand = renewalDemand(world, c, cardId);
  const renewWage = Math.round((demand * (weeks <= 9 ? 1.08 : weeks >= 27 ? 0.95 : 1)) / 5) * 5;
  const price = salePrice(world, card);
  const sev = severance(card);
  const canLeave = c.cards.length > MIN_SQUAD && !(c.phase === 'matchday' && c.lineup.some((s) => s.cardId === cardId));
  const act = (fn: () => void) => { try { fn(); } catch (e) { toast((e as Error).message); } };
  const bid = (c.bids ?? []).find((b) => b.cardId === cardId);
  const wageDelta = ct ? renewWage - ct.wage : 0;
  const expiring = !!ct && ct.weeksLeft <= 3;
  return (
    <div className="panel inset contract">
      {bid && (
        <div className="bid-card" role="status">
          <div className="row spread"><span className="label">Incoming bid</span><span className="small faint">ends this week</span></div>
          <div className="row spread"><strong>{teamName(c, bid.teamId)}</strong><span className="num bid-fee">{fmt(bid.fee)}</span></div>
          <span className="small muted">{bid.fee - price >= 0 ? <><span className="good num">+{fmt(bid.fee - price)}</span> over</> : 'Less than'} a quick sale ({fmt(price)}).{canLeave ? '' : ' You can only accept once the player is free to leave.'}</span>
          <div className="grid2">
            <button className="btn small ghost" onClick={() => act(() => update(declineBid(world, c, bid.id), 'Bid turned down.'))}>Turn down</button>
            <button className="btn small primary" disabled={!canLeave} onClick={() => act(() => { update(acceptBid(world, c, bid.id), `Sold for ${bid.fee}.`); onLeft(); })} aria-label={`Accept ${bid.fee}`}>Accept <span className="num">{fmt(bid.fee)}</span></button>
          </div>
        </div>
      )}
      <div className="panel-head"><h3>Contract</h3>{expiring && <span className="chip bad">Expiring</span>}</div>
      {ct ? (
        <>
          <div className="kpi-row four">
            <KPI label="Wage / wk" value={fmt(ct.wage)} />
            <KPI label="Weeks left" value={ct.weeksLeft} tone={expiring ? 'bad' : ct.weeksLeft <= 9 ? 'warn' : undefined} />
            <KPI label="Sale price" value={fmt(price)} />
            <KPI label="Release cost" value={fmt(sev)} />
          </div>
          <Meter value={Math.min(ct.weeksLeft, 36)} max={36} tone={expiring ? 'bad' : ct.weeksLeft <= 9 ? 'warn' : 'ct'} size="sm" label="Term" display={<>{ct.weeksLeft} wk</>} />
        </>
      ) : <p className="small muted">No contract on file.</p>}

      <div className="form-block">
        <span className="label">Extend contract</span>
        <div className="seg compact" role="group" aria-label="Extension length">
          {CONTRACT_LENGTHS.map((w) => <button key={w} aria-pressed={weeks === w} onClick={() => setWeeks(w)}>+{w} wk</button>)}
        </div>
        <button className="btn small block" onClick={() => act(() => update(renewContract(world, c, cardId, weeks), 'Contract extended.'))}>
          Extend at <span className="num">{fmt(renewWage)}</span> / week
          {ct && wageDelta !== 0 && <span className={`delta num ${wageDelta > 0 ? 'bad' : 'good'}`}>{wageDelta > 0 ? '+' : ''}{wageDelta}</span>}
        </button>
        <span className="small faint">Demand depends on level, morale and ambition. Contracts run down one week per match week; at zero the player leaves (unless that drops you below five).</span>
      </div>

      {confirm ? (
        <div className="confirm-box" role="alertdialog" aria-label={confirm === 'sell' ? 'Confirm sale' : 'Confirm release'}>
          <p className="small">{confirm === 'sell' ? <>Sell to another club for <b className="num">{fmt(price)}</b>?</> : <>Release for <b className="num">{fmt(sev)}</b> in severance?</>} This cannot be undone.</p>
          <div className="grid2">
            <button className="btn small ghost" onClick={() => setConfirm(null)}>Keep player</button>
            <button className="btn small danger" onClick={() => act(() => { update(confirm === 'sell' ? sellCard(world, c, cardId) : releaseCard(world, c, cardId), confirm === 'sell' ? `Sold for ${price}.` : 'Player released.'); onLeft(); })}>{confirm === 'sell' ? 'Sell' : 'Release'}</button>
          </div>
        </div>
      ) : (
        <div className="grid2">
          <button className="btn small ghost" disabled={!canLeave} onClick={() => setConfirm('sell')}>Sell · <span className="num">{fmt(price)}</span></button>
          <button className="btn small ghost danger-ghost" disabled={!canLeave} onClick={() => setConfirm('release')}>Release · <span className="num">{fmt(sev)}</span></button>
        </div>
      )}
      {!canLeave && <p className="small faint">{c.cards.length <= MIN_SQUAD ? 'You need at least five players.' : 'In this week\'s lineup. Play the match first.'}</p>}
    </div>
  );
}

export function TransferPanel({ playerId }: { playerId: string }) {
  const { world, career: c, update } = useGame();
  const p = world.profiles.get(playerId)!;
  const st = playerStatus(c, playerId);
  const d = demandOf(world, c, playerId);
  const [weeks, setWeeks] = useState<number>(18);
  const [fee, setFee] = useState<string>(String(d.askingFee));
  const [wage, setWage] = useState<string>(String(wageForLength(d.wage, 18)));
  const [result, setResult] = useState<OfferResult | null>(null);
  const left = offersLeft(c, playerId);
  const feeN = Number(fee);
  const wageN = Number(wage);
  const feeOk = fee !== '' && Number.isFinite(feeN) && feeN >= 0;
  const wageOk = wage !== '' && Number.isFinite(wageN) && wageN > 0;
  const valid = feeOk && wageOk;
  const full = c.cards.length >= MAX_SQUAD;
  const listed = c.shortlist.includes(playerId);
  const expectedWage = wageForLength(d.wage, weeks);
  const tooExpensive = feeOk && feeN > 0 && feeN > c.coins;
  const blocked = full ? 'Squad full. Sell or release someone first.'
    : d.interest === 'none' ? 'They will not talk to you yet.'
    : left <= 0 ? 'No offers left for this player this week.'
    : !valid ? 'Enter a fee and a weekly wage.'
    : tooExpensive ? `The fee is more than your ${fmt(c.coins)} coins.`
    : null;
  // Per-field feedback: errors block the offer, warnings only predict a likely "no".
  const feeMsg = !feeOk ? { tone: 'bad', text: 'Enter a fee (0 or more).' }
    : tooExpensive ? { tone: 'bad', text: `More than your ${fmt(c.coins)} coins.` }
    : feeN < d.askingFee ? { tone: 'warn', text: `${Math.round((1 - feeN / Math.max(1, d.askingFee)) * 100)}% below asking (${fmt(d.askingFee)}).` }
    : { tone: 'good', text: `Meets asking (${fmt(d.askingFee)}).` };
  const wageMsg = !wageOk ? { tone: 'bad', text: 'Enter a weekly wage above 0.' }
    : wageN < expectedWage ? { tone: 'warn', text: `Below their ${fmt(expectedWage)}/wk for ${weeks} weeks.` }
    : { tone: 'good', text: `Meets their ${fmt(expectedWage)}/wk demand.` };
  const send = () => {
    const r = makeOffer(world, c, playerId, { fee: Math.round(feeN), wage: Math.round(wageN), weeks });
    setResult(r.result);
    update(r.career, r.result.ok ? `${p.record.handle} signed!` : undefined);
  };
  const total = (feeOk ? feeN : 0) + (wageOk ? wageN * weeks : 0);
  const interestTone = d.interest === 'high' ? 'good' : d.interest === 'none' ? 'bad' : 'warn';
  return (
    <div className="panel inset offer">
      <div className="panel-head"><h3>Transfer offer</h3><span className={`chip ${interestTone}`}>{d.interest === 'none' ? 'Not interested' : `${d.interest[0]!.toUpperCase()}${d.interest.slice(1)} interest`}</span></div>
      <div className="kpi-row four">
        <KPI label="Club" value={st.owner === 'ai' ? st.teamTag : 'Free'} />
        <KPI label="Value" value={fmt(marketValue(p))} />
        <KPI label={st.owner === 'ai' ? 'Asking fee' : 'Signing fee'} value={fmt(d.askingFee)} />
        <KPI label="Wage ask" value={fmt(d.wage)} sub="/ wk at 18 wk" />
      </div>
      <p className="small muted">{d.reason}</p>

      <div className="form-block">
        <div className="grid2 offer-fields">
          <div className={`field fx ${feeMsg.tone}`}>
            <label className="label" htmlFor="tr-fee">Fee offer</label>
            <div className="input-affix"><input id="tr-fee" inputMode="numeric" value={fee} aria-invalid={feeMsg.tone === 'bad'} aria-describedby="tr-fee-msg" onChange={(e) => { setFee(e.target.value.replace(/[^0-9]/g, '')); setResult(null); }} /><span>coins</span></div>
            <span id="tr-fee-msg" className={`field-msg ${feeMsg.tone}`}>{feeMsg.text}</span>
          </div>
          <div className={`field fx ${wageMsg.tone}`}>
            <label className="label" htmlFor="tr-wage">Wage</label>
            <div className="input-affix"><input id="tr-wage" inputMode="numeric" value={wage} aria-invalid={wageMsg.tone === 'bad'} aria-describedby="tr-wage-msg" onChange={(e) => { setWage(e.target.value.replace(/[^0-9]/g, '')); setResult(null); }} /><span>/ wk</span></div>
            <span id="tr-wage-msg" className={`field-msg ${wageMsg.tone}`}>{wageMsg.text}</span>
          </div>
        </div>
        <span className="label">Contract length</span>
        <div className="seg compact" role="group" aria-label="Contract length">
          {CONTRACT_LENGTHS.map((w) => <button key={w} aria-pressed={weeks === w} onClick={() => { setWeeks(w); setWage(String(wageForLength(d.wage, w))); setResult(null); }}>{w} weeks</button>)}
        </div>
        <span className="small faint">Short deals cost more per week; long deals lock in a lower wage.</span>
      </div>

      <dl className="offer-sum">
        <div><dt>Total commitment</dt><dd className="num">{fmt(total)}</dd></div>
        <div><dt>Your coins</dt><dd className={`num ${tooExpensive ? 'bad' : ''}`}>{fmt(c.coins)}</dd></div>
        <div><dt>Squad</dt><dd className={`num ${full ? 'bad' : ''}`}>{c.cards.length}/{MAX_SQUAD}</dd></div>
        <div><dt>Offers left</dt><dd className="pips" aria-label={`${left} of ${MAX_OFFERS_PER_WEEK} offers left this week`}>{Array.from({ length: MAX_OFFERS_PER_WEEK }, (_, i) => <i key={i} className={i < left ? 'on' : ''} />)}</dd></div>
      </dl>

      {result && !result.ok && (
        <div className="offer-result" role="alert">
          <strong className="bad small">Offer rejected</strong>
          <span className="small">{result.reason}</span>
          {result.counter && <button className="btn small" onClick={() => { setFee(String(result.counter!.fee)); setWage(String(result.counter!.wage)); setResult(null); }}>Use their terms · <span className="num">{fmt(result.counter.fee)}</span> fee, <span className="num">{fmt(result.counter.wage)}</span>/wk</button>}
        </div>
      )}
      {blocked && <p className="small bad offer-blocked" role="status">{blocked}</p>}
      <div className="offer-actions">
        <button className={`btn small ghost${listed ? ' on' : ''}`} aria-pressed={listed} onClick={() => update(toggleShortlist(c, playerId), listed ? 'Removed from shortlist.' : 'Added to shortlist.')}>{listed ? '★ Shortlisted' : '☆ Shortlist'}</button>
        <button className="btn primary" disabled={!!blocked} onClick={send}>Make offer</button>
      </div>
      <p className="small faint">Fees, wages and interest are game values, not real-world figures.</p>
    </div>
  );
}
