/**
 * Career state and the actions that change it. Every action takes the current
 * career, works on a deep copy, and returns the new career, so the UI can keep
 * state immutable and saves are plain JSON.
 */
import { Rng, clamp } from './rng';
import { addToCollection, CASES, rollPlayer } from './cases';
import type { CaseId, CaseOutcome } from './cases';
import { generateCoaches } from './data/coaches';
import type { MapResult, SeriesResult } from './match';
import { matchRating, simulateSeries } from './match';
import { defaultPairFamiliarity, pairKey } from './sim/synergy';
import { bigGameShift, formVolatility, personalityOf } from './profile';
import {
  MAX_SQUAD, MIN_SQUAD, SALE_SHARE, baseWage, coachWage, defaultContract, demandFor, judgeOffer, marketValue, severance, sponsorGoalMet, sponsorOffers,
} from './economy';
import { FACILITIES, FACILITY_MAX, NO_FACILITIES, facilityUpkeep } from './economy';
import type { FacilityId, Facilities } from './economy';
import type { Contract, LedgerEntry, LedgerKind, OfferResult, OfferTerms, Sponsor } from './economy';
import { buildProfiles, cardOvr, effectiveOvr } from './ratings';
import {
  DIVISIONS, HUMAN_ID, LEAGUE_WEEKS, SEASON_WEEKS, CUP_START, CUP_NAME, PLAYOFF_END, CUP_PRIZE, allAiTeams, advanceCup, cupResult, generateAiTeams, scheduleCupQuarterfinals, finalPlacements, newSeason, schedulePlayoffs, seriesToFixtureResult,
} from './season';
import type { AiTeam, Fixture, SeasonState } from './season';
import { aiToMatchPlayer, cardToMatchPlayer, emptyMapPractice, roleFit, validateLineup } from './team';
import type { LineupSlot, TeamSnapshot } from './team';
import { defaultPlan, planCost, runTraining, validatePlan } from './training';
import type { TrainingOutcome, TrainingPlan } from './training';
import { autoVeto } from './veto';
import type { CardStats, Coach, Dataset, MapName, OwnedCard, PlayerProfile, Role, Tactics } from './types';
import { ATTRIBUTES, MAPS, ROLES } from './types';

export const SAVE_VERSION = 1;

// ---------- World (derived from the dataset, not saved) ----------

export interface World {
  dataset: Dataset;
  profiles: Map<string, PlayerProfile>;
  profileList: PlayerProfile[];
  coaches: Coach[];
  coachById: Map<string, Coach>;
}

export function createWorld(dataset: Dataset): World {
  const profiles = buildProfiles(dataset);
  const coaches = generateCoaches();
  return {
    dataset,
    profiles,
    profileList: [...profiles.values()].sort((a, b) => a.record.rank - b.record.rank),
    coaches,
    coachById: new Map(coaches.map((c) => [c.id, c])),
  };
}

// ---------- Career ----------

export interface SeasonSummary {
  season: number;
  division: number;
  placement: number;
  wins: number;
  losses: number;
  movement: 'promoted' | 'relegated' | 'stayed';
  prize: number;
}

export interface TrainingReport {
  week: number;
  season: number;
  plan: TrainingPlan;
  outcome: TrainingOutcome;
}

export interface MatchRecord {
  id: string;
  season: number;
  week: number;
  stage: Fixture['stage'];
  opponent: string;
  /** Stored so old results still read well after that team leaves your division. */
  opponentName?: string;
  opponentTag?: string;
  won: boolean;
  mapScore: [number, number];
  maps: { map: MapName; score: [number, number] }[];
  mvpCardId?: string;
}

export interface Career {
  version: number;
  seed: number;
  createdAt: string;
  managerName: string;
  teamName: string;
  teamTag: string;
  /** The club badge the player designed; absent means the generated one. Indices into the crest parts. */
  crest?: { shield: number; split: number; emblem: number; hue: number };
  datasetId: string;
  coins: number;
  cards: OwnedCard[];
  lineup: LineupSlot[];
  lastLineup: string[];
  coachId: string | null;
  chemistry: number;
  mapPractice: Record<MapName, number>;
  tactics: Tactics;
  plan: TrainingPlan;
  season: SeasonState;
  phase: 'training' | 'matchday';
  prepBonus: number;
  lastTraining?: TrainingReport;
  /** A new player from a case that arrived with a full squad: keep them by selling a benched player, or sell the pull. */
  pendingPull?: { playerId: string; caseName: string };
  lastDailyClaim: string | null;
  history: SeasonSummary[];
  matches: MatchRecord[];
  totals: { matches: number; wins: number; losses: number; casesOpened: number; titles: number; legendsPulled: number };
  achievements: string[];
  news: string[];
  rngState: number;
  nextCardSeq: number;
  /** Club standing 0..100: grows with wins and titles, drives sponsor offers and transfer interest. */
  reputation: number;
  sponsor: Sponsor | null;
  ledger: LedgerEntry[];
  /** Offers made this week, by player id, to limit retries. */
  negotiations: Record<string, { season: number; week: number; tries: number }>;
  shortlist: string[];
  /** Offers from AI clubs for your players. */
  bids: Bid[];
  facilities: Facilities;
  difficulty: Difficulty;
  /**
   * How well each pair of your players knows each other (0..100), keyed by
   * pairKey(cardId, cardId). Grows with maps played together, scrims and
   * bootcamps. Missing pairs (new signings, older saves) start from chemistry.
   */
  pairs?: Record<string, number>;
  /** Set for a tournament club (engine/tclub.ts): which tournament and seat, and what has been applied. */
  tournament?: { id: string; seat: number; applied: string[]; lastTrainDate?: string; restedDay?: number; mapPrefs?: MapName[] };
}

export interface Bid { id: string; cardId: string; playerId: string; teamId: string; fee: number; season: number; expiresWeek: number }

export const ACHIEVEMENTS: Record<string, { name: string; description: string }> = {
  'first-win': { name: 'First blood', description: 'Win your first match.' },
  'first-legend': { name: 'Golden ticket', description: 'Pull a Legend card.' },
  'ten-cases': { name: 'Collector', description: 'Open 10 cases.' },
  champion: { name: 'Champions', description: 'Win a season final.' },
  promoted: { name: 'Moving up', description: 'Earn promotion.' },
  'elite-series': { name: 'The big stage', description: 'Reach the ESL Pro League.' },
  'cup-winner': { name: 'Cup run', description: 'Win the Clutch Cup.' },
  'clean-sheet': { name: 'Flawless', description: 'Win a map conceding 3 rounds or fewer.' },
  'five-stars': { name: 'Maxed out', description: 'Get any card to 5 stars.' },
};

function rngFor(c: Career): Rng {
  return new Rng(c.rngState);
}

function saveRng(c: Career, rng: Rng): void {
  c.rngState = rng.getState();
}

/** Every change to the club's money goes through here, so the ledger always matches the balance. */
export function money(c: Career, amount: number, kind: LedgerKind, label: string): void {
  if (!amount) return;
  c.coins = Math.round(c.coins + amount);
  c.ledger = [{ season: c.season.number, week: c.season.week, kind, amount: Math.round(amount), label }, ...c.ledger];
  if (c.ledger.length > LEDGER_LIMIT) c.ledger = compactLedger(c.ledger, c.season.number);
}

const LEDGER_LIMIT = 250;

