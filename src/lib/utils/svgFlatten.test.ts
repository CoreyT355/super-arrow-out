import { describe, it, expect } from 'vitest';
import { flattenPath, bbox, type Pt } from './svgFlatten';

// Even-odd point-in-polygon, mirroring the one used for the mask.
function inside(px: number, py: number, poly: readonly Pt[]): boolean {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) r = !r;
    }
    return r;
}

describe('flattenPath', () => {
    it('absolute square', () => {
        const p = flattenPath('M0 0 L10 0 L10 10 L0 10 Z');
        const b = bbox(p);
        expect(b).toMatchObject({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
        expect(inside(5, 5, p)).toBe(true);
        expect(inside(-1, 5, p)).toBe(false);
        expect(inside(11, 5, p)).toBe(false);
    });

    it('relative commands produce the same square', () => {
        const p = flattenPath('M0 0 l10 0 l0 10 l-10 0 z');
        expect(bbox(p)).toMatchObject({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
        expect(inside(5, 5, p)).toBe(true);
    });

    it('H and V commands', () => {
        const p = flattenPath('M0 0 H10 V10 H0 Z');
        expect(bbox(p)).toMatchObject({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    });

    it('triangle: apex outside corners, centroid inside', () => {
        const p = flattenPath('M5 0 L10 10 L0 10 Z');
        expect(inside(0.2, 0.2, p)).toBe(false); // top-left corner
        expect(inside(5, 7, p)).toBe(true);       // near centroid
    });

    it('cubic curve stays within its control hull bbox and is smooth', () => {
        const p = flattenPath('M0 0 C0 10 10 10 10 0 Z', 16);
        const b = bbox(p);
        expect(b.minX).toBeCloseTo(0, 5);
        expect(b.maxX).toBeCloseTo(10, 5);
        expect(b.minY).toBeCloseTo(0, 5);
        expect(b.maxY).toBeGreaterThan(6); // bows downward toward the controls
        expect(p.length).toBeGreaterThan(10); // sampled into many segments
    });

    it('material heart path flattens to a sane heart bbox', () => {
        const heart = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3'
            + 'c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5'
            + 'c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
        const p = flattenPath(heart);
        const b = bbox(p);
        expect(b.minX).toBeCloseTo(2, 0);
        expect(b.maxX).toBeCloseTo(22, 0);
        expect(b.minY).toBeCloseTo(3, 0);
        expect(b.maxY).toBeCloseTo(21.35, 0);
        // Point at the bottom-center is inside; the top-center notch is not.
        expect(inside(12, 18, p)).toBe(true);
        expect(inside(12, 4, p)).toBe(false);
    });
});
