<script lang="ts">
	import { generateLevel } from '$lib/utils/puzzleGenerator';
	import type { Direction, GridPos, Arrow } from '$lib/types';

	// ─── difficulty config ───────────────────────────────────────────────────────

	// cells: target cell count for adaptive grids; square: always use equal W/H
	const DIFFICULTIES = [
		{ label: 'Easy',       cells:   36, square: true,  color: 'from-emerald-500 to-emerald-600', ring: 'ring-emerald-400', chartColor: '#10b981' },
		{ label: 'Normal',     cells:   81, square: true,  color: 'from-sky-500 to-sky-600',         ring: 'ring-sky-400',     chartColor: '#0ea5e9' },
		{ label: 'Hard',       cells:  256, square: false, color: 'from-violet-500 to-violet-600',   ring: 'ring-violet-400',  chartColor: '#8b5cf6' },
		{ label: 'Super Hard', cells: 1024, square: false, color: 'from-orange-500 to-orange-600',   ring: 'ring-orange-400',  chartColor: '#f97316' },
		{ label: 'Expert',     cells: 4096, square: false, color: 'from-rose-600 to-rose-700',       ring: 'ring-rose-400',    chartColor: '#e11d48' },
	];

	// Compute W × H for a difficulty, fitting the current viewport aspect ratio.
	function computeGridSize(cells: number, square: boolean): { w: number; h: number } {
		const s = Math.round(Math.sqrt(cells));
		if (square || typeof window === 'undefined') return { w: s, h: s };
		// Available play area (rough estimate: 80px for button row + padding)
		const ratio = Math.max(0.4, Math.min(2.5, window.innerWidth / (window.innerHeight - 80)));
		const w = Math.max(4, Math.round(Math.sqrt(cells * ratio)));
		const h = Math.max(4, Math.round(Math.sqrt(cells / ratio)));
		return { w, h };
	}

	function gridCaption(cells: number, square: boolean): string {
		const { w, h } = computeGridSize(cells, square);
		return `${w} × ${h} grid`;
	}

	// ─── local-storage helpers ──────────────────────────────────────────────────

	const STORAGE_KEY  = 'arrow-out-progress';
	const PUZZLE_KEY   = 'arrow-out-puzzle';

	// Returns {} on server (SSR) or on parse error.
	function loadProgress(): Record<string, number> {
		if (typeof window === 'undefined') return {};
		try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); }
		catch { return {}; }
	}

	function saveProgress(p: Record<string, number>) {
		if (typeof window === 'undefined') return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
	}

	// Persist the current puzzle so "Try Again" can restore the exact same layout.
	function savePuzzle(lvl: typeof level) {
		if (typeof window === 'undefined') return;
		try { localStorage.setItem(PUZZLE_KEY, JSON.stringify(lvl)); } catch {}
	}

	function loadPuzzle(): typeof level | null {
		if (typeof window === 'undefined') return null;
		try {
			const raw = localStorage.getItem(PUZZLE_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch { return null; }
	}

	// Initialise from storage immediately on the client (guard keeps SSR safe).
	let progress = $state<Record<string, number>>(loadProgress());

	// ─── game state ──────────────────────────────────────────────────────────────

	let gameState = $state<'menu' | 'playing' | 'stats'>('menu');
	let W = $state(9);
	let H = $state(9);

	// Timing constants
	const MS_PER_STEP = 90;
	const NUDGE_FWD  = 140; // ms to nudge toward blocker
	const NUDGE_BACK = 140; // ms to spring back
	const FLASH_HALF = 90;  // ms per flash half (×4 = total flash duration)

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

	const MAX_LIVES = 3;

	let level             = $state(generateLevel(9, 9));
	let removed           = $state(new Set<number>());
	let anims             = $state<Record<number, Anim>>({});
	let now               = $state(performance.now());
	let lives             = $state(MAX_LIVES);
	let currentDifficulty = $state<string | null>(null); // label of the active difficulty
	let winCounted        = false; // plain bool — not reactive; reset on new game
	let rafId: number | null = null;

	// ─── pan / zoom ──────────────────────────────────────────────────────────────

	const MIN_SCALE = 1;
	const MAX_SCALE = 8;

	let scale = $state(1);
	let panX  = $state(0);
	let panY  = $state(0);

	// Non-reactive gesture tracking (mutated freely, never drives rendering directly)
	let _node: HTMLElement | null = null;
	let _activeT = new Map<number, { x: number; y: number }>();
	let _panX0 = 0, _panY0 = 0, _t0 = { x: 0, y: 0 }, _didMove = false;
	let _pinchD0 = 0, _pinchS0 = 1, _pinchPX0 = 0, _pinchPY0 = 0;
	let _pinchMid = { x: 0, y: 0 };

	function clampPan(px: number, py: number, s: number) {
		if (!_node) return { x: px, y: py };
		const { width: w, height: h } = _node.getBoundingClientRect();
		return {
			x: s <= 1 ? 0 : Math.min(0, Math.max(w * (1 - s), px)),
			y: s <= 1 ? 0 : Math.min(0, Math.max(h * (1 - s), py)),
		};
	}

	function resetView() { scale = 1; panX = 0; panY = 0; }

	function onTouchStart(e: TouchEvent) {
		for (const t of Array.from(e.changedTouches))
			_activeT.set(t.identifier, { x: t.clientX, y: t.clientY });

		if (_activeT.size === 1) {
			const [t] = _activeT.values();
			_t0 = { ...t }; _panX0 = panX; _panY0 = panY; _didMove = false;
		} else if (_activeT.size === 2) {
			const [a, b] = _activeT.values();
			const rect = _node!.getBoundingClientRect();
			_pinchD0  = Math.hypot(b.x - a.x, b.y - a.y);
			_pinchS0  = scale; _pinchPX0 = panX; _pinchPY0 = panY;
			_pinchMid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
		}
	}

	function onTouchMove(e: TouchEvent) {
		e.preventDefault(); // must be non-passive to work; see panZoomAction
		for (const t of Array.from(e.changedTouches))
			_activeT.set(t.identifier, { x: t.clientX, y: t.clientY });

		if (_activeT.size === 1) {
			const [t] = _activeT.values();
			const dx = t.x - _t0.x, dy = t.y - _t0.y;
			if (Math.hypot(dx, dy) > 4) _didMove = true;
			if (_didMove) {
				const c = clampPan(_panX0 + dx, _panY0 + dy, scale);
				panX = c.x; panY = c.y;
			}
		} else if (_activeT.size >= 2) {
			const [a, b] = _activeT.values();
			const d = Math.hypot(b.x - a.x, b.y - a.y);
			const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, _pinchS0 * d / _pinchD0));
			const r = s / _pinchS0;
			const c = clampPan(
				_pinchMid.x - (_pinchMid.x - _pinchPX0) * r,
				_pinchMid.y - (_pinchMid.y - _pinchPY0) * r,
				s
			);
			scale = s; panX = c.x; panY = c.y;
		}
	}

	function onTouchEnd(e: TouchEvent) {
		for (const t of Array.from(e.changedTouches))
			_activeT.delete(t.identifier);

		if (_activeT.size === 1) {
			// Dropped to 1 finger — reset single-touch pan baseline
			const [t] = _activeT.values();
			_t0 = { ...t }; _panX0 = panX; _panY0 = panY; _didMove = false;
		}
		// Snap back to unzoomed if barely zoomed
		if (_activeT.size === 0 && scale < 1.05) resetView();
	}

	// All pointer listeners go through the action so passive flags are explicit.
	// touchmove must be non-passive to allow preventDefault() which stops the
	// browser from claiming the gesture as a scroll before we can pan.
	function panZoomAction(node: HTMLElement) {
		_node = node;

		function onWheel(e: WheelEvent) {
			e.preventDefault();
			const rect = node.getBoundingClientRect();
			const mx = e.clientX - rect.left, my = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
			const r = s / scale;
			const c = clampPan(mx - (mx - panX) * r, my - (my - panY) * r, s);
			scale = s; panX = c.x; panY = c.y;
		}

		node.addEventListener('touchstart',  onTouchStart, { passive: true  });
		node.addEventListener('touchmove',   onTouchMove,  { passive: false }); // ← non-passive
		node.addEventListener('touchend',    onTouchEnd,   { passive: true  });
		node.addEventListener('touchcancel', onTouchEnd,   { passive: true  });
		node.addEventListener('wheel',       onWheel,      { passive: false });

		return {
			destroy() {
				node.removeEventListener('touchstart',  onTouchStart);
				node.removeEventListener('touchmove',   onTouchMove);
				node.removeEventListener('touchend',    onTouchEnd);
				node.removeEventListener('touchcancel', onTouchEnd);
				node.removeEventListener('wheel',       onWheel);
				_node = null;
			}
		};
	}

	// ─── rounded snake path ──────────────────────────────────────────────────────

	// Converts animated segment positions into an SVG path string.
	// Straight runs use L; turns use a quadratic bézier (Q) so corners are smooth.
	function roundedPath(pts: { x: number; y: number }[], r: number): string {
		if (pts.length === 0) return '';
		const cx = (p: { x: number; y: number }) => p.x + 0.5;
		const cy = (p: { x: number; y: number }) => p.y + 0.5;
		if (pts.length === 1) return `M ${cx(pts[0])} ${cy(pts[0])}`;
		if (pts.length === 2) return `M ${cx(pts[0])} ${cy(pts[0])} L ${cx(pts[1])} ${cy(pts[1])}`;

		let d = `M ${cx(pts[0])} ${cy(pts[0])}`;

		for (let i = 1; i < pts.length - 1; i++) {
			const ax = cx(pts[i - 1]), ay = cy(pts[i - 1]);
			const bx = cx(pts[i    ]), by = cy(pts[i    ]);
			const ex = cx(pts[i + 1]), ey = cy(pts[i + 1]);

			const dx1 = bx - ax, dy1 = by - ay;
			const dx2 = ex - bx, dy2 = ey - by;
			const len1 = Math.hypot(dx1, dy1) || 1;
			const len2 = Math.hypot(dx2, dy2) || 1;

			// Cross product detects a direction change (turn vs straight)
			if (Math.abs(dx1 * dy2 - dy1 * dx2) < 0.001 * len1 * len2) {
				d += ` L ${bx} ${by}`; // straight — pass through
			} else {
				const r1 = Math.min(r, len1 / 2);
				const r2 = Math.min(r, len2 / 2);
				const p1x = bx - (dx1 / len1) * r1, p1y = by - (dy1 / len1) * r1;
				const p2x = bx + (dx2 / len2) * r2, p2y = by + (dy2 / len2) * r2;
				d += ` L ${p1x} ${p1y} Q ${bx} ${by} ${p2x} ${p2y}`;
			}
		}

		d += ` L ${cx(pts[pts.length - 1])} ${cy(pts[pts.length - 1])}`;
		return d;
	}

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
		if (_didMove) return; // swallow taps that ended a pan gesture
		if (won || lives <= 0) return; // game already decided
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
				lives = Math.max(0, lives - 1); // life lost when the red-flash penalty fires
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

	function startGame(cells: number, square: boolean) {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		const { w, h } = computeGridSize(cells, square);
		W = w; H = h;
		removed           = new Set();
		anims             = {};
		lives             = MAX_LIVES;
		menuOpen          = false;
		winCounted        = false;
		currentDifficulty = DIFFICULTIES.find(d => d.cells === cells && d.square === square)?.label ?? null;
		level             = generateLevel(w, h);
		savePuzzle(level);
		resetView();
		gameState = 'playing';
	}

	// reuse=true  → restore the saved puzzle (Try Again after game-over)
	// reuse=false → generate a fresh puzzle and save it (Regenerate)
	function reset(reuse = false) {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed    = new Set();
		anims      = {};
		lives      = MAX_LIVES;
		winCounted = false;
		if (reuse) {
			level = loadPuzzle() ?? generateLevel(W, H);
		} else {
			level = generateLevel(W, H);
			savePuzzle(level);
		}
		resetView();
	}

	function goToMenu() {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed  = new Set();
		anims    = {};
		menuOpen = false;
		resetView();
		gameState = 'menu';
	}

	function goToStats() { gameState = 'stats'; }

	// ─── chart data ──────────────────────────────────────────────────────────────

	// Pre-compute donut segments from win counts.
	// Each segment has: startAngle (deg, 0 = top), dash (px along circumference).
	const DONUT_R = 65;
	const DONUT_C = 2 * Math.PI * DONUT_R;
	const DONUT_GAP = 2; // px gap cut from each segment's leading edge

	const chartSegments = $derived(
		(() => {
			const total = DIFFICULTIES.reduce((s, d) => s + (progress[d.label] ?? 0), 0);
			let cumFrac = 0;
			return DIFFICULTIES.map(d => {
				const count  = progress[d.label] ?? 0;
				const frac   = total > 0 ? count / total : 0;
				const angle  = cumFrac * 360 - 90; // -90° → start segment at 12 o'clock
				const dash   = Math.max(0, frac * DONUT_C - DONUT_GAP);
				cumFrac += frac;
				return { ...d, count, frac, total, angle, dash };
			});
		})()
	);

	const totalWins = $derived(DIFFICULTIES.reduce((s, d) => s + (progress[d.label] ?? 0), 0));

	let showGrid  = $state(true);
	let menuOpen  = $state(false);

	// Pre-compute SVG path strings and head positions for every arrow at s=0.
	// These are used by the static (non-animating) render branch so idle arrows
	// never re-render during RAF ticks — only arrows with an active anim do.
	const staticArrowData = $derived(
		Object.fromEntries(level.arrows.map(arrow => [
			arrow.id,
			{ d: roundedPath(arrow.path, 0.4), head: arrow.path[0] },
		]))
	);

	const won  = $derived(level.arrows.length > 0 && level.arrows.every(a => removed.has(a.id)));
	const lost = $derived(lives <= 0 && !won);

	// Record a completion when the player clears the board.
	// winCounted is a plain bool (not reactive) so this fires exactly once per game.
	$effect(() => {
		if (won && !winCounted && currentDifficulty !== null) {
			winCounted = true;
			const next = { ...progress, [currentDifficulty]: (progress[currentDifficulty] ?? 0) + 1 };
			progress = next;
			saveProgress(next);
		}
	});
