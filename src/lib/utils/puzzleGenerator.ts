// ╔════════════════════════════════════════════════════════════════════════╗
// ║  PUZZLE GENERATOR — bird's-eye view                                    ║
// ╠════════════════════════════════════════════════════════════════════════╣
// ║                                                                        ║
// ║  Goal: fill every cell of a WxH grid with snake-shaped arrows. Each    ║
// ║  arrow has a HEAD (where the player taps) and a TAIL (where it ends).  ║
// ║  When tapped, the arrow slides out of the board in its head's facing   ║
// ║  direction — but only if its exit path is unblocked.                   ║
// ║                                                                        ║
// ║  The whole file is one big pipeline. In plain English:                 ║
// ║                                                                        ║
// ║   1. Make an empty WxH grid (a 2D array of 'empty' / 'occupied').      ║
// ║                                                                        ║
// ║   2. Build a shuffled "spawn queue" — every cell in random order. We   ║
// ║      walk through it picking random seed spots to start new arrows.    ║
// ║                                                                        ║
// ║   3. MAIN LOOP — keep planting arrows until the grid is full:          ║
// ║        a. Pick the next seed cell from the queue.                      ║
// ║        b. Try to grow a snake from that seed:                          ║
// ║             - Pick a valid EXIT direction (the head must be able to    ║
// ║               escape the board, possibly through arrows that will      ║
// ║               leave first).                                            ║
// ║             - Lay down a body of random length, wandering into empty   ║
// ║               neighbours, mostly going "inward" (away from the exit).  ║
// ║        c. If growing succeeded, check it didn't trap a tiny empty      ║
// ║           pocket. If it did, rip it back out and try again.            ║
// ║        d. Otherwise mark the cells 'occupied' and move on.             ║
// ║                                                                        ║
// ║   4. CLEANUP — three passes to handle whatever the main loop missed:   ║
// ║        - fillEmptyCells: existing tails reach into bordering empty     ║
// ║          cells, one step at a time, like roots growing.                ║
// ║        - rescueEmptyRegions: any cells still empty (because they're    ║
// ║          fully walled in by arrow BODIES, not tails) get fresh         ║
// ║          arrows planted in them.                                       ║
// ║        - fillEmptyCells again: the rescue arrows' new tails may now    ║
// ║          reach pockets the first pass couldn't.                        ║
// ║        - absorbShortArrows: any arrow that ended up too short gets     ║
// ║          merged into a neighbouring arrow.                             ║
// ║                                                                        ║
// ║   5. Return the finished Level — width, height, and the arrow list,    ║
// ║      each arrow re-numbered and colour-assigned from the palette.      ║
// ║                                                                        ║
// ║  Two key design tricks:                                                ║
// ║   • ANTI-CLUSTERING — when picking exit directions, we look at         ║
// ║     nearby arrows and lean AWAY from over-represented directions, so   ║
// ║     finished boards don't all point the same way.                      ║
// ║   • SKIP-AND-ABSORB — on edges, a seed cell is often forced into a     ║
// ║     single exit direction. If too many neighbours along the edge are   ║
// ║     already exiting that way, we probabilistically REFUSE to plant     ║
// ║     here. The cleanup pass will absorb the skipped cell into a         ║
// ║     neighbour's tail instead, which usually points a different way.   ║
// ║                                                                        ║
// ╚════════════════════════════════════════════════════════════════════════╝

import type { Direction, GridPos, Arrow, Level } from '$lib/types';

const COLORS = [
    '#f87171', // red-400
    '#60a5fa', // blue-400
    '#4ade80', // green-400
    '#c084fc', // purple-400
    '#fb923c', // orange-400
    '#f472b6', // pink-400
    '#facc15', // yellow-400
    '#2dd4bf', // teal-400
    '#22d3ee', // cyan-400
    '#a3e635', // lime-400
];

// INWARD = "if the head points this direction, the body grows the OPPOSITE way".
// e.g. head facing North (exit upward) means the body trails southward (+y).
// We use this as the initial "preferred" step direction when growing the body.
const INWARD: Record<Direction, GridPos> = {
    N: { x: 0, y: 1 },
    S: { x: 0, y: -1 },
    E: { x: -1, y: 0 },
    W: { x: 1, y: 0 },
};

// OUTWARD = step vector for the arrow's EXIT (mirror of INWARD). Used by the
// solvability check to walk the exit ray from the head. Kept here rather than
// imported from $lib/constants/theme so this module stays self-contained.
const OUTWARD: Record<Direction, GridPos> = {
    N: { x: 0, y: -1 },
    S: { x: 0, y: 1 },
    E: { x: 1, y: 0 },
    W: { x: -1, y: 0 },
};

// The board is just a 2D array of strings — every cell is either empty (no
// arrow yet) or occupied (some arrow's body covers it).
type Grid = ('empty' | 'occupied')[][];

