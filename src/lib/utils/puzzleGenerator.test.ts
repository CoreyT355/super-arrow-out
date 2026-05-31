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
    // ─── solvability: ground-truth simulator ──────────────────────────────
    //
    // The production code uses a topological peel of the blocking
    // dependency graph to verify solvability. That's a constructive proof,
    // but proofs can have implementation bugs. This block adds an
    // independent simulator that mirrors the runtime's `checkBlocked`
    // rule exactly:
    //
    //   "Arrow A is blocked at moment M if walking from A's head in A's
    //    exit direction hits a cell belonging to any other arrow that is
    //    still present (not yet drained) at moment M."
    //
    // The simulator picks tap targets in arbitrary order (any non-blocked
    // arrow), drains it, and repeats. If it can drain every arrow, the
    // puzzle is solvable BY THE GAME'S OWN RULES, not by my topo
    // interpretation of them.
    //
    // We run the simulator on every generated level and assert it agrees
    // with the topo check. Disagreement = a bug in one of them.

    /** Returns true if `arrow` can be tapped right now: nothing in `present`
     *  except itself occupies a cell on its exit ray. Same shape as the
     *  runtime `checkBlocked` in +page.svelte. */
    function isTappableNow(
        arrow: Arrow,
        present: Set<number>,
        cellOwner: Map<string, number>,
        w: number,
        h: number,
    ): boolean {
        const d = OUTWARD[arrow.direction];
        let x = arrow.path[0].x + d.dx;
        let y = arrow.path[0].y + d.dy;
        while (x >= 0 && x < w && y >= 0 && y < h) {
            const owner = cellOwner.get(`${x},${y}`);
            if (owner !== undefined && owner !== arrow.id && present.has(owner)) {
                return false;
            }
            x += d.dx;
            y += d.dy;
        }
        return true;
    }

    /** Drain the level by greedily picking any tappable arrow. Returns the
     *  number drained. Equal to arrows.length iff solvable. */
    function simulateDrain(arrows: Arrow[], w: number, h: number): number {
        const cellOwner = new Map<string, number>();
        for (const a of arrows) for (const p of a.path) cellOwner.set(`${p.x},${p.y}`, a.id);
        const byId = new Map(arrows.map(a => [a.id, a]));
        const present = new Set(arrows.map(a => a.id));
        let drained = 0;
        let progress = true;
        while (progress && present.size > 0) {
            progress = false;
            for (const id of present) {
                if (isTappableNow(byId.get(id)!, present, cellOwner, w, h)) {
                    present.delete(id);
                    drained++;
                    progress = true;
                    break; // re-scan; ordering matters less than termination
                }
            }
        }
        return drained;
    }

    // Every shipped puzzle must be drainable by gameplay rules AND free of
    // self-blocked arrows. Trial counts are high enough to give real
    // statistical confidence on each shipped grid size — on a randomized
    // generator, "didn't see the bug 3 times" is not the same as "the bug
    // is gone." Roughly: at ~88ms/Ludicrous gen, 50 trials ≈ 4.5s.
    it('every level is drainable and free of self-blocked arrows', () => {
        const cases: Array<[number, number, number]> = [
            [6, 6,     500], // Easy
            [9, 9,     500], // Normal
            [15, 17,   200], // Hard
            [30, 34,   100], // Super Hard
            [60, 68,    30], // Expert
            [120, 137,  20], // Ludicrous (non-square ~16384 cells)
            [180, 180,  16], // The Iron Tangle (~32400 cells) — the deadlock
                             // rate here is high enough that the deterministic
                             // repair in generateLevel must guarantee solvability.
        ];
        let totalDrained = 0;
        let totalArrows = 0;
        for (const [w, h, trials] of cases) {
            for (let trial = 0; trial < trials; trial++) {
                // Seed each trial so any failure is reproducible from the
                // printed (w, h, seed) tuple — no Math.random reruns needed.
                const seed = (w * 1_000_003) ^ (h * 19_349_663) ^ (trial * 83_492_791);
                const level = generateLevel(w, h, seed);

                for (const arrow of level.arrows) {
                    if (isSelfBlocked(arrow, w, h)) {
                        throw new Error(
                            `Self-blocked arrow on ${w}x${h} seed=${seed}: ` +
                            `id=${arrow.id} dir=${arrow.direction} head=${JSON.stringify(arrow.path[0])} path=${JSON.stringify(arrow.path)}`
                        );
                    }
                }

                // Topo-based check (the production criterion).
                const topo = isSolvable(level.arrows, w, h);
                // Ground truth: actually drain the level using runtime rules.
                const drained = simulateDrain(level.arrows, w, h);
                const sim = drained === level.arrows.length;

                if (topo !== sim) {
                    throw new Error(
                        `Solvability mismatch on ${w}x${h} seed=${seed}: ` +
                        `topo=${topo} simulator=${sim} drained=${drained}/${level.arrows.length}`
                    );
                }
                if (!sim) {
                    throw new Error(
                        `Unsolvable puzzle on ${w}x${h} seed=${seed}: ` +
                        `simulator drained ${drained}/${level.arrows.length}`
                    );
                }
                totalDrained += drained;
                totalArrows += level.arrows.length;
            }
        }
        // Sanity: the suite should have actually exercised something.
        expect(totalArrows).toBeGreaterThan(0);
        expect(totalDrained).toBe(totalArrows);
    }, 300_000);

    // Regression for the unsolvable Iron Tangle puzzles: this seed deadlocks
    // through all of generateLevel's natural retry attempts, so it exercises
    // the deterministic repair path directly. Before the repair existed,
    // generateLevel shipped this board with hundreds of un-tappable arrows.
    it('repairs a known-deadlocking Iron Tangle seed into a solvable board', () => {
        const w = 180, h = 180;
        const level = generateLevel(w, h, 1005);
        // Full tiling preserved by the repair.
        const covered = new Set<string>();
        for (const a of level.arrows) for (const p of a.path) covered.add(`${p.x},${p.y}`);
        expect(covered.size).toBe(w * h);
        // No self-blocked arrows, and the board fully drains by game rules.
        for (const a of level.arrows) {
            expect(isSelfBlocked(a, w, h), `self-blocked arrow id=${a.id}`).toBe(false);
        }
        expect(simulateDrain(level.arrows, w, h)).toBe(level.arrows.length);
    }, 60_000);

    // Reproducibility: same seed must produce the same level. This is
    // worth its own assertion so the seeded-trial messages above are
    // trustworthy — a printed seed reproduces the failure on demand.
    it('seed produces deterministic output', () => {
        const a = generateLevel(15, 17, 42);
        const b = generateLevel(15, 17, 42);
        expect(a.arrows.length).toBe(b.arrows.length);
        for (let i = 0; i < a.arrows.length; i++) {
            expect(a.arrows[i].direction).toBe(b.arrows[i].direction);
            expect(a.arrows[i].path).toEqual(b.arrows[i].path);
        }
    });

    // The simulator itself: confirm it correctly reports a synthetic
    // deadlock as unsolvable. Two arrows facing into each other's bodies.
    it('simulator detects a hand-crafted deadlock', () => {
        // 3-wide row:  →B B A←        (A points west, B points east)
        // A's body is at (2,0); A points west → ray hits (1,0),(0,0) → B's body.
        // B's body is at (0,0); B points east → ray hits (1,0),(2,0) → A's body.
        // Neither can ever drain.
        const deadlock: Arrow[] = [
            { id: 0, direction: 'W', path: [{ x: 2, y: 0 }], color: '#000' },
            { id: 1, direction: 'E', path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: '#000' },
        ];
        expect(simulateDrain(deadlock, 3, 1)).toBeLessThan(deadlock.length);
        expect(isSolvable(deadlock, 3, 1)).toBe(false);
    });

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
