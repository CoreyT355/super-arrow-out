// ╔════════════════════════════════════════════════════════════════════════╗
// ║  SHAPE MASKS — turn a shape into the set of "in-shape" grid cells        ║
// ╠════════════════════════════════════════════════════════════════════════╣
// ║                                                                          ║
// ║  A shaped puzzle masks the normal rectangular grid so the snakes fill    ║
// ║  only the shape's area (see docs/shaped-puzzles.md).                     ║
// ║                                                                          ║
// ║  Each shape is authored as a POLYGON normalized to the unit square       ║
// ║  [0,1]². That single source of truth drives both:                       ║
// ║    • rasterization — point-in-polygon at each cell center (pure, no DOM, ║
// ║      so it works in the worker and in vitest), and                       ║
// ║    • rendering     — the same points scaled to grid units give the       ║
// ║      silhouette / clip path (see Board.svelte).                          ║
// ║                                                                          ║
// ║  A cell is "in-shape" iff its CENTER is inside the polygon. After        ║
// ║  rasterizing we keep only the largest connected component so a shape can ║
// ║  never hand the generator a disconnected blob.                           ║
// ║                                                                          ║
// ║  "classic" is the rectangle (no polygon) — every cell is in-shape, i.e.  ║
// ║  today's behavior.                                                       ║
// ║                                                                          ║
// ╚════════════════════════════════════════════════════════════════════════╝

export type Point = readonly [number, number];

export interface Shape {
    id:         string;   // 'classic' | 'heart' | 'diamond' | 'circle'
    label:      string;
    /** Polygon normalized to the unit square [0,1]². `null` = classic (rect). */
    polygon:    readonly Point[] | null;
    /** Natural width / height of the raw shape, before unit-square normalize.
     *  The grid sizing aims for w/h ≈ aspect so the shape isn't stretched. */
    aspect:     number;
    /** Minimum target *filled* cell count for this shape to be offered. */
    minFilled:  number;
    /** Optional upper bound on target filled cells. */
    maxFilled?: number;
    /** 24×24 viewBox path for the menu chip icon. */
    icon:       string;
}

// ─── polygon builders ──────────────────────────────────────────────────────

/** Normalize raw points into the unit square, returning the points (y kept as
 *  given) plus the raw aspect (width/height before normalization). Optionally
 *  flips y so a "math up" curve reads correctly in "screen down" coords. */
function normalize(raw: Point[], flipY: boolean): { polygon: Point[]; aspect: number } {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of raw) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const polygon: Point[] = raw.map(([x, y]) => {
        const nx = (x - minX) / w;
        const ny = (y - minY) / h;
        return [nx, flipY ? 1 - ny : ny] as Point;
    });
    return { polygon, aspect: w / h };
}

/** Classic parametric heart (16 sin³t, 13cos t − 5cos2t − 2cos3t − cos4t),
 *  sampled and normalized into the unit square with the point at the bottom. */
function buildHeart(samples = 96): { polygon: Point[]; aspect: number } {
    const raw: Point[] = [];
    for (let i = 0; i < samples; i++) {
        const t = (i / samples) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        raw.push([x, y]);
    }
    return normalize(raw, /* flipY */ true);
}

/** Regular polygon approximating a circle, centered in the unit square. */
function buildCircle(samples = 64): { polygon: Point[]; aspect: number } {
    const raw: Point[] = [];
    for (let i = 0; i < samples; i++) {
        const t = (i / samples) * Math.PI * 2;
        raw.push([0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)]);
    }
    return { polygon: raw, aspect: 1 };
}

const HEART  = buildHeart();
const CIRCLE = buildCircle();
const DIAMOND: { polygon: Point[]; aspect: number } = {
    polygon: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
    aspect: 1,
};

// ─── shape catalog ─────────────────────────────────────────────────────────

export const SHAPES: readonly Shape[] = [
    {
        id: 'classic', label: 'Classic', polygon: null, aspect: 1, minFilled: 0,
        icon: 'M4 4h16v16H4z',
    },
    {
        id: 'heart', label: 'Heart', polygon: HEART.polygon, aspect: HEART.aspect, minFilled: 80,
        icon: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    },
    {
        id: 'diamond', label: 'Diamond', polygon: DIAMOND.polygon, aspect: DIAMOND.aspect, minFilled: 24,
        icon: 'M12 2l10 10-10 10L2 12z',
    },
    {
        id: 'circle', label: 'Circle', polygon: CIRCLE.polygon, aspect: CIRCLE.aspect, minFilled: 36,
        icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
    },
];

export const CLASSIC: Shape = SHAPES[0];
export const NON_CLASSIC_SHAPES: readonly Shape[] = SHAPES.filter(s => s.id !== 'classic');

export function shapeById(id: string | undefined | null): Shape {
    if (!id) return CLASSIC;
    return SHAPES.find(s => s.id === id) ?? CLASSIC;
}

// ─── point-in-polygon ──────────────────────────────────────────────────────