// ─── seedable RNG ────────────────────────────────────────────────────────
//
// Production calls `generateLevel(w, h)` with no seed → `rng` stays
// `Math.random`, behaviour is unchanged. Tests call `generateLevel(w, h,
// seed)` → a deterministic mulberry32 PRNG is swapped in for the duration
// of that one call (try/finally restores `Math.random` afterward), so
// failing levels can be re-run from a single integer.
//
// Single-threaded JS + synchronous generation makes the module-level
// mutable state safe; the worker only runs one generation at a time.
let rng: () => number = Math.random;
function mulberry32(seed: number): () => number {
    return function () {
        let t = (seed = (seed + 0x6d2b79f5) | 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The four neighbour offsets: left, right, up, down. Reused all over the file
// so we don't allocate the same tiny array on every loop iteration.
const STEPS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Create a fresh HxW grid filled with 'empty'.
function makeGrid(w: number, h: number): Grid {
    return Array.from({ length: h }, () => Array<'empty' | 'occupied'>(w).fill('empty'));
}

// "Is (x, y) actually inside the board?" — used every time we step off a cell
// so we don't read past the edge.
function inBounds(x: number, y: number, w: number, h: number): boolean {
    return x >= 0 && x < w && y >= 0 && y < h;
}

// "Can an arrow standing at (sx, sy) escape in direction (dx, dy)?"
//
// Walk one step at a time from the seed in that direction. If we hit any
// EMPTY cell on the way, the answer is NO — empty cells won't be cleared by
// the time this arrow tries to leave, so they block it. If every cell along
// the way is occupied (or we step right off the edge), the answer is YES,
// because those occupied cells are other arrows that will exit before us.
function clearPathToEdge(grid: Grid, sx: number, sy: number, dx: number, dy: number, w: number, h: number): boolean {
    let x = sx + dx, y = sy + dy;
    let reachedEdge = false;
    while (inBounds(x, y, w, h)) {
        if (grid[y][x] === 'empty') return false;          // a gap blocks us → fail
        if (x === 0 || x === w - 1 || y === 0 || y === h - 1) reachedEdge = true;
        x += dx;
        y += dy;
    }
    // We fell off the grid → path is fully clear (or the first step was already off-grid).
    return reachedEdge || (sx + dx < 0 || sx + dx >= w || sy + dy < 0 || sy + dy >= h);
}

// Standard random shuffle. Used everywhere we'd otherwise iterate in a fixed
// order (cells, directions, neighbours...) — if we didn't shuffle, the
// puzzles would visibly lean toward whichever direction was checked first.
function shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// "Which directions could this seed cell exit toward?"
//
// An arrow can exit in a direction if either:
//   (a) the head is already sitting on that edge of the board (free exit), OR
//   (b) the path from here to the edge is fully covered by other arrows
//       that will leave first (clearPathToEdge).
//
// Returns the valid directions in random order so callers don't accidentally
// favour the first one checked.
function getExitDirs(grid: Grid, x: number, y: number, w: number, h: number): Direction[] {
    const dirs: Direction[] = [];
    const onLeft = x === 0, onRight = x === w - 1, onTop = y === 0, onBottom = y === h - 1;

    // Edge directions are always valid (head is at that edge — zero-step exit).
    if (onLeft) dirs.push('W');
    if (onRight) dirs.push('E');
    if (onTop) dirs.push('N');
    if (onBottom) dirs.push('S');

    // Also consider non-edge directions whose exit path is already lined with
    // occupied cells — those existing arrows will exit before this one, leaving
    // the path clear. This lets edge cells sometimes exit perpendicular to
    // their edge instead of being forced into the edge direction.
    if (!onLeft   && clearPathToEdge(grid, x, y, -1,  0, w, h)) dirs.push('W');
    if (!onRight  && clearPathToEdge(grid, x, y,  1,  0, w, h)) dirs.push('E');
    if (!onTop    && clearPathToEdge(grid, x, y,  0, -1, w, h)) dirs.push('N');
    if (!onBottom && clearPathToEdge(grid, x, y,  0,  1, w, h)) dirs.push('S');

    // CRITICAL: Shuffle the exit array so the code doesn't implicitly
    // favor West or North when multiple directions are valid.
    return shuffle(dirs);
}

// "Did this new arrow accidentally trap a tiny empty pocket?"
//
// After we lay down a new arrow, we walk along its body and look at every
// empty cell touching it. From each such empty cell, we do a flood-fill (BFS)
// to count how many connected empty cells form a "pocket" — but we STOP
// counting once we hit `minSize`, because at that point the pocket is big
// enough to be safely fillable later. If any pocket comes up smaller than
// minSize, we report "yes, there's a dead pocket" so the caller can roll the
// placement back.
//
// Why: tiny isolated pockets (1–2 cells walled off by other arrows) often
// can't be filled cleanly by the later passes.
function hasDeadPocketNear(
    grid: Grid,
    path: GridPos[],
    minSize: number,
    w: number,
    h: number,
): boolean {
    if (minSize <= 1) return false;
    const visited = new Uint8Array(w * h);
    const queue: number[] = [];
    for (const p of path) {
        for (const [dx, dy] of STEPS) {
            const nx = p.x + dx, ny = p.y + dy;
            if (!inBounds(nx, ny, w, h) || grid[ny][nx] !== 'empty') continue;
            const start = ny * w + nx;
            if (visited[start]) continue;
            queue.length = 0;
            queue.push(start);
            visited[start] = 1;
            let count = 0;
            let head = 0;
            while (head < queue.length && count < minSize) {
                const k = queue[head++];
                count++;
                const cx = k % w;
                const cy = (k - cx) / w;
                for (const [ddx, ddy] of STEPS) {
                    const mx = cx + ddx, my = cy + ddy;
                    if (mx < 0 || mx >= w || my < 0 || my >= h) continue;
                    if (grid[my][mx] !== 'empty') continue;
                    const mk = my * w + mx;
                    if (visited[mk]) continue;
                    visited[mk] = 1;
                    queue.push(mk);
                }
            }
            if (count < minSize) return true;
        }
    }
    return false;
}

// ANTI-CLUSTERING helper #1.
// Look at the square window of size (2*radius + 1) centred on (cx, cy) and
// tally up how many existing arrows in that window exit N, S, E, W. The
// counts tell the next placement which directions are already over-used
// nearby, so it can lean the opposite way.
function localDirCounts(
    arrows: Arrow[],
    cx: number,
    cy: number,
    radius: number
): Record<Direction, number> {
    const counts: Record<Direction, number> = { N: 0, S: 0, E: 0, W: 0 };
    for (const a of arrows) {
        const head = a.path[0];
        if (Math.abs(head.x - cx) <= radius && Math.abs(head.y - cy) <= radius) {
            counts[a.direction]++;
        }
    }
    return counts;
}

// ANTI-CLUSTERING helper #2.
// Weighted random pick. Every valid direction gets a "weight" — bigger
// weight = more likely to be chosen. The formula 1 / (1 + k * count) means a
// direction with zero nearby uses has weight 1, and the weight shrinks as
// the local count goes up. k controls how strongly we penalise clustering.
//
// Example with k=1.5, counts {N:0, S:2, E:0, W:0}:
//   weights = {N:1.00, S:0.25, E:1.00, W:1.00}, total = 3.25
//   S is 4× less likely to be picked than the others.
function pickWeightedDir(
    dirs: Direction[],
    counts: Record<Direction, number>,
    k: number
): Direction {
    const weights = dirs.map(d => 1 / (1 + k * counts[d]));
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rng() * total;
    for (let i = 0; i < dirs.length; i++) {
        r -= weights[i];
        if (r <= 0) return dirs[i];
    }
    return dirs[dirs.length - 1];
}

// ─── THE HEART OF THE GENERATOR ──────────────────────────────────────────
// Try to plant ONE new arrow whose head sits at `seedPos`.
//
// Three things can happen:
//   1. We succeed → return a new Arrow and mark its path as 'occupied'.
//   2. The seed cell is unusable (occupied, no exits, etc.) → return null.
//   3. We choose to "skip" this seed on purpose for anti-clustering reasons
//      (see SKIP-AND-ABSORB below) → return null.
//
// The caller treats every null the same: "try a different seed."
function generateArrow(
    grid: Grid,
    id: number,
    w: number,
    h: number,
    minLen: number,
    maxLen: number,
    changeDirChance: number,
    seedPos: GridPos,            // randomised seed picked by the main loop
    placedArrows: Arrow[],
    clusterRadius: number
): Arrow | null {
    const { x: ex, y: ey } = seedPos;

    // STEP 1 — Bail if the seed cell isn't empty anymore (another arrow may
    // have grown into it since the queue was built).
    if (grid[ey][ex] !== 'empty') return null;

    // STEP 2 — Figure out which directions the arrow could possibly exit.
    // No valid exits → can't place anything here.
    const possibleDirs = getExitDirs(grid, ex, ey, w, h);
    if (possibleDirs.length === 0) return null;

    // STEP 3 — Anti-clustering setup. Count how many nearby arrows already
    // point each direction. When only one direction is valid this has no
    // effect (the weighted pick collapses to that single option), but when
    // there's a real choice we'll bias AWAY from over-used directions.
    const localCounts = localDirCounts(placedArrows, ex, ey, clusterRadius);

    // STEP 4 — SKIP-AND-ABSORB (only when the seed has exactly ONE valid exit,
    // which is the typical case for edge cells).
    //
    // The problem this solves: imagine the whole left edge of the board. Every
    // cell on it can only exit West. If we faithfully placed an arrow at each,
    // the entire left column would be a wall of West-pointing arrows, which
    // looks repetitive and plays the same way every time.
    //
    // The fix: don't always place. Look at how many same-direction arrows are
    // already near us ALONG the same edge, and the more crowded it is, the
    // more likely we are to refuse. The cleanup pass (fillEmptyCells) will
    // come along later and absorb this skipped cell into a neighbouring
    // arrow's TAIL — and that neighbour usually exits a different way, so
    // the visual repetition is broken up.
    if (possibleDirs.length === 1) {
        const only = possibleDirs[0];
        const onLeft = ex === 0, onRight = ex === w - 1, onTop = ey === 0, onBottom = ey === h - 1;

        // If we're on a left/right edge, "along the edge" means scanning up
        // and down (the y-axis). If we're on a top/bottom edge, it means
        // scanning left and right (the x-axis). null = interior cell.
        const edgeAxis: 'x' | 'y' | null =
            (onLeft || onRight) ? 'y' : (onTop || onBottom) ? 'x' : null;

        // Count other arrows pointing the same way within 10 cells along the
        // edge (or within a 4x4 box if we're interior).
        const longReach = 10;
        let nearbySameDir = 0;
        for (const a of placedArrows) {
            if (a.direction !== only) continue;
            const head = a.path[0];
            if (edgeAxis === 'y') {
                if (head.x === ex && Math.abs(head.y - ey) <= longReach) nearbySameDir++;
            } else if (edgeAxis === 'x') {
                if (head.y === ey && Math.abs(head.x - ex) <= longReach) nearbySameDir++;
            } else if (Math.abs(head.x - ex) <= 4 && Math.abs(head.y - ey) <= 4) {
                nearbySameDir++;
            }
        }
        // The more crowded it is with same-direction arrows, the more likely
        // we refuse to place. Even with zero neighbours there's a small 15%
        // skip chance — just to prevent random ordering from seeding a streak.
        const skipProb = nearbySameDir === 0 ? 0.15
                       : nearbySameDir === 1 ? 0.5
                       : nearbySameDir === 2 ? 0.75
                       :                       0.9;
        if (rng() < skipProb) return null;
    }

    // STEP 5 — Pick a final exit direction using the weighted random pick.
    // k=1.5 is the anti-clustering strength.
    const exitDir = pickWeightedDir(possibleDirs, localCounts, 1.5);

    // STEP 6 — Place the head. The arrow's path starts as a single cell
    // (the head) which we immediately mark 'occupied'.
    grid[ey][ex] = 'occupied';
    const path: GridPos[] = [{ x: ex, y: ey }];

    // The "preferred" growth direction is the OPPOSITE of the exit, so the
    // body trails behind the head pointing inward. We'll occasionally turn,
    // but most steps will follow this preferred direction.
    let { x: stepX, y: stepY } = INWARD[exitDir];
    let curX = ex, curY = ey;

    // Random body length between (minLen - 1) and (maxLen - 1). Subtracting 1
    // accounts for the head, which is already in the path.
    const bodyLength = Math.floor(rng() * (maxLen - minLen)) + (minLen - 1);

    // STEP 7 — Grow the body one cell at a time.
    for (let i = 0; i < bodyLength; i++) {
        // 7a. Look at the four neighbours of the current tail cell. Keep only
        // the ones that are inside the grid AND still empty. Shuffled so we
        // don't favour any one direction when picking a random fallback.
        const neighbors = shuffle([
            { x: curX - 1, y: curY },
            { x: curX + 1, y: curY },
            { x: curX, y: curY - 1 },
            { x: curX, y: curY + 1 },
        ]).filter(p => inBounds(p.x, p.y, w, h) && grid[p.y][p.x] === 'empty');

        // 7b. Boxed in? Body ends here, but we still keep what we've grown.
        if (neighbors.length === 0) break;

        // 7c. The "preferred" next cell is the one continuing in the current
        // direction (going straight). Is it still available?
        const preferred = { x: curX + stepX, y: curY + stepY };
        const hasPreferred = neighbors.some(p => p.x === preferred.x && p.y === preferred.y);

        let next: GridPos;
        if (hasPreferred) {
            // We can go straight. But every so often (changeDirChance, e.g.
            // 0.45 on a small board) we deliberately TURN to make the snake
            // wiggle instead of being a boring straight line.
            // We never turn on the very first body step (i > 0 guard), so the
            // arrow head + first cell always agree on direction.
            if (i > 0 && rng() < changeDirChance && neighbors.length > 1) {
                const others = neighbors.filter(p => !(p.x === preferred.x && p.y === preferred.y));
                next = others[Math.floor(rng() * others.length)];
            } else {
                next = preferred;
            }
        } else if (i === 0) {
            // The very first body step is blocked. That means the head
            // direction we committed to was actually impossible — undo the
            // head placement and report failure.
            grid[ey][ex] = 'empty';
            return null;
        } else {
            // Forced turn: preferred direction is blocked, but other empty
            // neighbours exist, so wander into a random one.
            next = neighbors[Math.floor(rng() * neighbors.length)];
        }

        // 7d. Commit the step: update the direction tracker, advance the
        // cursor, occupy the cell, and append it to the path.
        stepX = next.x - curX;
        stepY = next.y - curY;
        curX = next.x;
        curY = next.y;
        grid[curY][curX] = 'occupied';
        path.push({ x: curX, y: curY });
    }

    // STEP 8 — Done. Return the new arrow. (Colour is picked from the palette
    // by cycling through with the id; the final colour gets re-assigned at
    // the very end of generateLevel after arrows are renumbered.)
    return { id, direction: exitDir, path, color: COLORS[id % COLORS.length] };
}

// "Are these two cells right next to each other (up/down/left/right)?"
// Manhattan distance of 1.
function isAdjacent(a: GridPos, b: GridPos): boolean {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

// Merge any too-short arrows into a neighbour.
//
// After everything is placed, some arrows might still be only 1 or 2 cells
// long — usually leftovers from rescue passes. Those look weird, so we try
// to attach the entire short arrow onto the TAIL of a touching neighbour:
//
//   neighbour: H──B──B──T  +  bad: H──T   →   H──B──B──T──B──H
//                          (touches)               appended
//
// We keep doing this in a loop until no short arrows remain, or until we hit
// one that has no mergeable neighbour (a short arrow is acceptable; an
// unfillable empty cell is not).
function absorbShortArrows(arrows: Arrow[], minLen: number): Arrow[] {
    let result = [...arrows];

    let changed = true;
    while (changed) {
        changed = false;

        const badIdx = result.findIndex(a => a.path.length < minLen);
        if (badIdx === -1) break;

        const bad = result[badIdx];
        const badHead = bad.path[0];
        const badTail = bad.path[bad.path.length - 1];

        // Shuffle processing order during absorbing to prevent early-indexed arrows
        // from hoarding all of the merged blocks.
        const indices = shuffle(Array.from({ length: result.length }, (_, idx) => idx));

        // We try four merge patterns. Tail-side merges (1 & 2) preserve the
        // existing arrow's head and direction. Head-side merges (3 & 4)
        // prepend the short arrow, making its endpoint the new head — the
        // direction will be re-synced by alignDirectionsWithGeometry at the
        // end of generateLevel. Adding head-side merges roughly doubles the
        // chance of finding a mergeable neighbour, which is what keeps tiny
        // pockets (1-cell or 2-cell) from escaping as head-only arrows.
        let merged = false;
        for (const i of indices) {
            if (i === badIdx || i >= result.length) continue;
            const other = result[i];
            const otherHead = other.path[0];
            const otherTail = other.path[other.path.length - 1];

            // (1) bad's head touches other's tail → append bad as-is.
            // (2) bad's tail touches other's tail → append bad reversed.
            // (3) bad's tail touches other's head → prepend bad as-is.
            // (4) bad's head touches other's head → prepend bad reversed.
            let newPath: GridPos[] | null = null;
            if (isAdjacent(otherTail, badHead)) {
                newPath = [...other.path, ...bad.path];
            } else if (isAdjacent(otherTail, badTail)) {
                newPath = [...other.path, ...[...bad.path].reverse()];
            } else if (isAdjacent(otherHead, badTail)) {
                newPath = [...bad.path, ...other.path];
            } else if (isAdjacent(otherHead, badHead)) {
                newPath = [...[...bad.path].reverse(), ...other.path];
            }

            if (!newPath) continue;

            result[i] = { ...other, path: newPath };
            result.splice(badIdx, 1);
            changed = true;
            merged = true;
            break;
        }

        // The bad arrow has no mergeable neighbour at all (its endpoints
        // don't touch any other arrow's endpoint). Stop the loop instead of
        // spinning; a short arrow is a much better outcome than an
        // uncovered cell.
        if (!merged) break;
    }

    return result;
}

// CLEANUP PASS #1 — "Tail-walk fill"
//
// After the main loop, some cells will still be empty. Most of them are
// next to an existing arrow's TAIL — so we just grow the tail into them,
// one step at a time, like roots reaching into open soil.
//
// How it works:
//   1. Build a quick lookup: "which arrow has its tail at cell K?"
//   2. Find every empty cell that borders any tail and put it on a queue.
//   3. Pop cells off the queue one at a time:
//        - Pick a neighbour that's a tail.
//        - Move the tail INTO this cell (the cell is now occupied, the old
//          tail spot is now a body segment, and the lookup is updated so
//          the same arrow's tail is now at the new location).
//        - Any empty cells touching this brand-new tail get pushed onto the
//          queue, because they're now reachable too.
//
// The queue keeps the work proportional to the number of empty cells, not
// the size of the whole grid.
function fillEmptyCells(arrows: Arrow[], grid: Grid, w: number, h: number): Arrow[] {
    const result = arrows.map(a => ({ ...a, path: [...a.path] }));

    const tailOf = new Map<number, number>();
    for (let i = 0; i < result.length; i++) {
        const t = result[i].path[result[i].path.length - 1];
        tailOf.set(t.y * w + t.x, i);
    }

    const queue: number[] = [];
    const inQueue = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (grid[y][x] !== 'empty') continue;
            for (const [dx, dy] of STEPS) {
                const nx = x + dx, ny = y + dy;
                if (inBounds(nx, ny, w, h) && tailOf.has(ny * w + nx)) {
                    const k = y * w + x;
                    queue.push(k);
                    inQueue[k] = 1;
                    break;
                }
            }
        }
    }

    let head = 0;
    while (head < queue.length) {
        const key = queue[head++];
        inQueue[key] = 0;
        const x = key % w;
        const y = (key - x) / w;
        if (grid[y][x] !== 'empty') continue;

        for (const [dx, dy] of STEPS) {
            const nx = x + dx, ny = y + dy;
            if (!inBounds(nx, ny, w, h)) continue;
            const tk = ny * w + nx;
            const idx = tailOf.get(tk);
            if (idx === undefined) continue;
            // Move the tail from the neighbour into this cell.
            tailOf.delete(tk);
            tailOf.set(key, idx);
            grid[y][x] = 'occupied';
            result[idx].path.push({ x, y });
            // Expose any empty neighbours of the new tail to the queue.
            for (const [ddx, ddy] of STEPS) {
                const nnx = x + ddx, nny = y + ddy;
                if (!inBounds(nnx, nny, w, h)) continue;
                if (grid[nny][nnx] !== 'empty') continue;
                const nk = nny * w + nnx;
                if (inQueue[nk]) continue;
                queue.push(nk);
                inQueue[nk] = 1;
            }
            break;
        }
    }

    return result;
}

// CLEANUP PASS #2 (helper) — "Rescue arrow"
//
// Same idea as generateArrow but stripped of the picky anti-clustering /
// skip rules. We're at the bottom of the cleanup pipeline now: anything
// still empty MUST get covered. Pick any valid exit, lay down the head,
// grow up to maxLen cells, and ship it.
// Map "first body step direction" -> arrow exit direction.
// The body grows opposite the exit: a body step going north (dy = -1) means
// the head exits south. Used by the final alignment pass to derive each
// arrow's `direction` from its body geometry.
function exitForStep(dx: number, dy: number): Direction {
    if (dx === 1)  return 'W';
    if (dx === -1) return 'E';
    if (dy === 1)  return 'N';
    return 'S'; // dy === -1
}

function placeRescueArrow(
    grid: Grid,
    id: number,
    w: number,
    h: number,
    sx: number,
    sy: number,
    maxLen: number,
): Arrow | null {
    if (grid[sy][sx] !== 'empty') return null;
    const possibleDirs = getExitDirs(grid, sx, sy, w, h);
    if (possibleDirs.length === 0) return null;
    const exitDir = possibleDirs[Math.floor(rng() * possibleDirs.length)];

    grid[sy][sx] = 'occupied';
    const path: GridPos[] = [{ x: sx, y: sy }];
    let { x: stepX, y: stepY } = INWARD[exitDir];
    let curX = sx, curY = sy;

    for (let i = 0; i < maxLen - 1; i++) {
        const neighbors = shuffle([
            { x: curX - 1, y: curY },
            { x: curX + 1, y: curY },
            { x: curX, y: curY - 1 },
            { x: curX, y: curY + 1 },
        ]).filter(p => inBounds(p.x, p.y, w, h) && grid[p.y][p.x] === 'empty');
        if (neighbors.length === 0) break;
        const preferred = { x: curX + stepX, y: curY + stepY };
        const hasPreferred = neighbors.some(p => p.x === preferred.x && p.y === preferred.y);
        const next = hasPreferred ? preferred : neighbors[0];
        stepX = next.x - curX;
        stepY = next.y - curY;
        curX = next.x;
        curY = next.y;
        grid[curY][curX] = 'occupied';
        path.push({ x: curX, y: curY });
    }

    // The arrow's `direction` (driving the arrowhead's visual rotation) is
    // re-synced to match the body geometry by `alignDirectionsWithGeometry`
    // at the end of generateLevel — so we can store anything sensible here.
    return { id, direction: exitDir, path, color: COLORS[id % COLORS.length] };
}

// Last-resort cleanup for the single-cell arrow case.
//
// `absorbShortArrows` merges a short arrow into another arrow only when
// their endpoints touch. On larger grids, a head-only rescue arrow can land
// in a cell whose neighbours are all MIDDLE cells of other arrows — no
// endpoint match exists and absorb gives up, shipping a lone arrowhead.
//
// This pass guarantees no head-only arrow escapes: for each one, find any
// adjacent cell that's part of some other arrow's path. If that cell is an
// endpoint, simple prepend/append. If it's mid-path, SPLIT the host arrow
// there — the prefix swallows the head-only cell as its new tail, and the
// suffix becomes a brand-new arrow whose direction is synced by
// `alignDirectionsWithGeometry` later. The newly-created sub-arrow may
// itself be short, which is why we run `absorbShortArrows` again afterward.
function forceAbsorbHeadOnly(arrows: Arrow[]): Arrow[] {
    const result = arrows.map(a => ({ ...a, path: [...a.path] }));
    // Bounded loop: each iteration removes one head-only arrow. Splitting
    // a host into prefix + suffix creates at most one new arrow, so the
    // total arrow count is non-decreasing but bounded by O(N) total
    // operations; the safety budget below is generous.
    let safety = result.length * 8 + 64;
    while (safety-- > 0) {
        const badIdx = result.findIndex(a => a.path.length === 1);
        if (badIdx === -1) break;
        const bad = result[badIdx];
        const c = bad.path[0];

        // Pass 1: endpoint match (no split needed, always wins).
        let hostIdx = -1;
        let endpoint: 'head' | 'tail' | null = null;
        for (let i = 0; i < result.length; i++) {
            if (i === badIdx) continue;
            const path = result[i].path;
            if (isAdjacent(path[path.length - 1], c)) { hostIdx = i; endpoint = 'tail'; break; }
            if (isAdjacent(path[0], c)) { hostIdx = i; endpoint = 'head'; break; }
        }

        // Pass 2: middle-cell split. To avoid pingponging head-only arrows
        // back and forth (split → 1-cell suffix → split again at the same
        // neighbour → original tail re-orphaned), prefer a split that
        // produces a suffix of length >= 2. Only fall back to a 1-cell
        // suffix split when nothing better exists.
        let splitCellIdx = -1;
        let fallbackSplitHost = -1;
        let fallbackSplitCellIdx = -1;
        if (hostIdx === -1) {
            for (let i = 0; i < result.length; i++) {
                if (i === badIdx) continue;
                const path = result[i].path;
                const j = path.findIndex(p => isAdjacent(p, c));
                if (j === -1) continue;
                const suffixLen = path.length - 1 - j;
                if (suffixLen >= 2) { hostIdx = i; splitCellIdx = j; break; }
                if (fallbackSplitHost === -1) { fallbackSplitHost = i; fallbackSplitCellIdx = j; }
            }
            if (hostIdx === -1) { hostIdx = fallbackSplitHost; splitCellIdx = fallbackSplitCellIdx; }
        }

        if (hostIdx === -1) break; // truly orphan — extreme edge case.

        const host = result[hostIdx];
        if (endpoint === 'tail') {
            host.path.push(c);
        } else if (endpoint === 'head') {
            // Direction will be re-synced from the new head in the final pass.
            host.path.unshift(c);
        } else {
            // Middle split: prefix swallows c as its new tail, suffix
            // becomes a new arrow whose direction will be synthesized later.
            const suffix = host.path.slice(splitCellIdx + 1);
            host.path = host.path.slice(0, splitCellIdx + 1);
            host.path.push(c);
            if (suffix.length > 0) {
                result.push({
                    id: -1,
                    direction: 'N',
                    path: suffix,
                    color: '',
                });
            }
        }
        result.splice(badIdx, 1);
    }
    return result;
}

// Final pass: make every arrow's `direction` (used to rotate the arrowhead
// visual) match the body geometry. The invariant is: the step from path[0]
// to path[1] must equal `-INWARD[direction]` — i.e. the body grows AWAY
// from where the arrowhead points.
//
// Most arrows from the main loop already satisfy this (their first body
// step IS INWARD[chosen exit]). Rescue arrows can violate it when the
// inward step is blocked; this pass quietly corrects them by deriving the
// direction from the tangent at the head.
//
// Trade-off: the corrected direction may not be in the cell's
// `getExitDirs` set, so the arrow can start blocked. That's already a
// normal puzzle state — many arrows wait on their neighbours to clear
// before becoming tappable.
function alignDirectionsWithGeometry(arrows: Arrow[]): Arrow[] {
    return arrows.map(a => {
        if (a.path.length < 2) return a; // head-only — no body to align with
        const head = a.path[0];
        const next = a.path[1];
        const dx = next.x - head.x;
        const dy = next.y - head.y;
        const aligned = exitForStep(dx, dy);
        return aligned === a.direction ? a : { ...a, direction: aligned };
    });
}

// CLEANUP PASS #2 — "Rescue empty regions"
//
// Scan the whole grid. Any cell still empty (because it was walled in by
// other arrows' bodies, with no tail to extend) gets a brand-new rescue
// arrow planted in it.
//
// Note: rescue arrows are allowed to "exit through" cells occupied by other
// arrows. That's fine — those other arrows will leave first, clearing the
// path. Repeats until a full scan plants nothing new.
function rescueEmptyRegions(
    arrows: Arrow[],
    grid: Grid,
    w: number,
    h: number,
    maxLen: number,
): Arrow[] {
    const result = [...arrows];
    let nextId = result.reduce((m, a) => Math.max(m, a.id), -1) + 1;

    let placed = true;
    while (placed) {
        placed = false;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] !== 'empty') continue;
                const arrow = placeRescueArrow(grid, nextId, w, h, x, y, maxLen);
                if (arrow) {
                    result.push(arrow);
                    nextId++;
                    placed = true;
                }
            }
        }
    }

    return result;
}

