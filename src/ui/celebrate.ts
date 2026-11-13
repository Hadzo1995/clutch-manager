/**
 * Celebration bursts for the big moments (a series win, a final). canvas-confetti (ISC) draws on
 * its own full-screen canvas above everything and cleans up when the pieces settle. Colours come
 * from the club accent plus gold and white. Skipped entirely under Reduced motion.
 */
import confetti from 'canvas-confetti';
import { reducedMotion } from './motion';

function palette(): string[] {
  const accent = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--t').trim() : '';
  return [accent || '#f0a33a', '#ffd36b', '#ffffff', '#f6e7c1'];
}

/** level 1: a regular win. level 2: a series win or a final, with side cannons and a second wave. */
export function celebrate(level: 1 | 2 = 1): void {
  if (typeof window === 'undefined' || reducedMotion()) return;
  const colors = palette();
  const base = { colors, disableForReducedMotion: false, zIndex: 2000, ticks: 260, scalar: 0.95 } as const;
  confetti({ ...base, particleCount: level === 2 ? 110 : 70, spread: 75, startVelocity: 42, origin: { x: 0.5, y: 0.35 } });
  if (level === 2) {
    window.setTimeout(() => {
      confetti({ ...base, particleCount: 60, angle: 60, spread: 60, startVelocity: 55, origin: { x: 0, y: 0.75 } });
      confetti({ ...base, particleCount: 60, angle: 120, spread: 60, startVelocity: 55, origin: { x: 1, y: 0.75 } });
    }, 280);
  }
}
