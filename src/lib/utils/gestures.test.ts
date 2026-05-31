import { describe, it, expect } from 'vitest';
import { clampPan, cellAt, maxScaleFor, MIN_MAX_SCALE } from './gestures';

const CONTAINER_W = 400;
const CONTAINER_H = 600;
const W = 10; // grid width in cells
const H = 15; // grid height in cells
const RECT = { left: 0, top: 0 };

describe('maxScaleFor', () => {
	it('floors small grids at MIN_MAX_SCALE instead of removing zoom', () => {
		// Easy 6×6 and Normal 9×9 are at/below the 8-cell target window, so
		// the formula (min/8 = 0.75 and 1.125) is overridden by the floor.
		expect(maxScaleFor(6, 6)).toBe(MIN_MAX_SCALE);
		expect(maxScaleFor(9, 9)).toBe(MIN_MAX_SCALE);
	});

	it('scales with grid size so max zoom shows ~8 cells across', () => {
		// Big grids zoom far enough to reach the standard cell size.
		expect(maxScaleFor(180, 180)).toBeCloseTo(22.5); // Iron Tangle (was capped at 8)
		expect(maxScaleFor(64, 64)).toBe(8);             // Expert-ish
	});

	it('uses the shorter axis on lopsided grids, not the width', () => {
		// 200×32 → driven by 32 (the shorter side): 32/8 = 4, not 200/8 = 25.
		expect(maxScaleFor(200, 32)).toBe(4);
		expect(maxScaleFor(32, 200)).toBe(4); // orientation-independent
	});
});

describe('clampPan', () => {
	it('forces pan to (0, 0) at scale 1 (no zoom)', () => {
		expect(clampPan(50, -30, 1, CONTAINER_W, CONTAINER_H)).toEqual({ x: 0, y: 0 });
	});

	it('forces pan to (0, 0) at scale below 1', () => {
		expect(clampPan(50, -30, 0.5, CONTAINER_W, CONTAINER_H)).toEqual({ x: 0, y: 0 });
	});

	it('allows negative pan up to containerSize * (1 - scale) at scale > 1', () => {
		// At scale 2, container content is 2x the container; pan can range
		// from -containerW to 0 (and -containerH to 0).
		const minX = CONTAINER_W * (1 - 2); // -400
		const minY = CONTAINER_H * (1 - 2); // -600
		expect(clampPan(minX, minY, 2, CONTAINER_W, CONTAINER_H)).toEqual({ x: minX, y: minY });
	});

	it('clamps pan that would expose the right/bottom edge', () => {
		// Trying to pan further negative than allowed should snap to the limit.
		const tooNegativeX = -10_000;
		const tooNegativeY = -10_000;
		expect(clampPan(tooNegativeX, tooNegativeY, 2, CONTAINER_W, CONTAINER_H)).toEqual({
			x: CONTAINER_W * (1 - 2),
			y: CONTAINER_H * (1 - 2),
		});
	});

	it('clamps positive pan to 0 (can not expose left/top gutter)', () => {
		expect(clampPan(50, 50, 3, CONTAINER_W, CONTAINER_H)).toEqual({ x: 0, y: 0 });
	});
});

