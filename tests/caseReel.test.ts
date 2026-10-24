import { describe, expect, it } from 'vitest';
import { CASES } from '../src/engine/cases';
import { ITEM_W, REEL_LENGTH, STRIDE, WIN_INDEX, buildReel, reelEase, reelPath, reelSpeed, tileAt } from '../src/ui/screens/caseReel';
import { world as testWorld } from './helpers';

describe('case strip', () => {
  it('always stops inside the winning tile, never in a gap or a neighbour', () => {
    for (let k = 0; k <= 100; k++) {
      const { to } = reelPath(k / 100);
      expect(tileAt(to)).toBe(WIN_INDEX);
      const inside = to - WIN_INDEX * STRIDE;
      expect(inside).toBeGreaterThan(0);
      expect(inside).toBeLessThan(ITEM_W);
    }
    // Out-of-range jitter is clamped, not trusted.
    expect(tileAt(reelPath(-3).to)).toBe(WIN_INDEX);
    expect(tileAt(reelPath(7).to)).toBe(WIN_INDEX);
  });

  it('eases from 0 to exactly 1 without ever moving backwards', () => {
    expect(reelEase(0)).toBe(0);
    expect(reelEase(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 1000; i++) {
      const v = reelEase(i / 1000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // A short wind-up, a fast middle, and a long slow glide at the end.
    expect(reelSpeed(0.02)).toBeLessThan(reelSpeed(0.06));
    expect(reelSpeed(0.95)).toBeLessThan(0.01);
    expect(reelEase(0.5)).toBeGreaterThan(0.75);
  });

  it('places the decided drop at the winning index and fills the strip from the case pool', () => {
    const world = testWorld();
    const def = CASES.standard;
    const winner = world.profileList[0]!;
    const reel = buildReel(12345, def, world.profileList, undefined, winner);
    expect(reel).toHaveLength(REEL_LENGTH);
    expect(reel[WIN_INDEX]).toBe(winner);
    // Same seed, same strip: nothing about the strip is left to chance after unlocking.
    expect(buildReel(12345, def, world.profileList, undefined, winner).map((p) => p.record.id)).toEqual(reel.map((p) => p.record.id));
  });

  it('only shows the chosen role in a role case', () => {
    const world = testWorld();
    const winner = world.profileList.find((p) => p.record.primaryRole === 'awp')!;
    const reel = buildReel(99, CASES.role, world.profileList, 'awp', winner);
    expect(reel.every((p) => p.record.primaryRole === 'awp')).toBe(true);
  });
});
