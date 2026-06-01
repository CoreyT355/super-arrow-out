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

/** Sample an SVG elliptical-arc segment (endpoint parametrization, per the
 *  SVG spec implementation notes F.6) into points, appended to `out`. */
function sampleArc(
    out: number[][], x0: number, y0: number,
    rx: number, ry: number, phiDeg: number,
    largeArc: boolean, sweep: boolean, x: number, y: number, steps: number,
): void {
    if (rx === 0 || ry === 0 || (x0 === x && y0 === y)) { out.push([x, y]); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (phiDeg * Math.PI) / 180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);

    const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
    const x1 =  cosP * dx + sinP * dy;
    const y1 = -sinP * dx + cosP * dy;

    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

    const sign = largeArc !== sweep ? 1 : -1;
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const co = sign * Math.sqrt(Math.max(0, num / den));
    const cxp =  co * (rx * y1) / ry;
    const cyp = -co * (ry * x1) / rx;
    const cx = cosP * cxp - sinP * cyp + (x0 + x) / 2;
    const cy = sinP * cxp + cosP * cyp + (y0 + y) / 2;

    const ang = (ux: number, uy: number, vx: number, vy: number) => {
        const dot = ux * vx + uy * vy;
        const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
        let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
    };
    const theta1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dTheta = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

    const n = Math.max(2, Math.ceil((Math.abs(dTheta) / Math.PI) * steps));
    for (let i = 1; i <= n; i++) {
        const t = theta1 + dTheta * (i / n);
        const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
        out.push([cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]);
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

/** Flatten an SVG path `d` into one or more closed rings (sub-paths). Each
 *  `M`/`m` starts a new ring, so a shape with holes (e.g. a ghost's eyes)
 *  keeps its sub-paths separate instead of being joined by spurious edges.
 *  Points are in the path's own coordinate space; `steps` controls smoothness. */
export function flattenRings(d: string, steps = 20): Pt[][] {
    const rings: number[][][] = [];
    let cur: number[][] = [];
    let cx = 0, cy = 0;      // current point
    let sx = 0, sy = 0;      // subpath start
    let pcx = 0, pcy = 0;    // previous control point (for S/T reflection)
    let prevCmd = '';

    const startRing = (x: number, y: number) => {
        if (cur.length > 1) rings.push(cur);
        cur = [[x, y]];
        cx = x; cy = y; sx = x; sy = y;
    };
    const push = (x: number, y: number) => { cur.push([x, y]); cx = x; cy = y; };

    const tokens = d.match(/[a-zA-Z][^a-zA-Z]*/g) ?? [];
    for (const token of tokens) {
        const cmd = token[0];
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        const a = parseNums(token.slice(1));
        let i = 0;

        switch (C) {
            case 'M': {
                // First pair = moveto (new ring); extra pairs behave as lineto.
                let first = true;
                while (i + 1 < a.length) {
                    const x = rel ? cx + a[i] : a[i];
                    const y = rel ? cy + a[i + 1] : a[i + 1];
                    i += 2;
                    if (first) { startRing(x, y); first = false; }
                    else push(x, y);
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
                    sampleCubic(cur, cx, cy, x1, y1, x2, y2, x3, y3, steps);
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
                    sampleCubic(cur, cx, cy, x1, y1, x2, y2, x3, y3, steps);
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
                    sampleQuad(cur, cx, cy, x1, y1, x2, y2, steps);
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
                    sampleQuad(cur, cx, cy, x1, y1, x2, y2, steps);
                    pcx = x1; pcy = y1; cx = x2; cy = y2; i += 2;
                    prevCmd = 'Q';
                }
                continue;
            case 'A':
                while (i + 6 < a.length) {
                    const ex = rel ? cx + a[i + 5] : a[i + 5];
                    const ey = rel ? cy + a[i + 6] : a[i + 6];
                    sampleArc(cur, cx, cy, a[i], a[i + 1], a[i + 2], !!a[i + 3], !!a[i + 4], ex, ey, steps);
                    cx = ex; cy = ey; i += 7;
                }
                break;
            case 'Z':
                if (cur.length > 0 && (cur[cur.length - 1][0] !== sx || cur[cur.length - 1][1] !== sy)) {
                    cur.push([sx, sy]);
                }
                cx = sx; cy = sy;
                break;
        }
        prevCmd = C;
    }
    if (cur.length > 1) rings.push(cur);

    return rings.map(ring => ring.map(([x, y]) => [x, y] as Pt));
}

/** Flatten an SVG path into a single combined point list (all rings joined).
 *  Fine for bounding boxes and single-sub-path shapes; for fill/hit-testing
 *  with holes use `flattenRings` + even-odd. */
export function flattenPath(d: string, steps = 20): Pt[] {
    return flattenRings(d, steps).flat();
}

// ─── SVG document → single path string ──────────────────────────────────────
//
// Extract drawable geometry from a raw .svg file and return one combined SVG
// path `d` string. Supports <path>, <polygon>/<polyline>, <rect>, <circle>,
// and <ellipse> (the last three are converted to line/bezier path data, since
// flattenPath has no arc support). Used by the shape catalog so authors can
// drop an .svg into src/lib/shapes/ instead of hand-writing path strings.

function nums(s: string): number[] {
    const m = s.match(/-?(?:\d*\.\d+|\d+\.?)/g);
    return m ? m.map(Number) : [];
}

function attrNum(tag: string, name: string): number {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
    return m ? parseFloat(m[1]) || 0 : 0;
}

const KAPPA = 0.5522847498307936; // bezier circle constant

function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string {
    const ox = rx * KAPPA, oy = ry * KAPPA;
    return `M ${cx - rx} ${cy} `
        + `C ${cx - rx} ${cy - oy} ${cx - ox} ${cy - ry} ${cx} ${cy - ry} `
        + `C ${cx + ox} ${cy - ry} ${cx + rx} ${cy - oy} ${cx + rx} ${cy} `
        + `C ${cx + rx} ${cy + oy} ${cx + ox} ${cy + ry} ${cx} ${cy + ry} `
        + `C ${cx - ox} ${cy + ry} ${cx - rx} ${cy + oy} ${cx - rx} ${cy} Z`;
}

/** Combined path `d` from any drawable elements in an SVG string. */
export function svgToPath(svg: string): string {
    const parts: string[] = [];

    for (const m of svg.matchAll(/<path\b[^>]*\bd\s*=\s*"([^"]+)"/g)) parts.push(m[1]);

    for (const m of svg.matchAll(/<(polygon|polyline)\b[^>]*\bpoints\s*=\s*"([^"]+)"/g)) {
        const n = nums(m[2]);
        if (n.length >= 4) {
            let d = `M ${n[0]} ${n[1]}`;
            for (let i = 2; i + 1 < n.length; i += 2) d += ` L ${n[i]} ${n[i + 1]}`;
            if (m[1] === 'polygon') d += ' Z';
            parts.push(d);
        }
    }

    for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
        const x = attrNum(m[0], 'x'), y = attrNum(m[0], 'y');
        const w = attrNum(m[0], 'width'), h = attrNum(m[0], 'height');
        if (w > 0 && h > 0) parts.push(`M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`);
    }

    for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
        const r = attrNum(m[0], 'r');
        if (r > 0) parts.push(ellipseToPath(attrNum(m[0], 'cx'), attrNum(m[0], 'cy'), r, r));
    }

    for (const m of svg.matchAll(/<ellipse\b[^>]*>/g)) {
        const rx = attrNum(m[0], 'rx'), ry = attrNum(m[0], 'ry');
        if (rx > 0 && ry > 0) parts.push(ellipseToPath(attrNum(m[0], 'cx'), attrNum(m[0], 'cy'), rx, ry));
    }

    return parts.join(' ');
}

/** Read a string attribute from the root <svg> tag (e.g. viewBox, data-*). */
export function svgAttr(svg: string, name: string): string | undefined {
    const open = svg.match(/<svg\b[^>]*>/);
    if (!open) return undefined;
    const m = open[0].match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
    return m ? m[1] : undefined;
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
