/**
 * Map engine: economy, tactics, timeouts and scoring around the round
 * simulation in ./sim/round.ts.
 *
 * Each round is played out on the map grid by ten simulated players (sight,
 * reaction, aim, damage, utility, plans and calls). The winner of a round or a
 * map is never picked from an overall rating; it comes from the fights.
 *
 * Everything random goes through a seeded Rng, so the same seed and the same
 * decisions always replay the same match. Recording a replay for the viewer
 * does not change any result. The simulation can be stepped one round at a
 * time so the UI can show it live and accept timeouts.
 */
import { Rng, clamp } from './rng';
import { geometryFor } from '../maps';
import { simulateRound } from './sim/round';
import type { SimLoadout, TacticReport, RoundReplay } from './sim/round';
import { teamSynergy } from './sim/synergy';
import type { TeamSynergy } from './sim/synergy';
import { COUNTER_TABLE, MAP_T_BIAS, MATCHUP_T_WIN, STACK_SWING } from './tactics';
import type { MatchPlayer, TeamSnapshot } from './team';
import type { CTSetup, MapName, Tactics, TApproach } from './types';

export type Side = 'T' | 'CT';
export type BuyType = 'pistol' | 'eco' | 'force' | 'full';
export type Zone = 'A' | 'B' | 'Mid';
export type TeamIdx = 0 | 1;

export interface KillEvent {
  t: number; // seconds into the round (two decimals)
  killerId: string;
  victimId: string;
  killerTeam: TeamIdx;
  assisterId?: string;
  weapon: string;
  headshot: boolean;
  zone: Zone;
  opening: boolean;
  trade: boolean;
  /** Fight context from the simulation. */
  how?: { preAimed: boolean; victimBlind: boolean; victimMoving: boolean; killerHolding: boolean; distance: number; crossfire: boolean; heard?: boolean };
  flashAssist?: boolean;
}

export type UtilityKind = 'smoke' | 'flash' | 'molotov' | 'he';

/** Gunfire damage the engine counted for ADR, so a viewer can show exact HP. Utility damage is in UtilityEvent. */
export interface HitEvent {
  t: number;
  attackerId: string;
  victimId: string;
  damage: number;
  lethal: boolean;
}

/** Utility thrown in a round. Presentation of the utility edge the engine already applies; detail comes from a separate random stream. */
export interface UtilityEvent {
  t: number;
  playerId: string;
  team: TeamIdx;
  kind: UtilityKind;
  zone: Zone;
  flashed: number; // enemies blinded
  damage: number; // HE / molotov damage dealt
  /** Where it flew and landed (map cells), when it popped, and what it hit. */
  landT?: number;
  from?: [number, number];
  at?: [number, number];
  radius?: number;
  duration?: number;
  victims?: { id: string; damage: number }[];
  flashedIds?: string[];
  purpose?: string;
}

export interface RoundResult {
  number: number;
  winner: TeamIdx;
  winnerSide: Side;
  reason: 'elimination' | 'bomb' | 'defuse' | 'saved' | 'time';
  tTeam: TeamIdx;
  buys: [BuyType, BuyType];
  kills: KillEvent[];
  planted: boolean;
  plantTime?: number;
  site: 'A' | 'B';
  tactics: { t: TApproach; ct: CTSetup; stackSite?: 'A' | 'B' };
  clutch?: { playerId: string; team: TeamIdx; vs: number; won: boolean };
  score: [number, number];
  commentary: string[];
  survivors: string[];
  utility: UtilityEvent[];
  hits: HitEvent[];
  /** Equipment value each team brought into the round, by team index. */
  equipment: [number, number];
  planterId?: string;
  defuserId?: string;
  mvpId?: string;
  /** Seconds when the round ended (bomb timer and defuses included). */
  endTime: number;
  /** The plan, the calls and why it worked or failed. */
  report?: TacticReport;
  /** Positions, aim, shots and bomb state for the viewer (only when recording). */
  replay?: RoundReplay;
  /** What each player carried (by player id). */
  loadouts?: Record<string, SimLoadout>;
  /** Team synergy used for this round, by team index. */
  synergy?: [SynergySummary, SynergySummary];
}