describe('cellAt', () => {
	it('returns null when container has zero size (not yet measured)', () => {
		expect(cellAt(100, 100, RECT, 0, 0, 0, 0, 1, W, H)).toBeNull();
	});

	it('returns the top-left cell when tapping the corner at scale 1', () => {
		// Tap exactly at the rect origin → maps to the negative gutter
		// (viewBox starts at -0.1), so floor gives -1, which is outside
		// the playfield → null.
		expect(cellAt(0, 0, RECT, CONTAINER_W, CONTAINER_H, 0, 0, 1, W, H)).toBeNull();
	});

	it('returns cell (0, 0) when tapping inside the first cell at scale 1', () => {
		// At scale 1, the viewBox is (-0.1, -0.1, W+0.2, H+0.2). Cell (0,0)
		// occupies svgX/svgY in [0, 1). Tap at ~10% into container width and
		// 4% into height should hit (0, 0).
		const px = (0.5 / (W + 0.2)) * CONTAINER_W + CONTAINER_W * 0.1 / (W + 0.2);
		const py = (0.5 / (H + 0.2)) * CONTAINER_H + CONTAINER_H * 0.1 / (H + 0.2);
		const result = cellAt(px, py, RECT, CONTAINER_W, CONTAINER_H, 0, 0, 1, W, H);
		expect(result).toEqual({ x: 0, y: 0 });
	});

	it('returns the last cell when tapping near the bottom-right at scale 1', () => {
		// Aim for the center of cell (W-1, H-1).
		const svgTargetX = (W - 1) + 0.5; // 9.5
		const svgTargetY = (H - 1) + 0.5; // 14.5
		// Inverse of svgX = -0.1 + (clientX / containerW) * (W + 0.2):
		const px = (svgTargetX + 0.1) / (W + 0.2) * CONTAINER_W;
		const py = (svgTargetY + 0.1) / (H + 0.2) * CONTAINER_H;
		expect(cellAt(px, py, RECT, CONTAINER_W, CONTAINER_H, 0, 0, 1, W, H))
			.toEqual({ x: W - 1, y: H - 1 });
	});

	it('returns null for taps in the gutter past the playfield', () => {
		// clientX past containerW maps past W in the grid.
		expect(cellAt(CONTAINER_W + 50, 100, RECT, CONTAINER_W, CONTAINER_H, 0, 0, 1, W, H))
			.toBeNull();
	});

	it('honors a non-zero rect.left/top offset', () => {
		// If the container is offset 100px from the viewport origin, a tap
		// at clientX=100, clientY=0 is at the rect's local (0, 0) — same as
		// the corner test above → null (negative gutter).
		const offsetRect = { left: 100, top: 50 };
		expect(cellAt(100, 50, offsetRect, CONTAINER_W, CONTAINER_H, 0, 0, 1, W, H))
			.toBeNull();
	});

	it('accounts for zoom: same clientX maps to a different cell when zoomed in', () => {
		// At scale 1, tap at half the container width should land near cell W/2.
		const halfX = CONTAINER_W / 2;
		const halfY = CONTAINER_H / 2;
		const unzoomed = cellAt(halfX, halfY, RECT, CONTAINER_W, CONTAINER_H, 0, 0, 1, W, H);
		// At scale 4 (no pan), the visible viewport now covers only 1/4 of
		// the grid from the top-left, so the same tap lands much closer to
		// origin in grid terms.
		const zoomed = cellAt(halfX, halfY, RECT, CONTAINER_W, CONTAINER_H, 0, 0, 4, W, H);
		expect(unzoomed).not.toBeNull();
		expect(zoomed).not.toBeNull();
		// The zoomed result should be at a lower (x, y) than the unzoomed one.
		expect(zoomed!.x).toBeLessThan(unzoomed!.x);
		expect(zoomed!.y).toBeLessThan(unzoomed!.y);
	});

	it('accounts for pan: shifting panX moves the cell under a fixed clientX', () => {
		// At scale 2, pan range is [-containerW, 0]. With pan = 0, a tap at
		// clientX = containerW/2 maps to some grid X. Panning the content
		// negatively (which visually moves content left) reveals further-right
		// cells under the same fixed tap.
		const halfX = CONTAINER_W / 2;
		const halfY = CONTAINER_H / 2;
		const noPan = cellAt(halfX, halfY, RECT, CONTAINER_W, CONTAINER_H, 0, 0, 2, W, H);
		const panned = cellAt(halfX, halfY, RECT, CONTAINER_W, CONTAINER_H,
			-CONTAINER_W * 0.5, 0, 2, W, H);
		expect(noPan).not.toBeNull();
		expect(panned).not.toBeNull();
		expect(panned!.x).toBeGreaterThan(noPan!.x);
	});
});
