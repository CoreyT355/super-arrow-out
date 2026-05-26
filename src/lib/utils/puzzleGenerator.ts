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

function makeGrid(w: number, h: number): Grid {
    return Array.from({ length: h }, () => Array<'empty' | 'occupied'>(w).fill('empty'));
}

function inBounds(x: number, y: number, w: number, h: number): boolean {
    return x >= 0 && x < w && y >= 0 && y < h;
}

function allOccupied(grid: Grid, w: number, h: number): boolean {
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            if (grid[y][x] === 'empty') return false;
    return true;
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

    if (onLeft) dirs.push('W');
    if (onRight) dirs.push('E');
    if (onTop) dirs.push('N');
    if (onBottom) dirs.push('S');

    if (dirs.length === 0) {
        if (clearPathToEdge(grid, x, y, -1, 0, w, h)) dirs.push('W');
        if (clearPathToEdge(grid, x, y, 1, 0, w, h)) dirs.push('E');
        if (clearPathToEdge(grid, x, y, 0, -1, w, h)) dirs.push('N');
        if (clearPathToEdge(grid, x, y, 0, 1, w, h)) dirs.push('S');
    }

    // CRITICAL: Shuffle the exit array so the code doesn't implicitly 
    // favor West or North when multiple directions are valid.
    return shuffle(dirs);
}

// Returns the sizes of all connected components of empty cells.
function emptyPocketSizes(grid: Grid, w: number, h: number): number[] {
    const visited = new Set<number>();
    const sizes: number[] = [];
    const key = (x: number, y: number) => y * w + x;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (grid[y][x] !== 'empty' || visited.has(key(x, y))) continue;
            const queue = [{ x, y }];
            visited.add(key(x, y));
            let size = 0;
            while (queue.length > 0) {
                const { x: cx, y: cy } = queue.shift()!;
                size++;
                for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                    const nx = cx + dx, ny = cy + dy;
                    if (inBounds(nx, ny, w, h) && grid[ny][nx] === 'empty' && !visited.has(key(nx, ny))) {
                        visited.add(key(nx, ny));
                        queue.push({ x: nx, y: ny });
                    }
                }
            }
            sizes.push(size);
        }
    }

    return sizes;
}

function generateArrow(
    grid: Grid,
    id: number,
    w: number,
    h: number,
    minLen: number,
    maxLen: number,
    changeDirChance: number,
    seedPos: GridPos // Now accepting the dynamic shuffled entry seed directly
): Arrow | null {
    const { x: ex, y: ey } = seedPos;
    
    // If the random seed position isn't valid or open, reject immediately 
    if (grid[ey][ex] !== 'empty') return null;

    const possibleDirs = getExitDirs(grid, ex, ey, w, h);
    if (possibleDirs.length === 0) return null;

    // Pick a random exit route out of our shuffled possibilities
    const exitDir = possibleDirs[Math.floor(Math.random() * possibleDirs.length)];

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
            break;
        }
    }

    return result;
}

// After the main generation loop, extend arrow tails to absorb any remaining
// empty cells. The tail map is updated dynamically so a tail can "walk" through
// a chain of adjacent empties in a single pass of the outer while loop.
// Cells that are completely surrounded by non-tail occupied cells (rare) are
// left alone — they cannot be absorbed without breaking path connectivity.
function fillEmptyCells(arrows: Arrow[], grid: Grid, w: number, h: number): Arrow[] {
    const result = arrows.map(a => ({ ...a, path: [...a.path] }));

    let changed = true;
    while (changed) {
        changed = false;

        // tail position key → index into result[]
        const tailOf = new Map<number, number>();
        for (let i = 0; i < result.length; i++) {
            const t = result[i].path[result[i].path.length - 1];
            tailOf.set(t.y * w + t.x, i);
        }

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] !== 'empty') continue;
                for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
                    const nx = x + dx, ny = y + dy;
                    if (!inBounds(nx, ny, w, h)) continue;
                    const idx = tailOf.get(ny * w + nx);
                    if (idx === undefined) continue;
                    // Absorb: move the tail from the neighbour to this cell
                    tailOf.delete(ny * w + nx);
                    tailOf.set(y * w + x, idx);
                    grid[y][x] = 'occupied';
                    result[idx].path.push({ x, y });
                    changed = true;
                    break;
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
    const MIN_ARROW_LEN = Math.max(3, Math.floor(shortDimension * 0.25));
    const changeDirChance = Math.max(0.1, 0.45 - (shortDimension * 0.007));

    let spawnQueue: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            spawnQueue.push({ x, y });
        }
    }
    spawnQueue = shuffle(spawnQueue);
    let queueIndex = 0;

    const maxFails = width * height * 4; // Slightly increased threshold to account for random exploration 
    
    while (!allOccupied(grid, width, height) && consecutiveFails < maxFails) {
        if (queueIndex >= spawnQueue.length) {
            spawnQueue = shuffle(spawnQueue);
            queueIndex = 0;
        }
        const seedPos = spawnQueue[queueIndex++];

        // CRITICAL CHANGE: We now pass the random seed point straight into the generator!
        const arrow = generateArrow(grid, id, width, height, minLength, maxLength, changeDirChance, seedPos);

        if (arrow) {
            const pockets = emptyPocketSizes(grid, width, height);
            const createsDeadPocket = pockets.some(s => s > 0 && s < MIN_ARROW_LEN);

            if (createsDeadPocket) {
                for (const p of arrow.path) grid[p.y][p.x] = 'empty';
                consecutiveFails++;
                continue;
            }

            arrows.push(arrow);
            id++;
            consecutiveFails = 0;
        } else {
            consecutiveFails++;
        }
    }

    const absorbed = absorbShortArrows(arrows, MIN_ARROW_LEN);
    const finalArrows = fillEmptyCells(absorbed, grid, width, height);

    return {
        width,
        height,
        arrows: finalArrows.map((a, i) => ({ ...a, id: i, color: COLORS[i % COLORS.length] })),
    };
}