// ─── SOLVABILITY VALIDATION ──────────────────────────────────────────────
//
// Two kinds of broken arrows can slip through the pipeline above:
//
//   1. SELF-BLOCKING — the arrow's body wraps around such that some body
//      cell sits in the head's own exit ray. The game's runtime blocking
//      check excludes the arrow's own body (the whole snake clears in one
//      tap), so it's *technically* tappable — but visually the snake
//      appears to block itself, which reads as a bug.
//
//   2. DEADLOCKED PAIR/CYCLE — two or more arrows form a cycle of mutual
//      blocking (A's body sits in B's exit ray AND B's body sits in A's
//      exit ray). Neither can ever be tapped → the puzzle is unsolvable.
//
// Validation: build the directed graph "A depends on B" iff B's body is in
// A's exit ray. The puzzle is solvable iff that graph is a DAG, which we
// check with a Kahn-style topological peel. Self-blocking is a separate
// per-arrow check; we fix it in place where possible by reversing the
// path (the OLD tail becomes the new head, exiting the opposite way —
// usually a viable direction since the body grew toward it).

/** True if the head's exit ray crosses any cell of the arrow's own body. */
function isSelfBlocked(arrow: Arrow, w: number, h: number): boolean {
    const d = OUTWARD[arrow.direction];
    const own = new Set(arrow.path.map(p => p.y * w + p.x));
    let x = arrow.path[0].x + d.x;
    let y = arrow.path[0].y + d.y;
    while (inBounds(x, y, w, h)) {
        if (own.has(y * w + x)) return true;
        x += d.x;
        y += d.y;
    }
    return false;
}

