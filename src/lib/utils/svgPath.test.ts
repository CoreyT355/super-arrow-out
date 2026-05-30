import { describe, it, expect } from 'vitest';
import { roundedPath, buildFullRoute } from './svgPath';
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
