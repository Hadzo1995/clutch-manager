/**
 * Combat model: weapons, the combat profile derived from a player's
 * attributes, and the maths of one shot. Pure functions, no state.
 *
 * Weapon numbers are rounded approximations of publicly listed CS2 values
 * (damage, armour penetration, fire rate, range falloff, run speed). They are
 * not read from game files and some are simplified (no recoil patterns, no
 * wall penetration, arms count as chest).
 */
import { clamp } from '../rng';
import type { Attributes } from '../types';

export type WeaponClass = 'rifle' | 'sniper' | 'smg' | 'pistol' | 'heavy-pistol';

export interface WeaponDef {
  name: string;
  cls: WeaponClass;
  damage: number;
  /** Share of damage that goes through armour (0..1). */
  pen: number;
  /** Seconds between shots. */
  cycle: number;
  /** Damage multiplier per 500 game units of distance. */
  rangeMod: number;
  /** Metres where the first shot is still reliable for a good player. */
  accurateRange: number;
  /** Run speed in metres per second. */
  speed: number;
}

const W = (name: string, cls: WeaponClass, damage: number, pen: number, rpm: number, rangeMod: number, accurateRange: number, unitsPerSec: number): WeaponDef =>
  ({ name, cls, damage, pen, cycle: 60 / rpm, rangeMod, accurateRange, speed: unitsPerSec * 0.0254 });

export const WEAPONS: Record<string, WeaponDef> = {
  'AK-47': W('AK-47', 'rifle', 36, 0.775, 600, 0.98, 30, 215),
  'M4A4': W('M4A4', 'rifle', 33, 0.7, 666, 0.97, 30, 225),
  'M4A1-S': W('M4A1-S', 'rifle', 38, 0.7, 600, 0.99, 32, 225),
  'Galil AR': W('Galil AR', 'rifle', 30, 0.775, 666, 0.98, 24, 215),
  'FAMAS': W('FAMAS', 'rifle', 26, 0.7, 666, 0.96, 22, 220),
  'AWP': W('AWP', 'sniper', 115, 0.975, 41, 0.99, 90, 200),
  'MAC-10': W('MAC-10', 'smg', 29, 0.575, 800, 0.8, 12, 240),
  'MP9': W('MP9', 'smg', 26, 0.6, 857, 0.87, 13, 240),
  'Desert Eagle': W('Desert Eagle', 'heavy-pistol', 53, 0.93, 267, 0.81, 20, 230),
  'Glock-18': W('Glock-18', 'pistol', 30, 0.47, 400, 0.85, 10, 240),
  'USP-S': W('USP-S', 'pistol', 35, 0.505, 352, 0.91, 14, 240),
  'P250': W('P250', 'pistol', 38, 0.64, 400, 0.85, 12, 240),
};

export function weaponDef(name: string): WeaponDef {
  return WEAPONS[name] ?? WEAPONS['Glock-18']!;
}

/**
 * The match engine's view of a player: eleven stored attributes folded into the
 * skills the engine actually uses. Every value is 1..99. Each skill mixes
 * several attributes, so two players with the same OVR still play differently.
 */
export interface CombatProfile {
  /** How fast they notice an enemy that appears (reaction time). */
  reflexes: number;
  /** Rifle and pistol shot accuracy. */
  precision: number;
  /** AWP accuracy. */
  sniping: number;
  /** Keeping later shots of a burst on target. */
  sprayControl: number;
  /** Crosshair placement: how far the aim is from where enemies appear. */
  crosshair: number;
  /** Stopping before shooting, peeking well. */
  movement: number;
  /** Noticing enemies at the edge of view, reading sound and calls. */
  awareness: number;
  /** Picking fights, falling back, rotating at the right moment. */
  decisions: number;
  /** Playing to their level when outnumbered, low or in a clutch. */
  composure: number;
  /** Round-to-round steadiness. */
  consistency: number;
  /** Grenade accuracy and timing. */
  utility: number;
  /** Calls, spacing and refrags with teammates. */
  communication: number;
  /** Opening duels as the first player in. */
  entrying: number;
}