/**
 * Keeps the ledger small without losing money: entries from seasons before the
 * last two are merged into one total per season and kind, so the sum still
 * equals the change in balance.
 */
export function compactLedger(ledger: LedgerEntry[], currentSeason: number): LedgerEntry[] {
  const keep = ledger.filter((e) => e.season >= currentSeason - 1 || e.week === 0);
  const old = ledger.filter((e) => e.season < currentSeason - 1 && e.week !== 0);
  const totals = new Map<string, LedgerEntry>();
  for (const e of old) {
    const key = `${e.season}:${e.kind}`;
    const t = totals.get(key) ?? { season: e.season, week: 0, kind: e.kind, amount: 0, label: `Season ${e.season} total` };
    t.amount += e.amount;
    totals.set(key, t);
  }
  return [...keep, ...[...totals.values()].filter((t) => t.amount !== 0).sort((a, b) => b.season - a.season)];
}

/** Who you face this season, strongest roster first. */
function fieldNews(season: Career['season']): string {
  return `Season ${season.number} field in the ${DIVISIONS[season.division]!.name}: ${season.aiTeams.map((t) => t.name).join(', ')}.`;
}

export function addNews(c: Career, line: string): void {
  c.news = [line, ...c.news].slice(0, 40);
}

function unlock(c: Career, id: string): void {
  if (!c.achievements.includes(id)) {
    c.achievements.push(id);
    addNews(c, `Achievement unlocked: ${ACHIEVEMENTS[id]?.name ?? id}`);
  }
}

function newCardId(c: Career): () => string {
  return () => `card-${c.nextCardSeq++}`;
}

export function profileOf(world: World, card: OwnedCard): PlayerProfile {
  const p = world.profiles.get(card.playerId);
  if (!p) throw new Error(`Unknown player ${card.playerId}`);
  return p;
}

export function cardById(c: Career, cardId: string): OwnedCard | undefined {
  return c.cards.find((x) => x.cardId === cardId);
}

/** Three cheap coaches offered for free at the start of a career. */
export function starterCoaches(world: World): Coach[] {
  return [...world.coaches].sort((a, b) => a.hireCost - b.hireCost).slice(0, 3);
}

export interface NewCareerOptions {
  managerName: string;
  teamName: string;
  teamTag: string;
  coachId: string;
  seed?: number;
  today?: string;
  difficulty?: Difficulty;
}

export type Difficulty = 'relaxed' | 'normal' | 'hard';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { relaxed: 'Relaxed', normal: 'Normal', hard: 'Hard' };
export const DIFFICULTY_TIP: Record<Difficulty, string> = {
  relaxed: 'Opponents play a little below their level. Good for learning.',
  normal: 'The intended balance.',
  hard: 'Opponents play above their level and clubs trade more actively.',
};
/** Added to every AI team's sharpness. */
export const DIFFICULTY_SHARPNESS: Record<Difficulty, number> = { relaxed: -6, normal: 0, hard: 6 };

export function createCareer(world: World, opts: NewCareerOptions): Career {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = new Rng(seed);
  const career: Career = {
    version: SAVE_VERSION,
    seed,
    createdAt: opts.today ?? new Date().toISOString().slice(0, 10),
    managerName: opts.managerName.trim() || 'Manager',
    teamName: opts.teamName.trim() || 'My Team',
    teamTag: (opts.teamTag.trim() || 'YOU').toUpperCase().slice(0, 4),
    datasetId: world.dataset.id,
    coins: 1500,
    cards: [],
    lineup: [],
    lastLineup: [],
    coachId: opts.coachId,
    chemistry: 40,
    mapPractice: emptyMapPractice(35),
    tactics: { playstyle: 'balanced', tApproach: 'default', ctSetup: 'standard', stackSite: 'A', economy: 'standard' },
    plan: defaultPlan(),
    season: newSeason(rng, 1, 0, world.profileList, world.coaches),
    phase: 'training',
    prepBonus: 0,
    lastDailyClaim: null,
    history: [],
    matches: [],
    totals: { matches: 0, wins: 0, losses: 0, casesOpened: 0, titles: 0, legendsPulled: 0 },
    achievements: [],
    news: [],
    rngState: 0,
    nextCardSeq: 1,
    reputation: 10,
    sponsor: null,
    ledger: [],
    negotiations: {},
    shortlist: [],
    bids: [],
    facilities: { ...NO_FACILITIES },
    difficulty: opts.difficulty ?? 'normal',
  };
  career.season.sponsorRep = career.reputation;
  // Starter squad: one bronze/silver player per role, plus one extra.
  const aiPlayers = new Set(career.season.aiTeams.flatMap((t) => t.playerIds));
  const lowPool = world.profileList.filter((p) => (p.rarity === 'bronze' || p.rarity === 'silver') && !aiPlayers.has(p.record.id));
  const makeId = newCardId(career);
  for (const role of ROLES) {
    const options = lowPool.filter((p) => p.record.primaryRole === role && !career.cards.some((c) => c.playerId === p.record.id));
    const pick = rng.pick(options.length ? options : lowPool);
    addToCollection(career.cards, pick, 0, makeId).newCard!.sharpness = 75;
  }
  const extra = lowPool.filter((p) => !career.cards.some((c) => c.playerId === p.record.id));
  addToCollection(career.cards, rng.pick(extra), 0, makeId);
  for (const card of career.cards) card.contract = defaultContract(profileOf(world, card));
  saveRng(career, rng);
  career.lineup = autoLineup(world, career);
  career.lastLineup = career.lineup.map((s) => s.cardId);
  career.plan = defaultPlan(MAPS[0]);
  addNews(career, `${career.teamName} enter the ${DIVISIONS[0]!.name}. Season 1 starts now.`);
  addNews(career, fieldNews(career.season));
  return career;
}

/** Greedy best lineup: fill each role with the best available card for it. */
export function autoLineup(world: World, c: Career): LineupSlot[] {
  const used = new Set<string>();
  const usedPlayers = new Set<string>();
  const slots: LineupSlot[] = [];
  for (const role of ['awp', 'igl', 'entry', 'support', 'lurker'] as Role[]) {
    let best: { card: OwnedCard; score: number } | null = null;
    for (const card of c.cards) {
      if (used.has(card.cardId) || usedPlayers.has(card.playerId)) continue;
      const p = profileOf(world, card);
      const score = effectiveOvr(p, card) * roleFit(p, role);
      if (!best || score > best.score) best = { card, score };
    }
    if (best) {
      used.add(best.card.cardId);
      usedPlayers.add(best.card.playerId);
      slots.push({ cardId: best.card.cardId, role });
    }
  }
  return slots;
}

export function lineupValidation(c: Career) {
  return validateLineup(c.lineup, c.cards, (id) => cardById(c, id)?.playerId, c.coachId);
}

// ---------- Simple actions ----------

export function setLineup(c: Career, lineup: LineupSlot[]): Career {
  const n = structuredClone(c);
  n.lineup = lineup.map((s) => ({ ...s }));
  return n;
}

export function setTactics(c: Career, tactics: Tactics): Career {
  const n = structuredClone(c);
  n.tactics = { ...tactics };
  return n;
}

export function setPlan(c: Career, plan: TrainingPlan): Career {
  const n = structuredClone(c);
  n.plan = structuredClone(plan);
  return n;
}

