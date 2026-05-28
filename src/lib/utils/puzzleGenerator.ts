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

const INWARD: Record<Direction, GridPos> = {
    N: { x: 0, y: 1 },
    S: { x: 0, y: -1 },
    E: { x: -1, y: 0 },
    W: { x: 1, y: 0 },
};

type Grid = ('empty' | 'occupied')[][];

const STEPS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function makeGrid(w: number, h: number): Grid {
    return Array.from({ length: h }, () => Array<'empty' | 'occupied'>(w).fill('empty'));
}

function inBounds(x: number, y: number, w: number, h: number): boolean {
    return x >= 0 && x < w && y >= 0 && y < h;
}

function clearPathToEdge(grid: Grid, sx: number, sy: number, dx: number, dy: number, w: number, h: number): boolean {
    let x = sx + dx, y = sy + dy;
    let reachedEdge = false;
    while (inBounds(x, y, w, h)) {
        if (grid[y][x] === 'empty') return false;
        if (x === 0 || x === w - 1 || y === 0 || y === h - 1) reachedEdge = true;
        x += dx;
        y += dy;
    }
    return reachedEdge || (sx + dx < 0 || sx + dx >= w || sy + dy < 0 || sy + dy >= h);
}

// Simple array shuffler (Fisher-Yates) used to break linear biases
function shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

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

// Walk the empty cells adjacent to a freshly placed arrow's path and check
// whether any of them sit in a pocket smaller than `minSize`. Each BFS stops
// as soon as the pocket reaches minSize, so the work per check is O(path *
// minSize) rather than O(width * height) — important on large grids where the
// dead-pocket check fires after every accepted placement.
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

// Count how many already-placed arrows in a square window around (cx,cy) exit
// in each direction. Used to bias new picks AWAY from over-represented dirs.
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

// Weighted pick: each direction's weight = 1 / (1 + k * localCount).
// k controls how strongly clustering is penalized — bigger k → stronger anti-clustering.
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

function generateArrow(
    grid: Grid,
    id: number,
    w: number,
    h: number,
    minLen: number,
    maxLen: number,
    changeDirChance: number,
    seedPos: GridPos, // Now accepting the dynamic shuffled entry seed directly
    placedArrows: Arrow[],
    clusterRadius: number
): Arrow | null {
    const { x: ex, y: ey } = seedPos;

    // If the random seed position isn't valid or open, reject immediately
    if (grid[ey][ex] !== 'empty') return null;

    const possibleDirs = getExitDirs(grid, ex, ey, w, h);
    if (possibleDirs.length === 0) return null;

    // Anti-clustering: bias the pick against directions over-represented
    // among neighbouring arrows. When only one direction is valid (common on
    // edges), the weighted pick degenerates to that single choice.
    const localCounts = localDirCounts(placedArrows, ex, ey, clusterRadius);

    // Skip-and-absorb: if the seed is FORCED into a single direction (typical
    // for edge cells), bail out probabilistically so fillEmptyCells later
    // absorbs the cell into a neighbour's tail — which usually points a
    // different way. Breaks long contiguous stretches of edge heads all
    // exiting the same way. The count looks ALONG the edge axis with a long
    // reach, since scattered spawn order means same-edge clusters often form
    // before tight-box detection would notice.
    if (possibleDirs.length === 1) {
        const only = possibleDirs[0];
        const onLeft = ex === 0, onRight = ex === w - 1, onTop = ey === 0, onBottom = ey === h - 1;
        const edgeAxis: 'x' | 'y' | null =
            (onLeft || onRight) ? 'y' : (onTop || onBottom) ? 'x' : null;

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
        // Ramp: even at 0 nearby, a small base skip prevents stochastic
        // clustering from random spawn ordering establishing a foothold.
        const skipProb = nearbySameDir === 0 ? 0.15
                       : nearbySameDir === 1 ? 0.5
                       : nearbySameDir === 2 ? 0.75
                       :                       0.9;
        if (Math.random() < skipProb) return null;
    }

    const exitDir = pickWeightedDir(possibleDirs, localCounts, 1.5);

    grid[ey][ex] = 'occupied';
    const path: GridPos[] = [{ x: ex, y: ey }];

    let { x: stepX, y: stepY } = INWARD[exitDir];
    let curX = ex, curY = ey;

    const bodyLength = Math.floor(Math.random() * (maxLen - minLen)) + (minLen - 1);

    for (let i = 0; i < bodyLength; i++) {
        // Shuffle neighbors to avoid an implicit directional bias when growing
        const neighbors = shuffle([
            { x: curX - 1, y: curY },
            { x: curX + 1, y: curY },
            { x: curX, y: curY - 1 },
            { x: curX, y: curY + 1 },
        ]).filter(p => inBounds(p.x, p.y, w, h) && grid[p.y][p.x] === 'empty');

        if (neighbors.length === 0) break;

        const preferred = { x: curX + stepX, y: curY + stepY };
        const hasPreferred = neighbors.some(p => p.x === preferred.x && p.y === preferred.y);

        let next: GridPos;
        if (hasPreferred) {
            if (i > 0 && Math.random() < changeDirChance && neighbors.length > 1) {
                const others = neighbors.filter(p => !(p.x === preferred.x && p.y === preferred.y));
                next = others[Math.floor(Math.random() * others.length)];
            } else {
                next = preferred;
            }
        } else if (i === 0) {
            grid[ey][ex] = 'empty';
            return null;
        } else {
            next = neighbors[Math.floor(Math.random() * neighbors.length)];
        }

        stepX = next.x - curX;
        stepY = next.y - curY;
        curX = next.x;
        curY = next.y;
        grid[curY][curX] = 'occupied';
        path.push({ x: curX, y: curY });
    }

    return { id, direction: exitDir, path, color: COLORS[id % COLORS.length] };
}

