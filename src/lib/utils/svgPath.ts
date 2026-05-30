import type { Arrow, GridPos } from '$lib/types';
import { DELTA } from '$lib/constants/theme';
import { exitCellCount } from './snakeMath';

// ─── rounded snake path ──────────────────────────────────────────────────────

/** Convert a path of cell positions to an SVG path string.
 *
 *  Straight runs use `L` commands; turns use a quadratic Bézier `Q` so the
 *  inner corner is smoothed enough to read as uniformly thick under
 *  browser anti-aliasing.
 *
 *  When `r === 0` (the "rounded corners" setting is off) we still emit a
 *  tiny Bézier (effective radius 0.03 — about 21% of the stroke width)
 *  rather than a plain `L`. A truly sharp corner creates zero-thickness
 *  extreme points at both the inner L-corner and the outer miter spike,
 *  which mobile browsers anti-alias as a visible "pinch." A tiny radius
 *  smooths just enough to avoid the artifact while still rendering as a
 *  visually sharp 90° turn at every grid scale. */
export function roundedPath(pts: GridPos[], r: number): string {
    if (pts.length === 0) return '';
    const cx = (p: GridPos) => p.x + 0.5;
    const cy = (p: GridPos) => p.y + 0.5;
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
            const effR = r === 0 ? 0.03 : r;
            const r1 = Math.min(effR, len1 / 2);
            const r2 = Math.min(effR, len2 / 2);
            const p1x = bx - (dx1 / len1) * r1, p1y = by - (dy1 / len1) * r1;
            const p2x = bx + (dx2 / len2) * r2, p2y = by + (dy2 / len2) * r2;
            d += ` L ${p1x} ${p1y} Q ${bx} ${by} ${p2x} ${p2y}`;
        }
    }

    d += ` L ${cx(pts[pts.length - 1])} ${cy(pts[pts.length - 1])}`;
    return d;
}

// ─── path-length measurement ──────────────────────────────────────────────────

// Hidden singleton path used to compute SVG path lengths off-screen.
// `getTotalLength` works on detached elements in Chrome/Safari, but
// Firefox historically required attachment — so we keep one in a hidden
// <svg> mounted on body.
let _measurer: SVGPathElement | null = null;

/** Total length (in viewBox units) of an SVG path `d` string.
 *
 *  Returns 0 on the server. Re-uses a single hidden measurement element
 *  per session so we don't pay the create/append cost on every drain. */
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

/** ⚠ test-only: reset the singleton so each test sees a fresh DOM state. */
export function __resetMeasurerForTests(): void {
    _measurer = null;
}

// ─── drain route ──────────────────────────────────────────────────────────────

/** Build the full drain route for an exiting arrow: cells in TAIL → HEAD
 *  order, plus enough extension cells past the head in the exit direction
 *  that the snake-length dash can fully slide off the grid. */
export function buildFullRoute(
    arrow: Arrow,
    gridW: number,
    gridH: number,
    roundedCorners: boolean,
): string {
    const dir = DELTA[arrow.direction];
    const N   = arrow.path.length;
    const extra = exitCellCount(arrow, gridW, gridH) + N + 2;

    const pts: GridPos[] = [];
    for (let i = N - 1; i >= 0; i--) pts.push(arrow.path[i]);
    for (let k = 1; k <= extra; k++) {
        pts.push({ x: arrow.path[0].x + k * dir.dx, y: arrow.path[0].y + k * dir.dy });
    }
    return roundedPath(pts, roundedCorners ? 0.4 : 0);
}
