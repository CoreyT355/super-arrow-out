import { describe, it, expect } from 'vitest';
import { computeS, isFlashRed } from './animTiming';
import { BOUNCE_MS, BOUNCE_CELLS, FLASH_HALF } from '$lib/constants/timing';
import type { Anim } from '$lib/types';

const BOUNCE: Anim = { phase: 'blocked-bounce', startTime: 0 };
const FLASH: Anim  = { phase: 'blocked-flash',  startTime: 0 };
const EXIT: Anim   = { phase: 'exiting',        startTime: 0 };

describe('computeS (blocked bounce)', () => {
    it('returns 0 when anim is undefined', () => {
        expect(computeS(undefined, 0)).toBe(0);
        expect(computeS(undefined, 1000)).toBe(0);
    });

    it('starts and ends at rest (0)', () => {
        expect(computeS(BOUNCE, 0)).toBeCloseTo(0, 6);
        expect(computeS(BOUNCE, BOUNCE_MS)).toBeCloseTo(0, 3);
        // clamps past the end
        expect(computeS(BOUNCE, BOUNCE_MS * 3)).toBeCloseTo(0, 3);
    });

    it('lurches toward the blocker first (positive), peaking near BOUNCE_CELLS', () => {
        // Sample the first ~third: should go positive and reach ~the amplitude.
        let peak = 0;
        for (let el = 0; el <= BOUNCE_MS / 3; el += 2) peak = Math.max(peak, computeS(BOUNCE, el));
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeCloseTo(BOUNCE_CELLS, 1); // within ~0.05 cells of the target peak
    });

    it('recoils back past rest (goes negative) after the lurch', () => {
        let min = Infinity;
        for (let el = 0; el <= BOUNCE_MS; el += 2) min = Math.min(min, computeS(BOUNCE, el));
        expect(min).toBeLessThan(0);            // there is a backward recoil
        expect(min).toBeGreaterThan(-BOUNCE_CELLS); // but smaller than the forward lurch
    });

    it('never exceeds the forward amplitude by much', () => {
        for (let el = 0; el <= BOUNCE_MS; el += 2) {
            expect(Math.abs(computeS(BOUNCE, el))).toBeLessThan(BOUNCE_CELLS + 0.02);
        }
    });

    it('returns 0 for non-bounce phases', () => {
        expect(computeS(FLASH, 50)).toBe(0);
        expect(computeS(EXIT, 50)).toBe(0);
    });
});

describe('isFlashRed', () => {
    it('returns false for non-flash phases', () => {
        expect(isFlashRed(BOUNCE, 0)).toBe(false);
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
