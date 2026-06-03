import type { Anim } from '$lib/types';
import { FLASH_HALF } from '$lib/constants/timing';

// ─── blocked charge + bounce offset ──────────────────────────────────────────
//
// The drain ("exiting") phase doesn't use this — it advances directly via
// stroke-dasharray + stroke-dashoffset. Only the blocked charge needs a
// per-frame "how far has the head slid toward the blocker" value.

/** Decelerating ease (fast → slow), for charging into the blocker. */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// Recoil after impact: a damped cosine from the blocker back to rest, f(0) = 1,
// settling to f(1) = 0 with a single small overshoot (~7% of the charge) past
// rest. Positive = toward blocker, negative = recoil.
const RECOIL_DAMP = 4.5;
const RECOIL_FREQ = 1.5 * Math.PI;

/** Per-frame charge offset (in cells) for a blocked arrow: slides 0 → chargeDist
 *  (easeOut) over approachMs, then springs back to rest with a small overshoot
 *  over the remaining time. Any other phase (exiting, blocked-flash) → 0. */
export function computeS(anim: Anim | undefined, elapsed: number): number {
    if (!anim || anim.phase !== 'blocked-bounce') return 0;
    const dist       = anim.chargeDist ?? 0;
    const approachMs = anim.approachMs ?? 0;
    if (elapsed <= approachMs) {
        return dist * easeOut(approachMs > 0 ? elapsed / approachMs : 1);
    }
    const recoilMs = (anim.durationMs ?? approachMs) - approachMs;
    const q = recoilMs > 0 ? Math.min(1, (elapsed - approachMs) / recoilMs) : 1;
    return dist * Math.exp(-RECOIL_DAMP * q) * Math.cos(RECOIL_FREQ * q);
}

/** Is the arrow currently in the "lit red" half of a flash cycle?
 *
 *  Flash alternates every FLASH_HALF ms during the `blocked-flash` phase. */
export function isFlashRed(anim: Anim, elapsed: number): boolean {
    return anim.phase === 'blocked-flash' && Math.floor(elapsed / FLASH_HALF) % 2 === 0;
}
