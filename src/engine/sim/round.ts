/**
 * Spatial round simulation. Ten players move on the real map grid in 0.1 s
 * steps. Each step:
 *   1. grenades pop (smokes block sight, flashes blind, molotovs and HEs hurt)
 *   2. each team's caller updates the plan (T: control, execute, adapt,
 *      post-plant; CT: holds, rotations, retake or save)
 *   3. players pick what to do from what they know (their own sightings,
 *      sounds, and teammates' calls after a delay), never from the engine's
 *      full state
 *   4. players move along A* paths
 *   5. sight: an enemy in view and in the field of view starts a detection
 *      timer (reflexes, angle, range, cover, whether they expected it)
 *   6. shots are resolved in time order: hit chance from precision, range,
 *      movement, cover, spray, flashes and pressure; damage from the weapon,
 *      hit group and armour
 *   7. the bomb: plant, defuse, explosion; then the round-end check
 *
 * All randomness comes from one seeded stream, so the same inputs replay the
 * same round exactly. Recording a replay never touches that stream.
 */
import { findPath } from '../../maps/nav';
import { isWalkable, regionContains } from '../../maps/parse';
import type { MapGeometry, Region } from '../../maps/types';
import { Rng, clamp } from '../rng';
import type { MatchPlayer, TeamSnapshot } from '../team';
import type { CTSetup, Footsteps, Playstyle, Role, TApproach } from '../types';
import { acquireTime, combatProfile, detectionTime, headshotChance, hitChance, s01, shotDamage, weaponDef } from './combat';
import type { CombatProfile, HitGroup, WeaponDef } from './combat';
import { airTime, SETTLE } from './flight';
import { mapIntel } from './mapintel';
import type { Cell, MapIntel } from './mapintel';
import type { TeamSynergy } from './synergy';

export type Side = 'T' | 'CT';
export type TeamIdx = 0 | 1;
export type Zone = 'A' | 'B' | 'Mid';
export type { UtilityKind } from './flight';
import type { UtilityKind } from './flight';

export const DT = 0.1;
export const ROUND_TIME = 115;
export const BOMB_TIME = 40;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 10;
export const DEFUSE_KIT_TIME = 5;
const SMOKE_TIME = 18;
const SMOKE_R = 3.0;
const MOLLY_TIME = 7;
const MOLLY_R = 2.4;
const FOV_HALF = (100 * Math.PI) / 180 / 2;
const SIGHT_MAX = 70;
const HEAR_STEPS = 20;
const WALK = 0.52;
/** Metres of path left at which a walking player switches from running to walking. */
const QUIET_STRETCH = 22;
/** Seconds a player stays locked on a runner they heard coming. */
const FOCUS_TIME = 4;

export interface SimLoadout { weapon: string; armor: boolean; helmet: boolean; kit: boolean; nades: UtilityKind[] }

export interface RoundSimInput {
  geo: MapGeometry;
  seed: number;
  tTeam: TeamIdx;
  teams: [TeamSnapshot, TeamSnapshot];
  loadouts: Map<string, SimLoadout>;
  plan: { t: TApproach; site: 'A' | 'B'; ct: CTSetup; stackSite: 'A' | 'B' };
  playstyle: [Playstyle, Playstyle];
  /** Footstep discipline per team (defaults to normal). */
  footsteps?: [Footsteps, Footsteps];
  synergy: [TeamSynergy, TeamSynergy];
  /** Small team-level edge (-0.3..0.3) from preparation, coach and momentum. */
  edge: [number, number];
  record: boolean;
}

export interface SimKill {
  t: number; killer: string; victim: string; killerTeam: TeamIdx; assister?: string; flashAssist?: boolean; weapon: string; headshot: boolean; zone: Zone; opening: boolean; trade: boolean;
  /** How the fight looked: the killer was holding the angle, the victim was blind, moving, behind cover, outnumbered. */
  how: { preAimed: boolean; victimBlind: boolean; victimMoving: boolean; killerHolding: boolean; distance: number; crossfire: boolean; /** The killer heard the victim running in. */ heard?: boolean };
}
export interface SimHit { t: number; attacker: string; victim: string; damage: number; lethal: boolean }
export interface SimShot { t: number; from: string; to: string; hit: boolean; lethal: boolean; damage: number; headshot: boolean; weapon: string }
export interface SimUtility {
  t: number; landT: number; playerId: string; team: TeamIdx; side: Side; kind: UtilityKind; zone: Zone;
  from: [number, number]; at: [number, number]; radius: number; duration: number;
  victims: { id: string; damage: number }[]; flashed: string[]; flashedEnemies: number; damage: number;
  /** Why it was thrown, for the tactical log. */
  purpose: string;
}

export interface TacticalEvent { t: number; team: TeamIdx; text: string; kind: 'plan' | 'call' | 'util' | 'fight' | 'adapt' | 'bomb' | 'info' }

/** Why the round went the way it did, in terms a manager can act on. */
export interface TacticReport {
  tPlan: TApproach;
  ctSetup: CTSetup;
  plannedSite: 'A' | 'B';
  site: 'A' | 'B';
  /** Every change of target site, in time order (starts with the planned site at 0). */
  siteLog: { t: number; site: 'A' | 'B' }[];
  adapted: boolean;
  callT: number | null;
  /** Seconds between the first and last T entering the site after the call. */
  entrySpread: number | null;
  /** Flash pop time minus the entry's first peek (negative = popped before the peek). */
  flashLead: number | null;
  smokesLanded: number;
  flashesThrown: number;
  enemiesFlashedT: number;
  enemiesFlashedCT: number;
  tradesT: number;
  tradesCT: number;
  /** Seconds after the call when Ts held the site (no living CT on it), or null. */
  siteTakenT: number | null;
  rotationT: number | null;
  rotators: number;
  openingTeam: TeamIdx | null;
  /** One line on why it worked or failed. */
  verdict: string;
  /** Execute quality 0..100 (null when there was no execute). */
  executeScore: number | null;
  events: TacticalEvent[];
}

export interface TrackRecord {
  id: string;
  xs: Float32Array; ys: Float32Array; aim: Float32Array; spotted: Uint8Array;
  deathT: number | null; hp: [number, number][]; weapons: [number, string][]; armor: boolean; helmet: boolean; kit: boolean; blinded: number[];
  /** Footsteps per frame: 0 still, 1 running (heard), 3 walking (silent). 2 is unused. */
  noise?: Uint8Array;
}

export interface RoundReplay {
  dt: number;
  planter?: string;
  frames: number;
  tracks: TrackRecord[];
  /** Someone heard a running enemy and turned on them: [t, listener, runner]. */
  heard?: [number, string, string][];
  shots: SimShot[];
  bomb: { carrier: string | null; pickups: [number, string][]; drops: [number, number, number][]; plantT: number | null; plantAt: [number, number] | null; defuseStart: number | null; defuseEnd: number | null; defuser: string | null; exploded: boolean; /** Every defuse attempt: start, when it was cut short (null if it finished or the round ended), who, seconds needed. */ attempts: [number, number | null, string, number][]; dropT: number | null; dropAt: [number, number] | null };
}

export interface RoundSimOutput {
  winnerSide: Side;
  reason: 'elimination' | 'bomb' | 'defuse' | 'time';
  kills: SimKill[];
  hits: SimHit[];
  utility: SimUtility[];
  planted: boolean;
  plantTime?: number;
  planterId?: string;
  defuserId?: string;
  site: 'A' | 'B';
  endTime: number;
  survivors: string[];
  clutch?: { playerId: string; team: TeamIdx; vs: number };
  report: TacticReport;
  replay?: RoundReplay;
  /** Per-player damage dealt this round (guns plus grenades), for ADR. */
  damage: Map<string, number>;
}

type Task =
  | 'stage' | 'control' | 'wait' | 'go' | 'plant' | 'postplant' | 'fetch' | 'save' | 'lurk'
  | 'hold' | 'push' | 'rotate' | 'gather' | 'retake' | 'defuse' | 'fallback' | 'trade';

interface Known { x: number; y: number; t: number }

interface Contact { start: number; detectAt: number; expected: boolean; focus: boolean }

interface Agent {
  i: number;
  p: MatchPlayer;
  id: string;
  role: Role;
  prof: CombatProfile;
  team: TeamIdx;
  side: Side;
  x: number; y: number;
  facing: number;
  moving: boolean;
  hp: number; armor: number; helmet: boolean; kit: boolean;
  weapon: WeaponDef;
  nades: UtilityKind[];
  alive: boolean;
  deathT: number | null;
  task: Task;
  goal: Cell | null;
  path: Cell[]; pathI: number;
  walk: boolean;
  /** Walking right now (silent): set each tick from walk and the distance left. */
  quiet: boolean;
  /** Metres of path left at which this player switches from running to walking (team footsteps, style, decisions). */
  stretch: number;
  /** Team footstep discipline. */
  steps: Footsteps;
  /** When this player last heard each enemy running (-99 if never). */
  heardAt: number[];
  watch: number | null;
  holdCell: Cell | null;
  goT: number;
  target: number; nextShot: number; lastShot: number; burst: number; lostSince: number | null; preAimed: boolean;
  contacts: (Contact | null)[];
  known: (Known | null)[];
  blindUntil: number; blindStart: number;
  form: number;
  lastKillT: number; lastVictimTeamOf: number;
  dmgFrom: Map<number, number>;
  flashedBy: { by: number; until: number } | null;
  waitUntil: number;
  /** Refrag target after a teammate died; fam is the familiarity with that teammate (0..1). */
  tradeFor: { killer: number; until: number; fam: number } | null;
  lastInfoT: number;
  /** Seconds already spent waiting off a known angle this round (caps the caution). */
  caution: number;
  /** Holding still off a known angle until this time (stage and control tasks). */
  pauseUntil: number;
  /** Next exposed crossing on the current path: path index and the common CT angle that sees it. */
  cross: { i: number; angle: Cell } | null;
  // record
  hpLog: [number, number][]; weaponLog: [number, string][]; blinded: number[];
}

interface Grenade { kind: UtilityKind; thrower: number; team: TeamIdx; throwT: number; landT: number; from: [number, number]; at: [number, number]; ev: SimUtility; popped: boolean }

const dist = (ax: number, ay: number, bx: number, by: number) => { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };
const angTo = (ax: number, ay: number, bx: number, by: number) => Math.atan2(by - ay, bx - ax);
const angDiff = (a: number, b: number) => { const d = b - a; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); };

function zoneAt(geo: MapGeometry, x: number, y: number): Zone {
  for (const r of geo.regions) if (regionContains(geo, r, x, y)) return r.zone === 'A' || r.zone === 'B' ? r.zone : 'Mid';
  return 'Mid';
}

function inRegion(geo: MapGeometry, r: Region, x: number, y: number): boolean {
  return regionContains(geo, r, x, y);
}