export type SynergySummary = Omit<TeamSynergy, 'pair'>;

export interface PlayerLine {
  id: string;
  handle: string;
  team: TeamIdx;
  role: MatchPlayer['role'];
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  openingKills: number;
  openingDeaths: number;
  clutchesWon: number;
  multiKillRounds: number;
  kastRounds: number;
  headshots: number;
  utilityDamage: number;
  enemiesFlashed: number;
}

export interface MapResult {
  map: MapName;
  score: [number, number];
  winner: TeamIdx;
  rounds: RoundResult[];
  lines: PlayerLine[];
}

const BUY_SPEND: Record<BuyType, (money: number) => number> = {
  pistol: () => 650,
  eco: (m) => Math.min(m, 350),
  force: (m) => Math.min(m, 2600) * 0.9,
  full: (m) => Math.min(m, 4500),
};

function summary(s: TeamSynergy): SynergySummary {
  const { pair: _pair, ...rest } = s;
  return rest;
}

/** Buy-dependent loadout. Weapons and grenades follow the team's buy; the AWP goes to the AWPer on full buys. */
export function loadoutFor(p: MatchPlayer, side: Side, buy: BuyType, rng: Rng): SimLoadout {
  const nades: UtilityKind[] = [];
  if (buy === 'full') {
    nades.push('flash', 'smoke');
    nades.push(side === 'T' || p.role === 'support' || p.role === 'igl' ? 'molotov' : 'he');
    if (p.role === 'support' || p.role === 'igl') nades.push('flash');
    if (side === 'T' && p.role === 'entry') nades.push('he');
    const weapon = p.role === 'awp' ? 'AWP' : side === 'T' ? 'AK-47' : rng.chance(0.55) ? 'M4A1-S' : 'M4A4';
    return { weapon, armor: true, helmet: true, kit: side === 'CT' && rng.chance(0.75), nades };
  }
  if (buy === 'force') {
    nades.push('flash');
    if (p.role === 'support' || p.role === 'igl') nades.push(side === 'T' ? 'molotov' : 'smoke');
    const weapon = side === 'T' ? rng.pick(['Galil AR', 'MAC-10', 'Desert Eagle']) : rng.pick(['FAMAS', 'MP9', 'Desert Eagle']);
    return { weapon, armor: true, helmet: rng.chance(0.4), kit: side === 'CT' && rng.chance(0.25), nades };
  }
  if (buy === 'pistol') {
    if (p.role === 'support' || p.role === 'igl') nades.push(rng.chance(0.5) ? 'flash' : 'smoke');
    return { weapon: side === 'T' ? 'Glock-18' : 'USP-S', armor: rng.chance(0.5), helmet: false, kit: side === 'CT' && rng.chance(0.2), nades };
  }
  if (p.role === 'support' && rng.chance(0.5)) nades.push('flash');
  return { weapon: side === 'T' ? rng.pick(['Glock-18', 'P250', 'Glock-18']) : rng.pick(['USP-S', 'P250', 'USP-S']), armor: false, helmet: false, kit: false, nades };
}

export interface MapSimOptions {
  seed: number;
  teams: [TeamSnapshot, TeamSnapshot];
  map: MapName;
  ctFirst: TeamIdx;
  /** Keep positions and shots for the viewer (watching live). Never changes results. */
  record?: boolean;
}

