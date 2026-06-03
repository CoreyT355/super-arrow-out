// Animation timing constants (milliseconds).
//
// All durations are wall-clock, not frame counts, so behavior is consistent
// across refresh rates. Tweaking any of these changes player-perceptible
// pacing — keep them in this one file so a single PR is the audit trail.

/** Blocked-tap bounce: one damped-spring recoil. The snake lurches a small,
 *  FIXED distance toward the blocker, springs back past rest, and settles —
 *  the same rigid slide-along-its-path motion as a drain, just tiny and
 *  reversing, so it reads as "nope" instead of a half-finished exit. (The old
 *  nudge slid forward by the full distance to the blocker, which looked like a
 *  partial drain for far blockers.) */
export const BOUNCE_MS = 380;

/** Peak forward lurch of the bounce, in cells. Small + fixed on purpose. */
export const BOUNCE_CELLS = 0.42;

/** Half-period of the red-flash penalty (×4 across the full flash cycle). */
export const FLASH_HALF = 90;

/** Drain speed model: snakes exit at a CONSTANT on-screen speed, so the
 *  animation looks uniform within a board and across board sizes (the duration
 *  is derived from how far the snake slides in pixels, not a fixed time). The
 *  caller caps the slide distance to the visible viewport (off-screen travel is
 *  "free"), so durations stay bounded without a tight time cap that would make
 *  long drains move faster than short ones.
 *
 *  - EXIT_SPEED_PX_PER_MS — on-screen drain speed (pixels per millisecond).
 *  - EXIT_MIN_DUR — floor so a tiny slide (a few px on a huge board) still
 *    reads as motion rather than a pop.
 *  - EXIT_MAX_DUR — pathological safety ceiling only; with viewport capping a
 *    normal drain (≤ ~2 viewport spans) stays under it, so it rarely bites. */
export const EXIT_SPEED_PX_PER_MS = 1.1;
export const EXIT_MIN_DUR = 200;
export const EXIT_MAX_DUR = 1500;

/** Total win-collapse animation. */
export const VORTEX_DURATION = 2000;

/** Fade-in phase: stars appear from nothing during this opening window. */
export const VORTEX_FADE_MS = 600;

/** Spiral phase: stars accelerate inward toward the centre with ease-in. */
export const VORTEX_SPIN_MS = VORTEX_DURATION - VORTEX_FADE_MS;
