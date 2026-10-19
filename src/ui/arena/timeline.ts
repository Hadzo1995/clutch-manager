/**
 * Round timeline: turns one engine RoundResult into everything a viewer needs
 * to draw the round at any moment — where each player stands, their HP, who is
 * shooting whom, where utility lands, what the bomb is doing and the clock.
 *
 * The round simulation (engine/sim/round.ts) records positions, aim, sight,
 * every shot, HP, grenades and the bomb at 10 Hz while it plays the round.
 * This module only converts that recording into the shape the renderers and
 * HUD read. Nothing here is invented: every position, shot and HP value on
 * screen is what the simulation did.
 */
import type { RoundResult, Side, TeamIdx, UtilityKind } from '../../engine/match';
import type { MatchPlayer, TeamSnapshot } from '../../engine/team';
import { CELL, HEIGHT_UNIT } from '../../maps/types';
import { planLob, type FlightSpec } from '../../engine/sim/flight';
import type { MapGeometry } from '../../maps/types';

export type Vec = [number, number];

/** Round clock (approximation of a competitive round: 1:55 to play, 40 s bomb). */
export const ROUND_SECONDS = 115;
export const BOMB_SECONDS = 40;
export const PLANT_SECONDS = 3.2;
export const SMOKE_SECONDS = 18;
export const MOLOTOV_SECONDS = 7;
export const FLASH_BLIND_SECONDS = 2.2;
/** Metres → cells. */
const M = 1 / CELL;
/** Vision: field of view, how far players notice enemies, how far the drawn cone reaches. */
export const FOV = (100 * Math.PI) / 180;
export const SIGHT_RANGE = 55 * M;
export const CONE_RANGE = 26 * M;
/** Aim and spotting are sampled at this rate. */
export const VISION_HZ = 10;

export interface Waypoint { t: number; x: number; y: number }

export interface PlayerTrack {
  id: string;
  handle: string;
  role: MatchPlayer['role'];
  team: TeamIdx;
  side: Side;
  /** Dense path samples; position between samples is linear. */
  path: Waypoint[];
  deathT: number | null;
  /** HP changes in time order: [t, hpAfter]. Starts at 100. */
  hp: [number, number][];
  /** Weapon in hand over time: [fromT, name]. */
  weapons: [number, string][];
  armor: boolean;
  helmet: boolean;
  kit: boolean;
  /** Seconds when the player was blinded, for the flash overlay. */
  blinded: number[];
  /** Where the player looks (radians in map space, atan2(dy, dx)), sampled at VISION_HZ. */
  aim: Float32Array;
  /** 1 while at least one living enemy has this player in sight (inside their view cone), at VISION_HZ. */
  spotted: Uint8Array;
  /** Footsteps at VISION_HZ: 0 still, 1 running (heard), 3 walking (silent). Missing on older replays. */
  noise?: Uint8Array;
}

/** How far running footsteps carry, in metres (cells). Walking is silent. */
export const HEAR_RUN = 20;
/** Radius of the small pace ring drawn around a walking player (display only). */
export const WALK_RING = 4;

/** Someone heard an enemy running in and turned on them. */
export interface HeardEvent { t: number; listener: string; source: string }

export interface Shot { t: number; from: string; to: string; hit: boolean; lethal: boolean; damage: number; headshot: boolean; weapon: string; /** Fired in a fight the engine didn't decide (always a miss). */ extra?: boolean }

export interface UtilityObject {
  kind: UtilityKind;
  team: TeamIdx;
  side: Side;
  playerId: string;
  throwT: number;
  t: number; // lands / pops
  from: Vec;
  at: Vec;
  /** Effect lifetime after landing (0 for flash and HE). */
  duration: number;
  radius: number; // cells
  victims: { id: string; damage: number }[];
  flashed: string[];
  /** The simulated flight (shared with the engine), for drawing the grenade and its trail. */
  flight: FlightSpec;
}

export interface BombState {
  carrier: string | null;
  /** Who held the bomb from when (pickups), and where it was dropped. */
  pickups: [number, string][];
  drops: [number, number, number][];
  plantT: number | null;
  plantAt: Vec | null;
  defuseStart: number | null;
  defuseEnd: number | null;
  /** Every defuse attempt: start, cut short at (null if it finished), defuser id, seconds needed. */
  attempts: [number, number | null, string, number][];
  exploded: boolean;
  /** Where a dropped bomb lies if the carrier died before a plant. */
  dropT: number | null;
  dropAt: Vec | null;
}