export class MapSim {
  readonly map: MapName;
  readonly teams: [TeamSnapshot, TeamSnapshot];
  readonly ctFirst: TeamIdx;
  readonly rounds: RoundResult[] = [];
  score: [number, number] = [0, 0];
  tactics: [Tactics, Tactics];
  timeoutsLeft: [number, number] = [2, 2];
  private money: [number, number] = [800, 800];
  private lossStreak: [number, number] = [0, 0];
  private momentum: [{ rounds: number; value: number }, { rounds: number; value: number }] = [{ rounds: 0, value: 0 }, { rounds: 0, value: 0 }];
  private lines = new Map<string, PlayerLine>();
  private rng: Rng;
  readonly synergy: [TeamSynergy, TeamSynergy];
  private record: boolean;
  /** Tactics each team has used, so the AI can adapt to them. */
  private usedT: [Record<TApproach, number>, Record<TApproach, number>] = [{ default: 0, execute: 0, rush: 0 }, { default: 0, execute: 0, rush: 0 }];
  private usedCT: [Record<CTSetup, number>, Record<CTSetup, number>] = [
    { standard: 0, stack: 0, retake: 0, aggro: 0 },
    { standard: 0, stack: 0, retake: 0, aggro: 0 },
  ];
  private usedSite: [{ A: number; B: number }, { A: number; B: number }] = [{ A: 0, B: 0 }, { A: 0, B: 0 }];

  constructor(opts: MapSimOptions) {
    this.map = opts.map;
    this.teams = opts.teams;
    this.ctFirst = opts.ctFirst;
    this.rng = new Rng(opts.seed);
    this.tactics = [{ ...opts.teams[0].tactics }, { ...opts.teams[1].tactics }];
    this.synergy = [teamSynergy(opts.teams[0], opts.map), teamSynergy(opts.teams[1], opts.map)];
    this.record = opts.record ?? false;
    opts.teams.forEach((team, ti) => {
      for (const p of team.players) {
        this.lines.set(p.id, {
          id: p.id, handle: p.handle, team: ti as TeamIdx, role: p.role,
          kills: 0, deaths: 0, assists: 0, damage: 0, openingKills: 0, openingDeaths: 0, clutchesWon: 0, multiKillRounds: 0, kastRounds: 0, headshots: 0, utilityDamage: 0, enemiesFlashed: 0,
        });
      }
    });
  }

  get roundNumber(): number {
    return this.rounds.length + 1;
  }

  /** Which team is CT in a given round number (1-based). */
  ctTeamFor(round: number): TeamIdx {
    const other: TeamIdx = this.ctFirst === 0 ? 1 : 0;
    if (round <= 12) return this.ctFirst;
    if (round <= 24) return other;
    const otRound = (round - 25) % 6; // overtime halves of 3
    return otRound < 3 ? other : this.ctFirst;
  }

  get finished(): boolean {
    const total = this.rounds.length;
    const max = Math.max(...this.score);
    if (total <= 24) return max >= 13;
    const block = Math.floor((total - 25) / 6);
    const base = 12 + 3 * block;
    return max >= base + 4;
  }

  get isHalftime(): boolean {
    return this.rounds.length === 12;
  }

  /** Free tactic change (halftime, before the map). */
  setTactics(team: TeamIdx, tactics: Tactics): void {
    this.tactics[team] = { ...tactics };
  }

  /** Tactical timeout: change plan mid-half and get a short momentum boost scaled by the coach. */
  callTimeout(team: TeamIdx, tactics: Tactics): boolean {
    if (this.timeoutsLeft[team] <= 0 || this.finished) return false;
    this.timeoutsLeft[team]--;
    this.tactics[team] = { ...tactics };
    const adapt = this.teams[team].coach?.attrs.adaptability ?? 40;
    this.momentum[team] = { rounds: 2, value: 0.04 + adapt / 1000 };
    return true;
  }

