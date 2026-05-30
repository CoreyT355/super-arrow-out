import { describe, it, expect } from 'vitest';
import { easeIn, easeOut } from './easing';

describe('easing', () => {
    it('easeOut: 0 → 0, 1 → 1, 0.5 → 0.75', () => {
        expect(easeOut(0)).toBe(0);
        expect(easeOut(1)).toBe(1);
        expect(easeOut(0.5)).toBeCloseTo(0.75, 10);
    });

    it('easeIn: 0 → 0, 1 → 1, 0.5 → 0.25', () => {
        expect(easeIn(0)).toBe(0);
        expect(easeIn(1)).toBe(1);
        expect(easeIn(0.5)).toBeCloseTo(0.25, 10);
    });

    it('easeOut is monotonically increasing on [0, 1]', () => {
        let prev = -Infinity;
        for (let i = 0; i <= 10; i++) {
            const v = easeOut(i / 10);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });

    it('easeIn is monotonically increasing on [0, 1]', () => {
        let prev = -Infinity;
        for (let i = 0; i <= 10; i++) {
            const v = easeIn(i / 10);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });
});
