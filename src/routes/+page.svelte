<script lang="ts">
	import { generateLevel } from '$lib/utils/puzzleGenerator';
	import type { Direction, GridPos, Arrow } from '$lib/types';

	const W = 9, H = 9;

	// Timing constants
	const MS_PER_STEP = 90;   // ms per cell for the exiting snake
	const NUDGE_FWD  = 260;   // ms for blocked forward slide
	const NUDGE_BACK = 280;   // ms for blocked return slide
	const FLASH_HALF = 130;   // ms per half-flash (×4 = 2 full red flashes)

	const DIR_ROT: Record<Direction, number> = { E: 0, S: 90, W: 180, N: 270 };

	const DELTA: Record<Direction, { dx: number; dy: number }> = {
		N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
		E: { dx: 1,  dy: 0 }, W: { dx: -1, dy: 0 },
	};

	type Phase = 'exiting' | 'blocked-fwd' | 'blocked-back' | 'blocked-flash';

	interface Anim {
		phase: Phase;
		startTime: number;
		totalSteps?: number;  // exiting
		nudgeDist?: number;   // blocked phases
	}

	let level     = $state(generateLevel(W, H));
	let removed   = $state(new Set<number>());
	let anims     = $state<Record<number, Anim>>({});
	let now       = $state(performance.now());
	let rafId: number | null = null;

	// ─── easing ─────────────────────────────────────────────────────────────────

	function easeOut(t: number) { return 1 - (1 - t) ** 2; }
	function easeIn(t:  number) { return t * t; }

	// ─── snake-flow math ────────────────────────────────────────────────────────

	// Path position at an index that may be before path[0] (i.e., ahead in exit dir)
	function extPos(path: GridPos[], i: number, d: { dx: number; dy: number }) {
		if (i >= 0) return path[i];
		return { x: path[0].x + (-i) * d.dx, y: path[0].y + (-i) * d.dy };
	}

	// Smooth world position of segment k at fractional step s
	function segPos(path: GridPos[], k: number, s: number, d: { dx: number; dy: number }) {
		const lo = Math.floor(s), f = s - lo;
		const a = extPos(path, k - lo,     d);
		const b = extPos(path, k - lo - 1, d);
		return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
	}

	// Total animation steps until every segment is off-grid
	function totalExitSteps(arrow: Arrow): number {
		const h = arrow.path[0];
		const edge =
			arrow.direction === 'W' ? h.x + 1 :
			arrow.direction === 'E' ? W - h.x :
			arrow.direction === 'N' ? h.y + 1 : H - h.y;
		return arrow.path.length + edge;
	}

	// ─── blocked translation ─────────────────────────────────────────────────────

	function nudgeOffset(anim: Anim, d: { dx: number; dy: number }, elapsed: number) {
		if (anim.phase === 'blocked-fwd') {
			const r = easeOut(Math.min(elapsed / NUDGE_FWD, 1)) * (anim.nudgeDist ?? 0);
			return { x: r * d.dx, y: r * d.dy };
		}
		if (anim.phase === 'blocked-back') {
			const r = (1 - easeIn(Math.min(elapsed / NUDGE_BACK, 1))) * (anim.nudgeDist ?? 0);
			return { x: r * d.dx, y: r * d.dy };
		}
		return { x: 0, y: 0 };
	}

	function isFlashRed(anim: Anim, elapsed: number) {
		return anim.phase === 'blocked-flash' && Math.floor(elapsed / FLASH_HALF) % 2 === 0;
	}

	// ─── blocking check ──────────────────────────────────────────────────────────

	function checkBlocked(arrow: Arrow): { blocked: boolean; dist: number } {
		const d = DELTA[arrow.direction];
		const walls = new Set<string>();
		for (const a of level.arrows) {
			if (a.id === arrow.id || removed.has(a.id)) continue;
			if (anims[a.id]?.phase === 'exiting') continue; // mid-exit = already gone
			for (const p of a.path) walls.add(`${p.x},${p.y}`);
		}
		let { x, y } = arrow.path[0];
		x += d.dx; y += d.dy;
		let dist = 0;
		while (x >= 0 && x < W && y >= 0 && y < H) {
			if (walls.has(`${x},${y}`)) return { blocked: true, dist };
			dist++; x += d.dx; y += d.dy;
		}
		return { blocked: false, dist };
	}

	// ─── click handler ───────────────────────────────────────────────────────────

	function handleClick(id: number) {
		if (anims[id] || removed.has(id)) return;
		const arrow = level.arrows.find(a => a.id === id);
		if (!arrow) return;

		const { blocked, dist } = checkBlocked(arrow);
		const t = performance.now();

		if (!blocked) {
			anims = { ...anims, [id]: { phase: 'exiting', startTime: t, totalSteps: totalExitSteps(arrow) } };
		} else {
			anims = { ...anims, [id]: { phase: 'blocked-fwd', startTime: t, nudgeDist: dist + 0.5 } };
		}

		if (rafId === null) rafId = requestAnimationFrame(loop);
	}

	// ─── animation loop ──────────────────────────────────────────────────────────

	function loop(t: number) {
		now = t;

		let next       = { ...anims };
		let nextRem    = new Set(removed);
		let dirty      = false;

		for (const [sid, anim] of Object.entries(next)) {
			const id = +sid;
			const el = t - anim.startTime;

			if (anim.phase === 'exiting' && el / MS_PER_STEP >= anim.totalSteps!) {
				delete next[id]; nextRem.add(id); dirty = true;

			} else if (anim.phase === 'blocked-fwd' && el >= NUDGE_FWD) {
				next[id] = { phase: 'blocked-back', startTime: t, nudgeDist: anim.nudgeDist };
				dirty = true;

			} else if (anim.phase === 'blocked-back' && el >= NUDGE_BACK) {
				next[id] = { phase: 'blocked-flash', startTime: t };
				dirty = true;

			} else if (anim.phase === 'blocked-flash' && el >= FLASH_HALF * 4) {
				delete next[id]; dirty = true;
			}
		}

		if (dirty) { anims = next; removed = nextRem; }

		if (Object.keys(next).length > 0) rafId = requestAnimationFrame(loop);
		else rafId = null;
	}

	// ─── reset ───────────────────────────────────────────────────────────────────

	function reset() {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed = new Set();
		anims   = {};
		level   = generateLevel(W, H);
	}

	const won = $derived(level.arrows.length > 0 && level.arrows.every(a => removed.has(a.id)));
