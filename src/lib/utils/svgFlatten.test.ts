import { describe, it, expect } from 'vitest';
import { flattenPath, bbox, svgToPath, svgAttr, type Pt } from './svgFlatten';

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

    it('svgToPath: extracts <path d>', () => {
        const d = svgToPath('<svg><path d="M0 0 L10 0 L10 10 Z" fill="red"/></svg>');
        expect(d).toBe('M0 0 L10 0 L10 10 Z');
    });

    it('svgToPath: converts <polygon> to a closed path', () => {
        const d = svgToPath('<svg><polygon points="0,0 10,0 5,10"/></svg>');
        const p = flattenPath(d);
        expect(bbox(p)).toMatchObject({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
        expect(inside(5, 3, p)).toBe(true);
    });

    it('svgToPath: converts <rect> and <circle> to fillable paths', () => {
        const rect = flattenPath(svgToPath('<svg><rect x="0" y="0" width="10" height="6"/></svg>'));
        expect(bbox(rect)).toMatchObject({ minX: 0, minY: 0, maxX: 10, maxY: 6 });
        expect(inside(5, 3, rect)).toBe(true);

        const circle = flattenPath(svgToPath('<svg><circle cx="10" cy="10" r="10"/></svg>'));
        const b = bbox(circle);
        expect(b.minX).toBeCloseTo(0, 1);
        expect(b.maxX).toBeCloseTo(20, 1);
        expect(inside(10, 10, circle)).toBe(true);  // center in
        expect(inside(0.5, 0.5, circle)).toBe(false); // corner out
    });

    it('arc command: a circle via two semicircle arcs', () => {
        // Two arcs sweeping back to start trace a full circle, r=5 at (5,5).
        const p = flattenPath('M0 5 A5 5 0 0 1 10 5 A5 5 0 0 1 0 5 Z', 24);
        const b = bbox(p);
        expect(b.minX).toBeCloseTo(0, 1);
        expect(b.maxX).toBeCloseTo(10, 1);
        expect(b.minY).toBeCloseTo(0, 1);
        expect(b.maxY).toBeCloseTo(10, 1);
        expect(inside(5, 5, p)).toBe(true);
        expect(inside(0.3, 0.3, p)).toBe(false); // corner outside the circle
    });

    it('arc command: relative arcs (ghost head) advance the cursor correctly', () => {
        // Mirrors the ghost head: relative arc then a vertical line down.
        const p = flattenPath('M12 2a9 9 0 0 0-9 9v6h18V11a9 9 0 0 0-9-9Z', 16);
        const b = bbox(p);
        expect(b.minX).toBeCloseTo(3, 0);
        expect(b.maxX).toBeCloseTo(21, 0);
        expect(b.minY).toBeCloseTo(2, 0);
        expect(inside(12, 10, p)).toBe(true);
    });

    it('svgAttr: reads root attributes', () => {
        const svg = '<svg viewBox="0 0 24 24" data-min-filled="120"><path d="M0 0"/></svg>';
        expect(svgAttr(svg, 'viewBox')).toBe('0 0 24 24');
        expect(svgAttr(svg, 'data-min-filled')).toBe('120');
        expect(svgAttr(svg, 'data-nope')).toBeUndefined();
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
