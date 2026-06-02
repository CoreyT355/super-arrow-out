import { describe, it, expect } from 'vitest';
import {
    SHAPES,
    NON_CLASSIC_SHAPES,
    CLASSIC,
    shapeById,
    rasterizeShape,
    countFilled,
    computeShapedGridSize,
    eligibleShapes,
    shapePathInGrid,
} from './shapes';

// 4-connectivity check: every true cell reachable from the first true cell.
function isConnected(mask: boolean[], w: number, h: number): boolean {
    const start = mask.indexOf(true);
    if (start === -1) return true;
    const seen = new Uint8Array(w * h);
    const queue = [start];
    seen[start] = 1;
    let head = 0, count = 0;
    while (head < queue.length) {
        const k = queue[head++];
        count++;
        const x = k % w, y = (k - (k % w)) / w;
        const ns = [
            x > 0 ? k - 1 : -1,
            x < w - 1 ? k + 1 : -1,
            y > 0 ? k - w : -1,
            y < h - 1 ? k + w : -1,
        ];
        for (const n of ns) {
            if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
        }
    }
    return count === countFilled(mask);
}

describe('shape catalog', () => {
    it('has classic first and the full shape set', () => {
        expect(SHAPES[0].id).toBe('classic');
        expect(SHAPES.map(s => s.id).sort()).toEqual(
            ['circle', 'classic', 'diamond', 'ghost', 'heart', 'hexagon', 'star', 'triangle'],
        );
        expect(NON_CLASSIC_SHAPES.every(s => s.id !== 'classic')).toBe(true);
    });

    it('resolves ids, falling back to classic', () => {
        expect(shapeById('heart').id).toBe('heart');
        expect(shapeById(undefined).id).toBe('classic');
        expect(shapeById('nope').id).toBe('classic');
        expect(CLASSIC.id).toBe('classic');
    });
});

describe('rasterizeShape', () => {
    it('classic fills every cell', () => {
        const mask = rasterizeShape(CLASSIC, 7, 9);
        expect(countFilled(mask)).toBe(63);
        expect(mask.every(Boolean)).toBe(true);
    });

    for (const shape of NON_CLASSIC_SHAPES) {
        it(`${shape.id}: fills a strict, connected subset`, () => {
            const w = 40, h = 40;
            const mask = rasterizeShape(shape, w, h);
            const filled = countFilled(mask);
            expect(filled).toBeGreaterThan(0);
            expect(filled).toBeLessThan(w * h); // a real shape leaves corners empty
            expect(isConnected(mask, w, h)).toBe(true);
        });

        it(`${shape.id}: top corners are outside the mask`, () => {
            // Top corners are outside for every shape in the catalog. (Bottom
            // corners can be inside — e.g. a triangle's base spans the width.)
            const w = 40, h = 40;
            const mask = rasterizeShape(shape, w, h);
            expect(mask[0]).toBe(false);       // top-left
            expect(mask[w - 1]).toBe(false);   // top-right
        });

        it(`${shape.id}: center cell is inside the mask`, () => {
            const w = 41, h = 41;
            const mask = rasterizeShape(shape, w, h);
            const cx = 20, cy = 20;
            // Heart's exact center can sit in the top notch; sample just below.
            const probe = shape.id === 'heart' ? (cy + 4) * w + cx : cy * w + cx;
            expect(mask[probe]).toBe(true);
        });
    }
});

describe('ghost holes (even-odd sub-paths)', () => {
    // Regression: the ghost's eyes are separate sub-paths. Flattening them into
    // one polygon used to join the body to each eye with spurious edges, which
    // carved an empty triangle between the eyes. Rings + even-odd fixes it.
    it('flattens to multiple rings (body + 2 eyes)', () => {
        expect(shapeById('ghost').polygon!.length).toBeGreaterThan(1);
    });

    it('the eyes are holes but the area between them stays filled', () => {
        const w = 40, h = 40;
        const mask = rasterizeShape(shapeById('ghost'), w, h);
        const at = (x: number, y: number) => mask[y * w + x];
        // An eye on each side of center is hollow...
        expect(at(13, 15)).toBe(false); // left eye
        expect(at(26, 15)).toBe(false); // right eye
        // ...but the bridge between them (and above) is filled, not a triangle.
        expect(at(20, 15)).toBe(true);  // between the eyes
        expect(at(20, 9)).toBe(true);   // above the eyes
    });
});

