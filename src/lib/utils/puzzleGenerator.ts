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

// The inward step direction for body growth, keyed by exit direction.
// Exit N (top) → body grows south (+y). Exit E (right) → body grows west (-x). etc.
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

// Scan a line of cells; returns true if every cell from (sx,sy) stepping (dx,dy)
// until hitting the grid boundary is occupied.
function clearPathToEdge(grid: Grid, sx: number, sy: number, dx: number, dy: number, w: number, h: number): boolean {
	let x = sx + dx, y = sy + dy;
	let reachedEdge = false;
	while (inBounds(x, y, w, h)) {
		if (grid[y][x] === 'empty') return false;
		if (x === 0 || x === w - 1 || y === 0 || y === h - 1) reachedEdge = true;
		x += dx;
		y += dy;
	}
	// The step that took us out-of-bounds means we just passed the edge.
	// reachedEdge is true if we visited an edge cell along the way, OR
	// if the very first step was already OOB (meaning sx,sy is the edge) — handled by callers.
	return reachedEdge || (sx + dx < 0 || sx + dx >= w || sy + dy < 0 || sy + dy >= h);
}

function getExitDirs(grid: Grid, x: number, y: number, w: number, h: number): Direction[] {
	const dirs: Direction[] = [];
	const onLeft = x === 0, onRight = x === w - 1, onTop = y === 0, onBottom = y === h - 1;

	if (onLeft) dirs.push('W');
	if (onRight) dirs.push('E');
	if (onTop) dirs.push('N');
	if (onBottom) dirs.push('S');

	// Interior cell — check if a straight run of occupied cells reaches the edge
	if (dirs.length === 0) {
		if (clearPathToEdge(grid, x, y, -1, 0, w, h)) dirs.push('W');
		if (clearPathToEdge(grid, x, y, 1, 0, w, h)) dirs.push('E');
		if (clearPathToEdge(grid, x, y, 0, -1, w, h)) dirs.push('N');
		if (clearPathToEdge(grid, x, y, 0, 1, w, h)) dirs.push('S');
	}

	return dirs;
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
	// Collect all valid exit positions
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

	// Place head
	grid[ey][ex] = 'occupied';
	const path: GridPos[] = [{ x: ex, y: ey }];

	// Grow body inward (opposite of exit direction)
	let { x: stepX, y: stepY } = INWARD[exitDir];
	let curX = ex, curY = ey;

	// bodyLength = Random.Range(minLen - 1, maxLen - 1) exclusive upper → minLen-1 to maxLen-2 inclusive
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
				// Change direction: pick a non-preferred neighbor
				const others = neighbors.filter(p => !(p.x === preferred.x && p.y === preferred.y));
				next = others[Math.floor(Math.random() * others.length)];
			} else {
				next = preferred;
			}
		} else {
			// Preferred unavailable — pick randomly from available
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

	while (!allOccupied(grid, width, height) && consecutiveFails < 200) {
		const arrow = generateArrow(grid, id, width, height, minLength, maxLength, changeDirChance);
		if (arrow) {
			arrows.push(arrow);
			id++;
			consecutiveFails = 0;
		} else {
			consecutiveFails++;
		}
	}

	return { width, height, arrows };
}