/** The set of arrow ids that can NEVER be tapped — i.e. they survive a
 *  topological peel of the blocking dependency graph. Empty set ⇒ solvable.
 *
 *  deps[id] = ids whose bodies sit in `id`'s exit ray; those must drain
 *  before `id` can be tapped. We iteratively remove arrows whose deps are all
 *  already removed; whatever remains is a deadlock cycle plus everything
 *  stuck behind it. */
function deadlockSurvivors(arrows: Arrow[], w: number, h: number): Set<number> {
    // cell key -> owning arrow id
    const owner = new Map<number, number>();
    for (const a of arrows) for (const p of a.path) owner.set(p.y * w + p.x, a.id);

    const deps = new Map<number, Set<number>>();
    for (const a of arrows) {
        const set = new Set<number>();
        const d = OUTWARD[a.direction];
        let x = a.path[0].x + d.x;
        let y = a.path[0].y + d.y;
        while (inBounds(x, y, w, h)) {
            const o = owner.get(y * w + x);
            if (o !== undefined && o !== a.id) set.add(o);
            x += d.x;
            y += d.y;
        }
        deps.set(a.id, set);
    }

    const removed = new Set<number>();
    let progress = true;
    while (progress && removed.size < arrows.length) {
        progress = false;
        for (const a of arrows) {
            if (removed.has(a.id)) continue;
            let ready = true;
            for (const d of deps.get(a.id)!) {
                if (!removed.has(d)) { ready = false; break; }
            }
            if (ready) { removed.add(a.id); progress = true; }
        }
    }

    const survivors = new Set<number>();
    for (const a of arrows) if (!removed.has(a.id)) survivors.add(a.id);
    return survivors;
}

