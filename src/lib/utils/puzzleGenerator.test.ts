import { describe, it, expect } from 'vitest';
import { generateLevel } from './puzzleGenerator';
import type { Arrow, Direction } from '$lib/types';

// Mirror of OUTWARD inside the generator. Re-declared rather than imported
// so the test can stay an external black-box contract.
const OUTWARD: Record<Direction, { dx: number; dy: number }> = {
    N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
    E: { dx: 1, dy: 0 },  W: { dx: -1, dy: 0 },
};

/** True if any cell of `arrow`'s own body sits in its head's exit ray. */
function isSelfBlocked(arrow: Arrow, w: number, h: number): boolean {
    const d = OUTWARD[arrow.direction];
    const own = new Set(arrow.path.map(p => `${p.x},${p.y}`));
    let x = arrow.path[0].x + d.dx;
    let y = arrow.path[0].y + d.dy;
    while (x >= 0 && x < w && y >= 0 && y < h) {
        if (own.has(`${x},${y}`)) return true;
        x += d.dx;
        y += d.dy;
    }
    return false;
}

/** Independent topological peel of the blocking dependency graph. Returns
 *  true iff every arrow can eventually be removed — i.e. no cycle. */
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
            x += d.dx;
            y += d.dy;
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
    // Every shipped puzzle must be solvable: no arrow can be deadlocked
    // behind another arrow that is itself deadlocked behind the first.
    // Self-blocking arrows (own body in own exit ray) read as bugs to the
    // player even though the runtime check excludes the arrow's own body,
    // so they're rejected too.
    it('every level is solvable and free of self-blocked arrows', () => {
        const cases: Array<[number, number]> = [
            [6, 6],     // Easy
            [9, 9],     // Normal
            [15, 17],   // Hard
            [30, 34],   // Super Hard
            [60, 68],   // Expert
            [120, 137], // Ludicrous (closest non-square to 16384 cells)
        ];
        for (const [w, h] of cases) {
            for (let trial = 0; trial < 3; trial++) {
                const level = generateLevel(w, h);
                for (const arrow of level.arrows) {
                    if (isSelfBlocked(arrow, w, h)) {
                        throw new Error(
                            `Self-blocked arrow on ${w}x${h} trial ${trial}: ` +
                            `id=${arrow.id} dir=${arrow.direction} head=${JSON.stringify(arrow.path[0])}`
                        );
                    }
                }
                expect(
                    isSolvable(level.arrows, w, h),
                    `Unsolvable puzzle on ${w}x${h} trial ${trial} (${level.arrows.length} arrows)`,
                ).toBe(true);
            }
        }
    }, 60_000);

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