  private decideBuy(team: TeamIdx, round: number): BuyType {
    if (round === 1 || round === 13) return 'pistol';
    if (round >= 25) return 'full';
    const m = this.money[team];
    const opp: TeamIdx = team === 0 ? 1 : 0;
    const desperate = this.score[opp] >= 12 || round === 12 || round === 24;
    const policy = this.tactics[team].economy ?? 'standard';
    if (policy === 'disciplined') {
      if (m >= 3900) return 'full';
      if (desperate && m >= 2000) return 'force';
      return 'eco';
    }
    if (policy === 'force') {
      if (m >= 3700) return 'full';
      if (m >= 1800 || (desperate && m >= 1200)) return 'force';
      return 'eco';
    }
    if (m >= 3900) return 'full';
    if (m >= 2600 || (desperate && m >= 1500)) return 'force';
    return 'eco';
  }

  private chooseAiTactics(team: TeamIdx, side: Side): { t: TApproach; ct: CTSetup; stackSite: 'A' | 'B' } {
    const snap = this.teams[team];
    const opp: TeamIdx = team === 0 ? 1 : 0;
    const recent = this.rounds.slice(-4);
    const lostRecent = recent.filter((r) => r.winner !== team).length;
    const adapt = 0.35 + (snap.coach?.attrs.adaptability ?? 50) / 200;
    const shouldAdapt = this.rounds.length >= 4 && lostRecent >= 3 && this.rng.chance(adapt);
    let t = this.rng.weighted<TApproach>(['default', 'execute', 'rush'], (k) => snap.tendencies.t[k]);
    let ct = this.rng.weighted<CTSetup>(['standard', 'stack', 'retake', 'aggro'], (k) => snap.tendencies.ct[k]);
    if (shouldAdapt && side === 'T') {
      const mostCT = (Object.entries(this.usedCT[opp]) as [CTSetup, number][]).sort((a, b) => b[1] - a[1])[0]![0];
      t = (['default', 'execute', 'rush'] as TApproach[]).sort((a, b) => MATCHUP_T_WIN[b][mostCT] - MATCHUP_T_WIN[a][mostCT])[0]!;
    }
    if (shouldAdapt && side === 'CT') {
      const mostT = (Object.entries(this.usedT[opp]) as [TApproach, number][]).sort((a, b) => b[1] - a[1])[0]![0];
      ct = (['standard', 'retake', 'aggro'] as CTSetup[]).sort((a, b) => MATCHUP_T_WIN[mostT][a] - MATCHUP_T_WIN[mostT][b])[0]!;
    }
    let stackSite: 'A' | 'B' = this.rng.chance(0.5) ? 'A' : 'B';
    const os = this.usedSite[opp];
    if (os.A + os.B >= 3) stackSite = os.A >= os.B ? 'A' : 'B';
    return { t, ct, stackSite };
  }

  private line(id: string): PlayerLine {
    return this.lines.get(id)!;
  }

