import { describe, it, expect } from 'vitest';
import { computeS, isFlashRed } from './animTiming';
import { NUDGE_FWD, NUDGE_BACK, FLASH_HALF } from '$lib/constants/timing';
import type { Anim } from '$lib/types';

const FWD: Anim  = { phase: 'blocked-fwd',  startTime: 0, maxSteps: 4 };
const BACK: Anim = { phase: 'blocked-back', startTime: 0, maxSteps: 4 };
const FLASH: Anim = { phase: 'blocked-flash', startTime: 0 };
const EXIT: Anim  = { phase: 'exiting',      startTime: 0 };

describe('computeS', () => {
    it('returns 0 when anim is undefined', () => {
        expect(computeS(undefined, 0)).toBe(0);
        expect(computeS(undefined, 1000)).toBe(0);
    });

    it('returns 0 at the start of blocked-fwd and maxSteps at the end', () => {
        expect(computeS(FWD, 0)).toBe(0);
        expect(computeS(FWD, NUDGE_FWD)).toBe(4);
    });

    it('clamps blocked-fwd past the end of the nudge', () => {
        expect(computeS(FWD, NUDGE_FWD * 5)).toBe(4);
    });

    it('returns maxSteps at the start of blocked-back and 0 at the end', () => {
        expect(computeS(BACK, 0)).toBe(4);
        expect(computeS(BACK, NUDGE_BACK)).toBe(0);
    });

    it('handles blocked-fwd with maxSteps undefined as 0', () => {
        const noMax: Anim = { phase: 'blocked-fwd', startTime: 0 };
        expect(computeS(noMax, NUDGE_FWD)).toBe(0);
    });

    it('returns 0 for non-blocked-nudge phases', () => {
        expect(computeS(FLASH, 50)).toBe(0);
        expect(computeS(EXIT, 50)).toBe(0);
    });
});

describe('isFlashRed', () => {
    it('returns false for non-flash phases', () => {
        expect(isFlashRed(FWD, 0)).toBe(false);
        expect(isFlashRed(BACK, 0)).toBe(false);
        expect(isFlashRed(EXIT, 0)).toBe(false);
    });

    it('alternates true/false every FLASH_HALF ms during blocked-flash', () => {
        expect(isFlashRed(FLASH, 0)).toBe(true);                  // half 0 (even)
        expect(isFlashRed(FLASH, FLASH_HALF - 1)).toBe(true);     // still half 0
        expect(isFlashRed(FLASH, FLASH_HALF)).toBe(false);        // half 1 (odd)
        expect(isFlashRed(FLASH, FLASH_HALF * 2)).toBe(true);     // half 2 (even)
        expect(isFlashRed(FLASH, FLASH_HALF * 3)).toBe(false);    // half 3 (odd)
    });
});
