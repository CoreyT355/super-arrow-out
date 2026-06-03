import type { Anim } from '$lib/types';
import { BOUNCE_MS, BOUNCE_CELLS, FLASH_HALF } from '$lib/constants/timing';

// ─── step position for blocked phases ────────────────────────────────────────
//
// The drain ("exiting") phase doesn't use these — it advances directly via
// stroke-dasharray + stroke-dashoffset over a fixed wall-clock duration.
// Only the blocked bounce needs a per-frame "how far has the arrow shifted
// toward the blocker" value.

// Damped-spring shape for the bounce: f(p) = e^(-DAMP·p)·sin(FREQ·p) over
// p ∈ [0, 1]. FREQ = 3π gives 1.5 oscillations (lurch → recoil → settle) and
// lands exactly on 0 at p = 1; NORM is f's peak so BOUNCE_CELLS is the real
// peak lurch in cells. Positive = toward the blocker, negative = recoil.
const BOUNCE_DAMP = 4;
const BOUNCE_FREQ = 3 * Math.PI;
const BOUNCE_NORM = 0.561;

/** Per-frame bounce offset (in cells) for a blocked arrow.
 *
 *  `blocked-bounce` runs a fixed-amplitude damped spring over BOUNCE_MS.
 *  Any other phase (including `exiting` and `blocked-flash`) returns 0. */
export function computeS(anim: Anim | undefined, elapsed: number): number {
    if (!anim || anim.phase !== 'blocked-bounce') return 0;
    const p = Math.min(elapsed / BOUNCE_MS, 1);
    return (BOUNCE_CELLS / BOUNCE_NORM) * Math.exp(-BOUNCE_DAMP * p) * Math.sin(BOUNCE_FREQ * p);
}

/** Is the arrow currently in the "lit red" half of a flash cycle?
 *
 *  Flash alternates every FLASH_HALF ms during the `blocked-flash` phase. */
export function isFlashRed(anim: Anim, elapsed: number): boolean {
    return anim.phase === 'blocked-flash' && Math.floor(elapsed / FLASH_HALF) % 2 === 0;
}
