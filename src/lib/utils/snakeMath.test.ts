import { describe, it, expect } from 'vitest';
import { exitCellCount, checkBlocked } from './snakeMath';
import type { Arrow, Anim } from '$lib/types';

describe('exitCellCount', () => {
    function makeArrow(direction: Arrow['direction'], headX: number, headY: number): Arrow {
        return {
            id: 0,
            direction,
            path: [{ x: headX, y: headY }],
            color: '#000',
        };
    }

    it('returns 1 when the head is already on the exit edge', () => {
        expect(exitCellCount(makeArrow('W', 0, 5), 10, 10)).toBe(1);
        expect(exitCellCount(makeArrow('E', 9, 5), 10, 10)).toBe(1);
        expect(exitCellCount(makeArrow('N', 5, 0), 10, 10)).toBe(1);
        expect(exitCellCount(makeArrow('S', 5, 9), 10, 10)).toBe(1);
    });

    it('counts cells to the exit when the head is interior', () => {
        // 10-wide grid, head at x=3 exiting West: cells 3, 2, 1, 0 → 4
        expect(exitCellCount(makeArrow('W', 3, 5), 10, 10)).toBe(4);
        // East exit from x=3 on a 10-wide grid: cells 3, 4, 5, 6, 7, 8, 9 → 7
        expect(exitCellCount(makeArrow('E', 3, 5), 10, 10)).toBe(7);
        expect(exitCellCount(makeArrow('N', 5, 4), 10, 10)).toBe(5);
        expect(exitCellCount(makeArrow('S', 5, 4), 10, 10)).toBe(6);
    });
});

describe('checkBlocked', () => {
    function arrowAt(id: number, direction: Arrow['direction'], path: { x: number; y: number }[]): Arrow {
        return { id, direction, path, color: '#000' };
    }

    it('returns unblocked when the path to the edge is clear', () => {
        const a = arrowAt(0, 'E', [{ x: 0, y: 0 }]);
        const r = checkBlocked(a, [a], new Set(), {}, 5, 5);
        expect(r.blocked).toBe(false);
    });

    it('returns blocked at the right distance when another arrow stands in the way', () => {
        const exit = arrowAt(0, 'E', [{ x: 0, y: 0 }]);
        const wall = arrowAt(1, 'S', [{ x: 3, y: 0 }, { x: 3, y: 1 }]);
        const r = checkBlocked(exit, [exit, wall], new Set(), {}, 5, 5);
        expect(r).toEqual({ blocked: true, dist: 2 }); // cells (1,0) and (2,0) are clear
    });

    it('ignores removed arrows when building walls', () => {
        const exit = arrowAt(0, 'E', [{ x: 0, y: 0 }]);
        const wall = arrowAt(1, 'S', [{ x: 3, y: 0 }]);
        const r = checkBlocked(exit, [exit, wall], new Set([1]), {}, 5, 5);
        expect(r.blocked).toBe(false);
    });

    it('ignores arrows currently in the `exiting` animation phase', () => {
        const exit = arrowAt(0, 'E', [{ x: 0, y: 0 }]);
        const wall = arrowAt(1, 'S', [{ x: 3, y: 0 }]);
        const anims: Record<number, Anim> = {
            1: { phase: 'exiting', startTime: 0 },
        };
        const r = checkBlocked(exit, [exit, wall], new Set(), anims, 5, 5);
        expect(r.blocked).toBe(false);
    });
});