export interface FeedItem {
  t: number;
  kind: 'kill' | 'plant' | 'defuse' | 'explode' | 'end';
  killerId?: string;
  victimId?: string;
  assisterId?: string;
  weapon?: string;
  headshot?: boolean;
  text?: string;
}

export interface RoundTimeline {
  geo: MapGeometry;
  round: RoundResult;
  duration: number;
  players: PlayerTrack[];
  byId: Map<string, PlayerTrack>;
  shots: Shot[];
  utility: UtilityObject[];
  bomb: BombState;
  feed: FeedItem[];
  heard: HeardEvent[];
}

// ---------------------------------------------------------------------------
// Sampling helpers (used by renderers and the HUD)

export function posAt(track: PlayerTrack, t: number): Vec {
  const p = track.path;
  const tt = track.deathT !== null ? Math.min(t, track.deathT) : t;
  if (tt <= p[0]!.t) return [p[0]!.x, p[0]!.y];
  let lo = 0, hi = p.length - 1;
  if (tt >= p[hi]!.t) return [p[hi]!.x, p[hi]!.y];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m]!.t <= tt) lo = m; else hi = m; }
  const a = p[lo]!, b = p[hi]!;
  const f = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 1;
  return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
}

/** Facing in radians: the sampled aim, interpolated along the shorter turn. */
export function headingAt(_tl: RoundTimeline, track: PlayerTrack, t: number): number {
  return aimAt(track, t);
}

export function aimAt(track: PlayerTrack, t: number): number {
  const a = track.aim;
  if (!a.length) return 0;
  const tt = track.deathT !== null ? Math.min(t, track.deathT) : t;
  const f = Math.max(0, Math.min(a.length - 1, tt * VISION_HZ));
  const i = Math.floor(f), j = Math.min(a.length - 1, i + 1), k = f - i;
  let d = a[j]! - a[i]!;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a[i]! + d * k;
}

export function isSpotted(track: PlayerTrack, t: number): boolean {
  const i = Math.round(t * VISION_HZ);
  return i >= 0 && i < track.spotted.length && track.spotted[i] === 1;
}

/** Pace right now: still, walking (silent) or running (heard). Older replays: running whenever moving. */
export function paceAt(track: PlayerTrack, t: number): 'still' | 'walk' | 'run' {
  if (track.deathT !== null && t >= track.deathT) return 'still';
  if (!track.noise) return isMoving(track, t) ? 'run' : 'still';
  const v = track.noise[Math.round(t * VISION_HZ)] ?? 0;
  return v === 1 || v === 2 ? 'run' : v === 3 ? 'walk' : 'still';
}

export function hpAt(track: PlayerTrack, t: number): number {
  if (track.deathT !== null && t >= track.deathT) return 0;
  let hp = 100;
  for (const [ht, v] of track.hp) { if (ht <= t) hp = v; else break; }
  return hp;
}

export function weaponAt(track: PlayerTrack, t: number): string {
  let w = track.weapons[0]![1];
  for (const [wt, name] of track.weapons) { if (wt <= t) w = name; else break; }
  return w;
}

export function isMoving(track: PlayerTrack, t: number): boolean {
  if (track.deathT !== null && t >= track.deathT) return false;
  const a = posAt(track, t - 0.1), b = posAt(track, t + 0.1);
  return Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.04;
}

export function blindAmount(track: PlayerTrack, t: number): number {
  let v = 0;
  for (const b of track.blinded) if (t >= b && t < b + FLASH_BLIND_SECONDS) v = Math.max(v, 1 - (t - b) / FLASH_BLIND_SECONDS);
  return v;
}

export interface ClockState { label: string; seconds: number; phase: 'live' | 'bomb' | 'over' }

