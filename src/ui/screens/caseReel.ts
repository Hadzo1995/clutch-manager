/**
 * The case strip's geometry and timing, kept apart from React so it can be tested.
 *
 * The strip is positioned with its left edge on the centre marker (CSS `left: 50%`), so the
 * offset that puts a point under the marker is just that point's distance from the strip's
 * start. That makes the stop independent of the window width and of resizes mid-roll.
 */
import { rollPlayer } from '../../engine/cases';
import type { CaseDef } from '../../engine/cases';
import { Rng } from '../../engine/rng';
import type { PlayerProfile, Role } from '../../engine/types';

export const ITEM_W = 168;
export const GAP = 6;
export const STRIDE = ITEM_W + GAP;
/** Tile under the marker when the strip starts, so the left half of the strip is filled. */
export const START_INDEX = 5;
/** The winning tile's index; tiles after it fill the right half when the strip stops. */
export const WIN_INDEX = 52;
export const REEL_LENGTH = WIN_INDEX + 8;
export const SPIN_MS = 6400;
/** Share of the roll spent getting up to speed before the long glide. */
const RAMP = 0.05;
const DECAY = 2.7;

/** Relative speed of the strip at progress u (0..1): a short ramp, then a long slowdown to zero. */
export function reelSpeed(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 0;
  if (u < RAMP) return u / RAMP;
  return Math.pow(1 - (u - RAMP) / (1 - RAMP), DECAY);
}

const STEPS = 600;
const CUM: number[] = (() => {
  const out = [0];
  let s = 0;
  for (let i = 1; i <= STEPS; i++) {
    s += (reelSpeed((i - 0.5) / STEPS)) / STEPS;
    out.push(s);
  }
  return out.map((x) => x / s);
})();

/** Share of the distance covered at progress u (0..1), from the speed profile above. */
export function reelEase(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const x = u * STEPS, i = Math.floor(x), f = x - i;
  return CUM[i]! + (CUM[i + 1]! - CUM[i]!) * f;
}

/** Offset (px) that puts `inside` px of tile `index` under the marker. */
export const offsetFor = (index: number, inside: number) => index * STRIDE + inside;

/** Where the roll starts and stops. `jitter` (0..1) picks the stopping point inside the winning tile. */
export function reelPath(jitter: number): { from: number; to: number } {
  const margin = 18;
  const inside = margin + Math.max(0, Math.min(1, jitter)) * (ITEM_W - 2 * margin);
  return { from: offsetFor(START_INDEX, ITEM_W / 2), to: offsetFor(WIN_INDEX, inside) };
}

/** Index of the tile under the marker at a given offset. */
export const tileAt = (offset: number) => Math.floor(offset / STRIDE);

/**
 * The strip: filler drawn with the case's own odds (so rare players never show up more often
 * than they really drop), with the drop that was already decided placed at WIN_INDEX.
 */
export function buildReel(seed: number, def: CaseDef, pool: PlayerProfile[], role: Role | undefined, winner: PlayerProfile): PlayerProfile[] {
  const rng = new Rng(seed >>> 0);
  const items = Array.from({ length: REEL_LENGTH }, () => rollPlayer(rng, def, pool, role));
  items[WIN_INDEX] = winner;
  return items;
}