/** Standard ray-casting test. `poly` is a closed polygon (last→first implied). */
function pointInPolygon(px: number, py: number, poly: readonly Point[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        const intersect = (yi > py) !== (yj > py)
            && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

// ─── largest connected component ───────────────────────────────────────────

/** Keep only the largest 4-connected blob of `true` cells; clear the rest.
 *  Mutates and returns `mask`. */
function keepLargestComponent(mask: boolean[], w: number, h: number): boolean[] {
    const comp = new Int32Array(w * h).fill(-1);
    let bestId = -1, bestSize = 0, nextId = 0;
    const queue: number[] = [];

    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || comp[start] !== -1) continue;
        const id = nextId++;
        let size = 0;
        queue.length = 0;
        queue.push(start);
        comp[start] = id;
        let head = 0;
        while (head < queue.length) {
            const k = queue[head++];
            size++;
            const x = k % w, y = (k - (k % w)) / w;
            if (x > 0     && mask[k - 1] && comp[k - 1] === -1) { comp[k - 1] = id; queue.push(k - 1); }
            if (x < w - 1 && mask[k + 1] && comp[k + 1] === -1) { comp[k + 1] = id; queue.push(k + 1); }
            if (y > 0     && mask[k - w] && comp[k - w] === -1) { comp[k - w] = id; queue.push(k - w); }
            if (y < h - 1 && mask[k + w] && comp[k + w] === -1) { comp[k + w] = id; queue.push(k + w); }
        }
        if (size > bestSize) { bestSize = size; bestId = id; }
    }

    if (bestId !== -1) {
        for (let k = 0; k < mask.length; k++) if (comp[k] !== bestId) mask[k] = false;
    }
    return mask;
}

// ─── public: rasterize ─────────────────────────────────────────────────────

/** Boolean in-shape mask of length `w*h` (indexed `y*w + x`). A cell is in if
 *  its center is inside the polygon. Classic → all true. The result is reduced
 *  to its largest connected component. */
export function rasterizeShape(shape: Shape, w: number, h: number): boolean[] {
    if (!shape.polygon) return new Array(w * h).fill(true); // classic
    const mask = new Array<boolean>(w * h);
    for (let y = 0; y < h; y++) {
        const py = (y + 0.5) / h;
        for (let x = 0; x < w; x++) {
            const px = (x + 0.5) / w;
            mask[y * w + x] = pointInPolygon(px, py, shape.polygon);
        }
    }
    return keepLargestComponent(mask, w, h);
}

/** Count of `true` cells in a mask. */
export function countFilled(mask: boolean[]): number {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n;
}

// ─── public: grid sizing ───────────────────────────────────────────────────

export interface ShapedGrid {
    w:      number;
    h:      number;
    mask:   boolean[];
    filled: number;
}

/** Pick grid W×H (aspect ≈ shape.aspect) whose largest in-shape component is as
 *  close as possible to `targetFilled` cells. Classic returns the plain square
 *  grid identical to the existing computeGridSize square branch. */
export function computeShapedGridSize(shape: Shape, targetFilled: number): ShapedGrid {
    if (!shape.polygon) {
        const s = Math.max(2, Math.round(Math.sqrt(targetFilled)));
        const mask = new Array<boolean>(s * s).fill(true);
        return { w: s, h: s, mask, filled: s * s };
    }

    // Estimate the bounding-box area from the polygon's fill ratio, then size
    // to the shape's aspect: w = √(area·aspect), h = √(area/aspect).
    const fillRatio = Math.max(0.05, polygonArea(shape.polygon)); // fraction of unit square
    const sizeFor = (target: number): { w: number; h: number } => {
        const area = target / fillRatio;
        const w = Math.max(2, Math.round(Math.sqrt(area * shape.aspect)));
        const h = Math.max(2, Math.round(Math.sqrt(area / shape.aspect)));
        return { w, h };
    };

    // Start from the estimate and search nearby scales for the closest filled
    // count. Rasterizing is cheap; a small symmetric search is plenty.
    let best: ShapedGrid | null = null;
    const seed = sizeFor(targetFilled);
    for (let d = -3; d <= 6; d++) {
        const scale = 1 + d * 0.06;
        const w = Math.max(2, Math.round(seed.w * scale));
        const h = Math.max(2, Math.round(seed.h * scale));
        const mask = rasterizeShape(shape, w, h);
        const filled = countFilled(mask);
        const cand: ShapedGrid = { w, h, mask, filled };
        if (!best || Math.abs(filled - targetFilled) < Math.abs(best.filled - targetFilled)) {
            best = cand;
        }
    }
    return best!;
}

/** Signed-area magnitude (shoelace) of a unit-square polygon = fill fraction. */
function polygonArea(poly: readonly Point[]): number {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    }
    return Math.abs(a) / 2;
}

// ─── public: eligibility ───────────────────────────────────────────────────

/** Shapes offerable at a given target filled-cell count. Classic is always
 *  eligible; others must clear their min (and stay under any max). */
export function eligibleShapes(targetFilled: number): Shape[] {
    return SHAPES.filter(s =>
        s.id === 'classic'
        || (targetFilled >= s.minFilled && (s.maxFilled == null || targetFilled <= s.maxFilled)),
    );
}

// ─── public: render path ───────────────────────────────────────────────────

/** SVG path `d` for the shape silhouette / clip, scaled to grid units (0..w,
 *  0..h). Classic → the full board rectangle. */
export function shapePathInGrid(shape: Shape, w: number, h: number): string {
    if (!shape.polygon) return `M 0 0 H ${w} V ${h} H 0 Z`;
    const pts = shape.polygon.map(([x, y]) => `${(x * w).toFixed(3)} ${(y * h).toFixed(3)}`);
    return `M ${pts.join(' L ')} Z`;
}
