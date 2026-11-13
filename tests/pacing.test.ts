import { describe, expect, it } from 'vitest';
import { FRAME_MS, FrameWatch, frameDue } from '../src/ui/home3d/pacing';

/** Frames drawn in one second by a loop on a screen refreshing `hz` times a second. */
function drawnPerSecond(hz: number): number {
  let last = 0, drawn = 0;
  for (let i = 1; i <= hz; i++) {
    const now = 1000 + (i * 1000) / hz;
    if (frameDue(now, last)) { last = now; drawn++; }
  }
  return drawn;
}

describe('frame pacing', () => {
  it('draws about 30 frames a second whatever the screen refresh rate', () => {
    for (const hz of [60, 75, 120, 144, 165, 240]) {
      const n = drawnPerSecond(hz);
      expect(n, `${hz} Hz`).toBeGreaterThanOrEqual(24);
      expect(n, `${hz} Hz`).toBeLessThanOrEqual(34);
    }
    expect(drawnPerSecond(60)).toBe(30);
  });

  it('draws the first frame at once and never two within FRAME_MS', () => {
    expect(frameDue(5, 0)).toBe(true);
    expect(frameDue(100 + FRAME_MS - 1, 100)).toBe(false);
    expect(frameDue(100 + FRAME_MS, 100)).toBe(true);
  });
});

describe('FrameWatch', () => {
  const feed = (w: FrameWatch, gaps: number[]) => gaps.map((g) => w.stepDown(g)).filter(Boolean).length;
  const warm = (w: FrameWatch) => feed(w, Array(20).fill(400));

  it('ignores start-up frames, however slow', () => {
    const w = new FrameWatch();
    expect(warm(w)).toBe(0);
  });

  it('keeps the picture when frames come at about 30 a second', () => {
    const w = new FrameWatch();
    warm(w);
    expect(feed(w, Array(450).fill(33.3))).toBe(0);
    expect(feed(w, Array(450).fill(41.6))).toBe(0); // 24 frames a second on a 144 Hz screen
  });

  it('steps down once per window of mostly slow frames', () => {
    const w = new FrameWatch();
    warm(w);
    expect(feed(w, Array(44).fill(60))).toBe(0);
    expect(w.stepDown(60)).toBe(true);
    expect(feed(w, Array(45).fill(60))).toBe(1);
  });

  it('does not step down for one long hitch among smooth frames', () => {
    const w = new FrameWatch();
    warm(w);
    expect(feed(w, [...Array(20).fill(33.3), 1800, ...Array(24).fill(33.3)])).toBe(0);
  });

  it('skips pauses such as the computer sleeping', () => {
    const w = new FrameWatch();
    warm(w);
    expect(feed(w, Array(100).fill(60_000))).toBe(0);
  });

  it('stops after the last step', () => {
    const w = new FrameWatch();
    warm(w);
    w.done = true;
    expect(feed(w, Array(200).fill(80))).toBe(0);
  });
});