</script>

<main class="w-full min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-6 p-4">
	<div class="relative bg-slate-800 p-4 rounded-2xl shadow-2xl border border-slate-700/50">
		<!-- overflow-hidden clips the snakes as they slide off the grid -->
		<div class="w-[80vw] h-[80vw] max-w-[540px] max-h-[540px] overflow-hidden rounded-xl">
			<svg
				viewBox="-0.1 -0.1 {W + 0.2} {H + 0.2}"
				class="w-full h-full"
				overflow="hidden"
			>
				<!-- empty cell backgrounds -->
				{#each Array(H) as _, row}
					{#each Array(W) as _, col}
						<rect
							x={col + 0.06} y={row + 0.06}
							width={0.88} height={0.88} rx={0.18}
							class="fill-slate-700/60"
						/>
					{/each}
				{/each}

				<!-- arrows -->
				{#each level.arrows as arrow (arrow.id)}
					{#if !removed.has(arrow.id)}
						{@const anim = anims[arrow.id]}
						{@const d    = DELTA[arrow.direction]}
						{@const el   = anim ? now - anim.startTime : 0}

						{#if !anim || anim.phase === 'exiting'}
							<!-- snake-flow animation (or static when idle) -->
							{@const s    = anim ? Math.min(el / MS_PER_STEP, anim.totalSteps!) : 0}
							{@const pts  = arrow.path.map((_, k) => segPos(arrow.path, k, s, d))}
							{@const head = pts[0]}
							<g
								onclick={() => handleClick(arrow.id)}
								style={anim ? 'cursor:default;pointer-events:none' : 'cursor:pointer'}
							>
								<polyline
									points={pts.map(p => `${p.x + 0.5},${p.y + 0.5}`).join(' ')}
									fill="none"
									stroke={arrow.color}
									stroke-width={0.72}
									stroke-linecap="round"
									stroke-linejoin="round"
									opacity={0.82}
								/>
								<polygon
									points="0.24,0 -0.1,-0.15 -0.1,0.15"
									transform="translate({head.x + 0.5},{head.y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
									fill="white"
									opacity={0.9}
								/>
							</g>

						{:else}
							<!-- rigid nudge animation for blocked arrows -->
							{@const tx  = nudgeOffset(anim, d, el)}
							{@const red = isFlashRed(anim, el)}
							<g
								transform="translate({tx.x},{tx.y})"
								onclick={() => handleClick(arrow.id)}
								style="cursor:default;pointer-events:none"
							>
								<polyline
									points={arrow.path.map(p => `${p.x + 0.5},${p.y + 0.5}`).join(' ')}
									fill="none"
									stroke={red ? '#ef4444' : arrow.color}
									stroke-width={0.72}
									stroke-linecap="round"
									stroke-linejoin="round"
									opacity={0.82}
								/>
								<polygon
									points="0.24,0 -0.1,-0.15 -0.1,0.15"
									transform="translate({arrow.path[0].x + 0.5},{arrow.path[0].y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
									fill="white"
									opacity={0.9}
								/>
							</g>
						{/if}
					{/if}
				{/each}

				<!-- win overlay -->
				{#if won}
					<rect x="-0.1" y="-0.1" width={W + 0.2} height={H + 0.2} fill="rgba(15,23,42,0.75)" />
					<text
						x={W / 2} y={H / 2 - 0.5}
						text-anchor="middle" dominant-baseline="middle"
						font-size={1} font-weight="bold" fill="white" letter-spacing="0.05"
					>
						Level Complete
					</text>
					<text
						x={W / 2} y={H / 2 + 0.7}
						text-anchor="middle" dominant-baseline="middle"
						font-size={0.55} fill="rgb(148,163,184)"
					>
						tap regenerate to play again
					</text>
				{/if}
			</svg>
		</div>
	</div>

	<button
		onclick={reset}
		class="px-5 py-2 bg-slate-800 text-slate-300 font-medium rounded-lg border border-slate-700/60 hover:bg-slate-700 transition-colors"
	>
		Regenerate
	</button>
</main>