export function simulateRound(input: RoundSimInput): RoundSimOutput {
  const { geo, tTeam, teams, plan, synergy } = input;
  const rng = new Rng(input.seed);
  const intel: MapIntel = mapIntel(geo);
  const ctTeam: TeamIdx = tTeam === 0 ? 1 : 0;
  const sideOf = (team: TeamIdx): Side => (team === tTeam ? 'T' : 'CT');
  const W = geo.w;

  // ------------------------------------------------------------------ setup
  const agents: Agent[] = [];
  const spawnCells = (side: Side) => (side === 'T' ? geo.tSpawn : geo.ctSpawn);
  for (const team of [tTeam, ctTeam] as TeamIdx[]) {
    const side = sideOf(team);
    const cells = spawnCells(side);
    teams[team].players.forEach((p, k) => {
      const lo = input.loadouts.get(p.id) ?? { weapon: side === 'T' ? 'Glock-18' : 'USP-S', armor: false, helmet: false, kit: false, nades: [] };
      // Fixed spawn slots, like the real game (and the paths out of them stay cached).
      const c = cells[Math.floor(((k + 0.4) * cells.length) / 5) % cells.length]!;
      const cons = s01(combatProfile(p.attrs).consistency);
      const ps = input.playstyle[team];
      const vol = (1.15 - 0.75 * cons) * (ps === 'aggressive' ? 1.2 : ps === 'passive' ? 0.85 : 1);
      const prof = combatProfile(p.attrs);
      const fs = input.footsteps?.[team] ?? 'normal';
      // Careful players (good decisions, passive style) start walking earlier; eager entries later.
      const care = clamp(1 + (ps === 'aggressive' ? -0.15 : ps === 'passive' ? 0.15 : 0) - 0.3 * (s01(prof.entrying) - 0.5) + 0.3 * (s01(prof.decisions) - 0.5), 0.6, 1.4);
      const stretch = QUIET_STRETCH * (fs === 'quiet' ? 1.45 : fs === 'aggressive' ? 0.6 : 1) * care;
      agents.push({
        i: agents.length, p, id: p.id, role: p.role, prof: combatProfile(p.attrs), team, side,
        x: c[0] + 0.5, y: c[1] + 0.5, facing: side === 'T' ? angTo(c[0], c[1], intel.ctSpawnCenter[0], intel.ctSpawnCenter[1]) : angTo(c[0], c[1], intel.tSpawnCenter[0], intel.tSpawnCenter[1]),
        moving: false, hp: 100, armor: lo.armor ? 100 : 0, helmet: lo.helmet, kit: lo.kit, weapon: weaponDef(lo.weapon), nades: [...lo.nades],
        alive: true, deathT: null, task: side === 'T' ? 'stage' : 'hold', goal: null, path: [], pathI: 0, walk: false, quiet: false, stretch, steps: fs, heardAt: [], watch: null, holdCell: null, goT: 0,
        target: -1, nextShot: 0, lastShot: -9, burst: 0, lostSince: null, preAimed: false,
        contacts: [], known: [], blindUntil: 0, blindStart: 0, form: clamp(rng.normal(0, vol), -2, 2) + input.edge[team] * 3,
        lastKillT: -99, lastVictimTeamOf: -1, dmgFrom: new Map(), flashedBy: null, waitUntil: 0, tradeFor: null, lastInfoT: -99, caution: 0, pauseUntil: 0, cross: null,
        hpLog: [], weaponLog: [[0, lo.weapon]], blinded: [],
      });
    });
  }
  const N = agents.length;
  for (const a of agents) { a.contacts = new Array(N).fill(null); a.known = new Array(N).fill(null); a.heardAt = new Array(N).fill(-99); }
  const T = agents.filter((a) => a.side === 'T');
  const CT = agents.filter((a) => a.side === 'CT');
  const enemiesOf = (a: Agent) => (a.side === 'T' ? CT : T);
  const matesOf = (a: Agent) => (a.side === 'T' ? T : CT);
  const syn = (a: Agent) => synergy[a.team];
  const pairFam = (a: Agent, b: Agent) => syn(a).pair(a.id, b.id) / 100;
  /** -1..1: how far a team's overall synergy is from average (50). */
  const coord = (a: Agent) => clamp((syn(a).overall - 50) / 40, -1, 1);

  const report: TacticReport = {
    tPlan: plan.t, ctSetup: plan.ct, plannedSite: plan.site, site: plan.site, siteLog: [{ t: 0, site: plan.site }], adapted: false, callT: null, entrySpread: null, flashLead: null,
    smokesLanded: 0, flashesThrown: 0, enemiesFlashedT: 0, enemiesFlashedCT: 0, tradesT: 0, tradesCT: 0, siteTakenT: null, rotationT: null, rotators: 0,
    openingTeam: null, verdict: '', executeScore: null, events: [],
  };
  const log = (t: number, team: TeamIdx, kind: TacticalEvent['kind'], text: string) => report.events.push({ t: Math.round(t * 10) / 10, team, kind, text });

  const kills: SimKill[] = [];
  const hits: SimHit[] = [];
  const shots: SimShot[] = [];
  const utility: SimUtility[] = [];
  const grenades: Grenade[] = [];
  const damage = new Map<string, number>();
  const addDamage = (id: string, d: number) => damage.set(id, (damage.get(id) ?? 0) + d);

  // Bomb
  const bombCarrierPick = [...T].sort((a, b) => (b.role === 'support' ? 2 : b.role === 'igl' ? 1 : 0) - (a.role === 'support' ? 2 : a.role === 'igl' ? 1 : 0))[0]!;
  let carrier = bombCarrierPick as Agent | null;
  const bomb: RoundReplay['bomb'] = { carrier: bombCarrierPick.id, pickups: [[0, bombCarrierPick.id]], drops: [], plantT: null, plantAt: null, defuseStart: null, defuseEnd: null, defuser: null, exploded: false, attempts: [], dropT: null, dropAt: null };
  let bombDropped = null as [number, number] | null;
  let plantStart = null as number | null;
  let planter = null as Agent | null;
  let plantedBy: string | undefined;
  let defuser = null as Agent | null;
  let defuseStart = null as number | null;
  const stopAttempt = (t: number) => { const at = bomb.attempts[bomb.attempts.length - 1]; if (at && at[1] === null) at[1] = Math.max(at[0], Math.round(t * 10) / 10); };
  let site: 'A' | 'B' = plan.site;
  let clutch: RoundSimOutput['clutch'];
  let ended = null as { winner: Side; reason: RoundSimOutput['reason']; t: number } | null;

  // Recording
  const maxFrames = Math.ceil((ROUND_TIME + BOMB_TIME + 5) / DT) + 2;
  const rec = input.record ? agents.map(() => ({ xs: new Float32Array(maxFrames), ys: new Float32Array(maxFrames), aim: new Float32Array(maxFrames), spotted: new Uint8Array(maxFrames), noise: new Uint8Array(maxFrames) })) : null;
  const heardLog: [number, string, string][] = [];

  // ------------------------------------------------------------------ helpers
  const cellOf = (a: Agent): Cell => [Math.floor(a.x), Math.floor(a.y)];
  const setGoal = (a: Agent, c: Cell | null, walk = false) => {
    a.walk = walk;
    if (!c) { a.goal = null; a.path = []; a.pathI = 0; return; }
    if (a.goal && a.goal[0] === c[0] && a.goal[1] === c[1]) return;
    a.goal = c;
    const from = cellOf(a);
    const p = isWalkable(geo, from[0], from[1]) ? findPath(geo, from, c) : null;
    // Unreachable (e.g. below a one-way drop): stay put rather than walk through walls.
    a.path = p ?? [];
    a.pathI = 0;
    a.cross = null;
    // Before the hit, a T knows the usual CT angles: find the first stretch of the path one of them covers.
    if (a.side === 'T' && tPhase === 'setup') {
      for (let k = 2; k < a.path.length && !a.cross; k += 2) {
        const c = a.path[k]!;
        for (const ang of intel.commonAngles) {
          const dx = ang[0] - c[0], dy = ang[1] - c[1];
          if (dx * dx + dy * dy < 1600 && dx * dx + dy * dy > 16 && intel.sight(ang[0], ang[1], c[0], c[1]) !== 0) { a.cross = { i: k, angle: ang }; break; }
        }
      }
    }
  };
  const regionCell = (r: Region, salt: number): Cell => r.cells.length ? r.cells[Math.abs(Math.floor(salt)) % r.cells.length]! : r.center;
  const atGoal = (a: Agent) => !a.goal || a.pathI >= a.path.length;
  const smokes: { x: number; y: number; until: number; from: number }[] = [];
  const mollies: { x: number; y: number; until: number; from: number; owner: number }[] = [];
  const smokeBlocks = (ax: number, ay: number, bx: number, by: number, t: number) => {
    for (const s of smokes) {
      if (t < s.from || t > s.until) continue;
      // distance from smoke centre to the segment
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      const u = clamp(((s.x - ax) * dx + (s.y - ay) * dy) / L, 0, 1);
      if (dist(ax + dx * u, ay + dy * u, s.x, s.y) < SMOKE_R) return true;
    }
    return false;
  };
  const blindAmt = (a: Agent, t: number) => (t < a.blindUntil ? (a.blindUntil - t) / Math.max(0.1, a.blindUntil - a.blindStart) : 0);
  const aliveCount = (list: Agent[]) => list.reduce((n, a) => n + (a.alive ? 1 : 0), 0);

  const shareInfo = (from: Agent, e: Agent, t: number, delay: number) => {
    for (const m of matesOf(from)) {
      if (!m.alive || m === from) continue;
      pendingInfo.push({ to: m.i, e: e.i, x: e.x, y: e.y, seen: t, at: t + delay * (1.15 - 0.5 * pairFam(from, m)) });
    }
  };
  const pendingInfo: { to: number; e: number; x: number; y: number; seen: number; at: number }[] = [];
  const learn = (a: Agent, e: Agent | number, x: number, y: number, t: number) => {
    const ei = typeof e === 'number' ? e : e.i;
    const k = a.known[ei];
    if (!k || k.t <= t) { a.known[ei] = { x, y, t }; if (t > a.lastInfoT) a.lastInfoT = t; }
  };

  // ------------------------------------------------------------------ plans
  const entries = intel.entries;
  const pickEntry = (s: 'A' | 'B', k: number) => entries[s][k % Math.max(1, entries[s].length)]!;
  const mainEntryIdx = rng.int(0, 7);
  let tPhase: 'setup' | 'execute' | 'postplant' = 'setup';
  let callT: number | null = null;
  const siteRegion = () => geo.sites[site];
  // On rebuilt maps the site region is only the plant zone; the area around it counts as "on site" for entries.
  const onSiteArea = (x: number, y: number) => { const r = siteRegion(); const open = geo.regionById.get(`${r.id}-open`); return inRegion(geo, r, x, y) || (!!open && inRegion(geo, open, x, y)); };
  const entryFor = (a: Agent) => {
    const list = entries[site];
    if (list.length <= 1 || plan.t === 'rush') return pickEntry(site, mainEntryIdx);
    // Split hits: support and lurker come through the second entrance when there is one.
    return (a.role === 'lurker' || a.role === 'support') && plan.t === 'execute' ? pickEntry(site, mainEntryIdx + 1) : pickEntry(site, mainEntryIdx);
  };

  // T opening positions
  const other = (s: 'A' | 'B'): 'A' | 'B' => (s === 'A' ? 'B' : 'A');
  for (const a of T) {
    let target: Region;
    if (plan.t === 'rush') target = entryFor(a).choke;
    else if (plan.t === 'execute') target = entryFor(a).staging;
    else {
      if (a.role === 'lurker') target = pickEntry(other(site), mainEntryIdx).staging;
      else if (a.role === 'awp' || a.role === 'igl') target = intel.midEnds[(a.i + mainEntryIdx) % Math.max(1, intel.midEnds.length)] ?? entryFor(a).staging;
      else target = entryFor(a).staging;
    }
    const hide = plan.t === 'rush' ? null : intel.staging(target.id, a.role === 'lurker' && plan.t === 'default' ? other(site) : site);
    // Defaults and executes set up quietly (walking); a rush runs and is heard.
    setGoal(a, hide ? hide[a.i % hide.length]! : regionCell(target, rng.int(0, 999)), plan.t !== 'rush');
    a.watch = angTo(target.center[0], target.center[1], geo.sites[site].center[0], geo.sites[site].center[1]);
    a.task = plan.t === 'rush' ? 'go' : 'stage';
    a.goT = plan.t === 'rush' ? Math.abs(rng.normal(0, synergy[a.team].executeSpread * 0.25)) : 0;
  }
  if (plan.t === 'rush') { callT = 0; tPhase = 'execute'; report.callT = 0; log(0, tTeam, 'call', `Rush ${site}: all five go straight through ${pickEntry(site, mainEntryIdx).choke.name}.`); }
  else log(0, tTeam, 'plan', plan.t === 'execute' ? `Execute ${site}: set up at ${pickEntry(site, mainEntryIdx).staging.name}, then hit together.` : `Default: take map control, decide the site later (leaning ${site}).`);

  // CT holds
  const holdPlan: { region: string; zone: Zone }[] = [];
  const H = geo.ctHolds;
  const at = (list: string[], i: number) => list[i % list.length]!;
  if (plan.ct === 'stack') { const s = plan.stackSite, o = other(s); holdPlan.push({ region: at(H[s], 0), zone: s }, { region: at(H[s], 1), zone: s }, { region: at(H[s], 2), zone: s }, { region: at(H[o], 0), zone: o }, { region: at(H.Mid, 0), zone: 'Mid' }); }
  else if (plan.ct === 'retake') holdPlan.push({ region: at(H.A, 1), zone: 'A' }, { region: at(H.B, 1), zone: 'B' }, { region: intel.retakeFrom.A.id, zone: 'A' }, { region: intel.retakeFrom.B.id, zone: 'B' }, { region: at(H.Mid, 0), zone: 'Mid' });
  else holdPlan.push({ region: at(H.A, 0), zone: 'A' }, { region: at(H.A, 1), zone: 'A' }, { region: at(H.B, 0), zone: 'B' }, { region: at(H.B, 1), zone: 'B' }, { region: at(H.Mid, 0), zone: 'Mid' });
  const ctOrder = [...CT].sort((a, b) => (a.role === 'awp' ? 1 : 0) - (b.role === 'awp' ? 1 : 0));
  const ctZone = new Map<number, Zone>();
  const usedCells = new Set<number>();
  const assignHold = (a: Agent, region: string, zone: Zone, salt: number) => {
    const spots = intel.holds(region, zone);
    const pos = s01(a.prof.awareness * 0.4 + a.p.attrs.positioning * 0.6);
    // Better positioners take less obvious spots (rank 1-3) more often; common spots are best covered but expected.
    let rank = rng.chance(0.25 + 0.55 * pos) ? 1 + Math.floor(rng.next() * Math.min(3, spots.length - 1)) : 0;
    rank = Math.min(rank, spots.length - 1);
    // Crossfire: with good synergy, a second player on the same site picks a different angle.
    const mates = CT.filter((m) => m !== a && m.holdCell && ctZone.get(m.i) === zone);
    for (let tries = 0; tries < spots.length; tries++) {
      const s = spots[(rank + tries) % spots.length]!;
      const key = s.cell[1] * W + s.cell[0];
      if (usedCells.has(key)) continue;
      const sameAngle = mates.some((m) => m.watch !== null && angDiff(m.watch, s.watch) < 0.35);
      if (sameAngle && rng.chance(syn(a).overall / 100)) continue;
      usedCells.add(key);
      a.holdCell = s.cell; a.watch = s.watch;
      return;
    }
    const s = spots[rank]!;
    a.holdCell = s.cell; a.watch = s.watch;
    void salt;
  };
  ctOrder.forEach((a, k) => {
    const hp = a.role === 'awp' && plan.ct === 'standard' ? holdPlan[4]! : holdPlan[k === 4 ? (ctOrder[4]!.role === 'awp' ? 0 : 4) : k] ?? holdPlan[k % holdPlan.length]!;
    ctZone.set(a.i, hp.zone);
    assignHold(a, hp.region, hp.zone, k);
    a.task = 'hold';
    setGoal(a, a.holdCell, false);
  });
  // Aggressive info: two players take forward spots for the opening seconds.
  if (plan.ct === 'aggro') {
    const pushers = [...CT].sort((a, b) => (b.role === 'entry' || b.role === 'awp' ? 1 : 0) - (a.role === 'entry' || a.role === 'awp' ? 1 : 0)).slice(0, 2);
    pushers.forEach((a, k) => {
      const lane = geo.lanes.filter((l) => l.via.length >= 4)[(mainEntryIdx + k * 3) % Math.max(1, geo.lanes.length)];
      const r = lane ? geo.regionById.get(lane.via[Math.max(1, lane.via.length - 3)]!)! : intel.midEnds[0]!;
      a.task = 'push';
      setGoal(a, regionCell(r, rng.int(0, 999)));
      a.watch = angTo(r.center[0], r.center[1], intel.tSpawnCenter[0], intel.tSpawnCenter[1]);
    });
    log(0, ctTeam, 'plan', `Aggressive: ${pushers.map((p) => p.p.handle).join(' and ')} push forward for early information.`);
  } else log(0, ctTeam, 'plan', plan.ct === 'stack' ? `Stack ${plan.stackSite}: three players on ${plan.stackSite}.` : plan.ct === 'retake' ? 'Retake setup: light on the sites, ready to come back together.' : 'Standard 2-1-2 setup.');

  // ------------------------------------------------------------------ grenades
  const throwNade = (a: Agent, kind: UtilityKind, target: Cell, t: number, purpose: string): boolean => {
    const idx = a.nades.indexOf(kind);
    if (idx < 0 || !a.alive) return false;
    const d = dist(a.x, a.y, target[0] + 0.5, target[1] + 0.5);
    if (d > 38) return false;
    a.nades.splice(idx, 1);
    // Practised lineups land closer: synergy trims the error a little.
    const err = (1.1 - s01(a.prof.utility)) * 3.2 * (1 - input.edge[a.team]) * (1 - 0.25 * coord(a));
    const ang = rng.next() * Math.PI * 2, r = rng.next() * err;
    let ax = target[0] + 0.5 + Math.cos(ang) * r, ay = target[1] + 0.5 + Math.sin(ang) * r;
    if (!isWalkable(geo, Math.floor(ax), Math.floor(ay))) { ax = target[0] + 0.5; ay = target[1] + 0.5; }
    const landT = t + airTime(d) + SETTLE[kind];
    const ev: SimUtility = {
      t: Math.round(t * 10) / 10, landT: Math.round(landT * 10) / 10, playerId: a.id, team: a.team, side: a.side, kind, zone: zoneAt(geo, ax, ay),
      from: [a.x, a.y], at: [ax, ay], radius: kind === 'smoke' ? SMOKE_R : kind === 'molotov' ? MOLLY_R : kind === 'he' ? 4.5 : 0,
      duration: kind === 'smoke' ? SMOKE_TIME : kind === 'molotov' ? MOLLY_TIME : 0, victims: [], flashed: [], flashedEnemies: 0, damage: 0, purpose,
    };
    utility.push(ev);
    grenades.push({ kind, thrower: a.i, team: a.team, throwT: t, landT, from: [a.x, a.y], at: [ax, ay], ev, popped: false });
    if (kind === 'flash') report.flashesThrown += a.side === 'T' ? 1 : 0;
    return true;
  };
  const popGrenade = (g: Grenade, t: number) => {
    g.popped = true;
    const thrower = agents[g.thrower]!;
    const [gx, gy] = g.at;
    if (g.kind === 'smoke') {
      smokes.push({ x: gx, y: gy, from: t, until: t + SMOKE_TIME });
      if (thrower.side === 'T') report.smokesLanded++;
    } else if (g.kind === 'molotov') {
      mollies.push({ x: gx, y: gy, from: t, until: t + MOLLY_TIME, owner: g.thrower });
    } else if (g.kind === 'flash') {
      for (const v of agents) {
        if (!v.alive) continue;
        const d = dist(v.x, v.y, gx, gy);
        if (d > 24) continue;
        const vc = cellOf(v);
        if (intel.sight(vc[0], vc[1], Math.floor(gx), Math.floor(gy)) === 0 || smokeBlocks(v.x, v.y, gx, gy, t)) continue;
        const off = angDiff(v.facing, angTo(v.x, v.y, gx, gy));
        let dur = off < 0.9 ? 2.5 * (1 - d / 30) : off < 1.6 ? 1.0 * (1 - d / 30) : 0.25;
        // Good throwers pop flashes out of their teammates' view.
        if (v.team === g.team) dur *= 1.05 - 0.9 * s01(thrower.prof.utility) - 0.3 * pairFam(thrower, v);
        if (dur < 0.15) continue;
        v.blindStart = t; v.blindUntil = Math.max(v.blindUntil, t + dur); v.blinded.push(Math.round(t * 10) / 10);
        if (v.team !== g.team && dur >= 0.7) {
          g.ev.flashed.push(v.id); g.ev.flashedEnemies++;
          v.flashedBy = { by: g.thrower, until: t + dur };
          if (thrower.side === 'T') report.enemiesFlashedT++; else report.enemiesFlashedCT++;
          // A blind player loses their current fight.
          v.target = -1;
        }
      }
    } else if (g.kind === 'he') {
      for (const v of agents) {
        if (!v.alive) continue;
        const d = dist(v.x, v.y, gx, gy);
        if (d > 4.5) continue;
        const vc = cellOf(v);
        if (intel.sight(vc[0], vc[1], Math.floor(gx), Math.floor(gy)) === 0) continue;
        let dmg = 57 * (1 - d / 4.5) * (v.armor > 0 ? 0.55 : 1);
        if (v.team === g.team) dmg *= 0.35;
        dmg = Math.round(dmg);
        if (dmg <= 0) continue;
        const done = applyDamage(thrower, v, dmg, t, 'HE Grenade', false, true);
        if (v.team !== g.team && done > 0) { g.ev.victims.push({ id: v.id, damage: done }); g.ev.damage += done; }
      }
    }
  };

  // ------------------------------------------------------------------ damage & kills
  const zoneOf = (a: Agent): Zone => zoneAt(geo, a.x, a.y);
  const applyDamage = (by: Agent, v: Agent, dmg: number, t: number, weapon: string, headshot: boolean, utilityDmg: boolean): number => {
    if (!v.alive) return 0;
    // Team damage hurts but never kills (no team kills in this model).
    const real = by.team === v.team && by !== v ? Math.min(v.hp - 1, dmg) : by === v ? Math.min(v.hp - 1, dmg) : Math.min(v.hp, dmg);
    if (real <= 0) return 0;
    v.hp -= real;
    if (by.team !== v.team) {
      addDamage(by.id, real);
      v.dmgFrom.set(by.i, (v.dmgFrom.get(by.i) ?? 0) + real);
    }
    const lethal = v.hp <= 0;
    if (!utilityDmg) hits.push({ t: Math.round(t * 100) / 100, attacker: by.id, victim: v.id, damage: real, lethal });
    v.hpLog.push([Math.round(t * 100) / 100, Math.max(0, v.hp)]);
    if (lethal) killAgent(by, v, t, weapon, headshot);
    return real;
  };
  const killAgent = (k: Agent, v: Agent, t: number, weapon: string, headshot: boolean) => {
    const victimMoving = v.moving;
    v.alive = false; v.deathT = Math.round(t * 100) / 100; v.target = -1; v.moving = false;
    if (k.team === v.team) return; // team damage kills are not counted as kills
    const opening = kills.length === 0;
    if (opening) { report.openingTeam = k.team; log(t, k.team, 'fight', `${k.p.handle} opens the round on ${v.p.handle}${v.blindUntil > t ? ' (flashed)' : ''}.`); }
    const trade = v.lastKillT >= t - 5 && v.lastVictimTeamOf === k.team;
    if (trade) { if (k.side === 'T') report.tradesT++; else report.tradesCT++; }
    let assister: Agent | undefined;
    let flashAssist = false;
    let best = 40;
    for (const [ai, d] of v.dmgFrom) { const a = agents[ai]!; if (a !== k && a.team === k.team && d > best) { best = d; assister = a; } }
    if (!assister && v.flashedBy && v.flashedBy.until >= t - 0.5) { const a = agents[v.flashedBy.by]!; if (a !== k && a.team === k.team) { assister = a; flashAssist = true; } }
    const crossfire = matesOf(k).filter((m) => m.alive && m !== k && visible[m.i * N + v.i]).length > 0;
    kills.push({
      t: Math.round(t * 100) / 100, killer: k.id, victim: v.id, killerTeam: k.team, assister: assister?.id, flashAssist, weapon, headshot, zone: zoneOf(v), opening, trade,
      how: { preAimed: k.preAimed, victimBlind: v.blindUntil > t, victimMoving, killerHolding: !k.moving && (k.task === 'hold' || k.task === 'postplant' || k.task === 'wait'), distance: Math.round(dist(k.x, k.y, v.x, v.y)), crossfire, heard: t - k.heardAt[v.i]! < FOCUS_TIME },
    });
    k.lastKillT = t; k.lastVictimTeamOf = v.team;
    // Teammates nearby hear it and get the killer's position; the closest may go for the refrag.
    for (const m of matesOf(v)) {
      if (!m.alive) continue;
      const d = dist(m.x, m.y, v.x, v.y);
      const delay = d < 18 ? 0.15 + 0.45 * (1 - pairFam(v, m)) * (1.1 - s01(m.prof.communication)) : syn(m).calloutDelay;
      pendingInfo.push({ to: m.i, e: k.i, x: k.x, y: k.y, seen: t, at: t + delay });
      if (d < 10 + 14 * pairFam(v, m)) m.tradeFor = { killer: k.i, until: t + 3 + 2 * pairFam(v, m), fam: pairFam(v, m) };
    }
    if (carrier === v) { carrier = null; bombDropped = [v.x, v.y]; bomb.dropT = Math.round(t * 100) / 100; bomb.dropAt = [v.x, v.y]; bomb.drops.push([bomb.dropT, v.x, v.y]); log(t, v.team, 'bomb', `Bomb dropped by ${v.p.handle}.`); }
    if (planter === v) { planter = null; plantStart = null; }
    if (defuser === v) { defuser = null; defuseStart = null; bomb.defuseStart = null; stopAttempt(t); }
    // Clutch: the first moment a team is down to one
    if (!clutch) {
      const tA = aliveCount(T), cA = aliveCount(CT);
      if (tA === 1 && cA >= 1) clutch = { playerId: T.find((x) => x.alive)!.id, team: tTeam, vs: cA };
      else if (cA === 1 && tA >= 1) clutch = { playerId: CT.find((x) => x.alive)!.id, team: ctTeam, vs: tA };
    }
  };

  // ------------------------------------------------------------------ shooting
  const visible = new Uint8Array(N * N); // 0 none, 1 clear, 2 partial (this step)
  const shoot = (a: Agent, t: number) => {
    const e = agents[a.target];
    if (!e || !e.alive) { a.target = -1; return; }
    const w = a.weapon;
    const d = dist(a.x, a.y, e.x, e.y);
    a.burst = t - a.lastShot < 0.35 ? a.burst + 1 : 0;
    a.lastShot = t;
    a.facing = angTo(a.x, a.y, e.x, e.y);
    const mates = aliveCount(matesOf(a)), foes = aliveCount(enemiesOf(a));
    const pressure = clamp((foes - mates) * 0.25 + (a.hp < 40 ? 0.3 : 0) + (mates === 1 && foes >= 2 ? 0.3 : 0), 0, 1);
    const p = hitChance(a.prof, w, {
      dist: d, shooterMoving: a.moving, targetMoving: e.moving, partial: visible[a.i * N + e.i] === 2, burstIndex: a.burst,
      blind: blindAmt(a, t), pressure, form: a.form, preAimed: a.preAimed, focused: t - a.heardAt[e.i]! < FOCUS_TIME,
    });
    const hit = rng.next() < p;
    let dmgDone = 0, hs = false, lethal = false;
    if (hit) {
      hs = rng.next() < headshotChance(a.prof, w, d);
      const roll = rng.next();
      const group: HitGroup = hs ? 'head' : roll < 0.55 ? 'chest' : roll < 0.75 ? 'stomach' : 'legs';
      const dm = shotDamage(w, group, d, e.armor, e.helmet);
      e.armor = Math.max(0, e.armor - dm.armor);
      dmgDone = Math.min(e.hp, dm.health);
      lethal = dm.health >= e.hp;
      applyDamage(a, e, dm.health, t, w.name, hs, false);
    }
    if (rec) shots.push({ t: Math.round(t * 100) / 100, from: a.id, to: e.id, hit, lethal, damage: dmgDone, headshot: hs, weapon: w.name });
    a.nextShot = t + w.cycle * (w.cls === 'sniper' ? 1 : 1 + 0.15 * rng.next());
    // The target knows where the shots come from.
    if (e.alive) {
      learn(e, a, a.x, a.y, t);
      if (e.target < 0 || !visible[e.i * N + e.target]) {
        const off = angDiff(e.facing, angTo(e.x, e.y, a.x, a.y));
        const c = e.contacts[a.i];
        if (!c || c.detectAt > t + 0.5) e.contacts[a.i] = { start: t, detectAt: t + 0.6 * detectionTime(e.prof, { offAngle: 0, dist: d, partial: false, expected: true, targetMoving: a.moving, form: e.form }) + acquireTime(e.prof, off, e.weapon.cls === 'sniper') * 0.6, expected: true, focus: false };
      }
    }
    // Gunfire is heard by everyone nearby.
    for (const o of enemiesOf(a)) if (o.alive && dist(o.x, o.y, a.x, a.y) < 32) learn(o, a, a.x + rng.normal(0, 1.2), a.y + rng.normal(0, 1.2), t);
  };

  // ------------------------------------------------------------------ brains
  const tCaller = () => T.find((a) => a.alive && a.role === 'igl') ?? T.find((a) => a.alive);
  const ctCaller = () => CT.find((a) => a.alive && a.role === 'igl') ?? CT.find((a) => a.alive);
  const knownNear = (a: Agent, t: number, maxAge: number, within: number) => {
    let best: { e: number; k: Known; d: number } | null = null;
    for (let e = 0; e < N; e++) {
      const k = a.known[e];
      if (!k || t - k.t > maxAge || !agents[e]!.alive || agents[e]!.team === a.team) continue;
      const d = dist(a.x, a.y, k.x, k.y);
      if (d < within && (!best || d < best.d)) best = { e, k, d };
    }
    return best;
  };
  const teamKnownIn = (team: Agent[], region: (x: number, y: number) => boolean, t: number, maxAge: number) => {
    const seen = new Set<number>();
    for (const m of team) {
      if (!m.alive) continue;
      for (let e = 0; e < N; e++) { const k = m.known[e]; if (k && t - k.t <= maxAge && agents[e]!.alive && agents[e]!.team !== m.team && region(k.x, k.y)) seen.add(e); }
    }
    return seen.size;
  };
  const siteZone = (s: 'A' | 'B') => (x: number, y: number) => zoneAt(geo, x, y) === s;

  let flashPlanned = false;
  let firstOnSite: number | null = null, lastOnSite: number | null = null, entryPeekT: number | null = null, flashPopT: number | null = null;
  const callExecute = (t: number, why: string) => {
    callT = t; tPhase = 'execute'; report.callT = Math.round(t * 10) / 10;
    log(t, tTeam, 'call', why);
    const spread = synergy[tTeam].executeSpread;
    const order: Record<Role, number> = { entry: 0, support: 0.7, igl: 1.1, lurker: 1.6, awp: 1.3 };
    for (const a of T) {
      if (!a.alive || a.task === 'save') continue;
      const sloppiness = (1 - s01(a.prof.decisions)) * 0.8;
      a.goT = t + order[a.role] + Math.abs(rng.normal(0, spread * 0.45 + sloppiness));
      a.task = a.role === 'lurker' && plan.t === 'default' && dist(a.x, a.y, siteRegion().center[0], siteRegion().center[1]) > 30 ? 'lurk' : 'wait';
    }
    // Utility: smokes cut off CT holds, flashes timed for the entry's peek, a molotov clears a corner.
    const entry = T.find((a) => a.alive && a.role === 'entry') ?? T.find((a) => a.alive)!;
    const ent = entryFor(entry);
    const holds = geo.ctHolds[site].map((id) => geo.regionById.get(id)!).filter((r) => r.id !== siteRegion().id);
    const throwers = T.filter((a) => a.alive && a.task !== 'save').sort((a, b) => b.prof.utility - a.prof.utility);
    let si = 0;
    for (const a of throwers) {
      if (si < 2 && a.nades.includes('smoke') && holds[si]) {
        const tgt = holds[si]!;
        const when = t - 0.4 + rng.normal(0, spread * 0.35);
        schedule.push({ at: Math.max(t, when), a: a.i, kind: 'smoke', cell: tgt.center, purpose: `Smoke ${tgt.name}` });
        si++;
      }
    }
    // Flash: pops when the entry should be peeking through the choke.
    const runTime = dist(entry.x, entry.y, ent.choke.center[0], ent.choke.center[1]) / (entry.weapon.speed);
    const flasher = throwers.find((a) => a !== entry && a.nades.includes('flash')) ?? throwers.find((a) => a.nades.includes('flash'));
    if (flasher) {
      // airTime(d) + SETTLE.flash, written out so the timing stays bit-for-bit as before.
      const flight = 0.85 + dist(flasher.x, flasher.y, siteRegion().center[0], siteRegion().center[1]) / 16;
      const wantPop = entry.goT + runTime - 0.2;
      const when = wantPop - flight + rng.normal(0, spread * 0.5);
      const mid: Cell = [Math.round((ent.choke.center[0] + siteRegion().center[0]) / 2), Math.round((ent.choke.center[1] + siteRegion().center[1]) / 2)];
      schedule.push({ at: Math.max(t, when), a: flasher.i, kind: 'flash', cell: mid, purpose: `Flash for ${entry.p.handle}` });
      flashPlanned = true;
    }
    const mollyBy = throwers.find((a) => a.nades.includes('molotov'));
    if (mollyBy) schedule.push({ at: t + 0.8 + Math.abs(rng.normal(0, spread * 0.4)), a: mollyBy.i, kind: 'molotov', cell: regionCell(siteRegion(), rng.int(0, 999)), purpose: `Molotov to clear ${siteRegion().name}` });
    const heBy = throwers.find((a) => a.nades.includes('he') && a !== mollyBy);
    if (heBy) schedule.push({ at: t + 1.2 + Math.abs(rng.normal(0, spread * 0.4)), a: heBy.i, kind: 'he', cell: (holds[0] ?? siteRegion()).center, purpose: 'HE into a common spot' });
  };
  const schedule: { at: number; a: number; kind: UtilityKind; cell: Cell; purpose: string }[] = [];

  let tDecideAt = plan.t === 'default' ? 38 + rng.next() * 16 : 999;
  let regroupAt: number | null = null;
  const tBrain = (t: number) => {
    const caller = tCaller();
    if (!caller) return;
    const tAlive = T.filter((a) => a.alive);
    if (tPhase === 'setup') {
      if (plan.t === 'execute') {
        const ready = tAlive.filter((a) => atGoal(a)).length;
        if (ready >= tAlive.length - 1 && t > 12 || t > 55) callExecute(t + 0.6 * (1.2 - s01(caller.prof.decisions)), `Execute ${site}: ${ready}/${tAlive.length} in position, go.`);
      } else if (plan.t === 'default') {
        // Picks or contact can speed up the call; the site goes where the CTs look thin.
        const myAlive = tAlive.length, theirAlive = aliveCount(CT);
        if (myAlive > theirAlive && t > 25) tDecideAt = Math.min(tDecideAt, t + 2);
        if (regroupAt !== null) {
          // Regrouping at the staging spots: hit once most are there, or when the clock says so.
          const ready = tAlive.filter((x) => x.task === 'stage' && atGoal(x)).length;
          if ((ready >= tAlive.length - 1 && t - regroupAt > 2) || t - regroupAt > 14 || t > ROUND_TIME - 30) callExecute(t + 0.6 * (1.2 - s01(caller.prof.decisions)), `${caller.p.handle}: ${ready}/${tAlive.length} set for ${site}, go.`);
        } else if (t >= tDecideAt) {
          const a = teamKnownIn(T, siteZone('A'), t, 25), b = teamKnownIn(T, siteZone('B'), t, 25);
          const read = s01(caller.prof.decisions);
          let pick = site;
          if (Math.abs(a - b) >= 1 && rng.chance(0.35 + 0.55 * read)) pick = a < b ? 'A' : 'B';
          if (pick !== site) { site = pick; report.site = site; report.siteLog.push({ t: Math.round(t * 10) / 10, site }); report.adapted = true; log(t, tTeam, 'adapt', `${caller.p.handle} reads ${other(site)} as heavy (${site === 'A' ? b : a} seen there) and calls ${site}.`); }
          for (const x of T) if (x.alive && x.task !== 'save') { x.task = 'stage'; const st = entryFor(x).staging; const hide = intel.staging(st.id, site); setGoal(x, hide[x.i % hide.length]!, true); x.watch = angTo(st.center[0], st.center[1], siteRegion().center[0], siteRegion().center[1]); }
          regroupAt = t;
          log(t, tTeam, 'call', `${caller.p.handle} calls ${site} after map control (${a} seen on A, ${b} on B). Regrouping.`);
        }
      }
    } else if (tPhase === 'execute' && !bomb.plantT) {
      // Adapt: the hit stalled (entry dead early, no trade, numbers down) → regroup and hit the other site if time allows.
      const lost = 5 - tAlive.length, lostCT = 5 - aliveCount(CT);
      if (!report.adapted && callT !== null && t - callT > 4 && t - callT < 16 && lost - lostCT >= 2 && t < 70 && tAlive.length >= 2) {
        const read = s01(caller.prof.decisions);
        if (rng.chance(0.3 + 0.6 * read)) {
          site = other(site); report.site = site; report.siteLog.push({ t: Math.round(t * 10) / 10, site }); report.adapted = true;
          log(t, tTeam, 'adapt', `Hit stalled (${lost} down for ${lostCT}). ${caller.p.handle} pulls the team out and swings to ${site}.`);
          for (const x of tAlive) { x.task = 'go'; x.goT = t + 1 + Math.abs(rng.normal(0, synergy[tTeam].executeSpread * 0.5)); setGoal(x, regionCell(entryFor(x).choke, x.i * 13)); }
        }
      }
      // Time pressure: go now.
      if (t > ROUND_TIME - 22) for (const x of tAlive) if (x.task === 'wait' || x.task === 'stage' || x.task === 'control') { x.task = 'go'; x.goT = t; }
    }
    // Bomb pickup
    if (!carrier && bombDropped && !bomb.plantT) {
      const bd = bombDropped;
      const fetcher = tAlive.filter((a) => a.task !== 'save').sort((a, b) => dist(a.x, a.y, bd[0], bd[1]) - dist(b.x, b.y, bd[0], bd[1]))[0];
      if (fetcher && fetcher.task !== 'fetch') { fetcher.task = 'fetch'; setGoal(fetcher, [Math.floor(bd[0]), Math.floor(bd[1])]); }
    }
    // Saves: hopeless rounds before the plant
    if (!bomb.plantT) {
      const cA = aliveCount(CT);
      for (const a of tAlive) {
        if (a.task === 'save') continue;
        const far = dist(a.x, a.y, siteRegion().center[0], siteRegion().center[1]) > 25;
        const hopeless = (tAlive.length === 1 && cA >= 3 && t > 50) || (t > ROUND_TIME - 12 && far);
        if (hopeless && rng.chance(0.08 + 0.5 * s01(a.prof.decisions) * DT * 5)) {
          a.task = 'save'; setGoal(a, intel.tSpawnCenter); log(t, tTeam, 'adapt', `${a.p.handle} saves the weapon.`);
        }
      }
    }
  };

  let rotateCalled: 'A' | 'B' | null = null;
  let rotateStrength = 0, rotateCooldown = 0;
  let retakeCalled = false;
  let savingDecided = false;
  const ctBrain = (t: number) => {
    const caller = ctCaller();
    if (!caller) return;
    const cAlive = CT.filter((a) => a.alive);
    // Aggressive players fall back after the opening seconds or first contact.
    for (const a of cAlive) if (a.task === 'push' && (t > 24 || a.target >= 0 && a.hp < 60)) { a.task = 'hold'; setGoal(a, a.holdCell); }
    if (!bomb.plantT) {
      for (const s of ['A', 'B'] as const) {
        if (rotateCalled === s || t < rotateCooldown) continue;
        const n = teamKnownIn(CT, siteZone(s), t, 5);
        const diedThere = kills.some((k) => k.killerTeam === tTeam && k.zone === s && t - k.t < 6);
        const bombSeen = carrier && CT.some((m) => m.alive && visible[m.i * N + carrier!.i]) && zoneAt(geo, carrier.x, carrier.y) === s;
        // A new call needs more evidence than the one already made.
        const strength = n + (diedThere ? 1 : 0) + (bombSeen ? 3 : 0);
        if ((n >= 2 || diedThere || bombSeen) && strength > rotateStrength) {
          rotateCalled = s; rotateStrength = strength; rotateCooldown = t + 6;
          report.rotationT = Math.round(t * 10) / 10;
          const delay = synergy[ctTeam].calloutDelay + (1 - s01(caller.prof.decisions)) * 1.5;
          let rotators = 0;
          const anchorsElsewhere = cAlive.filter((a) => ctZone.get(a.i) !== s);
          anchorsElsewhere.forEach((a, k) => {
            // Keep one anchor on the other site unless the call is a big one.
            if (k === 0 && ctZone.get(a.i) === other(s) && n < 4 && plan.ct !== 'retake') return;
            rotators++;
            a.task = 'rotate'; a.waitUntil = t + delay * (1.2 - 0.6 * s01(a.prof.awareness));
            ctZone.set(a.i, s);
            const r = plan.ct === 'retake' ? intel.retakeFrom[s] : geo.regionById.get(geo.ctHolds[s][k % geo.ctHolds[s].length]!)!;
            const spot = intel.holds(r.id, s)[k % 3] ?? { cell: r.center, watch: 0 };
            a.holdCell = spot.cell; a.watch = spot.watch;
          });
          report.rotators += rotators;
          log(t, ctTeam, 'call', `${caller.p.handle}: "${n >= 2 ? `${n} on ${s}` : diedThere ? `lost one on ${s}` : `bomb ${s}`}". ${rotators} rotate${rotators === 1 ? 's' : ''}.`);
        }
      }
    } else {
      const plantAt = bomb.plantAt!;
      const left = BOMB_TIME - (t - bomb.plantT);
      for (const a of cAlive) {
        if (a.task === 'defuse' || a.task === 'save') continue;
        const d = dist(a.x, a.y, plantAt[0], plantAt[1]);
        const need = d / a.weapon.speed + (a.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME) + 1.5;
        const tAlive = aliveCount(T);
        const hopeless = cAlive.length <= 2 && tAlive - cAlive.length >= 2;
        if (left < need || (hopeless && !savingDecided)) {
          savingDecided = true;
          if (left < need ? (rng.chance(0.3 + 0.6 * s01(a.prof.decisions)) || tAlive > 1) : rng.chance(0.25 + 0.6 * s01(caller.prof.decisions))) {
            for (const m of cAlive) if (m.task !== 'defuse') { m.task = 'save'; setGoal(m, intel.ctSpawnCenter); }
            log(t, ctTeam, 'adapt', left < need ? `${a.p.handle} can't make the defuse in time and saves.` : `${cAlive.length}v${tAlive} after the plant: ${caller.p.handle} calls the save.`);
            continue;
          }
        }
        if (!retakeCalled) {
          retakeCalled = true;
          log(t, ctTeam, 'call', `${caller.p.handle} calls the retake: ${cAlive.length} on ${aliveCount(T)}.`);
          for (const m of cAlive) if (m.task !== 'save') { m.task = 'gather'; m.waitUntil = t + 2 + 4 * (syn(m).overall / 100) * (m.prof.decisions / 100); setGoal(m, regionCell(intel.retakeFrom[site], m.i * 5)); }
        }
      }
      // Gathered (or out of time): go in together.
      const gathering = cAlive.filter((a) => a.task === 'gather');
      const together = gathering.filter((a) => atGoal(a)).length;
      for (const a of gathering) {
        if (t >= a.waitUntil || together >= Math.min(3, gathering.length) || left < 22) {
          a.task = 'retake'; setGoal(a, [Math.floor(plantAt[0]), Math.floor(plantAt[1])]);
          const pc: Cell = [Math.floor(plantAt[0]), Math.floor(plantAt[1])];
          if (a.nades.includes('flash')) schedule.push({ at: t + 0.2 + rng.next() * synergy[ctTeam].executeSpread * 0.5, a: a.i, kind: 'flash', cell: pc, purpose: 'Retake flash over the bomb' });
          if (a.nades.includes('smoke') && a.role === 'support') schedule.push({ at: t + 0.4, a: a.i, kind: 'smoke', cell: geo.regionById.get(pickEntry(site, mainEntryIdx).choke.id)!.center, purpose: 'Smoke off the T side' });
        }
      }
    }
  };

  // ------------------------------------------------------------------ individual decisions
  const smokeAsked = new Map<number, number>();
  const regionAt = (c: Cell) => geo.regions.find((r) => inRegion(geo, r, c[0] + 0.5, c[1] + 0.5))?.name ?? 'the map';
  const decide = (a: Agent, t: number) => {
    if (!a.alive) return;
    // Retreat: low HP or alone against several known enemies, if they read it.
    const near = knownNear(a, t, 3, 14);
    const foesNear = near ? enemiesOf(a).filter((e) => e.alive && a.known[e.i] && t - a.known[e.i]!.t < 3 && dist(a.x, a.y, a.known[e.i]!.x, a.known[e.i]!.y) < 16).length : 0;
    const matesNear = matesOf(a).filter((m) => m !== a && m.alive && dist(a.x, a.y, m.x, m.y) < 12).length;
    if (a.target < 0 && (a.task === 'hold' || a.task === 'postplant') && foesNear >= 2 && matesNear === 0 && rng.chance(0.05 + 0.3 * s01(a.prof.decisions))) {
      const back = a.side === 'CT' ? intel.ctSpawnCenter : intel.tSpawnCenter;
      const p = findPath(geo, cellOf(a), back);
      if (p && p.length > 8) { a.task = 'fallback'; setGoal(a, p[8]!); a.waitUntil = t + 6; log(t, a.team, 'fight', `${a.p.handle} falls back from ${foesNear} enemies.`); }
    }
    if (a.task === 'fallback' && t > a.waitUntil) { a.task = 'hold'; a.holdCell = cellOf(a); }
    // Refrag
    if (a.tradeFor && t < a.tradeFor.until && a.target < 0) {
      const k = a.known[a.tradeFor.killer];
      const killer = agents[a.tradeFor.killer]!;
      if (k && killer.alive && (a.side === 'T' || a.task !== 'hold' || rng.chance(0.3 * (1 - s01(a.prof.decisions)) + 0.1))) {
        const g: Cell = [Math.floor(k.x), Math.floor(k.y)];
        const moved = !a.goal || Math.abs(a.goal[0] - g[0]) + Math.abs(a.goal[1] - g[1]) > 4;
        if (moved && a.task !== 'plant' && a.task !== 'defuse' && a.task !== 'save') setGoal(a, g, false);
      }
    } else if (a.tradeFor && t >= a.tradeFor.until) a.tradeFor = null;

    switch (a.task) {
      case 'stage':
      case 'control':
        if (plan.t === 'execute' && atGoal(a)) a.task = 'wait';
        // About to cross a covered stretch: stop short, get a smoke on the angle (a seen enemy, or the
        // usual CT spot), cross once it blooms. Caution is capped so nobody waits all round.
        if (tPhase === 'setup' && !atGoal(a) && a.target < 0 && t >= a.pauseUntil && a.caution < 10) {
          const k = knownNear(a, t, 4, 40);
          const ahead = a.path[Math.min(a.path.length - 1, a.pathI + 5)];
          let angle: Cell | null = null, key = -1;
          if (k && ahead && intel.sight(ahead[0], ahead[1], Math.floor(k.k.x), Math.floor(k.k.y))) { angle = [Math.floor(k.k.x), Math.floor(k.k.y)]; key = k.e; }
          else if (a.cross && a.cross.i - a.pathI <= 4 && a.cross.i >= a.pathI) { angle = a.cross.angle; key = 100 + angle[1] * W + angle[0]; }
          if (angle && ahead && !smokeBlocks(ahead[0] + 0.5, ahead[1] + 0.5, angle[0] + 0.5, angle[1] + 0.5, t + 1.5)) {
            const asked = smokeAsked.get(key);
            if (asked === undefined || t - asked > 12) {
              const thrower = [a, ...matesOf(a).filter((m) => m.alive && m !== a && dist(m.x, m.y, a.x, a.y) < 20)].find((m) => m.nades.includes('smoke') && dist(m.x, m.y, angle![0], angle![1]) < 38);
              if (thrower && throwNade(thrower, 'smoke', angle, t, 'Smoke to cross')) {
                smokeAsked.set(key, t);
                log(t, a.team, 'util', `${thrower.p.handle} smokes off ${key < 100 ? 'a spotted CT' : `the usual angle on ${regionAt(angle)}`} so the team can cross.`);
              }
              const wait = thrower ? 1.5 + rng.next() * 1.5 : 1 + rng.next() * 2 * (1 - s01(a.prof.decisions));
              a.pauseUntil = t + wait; a.caution += wait;
            } else if (t - asked < 3) { const wait = 0.6; a.pauseUntil = t + wait; a.caution += wait; }
            else if (a.cross && key >= 100) a.cross = null; // smoke gone: cross anyway
          } else if (angle && key >= 100) a.cross = null; // already smoked
        }
        break;
      case 'wait':
      case 'lurk':
        if (callT !== null && t >= a.goT) {
          a.task = 'go';
          const ent = entryFor(a);
          setGoal(a, a.role === 'awp' ? regionCell(ent.choke, a.i * 11) : regionCell(siteRegion(), a.i * 17 + 5));
        } else if (a.task === 'lurk' && callT !== null) setGoal(a, regionCell(pickEntry(other(site), mainEntryIdx).choke, a.i), true);
        break;
      case 'go': {
        if (t < a.goT) break;
        if (!a.goal || (atGoal(a) && !inRegion(geo, siteRegion(), a.x, a.y) && a.role !== 'awp')) setGoal(a, a.role === 'awp' ? regionCell(entryFor(a).choke, a.i * 11) : regionCell(siteRegion(), a.i * 17 + 5));
        if (a === carrier && inRegion(geo, siteRegion(), a.x, a.y) && !bomb.plantT && plantStart === null) {
          const enemiesInView = enemiesOf(a).some((e) => e.alive && visible[a.i * N + e.i]);
          if (!enemiesInView || rng.chance(0.15)) { a.task = 'plant'; plantStart = t; planter = a; setGoal(a, null); }
        }
        if (a === carrier && atGoal(a) && !inRegion(geo, siteRegion(), a.x, a.y)) setGoal(a, regionCell(siteRegion(), a.i + 1));
        if (onSiteArea(a.x, a.y)) { firstOnSite ??= t; lastOnSite = t; }
        break;
      }
      case 'fetch':
        if (carrier || !bombDropped) { a.task = 'go'; a.goT = t; }
        else if (dist(a.x, a.y, bombDropped[0], bombDropped[1]) < 1.2) { carrier = a; bombDropped = null; bomb.pickups.push([Math.round(t * 10) / 10, a.id]); a.task = 'go'; a.goT = t; log(t, a.team, 'bomb', `${a.p.handle} picks up the bomb.`); }
        break;
      case 'postplant':
        if (atGoal(a) && a.watch === null) a.watch = angTo(a.x, a.y, intel.ctSpawnCenter[0], intel.ctSpawnCenter[1]);
        break;
      case 'hold':
        if (!a.goal && a.holdCell) setGoal(a, a.holdCell);
        // Poor decisions: chase a sound into the open instead of holding.
        if (near && a.target < 0 && rng.chance(0.004 * (1 - s01(a.prof.decisions)))) { setGoal(a, [Math.floor(near.k.x), Math.floor(near.k.y)]); a.task = 'push'; a.waitUntil = t + 4; }
        break;
      case 'push':
        if (a.waitUntil > 0 && t > a.waitUntil && plan.ct !== 'aggro') { a.task = 'hold'; setGoal(a, a.holdCell); }
        break;
      case 'rotate':
        if (t >= a.waitUntil) setGoal(a, a.holdCell);
        if (atGoal(a) && a.goal) a.task = 'hold';
        break;
      case 'retake':
        if (bomb.plantAt && dist(a.x, a.y, bomb.plantAt[0], bomb.plantAt[1]) < 1.6 && !defuser) {
          const threats = enemiesOf(a).some((e) => e.alive && a.known[e.i] && t - a.known[e.i]!.t < 2.5);
          const left = BOMB_TIME - (t - bomb.plantT!);
          const need = a.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
          const onFire = mollies.some((m) => t >= m.from && t <= m.until && dist(m.x, m.y, a.x, a.y) < MOLLY_R);
          if ((!threats || left < need + 2 || rng.chance(0.04)) && (!onFire || left < need + 1.5) && t >= a.waitUntil) {
            a.task = 'defuse'; defuser = a; defuseStart = t; bomb.defuseStart = Math.round(t * 10) / 10; bomb.defuser = a.id; bomb.attempts.push([bomb.defuseStart, null, a.id, a.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME]); setGoal(a, null); log(t, a.team, 'bomb', `${a.p.handle} starts the defuse${a.kit ? ' with a kit' : ' without a kit'}.`);
            // The defuse is audible: a T with a molotov nearby throws it on the bomb.
            const stopper = T.find((x) => x.alive && x.nades.includes('molotov') && dist(x.x, x.y, a.x, a.y) < 30);
            if (stopper && rng.chance(0.5 + 0.4 * s01(stopper.prof.decisions))) schedule.push({ at: t + 0.4 + rng.next() * 0.6, a: stopper.i, kind: 'molotov', cell: cellOf(a), purpose: 'Molotov on the defuse' });
          }
        }
        break;
      case 'save':
      case 'gather':
      case 'plant':
      case 'defuse':
      case 'trade':
        break;
    }
  };

  // ------------------------------------------------------------------ footsteps
  /** Walk (silent) or run (heard about 20 m away)? Walkers walk the last stretch to their spot. */
  const walksNow = (a: Agent, t: number): boolean => {
    const left = a.path.length - a.pathI;
    // No time to be quiet: a late clock for the Ts, a defuse to make, a teammate to trade.
    if (a.side === 'T' && bomb.plantT === null && t > ROUND_TIME - 25) return false;
    if (bomb.plantT !== null && BOMB_TIME - (t - bomb.plantT) < 20) return false;
    if (a.tradeFor && t < a.tradeFor.until) return false;
    if (a.walk) return left < a.stretch;
    // A quiet team also walks into its CT spots and the last part of a rotation.
    return a.steps === 'quiet' && (a.task === 'hold' || a.task === 'push' || a.task === 'rotate') && left < a.stretch * 0.6;
  };
  const hearSteps = (a: Agent, e: Agent, t: number) => {
    if (t - a.heardAt[e.i]! >= FOCUS_TIME) {
      if (rec) heardLog.push([Math.round(t * 10) / 10, a.id, e.id]);
      // "One running B": the call reaches teammates after the team's usual callout delay.
      shareInfo(a, e, t, syn(a).calloutDelay);
    }
    a.heardAt[e.i] = t;
  };

  // ------------------------------------------------------------------ main loop
  let frame = 0;
  const record = (t: number) => {
    if (!rec || frame >= maxFrames) return;
    for (const a of agents) {
      const r = rec[a.i]!;
      r.xs[frame] = a.x; r.ys[frame] = a.y; r.aim[frame] = a.facing;
      let sp = 0;
      if (a.alive) for (const e of enemiesOf(a)) if (e.alive && visible[e.i * N + a.i] && angDiff(e.facing, angTo(e.x, e.y, a.x, a.y)) < FOV_HALF) { sp = 1; break; }
      r.spotted[frame] = sp;
      r.noise[frame] = !a.alive || !a.moving ? 0 : a.quiet ? 3 : 1;
    }
    void t;
    frame++;
  };

  let t = 0;
  record(0);
  const maxT = ROUND_TIME + BOMB_TIME + 2;
  while (!ended && t < maxT) {
    const tEnd = t + DT;
    // 1. grenades
    for (let si = schedule.length - 1; si >= 0; si--) {
      const s = schedule[si]!;
      if (s.at > tEnd) continue;
      schedule.splice(si, 1);
      const a = agents[s.a]!;
      if (a.alive && throwNade(a, s.kind, s.cell, Math.max(t, s.at), s.purpose)) log(s.at, a.team, 'util', `${a.p.handle}: ${s.purpose.toLowerCase()}.`);
    }
    for (const g of grenades) if (!g.popped && g.landT <= tEnd) {
      popGrenade(g, g.landT);
      if (g.kind === 'flash' && g.team === tTeam && flashPopT === null && flashPlanned) flashPopT = g.landT;
    }
    for (const m of mollies) if (t >= m.from && t <= m.until) for (const v of agents) if (v.alive && dist(v.x, v.y, m.x, m.y) < MOLLY_R) {
      const burned = applyDamage(agents[m.owner]!, v, Math.round(30 * DT + (rng.next() < 0.5 ? 1 : 0)), t, 'Molotov', false, true);
      // Fire stops a defuse unless the clock leaves no choice.
      if (v === defuser && v.alive && bomb.plantT !== null && BOMB_TIME - (t - bomb.plantT) > (v.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME) + 1.5) {
        defuser = null; defuseStart = null; bomb.defuseStart = null; stopAttempt(t); v.task = 'retake'; v.waitUntil = t + 1;
        log(t, v.team, 'bomb', `${v.p.handle} is burned off the defuse.`);
      }
      const ev = utility.find((u) => u.kind === 'molotov' && u.playerId === agents[m.owner]!.id && Math.abs(u.at[0] - m.x) < 1e-6);
      if (ev && burned > 0 && v.team !== agents[m.owner]!.team) { const vv = ev.victims.find((x) => x.id === v.id); if (vv) vv.damage += burned; else ev.victims.push({ id: v.id, damage: burned }); ev.damage += burned; }
    }
    // Reactive CT utility: Ts seen pushing into a site → molotov or HE the choke.
    for (const a of CT) if (a.alive && a.target < 0 && a.lastInfoT > t - 1.5 && a.nades.length && a.task !== 'save' && t > a.waitUntil) {
      const k = knownNear(a, t, 1.5, 28);
      if (k && rng.chance(0.05 + 0.1 * s01(a.prof.utility))) {
        // Delay the push: molotov or HE where they are, a smoke on the choke, or a flash to re-peek.
        const kind: UtilityKind = a.nades.includes('molotov') ? 'molotov' : a.nades.includes('he') ? 'he' : a.nades.includes('smoke') && k.d > 12 ? 'smoke' : 'flash';
        const label = kind === 'molotov' ? 'a molotov' : kind === 'he' ? 'an HE' : kind === 'smoke' ? 'a smoke' : 'a flash';
        // Lead the push: land it a little ahead of where they were heard or seen, on their way in.
        const lead = kind === 'molotov' || kind === 'he' ? clamp(0.35 - 2 / Math.max(4, k.d), 0, 0.3) : 0;
        let tx = Math.floor(k.k.x + (a.x - k.k.x) * lead), ty = Math.floor(k.k.y + (a.y - k.k.y) * lead);
        if (!isWalkable(geo, tx, ty)) { tx = Math.floor(k.k.x); ty = Math.floor(k.k.y); }
        if (a.nades.includes(kind) && throwNade(a, kind, [tx, ty], t, `${label} on the T push`)) { log(t, a.team, 'util', `${a.p.handle} throws ${label} at the T push.`); a.waitUntil = t + 2.5; }
      }
    }
    // Ts take map control with a grenade into the nearest CT spot they know or expect.
    if (Math.round(t * 10) % 10 === 0 && t > 8 && t < 60) for (const a of T) {
      if (!a.alive || a.target >= 0 || a.task !== 'stage' && a.task !== 'wait' || !atGoal(a) || a.waitUntil > t || !(a.nades.includes('molotov') || a.nades.includes('he') || a.nades.length > 2)) continue;
      a.waitUntil = t + 6;
      if (!rng.chance(0.25 + 0.3 * s01(a.prof.utility))) continue;
      const k = knownNear(a, t, 8, 30);
      const holds = (plan.t === 'default' ? geo.ctHolds.Mid : geo.ctHolds[site]).map((id) => geo.regionById.get(id)!);
      const near = holds.map((r) => ({ r, d: dist(a.x, a.y, r.center[0], r.center[1]) })).filter((x) => x.d < 30).sort((x, y) => x.d - y.d)[0];
      const cell: Cell | null = k ? [Math.floor(k.k.x), Math.floor(k.k.y)] : near ? near.r.center : null;
      if (!cell) continue;
      const kind: UtilityKind = a.nades.includes('molotov') ? 'molotov' : a.nades.includes('he') ? 'he' : 'flash';
      if (throwNade(a, kind, cell, t, `${kind === 'molotov' ? 'Molotov' : kind === 'he' ? 'HE' : 'Flash'} for map control`)) log(t, a.team, 'util', `${a.p.handle} uses ${kind === 'molotov' ? 'a molotov' : kind === 'he' ? 'an HE' : 'a flash'} to take space${near && !k ? ` toward ${near.r.name}` : ''}.`);
    }
    // Callouts arrive
    for (let k = pendingInfo.length - 1; k >= 0; k--) {
      const inf = pendingInfo[k]!;
      if (inf.at <= tEnd) { const m = agents[inf.to]!; if (m.alive) learn(m, inf.e, inf.x, inf.y, inf.seen); pendingInfo.splice(k, 1); }
    }
    // 2. brains (twice a second)
    if (Math.round(t * 10) % 5 === 0) { tBrain(t); ctBrain(t); }
    // 3. decisions (staggered, ~3 per second each)
    for (const a of agents) if (a.alive && (Math.round(t * 10) + a.i) % 3 === 0) decide(a, t);

    // 4. movement
    for (const a of agents) {
      a.moving = false;
      if (!a.alive || a.task === 'plant' || a.task === 'defuse') continue;
      if (a.target >= 0 && visible[a.i * N + a.target]) continue; // stop and shoot
      if ((a.task === 'wait' || a.task === 'lurk') && atGoal(a) && t < a.goT) continue;
      if (a.task === 'rotate' && t < a.waitUntil) continue;
      if ((a.task === 'stage' || a.task === 'control') && t < a.pauseUntil) continue;
      if (a.task === 'go' && t < a.goT) continue;
      if (!a.goal || a.pathI >= a.path.length) continue;
      const next = a.path[a.pathI]!;
      // Don't walk into a burning molotov unless the clock forces it.
      let burning = false;
      for (const m of mollies) if (t >= m.from && t <= m.until && dist(next[0] + 0.5, next[1] + 0.5, m.x, m.y) < MOLLY_R + 0.3) burning = true;
      if (burning && t < ROUND_TIME - 20 && !(bomb.plantT && a.side === 'CT' && BOMB_TIME - (t - bomb.plantT) < 14)) continue;
      // Walkers only slow down for the last stretch near their spot; the rest of the way they run.
      a.quiet = walksNow(a, t);
      const speed = a.weapon.speed * (a.quiet ? WALK : 1) * (a.hp < 30 ? 0.95 : 1);
      let step = speed * DT;
      while (step > 0 && a.pathI < a.path.length) {
        const c = a.path[a.pathI]!;
        const tx = c[0] + 0.5, ty = c[1] + 0.5;
        const d = dist(a.x, a.y, tx, ty);
        if (d > 1e-6) a.facing = angTo(a.x, a.y, tx, ty);
        if (d <= step) { a.x = tx; a.y = ty; step -= d; a.pathI++; }
        else { a.x += ((tx - a.x) / d) * step; a.y += ((ty - a.y) / d) * step; step = 0; }
      }
      a.moving = true;
    }
    // Facing when not fighting: toward known enemies, the held angle, or the path.
    for (const a of agents) {
      if (!a.alive || a.target >= 0) continue;
      // A runner heard coming takes priority: turn toward where the steps are.
      let focus: Known | null = null, fd = Infinity;
      for (let e = 0; e < N; e++) {
        const k = a.known[e];
        if (!k || t - a.heardAt[e]! >= FOCUS_TIME || !agents[e]!.alive) continue;
        const d = dist(a.x, a.y, k.x, k.y);
        // Close enough to matter, and not straight off the angle they hold.
        if (d > 30 || (!a.moving && a.watch !== null && angDiff(a.watch, angTo(a.x, a.y, k.x, k.y)) > 1.0)) continue;
        if (d < fd) { fd = d; focus = k; }
      }
      const k = focus ? null : a.lastInfoT > t - 4 ? knownNear(a, t, 4, 30) : null;
      if (focus) a.facing = angTo(a.x, a.y, focus.x, focus.y);
      else if (k) a.facing = angTo(a.x, a.y, k.k.x, k.k.y);
      else if (!a.moving && a.watch !== null && (a.task === 'hold' || a.task === 'push' || a.task === 'postplant' || a.task === 'gather' || a.task === 'rotate' || a.task === 'stage' || a.task === 'wait')) a.facing = a.watch;
      else if (a.task === 'defuse' || a.task === 'plant') { /* keep */ }
    }

    // 5a. hearing: running footsteps carry through walls (about 20 m), a rushing group further.
    // Walking is silent. A runner heard gets focused.
    if (Math.round(t * 10) % 3 === 0) {
      for (const e of agents) {
        if (!e.alive || !e.moving || e.quiet) continue;
        let loud = 0;
        for (const m of matesOf(e)) if (m.alive && m.moving && !m.quiet && dist(m.x, m.y, e.x, e.y) < 6) loud++;
        const R = HEAR_STEPS + Math.min(3, loud) * 2;
        const err = 2.5;
        for (const a of enemiesOf(e)) if (a.alive && dist(a.x, a.y, e.x, e.y) < R) {
          learn(a, e, e.x + rng.normal(0, err), e.y + rng.normal(0, err), t);
          hearSteps(a, e, t);
        }
      }
    }
    // 5. sight and detection
    visible.fill(0);
    for (const a of agents) {
      if (!a.alive) continue;
      const ac = cellOf(a);
      for (const e of enemiesOf(a)) {
        if (!e.alive) { a.contacts[e.i] = null; continue; }
        const d = dist(a.x, a.y, e.x, e.y);
        if (d > SIGHT_MAX) { a.contacts[e.i] = null; continue; }
        const ec = cellOf(e);
        const s = intel.sight(ac[0], ac[1], ec[0], ec[1]);
        if (s === 0 || smokeBlocks(a.x, a.y, e.x, e.y, t)) { if (a.contacts[e.i] && a.target !== e.i) a.contacts[e.i] = null; continue; }
        visible[a.i * N + e.i] = s;
        const off = angDiff(a.facing, angTo(a.x, a.y, e.x, e.y));
        // Footsteps: running enemies close by are heard even out of view.
        if (off > FOV_HALF) {
          if (e.moving && !e.quiet && d < HEAR_STEPS) { learn(a, e, e.x + rng.normal(0, 1.5), e.y + rng.normal(0, 1.5), t); hearSteps(a, e, t); }
          continue;
        }
        if (t < a.blindUntil && blindAmt(a, t) > 0.5) continue;
        if (!a.contacts[e.i]) {
          const k = a.known[e.i];
          // Heard them running in: the crosshair is already where the steps were coming from.
          const focus = t - a.heardAt[e.i]! < FOCUS_TIME && !!k && angDiff(angTo(a.x, a.y, k.x, k.y), angTo(a.x, a.y, e.x, e.y)) < 0.45;
          const expected = focus || (!!k && t - k.t < 4 && dist(k.x, k.y, e.x, e.y) < 8) || (!a.moving && a.watch !== null && angDiff(a.watch, angTo(a.x, a.y, e.x, e.y)) < 0.3) || (a.tradeFor?.killer === e.i);
          // A teammate already fighting this enemy close by calls it: swing together.
          // A familiar pair swings together and refrags on the spot their teammate called.
          let support = 1;
          for (const m of matesOf(a)) if (m !== a && m.alive && m.target === e.i && dist(m.x, m.y, a.x, a.y) < 18) { support = Math.min(support, 1 - 0.45 * pairFam(a, m)); }
          if (a.tradeFor?.killer === e.i) support = Math.min(support, 1 - 0.35 * a.tradeFor.fam);
          // Peeker's advantage: a stationary player sees a moving peeker a little late.
          const peek = e.moving && !a.moving ? 0.05 : 0;
          // Entry skill: first in on a hit or an aggressive push, good entries clear angles faster.
          const entryF = a.task === 'go' || a.task === 'push' ? 1.06 - 0.14 * s01(a.prof.entrying) : 1;
          // Comms: a team that talks well tells each other where to look (bounded, about ±10%).
          const comms = 1 - 0.1 * coord(a);
          const pace = focus ? 0.9 : 1;
          a.contacts[e.i] = { start: t, detectAt: t + peek + detectionTime(a.prof, { offAngle: off, dist: d, partial: s === 2, expected, targetMoving: e.moving, form: a.form }) * (1 - input.edge[a.team] * 0.3) * support * entryF * comms * pace, expected, focus };
        }
        const c = a.contacts[e.i]!;
        if (c.detectAt <= tEnd) {
          learn(a, e, e.x, e.y, t);
          if (c.detectAt > t - DT * 1.5) shareInfo(a, e, t, syn(a).calloutDelay);
          // Engage: take the fight unless saving, or switch to someone who is shooting at us.
          const current = a.target >= 0 ? agents[a.target]! : null;
          const switchTo = !current || !current.alive || !visible[a.i * N + current.i] || (current.target !== a.i && e.target === a.i && rng.chance(0.3 + 0.4 * s01(a.prof.decisions)));
          const saving = a.task === 'save' && d > 10 && e.target !== a.i;
          if (switchTo && !saving && current !== e) {
            a.target = e.i;
            // Per-map side calibration (MapSource.sideTune): how readily each side has an angle pre-aimed, and reaction time.
            const tune = a.side === 'CT' ? geo.sideTune : 1 / geo.sideTune;
            a.preAimed = c.expected && off < (c.focus ? 0.4 : 0.3) / (tune * tune);
            const stop = a.moving ? 0.04 + 0.12 * (1 - s01(a.prof.movement)) : 0;
            a.nextShot = Math.max(c.detectAt, t) + acquireTime(a.prof, a.preAimed ? Math.min(off, 0.08) : off, a.weapon.cls === 'sniper') * tune + stop;
            a.lostSince = null;
            if (a.side === 'T' && entryPeekT === null && callT !== null && t >= callT) entryPeekT = t;
          }
        }
      }
    }
    // Lose targets that went out of sight
    for (const a of agents) {
      if (!a.alive || a.target < 0) continue;
      const e = agents[a.target]!;
      if (!e.alive) { a.target = -1; continue; }
      if (!visible[a.i * N + e.i]) { a.lostSince ??= t; if (t - a.lostSince > 0.8) { a.target = -1; learn(a, e, e.x, e.y, t - 0.8); } }
      else a.lostSince = null;
    }

    // 6. shots in time order
    for (;;) {
      let best: Agent | null = null;
      for (const a of agents) if (a.alive && a.target >= 0 && visible[a.i * N + a.target] && a.nextShot < tEnd && (!best || a.nextShot < best.nextShot)) best = a;
      if (!best) break;
      const when = Math.max(t, best.nextShot);
      if (best.task === 'plant' || best.task === 'defuse') { best.nextShot = tEnd + 0.01; continue; }
      shoot(best, when);
      if (aliveCount(T) === 0 || aliveCount(CT) === 0) break;
    }

    // 7. bomb
    if (planter && plantStart !== null && planter.alive && tEnd - plantStart >= PLANT_TIME) {
      bomb.plantT = Math.round((plantStart + PLANT_TIME) * 10) / 10;
      bomb.plantAt = [planter.x, planter.y];
      bomb.carrier = bomb.carrier ?? planter.id;
      tPhase = 'postplant';
      log(bomb.plantT, tTeam, 'bomb', `${planter.p.handle} plants on ${site} with ${aliveCount(T)} alive against ${aliveCount(CT)}.`);
      carrier = null;
      const plantedAgent = planter;
      plantedBy = planter.id;
      planter = null; plantStart = null;
      // Post-plant spots: cover around the bomb with sight of it.
      const bx = Math.floor(bomb.plantAt[0]), by = Math.floor(bomb.plantAt[1]);
      const cands = [...siteRegion().cells, ...geo.ctHolds[site].flatMap((id) => geo.regionById.get(id)!.cells)].filter((_c, k) => k % 3 === 0);
      for (const a of T) {
        if (!a.alive || a.task === 'save') continue;
        a.task = 'postplant'; a.watch = null;
        let bestC: Cell | null = null, bs = -Infinity;
        for (let k = 0; k < 24 && cands.length; k++) {
          const c = cands[(a.i * 37 + k * 11) % cands.length]!;
          const d = dist(c[0], c[1], bx, by);
          const sc = (intel.sight(c[0], c[1], bx, by) ? 3 : 0) - Math.abs(d - 9) * 0.25 + rng.next();
          if (sc > bs) { bs = sc; bestC = c; }
        }
        setGoal(a, a === plantedAgent ? [bx, by] : bestC);
      }
    } else if (planter && (!planter.alive || planter.task !== 'plant')) { planter = null; plantStart = null; }
    if (defuser && defuseStart !== null) {
      if (!defuser.alive) { defuser = null; defuseStart = null; }
      else if (tEnd - defuseStart >= (defuser.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME)) {
        bomb.defuseEnd = Math.round((defuseStart + (defuser.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME)) * 10) / 10;
        log(bomb.defuseEnd, ctTeam, 'bomb', `${defuser.p.handle} defuses.`);
        ended = { winner: 'CT', reason: 'defuse', t: bomb.defuseEnd };
      }
    }
    if (!ended && bomb.plantT !== null && tEnd >= bomb.plantT + BOMB_TIME) { bomb.exploded = true; ended = { winner: 'T', reason: 'bomb', t: bomb.plantT + BOMB_TIME }; }

    // 8. round end
    if (!ended) {
      const tA = aliveCount(T), cA = aliveCount(CT);
      const lastKill = kills.length ? kills[kills.length - 1]!.t : t;
      if (cA === 0) ended = { winner: 'T', reason: 'elimination', t: lastKill };
      else if (tA === 0 && bomb.plantT === null) ended = { winner: 'CT', reason: 'elimination', t: lastKill };
      else if (bomb.plantT === null && tEnd >= ROUND_TIME) ended = { winner: 'CT', reason: 'time', t: ROUND_TIME };
      else if (tA === 0 && bomb.plantT !== null) {
        // All Ts dead after the plant: the closest CT goes to defuse.
        for (const a of CT) if (a.alive && a.task !== 'defuse' && a.task !== 'retake') { a.task = 'retake'; setGoal(a, [Math.floor(bomb.plantAt![0]), Math.floor(bomb.plantAt![1])]); }
      }
    }
    // Record HP for the last moment
    t = tEnd;
    record(t);
  }
  if (!ended) ended = { winner: 'CT', reason: 'time', t: ROUND_TIME };

  // ------------------------------------------------------------------ report
  if (callT !== null && firstOnSite !== null) report.entrySpread = Math.round(((lastOnSite ?? firstOnSite) - firstOnSite) * 10) / 10;
  if (flashPopT !== null && entryPeekT !== null) report.flashLead = Math.round((flashPopT - entryPeekT) * 10) / 10;
  if (callT !== null && firstOnSite !== null) {
    const sr = siteRegion();
    const ctOnSiteAt = (tt: number) => CT.some((c) => (c.deathT === null || c.deathT > tt) && inRegion(geo, sr, c.x, c.y));
    if (!ctOnSiteAt(ended.t)) report.siteTakenT = Math.round((Math.max(firstOnSite, ...CT.filter((c) => c.deathT !== null).map((c) => c.deathT!)) - callT) * 10) / 10;
  }
  if (callT !== null) {
    const flashScore = report.flashLead === null ? (report.flashesThrown ? 40 : 20) : clamp(100 - Math.abs(report.flashLead + 0.3) * 45, 0, 100);
    const smokeScore = Math.min(100, report.smokesLanded * 45);
    const spreadScore = report.entrySpread === null ? 40 : clamp(100 - Math.max(0, report.entrySpread - 1.5) * 18, 0, 100);
    const tradeScore = clamp(50 + (report.tradesT - report.tradesCT) * 20, 0, 100);
    report.executeScore = Math.round(0.25 * flashScore + 0.2 * smokeScore + 0.3 * spreadScore + 0.25 * tradeScore);
  }
  const tWon = ended.winner === 'T';
  const reasons: string[] = [];
  if (report.openingTeam !== null) reasons.push(report.openingTeam === tTeam ? 'Ts won the opening duel' : 'CTs won the opening duel');
  if (report.flashLead !== null) reasons.push(report.flashLead < -1.6 ? `the entry flash popped ${(-report.flashLead).toFixed(1)}s early` : report.flashLead > 0.6 ? `the entry peeked ${report.flashLead.toFixed(1)}s before the flash` : 'the entry flash was well timed');
  if (report.entrySpread !== null && report.entrySpread > 4) reasons.push(`Ts arrived ${report.entrySpread.toFixed(1)}s apart`);
  if (report.tradesT + report.tradesCT > 0) reasons.push(`trades ${report.tradesT}-${report.tradesCT} (T-CT)`);
  if (report.rotationT !== null && report.rotators > 0) reasons.push(`${report.rotators} CT${report.rotators > 1 ? 's' : ''} rotated at ${Math.round(report.rotationT)}s`);
  if (report.adapted) reasons.push(`Ts switched to ${site}`);
  const how = ended.reason === 'bomb' ? 'the bomb exploded' : ended.reason === 'defuse' ? 'CTs defused' : ended.reason === 'time' ? 'Ts ran out of time' : tWon ? 'CTs were eliminated' : 'Ts were eliminated';
  report.verdict = `${tWon ? 'T' : 'CT'} round: ${how}${reasons.length ? ` — ${reasons.slice(0, 3).join(', ')}` : ''}.`;

  const survivors = agents.filter((a) => a.alive).map((a) => a.id);
  const out: RoundSimOutput = {
    winnerSide: ended.winner, reason: ended.reason, kills, hits, utility,
    planted: bomb.plantT !== null, plantTime: bomb.plantT ?? undefined,
    planterId: plantedBy,
    defuserId: ended.reason === 'defuse' ? bomb.defuser ?? undefined : undefined,
    site, endTime: Math.ceil(ended.t * 10 - 1e-9) / 10, survivors, clutch, report, damage,
  };
  if (rec) {
    const frames = Math.min(frame, maxFrames);
    out.replay = {
      dt: DT, frames,
      tracks: agents.map((a) => ({
        id: a.id, xs: rec[a.i]!.xs.slice(0, frames), ys: rec[a.i]!.ys.slice(0, frames), aim: rec[a.i]!.aim.slice(0, frames), spotted: rec[a.i]!.spotted.slice(0, frames), noise: rec[a.i]!.noise.slice(0, frames),
        deathT: a.deathT, hp: a.hpLog, weapons: a.weaponLog, armor: a.armor > 0 || (input.loadouts.get(a.id)?.armor ?? false), helmet: a.helmet, kit: a.kit, blinded: a.blinded,
      })),
      shots, bomb: { ...bomb, carrier: bombCarrierPick.id }, heard: heardLog,
      planter: plantedBy,
    };
  }
  return out;
}
