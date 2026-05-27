// ─── SVG path helpers ────────────────────────────────────────────────────────

import type { Arrow, GridPos } from '$lib/types';
import { DELTA, exitCellCount } from '$lib/utils/snakeMath';

// 4-pointed sparkle star — cubic beziers pinch through (±0.08,±0.08) between each tip.
// Normalized to radius 1; scaled per-particle via SVG transform.
export const SPARKLE_PATH =
	'M 0 -1 C 0.08 -0.08 0.08 -0.08 1 0 C 0.08 0.08 0.08 0.08 0 1 ' +
	'C -0.08 0.08 -0.08 0.08 -1 0 C -0.08 -0.08 -0.08 -0.08 0 -1 Z';

// Converts a sequence of grid positions into an SVG path string.
// Straight runs use L; turns use a quadratic bézier (Q) so corners are smooth.
export function roundedPath(pts: { x: number; y: number }[], r: number): string {
	if (pts.length === 0) return '';
	const cx = (p: { x: number; y: number }) => p.x + 0.5;
	const cy = (p: { x: number; y: number }) => p.y + 0.5;
	if (pts.length === 1) return `M ${cx(pts[0])} ${cy(pts[0])}`;
	if (pts.length === 2) return `M ${cx(pts[0])} ${cy(pts[0])} L ${cx(pts[1])} ${cy(pts[1])}`;

	let d = `M ${cx(pts[0])} ${cy(pts[0])}`;

	for (let i = 1; i < pts.length - 1; i++) {
		const ax = cx(pts[i - 1]), ay = cy(pts[i - 1]);
		const bx = cx(pts[i    ]), by = cy(pts[i    ]);
		const ex = cx(pts[i + 1]), ey = cy(pts[i + 1]);

		const dx1 = bx - ax, dy1 = by - ay;
		const dx2 = ex - bx, dy2 = ey - by;
		const len1 = Math.hypot(dx1, dy1) || 1;
		const len2 = Math.hypot(dx2, dy2) || 1;

		// Cross product detects a direction change (turn vs straight)
		if (Math.abs(dx1 * dy2 - dy1 * dx2) < 0.001 * len1 * len2) {
			d += ` L ${bx} ${by}`; // straight — pass through
		} else {
			const r1 = Math.min(r, len1 / 2);
			const r2 = Math.min(r, len2 / 2);
			const p1x = bx - (dx1 / len1) * r1, p1y = by - (dy1 / len1) * r1;
			const p2x = bx + (dx2 / len2) * r2, p2y = by + (dy2 / len2) * r2;
			d += ` L ${p1x} ${p1y} Q ${bx} ${by} ${p2x} ${p2y}`;
		}
	}

	d += ` L ${cx(pts[pts.length - 1])} ${cy(pts[pts.length - 1])}`;
	return d;
}

// Hidden singleton path used to measure SVG path lengths off-screen.
// (getTotalLength works on detached elements in Chrome/Safari; Firefox
//  historically required attachment — so we keep one in a hidden <svg>.)
let _measurer: SVGPathElement | null = null;
export function measurePath(d: string): number {
	if (typeof document === 'undefined') return 0;
	if (!_measurer) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width',  '0');
		svg.setAttribute('height', '0');
		svg.style.position      = 'absolute';
		svg.style.visibility    = 'hidden';
		svg.style.pointerEvents = 'none';
		_measurer = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		svg.appendChild(_measurer);
		document.body.appendChild(svg);
	}
	_measurer.setAttribute('d', d);
	return _measurer.getTotalLength();
}

// Build the full drain route: the snake's cells in TAIL → HEAD order,
// followed by enough extension cells in arrow.direction that the snake-
// length dash can fully slide off the grid.
export function buildFullRoute(arrow: Arrow, W: number, H: number, roundedCorners: boolean): string {
	const dir   = DELTA[arrow.direction];
	const N     = arrow.path.length;
	const extra = exitCellCount(arrow, W, H) + N + 2; // generous so dash exits cleanly

	const pts: GridPos[] = [];
	for (let i = N - 1; i >= 0; i--) pts.push(arrow.path[i]);
	for (let k = 1; k <= extra; k++) {
		pts.push({ x: arrow.path[0].x + k * dir.dx, y: arrow.path[0].y + k * dir.dy });
	}
	return roundedPath(pts, roundedCorners ? 0.4 : 0);
}
