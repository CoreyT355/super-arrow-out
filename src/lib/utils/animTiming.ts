import type { Anim } from '$lib/types';
import { easeIn, easeOut } from './easing';
import { NUDGE_FWD, NUDGE_BACK, FLASH_HALF } from '$lib/constants/timing';

// ─── step position for blocked phases ────────────────────────────────────────
//
// The drain ("exiting") phase doesn't use these — it advances directly via
// stroke-dasharray + stroke-dashoffset over a fixed wall-clock duration.
// Only the blocked nudge needs a per-frame "how far has the arrow shifted
// toward the blocker" value.

/** Per-frame nudge offset (in cells) for the blocked-arrow animation.
 *
 *  `blocked-fwd` eases out from 0 → maxSteps over NUDGE_FWD ms.
 *  `blocked-back` eases in from maxSteps → 0 over NUDGE_BACK ms.
 *  Any other phase (including `exiting` and `blocked-flash`) returns 0. */
export function computeS(anim: Anim | undefined, elapsed: number): number {
    if (!anim) return 0;
    if (anim.phase === 'blocked-fwd')
        return easeOut(Math.min(elapsed / NUDGE_FWD, 1)) * (anim.maxSteps ?? 0);
    if (anim.phase === 'blocked-back')
        return (1 - easeIn(Math.min(elapsed / NUDGE_BACK, 1))) * (anim.maxSteps ?? 0);
    return 0;
}

/** Is the arrow currently in the "lit red" half of a flash cycle?
 *
 *  Flash alternates every FLASH_HALF ms during the `blocked-flash` phase. */
export function isFlashRed(anim: Anim, elapsed: number): boolean {
    return anim.phase === 'blocked-flash' && Math.floor(elapsed / FLASH_HALF) % 2 === 0;
}
