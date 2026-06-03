// Animation timing constants (milliseconds).
//
// All durations are wall-clock, not frame counts, so behavior is consistent
// across refresh rates. Tweaking any of these changes player-perceptible
// pacing — keep them in this one file so a single PR is the audit trail.

/** Snake body moves one cell per this many ms during a blocked nudge. */
export const MS_PER_STEP = 90;

/** How long a blocked arrow nudges toward the blocker before springing back. */
export const NUDGE_FWD = 140;

/** How long the spring-back to rest takes after the nudge. */
export const NUDGE_BACK = 140;

/** Half-period of the red-flash penalty (×4 across the full flash cycle). */
export const FLASH_HALF = 90;

/** Drain speed model: snakes exit at a CONSTANT on-screen speed, so the
 *  animation looks uniform within a board and across board sizes (the duration
 *  is derived from how far the snake slides in pixels, not a fixed time).
 *
 *  - EXIT_SPEED_PX_PER_MS — on-screen drain speed (pixels per millisecond).
 *  - EXIT_MIN_DUR — floor so a tiny slide (a few px on a huge board) still
 *    reads as motion rather than a pop.
 *  - EXIT_MAX_DUR — ceiling so a screen-spanning drain (or a zoomed-in long
 *    one) never drags. A full-screen slide lands a touch under this. */
export const EXIT_SPEED_PX_PER_MS = 1.1;
export const EXIT_MIN_DUR = 200;
export const EXIT_MAX_DUR = 700;

/** Total win-collapse animation. */
export const VORTEX_DURATION = 2000;

/** Fade-in phase: stars appear from nothing during this opening window. */
export const VORTEX_FADE_MS = 600;

/** Spiral phase: stars accelerate inward toward the centre with ease-in. */
export const VORTEX_SPIN_MS = VORTEX_DURATION - VORTEX_FADE_MS;
