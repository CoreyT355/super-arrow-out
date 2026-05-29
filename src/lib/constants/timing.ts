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

/** Drain duration cap. Snakes always exit in the same wall-clock time
 *  regardless of length — short snakes look slow, long ones look like a
 *  whip. EXIT_MIN_DUR keeps the very shortest exits from looking instant. */
export const EXIT_DURATION = 450;
export const EXIT_MIN_DUR  = 220;

/** Total win-collapse animation. */
export const VORTEX_DURATION = 2000;

/** Fade-in phase: stars appear from nothing during this opening window. */
export const VORTEX_FADE_MS = 600;

/** Spiral phase: stars accelerate inward toward the centre with ease-in. */
export const VORTEX_SPIN_MS = VORTEX_DURATION - VORTEX_FADE_MS;