  playRound(): RoundResult {
    if (this.finished) throw new Error('Map already finished');
    const rng = this.rng;
    const round = this.roundNumber;
    if (round === 13) this.money = [800, 800];
    if (round >= 25 && (round - 25) % 6 === 0) this.money = [10000, 10000];
    if (round === 13 || (round >= 25 && (round - 25) % 3 === 0)) this.lossStreak = [0, 0];

    const ctTeam = this.ctTeamFor(round);
    const tTeam: TeamIdx = ctTeam === 0 ? 1 : 0;
    const T = this.teams[tTeam];
    const CT = this.teams[ctTeam];

    // --- Tactics for this round
    const tPlan = T.isHuman ? { t: this.tactics[tTeam].tApproach, site: rng.chance(0.5) ? 'A' as const : 'B' as const } : (() => {
      const c = this.chooseAiTactics(tTeam, 'T');
      return { t: c.t, site: rng.chance(T.tendencies.aSiteBias) ? 'A' as const : 'B' as const };
    })();
    const ctPlan = CT.isHuman
      ? { ct: this.tactics[ctTeam].ctSetup, stackSite: this.tactics[ctTeam].stackSite }
      : (() => { const c = this.chooseAiTactics(ctTeam, 'CT'); return { ct: c.ct, stackSite: c.stackSite }; })();
    this.usedT[tTeam][tPlan.t]++;
    this.usedCT[ctTeam][ctPlan.ct]++;
    this.usedSite[tTeam][tPlan.site]++;

    // --- Economy
    const buyT = this.decideBuy(tTeam, round);
    const buyCT = this.decideBuy(ctTeam, round);
    const spendT = BUY_SPEND[buyT](this.money[tTeam]);
    const spendCT = BUY_SPEND[buyCT](this.money[ctTeam]);
    this.money[tTeam] -= spendT;
    this.money[ctTeam] -= spendCT;
    const equipValue = (spend: number) => Math.round((spend * 5 + 1000) / 50) * 50;
    const equipment: [number, number] = tTeam === 0 ? [equipValue(spendT), equipValue(spendCT)] : [equipValue(spendCT), equipValue(spendT)];
    const loadouts = new Map<string, SimLoadout>();
    for (const p of T.players) loadouts.set(p.id, loadoutFor(p, 'T', buyT, rng));
    for (const p of CT.players) loadouts.set(p.id, loadoutFor(p, 'CT', buyCT, rng));

    // --- Team-level edges (small, bounded): reading the opponent's setup,
    // preparation, the coach's plan, momentum after a timeout, map calibration.
    let read = COUNTER_TABLE[tPlan.t][ctPlan.ct];
    if (ctPlan.ct === 'stack') read += ctPlan.stackSite === tPlan.site ? STACK_SWING.correct * 0.5 : STACK_SWING.wrong * 0.3;
    const coachMod = ((T.coach?.attrs.tactics ?? 40) - (CT.coach?.attrs.tactics ?? 40)) / 100 * 0.3;
    const momT = this.momentum[tTeam].rounds > 0 ? this.momentum[tTeam].value : 0;
    const momCT = this.momentum[ctTeam].rounds > 0 ? this.momentum[ctTeam].value : 0;
    this.momentum.forEach((m) => { if (m.rounds > 0) m.rounds--; });
    // The plan read and the map calibration are bounded on their own; coach, prep and momentum together.
    const tEdge = clamp(read, -0.9, 0.9) + clamp(coachMod / 2 + T.prepBonus + momT, -0.6, 0.6) + MAP_T_BIAS[this.map];
    const ctEdge = clamp(-coachMod / 2 + CT.prepBonus + momCT, -0.6, 0.6);
    const edge: [number, number] = tTeam === 0 ? [tEdge, ctEdge] : [ctEdge, tEdge];

    const sim = simulateRound({
      geo: geometryFor(this.map), seed: rng.int(1, 2 ** 31 - 1), tTeam, teams: this.teams, loadouts,
      plan: { t: tPlan.t, site: tPlan.site, ct: ctPlan.ct, stackSite: ctPlan.stackSite },
      playstyle: [this.tactics[0].playstyle, this.tactics[1].playstyle], footsteps: [this.tactics[0].footsteps ?? 'normal', this.tactics[1].footsteps ?? 'normal'], synergy: this.synergy, edge, record: this.record,
    });

    // --- Events → round result and player lines
    const kills: KillEvent[] = sim.kills.map((k) => ({ t: k.t, killerId: k.killer, victimId: k.victim, killerTeam: k.killerTeam, assisterId: k.assister, weapon: k.weapon, headshot: k.headshot, zone: k.zone, opening: k.opening, trade: k.trade, how: k.how, flashAssist: k.flashAssist }));
    const hits: HitEvent[] = sim.hits.map((h) => ({ t: h.t, attackerId: h.attacker, victimId: h.victim, damage: h.damage, lethal: h.lethal }));
    const utility: UtilityEvent[] = sim.utility.map((u) => ({
      t: u.t, playerId: u.playerId, team: u.team, kind: u.kind, zone: u.zone, flashed: u.flashedEnemies, damage: u.damage,
      landT: u.landT, from: u.from, at: u.at, radius: u.radius, duration: u.duration, victims: u.victims, flashedIds: u.flashed, purpose: u.purpose,
    }));
    const roundKills = new Map<string, number>();
    const assisted = new Set<string>();
    const traded = new Set<string>();
    for (const k of kills) {
      const kl = this.line(k.killerId), vl = this.line(k.victimId);
      kl.kills++; vl.deaths++;
      if (k.headshot) kl.headshots++;
      if (k.opening) { kl.openingKills++; vl.openingDeaths++; }
      if (k.assisterId) { this.line(k.assisterId).assists++; assisted.add(k.assisterId); }
      roundKills.set(k.killerId, (roundKills.get(k.killerId) ?? 0) + 1);
      if (k.trade) {
        // the player the killer had just killed counts as traded (KAST)
        const prev = [...kills].reverse().find((x) => x.t <= k.t && x.killerId === k.victimId && x !== k);
        if (prev) traded.add(prev.victimId);
      }
    }
    for (const [id, d] of sim.damage) this.line(id).damage += d;
    for (const u of utility) { const ln = this.line(u.playerId); ln.utilityDamage += u.damage; ln.enemiesFlashed += u.flashed; }

    const ended = { winner: sim.winnerSide, reason: sim.reason };
    const winner: TeamIdx = ended.winner === 'T' ? tTeam : ctTeam;
    const loser: TeamIdx = winner === 0 ? 1 : 0;
    this.score[winner]++;

    const commentary: string[] = [];
    for (const e of sim.report.events) if (e.kind === 'call' || e.kind === 'adapt' || e.kind === 'bomb' || (e.kind === 'fight' && /opens/.test(e.text))) commentary.push(e.text);
    let clutch: RoundResult['clutch'];
    if (sim.clutch) {
      clutch = { ...sim.clutch, won: sim.clutch.team === winner };
      if (clutch.won) {
        this.line(clutch.playerId).clutchesWon++;
        commentary.push(`${this.line(clutch.playerId).handle} wins the 1v${clutch.vs} clutch!`);
      }
    }
    for (const [id, n] of roundKills) {
      if (n >= 2) this.line(id).multiKillRounds++;
      if (n >= 3) commentary.push(`${this.line(id).handle} with ${n === 5 ? 'an ACE' : n === 4 ? 'a quad kill' : 'a triple kill'}.`);
    }
    const survivors = sim.survivors;
    for (const p of [...T.players, ...CT.players]) {
      if (roundKills.has(p.id) || assisted.has(p.id) || survivors.includes(p.id) || traded.has(p.id)) this.line(p.id).kastRounds++;
    }
    const wBuy = winner === tTeam ? buyT : buyCT;
    const lBuy = loser === tTeam ? buyT : buyCT;
    if ((lBuy === 'full' && (wBuy === 'eco' || wBuy === 'pistol')) && round !== 1 && round !== 13) commentary.push(`Huge eco win for ${this.teams[winner].tag}!`);
    if (round === 1 || round === 13) commentary.push(`${this.teams[winner].tag} take the pistol round.`);
    commentary.push(sim.report.verdict);

    // Money
    const winReward = ended.reason === 'bomb' ? 3500 : 3250;
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] = Math.min(4, this.lossStreak[loser] + 1);
    const lossBonus = 1400 + 500 * (this.lossStreak[loser] - 1);
    const killsBy = (team: TeamIdx) => kills.filter((k) => k.killerTeam === team).length;
    const surviving = (team: TeamIdx) => this.teams[team].players.filter((p) => survivors.includes(p.id)).length;
    this.money[winner] = Math.min(16000, this.money[winner] + winReward + (killsBy(winner) * 300) / 5 + (surviving(winner) * 2800) / 5);
    const plantBonus = loser === tTeam && sim.planted ? 800 : 0;
    this.money[loser] = Math.min(16000, this.money[loser] + lossBonus + plantBonus + (killsBy(loser) * 300) / 5 + (surviving(loser) * 3200) / 5);

