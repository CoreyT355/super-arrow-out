import { describe, it, expect } from 'vitest';
import { roundedPath, buildFullRoute, drainDurationMs } from './svgPath';
import { EXIT_SPEED_PX_PER_MS, EXIT_MIN_DUR, EXIT_MAX_DUR } from '$lib/constants/timing';
import type { Arrow } from '$lib/types';

// `measurePath` is excluded from this suite because it relies on the DOM
// (document.createElementNS + getTotalLength). The Playwright safety net
// exercises it implicitly via the drain animation.

describe('roundedPath', () => {
    it('returns empty string for an empty path', () => {
        expect(roundedPath([], 0.4)).toBe('');
    });

    it('returns just a Move command for a single cell', () => {
        expect(roundedPath([{ x: 3, y: 4 }], 0.4)).toBe('M 3.5 4.5');
    });

    it('returns a single L line for two cells', () => {
        expect(roundedPath([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.4))
            .toBe('M 0.5 0.5 L 1.5 0.5');
    });

    it('emits only L commands for a perfectly straight three-cell path', () => {
        const d = roundedPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 0.4);
        expect(d).not.toContain('Q');
        expect(d).toContain('M 0.5 0.5');
        expect(d).toContain('L 2.5 0.5');
    });

    it('emits a Q (quadratic Bézier) at turns when r > 0', () => {
        const d = roundedPath(
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
            0.4,
        );
        expect(d).toContain('Q');
    });

    it('still emits a tiny Q at turns when r === 0 (avoids the mobile pinch)', () => {
        const d = roundedPath(
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
            0,
        );
        expect(d).toContain('Q');
    });
});

describe('buildFullRoute', () => {
    const arrow: Arrow = {
        id: 0,
        direction: 'E',
        path: [
            { x: 4, y: 0 }, // head
            { x: 3, y: 0 },
            { x: 2, y: 0 },
        ],
        color: '#000',
    };

    it('produces a path string that starts at the tail and ends past the head', () => {
        const d = buildFullRoute(arrow, 8, 8, false);
        expect(d).toMatch(/^M 2\.5 0\.5/); // starts at tail (path[N-1])
        // Extension goes east past x=4 (the head). The path should
        // reference at least one cell with x > 4.
        const xValues = [...d.matchAll(/[ML] (\-?[\d.]+) /g)].map(m => Number(m[1]));
        expect(Math.max(...xValues)).toBeGreaterThan(4.5);
    });

    it('respects the rounded-corners argument by changing curve handling', () => {
        const onPath  = buildFullRoute(arrow, 8, 8, true);
        const offPath = buildFullRoute(arrow, 8, 8, false);
        // The straight-east extension produces no turns, so both versions
        // should match. Add a turn by giving the arrow an L-shape.
        const lShape: Arrow = {
            id: 1,
            direction: 'E',
            path: [
                { x: 4, y: 0 },
                { x: 3, y: 0 },
                { x: 3, y: 1 },
            ],
            color: '#000',
        };
        const lOn  = buildFullRoute(lShape, 8, 8, true);
        const lOff = buildFullRoute(lShape, 8, 8, false);
        expect(lOn).not.toBe(lOff);
        // The straight-extension case really should be identical:
        expect(onPath).toBe(offPath);
    });
});

describe('drainDurationMs (constant on-screen speed)', () => {
    // A travel/pxPerCell pair lands in the unclamped middle band when the
    // resulting duration is strictly between the min and max.
    const speed = (travel: number, pxPerCell: number) =>
        (travel * pxPerCell) / drainDurationMs(travel, pxPerCell); // px per ms

    it('is constant speed in the unclamped band (duration ∝ pixels travelled)', () => {
        // Same cell size, different travel distances — all mid-band.
        const px = 10; // px per cell
        const d1 = drainDurationMs(30, px);  // 300px
        const d2 = drainDurationMs(50, px);  // 500px
        expect(d1).toBeGreaterThan(EXIT_MIN_DUR);
        expect(d2).toBeLessThan(EXIT_MAX_DUR);
        // Duration scales linearly with distance → identical speed.
        expect(speed(30, px)).toBeCloseTo(EXIT_SPEED_PX_PER_MS, 6);
        expect(speed(50, px)).toBeCloseTo(EXIT_SPEED_PX_PER_MS, 6);
        expect(d2 / d1).toBeCloseTo(50 / 30, 6);
    });

    it('gives the same on-screen speed regardless of board cell size', () => {
        // A short slide on a small board (big cells) vs a long slide on a big
        // board (tiny cells) that cover the same pixels run at the same speed.
        expect(speed(5, 60)).toBeCloseTo(EXIT_SPEED_PX_PER_MS, 6);   // 300px, Easy-ish
        expect(speed(75, 4)).toBeCloseTo(EXIT_SPEED_PX_PER_MS, 6);   // 300px, Ludicrous-ish
    });

    it('floors tiny slides at EXIT_MIN_DUR', () => {
        expect(drainDurationMs(1, 2)).toBe(EXIT_MIN_DUR);   // 2px → would be ~2ms
        expect(drainDurationMs(0, 100)).toBe(EXIT_MIN_DUR);
    });

    it('caps screen-spanning slides at EXIT_MAX_DUR', () => {
        expect(drainDurationMs(1000, 5)).toBe(EXIT_MAX_DUR); // 5000px
    });

    it('is monotonic non-decreasing in distance', () => {
        let prev = 0;
        for (let travel = 0; travel <= 400; travel += 7) {
            const d = drainDurationMs(travel, 8);
            expect(d).toBeGreaterThanOrEqual(prev);
            prev = d;
        }
    });

    it('falls back to grid units when the board is unmeasured (pxPerCell ≤ 0)', () => {
        // Should not blow up or return 0; treats pxPerCell as 1.
        expect(drainDurationMs(40, 0)).toBe(drainDurationMs(40, 1));
        expect(drainDurationMs(40, 0)).toBeGreaterThanOrEqual(EXIT_MIN_DUR);
    });
});
