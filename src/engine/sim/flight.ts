/**
 * Grenade flight model, shared by the round simulation (timing) and both match
 * viewers (drawing), so what is drawn is where the simulated grenade is: the
 * engine sets the throw, the rest point and the pop time; the arc in between
 * comes from here.
 *
 * A grenade leaves the thrower's hand, flies a ballistic arc (no drag) and
 * lands short of its rest point, then rolls to a stop there and pops (smoke),
 * or bursts in the air at the end of its arc (flash), or pops on landing (HE,
 * molotov). Values are approximations, not CS2's exact physics: CS scales
 * gravity for grenades to 0.4 x 800 units/s^2, which at about 2.5 cm per unit
 * is roughly 8 m/s^2.
 */
import type { MapGeometry } from '../../maps/types';

export type UtilityKind = 'smoke' | 'flash' | 'molotov' | 'he';

export const NADE_GRAVITY = 8.1;
/** Seconds in the air for a throw of `d` metres over open ground. */
export const airTime = (d: number) => 0.6 + d / 16;
/**
 * Height (above the floor under it) that a grenade must clear over buildings
 * and walls: the tallest roofs the viewer draws stay below this.
 */
export const SKYLINE = 7;
/** Steepest lob we draw: the effective pull for a high, short throw over a roof (m/s^2). */
const MAX_G = 36;

/**
 * The engine decides when a grenade is thrown and when it pops; it does not
 * model height. The arc is shaped so it clears what lies between (walls and
 * roofs up to SKYLINE above the floor, tall cover): over open ground it is a
 * plain ballistic arc under NADE_GRAVITY, over a building the same flight
 * time is drawn as a steeper lob. `obstacles` are [fraction of the way,
 * height in metres] samples along the throw line.
 */
export function lobGravity(airSeconds: number, h0: number, h1: number, d: number, obstacles: [number, number][]): number {
  let g = NADE_GRAVITY;
  // Within a couple of metres of either end the grenade is leaving the hand around a corner or bouncing in.
  const edge = Math.min(0.45, 2.2 / Math.max(1, d));
  for (const [f, top] of obstacles) {
    if (f <= edge || f >= 1 - edge) continue;
    const need = top + 0.25 - (h0 + (h1 - h0) * f);
    if (need > 0) g = Math.max(g, (2 * need) / (airSeconds * airSeconds * f * (1 - f)));
  }
  return Math.min(MAX_G, g);
}

/** Seconds between landing and popping: smokes roll to a stop, a flash's fuse runs out in the air. */
export const SETTLE: Record<UtilityKind, number> = { smoke: 0.6, flash: 0.25, he: 0.2, molotov: 0.2 };
/** How far a grenade rolls after landing (metres). */
const ROLL: Record<UtilityKind, number> = { smoke: 1.1, flash: 0, he: 0.35, molotov: 0 };
/** Height of the hand at release, and of a flash when it bursts (metres above the floor). */
export const RELEASE_H = 1.6;
export const FLASH_POP_H = 1.5;

export interface FlightSpec {
  kind: UtilityKind;
  from: [number, number];
  at: [number, number];
  throwT: number;
  popT: number;
  /** Floor heights at the throw and at the rest point (metres). */
  fromH: number;
  atH: number;
  /** Pull used to draw the arc (lobGravity); NADE_GRAVITY when omitted. */
  g?: number;
}

export interface FlightPoint { x: number; y: number; h: number; phase: 'air' | 'roll' | 'done' }

/** Where the flight ends in the air (landing point, or the flash burst), and the flight duration. */
function airLeg(s: FlightSpec) {
  const total = Math.max(0.05, s.popT - s.throwT);
  const flash = s.kind === 'flash';
  const air = flash ? total : Math.max(0.05, total - SETTLE[s.kind]);
  const dx = s.at[0] - s.from[0], dy = s.at[1] - s.from[1];
  const d = Math.hypot(dx, dy) || 1;
  const roll = Math.min(ROLL[s.kind], d * 0.3);
  const land: [number, number] = [s.at[0] - (dx / d) * roll, s.at[1] - (dy / d) * roll];
  const h0 = s.fromH + RELEASE_H, h1 = flash ? s.atH + FLASH_POP_H : s.atH + 0.08;
  const g = s.g ?? NADE_GRAVITY;
  const vy = (h1 - h0 + (g * air * air) / 2) / air;
  return { air, land, h0, h1, vy, g };
}

/** Grenade position at time t (cell coordinates and height in metres). */
export function flightAt(s: FlightSpec, t: number): FlightPoint {
  if (t >= s.popT) return { x: s.at[0], y: s.at[1], h: s.kind === 'flash' ? s.atH + FLASH_POP_H : s.atH + 0.08, phase: 'done' };
  const { air, land, h0, vy, g } = airLeg(s);
  const tau = t - s.throwT;
  if (tau <= air) {
    const f = Math.max(0, tau) / air;
    const x = s.from[0] + (land[0] - s.from[0]) * f, y = s.from[1] + (land[1] - s.from[1]) * f;
    return { x, y, h: h0 + vy * Math.max(0, tau) - (g * tau * Math.max(0, tau)) / 2, phase: 'air' };
  }
  if (t < s.popT) {
    const f = (tau - air) / Math.max(1e-3, s.popT - s.throwT - air);
    const k = 1 - (1 - f) * (1 - f);
    return { x: land[0] + (s.at[0] - land[0]) * k, y: land[1] + (s.at[1] - land[1]) * k, h: s.atH + 0.08, phase: 'roll' };
  }
  return { x: s.at[0], y: s.at[1], h: s.kind === 'flash' ? s.atH + FLASH_POP_H : s.atH + 0.08, phase: 'done' };
}

/** Highest point of the arc above the thrower's floor (metres). */
export function apexHeight(s: FlightSpec): number {
  const { air, h0, vy, g } = airLeg(s);
  const tp = Math.min(air, Math.max(0, vy / g));
  return h0 + vy * tp - (g * tp * tp) / 2 - s.fromH;
}

/** The pull to draw this throw with, from what lies along its line on the map. */
export function planLob(s: FlightSpec, geo: MapGeometry): number {
  const d = Math.hypot(s.at[0] - s.from[0], s.at[1] - s.from[1]);
  const obstacles: [number, number][] = [];
  const n = Math.max(2, Math.ceil(d * 2));
  for (let k = 1; k < n; k++) {
    const f = k / n;
    const cx = Math.floor(s.from[0] + (s.at[0] - s.from[0]) * f), cy = Math.floor(s.from[1] + (s.at[1] - s.from[1]) * f);
    if (cx < 0 || cy < 0 || cx >= geo.w || cy >= geo.h) continue;
    const i = cy * geo.w + cx, k2 = geo.kind[i], h = geo.height[i]!;
    obstacles.push([f, k2 === 'wall' || k2 === 'void' ? h + SKYLINE : k2 === 'tall' ? h + 2.4 : h]);
  }
  const flash = s.kind === 'flash';
  const air = Math.max(0.05, s.popT - s.throwT - (flash ? 0 : SETTLE[s.kind]));
  return lobGravity(air, s.fromH + RELEASE_H, flash ? s.atH + FLASH_POP_H : s.atH + 0.08, d, obstacles);
}