    // MVP: most kills on the winning side, then the planter or defuser.
    let mvpId: string | undefined;
    let best = -1;
    for (const p of this.teams[winner].players) {
      const score = (roundKills.get(p.id) ?? 0) * 10 + (p.id === sim.planterId || p.id === sim.defuserId ? 5 : 0) + (survivors.includes(p.id) ? 1 : 0) + (sim.damage.get(p.id) ?? 0) / 100;
      if (score > best) { best = score; mvpId = p.id; }
    }

    const result: RoundResult = {
      number: round,
      winner,
      winnerSide: ended.winner,
      reason: ended.reason,
      tTeam,
      buys: tTeam === 0 ? [buyT, buyCT] : [buyCT, buyT],
      kills,
      planted: sim.planted,
      plantTime: sim.plantTime,
      site: sim.site,
      tactics: { t: tPlan.t, ct: ctPlan.ct, stackSite: ctPlan.ct === 'stack' ? ctPlan.stackSite : undefined },
      clutch,
      score: [this.score[0], this.score[1]],
      commentary,
      survivors,
      utility,
      hits,
      equipment,
      planterId: sim.planterId,
      defuserId: sim.defuserId,
      mvpId,
      endTime: sim.endTime,
      report: sim.report,
      replay: sim.replay,
      loadouts: Object.fromEntries(loadouts),
      synergy: [summary(this.synergy[0]), summary(this.synergy[1])],
    };
    this.rounds.push(result);
    return result;
  }

  playToEnd(): MapResult {
    while (!this.finished) this.playRound();
    return this.result();
  }

  result(): MapResult {
    return {
      map: this.map,
      score: [this.score[0], this.score[1]],
      winner: this.score[0] > this.score[1] ? 0 : 1,
      rounds: this.rounds,
      lines: [...this.lines.values()].map((l) => ({ ...l })),
    };
  }
}