/** Solvable iff no arrow survives the topological peel. */
function isPuzzleSolvable(arrows: Arrow[], w: number, h: number): boolean {
    return deadlockSurvivors(arrows, w, h).size === 0;
}

// ─── DEADLOCK REPAIR ──────────────────────────────────────────────────────
//
// On large boards (Iron Tangle, 180×180 ≈ 2,300 arrows) the union-bound makes
// it near-certain that SOME small blocking cycle forms in any single
// generation attempt, so retrying alone can never guarantee a solvable level —
// it occasionally exhausts every attempt and used to ship a known-unsolvable
// board. This repair fixes any deadlock deterministically.
//
// The primitive: take the globally topmost-then-leftmost cell `c*` among all
// surviving (deadlocked) arrows. Every cell ABOVE it, and every cell to its
// LEFT in its own row, is a non-survivor that drains first. Because `c*`'s own
// arrow is a survivor, `c*`'s in-arrow neighbours cannot lie north or west of
// it (that neighbour would be a more-extreme survivor cell) — so they are
// South or East. Re-root that arrow so `c*` is its head: a South neighbour ⇒
// exit North, an East neighbour ⇒ exit West. Either exit ray passes only
// through non-survivors, so the arrow becomes drainable and the survivor set
// strictly shrinks. Repeat until solvable.
//
// The same primitive (applied to an arrow's OWN extreme cell) also clears a
// self-blocked arrow, since the North/West ray can never cross the body that
// lies South/East of `c*`.