export function hireCoach(world: World, c: Career, coachId: string): Career {
  const coach = world.coachById.get(coachId);
  if (!coach) throw new Error('Unknown coach');
  if (c.coachId === coachId) return c;
  if (c.coins < coach.hireCost) throw new Error('Not enough coins');
  const n = structuredClone(c);
  money(n, -coach.hireCost, 'coach', `Hired ${coach.name}`);
  n.coachId = coachId;
  n.chemistry = clamp(n.chemistry - 5, 0, 100); // new voice in the room
  addNews(n, `${coach.name} is the new head coach.`);
  return n;
}

export function canClaimDaily(c: Career, today: string): boolean {
  return c.lastDailyClaim !== today;
}

export function openCase(world: World, c: Career, caseId: CaseId, opts: { role?: Role; today?: string } = {}): { career: Career; outcome: CaseOutcome } {
  const def = CASES[caseId];
  const n = structuredClone(c);
  if (caseId === 'daily') {
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    if (!canClaimDaily(n, today)) throw new Error('Daily case already claimed today');
    n.lastDailyClaim = today;
  } else {
    if (n.coins < def.price) throw new Error('Not enough coins');
    money(n, -def.price, 'case', def.name);
  }
  if (c.pendingPull) throw new Error('Decide on your last case pull first.');
  if (def.needsRole && !opts.role) throw new Error('Pick a role for this case');
  const rng = rngFor(n);
  const profile = rollPlayer(rng, def, world.profileList, opts.role);
  saveRng(n, rng);
  if (!n.cards.some((x) => x.playerId === profile.record.id) && n.cards.length >= MAX_SQUAD) {
    // Full squad: the pull waits for the manager's choice (resolvePull) instead of being lost.
    n.pendingPull = { playerId: profile.record.id, caseName: def.name };
    n.totals.casesOpened++;
    if (profile.rarity === 'legend') { n.totals.legendsPulled++; unlock(n, 'first-legend'); }
    if (n.totals.casesOpened >= 10) unlock(n, 'ten-cases');
    addNews(n, `New ${profile.rarity} pull with a full squad: ${profile.record.handle} (${profile.ovr}).`);
    return { career: n, outcome: { profile, duplicate: false, starsNow: 0, refund: 0, pendingFull: true } };
  }
  const outcome = addToCollection(n.cards, profile, n.season.week, newCardId(n));
  if (outcome.newCard) {
    outcome.newCard.contract = defaultContract(profile);
    claimPlayer(world, n, profile.record.id);
  }
  money(n, outcome.refund, 'refund', `Maxed duplicate: ${profile.record.handle}`);
  n.totals.casesOpened++;
  if (profile.rarity === 'legend') {
    n.totals.legendsPulled++;
    unlock(n, 'first-legend');
  }
  if (n.totals.casesOpened >= 10) unlock(n, 'ten-cases');
  if (outcome.starsNow >= 5) unlock(n, 'five-stars');
  addNews(n, outcome.duplicate
    ? `Duplicate ${profile.record.handle}: ${outcome.refund ? `+${outcome.refund} coins` : `now ${outcome.starsNow} stars`}.`
    : `New ${profile.rarity} card: ${profile.record.handle} (${profile.ovr}).`);
  return { career: n, outcome };
}

// ---------- Training week ----------

/** Weekly fatigue every active player sheds on top of rest days. */
export const NATURAL_RECOVERY = 18;

/** How the club's facilities change a training week. */
export function clubTrainingEffects(c: Career): { gainBoost: number; recovery: number; prepBoost: number } {
  const fac = c.facilities ?? NO_FACILITIES;
  return { gainBoost: 1 + fac.training * 0.08, recovery: NATURAL_RECOVERY + fac.medical * 4, prepBoost: 1 + fac.analysis * 0.25 };
}

/** The training preview as it will land: facility boosts applied and fatigue as it stands on matchday. */
export function previewForClub(c: Career, o: TrainingOutcome): TrainingOutcome {
  const fx = clubTrainingEffects(c);
  const gains: TrainingOutcome['gains'] = {};
  for (const [id, g] of Object.entries(o.gains)) gains[id] = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, (v ?? 0) * fx.gainBoost]));
  const fatigueAfter = Object.fromEntries(Object.entries(o.fatigueAfter).map(([id, f]) => [id, clamp(f - fx.recovery, 0, 100)]));
  return { ...o, gains, fatigueAfter, prepBonus: o.prepBonus * fx.prepBoost };
}

export function runTrainingWeek(world: World, c: Career): Career {
  if (c.phase !== 'training') throw new Error('Training already done this week');
  const errors = validatePlan(c.plan);
  if (errors.length) throw new Error(errors[0]);
  const lv = lineupValidation(c);
  if (!lv.ok) throw new Error(lv.errors[0]);
  const n = structuredClone(c);
  const coach = n.coachId ? world.coachById.get(n.coachId) ?? null : null;
  const activeIds = new Set(n.lineup.map((s) => s.cardId));
  const members = n.lineup.map((s) => {
    const card = cardById(n, s.cardId)!;
    return { card, profile: profileOf(world, card) };
  });
  const cost = planCost(n.plan);
  if (cost > 0 && n.coins < cost) throw new Error(`This plan costs ${cost} coins and you have ${n.coins}.`);
  const rng = rngFor(n);
  const outcome = runTraining(n.plan, members, coach, rng);
  money(n, -outcome.cost, 'training', n.plan.sessions.includes('bootcamp') ? 'Bootcamp' : 'Training week');

  // Lineup changes cost chemistry; a stable five builds it.
  const changed = n.lineup.filter((s) => !n.lastLineup.includes(s.cardId)).length;
  n.chemistry = clamp(n.chemistry - changed * 12 + (changed === 0 ? 2 : 0) + outcome.chemistryDelta, 0, 100);
  n.lastLineup = n.lineup.map((s) => s.cardId);
  // Practising together builds pair familiarity: scrims a little, a bootcamp a lot.
  const pairGain = n.plan.sessions.reduce((sum, id) => sum + (id === 'bootcamp' ? 7 : id === 'scrims' ? 1.6 : id === 'review' ? 0.6 : 0), 0) * (0.8 + (coach?.attrs.communication ?? 40) / 250);
  if (pairGain > 0) growPairs(n, pairGain);

  for (const m of MAPS) n.mapPractice[m] = clamp(n.mapPractice[m] - 1 + (outcome.mapPracticeDelta[m] ?? 0), 15, 100);
  const fx = clubTrainingEffects(n);
  n.prepBonus = Number((outcome.prepBonus * fx.prepBoost).toFixed(3));

  const restSessions = n.plan.sessions.filter((s) => s === 'rest').length;
  const workSessions = n.plan.sessions.reduce((s, id) => s + (id === 'rest' ? 0 : id === 'bootcamp' ? 3 : 1), 0);
  for (const card of n.cards) {
    if (activeIds.has(card.cardId)) {
      const g = outcome.gains[card.cardId] ?? {};
      const boost = fx.gainBoost;
      for (const [k, v] of Object.entries(g)) {
        const key = k as keyof typeof card.growth;
        card.growth[key] = Number(((card.growth[key] ?? 0) + (v ?? 0) * boost).toFixed(2));
      }
      card.fatigue = clamp(outcome.fatigueAfter[card.cardId]! - fx.recovery, 0, 100); // weekly natural recovery: the default plan plus a Bo1 nets about +10 a week
      card.sharpness = clamp(card.sharpness + workSessions * 4 - restSessions, 0, 100);
      card.morale = clamp(card.morale + outcome.moraleDelta, 0, 100);
    } else {
      // Idle cards lose sharpness: a strong card you never use slowly falls behind (C22).
      card.sharpness = clamp(card.sharpness - 7, 0, 100);
      card.fatigue = clamp(card.fatigue - 20 - (n.facilities ?? NO_FACILITIES).medical * 4, 0, 100);
    }
    card.form = Math.round(clamp(card.form * 0.6 + rng.normal(0, 2 * formVolatility(personalityOf(card.playerId))) + (card.morale - 60) / 20, -10, 10)) + 0; // + 0 normalizes -0 for clean saves
  }
  for (const s of n.lineup) {
    const card = cardById(n, s.cardId)!;
    card.ovrHistory = [...(card.ovrHistory ?? []), cardOvr(profileOf(world, card), card)].slice(-30);
  }
  saveRng(n, rng);
  n.lastTraining = { week: n.season.week, season: n.season.number, plan: structuredClone(n.plan), outcome };
  n.phase = 'matchday';
  return n;
}