// ---------- Player rating (our own formula, NOT the HLTV rating) ----------

/**
 * "CSM rating": average about 1.00. Components and weights are documented in BALANCING.md.
 */
export function matchRating(l: PlayerLine, rounds: number): number {
  if (rounds <= 0) return 0;
  const kpr = l.kills / rounds;
  const dpr = l.deaths / rounds;
  const adr = l.damage / rounds;
  const kast = l.kastRounds / rounds;
  const impact = (2 * l.openingKills + 3 * l.clutchesWon + l.multiKillRounds) / rounds;
  const r = 0.32 * (kpr / 0.68) + 0.18 * ((1 - dpr) / 0.32) + 0.22 * (adr / 76) + 0.18 * (kast / 0.72) + 0.1 * (impact / 0.4);
  return Math.max(0, Number(r.toFixed(2)));
}

// ---------- Series ----------

export type SeriesFormat = 'bo1' | 'bo3';

export interface SeriesResult {
  format: SeriesFormat;
  maps: MapResult[];
  mapScore: [number, number];
  winner: TeamIdx;
}

export function mapsNeeded(format: SeriesFormat): number {
  return format === 'bo1' ? 1 : 2;
}

/** Simulates a whole series instantly (used for AI vs AI and quick sim). */
export function simulateSeries(seed: number, teams: [TeamSnapshot, TeamSnapshot], maps: MapName[], format: SeriesFormat): SeriesResult {
  const rng = new Rng(seed);
  const results: MapResult[] = [];
  const mapScore: [number, number] = [0, 0];
  for (let i = 0; i < maps.length; i++) {
    if (Math.max(...mapScore) >= mapsNeeded(format)) break;
    const sim = new MapSim({ seed: rng.int(1, 2 ** 31 - 1), teams, map: maps[i]!, ctFirst: rng.chance(0.5) ? 0 : 1 });
    const r = sim.playToEnd();
    results.push(r);
    mapScore[r.winner]++;
  }
  return { format, maps: results, mapScore, winner: mapScore[0] > mapScore[1] ? 0 : 1 };
}