/** Re-root `work[ai]` so its cell at path index `k` becomes the head, exiting
 *  North or West. `k` must be that arrow's topmost-then-leftmost cell (its
 *  in-arrow neighbours are then all South/East). When `k` is interior the
 *  arrow is split and the orphaned piece is appended as a new arrow. */
function repointHeadAt(work: Arrow[], ai: number, k: number): void {
    const A = work[ai];
    // Head-only arrow: no body, no alignment constraint; North is always safe.
    if (A.path.length === 1) { work[ai] = { ...A, direction: 'N' }; return; }

    if (k === 0 || k === A.path.length - 1) {
        // Endpoint: just orient the path so this cell leads.
        const path = k === 0 ? A.path : [...A.path].reverse();
        work[ai] = { ...A, path, direction: exitForStep(path[1].x - path[0].x, path[1].y - path[0].y) };
        return;
    }

    // Interior: split, keeping a South/East neighbour as the new body so the
    // re-rooted head exits North or West.
    const c = A.path[k];
    const next = A.path[k + 1];
    const keepNext = (next.x === c.x && next.y === c.y + 1) || (next.x === c.x + 1 && next.y === c.y);
    const cSide = keepNext ? A.path.slice(k) : A.path.slice(0, k + 1).reverse();
    const otherSide = keepNext ? A.path.slice(0, k) : A.path.slice(k + 1);
    work[ai] = { ...A, path: cSide, direction: exitForStep(cSide[1].x - cSide[0].x, cSide[1].y - cSide[0].y) };
    const otherDir = otherSide.length >= 2
        ? exitForStep(otherSide[1].x - otherSide[0].x, otherSide[1].y - otherSide[0].y)
        : A.direction;
    work.push({ id: -1, direction: otherDir, path: otherSide, color: A.color });
}

