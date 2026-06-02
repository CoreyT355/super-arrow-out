// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SHAPE MASKS — turn a shape into the set of "in-shape" grid cells        ║
// ╠══════════════════════════════════════════════════════════════════════════╣
// ║                                                                          ║
// ║  A shaped puzzle masks the normal rectangular grid so the snakes fill    ║
// ║  only the shape's area (see docs/shaped-puzzles.md).                     ║
// ║                                                                          ║
// ║  Each shape is authored as a POLYGON normalized to the unit square       ║
// ║  [0,1]². That single source of truth drives both:                        ║
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
// ╚══════════════════════════════════════════════════════════════════════════╝

import { flattenRings, bbox, svgToPath, svgAttr } from '$lib/utils/svgFlatten';

export type Point = readonly [number, number];

export interface Shape {
    id:         string;   // derived from the .svg filename ('heart', 'star', …)
    label:      string;
    /** Sub-path rings normalized to the unit square [0,1]², filled with the
     *  even-odd rule so a shape can have holes (e.g. the ghost's eyes) without
     *  the sub-paths being joined by spurious edges. `null` = classic (rect). */
    polygon:    readonly (readonly Point[])[] | null;
    /** Natural width / height of the raw shape, before unit-square normalize.
     *  The grid sizing aims for w/h ≈ aspect so the shape isn't stretched. */
    aspect:     number;
    /** Minimum target *filled* cell count for this shape to be offered. */
    minFilled:  number;
    /** Optional upper bound on target filled cells. */
    maxFilled?: number;
    /** SVG path `d` for the menu chip icon (from the source .svg). */
    icon:       string;
    /** viewBox for the chip <svg>, matching the source file. */
    iconViewBox: string;
}

// ─── shape catalog (loaded from src/lib/shapes/*.svg) ────────────────────────
//
// Drop an .svg into src/lib/shapes/ and it becomes a playable shape — no code
// change needed. See src/lib/shapes/README.md for the conventions. Each file's
// geometry (path / polygon / rect / circle / ellipse) is extracted and
// flattened into the fill mask; the same path renders as the menu icon.
//
// Per-file metadata via attributes on the root <svg>:
//   data-label       display name      (default: title-cased filename)
//   data-min-filled  min target cells  (default: 60)
//   data-max-filled  max target cells  (optional)
//   data-order       sort order        (default: 100)
//   viewBox          chip framing      (default: "0 0 24 24")
//
// Imported eagerly as raw strings at build time, so this stays DOM-free and
// works on the server, in the worker's siblings, and in vitest.
const SVG_FILES = import.meta.glob('$lib/shapes/*.svg', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

function titleCase(s: string): string {
    return s.replace(/(^|[-_])(\w)/g, (_, __, c) => ' ' + c.toUpperCase()).trim();
}

function buildShape(filePath: string, svg: string): Shape & { order: number } {
    const id = filePath.split('/').pop()!.replace(/\.svg$/i, '').toLowerCase();
    const d = svgToPath(svg);
    const rings = flattenRings(d);
    // Normalize every ring against the SHARED bounding box so the sub-paths
    // keep their relative positions (eyes stay inside the body, etc.).
    const b = bbox(rings.flat());
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    const polygon: Point[][] = rings.map(ring =>
        ring.map(([x, y]) => [(x - b.minX) / w, (y - b.minY) / h] as Point),
    );

    const minFilled = Number(svgAttr(svg, 'data-min-filled') ?? 60);
    const maxRaw    = svgAttr(svg, 'data-max-filled');
    return {
        id,
        label:       svgAttr(svg, 'data-label') ?? titleCase(id),
        polygon,
        aspect:      w / h,
        minFilled,
        maxFilled:   maxRaw != null ? Number(maxRaw) : undefined,
        icon:        d,
        iconViewBox: svgAttr(svg, 'viewBox') ?? '0 0 24 24',
        order:       Number(svgAttr(svg, 'data-order') ?? 100),
    };
}

const CLASSIC_SHAPE: Shape = {
    id: 'classic', label: 'Classic', polygon: null, aspect: 1, minFilled: 0,
    icon: 'M4 4h16v16H4z', iconViewBox: '0 0 24 24',
};

export const SHAPES: readonly Shape[] = [
    CLASSIC_SHAPE,
    ...Object.entries(SVG_FILES)
        .map(([path, svg]) => buildShape(path, svg))
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
        .map(({ order: _order, ...shape }) => shape),
];

export const CLASSIC: Shape = SHAPES[0];
export const NON_CLASSIC_SHAPES: readonly Shape[] = SHAPES.filter(s => s.id !== 'classic');

export function shapeById(id: string | undefined | null): Shape {
    if (!id) return CLASSIC;
    return SHAPES.find(s => s.id === id) ?? CLASSIC;
}

// ─── point-in-polygon ──────────────────────────────────────────────────────

/** Even-odd ray-casting test over a set of sub-path rings (each closed,
 *  last→first implied). Counting edge crossings across ALL rings gives the
 *  even-odd fill rule: interior holes (an odd nesting depth) read as outside,
 *  matching how the SVG itself renders. */
function pointInRings(px: number, py: number, rings: readonly (readonly Point[])[]): boolean {
    let inside = false;
    for (const poly of rings) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1];
            const xj = poly[j][0], yj = poly[j][1];
            const intersect = (yi > py) !== (yj > py)
                && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
            if (intersect) inside = !inside;
        }
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

