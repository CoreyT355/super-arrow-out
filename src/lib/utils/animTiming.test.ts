import { describe, it, expect } from 'vitest';
import { computeS, isFlashRed } from './animTiming';
import { FLASH_HALF } from '$lib/constants/timing';
import type { Anim } from '$lib/types';

// A charge to a blocker 4 cells away: 200ms approach, 300ms recoil (500 total).
const DIST = 4, APPROACH = 200, DURATION = 500;
const CHARGE: Anim = {
    phase: 'blocked-bounce', startTime: 0,
    chargeDist: DIST, approachMs: APPROACH, durationMs: DURATION,
};
const FLASH: Anim = { phase: 'blocked-flash', startTime: 0 };
const EXIT: Anim  = { phase: 'exiting',       startTime: 0 };

describe('computeS (blocked charge + bounce)', () => {
    it('returns 0 when anim is undefined', () => {
        expect(computeS(undefined, 0)).toBe(0);
        expect(computeS(undefined, 1000)).toBe(0);
    });

    it('starts at rest and charges all the way to the blocker by approachMs', () => {
        expect(computeS(CHARGE, 0)).toBeCloseTo(0, 6);
        expect(computeS(CHARGE, APPROACH)).toBeCloseTo(DIST, 6); // reaches the blocker
    });

    it('the charge-in is monotonically increasing (no whip back mid-approach)', () => {
        let prev = -1;
        for (let el = 0; el <= APPROACH; el += 10) {
            const s = computeS(CHARGE, el);
            expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = s;
        }
    });

    it('recoils past rest (negative) after impact, then settles to ~0', () => {
        let min = Infinity;
        for (let el = APPROACH; el <= DURATION; el += 5) min = Math.min(min, computeS(CHARGE, el));
        expect(min).toBeLessThan(0);                 // bounces back past rest
        expect(min).toBeGreaterThan(-DIST * 0.2);    // overshoot stays modest (<20%)
        expect(computeS(CHARGE, DURATION)).toBeCloseTo(0, 2);   // settled
        expect(computeS(CHARGE, DURATION * 3)).toBeCloseTo(0, 2); // clamped past the end
    });

    it('never overshoots the blocker on the way in', () => {
        for (let el = 0; el <= APPROACH; el += 5) {
            expect(computeS(CHARGE, el)).toBeLessThanOrEqual(DIST + 1e-9);
        }
    });

    it('returns 0 for non-bounce phases', () => {
        expect(computeS(FLASH, 50)).toBe(0);
        expect(computeS(EXIT, 50)).toBe(0);
    });
});

describe('isFlashRed', () => {
    it('returns false for non-flash phases', () => {
        expect(isFlashRed(CHARGE, 0)).toBe(false);
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