function isAdjacent(a: GridPos, b: GridPos): boolean {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

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

// Tail-walk fill: extends arrow tails into adjacent empty cells one step at
// a time. Uses a queue seeded with empties that border a tail, and pushes new
// neighbours onto the queue as each absorption exposes them. Linear in the
// grid size, where the previous version re-scanned the whole grid per pass.
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

// Lay down a fresh arrow seeded at (sx, sy). Used by the rescue pass to fill
// any remaining empty cells that fillEmptyCells couldn't reach (pockets
// enclosed by arrow bodies with no tail neighbour). Skips the anti-clustering
// and skip-and-absorb heuristics — by the time we get here we want the seed
// to succeed if any exit direction exists.
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

// Scan the grid and place rescue arrows at every remaining empty cell. The
// rescue arrows may exit through other arrows' bodies — that's a valid puzzle
// state, since the player must clear those obstructing arrows first. Iterates
// until no more placements succeed, which guarantees no empty cells remain
// when the placement is geometrically possible.
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

export function generateLevel(
    width = 9,
    height = 9
): Level {
    const grid = makeGrid(width, height);
    const arrows: Arrow[] = [];
    let id = 0;
    let consecutiveFails = 0;

    const shortDimension = Math.min(width, height);
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

    const changeDirChance = Math.max(0.1, 0.45 - (shortDimension * 0.007));
    // Radius of the "neighborhood" used for anti-clustering direction weighting.
    // Scales with grid size so a small board still sees a meaningful window.
    const clusterRadius = Math.max(3, Math.floor(shortDimension * 0.35));

    let spawnQueue: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            spawnQueue.push({ x, y });
        }
    }
    spawnQueue = shuffle(spawnQueue);
    let queueIndex = 0;

    // Cached empty-cell counter — avoids an O(W*H) allOccupied scan per
    // iteration on large grids. Decrement on accepted placement, restore on
    // rollback.
    let emptyCount = width * height;

    const maxFails = width * height * 4;

    while (emptyCount > 0 && consecutiveFails < maxFails) {
        if (queueIndex >= spawnQueue.length) {
            spawnQueue = shuffle(spawnQueue);
            queueIndex = 0;
        }
        const seedPos = spawnQueue[queueIndex++];

        const arrow = generateArrow(grid, id, width, height, minLength, maxLength, changeDirChance, seedPos, arrows, clusterRadius);

        if (arrow) {
            if (hasDeadPocketNear(grid, arrow.path, DEAD_POCKET_MIN, width, height)) {
                for (const p of arrow.path) grid[p.y][p.x] = 'empty';
                consecutiveFails++;
                continue;
            }
            arrows.push(arrow);
            emptyCount -= arrow.path.length;
            id++;
            consecutiveFails = 0;
        } else {
            consecutiveFails++;
        }
    }

    // Tail-walk fill: extend existing arrow tails into adjacent empty cells.
    let result = fillEmptyCells(arrows, grid, width, height);

    // Rescue: place fresh arrows in any remaining empty regions (those
    // enclosed by arrow bodies with no tail neighbour).
    result = rescueEmptyRegions(result, grid, width, height, maxLength);

    // Run tail-walk fill again — rescue arrows expose new tails which may
    // reach cells the first pass couldn't.
    result = fillEmptyCells(result, grid, width, height);

    // Merge any sub-ABSORB_MIN arrows whose endpoints touch another tail.
    result = absorbShortArrows(result, ABSORB_MIN);

    return {
        width,
        height,
        arrows: result.map((a, i) => ({ ...a, id: i, color: COLORS[i % COLORS.length] })),
    };
}
