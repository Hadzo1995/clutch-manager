/**
 * Capture builds for marketing footage (`npm run capture`, `npm run capture:dev`).
 *
 * A capture build shows only the game's own content: the fictional demo players, drawn
 * portraits instead of player photos, generated crests instead of team logos, and
 * fictional names for the top division and its cup. It runs offline (no Supabase, so no
 * beta gate) and keeps its saves under separate keys, so it never touches a real career.
 *
 * The flag comes from `.env.capture` at build time. Normal builds never set it, so Vite
 * replaces the check with `false` and none of this changes the released game.
 */
export const CAPTURE: boolean = import.meta.env.VITE_CAPTURE === '1';

/** Display names used instead of real league and event names in capture builds. */
export const CAPTURE_TOP_DIVISION = 'Elite League';