/** Index of an arrow's topmost-then-leftmost cell. */
function extremeCellIndex(a: Arrow): number {
    let best = 0;
    for (let k = 1; k < a.path.length; k++) {
        const p = a.path[k], b = a.path[best];
        if (p.y < b.y || (p.y === b.y && p.x < b.x)) best = k;
    }
    return best;
}

/** Make `arrows` provably solvable AND self-block-free by repeatedly applying
 *  the re-point primitive. Each round either breaks a deadlock (re-pointing
 *  the global extreme survivor cell) or clears a self-blocked arrow
 *  (re-pointing its own extreme cell). Both strictly reduce the problem; the
 *  guard bounds the loop against pathological inputs. */
function repairDeadlocks(arrows: Arrow[], w: number, h: number): Arrow[] {
    let work = arrows.map(a => ({ ...a, path: [...a.path] }));
    const guard = work.length * 6 + 64;
    for (let round = 0; round < guard; round++) {
        const survivors = deadlockSurvivors(work, w, h);
        if (survivors.size > 0) {
            // Break a deadlock: re-point the global topmost-leftmost survivor cell.
            let best: { ai: number; k: number; x: number; y: number } | null = null;
            for (let ai = 0; ai < work.length; ai++) {
                if (!survivors.has(work[ai].id)) continue;
                const path = work[ai].path;
                for (let k = 0; k < path.length; k++) {
                    const p = path[k];
                    if (!best || p.y < best.y || (p.y === best.y && p.x < best.x)) best = { ai, k, x: p.x, y: p.y };
                }
            }
            repointHeadAt(work, best!.ai, best!.k);
            work = work.map((a, i) => ({ ...a, id: i }));
            continue;
        }
        // Solvable. Clear any self-blocked arrow by re-pointing it at its own
        // extreme cell; that may reintroduce a deadlock, repaired next round.
        const sb = work.findIndex(a => isSelfBlocked(a, w, h));
        if (sb === -1) return work;
        repointHeadAt(work, sb, extremeCellIndex(work[sb]));
        work = work.map((a, i) => ({ ...a, id: i }));
    }
    return work;
}

/** Try to repair each self-blocked arrow in place by reversing its path
 *  (and re-deriving direction from the new head). If a reversed arrow is
 *  still self-blocked, the geometry is fundamentally bad — return null so
 *  the caller falls through to full regeneration. */
function fixSelfBlockedArrows(arrows: Arrow[], w: number, h: number): Arrow[] | null {
    const fixed: Arrow[] = [];
    for (const a of arrows) {
        if (!isSelfBlocked(a, w, h)) { fixed.push(a); continue; }
        if (a.path.length < 2) { fixed.push(a); continue; } // head-only — no reverse possible

        // Reverse the path. Direction must be re-derived from the new
        // head's tangent to match the post-reverse geometry.
        const reversed = [...a.path].reverse();
        const head = reversed[0];
        const next = reversed[1];
        const newDir = exitForStep(next.x - head.x, next.y - head.y);
        const candidate: Arrow = { ...a, path: reversed, direction: newDir };
        if (isSelfBlocked(candidate, w, h)) return null; // unfixable in place
        fixed.push(candidate);
    }
    return fixed;
}

// ─────────────────────────────────────────────────────────────────────────
// THE PUBLIC ENTRY POINT.
// Called once per puzzle. Returns a finished Level: width, height, and a
// list of Arrows that fully tile the grid.
//
// Wraps the actual generation in a validate-and-retry loop: each attempt
// runs the pipeline, then we (a) reverse any self-blocked arrows and
// (b) check the blocking graph is a DAG. If both pass, we ship. Otherwise
// we regenerate, up to MAX_GEN_ATTEMPTS times — most sizes find a naturally
// clean board in the first 1–2 tries. If every attempt deadlocks (near-certain
// on huge boards like Iron Tangle, where the sheer arrow count makes some
// blocking cycle almost inevitable), we DETERMINISTICALLY REPAIR the last
// candidate instead of shipping it broken, guaranteeing a solvable level.
// ─────────────────────────────────────────────────────────────────────────
const MAX_GEN_ATTEMPTS = 12;

export function generateLevel(width = 9, height = 9, seed?: number): Level {
    // Swap in a deterministic PRNG for the duration of a seeded call so
    // any failure surfaced in a test is reproducible from one integer.
    // Production callers omit `seed` → rng stays Math.random.
    const prevRng = rng;
    if (seed !== undefined) rng = mulberry32(seed);
    try {
        let last: Level | null = null;
        for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
            const candidate = generateLevelOnce(width, height);
            const fixed = fixSelfBlockedArrows(candidate.arrows, width, height);
            if (fixed === null) { last = candidate; continue; }
            if (!isPuzzleSolvable(fixed, width, height)) { last = { ...candidate, arrows: fixed }; continue; }
            return { ...candidate, arrows: fixed };
        }
        // Every attempt deadlocked (or had unfixable self-blocks). Repair the
        // last candidate so the shipped level is always solvable rather than
        // hanging the UI on endless retries.
        const repaired = repairDeadlocks(last!.arrows, width, height);
        return {
            ...last!,
            arrows: repaired.map((a, i) => ({ ...a, id: i, color: COLORS[i % COLORS.length] })),
        };
    } finally {
        rng = prevRng;
    }
}