// ─── shape placement (contain-fit) ──────────────────────────────────────────

interface Placement { ox: number; oy: number; sw: number; sh: number; }

/** Fit the shape's natural aspect inside a `w × h` grid WITHOUT distortion
 *  (CSS `object-fit: contain`) and centre it. When the grid is taller/wider
 *  than the shape (e.g. a square heart on a portrait phone) the leftover band
 *  becomes out-of-shape padding, so the board rectangle can fill the whole
 *  available area — and pan/zoom uses all of it — while the shape itself keeps
 *  its proportions. Deterministic from (aspect, w, h), so resume re-derives the
 *  identical mask. */
function placeShape(aspect: number, w: number, h: number): Placement {
    let sw = w, sh = w / aspect;
    if (sh > h) { sh = h; sw = h * aspect; }
    return { ox: (w - sw) / 2, oy: (h - sh) / 2, sw, sh };
}

// ─── public: rasterize ─────────────────────────────────────────────────────

/** Boolean in-shape mask of length `w*h` (indexed `y*w + x`). The shape is
 *  contain-fit and centred in the grid (see `placeShape`); a cell is in iff its
 *  centre falls inside the placed polygon. Classic → all true. The result is
 *  reduced to its largest connected component. */
export function rasterizeShape(shape: Shape, w: number, h: number): boolean[] {
    if (!shape.polygon) return new Array(w * h).fill(true); // classic
    const { ox, oy, sw, sh } = placeShape(shape.aspect, w, h);
    const mask = new Array<boolean>(w * h).fill(false);
    for (let y = 0; y < h; y++) {
        const v = (y + 0.5 - oy) / sh;
        if (v < 0 || v > 1) continue; // padding row
        for (let x = 0; x < w; x++) {
            const u = (x + 0.5 - ox) / sw;
            if (u < 0 || u > 1) continue; // padding column
            mask[y * w + x] = pointInRings(u, v, shape.polygon);
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

/** Pick grid W×H whose largest in-shape component is as close as possible to
 *  `targetFilled` cells. `targetAspect` is the grid's W/H — pass the viewport's
 *  aspect (as classic difficulties do) so the board rectangle fills the same
 *  area on screen; the shape is contain-fit and centred inside, with the
 *  leftover band as out-of-shape padding. Defaults to the shape's own aspect
 *  (no padding). Classic returns the plain square grid. */
export function computeShapedGridSize(
    shape: Shape, targetFilled: number, targetAspect = shape.aspect,
): ShapedGrid {
    if (!shape.polygon) {
        const s = Math.max(2, Math.round(Math.sqrt(targetFilled)));
        const mask = new Array<boolean>(s * s).fill(true);
        return { w: s, h: s, mask, filled: s * s };
    }

    // Seed the grid size analytically. The shape (aspect a, fill ratio f) is
    // contain-fit into a W×H rect of aspect va = targetAspect, so its placed
    // cell area is f·sw·sh. Whichever rect axis is the tighter fit determines
    // the shape's size, giving a closed-form seed for W (then H = W/va).
    const fillRatio = Math.max(0.05, unitFillRatio(shape.polygon)); // fraction of unit square
    const a = shape.aspect, va = Math.max(0.1, targetAspect);
    const sizeFor = (target: number): { w: number; h: number } => {
        let w: number, h: number;
        if (a >= va) {            // width-limited: sw = W, sh = W/a
            w = Math.sqrt((target * a) / fillRatio); h = w / va;
        } else {                  // height-limited: sh = H, sw = H·a
            h = Math.sqrt(target / (fillRatio * a)); w = h * va;
        }
        return { w: Math.max(2, Math.round(w)), h: Math.max(2, Math.round(h)) };
    };

    // Start from the estimate and search nearby scales (both axes together, so
    // the grid keeps the target aspect) for the closest filled count.
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

/** Fraction of the unit square covered by the rings under the even-odd rule.
 *  Sampled rather than computed analytically so holes (eyes) are subtracted
 *  correctly regardless of ring winding direction. Only seeds the grid-size
 *  search, so a coarse fixed grid is plenty. */
function unitFillRatio(rings: readonly (readonly Point[])[]): number {
    const N = 64;
    let count = 0;
    for (let y = 0; y < N; y++) {
        const py = (y + 0.5) / N;
        for (let x = 0; x < N; x++) {
            if (pointInRings((x + 0.5) / N, py, rings)) count++;
        }
    }
    return count / (N * N);
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
    // Contain-fit + centre identically to the mask (placeShape), then one
    // sub-path per ring; rendered with the even-odd fill/clip rule so the
    // ghost's eyes (and any hole) cut through. See Board.svelte's clipPath.
    const { ox, oy, sw, sh } = placeShape(shape.aspect, w, h);
    return shape.polygon
        .map(ring => {
            const pts = ring.map(([x, y]) => `${(ox + x * sw).toFixed(3)} ${(oy + y * sh).toFixed(3)}`);
            return `M ${pts.join(' L ')} Z`;
        })
        .join(' ');
}
