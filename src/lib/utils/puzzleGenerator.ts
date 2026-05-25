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

	return dirs;
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
	changeDirChance: number
): Arrow | null {
	const exits: GridPos[] = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (grid[y][x] !== 'empty') continue;
			if (getExitDirs(grid, x, y, w, h).length > 0) exits.push({ x, y });
		}
	}
	if (exits.length === 0) return null;

	const exitPos = exits[Math.floor(Math.random() * exits.length)];
	const { x: ex, y: ey } = exitPos;

	const possibleDirs = getExitDirs(grid, ex, ey, w, h);
	if (possibleDirs.length === 0) return null;

	const exitDir = possibleDirs[Math.floor(Math.random() * possibleDirs.length)];

	grid[ey][ex] = 'occupied';
	const path: GridPos[] = [{ x: ex, y: ey }];

	let { x: stepX, y: stepY } = INWARD[exitDir];
	let curX = ex, curY = ey;

	const bodyLength = Math.floor(Math.random() * (maxLen - minLen)) + (minLen - 1);

	for (let i = 0; i < bodyLength; i++) {
		const neighbors = [
			{ x: curX - 1, y: curY },
			{ x: curX + 1, y: curY },
			{ x: curX, y: curY - 1 },
			{ x: curX, y: curY + 1 },
		].filter(p => inBounds(p.x, p.y, w, h) && grid[p.y][p.x] === 'empty');

		if (neighbors.length === 0) break;

		const preferred = { x: curX + stepX, y: curY + stepY };
		const hasPreferred = neighbors.some(p => p.x === preferred.x && p.y === preferred.y);

		let next: GridPos;
		if (hasPreferred) {
			if (Math.random() < changeDirChance && neighbors.length > 1) {
				const others = neighbors.filter(p => !(p.x === preferred.x && p.y === preferred.y));
				next = others[Math.floor(Math.random() * others.length)];
			} else {
				next = preferred;
			}
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

function hasTurn(path: GridPos[]): boolean {
	for (let i = 2; i < path.length; i++) {
		if (
			(path[i].x - path[i - 1].x) !== (path[i - 1].x - path[i - 2].x) ||
			(path[i].y - path[i - 1].y) !== (path[i - 1].y - path[i - 2].y)
		) return true;
	}
	return false;
}

// Absorb arrows shorter than minLen into an adjacent arrow's tail.
// Only ever extends tails, so exit directions and solvability are preserved.
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

		for (let i = 0; i < result.length; i++) {
			if (i === badIdx) continue;
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

export function generateLevel(
	width = 9,
	height = 9,
	minLength = 5,
	maxLength = 10,
	changeDirChance = 0.3
): Level {
	const grid = makeGrid(width, height);
	const arrows: Arrow[] = [];
	let id = 0;
	let consecutiveFails = 0;
	const MIN_ARROW_LEN = 3;

	while (!allOccupied(grid, width, height) && consecutiveFails < 400) {
		const arrow = generateArrow(grid, id, width, height, minLength, maxLength, changeDirChance);

		if (arrow) {
			// Reject this placement if it strands any empty pocket too small to hold a valid arrow.
			// Those pockets could never be filled without producing a short stub.
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

	// Safety net: absorb any remaining short arrows (e.g. from the final few cells).
	const finalArrows = absorbShortArrows(arrows, MIN_ARROW_LEN);

	// Re-assign IDs and colours after merging.
	return {
		width,
		height,
		arrows: finalArrows.map((a, i) => ({ ...a, id: i, color: COLORS[i % COLORS.length] })),
	};
}