describe('computeShapedGridSize', () => {
    it('classic returns a square grid matching the target', () => {
        const g = computeShapedGridSize(CLASSIC, 81);
        expect(g.w).toBe(9);
        expect(g.h).toBe(9);
        expect(g.filled).toBe(81);
    });

    for (const shape of NON_CLASSIC_SHAPES) {
        for (const target of [shape.minFilled, 200, 600]) {
            it(`${shape.id}: filled ≈ target (${target})`, () => {
                const g = computeShapedGridSize(shape, target);
                expect(g.filled).toBe(countFilled(g.mask));
                expect(isConnected(g.mask, g.w, g.h)).toBe(true);
                // Within 20% of the requested filled-cell count.
                const err = Math.abs(g.filled - target) / target;
                expect(err).toBeLessThan(0.2);
                // Aspect of the grid stays near the shape's natural aspect.
                const gridAspect = g.w / g.h;
                expect(Math.abs(gridAspect - shape.aspect)).toBeLessThan(0.35);
            });
        }
    }
});

describe('computeShapedGridSize — viewport aspect padding', () => {
    // The board must fill the same on-screen area as classic, so a shape is
    // padded out to the requested (viewport) aspect and centred, rather than
    // sizing the grid to the shape's own aspect (which boxed pan/zoom in).
    it('grid matches the target aspect, not the shape aspect', () => {
        const heart = shapeById('heart');
        const targetAspect = 0.5; // tall portrait phone
        const g = computeShapedGridSize(heart, 300, targetAspect);
        expect(Math.abs(g.w / g.h - targetAspect)).toBeLessThan(0.12);
        // Still hits the filled target and stays one connected blob.
        expect(g.filled).toBe(countFilled(g.mask));
        expect(isConnected(g.mask, g.w, g.h)).toBe(true);
        expect(Math.abs(g.filled - 300) / 300).toBeLessThan(0.2);
        // The shape is contain-fit, so the rect has empty padding around it.
        expect(g.filled).toBeLessThan(g.w * g.h * 0.85);
    });

    it('top rows are empty padding when the grid is taller than the shape', () => {
        const g = computeShapedGridSize(shapeById('heart'), 300, 0.5);
        // Whole first row should be out-of-shape (shape is centred lower down).
        const firstRowEmpty = Array.from({ length: g.w }, (_, x) => g.mask[x]).every(v => !v);
        expect(firstRowEmpty).toBe(true);
    });
});

describe('eligibleShapes', () => {
    it('only classic at tiny sizes', () => {
        expect(eligibleShapes(10).map(s => s.id)).toEqual(['classic']);
    });
    it('adds shapes as the target grows', () => {
        const at36 = eligibleShapes(36).map(s => s.id);
        expect(at36).toEqual(expect.arrayContaining(['classic', 'diamond', 'circle', 'triangle', 'hexagon']));
        expect(at36).not.toContain('heart'); // heart min is 80
        expect(at36).not.toContain('star');  // star min is 120
        expect(eligibleShapes(100).map(s => s.id)).toContain('heart');
        expect(eligibleShapes(100).map(s => s.id)).not.toContain('star');
        expect(eligibleShapes(150).map(s => s.id)).toContain('star');
    });
});

describe('shapePathInGrid', () => {
    it('classic is the full rect', () => {
        expect(shapePathInGrid(CLASSIC, 10, 8)).toBe('M 0 0 H 10 V 8 H 0 Z');
    });
    it('non-classic produces a closed polygon path scaled to the grid', () => {
        const d = shapePathInGrid(shapeById('diamond'), 10, 10);
        expect(d.startsWith('M ')).toBe(true);
        expect(d.endsWith(' Z')).toBe(true);
        expect(d).toContain('L');
    });
});
