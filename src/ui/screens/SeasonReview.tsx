/** End of season: where you finished, what it paid, who stood out, and what the next season holds. */
import { dismissSeasonReview, ordinal, profileOf } from '../../engine/career';
import { formatDate, seasonSpan, seasonStart } from '../../engine/calendar';
import { DIVISIONS, cupName } from '../../engine/season';
import { useGame } from '../common';
import { Crest } from '../crest';
import { money, signed } from './leagueUtil';
import '../styles/review.css';

const CUP_TEXT = ['Winner', 'Finalist', 'Semifinal', 'Quarterfinal'] as const;

export function SeasonReview() {
  const { world, career: c, update, openPlayer, openClub } = useGame();
  const r = c.seasonReview;
  if (!r || r.seen) return null;
  const div = DIVISIONS[r.division]!;
  const next = DIVISIONS[r.nextDivision]!;
  const close = () => update(dismissSeasonReview(c));
  const mvpCard = r.mvp ? c.cards.find((x) => x.cardId === r.mvp!.cardId) : undefined;
  const mvp = mvpCard ? profileOf(world, mvpCard) : undefined;
  const expiring = r.expiring.map((id) => c.cards.find((x) => x.cardId === id)).filter((x): x is NonNullable<typeof x> => !!x);
  const earned = r.prize + r.cupPrize + r.sponsorBonus;
  const verdict = r.movement === 'promoted' ? 'Promoted' : r.movement === 'relegated' ? 'Relegated' : r.placement === 1 ? 'Champions' : r.cup === 1 ? 'Cup winners' : 'Season complete';

  return (
    <div className="overlay" onClick={close}>
      <div className={`sheet sr-sheet ${r.movement}`} role="dialog" aria-label={`Season ${r.season} review`} onClick={(e) => e.stopPropagation()}>
        <header className="sr-hero">
          <span className="label">Season {r.season} · {div.name} · {seasonSpan(r.season)}</span>
          <div className="sr-place">
            <Crest name={c.teamName} tag={c.teamTag} mine size={64} />
            <div>
              <h2 className="sr-verdict">{verdict}</h2>
              <p className="sr-sub"><span className="num sr-big">{ordinal(r.placement)}</span> of {r.table.length} · <span className="num">{r.wins}-{r.losses}</span> in all matches</p>
            </div>
          </div>
          <p className="small muted">
            {r.champion.mine ? 'You won the playoffs.' : <>Playoff champions: <strong>{r.champion.name}</strong>.</>}
            {' '}{r.movement === 'promoted' ? `Next season you play in the ${next.name}.` : r.movement === 'relegated' ? `Next season you drop to the ${next.name}.` : `You stay in the ${next.name}.`}
          </p>
        </header>

        <div className="sr-grid">
          <section className="sr-box" aria-label="Earnings">
            <span className="label">Season earnings</span>
            <dl className="sr-dl">
              <div><dt>League placing</dt><dd className="num">{money(r.prize)}</dd></div>
              <div><dt>{cupName(r.division)}{r.cup ? ` · ${CUP_TEXT[r.cup - 1]}` : ''}</dt><dd className="num">{r.cup ? money(r.cupPrize) : '—'}</dd></div>
              <div><dt>Sponsor bonus</dt><dd className="num">{r.sponsorBonus ? money(r.sponsorBonus) : '—'}</dd></div>
              <div className="sr-total"><dt>Total</dt><dd className="num good">{signed(earned)}</dd></div>
            </dl>
            <div className="sr-pair">
              <span><span className="label">Balance</span><span className="num">{money(r.coinsAfter)}</span></span>
              <span><span className="label">Reputation</span><span className="num">{r.reputationAfter} <small className={r.reputationAfter >= r.reputationBefore ? 'good' : 'bad'}>{signed(r.reputationAfter - r.reputationBefore)}</small></span></span>
            </div>
          </section>

          <section className="sr-box" aria-label="Final table">
            <span className="label">Final league table</span>
            <ol className="sr-table">
              {r.table.map((t, i) => (
                <li key={t.tag + i} className={`${t.mine ? 'me' : ''} ${i < 2 && r.division < DIVISIONS.length - 1 ? 'up' : ''} ${i >= r.table.length - 2 && r.division > 0 ? 'down' : ''}`}>
                  <span className="num faint">{i + 1}</span><span className="sr-tag">{t.tag}</span><span className="sr-name">{t.name}</span><span className="num faint">{t.wins}-{t.losses}</span><span className="num">{t.points}</span>
                </li>
              ))}
            </ol>
          </section>

          {mvp && mvpCard && (
            <section className="sr-box" aria-label="Player of the season">
              <span className="label">Your player of the season</span>
              <button className="sr-mvp" onClick={() => openPlayer(mvpCard.cardId)}>
                <strong>{mvp.record.handle}</strong>
                <span className="small muted">{r.mvp!.mvps} match MVP{r.mvp!.mvps === 1 ? '' : 's'}{r.mvp!.rating !== null ? ` · ${r.mvp!.rating.toFixed(2)} avg rating` : ''}</span>
              </button>
            </section>
          )}

          <section className="sr-box" aria-label="Next season">
            <span className="label">Season {r.season + 1} · {next.name}</span>
            <p className="small">Kickoff <strong>{formatDate(seasonStart(r.season + 1))}</strong>. Seven Bo1 league rounds, Bo3 playoffs for the top four, then the {cupName(r.nextDivision)}.</p>
            <ul className="sr-todo small">
              <li>Sponsors reset each season: pick a new one in the club screen.</li>
              {expiring.length > 0 && <li className="bad">{expiring.length} contract{expiring.length === 1 ? '' : 's'} run out within four weeks: {expiring.map((x) => profileOf(world, x).record.handle).join(', ')}.</li>}
              <li>Everyone starts the season rested (fatigue 0).</li>
            </ul>
          </section>
        </div>

        <div className="sr-actions">
          <button className="btn ghost" onClick={() => { close(); openClub(); }}>Open the club</button>
          <button className="btn primary" onClick={close}>Start season {r.season + 1}</button>
        </div>
      </div>
    </div>
  );
}
