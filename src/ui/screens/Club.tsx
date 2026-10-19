/** Club overview: money, wages, sponsor, reputation and the full money ledger. */
import { useLayoutEffect, useRef, useState } from 'react';
import { currentSponsorOffers, signSponsor, upgradeFacility, weeklyWages } from '../../engine/career';
import { FACILITIES, FACILITY_IDS, FACILITY_MAX, LEDGER_LABEL, MAX_SQUAD, NO_FACILITIES, SPONSOR_GOAL_LABEL, facilityUpkeep, reputationLabel } from '../../engine/economy';
import type { LedgerEntry, LedgerKind } from '../../engine/economy';
import { DIVISIONS } from '../../engine/season';
import { useGame } from '../common';
import { money, signed } from './leagueUtil';
import '../styles/home.css';

const STYLE_LABEL = { steady: 'Steady', performance: 'Performance', ambitious: 'Ambitious' } as const;

export function ClubSheet({ onClose }: { onClose: () => void }) {
  const { world, career: c, update, toast } = useGame();
  const fac = c.facilities ?? NO_FACILITIES;
  const upkeep = facilityUpkeep(fac);
  const [season, setSeason] = useState(c.season.number);
  const wages = weeklyWages(world, c);
  const div = DIVISIONS[c.season.division]!;
  const weeklyIn = c.sponsor?.weekly ?? 0;
  const weeklyOut = wages.players + wages.coach + upkeep;
  const net = weeklyIn - weeklyOut;
  const runway = net >= 0 ? null : Math.max(0, Math.floor(Math.max(0, c.coins) / -net));
  const entries = c.ledger.filter((e) => e.season === season);
  const byKind = new Map<LedgerKind, number>();
  for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + e.amount);
  const seasons = [...new Set([c.season.number, ...c.ledger.map((e) => e.season)])].sort((a, b) => b - a);
  const income = [...byKind.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const spend = [...byKind.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  const maxAbs = Math.max(1, ...[...byKind.values()].map(Math.abs));
  const totalIn = income.reduce((s, [, v]) => s + v, 0);
  const totalOut = spend.reduce((s, [, v]) => s + v, 0);
  const flowMax = Math.max(1, weeklyIn, weeklyOut);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet cl-sheet" role="dialog" aria-label="Club and finances" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="cl-title"><span className="tag">{c.teamTag}</span><div><h2>{c.teamName}</h2><span className="small muted">{div.name} · Season {c.season.number}</span></div></div>
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>

        <section className="cl-kpis" aria-label="Money summary">
          <div className="cl-kpi main">
            <span className="label">Balance</span>
            <span className={`cl-kpi-v num ${c.coins < 0 ? 'bad' : ''}`}><span className="coin-dot" aria-hidden="true" />{money(c.coins)}</span>
          </div>
          <div className="cl-kpi">
            <span className="label">Net / week</span>
            <span className={`cl-kpi-v num ${net >= 0 ? 'good' : 'bad'}`}>{signed(net)}</span>
            <span className="cl-kpi-d">before match income</span>
          </div>
          <div className="cl-kpi">
            <span className="label">Runway</span>
            <span className="cl-kpi-v num">{runway === null ? '∞' : runway}<small>{runway === null ? '' : ' wk'}</small></span>
            <span className="cl-kpi-d">{runway === null ? 'covered by sponsor' : 'without match income'}</span>
          </div>
        </section>
        {c.coins < 0 && <p className="cl-debt">You are in debt. Cases, transfer fees, coach hiring and paid training are blocked until the balance is positive. Sell a player or win matches to recover.</p>}

        <section className="panel" aria-label="Weekly budget">
          <div className="panel-head"><h3>Every week</h3><span className="small muted">{c.cards.length}/{MAX_SQUAD} players</span></div>
          <div className="cl-budget">
            <span className="label">In</span>
            <div className="cl-stack"><i className="good" style={{ width: `${(weeklyIn / flowMax) * 100}%` }} title={`Sponsor ${weeklyIn}`} /></div>
            <span className="num good">{signed(weeklyIn)}</span>
            <span className="label">Out</span>
            <div className="cl-stack">
              <i className="bad" style={{ width: `${(wages.players / flowMax) * 100}%` }} title={`Player wages ${wages.players}`} />
              <i className="bad2" style={{ width: `${(wages.coach / flowMax) * 100}%` }} title={`Coach wage ${wages.coach}`} />
              {upkeep > 0 && <i className="bad3" style={{ width: `${(upkeep / flowMax) * 100}%` }} title={`Facility upkeep ${upkeep}`} />}
            </div>
            <span className="num bad">{signed(-weeklyOut)}</span>
          </div>
          <div className="cl-lines">
            <div><span><i className="cl-sw good" />Sponsor{c.sponsor ? '' : ' (none signed)'}</span><span className="num good">{signed(weeklyIn)}</span></div>
            <div><span><i className="cl-sw bad" />Player wages</span><span className="num">{signed(-wages.players)}</span></div>
            <div><span><i className="cl-sw bad2" />Coach wage</span><span className="num">{signed(-wages.coach)}</span></div>
            {upkeep > 0 && <div><span><i className="cl-sw bad3" />Facility upkeep</span><span className="num">{signed(-upkeep)}</span></div>}
            <div className="tot"><span>Before match income</span><span className={`num ${net >= 0 ? 'good' : 'bad'}`}>{signed(net)}</span></div>
          </div>
          <p className="small faint">Match income in the {div.name}: {div.winReward} for a win, {Math.round(div.winReward * 0.4)} for a loss{c.sponsor?.winBonus ? `, plus ${c.sponsor.winBonus} sponsor bonus per win` : ''}. Season prize for 1st: {div.prizes[0]}.</p>
        </section>

        <section className="panel" aria-label="Sponsor">
          <div className="panel-head"><h3>Sponsor</h3>{c.sponsor ? <span className="chip good">Signed</span> : <span className="chip warn">Choose one</span>}</div>
          {c.sponsor ? (
            <div className="cl-sponsor signed">
              <div className="cl-sp-head"><strong>{c.sponsor.name}</strong><span className="chip">{STYLE_LABEL[c.sponsor.style]}</span></div>
              <SponsorTerms weekly={c.sponsor.weekly} win={c.sponsor.winBonus} goal={c.sponsor.goalBonus} />
              <span className="small muted">Goal: {SPONSOR_GOAL_LABEL[c.sponsor.goal]}</span>
              <span className="small faint">New offers arrive at the start of next season.</span>
            </div>
          ) : (
            <>
              <p className="small muted">Pick one sponsor for this season. Offers scale with your division and reputation.</p>
              <div className="cl-sponsors">
                {currentSponsorOffers(c).map((s) => (
                  <div key={s.id} className="cl-sponsor">
                    <div className="cl-sp-head"><strong>{s.name}</strong><span className="chip">{STYLE_LABEL[s.style]}</span></div>
                    <SponsorTerms weekly={s.weekly} win={s.winBonus} goal={s.goalBonus} />
                    <span className="small muted">Goal: {SPONSOR_GOAL_LABEL[s.goal]}</span>
                    <button className="btn small primary" aria-label={`Sign ${s.name}`} onClick={() => update(signSponsor(c, s.id), `${s.name} signed.`)}>Sign</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel" aria-label="Balance history">
          <div className="panel-head">
            <h3>Balance</h3>
            <select className="inline" aria-label="Season" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
              {seasons.map((s) => <option key={s} value={s}>Season {s}</option>)}
            </select>
          </div>
          {entries.length === 0 ? <p className="small muted">Nothing yet this season.</p> : <LedgerChart ledger={c.ledger} coins={c.coins} season={season} />}
        </section>

        <section className="panel" aria-label="Money in and out">
          <div className="panel-head"><h3>Money in and out</h3><span className="small muted num">Season {season}</span></div>
          {entries.length === 0 && <p className="small muted">Nothing yet this season.</p>}
          {entries.length > 0 && (
            <div className="cl-sum">
              <div><span className="label">In</span><span className="num good">{signed(totalIn)}</span></div>
              <div><span className="label">Out</span><span className="num bad">{signed(totalOut)}</span></div>
              <div><span className="label">Net</span><span className={`num ${totalIn + totalOut >= 0 ? 'good' : 'bad'}`}>{signed(totalIn + totalOut)}</span></div>
            </div>
          )}
          <div className="cl-cats">
            {[...income, ...spend].map(([k, v]) => (
              <div key={k} className="cl-cat">
                <span className="small">{LEDGER_LABEL[k]}</span>
                <div className="cl-cat-bar"><i className={v > 0 ? 'good' : 'bad'} style={{ width: `${(Math.abs(v) / maxAbs) * 100}%` }} /></div>
                <span className={`num small ${v > 0 ? 'good' : 'bad'}`}>{signed(v)}</span>
              </div>
            ))}
          </div>
          {entries.length > 0 && (
            <details className="cl-details">
              <summary className="small">All {entries.length} transactions</summary>
              <div className="cl-tx">
                {entries.map((e, i) => (
                  <div key={i}><span className="num faint">{e.week ? `W${e.week}` : '—'}</span><span className="muted">{e.label}</span><span className={`num ${e.amount > 0 ? 'good' : 'bad'}`}>{signed(e.amount)}</span></div>
                ))}
              </div>
            </details>
          )}
        </section>

        <section className="panel" aria-label="Facilities">
          <div className="panel-head"><h3>Facilities</h3><span className="small muted">Upkeep <span className="num">{upkeep}</span>/wk</span></div>
          <p className="small muted">Permanent upgrades. Each level has a one-off cost and a weekly upkeep.</p>
          <div className="cl-facs">
            {FACILITY_IDS.map((id) => {
              const f = FACILITIES[id];
              const lvl = fac[id];
              const cost = f.cost[lvl];
              return (
                <div key={id} className="cl-fac">
                  <div className="cl-fac-head">
                    <strong>{f.name}</strong>
                    <span className="cl-pips" aria-label={`Level ${lvl} of ${FACILITY_MAX}`}>{Array.from({ length: FACILITY_MAX }, (_, i) => <i key={i} className={i < lvl ? 'on' : ''} />)}</span>
                  </div>
                  <span className="small">{lvl ? f.effect(lvl) : <span className="faint">Not built</span>}{lvl ? <span className="faint"> · upkeep {f.upkeep[lvl]}/wk</span> : null}</span>
                  {lvl < FACILITY_MAX && <span className="small muted">Next: {f.effect(lvl + 1)}, upkeep {f.upkeep[lvl + 1]}/wk</span>}
                  {cost !== undefined
                    ? <button className="btn small" disabled={c.coins < cost} onClick={() => { try { update(upgradeFacility(c, id), `${f.name} upgraded.`); } catch (e) { toast((e as Error).message); } }}>Upgrade · <span className="num">{cost.toLocaleString('en-US')}</span></button>
                    : <span className="chip good cl-max">Max level</span>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel" aria-label="Reputation and career">
          <div className="panel-head"><h3>Reputation</h3><span className="chip ct">{reputationLabel(c.reputation)}</span></div>
          <div className="cl-rep">
            <span className="num cl-rep-v">{Math.round(c.reputation)}</span>
            <div className="cl-rep-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, c.reputation))}%` }} />{[20, 40, 60, 80].map((t) => <b key={t} style={{ left: `${t}%` }} />)}</div>
          </div>
          <p className="small faint">Reputation rises with wins, titles and promotion. It raises sponsor offers and makes better players willing to talk.</p>
          <div className="cl-career">
            <div><span className="label">Matches</span><span className="num">{c.totals.matches}</span></div>
            <div><span className="label">Record</span><span className="num">{c.totals.wins}-{c.totals.losses}</span></div>
            <div><span className="label">Titles</span><span className="num">{c.totals.titles}</span></div>
            <div><span className="label">Cases</span><span className="num">{c.totals.casesOpened}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SponsorTerms({ weekly, win, goal }: { weekly: number; win: number; goal: number }) {
  return (
    <div className="cl-terms">
      <div><span className="num">+{weekly}</span><span className="label">per week</span></div>
      <div><span className="num">+{win}</span><span className="label">per win</span></div>
      <div><span className="num">+{goal}</span><span className="label">goal bonus</span></div>
    </div>
  );
}

/** Balance line (amber) over the season with weekly net bars underneath. Rebuilt from the ledger, newest entry first. */
function LedgerChart({ ledger, coins, season }: { ledger: LedgerEntry[]; coins: number; season: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Walk back from today's balance to get the balance after every entry.
  let bal = coins;
  const after: number[] = [];
  for (const e of ledger) { after.push(bal); bal -= e.amount; }
  const idx = ledger.map((e, i) => ({ e, i })).filter(({ e }) => e.season === season);
  const startBal = idx.length ? after[idx[idx.length - 1]!.i]! - idx[idx.length - 1]!.e.amount : coins;
  const weeks = [...new Set(idx.map(({ e }) => e.week))].sort((a, b) => a - b);
  const pts = [{ label: 'Start', bal: startBal, net: 0 }, ...weeks.map((wk) => {
    const inWeek = idx.filter(({ e }) => e.week === wk);
    return { label: wk ? `W${wk}` : 'Pre', bal: after[inWeek[0]!.i]!, net: inWeek.reduce((s, { e }) => s + e.amount, 0) };
  })];

  const H1 = 120, H2 = 46, top = 14, gap = 18, bottom = 18, left = 4, right = 56;
  const H = top + H1 + gap + H2 + bottom;
  const plotW = w - left - right;
  const bals = pts.map((p) => p.bal);
  let lo = Math.min(...bals), hi = Math.max(...bals);
  if (hi - lo < 200) { const mid = (hi + lo) / 2; lo = mid - 100; hi = mid + 100; }
  const pad = (hi - lo) * 0.12; hi += pad; lo -= pad;
  const step = pts.length > 1 ? plotW / (pts.length - 1) : 0;
  const x = (i: number) => left + (pts.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => top + H1 - ((v - lo) / (hi - lo)) * H1;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.bal).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${(top + H1).toFixed(1)} L${x(0).toFixed(1)},${(top + H1).toFixed(1)} Z`;
  const nets = pts.slice(1).map((p) => p.net);
  const netMax = Math.max(1, ...nets.map(Math.abs));
  const zeroY = top + H1 + gap + H2 / 2;
  const barW = Math.max(4, Math.min(22, step * 0.5 || 22));
  const lastP = pts[pts.length - 1]!;
  const showEvery = Math.ceil(pts.length / Math.max(2, Math.floor(plotW / 44)));

  return (
    <div ref={ref} className="cl-chart">
      <svg width={w} height={H} role="img" aria-label={`Balance over season ${season}: from ${startBal} to ${lastP.bal}`}>
        {/* balance gridlines: 0 and top */}
        <line x1={left} x2={left + plotW} y1={top} y2={top} className="cl-grid" />
        {lo < 0 && hi > 0 && <line x1={left} x2={left + plotW} y1={y(0)} y2={y(0)} className="cl-zero" />}
        <line x1={left} x2={left + plotW} y1={top + H1} y2={top + H1} className="cl-axis" />
        <path d={area} className="cl-area" />
        <path d={line} className="cl-line" />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.bal)} r={i === pts.length - 1 ? 3.5 : 2} className={i === pts.length - 1 ? 'cl-dot end' : 'cl-dot'}><title>{`${p.label}: ${p.bal}`}</title></circle>)}
        <text x={x(pts.length - 1) + 8} y={y(lastP.bal) + 4} className="cl-tx-end">{money(lastP.bal)}</text>
        <text x={left + plotW + 8} y={top + 8} className="cl-tx-ax">{money(Math.round(hi))}</text>
        <text x={left + plotW + 8} y={top + H1 + 4} className="cl-tx-ax">{money(Math.round(lo))}</text>
        {/* weekly net */}
        <line x1={left} x2={left + plotW} y1={zeroY} y2={zeroY} className="cl-axis" />
        {pts.map((p, i) => {
          if (i === 0) return null;
          const h = (Math.abs(p.net) / netMax) * (H2 / 2);
          return <rect key={i} x={x(i) - barW / 2} y={p.net >= 0 ? zeroY - h : zeroY} width={barW} height={Math.max(1, h)} rx={1.5} className={p.net >= 0 ? 'cl-bar good' : 'cl-bar bad'}><title>{`${p.label}: ${signed(p.net)}`}</title></rect>;
        })}
        {pts.map((p, i) => (i % showEvery === 0 || i === pts.length - 1) && (i === pts.length - 1 || pts.length - 1 - i >= showEvery) ? <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : 'middle'} className="cl-tx-ax">{p.label}</text> : null)}
      </svg>
      <div className="cl-legend"><span><i className="ln" />Balance after each week</span><span><i className="br good" /><i className="br bad" />Net for the week</span></div>
    </div>
  );
}
