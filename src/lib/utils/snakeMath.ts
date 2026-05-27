// ─── snake geometry helpers ──────────────────────────────────────────────────

import type { Direction, GridPos, Arrow } from '$lib/types';

export const DIR_ROT: Record<Direction, number> = { E: 0, S: 90, W: 180, N: 270 };

export const DELTA: Record<Direction, { dx: number; dy: number }> = {
	N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
	E: { dx: 1,  dy: 0 }, W: { dx: -1, dy: 0 },
};

// Extended-path position: negative indices step backwards from path[0] in
// the exit direction, so the drain animation can slide the snake off-grid.
export function extPos(path: GridPos[], i: number, d: { dx: number; dy: number }): GridPos {
	if (i >= 0) return path[i];
	return { x: path[0].x + (-i) * d.dx, y: path[0].y + (-i) * d.dy };
}

// Interpolated segment position along an extended path.
export function segPos(path: GridPos[], k: number, s: number, d: { dx: number; dy: number }): GridPos {
	const lo = Math.floor(s), f = s - lo;
	const a = extPos(path, k - lo,     d);
	const b = extPos(path, k - lo - 1, d);
	return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Number of cells from the arrow's head to the grid boundary in the exit direction.
// Equals 1 when the head is already on the edge row/column.
export function exitCellCount(arrow: Arrow, W: number, H: number): number {
	const h = arrow.path[0];
	return arrow.direction === 'W' ? h.x + 1
		:  arrow.direction === 'E' ? W - h.x
		:  arrow.direction === 'N' ? h.y + 1
		:                            H - h.y;
}
