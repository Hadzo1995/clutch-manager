/**
 * Frame pacing for the always-on 3D scenes behind the menus (the Home lineup). They draw about 30
 * frames a second, like the stadium backdrop, instead of once per screen refresh, and they watch
 * how long frames take so a slow computer gets a cheaper picture instead of a laggy game.
 */

/**
 * Time between drawn frames: about 30 a second. Plenty for a slow camera drift and idle poses;
 * on 120-240 Hz screens it is a quarter of the work or less.
 */
export const FRAME_MS = 30;

/** Whether a frame is due at `now` (a requestAnimationFrame time) when the last one was drawn at `last` (0 = none yet). */
export const frameDue = (now: number, last: number): boolean => !last || now - last >= FRAME_MS;

/** A frame slower than this misses the ~24 frames a second the scene needs to look smooth. */
const SLOW_MS = 42;
/** Frames judged together, after the first few. */
const WINDOW = 45;
const WARM_UP = 20;

/**
 * Watches the time between drawn frames and says when the scene should step down to a cheaper
 * picture: when most frames in a window are slow, not after one long hitch (a screen opening
 * elsewhere on the page). Start-up frames (shader compile, first uploads) and long pauses such as
 * the computer sleeping are not counted. Set `done` after the last step to stop watching.
 */
export class FrameWatch {
  done = false;
  private frames = 0;
  private n = 0;
  private slow = 0;

  /** Feed the time since the previous drawn frame; true means step down now. */
  stepDown(gap: number): boolean {
    if (this.done || ++this.frames <= WARM_UP || gap <= 0 || gap > 5000) return false;
    this.n++;
    if (gap > SLOW_MS) this.slow++;
    if (this.n < WINDOW) return false;
    const slow = this.slow > this.n / 2;
    this.n = 0;
    this.slow = 0;
    return slow;
  }
}