export const COMBAT_LABEL: Record<keyof CombatProfile, string> = {
  reflexes: 'Reflexes', precision: 'Precision', sniping: 'Sniping', sprayControl: 'Spray control', crosshair: 'Crosshair placement',
  movement: 'Movement', awareness: 'Awareness', decisions: 'Decisions', composure: 'Composure', consistency: 'Consistency',
  utility: 'Utility', communication: 'Communication', entrying: 'Entrying',
};

/** Which stored attributes feed each combat skill (shown in the player dossier). */
export const COMBAT_SOURCES: Record<keyof CombatProfile, string> = {
  reflexes: 'Aim 60%, entry 25%, game sense 15%',
  precision: 'Aim 80%, consistency 20%',
  sniping: 'AWP 75%, aim 25%',
  sprayControl: 'Aim 60%, consistency 40%',
  crosshair: 'Aim 45%, positioning 35%, game sense 20%',
  movement: 'Positioning 50%, entry 30%, aim 20%',
  awareness: 'Game sense 55%, positioning 25%, trading 20%',
  decisions: 'Game sense 60%, leadership 20%, consistency 20%',
  composure: 'Clutch 55%, consistency 45%',
  consistency: 'Consistency',
  utility: 'Utility',
  communication: 'Teamwork 50%, trading 30%, leadership 20%',
  entrying: 'Entry 65%, aim 35%',
};

/** What each skill changes in the round simulation (sim/round.ts and the shot maths below). */
export const COMBAT_EFFECT: Record<keyof CombatProfile, string> = {
  reflexes: 'How quickly they notice an enemy who comes into view.',
  precision: 'Hit chance with rifles and pistols, and how often hits land on the head.',
  sniping: 'Hit chance with the AWP.',
  sprayControl: 'How much accuracy falls off over a long burst.',
  crosshair: 'How far the crosshair is from where an enemy appears, so how long the flick takes.',
  movement: 'Time lost stopping before the first shot when they were moving.',
  awareness: 'Noticing enemies at the edge of view, rotation timing, and picking less obvious hold spots.',
  decisions: 'Calls, site reads, saves, adapting a stalled hit and grenade timing.',
  composure: 'Accuracy when hurt, outnumbered or in a clutch.',
  consistency: 'How much their level swings from round to round.',
  utility: 'How accurately smokes, flashes and molotovs land.',
  communication: 'How fast their callouts reach nearby teammates.',
  entrying: 'Clearing angles faster when first in on a hit or an aggressive push.',
};

export function combatProfile(a: Attributes): CombatProfile {
  const c = (v: number) => clamp(Math.round(v), 1, 99);
  return {
    reflexes: c(0.6 * a.aim + 0.25 * a.entry + 0.15 * a.gameSense),
    precision: c(0.8 * a.aim + 0.2 * a.consistency),
    sniping: c(0.75 * a.awp + 0.25 * a.aim),
    sprayControl: c(0.6 * a.aim + 0.4 * a.consistency),
    crosshair: c(0.45 * a.aim + 0.35 * a.positioning + 0.2 * a.gameSense),
    movement: c(0.5 * a.positioning + 0.3 * a.entry + 0.2 * a.aim),
    awareness: c(0.55 * a.gameSense + 0.25 * a.positioning + 0.2 * a.trading),
    decisions: c(0.6 * a.gameSense + 0.2 * a.leadership + 0.2 * a.consistency),
    composure: c(0.55 * a.clutch + 0.45 * a.consistency),
    consistency: c(a.consistency),
    utility: c(a.utility),
    communication: c(0.5 * a.teamwork + 0.3 * a.trading + 0.2 * a.leadership),
    entrying: c(0.65 * a.entry + 0.35 * a.aim),
  };
}

/** 0..1 skill scale used by the formulas: 40 → 0, 95 → 1 (values outside clamp a little past). */
export function s01(v: number): number {
  return clamp((v - 40) / 55, -0.1, 1.08);
}

/**
 * Time from an enemy entering view to the player noticing them, in seconds.
 * Elite reflexes ≈ 0.19 s, weak ≈ 0.36 s for a target straight ahead; slower at
 * the edge of vision, at long range, through partial cover, or when distracted.
 */
