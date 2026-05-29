import { describe, it, expect } from 'vitest';
import { generateLevel } from './puzzleGenerator';
import type { Arrow, Direction } from '$lib/types';

/**
 * The arrowhead is drawn at the head cell (`path[0]`) rotated according to
 * the arrow's `direction` field. For the visual to read correctly, the head
 * must point OUT of the board (i.e. opposite the body tangent at the head).
 *
 * Concretely: if `path[1]` exists, the step from path[0] -> path[1] must
 * equal `-INWARD[direction]` (i.e. the body grows AWAY from where the head
 * points). For head-only arrows (no body), the head/body alignment is
 * trivially satisfied.
 */

const INWARD: Record<Direction, { dx: number; dy: number }> = {
    N: { dx: 0, dy: 1 },
    S: { dx: 0, dy: -1 },
    E: { dx: -1, dy: 0 },
    W: { dx: 1, dy: 0 },
};

function headAlignedWithBody(arrow: Arrow): boolean {
    if (arrow.path.length < 2) return true;
    const head = arrow.path[0];
    const next = arrow.path[1];
    const dx = next.x - head.x;
    const dy = next.y - head.y;
    const inward = INWARD[arrow.direction];
    return dx === inward.dx && dy === inward.dy;
}

describe('generateLevel — head/body alignment invariant', () => {
    // The dimensions below are picked to exercise both small puzzles (where
    // the main placement loop succeeds easily) and tight puzzles (where the
    // rescue pass kicks in and previously produced misaligned arrows).
    const cases: Array<[number, number]> = [
        [6, 6],   // Easy
        [9, 9],   // Normal
        [15, 17], // Hard
        [30, 34], // Super Hard
        [12, 8],  // non-square
        [4, 4],   // smallest reasonable grid
    ];

    for (const [w, h] of cases) {
        it(`every arrow's head direction matches its body tangent (${w}x${h})`, () => {
            // Generate several puzzles per size to shake out RNG-dependent edge cases.
            for (let trial = 0; trial < 8; trial++) {
                const level = generateLevel(w, h);
                for (const arrow of level.arrows) {
                    if (!headAlignedWithBody(arrow)) {
                        // Fail with a useful message — include the offending
                        // arrow so debugging doesn't require re-running.
                        throw new Error(
                            `Misaligned arrow on ${w}x${h} trial ${trial}: ` +
                            `direction=${arrow.direction}, path[0..1]=${JSON.stringify(arrow.path.slice(0, 2))}`
                        );
                    }
                }
            }
        });
    }

    it('every cell is covered by exactly one arrow', () => {
        const w = 9, h = 9;
        for (let trial = 0; trial < 5; trial++) {
            const level = generateLevel(w, h);
            const covered = new Set<string>();
            for (const arrow of level.arrows) {
                for (const cell of arrow.path) {
                    const key = `${cell.x},${cell.y}`;
                    expect(covered.has(key), `cell ${key} covered twice on trial ${trial}`).toBe(false);
                    covered.add(key);
                }
            }
            expect(covered.size).toBe(w * h);
        }
    });

    // A floating arrowhead with no body behind it looks broken even though
    // it's technically aligned (path.length === 1 trivially satisfies the
    // tangent check). At playable grid sizes (Easy 6x6 and up) the cleanup
    // pipeline should always absorb head-only arrows into a neighbour.
    // Trivially small grids (e.g. 4x4) can produce stuck head-only arrows
    // when no neighbour is a tail; they're not a shipped game size.
    it('no arrow is head-only at playable grid sizes', () => {
        // Mirrors DIFFICULTIES in +page.svelte plus a couple of non-square
        // shapes for safety.
        const cases: Array<[number, number]> = [
            [6, 6],    // Easy
            [9, 9],    // Normal
            [15, 17],  // Hard
            [30, 34],  // Super Hard
            [12, 8],   // non-square
            [8, 12],   // non-square, opposite aspect
        ];
        for (const [w, h] of cases) {
            for (let trial = 0; trial < 10; trial++) {
                const level = generateLevel(w, h);
                for (const arrow of level.arrows) {
                    if (arrow.path.length < 2) {
                        throw new Error(
                            `Head-only arrow on ${w}x${h} trial ${trial}: ` +
                            `id=${arrow.id} direction=${arrow.direction} ` +
                            `path=${JSON.stringify(arrow.path)}`
                        );
                    }
                }
            }
        }
    });
});
