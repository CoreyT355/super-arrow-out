<script lang="ts">
	import { generateLevel } from '$lib/utils/puzzleGenerator';
	import type { Direction, GridPos, Arrow } from '$lib/types';

	// ─── difficulty config ───────────────────────────────────────────────────────

	const DIFFICULTIES = [
		{ label: 'Easy',       w:  6, h:  6, caption: '6 × 6 grid',   color: 'from-emerald-500 to-emerald-600',  ring: 'ring-emerald-400' },
		{ label: 'Normal',     w:  9, h:  9, caption: '9 × 9 grid',   color: 'from-sky-500 to-sky-600',          ring: 'ring-sky-400'     },
		{ label: 'Hard',       w: 16, h: 16, caption: '16 × 16 grid', color: 'from-violet-500 to-violet-600',    ring: 'ring-violet-400'  },
		{ label: 'Super Hard', w: 32, h: 32, caption: '32 × 32 grid', color: 'from-orange-500 to-orange-600',   ring: 'ring-orange-400'  },
		{ label: 'Expert',     w: 64, h: 64, caption: '64 × 64 grid', color: 'from-rose-600 to-rose-700',       ring: 'ring-rose-400'    },
	] as const;

	// ─── state ───────────────────────────────────────────────────────────────────

	let gameState = $state<'menu' | 'playing'>('menu');
	let W = $state(9);
	let H = $state(9);

	// Timing constants
	const MS_PER_STEP = 90;
	const NUDGE_FWD  = 260;
	const NUDGE_BACK = 280;
	const FLASH_HALF = 130;

	const DIR_ROT: Record<Direction, number> = { E: 0, S: 90, W: 180, N: 270 };

	const DELTA: Record<Direction, { dx: number; dy: number }> = {
		N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
		E: { dx: 1,  dy: 0 }, W: { dx: -1, dy: 0 },
	};

	type Phase = 'exiting' | 'blocked-fwd' | 'blocked-back' | 'blocked-flash';

	interface Anim {
		phase: Phase;
		startTime: number;
		totalSteps?: number;
		maxSteps?: number;
	}

	let level     = $state(generateLevel(9, 9));
	let removed   = $state(new Set<number>());
	let anims     = $state<Record<number, Anim>>({});
	let now       = $state(performance.now());
	let rafId: number | null = null;

	// ─── easing ─────────────────────────────────────────────────────────────────

	function easeOut(t: number) { return 1 - (1 - t) ** 2; }
	function easeIn(t:  number) { return t * t; }

	// ─── snake-flow math ─────────────────────────────────────────────────────────

	function extPos(path: GridPos[], i: number, d: { dx: number; dy: number }) {
		if (i >= 0) return path[i];
		return { x: path[0].x + (-i) * d.dx, y: path[0].y + (-i) * d.dy };
	}

	function segPos(path: GridPos[], k: number, s: number, d: { dx: number; dy: number }) {
		const lo = Math.floor(s), f = s - lo;
		const a = extPos(path, k - lo,     d);
		const b = extPos(path, k - lo - 1, d);
		return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
	}

	function totalExitSteps(arrow: Arrow): number {
		const h = arrow.path[0];
		const edge =
			arrow.direction === 'W' ? h.x + 1 :
			arrow.direction === 'E' ? W - h.x :
			arrow.direction === 'N' ? h.y + 1 : H - h.y;
		return arrow.path.length + edge;
	}

	// ─── step position for all phases ────────────────────────────────────────────

	function computeS(anim: Anim | undefined, elapsed: number): number {
		if (!anim) return 0;
		if (anim.phase === 'exiting')
			return Math.min(elapsed / MS_PER_STEP, anim.totalSteps!);
		if (anim.phase === 'blocked-fwd')
			return easeOut(Math.min(elapsed / NUDGE_FWD, 1)) * (anim.maxSteps ?? 0);
		if (anim.phase === 'blocked-back')
			return (1 - easeIn(Math.min(elapsed / NUDGE_BACK, 1))) * (anim.maxSteps ?? 0);
		return 0;
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
			if (anims[a.id]?.phase === 'exiting') continue;
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
		now = t;

		if (!blocked) {
			anims = { ...anims, [id]: { phase: 'exiting', startTime: t, totalSteps: totalExitSteps(arrow) } };
		} else {
			anims = { ...anims, [id]: { phase: 'blocked-fwd', startTime: t, maxSteps: dist + 0.5 } };
		}

		if (rafId === null) rafId = requestAnimationFrame(loop);
	}

	// ─── animation loop ───────────────────────────────────────────────────────────

	function loop(t: number) {
		now = t;

		let next    = { ...anims };
		let nextRem = new Set(removed);
		let dirty   = false;

		for (const [sid, anim] of Object.entries(next)) {
			const id = +sid;
			const el = t - anim.startTime;

			if (anim.phase === 'exiting' && el / MS_PER_STEP >= anim.totalSteps!) {
				delete next[id]; nextRem.add(id); dirty = true;

			} else if (anim.phase === 'blocked-fwd' && el >= NUDGE_FWD) {
				next[id] = { phase: 'blocked-back', startTime: t, maxSteps: anim.maxSteps };
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

	// ─── game control ────────────────────────────────────────────────────────────

	function startGame(w: number, h: number) {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		W = w; H = h;
		removed = new Set();
		anims   = {};
		level   = generateLevel(w, h);
		gameState = 'playing';
	}

	function reset() {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed = new Set();
		anims   = {};
		level   = generateLevel(W, H);
	}

	function goToMenu() {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed   = new Set();
		anims     = {};
		gameState = 'menu';
	}

	const won = $derived(level.arrows.length > 0 && level.arrows.every(a => removed.has(a.id)));
</script>

{#if gameState === 'menu'}
	<!-- ─── Start screen ─────────────────────────────────────────────────────── -->
	<main class="w-full min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-10 p-6">
		<div class="text-center">
			<h1 class="text-5xl font-extrabold text-white tracking-tight mb-2">Arrow Out</h1>
			<p class="text-slate-400 text-lg">Click a snake to send it sliding — clear the board to win.</p>
		</div>

		<div class="flex flex-col gap-4 w-full max-w-xs">
			{#each DIFFICULTIES as d}
				<button
					onclick={() => startGame(d.w, d.h)}
					class="group relative flex flex-col items-center py-4 px-6 rounded-2xl bg-gradient-to-br {d.color}
					       shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-transform duration-150
					       ring-2 ring-transparent hover:{d.ring} focus-visible:{d.ring} focus-visible:outline-none"
				>
					<span class="text-white font-bold text-xl tracking-wide">{d.label}</span>
					<span class="text-white/70 text-sm mt-0.5">{d.caption}</span>
				</button>
			{/each}
		</div>
	</main>

{:else}
	<!-- ─── Game screen ──────────────────────────────────────────────────────── -->
	<main class="w-full min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-6 p-4">
		<div class="relative bg-slate-800 p-4 rounded-2xl shadow-2xl border border-slate-700/50">
			<div class="w-[min(90vw,90vh)] h-[min(90vw,90vh)] overflow-hidden rounded-xl">
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
							{@const el   = anim ? Math.max(0, now - anim.startTime) : 0}
							{@const s    = computeS(anim, el)}
							{@const pts  = arrow.path.map((_, k) => segPos(arrow.path, k, s, d))}
							{@const head = pts[0]}
							{@const red  = anim ? isFlashRed(anim, el) : false}
							<g
								onclick={() => handleClick(arrow.id)}
								style={anim ? 'cursor:default;pointer-events:none' : 'cursor:pointer'}
							>
								<polyline
									points={pts.map(p => `${p.x + 0.5},${p.y + 0.5}`).join(' ')}
									fill="none"
									stroke={red ? '#ef4444' : arrow.color}
									stroke-width={0.28}
									stroke-linecap="round"
									stroke-linejoin="round"
									opacity={0.9}
								/>
								<polygon
									points="0.32,0 -0.16,-0.24 -0.16,0.24"
									transform="translate({head.x + 0.5},{head.y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
									fill={red ? '#ef4444' : arrow.color}
									opacity={0.95}
								/>
							</g>
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

		<div class="flex gap-3">
			<button
				onclick={goToMenu}
				class="px-5 py-2 bg-slate-800 text-slate-400 font-medium rounded-lg border border-slate-700/60 hover:bg-slate-700 hover:text-slate-200 transition-colors"
			>
				← Menu
			</button>
			<button
				onclick={reset}
				class="px-5 py-2 bg-slate-800 text-slate-300 font-medium rounded-lg border border-slate-700/60 hover:bg-slate-700 transition-colors"
			>
				Regenerate
			</button>
		</div>
	</main>
{/if}