</script>

{#if gameState === 'menu'}
	<!-- ─── Start screen ─────────────────────────────────────────────────────── -->
	<main class="w-full h-dvh bg-slate-900 flex flex-col items-center justify-center gap-6 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
		<div class="text-center">
			<h1 class="text-5xl font-extrabold text-white tracking-tight mb-2">Arrow Out</h1>
			<p class="text-slate-400 text-lg">Click a snake to send it sliding — clear the board to win.</p>
		</div>

		<div class="flex flex-col gap-4 w-full max-w-xs">
			{#each DIFFICULTIES as d}
				{@const count = progress[d.label] ?? 0}
				<button
					onclick={() => startGame(d.cells, d.square)}
					class="group relative flex items-center py-4 px-5 rounded-2xl bg-gradient-to-br {d.color}
					       shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-transform duration-150
					       ring-2 ring-transparent hover:{d.ring} focus-visible:{d.ring} focus-visible:outline-none"
				>
					<!-- Label + grid size -->
					<div class="flex flex-col items-start flex-1 min-w-0">
						<span class="text-white font-bold text-xl tracking-wide">{d.label}</span>
						<span class="text-white/70 text-sm">{gridCaption(d.cells, d.square)}</span>
					</div>
					<!-- Completion count badge -->
					<div class="flex flex-col items-center justify-center ml-3 shrink-0 min-w-[3rem]">
						{#if count > 0}
							<span class="text-2xl font-extrabold text-white leading-none">{count}</span>
							<span class="text-white/60 text-[10px] uppercase tracking-widest mt-0.5">
								{count === 1 ? 'win' : 'wins'}
							</span>
						{:else}
							<span class="text-white/30 text-xs">—</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>

		<button
			onclick={goToStats}
			class="text-slate-500 hover:text-slate-300 text-sm transition-colors mt-2 flex items-center gap-1.5"
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
				<rect x="1" y="7" width="3" height="6" rx="0.5"/>
				<rect x="5.5" y="4" width="3" height="9" rx="0.5"/>
				<rect x="10" y="1" width="3" height="12" rx="0.5"/>
			</svg>
			Stats
		</button>
	</main>

{:else if gameState === 'stats'}
	<!-- Stats screen -->
	<main class="w-full h-dvh bg-slate-900 flex flex-col overflow-hidden">

		<!-- Top bar -->
		<div class="h-12 shrink-0 flex items-center px-4 border-b border-slate-800/80 bg-slate-900/95 backdrop-blur-sm">
			<button
				onclick={goToMenu}
				class="px-3 py-1.5 text-sm font-medium rounded-lg bg-slate-800 text-slate-400 border border-slate-700/60
				       hover:bg-slate-700 hover:text-slate-200 transition-colors"
			>← Back</button>
			<span class="flex-1 text-center text-white font-bold tracking-wide">Stats</span>
			<div class="w-[4.5rem]"></div>
		</div>

		<!-- Scrollable content -->
		<div class="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-8 px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">

			<!-- Donut chart -->
			<svg viewBox="0 0 200 200" width="220" height="220" style="overflow:visible">
				<!-- Background ring -->
				<circle cx="100" cy="100" r={DONUT_R} fill="none" stroke="rgba(51,65,85,0.5)" stroke-width="28" />

				{#if totalWins > 0}
					{#each chartSegments as seg}
						{#if seg.frac > 0}
							<circle
								cx="100" cy="100" r={DONUT_R}
								fill="none"
								stroke={seg.chartColor}
								stroke-width="28"
								stroke-dasharray="{seg.dash} {DONUT_C}"
								transform="rotate({seg.angle}, 100, 100)"
								stroke-linecap="butt"
							/>
						{/if}
					{/each}
				{/if}

				<!-- Centre label -->
				{#if totalWins === 0}
					<text x="100" y="100" text-anchor="middle" dominant-baseline="middle"
						font-size="13" fill="rgb(100,116,139)">No wins yet</text>
				{:else}
					<text x="100" y="90" text-anchor="middle" dominant-baseline="middle"
						font-size="36" font-weight="800" fill="white">{totalWins}</text>
					<text x="100" y="116" text-anchor="middle" dominant-baseline="middle"
						font-size="12" fill="rgb(100,116,139)" letter-spacing="1">
						{totalWins === 1 ? 'TOTAL WIN' : 'TOTAL WINS'}
					</text>
				{/if}
			</svg>

			<!-- Breakdown legend -->
			<div class="w-full max-w-xs flex flex-col divide-y divide-slate-800/60">
				{#each chartSegments as seg}
					<div class="flex items-center gap-3 py-3">
						<div class="w-3 h-3 rounded-full shrink-0" style="background:{seg.chartColor}"></div>
						<span class="text-slate-300 flex-1 text-sm font-medium">{seg.label}</span>
						<span class="text-white font-bold tabular-nums w-8 text-right">{seg.count}</span>
						<span class="text-slate-500 text-sm tabular-nums w-10 text-right">
							{seg.total > 0 ? Math.round(seg.frac * 100) : 0}%
						</span>
					</div>
				{/each}
			</div>
		</div>
	</main>

{:else}
	<!-- ─── Game screen ──────────────────────────────────────────────────────── -->
	<main class="w-full h-dvh bg-slate-900 flex flex-col overflow-hidden">

		<!-- ── Top bar ──────────────────────────────────────────────────────────── -->
		<!-- h-12 = 3rem fixed; shrink-0 prevents flex from squishing it -->
		<div class="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-slate-800/80 bg-slate-900/95 backdrop-blur-sm">

			<!-- Mobile: hamburger button -->
			<button
				class="sm:hidden flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800 text-slate-400
				       hover:bg-slate-700 hover:text-white transition-colors active:scale-95"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
			>
				{#if menuOpen}
					<!-- × close icon -->
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
						<line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
					</svg>
				{:else}
					<!-- ☰ hamburger icon -->
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<line x1="2" y1="4.5" x2="14" y2="4.5"/>
						<line x1="2" y1="8"   x2="14" y2="8"/>
						<line x1="2" y1="11.5" x2="14" y2="11.5"/>
					</svg>
				{/if}
			</button>

			<!-- Desktop: inline controls -->
			<div class="hidden sm:flex items-center gap-2">
				<button
					onclick={goToMenu}
					class="px-3 py-1.5 text-sm font-medium rounded-lg bg-slate-800 text-slate-400 border border-slate-700/60
					       hover:bg-slate-700 hover:text-slate-200 transition-colors"
				>← Menu</button>
				<button
					onclick={() => reset(lost)}
					class="px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors
					       {lost
					           ? 'bg-red-600 text-white border-red-500 hover:bg-red-500'
					           : 'bg-slate-800 text-slate-300 border-slate-700/60 hover:bg-slate-700'}"
				>{lost ? '↺ Try Again' : 'Regenerate'}</button>
				<label class="flex items-center gap-1.5 cursor-pointer select-none text-slate-400 text-sm">
					<input type="checkbox" bind:checked={showGrid} class="w-3.5 h-3.5 rounded accent-slate-400 cursor-pointer" />
					Grid
				</label>
			</div>

			<!-- Spacer -->
			<div class="flex-1"></div>

			<!-- Hearts — always visible on every screen size -->
			<div class="flex items-center gap-1.5 pr-1">
				{#each Array(MAX_LIVES) as _, i}
					<span
						class="text-xl leading-none select-none transition-all duration-300
						       {i < lives ? 'text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]' : 'text-slate-700'}"
					>♥</span>
				{/each}
			</div>
		</div>

		<!-- Mobile dropdown menu (slides in below top bar) -->
		{#if menuOpen}
			<div class="sm:hidden shrink-0 flex flex-col gap-2 p-3 bg-slate-800/98 border-b border-slate-700/60">
				<div class="flex gap-2">
					<button
						onclick={() => { goToMenu(); }}
						class="flex-1 py-2.5 text-sm font-medium rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
					>← Menu</button>
					<button
						onclick={() => { reset(lost); menuOpen = false; }}
						class="flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors
						       {lost
						           ? 'bg-red-600 text-white hover:bg-red-500'
						           : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}"
					>{lost ? '↺ Try Again' : 'Regenerate'}</button>
				</div>
				<label class="flex items-center gap-2 cursor-pointer select-none text-slate-400 text-sm px-1">
					<input type="checkbox" bind:checked={showGrid} class="w-4 h-4 rounded accent-slate-400 cursor-pointer" />
					Show Grid
				</label>
			</div>
		{/if}

		<!-- ── Board area — fills all remaining vertical space ──────────────────── -->
		<!--
			flex-1 min-h-0  → takes leftover height; min-h-0 prevents flex overflow
			Board width: min(viewport width − padding, remaining height × aspect ratio)
			  3rem  = top bar (h-12)
			  1.5rem = padding (p-3 on each side)
		-->
		<div class="flex-1 min-h-0 flex items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
			<div
				style="width: min(calc(100vw - 1.5rem), calc((100dvh - 4.5rem) * {W / H})); aspect-ratio: {W} / {H};"
				class="relative overflow-hidden rounded-xl touch-none"
				use:panZoomAction
			>
				<svg
					viewBox="-0.1 -0.1 {W + 0.2} {H + 0.2}"
					style="width:100%;height:100%;transform:translate({panX}px,{panY}px) scale({scale});transform-origin:0 0;"
					overflow="hidden"
				>
					<!-- Grid background: single SVG pattern — no per-cell rects needed.
					     Rect covers exactly the grid area (0 0 W H) so the -0.1 viewBox
					     border doesn't show partial tile slivers at the edges. -->
					<defs>
						<pattern id="cell-bg" x="0" y="0" width="1" height="1" patternUnits="userSpaceOnUse">
							<rect x="0.06" y="0.06" width="0.88" height="0.88" rx="0.18" fill="rgba(51,65,85,0.6)" />
						</pattern>
					</defs>
					{#if showGrid}
						<rect x="0" y="0" width={W} height={H} fill="url(#cell-bg)" />
					{/if}

					<!-- Arrows: split static vs animating so RAF ticks only re-render
					     the 1–2 arrows that are actively sliding. -->
					{#each level.arrows as arrow (arrow.id)}
						{#if !removed.has(arrow.id)}
							{#if anims[arrow.id]}
								<!-- Animating branch: recomputes every frame -->
								{@const anim = anims[arrow.id]}
								{@const d    = DELTA[arrow.direction]}
								{@const el   = Math.max(0, now - anim.startTime)}
								{@const s    = computeS(anim, el)}
								{@const pts  = arrow.path.map((_, k) => segPos(arrow.path, k, s, d))}
								{@const head = pts[0]}
								{@const red  = isFlashRed(anim, el)}
								<g style="cursor:default;pointer-events:none">
									<path
										d={roundedPath(pts, 0.4)}
										fill="none"
										stroke={red ? '#ef4444' : arrow.color}
										stroke-width={0.14}
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
							{:else}
								<!-- Static branch: pre-computed paths, zero per-frame cost -->
								{@const sd = staticArrowData[arrow.id]}
								<g onclick={() => handleClick(arrow.id)} style="cursor:pointer">
									{#each arrow.path as seg}
										<rect x={seg.x} y={seg.y} width={1} height={1} fill="transparent" />
									{/each}
									<path
										d={sd.d}
										fill="none"
										stroke={arrow.color}
										stroke-width={0.14}
										stroke-linecap="round"
										stroke-linejoin="round"
										opacity={0.9}
									/>
									<polygon
										points="0.32,0 -0.16,-0.24 -0.16,0.24"
										transform="translate({sd.head.x + 0.5},{sd.head.y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
										fill={arrow.color}
										opacity={0.95}
									/>
								</g>
							{/if}
						{/if}
					{/each}

					<!-- Win overlay (dark scrim + title only — button is HTML below) -->
					{#if won}
						{@const fs = Math.min(1, W * 0.11)}
						<rect x="0" y="0" width={W} height={H} fill="rgba(15,23,42,0.75)" />
						<text x={W/2} y={H/2} text-anchor="middle" dominant-baseline="middle"
							font-size={fs} font-weight="bold" fill="white">Level Complete</text>
					{/if}

					<!-- Game over overlay (dark scrim + title only — buttons are HTML below) -->
					{#if lost}
						{@const fs = Math.min(1, W * 0.11)}
						<rect x="0" y="0" width={W} height={H} fill="rgba(15,23,42,0.82)" />
						<text x={W/2} y={H/2} text-anchor="middle" dominant-baseline="middle"
							font-size={fs} font-weight="bold" fill="#ef4444">Game Over</text>
					{/if}
				</svg>

				<!-- HTML win button — rendered on top of the SVG scrim -->
				{#if won}
					<div class="absolute inset-0 flex flex-col items-center justify-end gap-3 pb-[12%] pointer-events-none">
						<button
							onclick={() => reset(false)}
							class="pointer-events-auto px-8 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95
							       text-white font-bold text-lg shadow-lg shadow-emerald-900/50 transition-all duration-150"
						>New Level</button>
						<button
							onclick={goToMenu}
							class="pointer-events-auto px-6 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 active:scale-95
							       text-slate-300 text-sm font-medium border border-slate-700/60 transition-all duration-150"
						>← Menu</button>
					</div>
				{/if}

				<!-- HTML game-over buttons — rendered on top of the SVG scrim -->
				{#if lost}
					<div class="absolute inset-0 flex flex-col items-center justify-end gap-3 pb-[12%] pointer-events-none">
						<button
							onclick={() => reset(true)}
							class="pointer-events-auto px-8 py-3 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-95
							       text-white font-bold text-lg shadow-lg shadow-red-900/50 transition-all duration-150"
						>↺ Try Again</button>
						<button
							onclick={goToMenu}
							class="pointer-events-auto px-6 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 active:scale-95
							       text-slate-300 text-sm font-medium border border-slate-700/60 transition-all duration-150"
						>← Menu</button>
					</div>
				{/if}
			</div>
		</div>
	</main>
{/if}