export function detectionTime(prof: CombatProfile, ctx: { offAngle: number; dist: number; partial: boolean; expected: boolean; targetMoving: boolean; form: number }): number {
  const base = 0.36 - 0.16 * s01(prof.reflexes) - 0.012 * ctx.form;
  const edge = 1 + 0.9 * Math.pow(Math.min(1, ctx.offAngle / 0.9), 2) * (1.15 - 0.5 * s01(prof.awareness));
  const range = 1 + Math.max(0, ctx.dist - 20) / 60;
  const cover = ctx.partial ? 1.2 : 1;
  const expect = ctx.expected ? 0.72 : 1;
  const motion = ctx.targetMoving ? 0.92 : 1.05;
  return Math.max(0.12, base * edge * range * cover * expect * motion);
}

/**
 * Time to put the crosshair on the target after noticing them: a flick that
 * grows with how far off the crosshair was. Good crosshair placement keeps
 * that distance small to begin with.
 */
export function acquireTime(prof: CombatProfile, offAngle: number, isSniper: boolean): number {
  const placement = 1.1 - 0.6 * s01(prof.crosshair); // fraction of the off-angle that's really there
  const flick = (Math.min(Math.PI, offAngle) * placement) / Math.PI;
  const speed = 0.42 - 0.2 * s01(prof.precision);
  return Math.max(0.03, 0.04 + flick * speed + (isSniper ? 0.08 : 0));
}

export interface ShotContext {
  dist: number; // metres
  shooterMoving: boolean;
  targetMoving: boolean;
  partial: boolean; // target behind low cover
  burstIndex: number; // 0 for the first bullet of a burst
  blind: number; // 0..1
  pressure: number; // 0..1 (outnumbered, low HP, clutch)
  form: number; // this round's form roll, about -1..1
  preAimed: boolean;
  /** The shooter heard this target running in and is locked on (optional for older callers). */
  focused?: boolean;
}

/** Probability that one bullet hits. Never 0 and never certain. */
export function hitChance(prof: CombatProfile, w: WeaponDef, ctx: ShotContext): number {
  const skill = s01(w.cls === 'sniper' ? prof.sniping : prof.precision);
  let p = 0.3 + 0.6 * skill + 0.03 * ctx.form;
  p *= 1 / (1 + 0.55 * Math.pow(ctx.dist / w.accurateRange, 2));
  if (ctx.shooterMoving) p *= w.cls === 'sniper' ? 0.08 : w.cls === 'rifle' ? 0.25 : 0.55;
  if (ctx.targetMoving) p *= 0.88;
  if (ctx.partial) p *= 0.6;
  if (ctx.burstIndex > 0 && w.cls !== 'sniper') p *= Math.max(0.4, 1 - ctx.burstIndex * 0.075 * (1.25 - s01(prof.sprayControl)));
  if (ctx.preAimed && ctx.burstIndex === 0) p *= 1.08;
  if (ctx.focused) p *= 1.04;
  p *= 1 - ctx.pressure * (1 - s01(prof.composure)) * 0.3;
  p *= 1 - 0.85 * ctx.blind;
  return clamp(p, 0.02, 0.95);
}

/** Share of hits that land on the head. */
export function headshotChance(prof: CombatProfile, w: WeaponDef, dist: number): number {
  if (w.cls === 'sniper') return 0.1;
  const base = 0.08 + 0.26 * s01(prof.precision);
  return clamp(base * (1 - Math.max(0, dist - 15) / 80), 0.05, 0.62);
}

export type HitGroup = 'head' | 'chest' | 'stomach' | 'legs';
const GROUP_MULT: Record<HitGroup, number> = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };

/** Health damage and armour loss for one hit (CS-style armour: helmets only protect the head). */
export function shotDamage(w: WeaponDef, group: HitGroup, distM: number, armor: number, helmet: boolean): { health: number; armor: number } {
  let dmg = w.damage * GROUP_MULT[group] * Math.pow(w.rangeMod, distM / 0.0254 / 500);
  const armored = armor > 0 && group !== 'legs' && (group !== 'head' || helmet);
  let armorLoss = 0;
  if (armored) {
    const health = dmg * w.pen;
    armorLoss = Math.min(armor, (dmg - health) * 0.5);
    dmg = health;
  }
  return { health: Math.max(1, Math.round(dmg)), armor: Math.round(armorLoss) };
}
