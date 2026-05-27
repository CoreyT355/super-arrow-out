// ─── animation timing helpers ────────────────────────────────────────────────

import type { Anim } from '$lib/types';
import { NUDGE_FWD, NUDGE_BACK, FLASH_HALF } from '$lib/constants/timing';
import { easeOut, easeIn } from '$lib/utils/easing';

// Returns the fractional step offset for blocked-nudge phases.
// The exiting phase is driven by stroke-dashoffset directly; only the
// blocked nudge/bounce needs this scalar.
export function computeS(anim: Anim | undefined, elapsed: number): number {
	if (!anim) return 0;
	if (anim.phase === 'blocked-fwd')
		return easeOut(Math.min(elapsed / NUDGE_FWD, 1)) * (anim.maxSteps ?? 0);
	if (anim.phase === 'blocked-back')
		return (1 - easeIn(Math.min(elapsed / NUDGE_BACK, 1))) * (anim.maxSteps ?? 0);
	return 0;
}

export function isFlashRed(anim: Anim, elapsed: number): boolean {
	return anim.phase === 'blocked-flash' && Math.floor(elapsed / FLASH_HALF) % 2 === 0;
}
