/**
 * Post-match analysis: turns raw round data into the reasons a team won or lost.
 * Every reason is backed by a number from the match itself.
 */
import type { MapResult, PlayerLine, TeamIdx } from './match';
import { matchRating } from './match';
import { CT_SETUP_LABEL, T_APPROACH_LABEL } from './types';
import type { CTSetup, TApproach } from './types';

export interface TeamMapStats {
  openingWins: number;
  openingTotal: number;
  pistolsWon: number;
  ecoWins: number; // rounds won on eco/pistol vs a full buy
  tRoundsWon: number;
  tRounds: number;
  ctRoundsWon: number;
  ctRounds: number;
  trades: number;
  clutches: number;
  plants: number;
  tByApproach: Partial<Record<TApproach, { won: number; played: number }>>;
  ctBySetup: Partial<Record<CTSetup, { won: number; played: number }>>;
}

export interface Reason { text: string; weight: number; good: boolean }

export function teamMapStats(m: MapResult, team: TeamIdx): TeamMapStats {
  const s: TeamMapStats = { openingWins: 0, openingTotal: 0, pistolsWon: 0, ecoWins: 0, tRoundsWon: 0, tRounds: 0, ctRoundsWon: 0, ctRounds: 0, trades: 0, clutches: 0, plants: 0, tByApproach: {}, ctBySetup: {} };
  for (const r of m.rounds) {
    const opening = r.kills.find((k) => k.opening);
    if (opening) { s.openingTotal++; if (opening.killerTeam === team) s.openingWins++; }
    if ((r.number === 1 || r.number === 13) && r.winner === team) s.pistolsWon++;
    const myBuy = r.buys[team];
    const theirBuy = r.buys[team === 0 ? 1 : 0];
    if (r.winner === team && myBuy === 'eco' && theirBuy === 'full') s.ecoWins++;
    s.trades += r.kills.filter((k) => k.trade && k.killerTeam === team).length;
    if (r.clutch && r.clutch.team === team && r.clutch.won) s.clutches++;
    if (r.tTeam === team) {
      s.tRounds++;
      if (r.winner === team) s.tRoundsWon++;
      if (r.planted) s.plants++;
      const e = (s.tByApproach[r.tactics.t] ??= { won: 0, played: 0 });
      e.played++; if (r.winner === team) e.won++;
    } else {
      s.ctRounds++;
      if (r.winner === team) s.ctRoundsWon++;
      const e = (s.ctBySetup[r.tactics.ct] ??= { won: 0, played: 0 });
      e.played++; if (r.winner === team) e.won++;
    }
  }
  return s;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Ranked list of reasons for the result, from `team`'s point of view. */
export function explainMap(m: MapResult, team: TeamIdx, names: [string, string]): Reason[] {
  const me = teamMapStats(m, team);
  const opp = teamMapStats(m, team === 0 ? 1 : 0);
  const won = m.winner === team;
  const reasons: Reason[] = [];
  const oppName = names[team === 0 ? 1 : 0];

  const openPct = pct(me.openingWins, me.openingTotal);
  if (Math.abs(openPct - 50) >= 8) {
    reasons.push({ good: openPct > 50, weight: Math.abs(openPct - 50) / 5, text: `Opening duels: won ${me.openingWins} of ${me.openingTotal} (${openPct}%). ${openPct > 50 ? 'Your team got the first kill most rounds.' : 'You were a player down early too often.'}` });
  }
  if (me.pistolsWon !== 1) {
    reasons.push({ good: me.pistolsWon === 2, weight: 3, text: me.pistolsWon === 2 ? 'Won both pistol rounds, which set up the economy for each half.' : 'Lost both pistol rounds, which put you on the back foot economically each half.' });
  }
  if (me.ecoWins + opp.ecoWins > 0) {
    reasons.push({ good: me.ecoWins >= opp.ecoWins, weight: 2 * Math.abs(me.ecoWins - opp.ecoWins) + 1, text: `Eco upsets: you won ${me.ecoWins}, ${oppName} won ${opp.ecoWins}.` });
  }
  if (Math.abs(me.trades - opp.trades) >= 3) {
    reasons.push({ good: me.trades > opp.trades, weight: Math.abs(me.trades - opp.trades) / 1.5, text: `Trades: ${me.trades} vs ${opp.trades}. ${me.trades > opp.trades ? 'Good spacing and teamwork meant deaths were punished.' : 'Deaths went untraded; work on trading drills or chemistry.'}` });
  }
  if (me.clutches + opp.clutches > 0 && me.clutches !== opp.clutches) {
    reasons.push({ good: me.clutches > opp.clutches, weight: 2 * Math.abs(me.clutches - opp.clutches), text: `Clutches won: ${me.clutches} vs ${opp.clutches}.` });
  }
  for (const [k, v] of Object.entries(me.tByApproach) as [TApproach, { won: number; played: number }][]) {
    if (v.played >= 4) {
      const p = pct(v.won, v.played);
      if (p >= 65 || p <= 35) reasons.push({ good: p >= 65, weight: Math.abs(p - 50) / 8, text: `T side ${T_APPROACH_LABEL[k]}: ${v.won}/${v.played} rounds. ${p >= 65 ? 'Their CT setups struggled with it.' : 'Their CT setup countered it; try another approach at a timeout.'}` });
    }
  }
  for (const [k, v] of Object.entries(me.ctBySetup) as [CTSetup, { won: number; played: number }][]) {
    if (v.played >= 4) {
      const p = pct(v.won, v.played);
      if (p >= 65 || p <= 35) reasons.push({ good: p >= 65, weight: Math.abs(p - 50) / 8, text: `CT side ${CT_SETUP_LABEL[k]}: ${v.won}/${v.played} rounds. ${p >= 65 ? 'It read their attacks well.' : 'Their attacks were built to beat it.'}` });
    }
  }
  const tPct = pct(me.tRoundsWon, me.tRounds);
  const ctPct = pct(me.ctRoundsWon, me.ctRounds);
  if (Math.abs(tPct - ctPct) >= 25) {
    reasons.push({ good: won, weight: 1.5, text: `Side split: ${me.tRoundsWon}/${me.tRounds} on T, ${me.ctRoundsWon}/${me.ctRounds} on CT.` });
  }
  const lines = m.lines.filter((l) => l.team === team);
  const rounds = m.rounds.length;
  const best = [...lines].sort((a, b) => matchRating(b, rounds) - matchRating(a, rounds))[0];
  const worst = [...lines].sort((a, b) => matchRating(a, rounds) - matchRating(b, rounds))[0];
  if (best && matchRating(best, rounds) >= 1.25) reasons.push({ good: true, weight: 2, text: `${best.handle} carried with a ${matchRating(best, rounds).toFixed(2)} rating (${best.kills}-${best.deaths}).` });
  if (worst && matchRating(worst, rounds) <= 0.75) reasons.push({ good: false, weight: 1.5, text: `${worst.handle} struggled (${matchRating(worst, rounds).toFixed(2)} rating). Check fatigue, sharpness and role fit.` });

  // Lead with reasons that match the result.
  return reasons.sort((a, b) => Number(b.good === won) - Number(a.good === won) || b.weight - a.weight).slice(0, 5);
}

export interface SeriesLine extends PlayerLine { rating: number; rounds: number }

/** Combined stat lines across all maps of a series. */
export function seriesLines(maps: MapResult[]): SeriesLine[] {
  const acc = new Map<string, SeriesLine>();
  for (const m of maps) {
    const rounds = m.rounds.length;
    for (const l of m.lines) {
      const e = acc.get(l.id) ?? { ...l, kills: 0, deaths: 0, assists: 0, damage: 0, openingKills: 0, openingDeaths: 0, clutchesWon: 0, multiKillRounds: 0, kastRounds: 0, headshots: 0, utilityDamage: 0, enemiesFlashed: 0, rating: 0, rounds: 0 };
      e.kills += l.kills; e.deaths += l.deaths; e.assists += l.assists; e.damage += l.damage;
      e.openingKills += l.openingKills; e.openingDeaths += l.openingDeaths; e.clutchesWon += l.clutchesWon;
      e.multiKillRounds += l.multiKillRounds; e.kastRounds += l.kastRounds; e.rounds += rounds;
      e.headshots += l.headshots ?? 0; e.utilityDamage += l.utilityDamage ?? 0; e.enemiesFlashed += l.enemiesFlashed ?? 0;
      acc.set(l.id, e);
    }
  }
  for (const e of acc.values()) e.rating = matchRating(e, e.rounds);
  return [...acc.values()];
}

export interface TeamCondition { avgFatigue: number; chemistry: number; lowSharpness: string[]; tired: string[]; prepared: boolean }

/**
 * What to train next week, derived from this match's numbers and the team's condition.
 * Each tip names the training activity that addresses it.
 */
export function trainingAdvice(maps: MapResult[], team: TeamIdx, cond: TeamCondition): { text: string; activity: string }[] {
  const tips: { text: string; activity: string; weight: number }[] = [];
  const sum = (f: (s: TeamMapStats) => number, t: TeamIdx) => maps.reduce((a, m) => a + f(teamMapStats(m, t)), 0);
  const opp: TeamIdx = team === 0 ? 1 : 0;
  const openW = sum((s) => s.openingWins, team), openT = sum((s) => s.openingTotal, team);
  if (openT && openW / openT < 0.45) tips.push({ weight: 3, activity: 'Entry & trade drills', text: `You won only ${openW} of ${openT} opening duels.` });
  const tr = sum((s) => s.trades, team), trOpp = sum((s) => s.trades, opp);
  if (tr + 3 <= trOpp) tips.push({ weight: 2.5, activity: 'Entry & trade drills', text: `Fewer trades than the opponent (${tr} vs ${trOpp}).` });
  const util = maps.reduce((a, m) => a + m.lines.filter((l) => l.team === team).reduce((x, l) => x + (l.utilityDamage ?? 0), 0), 0);
  const utilOpp = maps.reduce((a, m) => a + m.lines.filter((l) => l.team === opp).reduce((x, l) => x + (l.utilityDamage ?? 0), 0), 0);
  if (util < utilOpp * 0.75) tips.push({ weight: 2, activity: 'Utility lab', text: `Their grenades did more damage (${utilOpp} vs ${util}).` });
  const cl = sum((s) => s.clutches, team), clOpp = sum((s) => s.clutches, opp);
  if (clOpp >= cl + 2) tips.push({ weight: 1.5, activity: 'Clutch scenarios', text: `They won ${clOpp} clutches to your ${cl}.` });
  const ct = sum((s) => s.ctRoundsWon, team) / Math.max(1, sum((s) => s.ctRounds, team));
  const t = sum((s) => s.tRoundsWon, team) / Math.max(1, sum((s) => s.tRounds, team));
  if (Math.abs(ct - t) > 0.2) tips.push({ weight: 1.5, activity: 'Team scrims', text: `Your ${ct < t ? 'CT' : 'T'} side was much weaker (${Math.round(Math.min(ct, t) * 100)}% of rounds).` });
  if (cond.avgFatigue >= 55 || cond.tired.length >= 2) tips.push({ weight: 4, activity: 'Rest day', text: `The team is tired (average fatigue ${Math.round(cond.avgFatigue)}${cond.tired.length ? `; ${cond.tired.join(', ')} above 60` : ''}). Tired players lose duels.` });
  if (cond.chemistry < 40) tips.push({ weight: 3, activity: 'Team scrims or a bootcamp', text: `Chemistry is low (${Math.round(cond.chemistry)}), which hurts coordination and trading. Keep the same five together.` });
  if (cond.lowSharpness.length) tips.push({ weight: 2, activity: 'Any practice', text: `${cond.lowSharpness.join(', ')} ${cond.lowSharpness.length === 1 ? 'is' : 'are'} short of sharpness.` });
  if (!cond.prepared) tips.push({ weight: 1, activity: 'Tactical review', text: 'You went in without opponent prep. A review gives exact scouting and a small edge.' });
  return tips.sort((a, b) => b.weight - a.weight).slice(0, 4).map(({ text, activity }) => ({ text, activity }));
}

export interface KeyMoment { round: number; text: string; good: boolean }

/**
 * The rounds a viewer would remember: pistols, aces, clutches, upsets on a
 * weaker buy, streaks and comebacks. Read from round data only.
 */
export function keyMoments(m: MapResult, team: TeamIdx, names: [string, string]): KeyMoment[] {
  const out: KeyMoment[] = [];
  const handle = new Map(m.lines.map((l) => [l.id, l.handle]));
  const us = names[team];
  const them = names[team === 0 ? 1 : 0];
  let streakTeam: TeamIdx | null = null;
  let streak = 0;
  let worst = 0; // our lowest score difference
  for (const r of m.rounds) {
    const mine = r.winner === team;
    const who = mine ? us : them;
    if (r.buys[0] === 'pistol') out.push({ round: r.number, text: `${who} win the pistol round.`, good: mine });
    const wb = r.buys[r.winner];
    const lb = r.buys[r.winner === 0 ? 1 : 0];
    if ((wb === 'eco' || wb === 'force') && lb === 'full') out.push({ round: r.number, text: `${who} steal the round on ${wb === 'eco' ? 'an eco' : 'a force buy'} against a full buy.`, good: mine });
    const perPlayer = new Map<string, number>();
    for (const k of r.kills) perPlayer.set(k.killerId, (perPlayer.get(k.killerId) ?? 0) + 1);
    for (const [id, k] of perPlayer) if (k >= 4) {
      const line = m.lines.find((l) => l.id === id);
      out.push({ round: r.number, text: `${handle.get(id) ?? 'A player'} gets ${k === 5 ? 'an ace' : 'four kills'}.`, good: line?.team === team });
    }
    if (r.clutch?.won && r.clutch.vs >= 2) out.push({ round: r.number, text: `${handle.get(r.clutch.playerId) ?? 'A player'} wins a 1v${r.clutch.vs}.`, good: r.clutch.team === team });
    if (streakTeam === r.winner) streak++; else { streakTeam = r.winner; streak = 1; }
    if (streak === 5) out.push({ round: r.number, text: `${who} win five rounds in a row.`, good: mine });
    const diff = r.score[team] - r.score[team === 0 ? 1 : 0];
    worst = Math.min(worst, diff);
  }
  const final = m.score[team] - m.score[team === 0 ? 1 : 0];
  if (worst <= -5 && final > 0) out.push({ round: m.rounds.length, text: `Comeback: ${us} were ${-worst} rounds down and still won.`, good: true });
  const best = Math.max(0, ...m.rounds.map((r) => r.score[team] - r.score[team === 0 ? 1 : 0]));
  if (best >= 5 && final < 0) out.push({ round: m.rounds.length, text: `${us} let a ${best}-round lead slip.`, good: false });
  // Keep the list short: pistols and big plays first, in round order.
  return out.sort((a, b) => a.round - b.round).slice(0, 8);
}

/** Rounds won by buy type, for one team. */
export function buyRecord(m: MapResult, team: TeamIdx): Record<'pistol' | 'eco' | 'force' | 'full', { won: number; played: number }> {
  const rec = { pistol: { won: 0, played: 0 }, eco: { won: 0, played: 0 }, force: { won: 0, played: 0 }, full: { won: 0, played: 0 } };
  for (const r of m.rounds) {
    const b = rec[r.buys[team]];
    b.played++;
    if (r.winner === team) b.won++;
  }
  return rec;
}