function generateLevelOnce(
    width: number,
    height: number,
): Level {
    // STAGE A — set up state.
    const grid = makeGrid(width, height);   // fresh empty board
    const arrows: Arrow[] = [];              // the arrows we've placed so far
    let id = 0;                              // next arrow id to hand out
    let consecutiveFails = 0;                // how many seeds in a row failed

    // STAGE B — compute size-dependent parameters.
    //
    // Most tuning knobs scale with the SHORTER side of the board, because
    // that's what limits how long an arrow can usefully be without snaking
    // back on itself.
    const shortDimension = Math.min(width, height);

    // maxLength: hard-cap of 30 cells, but scales up with the board (~1.2×
    // the short side). Caps out at 30 so on huge boards we still get lots of
    // small arrows instead of a few giant ones.
    const maxLength = Math.min(30, Math.max(7, Math.floor(shortDimension * 1.2)));
    // minLength must not exceed maxLength — on very large grids the 0.5× formula
    // would exceed the cap (e.g. Floor Boss shortDim=91 → raw min=45 > max=30),
    // which inverts the random range and breaks the body-length calculation.
    const minLength = Math.min(Math.max(4, Math.floor(shortDimension * 0.5)), Math.max(4, maxLength - 4));

    // Arrow-quality threshold for the final absorb pass. Kept low (constant)
    // because rescue arrows in tight pockets often have tails bordering other
    // arrows' bodies, not tails — absorbShortArrows can't merge those, and
    // a few short arrows on a huge board are a better outcome than the
    // previous behaviour of leaving large regions empty.
    const ABSORB_MIN = 3;

    // Dead-pocket guard during the main placement loop. Was previously tied
    // to `Math.floor(shortDimension * 0.25)`, which on Ludicrous/Iron Tangle
    // grew so large (22–48 cells) that nearly every late placement was
    // rejected for splitting off a "too-small" pocket; the loop spun and
    // exited with thousands of cells empty. A constant of 3 is achievable in
    // practice and the rescue pass handles the rest.
    const DEAD_POCKET_MIN = 3;

    // changeDirChance: how often an arrow body wiggles instead of going
    // straight. Small boards (9×9) wiggle ~38% of steps; huge boards (190×190)
    // are capped at 10% so giant arrows don't look like noise.
    const changeDirChance = Math.max(0.1, 0.45 - (shortDimension * 0.007));

    // clusterRadius: window size for the anti-clustering check. Scales with
    // the board so small boards still see a meaningful neighbourhood.
    const clusterRadius = Math.max(3, Math.floor(shortDimension * 0.35));

    // STAGE C — build a shuffled spawn queue containing every cell.
    // The main loop will walk through these as candidate seed positions.
    let spawnQueue: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            spawnQueue.push({ x, y });
        }
    }
    spawnQueue = shuffle(spawnQueue);
    let queueIndex = 0;

    // Track empty cells with a counter instead of re-scanning the grid every
    // iteration — matters a lot on the huge difficulties.
    let emptyCount = width * height;

    // Safety valve: if we go a very long time without any successful
    // placement, give up and let the cleanup passes finish things off.
    const maxFails = width * height * 4;

    // ── STAGE D ── MAIN PLACEMENT LOOP ───────────────────────────────────
    // Keep trying to plant arrows until the board is full or we stall.
    while (emptyCount > 0 && consecutiveFails < maxFails) {
        // D.1 — Ran out of seeds? Reshuffle and start over.
        if (queueIndex >= spawnQueue.length) {
            spawnQueue = shuffle(spawnQueue);
            queueIndex = 0;
        }
        const seedPos = spawnQueue[queueIndex++];

        // D.2 — Try to grow one arrow from this seed.
        const arrow = generateArrow(grid, id, width, height, minLength, maxLength, changeDirChance, seedPos, arrows, clusterRadius);

        if (arrow) {
            // D.3 — Got an arrow. But does it trap a tiny empty pocket? If
            // yes, rip every cell of its path back out of the grid and call
            // this a failed attempt. (The cells go back to 'empty' so a
            // different seed/direction can use them.)
            if (hasDeadPocketNear(grid, arrow.path, DEAD_POCKET_MIN, width, height)) {
                for (const p of arrow.path) grid[p.y][p.x] = 'empty';
                consecutiveFails++;
                continue;
            }
            // D.4 — Keep the arrow.
            arrows.push(arrow);
            emptyCount -= arrow.path.length;
            id++;
            consecutiveFails = 0;
        } else {
            // generateArrow rejected the seed (skipped, no exits, etc.).
            consecutiveFails++;
        }
    }

    // ── STAGE E ── CLEANUP PASSES ────────────────────────────────────────

    // E.1 — Fill any remaining empties by walking arrow tails into them.
    let result = fillEmptyCells(arrows, grid, width, height);

    // E.2 — Plant fresh "rescue" arrows in any cells still empty (these are
    // the ones fully enclosed by arrow BODIES, with no tails to absorb them).
    result = rescueEmptyRegions(result, grid, width, height, maxLength);

    // E.3 — Run tail-walk fill again. The rescue arrows in E.2 introduced
    // new tails, which may now reach pockets the first pass couldn't.
    result = fillEmptyCells(result, grid, width, height);

    // E.4 — Final tidy: any arrow shorter than ABSORB_MIN gets merged into
    // a neighbouring arrow if possible.
    result = absorbShortArrows(result, ABSORB_MIN);

    // E.5 — Aggressive head-only cleanup. `absorbShortArrows` only merges
    // when arrow endpoints touch; any head-only arrow stranded among
    // middle cells slips through. Split a host arrow if needed so the lone
    // arrowhead always lands inside someone's body.
    result = forceAbsorbHeadOnly(result);

    // E.6 — Run absorb again; the head-only split above can leave a
    // 1- or 2-cell suffix arrow that should be merged on the new endpoints.
    result = absorbShortArrows(result, ABSORB_MIN);

    // E.7 — Resync each arrow's `direction` (drives arrowhead rotation) to
    // match the body geometry. Catches both the rescue-arrow misalignment
    // case and the prepended-via-merge case where the head moved but
    // `direction` didn't update.
    result = alignDirectionsWithGeometry(result);

    // ── STAGE F ── HAND OFF THE FINISHED LEVEL ───────────────────────────
    // Re-number the arrows 0..N-1 and re-assign palette colours so the ids
    // and colours stay tidy after all the inserts, deletes, and merges.
    return {
        width,
        height,
        arrows: result.map((a, i) => ({ ...a, id: i, color: COLORS[i % COLORS.length] })),
    };
}
