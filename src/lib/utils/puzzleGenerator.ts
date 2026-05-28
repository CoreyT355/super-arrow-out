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

// The board is just a 2D array of strings — every cell is either empty (no
// arrow yet) or occupied (some arrow's body covers it).
type Grid = ('empty' | 'occupied')[][];

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
        const j = Math.floor(Math.random() * (i + 1));
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
    let r = Math.random() * total;
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
        if (Math.random() < skipProb) return null;
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
    const bodyLength = Math.floor(Math.random() * (maxLen - minLen)) + (minLen - 1);

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
            if (i > 0 && Math.random() < changeDirChance && neighbors.length > 1) {
                const others = neighbors.filter(p => !(p.x === preferred.x && p.y === preferred.y));
                next = others[Math.floor(Math.random() * others.length)];
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
            next = neighbors[Math.floor(Math.random() * neighbors.length)];
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

        let merged = false;
        for (const i of indices) {
            if (i === badIdx || i >= result.length) continue;
            const other = result[i];
            const tail = other.path[other.path.length - 1];

            let extension: GridPos[] | null = null;
            if (isAdjacent(tail, badHead)) {
                extension = bad.path;
            } else if (isAdjacent(tail, badTail)) {
                extension = [...bad.path].reverse();
            }

            if (!extension) continue;

            result[i] = { ...other, path: [...other.path, ...extension] };
            result.splice(badIdx, 1);
            changed = true;
            merged = true;
            break;
        }

        // The bad arrow has no mergeable neighbor (its endpoints don't sit
        // next to any other arrow's tail). Stop the loop instead of spinning;
        // a short arrow is a much better outcome than the previous behavior
        // of leaving the cells empty entirely.
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
    const exitDir = possibleDirs[Math.floor(Math.random() * possibleDirs.length)];

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

    return { id, direction: exitDir, path, color: COLORS[id % COLORS.length] };
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

// ─────────────────────────────────────────────────────────────────────────
// THE PUBLIC ENTRY POINT.
// Called once per puzzle. Returns a finished Level: width, height, and a
// list of Arrows that fully tile the grid.
// ─────────────────────────────────────────────────────────────────────────
export function generateLevel(
    width = 9,
    height = 9
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

    // ── STAGE F ── HAND OFF THE FINISHED LEVEL ───────────────────────────
    // Re-number the arrows 0..N-1 and re-assign palette colours so the ids
    // and colours stay tidy after all the inserts, deletes, and merges.
    return {
        width,
        height,
        arrows: result.map((a, i) => ({ ...a, id: i, color: COLORS[i % COLORS.length] })),
    };
}