/**
 * A free week that always works: demo review, then two rest days. Used when the
 * saved plan is unaffordable or the starters are worn out. The saved plan is kept.
 */
export function runRecoveryWeek(world: World, c: Career): Career {
  const n = runTrainingWeek(world, { ...c, plan: { ...c.plan, sessions: ['review', 'rest', 'rest'] } });
  n.plan = structuredClone(c.plan);
  return n;
}

export function starterFatigue(c: Career): number {
  const cards = c.lineup.map((s) => cardById(c, s.cardId)).filter((x): x is OwnedCard => !!x);
  return cards.length ? Math.round(cards.reduce((s, x) => s + x.fatigue, 0) / cards.length) : 0;
}

export function upgradeFacility(c: Career, id: FacilityId): Career {
  const level = (c.facilities ?? NO_FACILITIES)[id];
  if (level >= FACILITY_MAX) throw new Error('Already at the top level.');
  const cost = FACILITIES[id].cost[level]!;
  if (c.coins < cost) throw new Error(`This upgrade costs ${cost} coins and you have ${c.coins}.`);
  const n = structuredClone(c);
  n.facilities = { ...(n.facilities ?? NO_FACILITIES), [id]: level + 1 };
  money(n, -cost, 'facilities', `${FACILITIES[id].name} level ${level + 1}`);
  addNews(n, `${FACILITIES[id].name} upgraded to level ${level + 1}: ${FACILITIES[id].effect(level + 1)}.`);
  return n;
}

// ---------- Matchday ----------

export function humanFixture(c: Career): Fixture | null {
  return c.season.fixtures.find((f) => f.week === c.season.week && !f.result && (f.home === HUMAN_ID || f.away === HUMAN_ID)) ?? null;
}

export function aiTeamById(c: Career, id: string): AiTeam | undefined {
  return allAiTeams(c.season).find((t) => t.id === id);
}

export function teamName(c: Career, id: string): string {
  return id === HUMAN_ID ? c.teamName : aiTeamById(c, id)?.name ?? id;
}

export function teamTag(c: Career, id: string): string {
  return id === HUMAN_ID ? c.teamTag : aiTeamById(c, id)?.tag ?? id;
}

export function humanSnapshot(world: World, c: Career): TeamSnapshot {
  const coach = c.coachId ? world.coachById.get(c.coachId) ?? null : null;
  return {
    id: HUMAN_ID,
    name: c.teamName,
    tag: c.teamTag,
    isHuman: true,
    players: c.lineup.map((s) => {
      const card = cardById(c, s.cardId)!;
      return cardToMatchPlayer(profileOf(world, card), card, s.role);
    }),
    coach,
    chemistry: c.chemistry,
    mapPractice: { ...c.mapPractice },
    tactics: { ...c.tactics },
    tendencies: { t: { default: 1, execute: 1, rush: 1 }, ct: { standard: 1, stack: 1, retake: 1, aggro: 1 }, aSiteBias: 0.5 },
    prepBonus: c.prepBonus,
    pairs: { ...(c.pairs ?? {}) },
  };
}

/** Familiarity of two of your players (0..100), falling back to the chemistry-based default. */
export function pairFamiliarity(c: Career, a: string, b: string): number {
  return c.pairs?.[pairKey(a, b)] ?? defaultPairFamiliarity(c.chemistry);
}

/** Adds familiarity to every pair in the current lineup (bounded, with diminishing returns near 100). */
export function growPairs(c: Career, amount: number): void {
  const ids = c.lineup.map((s) => s.cardId);
  c.pairs ??= {};
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const k = pairKey(ids[i]!, ids[j]!);
    const cur = c.pairs[k] ?? defaultPairFamiliarity(c.chemistry);
    c.pairs[k] = Math.round(clamp(cur + amount * (1 - cur / 110), 0, 100) * 10) / 10;
  }
}

export function aiSnapshot(world: World, c: Career, team: AiTeam): TeamSnapshot {
  const div = DIVISIONS[c.season.division]!;
  const coach = world.coachById.get(team.coachId) ?? null;
  const startT = (Object.entries(team.tendencies.t) as [Tactics['tApproach'], number][]).sort((a, b) => b[1] - a[1])[0]![0];
  const startCT = (Object.entries(team.tendencies.ct) as [Tactics['ctSetup'], number][]).sort((a, b) => b[1] - a[1])[0]![0];
  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    isHuman: false,
    players: team.playerIds.map((pid, i) => aiToMatchPlayer(world.profiles.get(pid)!, team.roles[i]!, (team.sharpness ?? div.aiSharpness) + DIFFICULTY_SHARPNESS[c.difficulty ?? 'normal'])),
    coach,
    chemistry: team.chemistry,
    mapPractice: { ...team.mapPractice },
    tactics: { playstyle: 'balanced', tApproach: startT, ctSetup: startCT, stackSite: team.tendencies.aSiteBias >= 0.5 ? 'B' : 'A' },
    tendencies: team.tendencies,
    prepBonus: 0,
  };
}

/** The two snapshots for the human's fixture, ordered [home, away]. */
export function fixtureSnapshots(world: World, c: Career, f: Fixture): [TeamSnapshot, TeamSnapshot] {
  const snap = (id: string) => (id === HUMAN_ID ? humanSnapshot(world, c) : aiSnapshot(world, c, aiTeamById(c, id)!));
  const pair: [TeamSnapshot, TeamSnapshot] = [snap(f.home), snap(f.away)];
  if (f.stage === 'league') return pair;
  // Playoffs: big-game mentality lifts or weighs on every attribute.
  for (const team of pair) {
    team.players = team.players.map((p) => {
      const shift = bigGameShift(personalityOf(p.playerId));
      const attrs = { ...p.attrs };
      for (const a of ATTRIBUTES) attrs[a] = clamp(attrs[a] + shift, 1, 105);
      return { ...p, attrs };
    });
  }
  return pair;
}

