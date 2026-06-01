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

import { flattenPath, bbox } from '$lib/utils/svgFlatten';

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

// ─── shape definitions ───────────────────────────────────────────────────────
//
// Each non-classic shape is authored as ONE SVG path string in a 0–24 box
// (same space as the menu icon). That single string is the source of truth:
//   • flattened → polygon (the fill mask), and
//   • rendered directly → the menu chip icon.
//
// Adding a shape = add a path string below. Use M/L/H/V/C/S/Q/T/Z only
// (no arcs — see svgFlatten). Orientation is screen-space (y grows downward),
// so e.g. a heart's point sits at the larger-y bottom.

interface ShapeDef {
    id:         string;
    label:      string;
    path:       string;
    minFilled:  number;
    maxFilled?: number;
}

const SHAPE_DEFS: ShapeDef[] = [
    { id: 'heart',    label: 'Heart',    minFilled: 80,
      path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
    { id: 'diamond',  label: 'Diamond',  minFilled: 24,
      path: 'M12 2 L22 12 L12 22 L2 12 Z' },
    { id: 'circle',   label: 'Circle',   minFilled: 36,
      path: 'M12 2 C17.52 2 22 6.48 22 12 C22 17.52 17.52 22 12 22 C6.48 22 2 17.52 2 12 C2 6.48 6.48 2 12 2 Z' },
    { id: 'triangle', label: 'Triangle', minFilled: 36,
      path: 'M12 2.5 L22 21 L2 21 Z' },
    { id: 'hexagon',  label: 'Hexagon',  minFilled: 36,
      path: 'M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z' },
    { id: 'star',     label: 'Star',     minFilled: 120,
      path: 'M12 2 L14.35 8.76 L21.51 8.91 L15.8 13.24 L17.88 20.09 L12 16 L6.12 20.09 L8.2 13.24 L2.49 8.91 L9.65 8.76 Z' },
];

/** Flatten a path and normalize the polygon into the unit square [0,1]²,
 *  returning the polygon plus the raw width/height aspect. */
function fromPath(path: string): { polygon: Point[]; aspect: number } {
    const flat = flattenPath(path);
    const b = bbox(flat);
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    const polygon: Point[] = flat.map(([x, y]) => [(x - b.minX) / w, (y - b.minY) / h] as Point);
    return { polygon, aspect: w / h };
}

// ─── shape catalog ─────────────────────────────────────────────────────────

export const SHAPES: readonly Shape[] = [
    {
        id: 'classic', label: 'Classic', polygon: null, aspect: 1, minFilled: 0,
        icon: 'M4 4h16v16H4z',
    },
    ...SHAPE_DEFS.map((d): Shape => {
        const { polygon, aspect } = fromPath(d.path);
        return { id: d.id, label: d.label, polygon, aspect, minFilled: d.minFilled, maxFilled: d.maxFilled, icon: d.path };
    }),
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