export function clockAt(tl: RoundTimeline, t: number): ClockState {
  const end = tl.round.endTime;
  const fmt = (s: number) => { const v = Math.max(0, Math.ceil(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
  if (t >= end) {
    const s = tl.bomb.plantT !== null ? BOMB_SECONDS - (end - tl.bomb.plantT) : ROUND_SECONDS - end;
    return { label: fmt(s), seconds: Math.max(0, s), phase: 'over' };
  }
  if (tl.bomb.plantT !== null && t >= tl.bomb.plantT) { const s = BOMB_SECONDS - (t - tl.bomb.plantT); return { label: fmt(s), seconds: s, phase: 'bomb' }; }
  return { label: fmt(ROUND_SECONDS - t), seconds: ROUND_SECONDS - t, phase: 'live' };
}

/** Alive players per team index at time t. */
export function aliveCount(tl: RoundTimeline, team: TeamIdx, t: number): number {
  return tl.players.filter((p) => p.team === team && (p.deathT === null || p.deathT > t)).length;
}

/**
 * The round's clutch, if any: the moment a team was down to one player
 * against two or more, who that player was and how many they faced.
 */
export function clutchOf(tl: RoundTimeline, team: TeamIdx): { id: string; vs: number; t: number } | null {
  const deaths = tl.players.filter((p) => p.deathT !== null).map((p) => p.deathT!).sort((a, b) => a - b);
  for (const t of deaths) {
    const mine = aliveCount(tl, team, t), theirs = aliveCount(tl, team === 0 ? 1 : 0, t);
    if (mine === 1 && theirs >= 2) {
      const p = tl.players.find((q) => q.team === team && (q.deathT === null || q.deathT > t))!;
      return { id: p.id, vs: theirs, t };
    }
    if (mine === 0) return null;
  }
  return null;
}

/** Where the bomb is at time t, and in whose hands (while defusing, `carrier` is the defuser). */
export function bombAt(tl: RoundTimeline, t: number): { at: Vec | null; state: 'carried' | 'dropped' | 'planted' | 'defusing' | 'defused' | 'exploded' | 'none'; carrier: string | null; progress: number } {
  const b = tl.bomb;
  if (b.plantT !== null && b.plantAt && t >= b.plantT) {
    if (b.defuseEnd !== null && t >= b.defuseEnd) return { at: b.plantAt, state: 'defused', carrier: null, progress: 1 };
    if (b.exploded && t >= b.plantT + BOMB_SECONDS) return { at: b.plantAt, state: 'exploded', carrier: null, progress: 1 };
    for (const [start, stop, by, need] of b.attempts) {
      if (t < start || t >= (stop ?? start + need)) continue;
      return { at: b.plantAt, state: 'defusing', carrier: by, progress: Math.min(1, (t - start) / need) };
    }
    return { at: b.plantAt, state: 'planted', carrier: null, progress: (t - b.plantT) / BOMB_SECONDS };
  }
  // Before the plant: the latest pickup or drop decides where it is.
  let holder: string | null = null, ht = -1;
  for (const [pt, id] of b.pickups) if (pt <= t && pt >= ht) { holder = id; ht = pt; }
  let drop: [number, number, number] | null = null;
  for (const d of b.drops) if (d[0] <= t && d[0] >= ht) { drop = d; }
  if (drop) return { at: [drop[1], drop[2]], state: 'dropped', carrier: null, progress: 0 };
  const c = holder ? tl.byId.get(holder) : undefined;
  if (c) {
    const progress = b.plantT !== null && t >= b.plantT - PLANT_SECONDS ? (t - (b.plantT - PLANT_SECONDS)) / PLANT_SECONDS : 0;
    return { at: posAt(c, t), state: 'carried', carrier: c.id, progress };
  }
  return { at: null, state: 'none', carrier: null, progress: 0 };
}

// ---------------------------------------------------------------------------
// Building

/** Thrown when a round was played without recording (e.g. an instant sim). */
export class NoReplayError extends Error {
  constructor() { super('This round was simulated without a recording.'); }
}

export function buildTimeline(round: RoundResult, teams: [TeamSnapshot, TeamSnapshot], geo: MapGeometry): RoundTimeline {
  const rp = round.replay;
  if (!rp) throw new NoReplayError();
  const tTeam = round.tTeam;
  const info = new Map<string, { p: MatchPlayer; team: TeamIdx }>();
  teams.forEach((tm, ti) => tm.players.forEach((p) => info.set(p.id, { p, team: ti as TeamIdx })));
  const duration = round.endTime + 3;
  const players: PlayerTrack[] = rp.tracks.map((tr) => {
    const meta = info.get(tr.id)!;
    const side: Side = meta.team === tTeam ? 'T' : 'CT';
    // Positions: keep a sample whenever the player moved, plus the ends of each stop.
    const path: Waypoint[] = [];
    const n = tr.xs.length;
    for (let i = 0; i < n; i++) {
      const x = tr.xs[i]!, y = tr.ys[i]!;
      const prev = path[path.length - 1];
      const next = i + 1 < n ? [tr.xs[i + 1]!, tr.ys[i + 1]!] : null;
      const still = prev && prev.x === x && prev.y === y;
      const willMove = next && (next[0] !== x || next[1] !== y);
      if (!still || willMove || i === n - 1) path.push({ t: Math.round(i * rp.dt * 100) / 100, x, y });
    }
    if (!path.length) path.push({ t: 0, x: tr.xs[0] ?? 0, y: tr.ys[0] ?? 0 });
    const lo = round.loadouts?.[tr.id];
    return {
      id: tr.id, handle: meta.p.handle, role: meta.p.role, team: meta.team, side, path, deathT: tr.deathT,
      hp: tr.hp, weapons: tr.weapons.length ? tr.weapons : [[0, lo?.weapon ?? 'Glock-18']], armor: tr.armor, helmet: tr.helmet, kit: tr.kit,
      blinded: tr.blinded, aim: tr.aim, spotted: tr.spotted, noise: tr.noise,
    };
  });
  const byId = new Map(players.map((p) => [p.id, p] as const));
  const shots: Shot[] = rp.shots.map((s) => ({ ...s }));
  const floorH = (v: Vec) => {
    const x = Math.max(0, Math.min(geo.w - 1, Math.floor(v[0]))), y = Math.max(0, Math.min(geo.h - 1, Math.floor(v[1])));
    return geo.height[y * geo.w + x]! * HEIGHT_UNIT;
  };
  const lobbed = (f: FlightSpec): FlightSpec => ({ ...f, g: planLob(f, geo) });
  const utility: UtilityObject[] = round.utility.filter((u) => u.at && u.from).map((u) => {
    const from: Vec = [u.from![0], u.from![1]], at: Vec = [u.at![0], u.at![1]];
    const popT = u.landT ?? u.t;
    return {
      kind: u.kind, team: u.team, side: (u.team === tTeam ? 'T' : 'CT') as Side, playerId: u.playerId,
      throwT: u.t, t: popT, from, at,
      duration: u.duration ?? 0, radius: u.kind === 'flash' ? 9 : Math.max(1, u.radius ?? 3), victims: u.victims ?? [], flashed: u.flashedIds ?? [],
      flight: lobbed({ kind: u.kind, from, at, throwT: u.t, popT, fromH: floorH(from), atH: floorH(at) }),
    };
  });
  const b = rp.bomb;
  const feed: FeedItem[] = round.kills.map((k) => ({ t: k.t, kind: 'kill' as const, killerId: k.killerId, victimId: k.victimId, assisterId: k.assisterId, weapon: k.weapon, headshot: k.headshot }));
  if (b.plantT !== null) feed.push({ t: b.plantT, kind: 'plant', text: `Bomb planted on ${round.site}`, killerId: round.planterId });
  if (round.reason === 'defuse') feed.push({ t: round.endTime, kind: 'defuse', text: 'Bomb defused', killerId: round.defuserId });
  if (round.reason === 'bomb') feed.push({ t: round.endTime, kind: 'explode', text: 'Bomb exploded' });
  feed.sort((a, c) => a.t - c.t);
  return {
    geo, round, duration, players, byId, shots, utility,
    bomb: { carrier: b.carrier, pickups: b.pickups, drops: b.drops, plantT: b.plantT, plantAt: b.plantAt, defuseStart: b.defuseStart, defuseEnd: b.defuseEnd, attempts: b.attempts ?? [], exploded: b.exploded, dropT: b.dropT, dropAt: b.dropAt },
    feed,
    heard: (rp.heard ?? []).map(([t, listener, source]) => ({ t, listener, source })),
  };
}