function fixtureSeed(c: Career, f: Fixture): number {
  let h = c.seed;
  for (const ch of f.id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function seedForFixture(c: Career, f: Fixture): number {
  return fixtureSeed(c, f);
}

/**
 * Finishes the week: stores the human's result (if they played), simulates every
 * other fixture, pays rewards, updates cards and advances the season.
 */
export function completeMatchday(world: World, c: Career, humanResult: SeriesResult | null): Career {
  if (c.phase !== 'matchday') throw new Error('Train first');
  const n = structuredClone(c);
  const season = n.season;
  const div = DIVISIONS[season.division]!;
  const mine = humanFixture(n);
  if (mine && !humanResult) throw new Error('Play your match first');

  if (mine && humanResult) {
    mine.result = seriesToFixtureResult(mine, humanResult);
    const humanIdx = mine.home === HUMAN_ID ? 0 : 1;
    const won = humanResult.winner === humanIdx;
    const opponent = mine.home === HUMAN_ID ? mine.away : mine.home;
    const mapsForHuman = humanResult.maps.map((m) => ({ map: m.map, score: (humanIdx === 0 ? m.score : [m.score[1], m.score[0]]) as [number, number] }));
    const reward = won ? div.winReward : Math.round(div.winReward * 0.4);
    money(n, reward, 'match', `${won ? 'Win' : 'Loss'} vs ${teamTag(n, opponent)}`);
    if (won && n.sponsor?.winBonus) money(n, n.sponsor.winBonus, 'sponsor', `${n.sponsor.name} win bonus`);
    n.reputation = clamp(n.reputation + (won ? 1.5 : -0.5) * (1 + season.division * 0.25), 0, 100);
    n.totals.matches++;
    if (won) n.totals.wins++; else n.totals.losses++;
    const mvp = bestPlayer(humanResult.maps, humanIdx);
    n.matches = [{ id: mine.id, season: season.number, week: season.week, stage: mine.stage, opponent, opponentName: teamName(n, opponent), opponentTag: teamTag(n, opponent), won, mapScore: (humanIdx === 0 ? humanResult.mapScore : [humanResult.mapScore[1], humanResult.mapScore[0]]) as [number, number], maps: mapsForHuman, mvpCardId: mvp }, ...n.matches].slice(0, 60);
    if (won) unlock(n, 'first-win');
    if (mapsForHuman.some((m) => m.score[0] >= 13 && m.score[1] <= 3)) unlock(n, 'clean-sheet');
    addNews(n, `${won ? 'Win' : 'Loss'} vs ${teamName(n, opponent)} (${mapsForHuman.map((m) => `${m.score[0]}-${m.score[1]} ${m.map}`).join(', ')}). +${reward} coins.`);
    const oppTag = teamTag(n, opponent);
    for (const s of n.lineup) {
      const card = cardById(n, s.cardId)!;
      const pers = personalityOf(card.playerId);
      card.matchesPlayed++;
      card.sharpness = clamp(card.sharpness + 6, 0, 100);
      card.fatigue = clamp(card.fatigue + 8 * humanResult.maps.length, 0, 100);
      card.morale = clamp(card.morale + (won ? 3 + pers.ambition / 7 : -2 - pers.ambition / 7), 0, 100);
      recordCardMatch(card, humanResult, humanIdx, { season: season.number, week: season.week, opponent: oppTag, mvp: mvp === card.cardId });
    }
    n.chemistry = clamp(n.chemistry + 1, 0, 100);
    growPairs(n, 1.2 * humanResult.maps.length);
  }

  // Simulate the rest of the week.
  for (const f of season.fixtures) {
    if (f.week !== season.week || f.result) continue;
    const teams = fixtureSnapshots(world, n, f);
    const maps = autoVeto(f.format, teams, 0);
    const res = simulateSeries(fixtureSeed(n, f), teams, maps, f.format);
    f.result = seriesToFixtureResult(f, res);
  }

  n.prepBonus = 0;
  weeklyBusiness(world, n);
  season.week++;
  if (season.week === LEAGUE_WEEKS + 1 || season.week === LEAGUE_WEEKS + 2) schedulePlayoffs(season);
  if (season.week === CUP_START) startCup(world, n);
  if (season.week > CUP_START) advanceCup(season);
  if (season.week > SEASON_WEEKS) finishSeason(world, n);
  n.phase = 'training';
  return n;
}

function emptyCardStats(): CardStats {
  return { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, damage: 0, headshots: 0, openingKills: 0, openingDeaths: 0, clutchesWon: 0, multiKillRounds: 0, kastRounds: 0, utilityDamage: 0, enemiesFlashed: 0, ratingSum: 0, mvps: 0 };
}

/** Adds one series to a card's career totals and match log. */
export function recordCardMatch(card: OwnedCard, series: SeriesResult, humanIdx: 0 | 1, meta: { season: number; week: number; opponent: string; mvp: boolean }): void {
  const st = card.stats ?? emptyCardStats();
  const log = card.log ?? [];
  for (const m of series.maps) {
    const l = m.lines.find((x) => x.id === card.cardId);
    if (!l) continue;
    const rounds = m.rounds.length;
    const rating = matchRating(l, rounds);
    st.maps++; st.rounds += rounds; st.kills += l.kills; st.deaths += l.deaths; st.assists += l.assists; st.damage += l.damage;
    st.headshots += l.headshots ?? 0; st.openingKills += l.openingKills; st.openingDeaths += l.openingDeaths; st.clutchesWon += l.clutchesWon;
    st.multiKillRounds += l.multiKillRounds; st.kastRounds += l.kastRounds; st.utilityDamage += l.utilityDamage ?? 0; st.enemiesFlashed += l.enemiesFlashed ?? 0;
    st.ratingSum = Number((st.ratingSum + rating).toFixed(2));
    const score: [number, number] = humanIdx === 0 ? [m.score[0], m.score[1]] : [m.score[1], m.score[0]];
    log.unshift({ season: meta.season, week: meta.week, opponent: meta.opponent, map: m.map, won: m.winner === humanIdx, score, kills: l.kills, deaths: l.deaths, adr: Math.round(l.damage / Math.max(1, rounds)), rating });
  }
  if (meta.mvp) st.mvps++;
  card.stats = st;
  card.log = log.slice(0, 20);
}

export function bestPlayer(maps: MapResult[], team: 0 | 1): string | undefined {
  const totals = new Map<string, { k: number; d: number }>();
  for (const m of maps) for (const l of m.lines) {
    if (l.team !== team) continue;
    const t = totals.get(l.id) ?? { k: 0, d: 0 };
    t.k += l.kills; t.d += l.deaths;
    totals.set(l.id, t);
  }
  return [...totals.entries()].sort((a, b) => (b[1].k - b[1].d) - (a[1].k - a[1].d))[0]?.[0];
}

/** Week 10: the league is settled, so the cup draws its guests from the division above. */
function startCup(world: World, n: Career): void {
  const season = n.season;
  if (season.cupTeams) return;
  const above = DIVISIONS[Math.min(season.division + 1, DIVISIONS.length - 1)]!;
  const taken = new Set([...season.aiTeams.flatMap((t) => t.playerIds), ...n.cards.map((x) => x.playerId)]);
  const rng = rngFor(n);
  const guests = generateAiTeams(rng, above, world.profileList.filter((p) => !taken.has(p.record.id)), world.coaches, 4, season.aiTeams.map((t) => t.tag));
  saveRng(n, rng);
  // Guests from the top division are a little sharper than its league teams, so the Elite cup is still a step up.
  for (const g of guests) { g.sharpness = above.aiSharpness + (season.division === DIVISIONS.length - 1 ? 3 : 0); g.guestFrom = above.name; }
  const strength = (t: AiTeam) => t.playerIds.reduce((sum, id) => sum + (world.profiles.get(id)?.ovr ?? 0), 0);
  scheduleCupQuarterfinals(season, guests, strength);
  n.season.placement = finalPlacements(season).indexOf(HUMAN_ID) + 1;
  const f = humanFixture(n);
  const opp = f ? (f.home === HUMAN_ID ? f.away : f.home) : null;
  addNews(n, `${CUP_NAME} draw: four guests from the ${above.name} join the league's best.${opp ? ` You face ${teamName(n, opp)} in the quarterfinal.` : ''}`);
}

function finishSeason(world: World, n: Career): void {
  const season = n.season;
  const order = finalPlacements(season);
  const placement = order.indexOf(HUMAN_ID) + 1;
  const div = DIVISIONS[season.division]!;
  const prize = div.prizes[placement - 1] ?? 0;
  money(n, prize, 'prize', `Season ${season.number}: ${ordinal(placement)} place`);
  if (n.sponsor) {
    if (sponsorGoalMet(n.sponsor.goal, placement)) {
      money(n, n.sponsor.goalBonus, 'sponsor', `${n.sponsor.name} season bonus`);
      addNews(n, `${n.sponsor.name} pay the ${n.sponsor.goalBonus}-coin season bonus.`);
    } else addNews(n, `${n.sponsor.name}'s season goal was missed. No bonus.`);
  }
  let movement: SeasonSummary['movement'] = 'stayed';
  let nextDiv = season.division;
  if (placement <= 2 && season.division < DIVISIONS.length - 1) { movement = 'promoted'; nextDiv++; unlock(n, 'promoted'); }
  else if (placement >= 7 && season.division > 0) { movement = 'relegated'; nextDiv--; }
  if (placement === 1) { n.totals.titles++; unlock(n, 'champion'); }
  const cup = cupResult(season, HUMAN_ID);
  if (cup) {
    const cupPrize = Math.round(div.winReward * CUP_PRIZE[cup - 1]!);
    money(n, cupPrize, 'prize', `${CUP_NAME}: ${cup === 1 ? 'winner' : cup === 2 ? 'finalist' : cup === 3 ? 'semifinal' : 'quarterfinal'}`);
    if (cup === 1) { n.totals.titles++; unlock(n, 'cup-winner'); n.reputation = clamp(n.reputation + 5, 0, 100); }
    addNews(n, `${CUP_NAME}: ${cup === 1 ? 'you won it!' : cup === 2 ? 'beaten in the final.' : cup === 3 ? 'out in the semifinals.' : 'out in the quarterfinals.'} Prize ${cupPrize} coins.`);
  }
  n.reputation = clamp(n.reputation + (placement === 1 ? 8 : 0) + (movement === 'promoted' ? 6 : 0) - (movement === 'relegated' ? 6 : 0) + (4.5 - placement), 0, 100);
  if (nextDiv === 3) unlock(n, 'elite-series');
  const record = season.fixtures.filter((f) => f.result && (f.home === HUMAN_ID || f.away === HUMAN_ID));
  const wins = record.filter((f) => f.result!.winner === HUMAN_ID).length;
  n.history.push({ season: season.number, division: season.division, placement, wins, losses: record.length - wins, movement, prize });
  addNews(n, `Season ${season.number} over: ${ordinal(placement)} in the ${div.name}. Prize ${prize} coins.${movement === 'promoted' ? ' Promoted!' : movement === 'relegated' ? ' Relegated.' : ''}`);
  const rng = rngFor(n);
  const owned = new Set(n.cards.map((x) => x.playerId));
  n.season = newSeason(rng, season.number + 1, nextDiv, world.profileList.filter((p) => !owned.has(p.record.id)), world.coaches);
  n.season.sponsorRep = n.reputation;
  addNews(n, fieldNews(n.season));
  n.sponsor = null;
  n.negotiations = {};
  saveRng(n, rng);
  n.season.placement = undefined;
  // Off-season: everyone recovers.
  for (const card of n.cards) { card.fatigue = 0; card.morale = clamp(card.morale + 5, 0, 100); }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export function collectionValue(world: World, c: Career): number {
  return c.cards.reduce((s, card) => s + cardOvr(profileOf(world, card), card), 0);
}

// ---------- Club business: wages, contracts, sponsors, transfers ----------

/** Gives a contract to any card that has none (saves from before contracts existed). */
export function ensureContracts(world: World, c: Career): Career {
  if (c.cards.every((x) => x.contract)) return c;
  const n = structuredClone(c);
  for (const card of n.cards) if (!card.contract && world.profiles.has(card.playerId)) card.contract = defaultContract(profileOf(world, card));
  return n;
}

export function weeklyWages(world: World, c: Career): { players: number; coach: number } {
  const players = c.cards.reduce((sum, card) => sum + (card.contract?.wage ?? 0), 0);
  const coach = c.coachId ? coachWage(world.coachById.get(c.coachId)!) : 0;
  return { players, coach };
}

/** End of every week: pay wages, collect sponsorship, run down contracts, keep at least five players. */
function weeklyBusiness(world: World, n: Career): void {
  const w = weeklyWages(world, n);
  money(n, -w.players, 'wages', 'Player wages');
  money(n, -w.coach, 'wages', 'Coach wage');
  if (n.sponsor) money(n, n.sponsor.weekly, 'sponsor', `${n.sponsor.name} weekly`);
  money(n, -facilityUpkeep(n.facilities ?? NO_FACILITIES), 'facilities', 'Facility upkeep');
  const leaving: OwnedCard[] = [];
  for (const card of n.cards) {
    if (!card.contract) continue;
    card.contract.weeksLeft--;
    const handle = world.profiles.get(card.playerId)?.record.handle ?? card.playerId;
    if (card.contract.weeksLeft === 3) addNews(n, `${handle}'s contract runs out in 3 weeks. Renew it from the player profile.`);
    if (card.contract.weeksLeft <= 0) leaving.push(card);
  }
  for (const card of leaving) {
    if (n.cards.length <= MIN_SQUAD) {
      // Never leave the club without five players: the last ones stay on a short rolling deal.
      card.contract = { wage: card.contract!.wage, weeksLeft: 9 };
      addNews(n, `${profileOf(world, card).record.handle} stays on a rolling 9-week deal because the squad would drop below five.`);
      continue;
    }
    removeCard(world, n, card.cardId);
    addNews(n, `${profileOf(world, card).record.handle}'s contract expired and they left the club.`);
  }
  aiMarket(world, n);
  if (n.coins < 0) addNews(n, `The club is ${-n.coins} coins in debt. Cases, transfers and paid training are blocked until you are back above zero.`);
}

/** The window is open during the league and playoffs. */
export function transferWindowOpen(c: Career): boolean {
  return c.season.week <= PLAYOFF_END;
}

/**
 * The AI side of the market, once a week while the window is open:
 * - league clubs sometimes upgrade their weakest player with a free agent;
 * - a club sometimes bids for one of your players (better than a quick sale).
 * Bids last until the end of next week.
 */
function aiMarket(world: World, n: Career): void {
  const season = n.season;
  n.bids = (n.bids ?? []).filter((b) => b.season === season.number && b.expiresWeek >= season.week + 1 && n.cards.some((x) => x.cardId === b.cardId));
  if (!transferWindowOpen(n)) return;
  const rng = rngFor(n);
  const div = DIVISIONS[season.division]!;
  const taken = () => new Set([...allAiTeams(season).flatMap((t) => t.playerIds), ...n.cards.map((x) => x.playerId)]);
  let moves = 0;
  for (const team of rng.shuffle(season.aiTeams)) {
    if (moves >= (n.difficulty === 'hard' ? 3 : 2) || rng.next() > (n.difficulty === 'hard' ? 0.3 : n.difficulty === 'relaxed' ? 0.1 : 0.18)) continue;
    const slots = team.playerIds.map((id, i) => ({ i, p: world.profiles.get(id)! })).sort((a, b) => a.p.ovr - b.p.ovr);
    const weakest = slots[0]!;
    const role = team.roles[weakest.i]!;
    const used = taken();
    const pick = world.profileList
      .filter((p) => !used.has(p.record.id) && p.record.primaryRole === role && p.record.rank >= div.rankRange[0] - 10 && p.ovr >= weakest.p.ovr + 2)
      .sort((a, b) => a.ovr - b.ovr)[0];
    if (!pick) continue;
    team.playerIds[weakest.i] = pick.record.id;
    moves++;
    addNews(n, `${team.tag} sign ${pick.record.handle} (${pick.ovr}) and let ${weakest.p.record.handle} go.`);
  }
  if (!n.bids.length && n.cards.length > MIN_SQUAD && rng.next() < 0.3) {
    const card = rng.pick(n.cards);
    const p = profileOf(world, card);
    const team = rng.pick(season.aiTeams);
    const fee = Math.round((marketValue(p, cardOvr(p, card)) * rng.range(0.65, 0.9)) / 50) * 50;
    if (fee > 0) {
      n.bids.push({ id: `b${season.number}-${season.week}-${card.cardId}`, cardId: card.cardId, playerId: card.playerId, teamId: team.id, fee, season: season.number, expiresWeek: season.week + 1 });
      addNews(n, `${team.name} bid ${fee} coins for ${p.record.handle}. The offer stands until this week ends.`);
    }
  }
  saveRng(n, rng);
}

export function acceptBid(world: World, c: Career, bidId: string): Career {
  const bid = (c.bids ?? []).find((b) => b.id === bidId);
  if (!bid) throw new Error('That bid is no longer on the table.');
  checkCanLeave(c, bid.cardId);
  const n = structuredClone(c);
  const card = cardById(n, bid.cardId)!;
  const p = profileOf(world, card);
  const team = aiTeamById(n, bid.teamId);
  removeCard(world, n, bid.cardId);
  money(n, bid.fee, 'sale', `Sold ${p.record.handle} to ${team?.tag ?? 'a club'}`);
  if (team) {
    // The buyer drops its weakest player in that role.
    const slots = team.playerIds.map((id, i) => ({ i, ovr: world.profiles.get(id)?.ovr ?? 0 })).filter((s) => team.roles[s.i] === p.record.primaryRole);
    const out = (slots.length ? slots : team.playerIds.map((id, i) => ({ i, ovr: world.profiles.get(id)?.ovr ?? 0 }))).sort((a, b) => a.ovr - b.ovr)[0]!;
    team.playerIds[out.i] = p.record.id;
  }
  n.bids = n.bids.filter((b) => b.cardId !== bid.cardId);
  addNews(n, `${p.record.handle} joins ${team?.name ?? 'another club'} for ${bid.fee} coins.`);
  return n;
}

/** Turning a bid down keeps the player, but an ambitious one is disappointed. */
export function declineBid(world: World, c: Career, bidId: string): Career {
  const bid = (c.bids ?? []).find((b) => b.id === bidId);
  if (!bid) return c;
  const n = structuredClone(c);
  n.bids = n.bids.filter((b) => b.id !== bidId);
  const card = cardById(n, bid.cardId);
  if (card) {
    const amb = personalityOf(card.playerId).ambition;
    const hit = amb >= 14 ? Math.round(amb / 3) : 0;
    card.morale = clamp(card.morale - hit, 0, 100);
    addNews(n, `You turned down ${teamTag(n, bid.teamId)}'s bid for ${profileOf(world, card).record.handle}.${hit ? ` They wanted the move (morale -${hit}).` : ''}`);
  }
  return n;
}

function removeCard(world: World, n: Career, cardId: string): void {
  n.cards = n.cards.filter((x) => x.cardId !== cardId);
  n.bids = (n.bids ?? []).filter((b) => b.cardId !== cardId);
  n.shortlist = n.shortlist ?? [];
  if (n.lineup.some((s) => s.cardId === cardId)) {
    n.lineup = n.lineup.filter((s) => s.cardId !== cardId);
    if (n.cards.length >= 5) n.lineup = autoLineup(world, n);
  }
}

/** Where a player is right now: on your team, on an AI team in your division, or a free agent. */
export function playerStatus(c: Career, playerId: string): { owner: 'you' | 'ai' | 'free'; teamId?: string; teamTag?: string } {
  if (c.cards.some((x) => x.playerId === playerId)) return { owner: 'you' };
  const team = allAiTeams(c.season).find((t) => t.playerIds.includes(playerId));
  if (team) return { owner: 'ai', teamId: team.id, teamTag: team.tag };
  return { owner: 'free' };
}

/** When you sign a player an AI team was using, that team signs the best free player for the same role. */
function claimPlayer(world: World, n: Career, playerId: string): void {
  for (const team of allAiTeams(n.season)) {
    const idx = team.playerIds.indexOf(playerId);
    if (idx < 0) continue;
    const role = team.roles[idx]!;
    const taken = new Set([...allAiTeams(n.season).flatMap((t) => t.playerIds), ...n.cards.map((x) => x.playerId)]);
    const div = DIVISIONS[n.season.division]!;
    const candidates = world.profileList.filter((p) => !taken.has(p.record.id) && p.record.rank >= div.rankRange[0] - 10);
    const sameRole = candidates.filter((p) => p.record.primaryRole === role);
    const pick = (sameRole.length ? sameRole : candidates).sort((a, b) => b.ovr - a.ovr)[0];
    if (pick) {
      team.playerIds[idx] = pick.record.id;
      addNews(n, `${team.tag} replace ${world.profiles.get(playerId)?.record.handle ?? 'their player'} with ${pick.record.handle}.`);
    }
  }
}

export function demandOf(world: World, c: Career, playerId: string) {
  const p = world.profiles.get(playerId);
  if (!p) throw new Error('Unknown player');
  const st = playerStatus(c, playerId);
  return demandFor(p, { onTeam: st.owner === 'ai', division: c.season.division, reputation: c.reputation, season: c.season.number, week: c.season.week });
}

export const MAX_OFFERS_PER_WEEK = 3;

export function offersLeft(c: Career, playerId: string): number {
  const n = c.negotiations[playerId];
  if (!n || n.season !== c.season.number || n.week !== c.season.week) return MAX_OFFERS_PER_WEEK;
  return Math.max(0, MAX_OFFERS_PER_WEEK - n.tries);
}

/** Make a transfer offer. Returns the new career (offer count, and on success the signing) and the verdict. */
export function makeOffer(world: World, c: Career, playerId: string, terms: OfferTerms): { career: Career; result: OfferResult } {
  const p = world.profiles.get(playerId);
  if (!p) throw new Error('Unknown player');
  const st = playerStatus(c, playerId);
  if (st.owner === 'you') return { career: c, result: { ok: false, reason: 'Already at your club.' } };
  if (c.cards.length >= MAX_SQUAD) return { career: c, result: { ok: false, reason: `Squad full (${MAX_SQUAD}). Sell or release a player first.` } };
  if (offersLeft(c, playerId) <= 0) return { career: c, result: { ok: false, reason: 'They will not talk again this week. Try after your next match.' } };
  if (terms.fee > 0 && terms.fee > c.coins) return { career: c, result: { ok: false, reason: `You only have ${c.coins} coins.` } };
  const n = structuredClone(c);
  const prev = n.negotiations[playerId];
  const sameWeek = prev && prev.season === n.season.number && prev.week === n.season.week;
  n.negotiations[playerId] = { season: n.season.number, week: n.season.week, tries: (sameWeek ? prev.tries : 0) + 1 };
  const result = judgeOffer(demandOf(world, c, playerId), terms);
  if (!result.ok) return { career: n, result };
  money(n, -terms.fee, 'transfer', `Signed ${p.record.handle}${st.teamTag ? ` from ${st.teamTag}` : ' (free agent)'}`);
  const card = addToCollection(n.cards, p, n.season.week, newCardId(n)).newCard!;
  card.contract = { wage: Math.round(terms.wage), weeksLeft: terms.weeks };
  card.sharpness = 65;
  claimPlayer(world, n, playerId);
  n.shortlist = n.shortlist.filter((x) => x !== playerId);
  addNews(n, `${p.record.handle} signs for ${terms.weeks} weeks at ${terms.wage} a week${terms.fee ? ` (fee ${terms.fee})` : ''}.`);
  return { career: n, result };
}

export function salePrice(world: World, card: OwnedCard): number {
  const p = profileOf(world, card);
  return Math.round((marketValue(p, cardOvr(p, card)) * SALE_SHARE) / 50) * 50;
}

function checkCanLeave(c: Career, cardId: string): OwnedCard {
  const card = cardById(c, cardId);
  if (!card) throw new Error('Unknown card');
  if (c.cards.length <= MIN_SQUAD) throw new Error('You need at least five players. Sign someone first.');
  if (c.phase === 'matchday' && c.lineup.some((s) => s.cardId === cardId)) throw new Error('This player is in the lineup for this week\'s match. Play the match first.');
  return card;
}

/** Share of market value paid for a case pull sold straight away (a quick sale, below what a club pays). */
export const PULL_SALE_SHARE = 0.25;

/** What selling a fresh case pull straight away pays. Kept below every case's price on average, so cases are no coin source. */
export function pullSalePrice(world: World, playerId: string): number {
  const p = world.profiles.get(playerId)!;
  return Math.round((marketValue(p, p.ovr) * PULL_SALE_SHARE) / 50) * 50;
}

/** Benched players (not in the starting five) that can be sold to make room. */
export function benchCards(c: Career): OwnedCard[] {
  const starters = new Set(c.lineup.map((s) => s.cardId));
  return c.cards.filter((x) => !starters.has(x.cardId));
}

/**
 * Settles a pull that arrived with a full squad: either sell a benched player
 * and sign the new one, or sell the new player straight away.
 */
export function resolvePull(world: World, c: Career, choice: { sellCardId: string } | 'sell-pull'): Career {
  const pend = c.pendingPull;
  if (!pend) throw new Error('No case pull is waiting.');
  const n = structuredClone(c);
  const profile = world.profiles.get(pend.playerId)!;
  delete n.pendingPull;
  if (choice === 'sell-pull') {
    const price = pullSalePrice(world, pend.playerId);
    money(n, price, 'sale', `Sold case pull ${profile.record.handle}`);
    addNews(n, `${profile.record.handle} sold straight from the case for ${price} coins.`);
    return n;
  }
  const out = cardById(c, choice.sellCardId);
  if (!out) throw new Error('Unknown card');
  if (c.lineup.some((s) => s.cardId === choice.sellCardId)) throw new Error('Pick a benched player, not one of your starting five.');
  const price = salePrice(world, out);
  const outHandle = profileOf(world, out).record.handle;
  removeCard(world, n, choice.sellCardId);
  money(n, price, 'sale', `Sold ${outHandle}`);
  const outcome = addToCollection(n.cards, profile, n.season.week, newCardId(n));
  if (outcome.newCard) {
    outcome.newCard.contract = defaultContract(profile);
    claimPlayer(world, n, profile.record.id);
  }
  addNews(n, `${outHandle} sold for ${price} coins to make room for ${profile.record.handle}.`);
  return n;
}

export function sellCard(world: World, c: Career, cardId: string): Career {
  const card = checkCanLeave(c, cardId);
  const n = structuredClone(c);
  const price = salePrice(world, card);
  const handle = profileOf(world, card).record.handle;
  removeCard(world, n, cardId);
  money(n, price, 'sale', `Sold ${handle}`);
  addNews(n, `${handle} sold for ${price} coins.`);
  return n;
}

export function releaseCard(world: World, c: Career, cardId: string): Career {
  const card = checkCanLeave(c, cardId);
  const n = structuredClone(c);
  const cost = severance(card);
  const handle = profileOf(world, card).record.handle;
  removeCard(world, n, cardId);
  money(n, -cost, 'release', `Released ${handle}`);
  addNews(n, `${handle} released.${cost ? ` Severance ${cost} coins.` : ''}`);
  return n;
}

/** What a player wants to extend. Morale and recent form move the price. */
export function renewalDemand(world: World, c: Career, cardId: string): number {
  const card = cardById(c, cardId)!;
  const p = profileOf(world, card);
  const base = baseWage(p, cardOvr(p, card));
  const mood = 1 + (60 - card.morale) / 200 + (personalityOf(p.record.id).ambition - 10) / 50;
  return Math.max(15, Math.round((base * mood) / 5) * 5);
}

export function renewContract(world: World, c: Career, cardId: string, weeks: number): Career {
  if (![9, 18, 27].includes(weeks)) throw new Error('Pick 9, 18 or 27 weeks.');
  const card = cardById(c, cardId);
  if (!card) throw new Error('Unknown card');
  const wage = Math.round((renewalDemand(world, c, cardId) * (weeks <= 9 ? 1.08 : weeks >= 27 ? 0.95 : 1)) / 5) * 5;
  const n = structuredClone(c);
  const nc = cardById(n, cardId)!;
  nc.contract = { wage, weeksLeft: weeks + (card.contract?.weeksLeft ?? 0) };
  nc.morale = clamp(nc.morale + 4, 0, 100);
  addNews(n, `${profileOf(world, card).record.handle} extends for ${weeks} weeks at ${wage} a week.`);
  return n;
}

export function currentSponsorOffers(c: Career): Sponsor[] {
  return sponsorOffers(c.season.number, c.season.division, c.season.sponsorRep ?? c.reputation, c.seed);
}

export function signSponsor(c: Career, sponsorId: string): Career {
  if (c.sponsor) throw new Error('You already have a sponsor this season.');
  const offer = currentSponsorOffers(c).find((s) => s.id === sponsorId);
  if (!offer) throw new Error('That offer is no longer available.');
  const n = structuredClone(c);
  n.sponsor = offer;
  addNews(n, `${offer.name} sponsor the team this season: ${offer.weekly} a week.`);
  return n;
}

export function toggleShortlist(c: Career, playerId: string): Career {
  const n = structuredClone(c);
  n.shortlist = n.shortlist.includes(playerId) ? n.shortlist.filter((x) => x !== playerId) : [...n.shortlist, playerId];
  return n;
}

export type { Contract };
