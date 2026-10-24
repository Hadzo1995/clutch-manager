/**
 * The game's own motion setting. Animations play by default; "Reduced" turns them off, and
 * "Follow system" uses the operating system's reduce-motion switch. CSS reads the result from
 * <html data-motion="full|reduced">, scripts from reducedMotion().
 *
 * The game used to follow the system switch only. Windows sets it whenever "Animation effects"
 * is off (common on laptops tuned for speed), which silently froze every animation, including
 * the case opening, for players who never asked for that.
 */
export type MotionPref = 'full' | 'reduced' | 'system';

const KEY = 'cm-motion';

export function motionPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'reduced' || v === 'system' ? v : 'full';
  } catch {
    return 'full';
  }
}

export const systemReducesMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function reducedMotion(): boolean {
  const p = motionPref();
  return p === 'reduced' || (p === 'system' && systemReducesMotion());
}

export function applyMotion(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = reducedMotion() ? 'reduced' : 'full';
}

export function setMotionPref(p: MotionPref): void {
  try { localStorage.setItem(KEY, p); } catch { /* per-device convenience only */ }
  applyMotion();
  window.dispatchEvent(new Event('clutch-motion'));
}

export const MOTION_LABEL: Record<MotionPref, string> = { full: 'Full', reduced: 'Reduced', system: 'Follow system' };
