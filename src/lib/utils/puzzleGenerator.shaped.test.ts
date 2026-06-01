import { describe, it, expect } from 'vitest';
import { generateLevel } from './puzzleGenerator';
import { NON_CLASSIC_SHAPES, computeShapedGridSize } from '$lib/config/shapes';
import type { Arrow, Direction } from '$lib/types';

// Black-box validators, re-declared (not imported) so the tests assert the
// generator's external contract. Rays walk to the RECTANGLE edge and only
// arrow-owned cells block — i.e. the "transparent outside" model, where
// out-of-shape cells are see-through. This must match runtime checkBlocked.

const OUTWARD: Record<Direction, { dx: number; dy: number }> = {
    N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
    E: { dx: 1, dy: 0 },  W: { dx: -1, dy: 0 },
};

function isSelfBlocked(arrow: Arrow, w: number, h: number): boolean {
    const d = OUTWARD[arrow.direction];
    const own = new Set(arrow.path.map(p => `${p.x},${p.y}`));
    let x = arrow.path[0].x + d.dx;
    let y = arrow.path[0].y + d.dy;
    while (x >= 0 && x < w && y >= 0 && y < h) {
        if (own.has(`${x},${y}`)) return true;
        x += d.dx; y += d.dy;
    }
    return false;
}

function isSolvable(arrows: Arrow[], w: number, h: number): boolean {
    const owner = new Map<string, number>();
    for (const a of arrows) for (const p of a.path) owner.set(`${p.x},${p.y}`, a.id);
    const deps = new Map<number, Set<number>>();
    for (const a of arrows) {
        const set = new Set<number>();
        const d = OUTWARD[a.direction];
        let x = a.path[0].x + d.dx;
        let y = a.path[0].y + d.dy;
        while (x >= 0 && x < w && y >= 0 && y < h) {
            const o = owner.get(`${x},${y}`);
            if (o !== undefined && o !== a.id) set.add(o);
            x += d.dx; y += d.dy;
        }
        deps.set(a.id, set);
    }
    const removed = new Set<number>();
    let progress = true;
    while (progress && removed.size < arrows.length) {
        progress = false;
        for (const a of arrows) {
            if (removed.has(a.id)) continue;
            let ready = true;
            for (const d of deps.get(a.id)!) {
                if (!removed.has(d)) { ready = false; break; }
            }
            if (ready) { removed.add(a.id); progress = true; }
        }
    }
    return removed.size === arrows.length;
}

const SEEDS = Array.from({ length: 30 }, (_, i) => i * 1013 + 7);

describe('shaped puzzle generation', () => {
    for (const shape of NON_CLASSIC_SHAPES) {
        // A few sizes spanning the shape's eligible range.
        const targets = [shape.minFilled, 150, 400];
        for (const target of targets) {
            const { w, h, mask, filled } = computeShapedGridSize(shape, target);
            const inShape = (p: { x: number; y: number }) => mask[p.y * w + p.x];

            describe(`${shape.id} @ target ${target} (${w}×${h}, ${filled} filled)`, () => {
                for (const seed of SEEDS) {
                    it(`seed ${seed}: tiles the mask, in-bounds, solvable`, () => {
                        const level = generateLevel(w, h, seed, mask);
                        const arrows = level.arrows;

                        // 1. Every arrow cell is inside the shape (no void cells used).
                        for (const a of arrows) {
                            for (const p of a.path) {
                                expect(p.x).toBeGreaterThanOrEqual(0);
                                expect(p.y).toBeGreaterThanOrEqual(0);
                                expect(p.x).toBeLessThan(w);
                                expect(p.y).toBeLessThan(h);
                                expect(inShape(p)).toBe(true);
                            }
                        }

                        // 2. Arrows tile the masked region exactly: no overlaps,
                        //    full coverage of every in-shape cell.
                        const cells = new Set<string>();
                        let total = 0;
                        for (const a of arrows) {
                            for (const p of a.path) { cells.add(`${p.x},${p.y}`); total++; }
                        }
                        expect(total).toBe(cells.size);   // no cell covered twice
                        expect(cells.size).toBe(filled);  // covers the whole mask

                        // 3. No arrow visually blocks itself.
                        for (const a of arrows) {
                            expect(isSelfBlocked(a, w, h)).toBe(false);
                        }

                        // 4. The puzzle is actually solvable (blocking graph is a DAG).
                        expect(isSolvable(arrows, w, h)).toBe(true);
                    });
                }
            });
        }
    }
});
