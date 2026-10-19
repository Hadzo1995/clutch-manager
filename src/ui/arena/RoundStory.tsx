/**
 * Two HUD panels that explain the round as it plays:
 *  - RoundStory: a running log of calls, utility, fights and bomb events from
 *    the simulation's own report, revealed as the clock reaches them.
 *  - TacticsCard: the two plans, how the execute is going (call time, smokes,
 *    flash timing, entry spread, trades), and each team's synergy.
 * Everything shown comes from RoundResult.report / .synergy / .kills.
 */
import type { RoundResult, TeamIdx } from '../../engine/match';
import type { TeamSnapshot } from '../../engine/team';
import { CT_SETUP_LABEL, T_APPROACH_LABEL } from '../../engine/types';
import { ROUND_SECONDS } from './timeline';

interface StoryLine { t: number; team: TeamIdx | null; kind: string; text: string }

const clockLabel = (t: number) => { const v = Math.max(0, Math.ceil(ROUND_SECONDS - t)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

export function storyLines(round: RoundResult, teams: [TeamSnapshot, TeamSnapshot], hidePlansOf: TeamIdx | null = null): StoryLine[] {
  const name = new Map<string, string>();
  teams.forEach((tm) => tm.players.forEach((p) => name.set(p.id, p.handle)));
  const out: StoryLine[] = [];
  for (const e of round.report?.events ?? []) {
    if (e.kind === 'fight' && /opens the round/.test(e.text)) continue; // the kill line says it better
    if (e.kind === 'plan' && e.team === hidePlansOf) continue; // the opponent's plan stays private until the round ends
    out.push({ t: e.t, team: e.team, kind: e.kind, text: e.text });
  }
  for (const k of round.kills) {
    const bits: string[] = [];
    if (k.opening) bits.push('opening kill');
    if (k.trade) bits.push('trade');
    if (k.how?.victimBlind) bits.push('victim flashed');
    if (k.how?.crossfire && !k.trade) bits.push('crossfire');
    if (k.how?.preAimed) bits.push('pre-aimed');
    if (k.how?.heard && k.how.killerHolding) bits.push('heard the steps');
    if (k.how && k.how.distance >= 30) bits.push(`${k.how.distance} m`);
    if (k.headshot) bits.push('headshot');
    out.push({ t: k.t, team: k.killerTeam, kind: 'kill', text: `${name.get(k.killerId) ?? '?'} ▸ ${name.get(k.victimId) ?? '?'} · ${k.weapon}${bits.length ? ` (${bits.join(', ')})` : ''}` });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function RoundStory({ round, teams, t, sideOf, onSeek, humanIdx }: { round: RoundResult; teams: [TeamSnapshot, TeamSnapshot]; t: number; sideOf: (ti: TeamIdx) => 'T' | 'CT'; onSeek?: (t: number) => void; humanIdx: TeamIdx }) {
  const over0 = t >= round.endTime;
  const lines = storyLines(round, teams, over0 ? null : humanIdx === 0 ? 1 : 0).filter((l) => l.t <= t + 1e-6);
  const shown = lines.slice(-9).reverse(); // newest first, like a kill feed
  const over = t >= round.endTime;
  return (
    <section className="tv-story" aria-label="Round story">
      <header><span className="tv-panel-title">Round story</span><span className="faint small num">{lines.length} {lines.length === 1 ? 'event' : 'events'}</span></header>
      <ol className="tv-story-list" aria-live="polite">
        {shown.length === 0 && <li className="tv-story-empty faint">Players are leaving spawn.</li>}
        {shown.map((l, i) => (
          <li key={`${l.t}-${i}-${l.kind}`} className={`tv-story-line ${l.kind} ${l.team === null ? '' : sideOf(l.team) === 'T' ? 't' : 'ct'}`}>
            {onSeek ? (
              <button className="tv-story-seek" onClick={() => onSeek(Math.max(0, l.t - 2))} title="Rewind to just before this and pause">
                <span className="num tv-story-t">{clockLabel(l.t)}</span>
                <span className="tv-story-k" aria-hidden="true" />
                <span className="tv-story-x">{l.text}</span>
              </button>
            ) : <>
              <span className="num tv-story-t">{clockLabel(l.t)}</span>
              <span className="tv-story-k" aria-hidden="true" />
              <span className="tv-story-x">{l.text}</span>
            </>}
          </li>
        ))}
      </ol>
      {over && round.report && <p className="tv-story-verdict">{round.report.verdict}</p>}
    </section>
  );
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="tv-meter" role="img" aria-label={`${label} ${Math.round(value)} of 100`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function TacticsCard({ round, teams, t, humanIdx, sideOf }: { round: RoundResult; teams: [TeamSnapshot, TeamSnapshot]; t: number; humanIdx: TeamIdx; sideOf: (ti: TeamIdx) => 'T' | 'CT' }) {
  const rep = round.report;
  const tTeam = round.tTeam;
  const ctTeam: TeamIdx = tTeam === 0 ? 1 : 0;
  const over = t >= round.endTime;
  const called = rep?.callT !== null && rep?.callT !== undefined && t >= rep.callT;
  // The site as it stood at this moment of the replay (a later switch must not show early).
  const siteNow = rep ? [...(rep.siteLog ?? [{ t: 0, site: rep.plannedSite }])].filter((e) => e.t <= t + 1e-6).pop()?.site ?? rep.plannedSite : round.site;
  const site = over && rep ? rep.site : siteNow;
  const smokes = round.utility.filter((u) => u.team === tTeam && u.kind === 'smoke' && (u.landT ?? u.t) <= t).length;
  const flashed = round.utility.filter((u) => u.team === tTeam && u.kind === 'flash' && (u.landT ?? u.t) <= t).reduce((s, u) => s + u.flashed, 0);
  const tradesT = round.kills.filter((k) => k.trade && k.killerTeam === tTeam && k.t <= t).length;
  const tradesCT = round.kills.filter((k) => k.trade && k.killerTeam === ctTeam && k.t <= t).length;
  const syn = round.synergy;
  const plan = rep?.tPlan ?? round.tactics.t;
  const status = !rep ? '' : over
    ? (rep.executeScore !== null ? `Execute quality ${rep.executeScore}/100` : 'No execute this round')
    : plan === 'rush' ? `Rushing ${site}` : called ? `Hitting ${site}${(rep.siteLog ?? []).some((e) => e.t > 0 && e.t <= t) ? ' (switched)' : ''}` : tTeam !== humanIdx ? 'Their plan shows when they commit' : plan === 'execute' ? `Setting up for ${site}` : 'Taking map control';
  // Don't reveal the opponent's target site before they commit to it.
  const showSite = plan === 'rush' || called || over || tTeam === humanIdx;
  return (
    <section className="tv-tactics" aria-label="Tactics and synergy">
      <header><span className="tv-panel-title">Tactics</span><span className="faint small">{status}</span></header>
      <div className="tv-plans">
        <div className="tv-plan t">
          <span className="tv-side">T</span>
          <b>{teams[tTeam].tag}</b>
          <span>{tTeam !== humanIdx && !called && !over ? <span className="faint">Hidden</span> : <>{T_APPROACH_LABEL[plan]}{showSite && (plan !== 'default' || called) ? ` ${site}` : ''}</>}</span>
        </div>
        <div className="tv-plan ct">
          <span className="tv-side ct">CT</span>
          <b>{teams[ctTeam].tag}</b>
          <span>{ctTeam !== humanIdx && !over ? <span className="faint">Hidden until the round ends</span> : <>{CT_SETUP_LABEL[round.tactics.ct]}{round.tactics.stackSite ? ` ${round.tactics.stackSite}` : ''}</>}</span>
        </div>
      </div>
      {rep && (
        <dl className="tv-exec">
          <div><dt>Call</dt><dd className="num">{rep.callT === null ? '—' : called || over ? clockLabel(rep.callT) : 'waiting'}</dd></div>
          <div><dt>T smokes</dt><dd className="num">{smokes}</dd></div>
          <div><dt>CTs flashed</dt><dd className="num">{flashed}</dd></div>
          <div title="Trade kills: T side – CT side"><dt>Trades</dt><dd className="num">{tradesT}<span className="faint">–</span>{tradesCT}</dd></div>
          {over && rep.flashLead !== null && <div className="wide"><dt>Flash timing</dt><dd>{rep.flashLead < -1.6 ? `${(-rep.flashLead).toFixed(1)} s early` : rep.flashLead > 0.6 ? `${rep.flashLead.toFixed(1)} s late` : 'on time'}</dd></div>}
          {over && rep.entrySpread !== null && <div className="wide"><dt>Entry spread</dt><dd className="num">{rep.entrySpread.toFixed(1)} s</dd></div>}
          {over && rep.rotationT !== null && <div className="wide"><dt>CT rotation</dt><dd className="num">{clockLabel(rep.rotationT)} · {rep.rotators}</dd></div>}
        </dl>
      )}
      {syn && (
        <div className="tv-syn">
          {[humanIdx, humanIdx === 0 ? 1 : 0].map((ti) => {
            const s = syn[ti as TeamIdx];
            return (
              <div key={ti} className={`tv-syn-row ${sideOf(ti as TeamIdx) === 'T' ? 't' : 'ct'}`} title={`Roles ${s.roles} · Familiarity ${s.familiarity} · Communication ${s.communication} · Plan knowledge ${s.tactical}. Callouts reach teammates after ${s.calloutDelay.toFixed(2)} s.`}>
                <span className="tv-syn-tag">{teams[ti as TeamIdx].tag}</span>
                <span className="faint small">Synergy</span>
                <Meter value={s.overall} label="Synergy" />
                <b className="num">{s.overall}</b>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
