// Pure geometry helpers for the pan/zoom/tap gesture pipeline.
// Extracted so they can be unit-tested without a DOM.

export interface Rect {
	left: number;
	top: number;
}

// ─── zoom bounds ───────────────────────────────────────────────────────────
//
// `scale` is relative to "fit": at scale 1 the whole grid fills the container,
// and at scale s the view shows `gridDim / s` cells across that dimension. A
// fixed max scale therefore zooms every difficulty to a DIFFERENT cell size —
// tiny grids blow a single cell up to fill the screen, while huge grids
// (Iron Tangle, 180×180) bottom out far too zoomed-out to tap a cell.
//
// Instead we cap zoom by a target number of visible cells, so max zoom reaches
// the same on-screen cell size on every difficulty.

/** Cells visible across the shorter board axis when fully zoomed in. */
export const MAX_ZOOM_CELLS_ACROSS = 8;
/** Floor on the max scale so small grids (already ≤ the target window) still
 *  get a closer-inspection zoom instead of none. */
export const MIN_MAX_SCALE = 2;

/**
 * Maximum zoom scale for a grid, scaled so that fully zooming in always shows
 * `MAX_ZOOM_CELLS_ACROSS` cells along the shorter axis — a consistent cell
 * size across every difficulty. Floored at `MIN_MAX_SCALE` for grids already
 * smaller than the target window.
 */
export function maxScaleFor(gridW: number, gridH: number): number {
	return Math.max(MIN_MAX_SCALE, Math.min(gridW, gridH) / MAX_ZOOM_CELLS_ACROSS);
}

/**
 * Clamps a proposed pan offset so the scaled content can't be dragged past
 * the container edges. When scale <= 1 the content fits exactly and pan is
 * forced to (0, 0). At scale > 1 the content is larger than the container,
 * so pan ranges from `containerSize * (1 - scale)` (right/bottom edge
 * flush) to 0 (left/top edge flush).
 */
export function clampPan(
	px: number,
	py: number,
	scale: number,
	containerW: number,
	containerH: number,
): { x: number; y: number } {
	return {
		x: scale <= 1 ? 0 : Math.min(0, Math.max(containerW * (1 - scale), px)),
		y: scale <= 1 ? 0 : Math.min(0, Math.max(containerH * (1 - scale), py)),
	};
}

/**
 * Converts a viewport (clientX/Y) coordinate to the grid cell beneath it,
 * accounting for the current zoom/pan state. Mirrors the inverse of the
 * svgViewBox transform. Returns null if the point lands outside the
 * playfield (negative cells or cells past W/H), which keeps callers from
 * acting on taps in the surrounding gutter.
 */
export function cellAt(
	clientX: number,
	clientY: number,
	rect: Rect,
	containerW: number,
	containerH: number,
	panX: number,
	panY: number,
	scale: number,
	W: number,
	H: number,
): { x: number; y: number } | null {
	if (!containerW || !containerH) return null;
	const vbW = (W + 0.2) / scale;
	const vbH = (H + 0.2) / scale;
	const vbX = -panX * vbW / containerW - 0.1;
	const vbY = -panY * vbH / containerH - 0.1;
	const svgX = vbX + ((clientX - rect.left) / containerW) * vbW;
	const svgY = vbY + ((clientY - rect.top)  / containerH) * vbH;
	const gx = Math.floor(svgX), gy = Math.floor(svgY);
	if (gx < 0 || gy < 0 || gx >= W || gy >= H) return null;
	return { x: gx, y: gy };
}
