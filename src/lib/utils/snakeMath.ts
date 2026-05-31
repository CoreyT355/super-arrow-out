import type { Arrow, GridPos, Anim } from '$lib/types';
import { DELTA } from '$lib/constants/theme';

// ─── snake-flow math ──────────────────────────────────────────────────────────
//
// These helpers describe a snake "moving" along its path during the blocked
// nudge — including imaginary cells extrapolated PAST the head in the exit
// direction (used to project the snake forward while it's nudging into a
// blocker). The blocked-arrow rendering branch uses these every RAF frame.

/** Read path cell `i`, extrapolating past the head when `i < 0` along `d`. */
export function extPos(
    path: GridPos[],
    i: number,
    d: { dx: number; dy: number },
): GridPos {
    if (i >= 0) return path[i];
    return { x: path[0].x + (-i) * d.dx, y: path[0].y + (-i) * d.dy };
}

/** Interpolated position of the snake's k-th body cell after sliding by `s`
 *  cells along the path. Lerps between two integer-shifted positions. */
export function segPos(
    path: GridPos[],
    k: number,
    s: number,
    d: { dx: number; dy: number },
): GridPos {
    const lo = Math.floor(s), f = s - lo;
    const a = extPos(path, k - lo,     d);
    const b = extPos(path, k - lo - 1, d);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** Number of cells from the arrow's head to the grid boundary, measured
 *  along its exit direction. Returns 1 when the head already sits on the
 *  edge row/column it's exiting toward. */
export function exitCellCount(arrow: Arrow, w: number, h: number): number {
    const head = arrow.path[0];
    return arrow.direction === 'W' ? head.x + 1
        :  arrow.direction === 'E' ? w - head.x
        :  arrow.direction === 'N' ? head.y + 1
        :                            h - head.y; // 'S'
}

/** "Can this arrow exit right now?"
 *
 *  Builds a wall-set of every occupied cell from OTHER arrows that aren't
 *  currently exiting, then walks from the head outward in the exit
 *  direction. Returns `blocked: true` if a wall is hit before the boundary,
 *  along with `dist` (the cell distance from head to the blocker — used by
 *  the nudge animation). */
export function checkBlocked(
    arrow: Arrow,
    arrows: Arrow[],
    removed: ReadonlySet<number>,
    anims: Record<number, Anim>,
    w: number,
    h: number,
): { blocked: boolean; dist: number } {
    const d = DELTA[arrow.direction];
    const walls = new Set<string>();
    for (const a of arrows) {
        if (a.id === arrow.id || removed.has(a.id)) continue;
        if (anims[a.id]?.phase === 'exiting') continue;
        for (const p of a.path) walls.add(`${p.x},${p.y}`);
    }
    let { x, y } = arrow.path[0];
    x += d.dx; y += d.dy;
    let dist = 0;
    while (x >= 0 && x < w && y >= 0 && y < h) {
        if (walls.has(`${x},${y}`)) return { blocked: true, dist };
        dist++; x += d.dx; y += d.dy;
    }
    return { blocked: false, dist };
}
