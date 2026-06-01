// ─── SVG path → polygon ────────────────────────────────────────────────────
//
// A tiny, dependency-free SVG path flattener. It walks an SVG `d` string and
// samples it into a flat list of points, turning curves into short line
// segments. Shaped puzzles use this to derive a fill mask from a single path
// string (see $lib/config/shapes.ts) — the same string that renders as the
// menu icon, so each shape has exactly one source of truth.
//
// Runs with no DOM (works in the worker and in vitest). Supports the command
// set used by the shape catalog: M/L/H/V/C/S/Q/T/Z in both absolute and
// relative forms. Arc commands (A) are intentionally unsupported — author
// shapes with line/bezier segments instead.

export type Pt = readonly [number, number];

/** Parse the numeric arguments out of one command's argument string.
 *  Handles forms like "3.41.81", "-1.45-1.32", ".5" — no exponent support
 *  (avoid scientific notation in authored paths). */
function parseNums(s: string): number[] {
    const m = s.match(/-?(?:\d*\.\d+|\d+\.?)/g);
    return m ? m.map(Number) : [];
}

function sampleCubic(
    out: number[][], x0: number, y0: number,
    x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    steps: number,
): void {
    for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        out.push([a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3]);
    }
}

function sampleQuad(
    out: number[][], x0: number, y0: number,
    x1: number, y1: number, x2: number, y2: number, steps: number,
): void {
    for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        const a = u * u, b = 2 * u * t, c = t * t;
        out.push([a * x0 + b * x1 + c * x2, a * y0 + b * y1 + c * y2]);
    }
}

/** Flatten an SVG path `d` into a closed polygon (array of points in the
 *  path's own coordinate space). `steps` controls curve smoothness. */
export function flattenPath(d: string, steps = 20): Pt[] {
    const pts: number[][] = [];
    let cx = 0, cy = 0;      // current point
    let sx = 0, sy = 0;      // subpath start
    let pcx = 0, pcy = 0;    // previous control point (for S/T reflection)
    let prevCmd = '';

    const tokens = d.match(/[a-zA-Z][^a-zA-Z]*/g) ?? [];
    for (const token of tokens) {
        const cmd = token[0];
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        const a = parseNums(token.slice(1));
        let i = 0;

        const push = (x: number, y: number) => { pts.push([x, y]); cx = x; cy = y; };

        switch (C) {
            case 'M': {
                // First pair = moveto; any extra pairs behave as lineto.
                let first = true;
                while (i + 1 < a.length || (i === 0 && a.length >= 2)) {
                    if (i + 1 >= a.length) break;
                    const x = rel ? cx + a[i] : a[i];
                    const y = rel ? cy + a[i + 1] : a[i + 1];
                    i += 2;
                    push(x, y);
                    if (first) { sx = cx; sy = cy; first = false; }
                }
                break;
            }
            case 'L':
                while (i + 1 < a.length) {
                    const x = rel ? cx + a[i] : a[i];
                    const y = rel ? cy + a[i + 1] : a[i + 1];
                    i += 2; push(x, y);
                }
                break;
            case 'H':
                while (i < a.length) { push(rel ? cx + a[i] : a[i], cy); i++; }
                break;
            case 'V':
                while (i < a.length) { push(cx, rel ? cy + a[i] : a[i]); i++; }
                break;
            case 'C':
                while (i + 5 < a.length) {
                    const x1 = rel ? cx + a[i]     : a[i];
                    const y1 = rel ? cy + a[i + 1] : a[i + 1];
                    const x2 = rel ? cx + a[i + 2] : a[i + 2];
                    const y2 = rel ? cy + a[i + 3] : a[i + 3];
                    const x3 = rel ? cx + a[i + 4] : a[i + 4];
                    const y3 = rel ? cy + a[i + 5] : a[i + 5];
                    sampleCubic(pts, cx, cy, x1, y1, x2, y2, x3, y3, steps);
                    pcx = x2; pcy = y2; cx = x3; cy = y3; i += 6;
                }
                break;
            case 'S':
                while (i + 3 < a.length) {
                    const reflect = (prevCmd === 'C' || prevCmd === 'S');
                    const x1 = reflect ? 2 * cx - pcx : cx;
                    const y1 = reflect ? 2 * cy - pcy : cy;
                    const x2 = rel ? cx + a[i]     : a[i];
                    const y2 = rel ? cy + a[i + 1] : a[i + 1];
                    const x3 = rel ? cx + a[i + 2] : a[i + 2];
                    const y3 = rel ? cy + a[i + 3] : a[i + 3];
                    sampleCubic(pts, cx, cy, x1, y1, x2, y2, x3, y3, steps);
                    pcx = x2; pcy = y2; cx = x3; cy = y3; i += 4;
                    prevCmd = 'C';
                }
                continue;
            case 'Q':
                while (i + 3 < a.length) {
                    const x1 = rel ? cx + a[i]     : a[i];
                    const y1 = rel ? cy + a[i + 1] : a[i + 1];
                    const x2 = rel ? cx + a[i + 2] : a[i + 2];
                    const y2 = rel ? cy + a[i + 3] : a[i + 3];
                    sampleQuad(pts, cx, cy, x1, y1, x2, y2, steps);
                    pcx = x1; pcy = y1; cx = x2; cy = y2; i += 4;
                }
                break;
            case 'T':
                while (i + 1 < a.length) {
                    const reflect = (prevCmd === 'Q' || prevCmd === 'T');
                    const x1 = reflect ? 2 * cx - pcx : cx;
                    const y1 = reflect ? 2 * cy - pcy : cy;
                    const x2 = rel ? cx + a[i]     : a[i];
                    const y2 = rel ? cy + a[i + 1] : a[i + 1];
                    sampleQuad(pts, cx, cy, x1, y1, x2, y2, steps);
                    pcx = x1; pcy = y1; cx = x2; cy = y2; i += 2;
                    prevCmd = 'Q';
                }
                continue;
            case 'Z':
                if (pts.length === 0 || pts[pts.length - 1][0] !== sx || pts[pts.length - 1][1] !== sy) {
                    pts.push([sx, sy]);
                }
                cx = sx; cy = sy;
                break;
        }
        prevCmd = C;
    }

    return pts.map(([x, y]) => [x, y] as Pt);
}

/** Axis-aligned bounding box of a point list. */
export function bbox(pts: readonly Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
}
