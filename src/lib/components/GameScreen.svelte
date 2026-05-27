<script lang="ts">
	import { generateLevel } from '$lib/utils/puzzleGenerator';
	import type { Arrow, Level, Anim } from '$lib/types';
	import { fly } from 'svelte/transition';
	import { tick, onMount } from 'svelte';
	import GeneratorWorker from '$lib/workers/puzzleGenerator.worker?worker';

	// ── utilities ────────────────────────────────────────────────────────────────
	import { DELTA, DIR_ROT, segPos, exitCellCount } from '$lib/utils/snakeMath';
	import { roundedPath, SPARKLE_PATH, buildFullRoute, measurePath } from '$lib/utils/svgPath';
	import { computeS, isFlashRed } from '$lib/utils/animTiming';
	import { COLORS_DARK, themeColor } from '$lib/constants/theme';
	import {
		MAX_LIVES, NUDGE_FWD, NUDGE_BACK, FLASH_HALF,
		EXIT_DURATION, EXIT_MIN_DUR,
		VORTEX_DURATION, VORTEX_FADE_MS, VORTEX_SPIN_MS,
	} from '$lib/constants/timing';
	import { computeGridSize, DIFFICULTIES } from '$lib/config/difficulties';

	// ── stores ───────────────────────────────────────────────────────────────────
	import { settings } from '$lib/stores/settings.svelte';
	import { progress, streak, savePuzzle, loadSavedPuzzle } from '$lib/stores/progress.svelte';
	import { session, goToMenu as navGoToMenu, goToStats } from '$lib/stores/session.svelte';

	// ── pan / zoom ───────────────────────────────────────────────────────────────
	import { createPanZoom } from '$lib/actions/panZoom.svelte';
	const pz = createPanZoom();

	// ── game state ───────────────────────────────────────────────────────────────

	let W             = $state(9);
	let H             = $state(9);
	let level         = $state(generateLevel(9, 9));
	let removed       = $state(new Set<number>());
	let markedRed     = $state(new Set<number>());
	let anims         = $state<Record<number, Anim>>({});
	let now           = $state(performance.now());
	let lives         = $state(MAX_LIVES);
	let showLoading   = $state(false);
	let menuOpen      = $state(false);

	let winCounted  = false; // plain bool — not reactive; reset on new game
	let lostCounted = false;
	let rafId: number | null = null;

	// SVG path refs for in-flight drain animations — keyed by arrow id.
	let pathRefs = $state<Record<number, SVGPathElement | null>>({});

	// ── vortex ───────────────────────────────────────────────────────────────────

	interface Particle {
		r0: number; θ0: number; color: string;
		size: number; delay: number; rotation: number; speed: number;
	}
	let vortexAnim      = $state<{ startTime: number } | null>(null);
	let vortexParticles = $state<Particle[]>([]);

	const vortexP    = $derived(vortexAnim ? Math.min(1, (now - vortexAnim.startTime) / VORTEX_DURATION) : 0);
	// If winAnimation is on, stay "not done" from the moment won=true (even before
	// the $effect has had a chance to set vortexAnim), preventing a one-frame flash.
	const vortexDone = $derived(!settings.winAnimation || (vortexAnim !== null && vortexP >= 1));

	// ── derived ──────────────────────────────────────────────────────────────────

	const won  = $derived(level.arrows.length > 0 && level.arrows.every(a => removed.has(a.id)));
	const lost = $derived(lives <= 0 && !won);

	// Pre-compute SVG path strings and head positions for every arrow at s=0.
	// Static (non-animating) arrows never re-render during RAF ticks.
	const staticArrowData = $derived(
		Object.fromEntries(level.arrows.map(arrow => [
			arrow.id,
			{ d: roundedPath(arrow.path, settings.roundedCorners ? 0.4 : 0), head: arrow.path[0] },
		]))
	);

	// ── win / loss effects ───────────────────────────────────────────────────────

	$effect(() => {
		if (won && !winCounted && session.currentDifficulty !== null) {
			winCounted = true;
			progress[session.currentDifficulty] = (progress[session.currentDifficulty] ?? 0) + 1;
			streak.current += 1;
			streak.best     = Math.max(streak.best, streak.current);
		}
	});

	$effect(() => {
		if (lost && !lostCounted) {
			lostCounted     = true;
			streak.current  = 0;
		}
	});

	// Trigger vortex collapse on win (if enabled); clear it when the game resets.
	$effect(() => {
		if (won && !vortexAnim && settings.winAnimation) {
			vortexAnim = { startTime: performance.now() };
			const cx = W / 2, cy = H / 2;
			const count   = Math.min(80, Math.max(24, level.arrows.length * 3));
			const palette = COLORS_DARK; // bright pastels pop on both light and dark backgrounds
			vortexParticles = Array.from({ length: count }, (_, i) => {
				const px = Math.random() * W;
				const py = Math.random() * H;
				const dx = px - cx, dy = py - cy;
				return {
					r0:       Math.hypot(dx, dy),
					θ0:       Math.atan2(dy, dx),
					color:    palette[i % palette.length],
					size:     0.07 + Math.random() * 0.09,
					delay:    Math.random() * 300,
					rotation: Math.random() * 360,
					speed:    0.35 + Math.random() * 0.65,
				};
			});
			if (rafId === null) rafId = requestAnimationFrame(loop);
		}
		if (!won) { vortexAnim = null; vortexParticles = []; }
	});

	// ── blocking check ───────────────────────────────────────────────────────────

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

	// ── click handler ────────────────────────────────────────────────────────────

	function handleClick(id: number) {
		if (pz.didMove()) return; // swallow taps that ended a pan gesture
		if (won || lives <= 0) return;
		if (anims[id] || removed.has(id)) return;
		const arrow = level.arrows.find(a => a.id === id);
		if (!arrow) return;

		const { blocked, dist } = checkBlocked(arrow);
		const t = performance.now();
		now = t;

		if (!blocked) {
			const exitCells = exitCellCount(arrow, W, H);
			const routeD    = buildFullRoute(arrow, W, H, settings.roundedCorners);
			const snakeD    = roundedPath([...arrow.path].reverse(), settings.roundedCorners ? 0.4 : 0);
			const L_total   = measurePath(routeD);
			const L_snake   = measurePath(snakeD);
			const totalTravel = L_snake + exitCells;
			const durationMs  = Math.max(EXIT_MIN_DUR, EXIT_DURATION * Math.min(1, totalTravel / 4));

			anims = { ...anims, [id]: {
				phase: 'exiting', startTime: t,
				routeD, L_total, L_snake, durationMs,
			} };
		} else {
			anims = { ...anims, [id]: { phase: 'blocked-fwd', startTime: t, maxSteps: dist + 0.5 } };
		}

		if (rafId === null) rafId = requestAnimationFrame(loop);
	}

	// ── animation loop ────────────────────────────────────────────────────────────

	function loop(t: number) {
		now = t;

		let next    = { ...anims };
		let nextRem = new Set(removed);
		let dirty   = false;

		for (const [sid, anim] of Object.entries(next)) {
			const id = +sid;
			const el = t - anim.startTime;

			if (anim.phase === 'exiting' && el >= (anim.durationMs ?? 0)) {
				delete next[id]; nextRem.add(id);
				delete pathRefs[id];
				dirty = true;
			} else if (anim.phase === 'blocked-fwd' && el >= NUDGE_FWD) {
				next[id] = { phase: 'blocked-back', startTime: t, maxSteps: anim.maxSteps };
				dirty = true;

			} else if (anim.phase === 'blocked-back' && el >= NUDGE_BACK) {
				next[id] = { phase: 'blocked-flash', startTime: t };
				lives = Math.max(0, lives - 1);
				dirty = true;

			} else if (anim.phase === 'blocked-flash' && el >= FLASH_HALF * 4) {
				delete next[id];
				markedRed = new Set([...markedRed, id]);
				dirty = true;
			}
		}

		if (dirty) { anims = next; removed = nextRem; }

		const vortexRunning = vortexAnim !== null && (t - vortexAnim.startTime) < VORTEX_DURATION;
		if (Object.keys(next).length > 0 || vortexRunning) rafId = requestAnimationFrame(loop);
		else rafId = null;
	}

	// ── game control ─────────────────────────────────────────────────────────────

	function generateInWorker(w: number, h: number): Promise<Level> {
		return new Promise((resolve) => {
			const worker = new GeneratorWorker();
			worker.onmessage = (e: MessageEvent<Level>) => {
				resolve(e.data);
				worker.terminate();
			};
			worker.postMessage({ w, h });
		});
	}

	async function startGame(cells: number, square: boolean) {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		showLoading = true;
		await tick(); // flush DOM so the loading overlay paints before we kick off the worker

		const { w, h } = computeGridSize(cells, square);
		W             = w; H = h;
		removed       = new Set();
		markedRed     = new Set();
		anims         = {};
		lives         = MAX_LIVES;
		menuOpen      = false;
		winCounted    = false;
		lostCounted   = false;
		level         = await generateInWorker(w, h);
		savePuzzle(level);
		pz.reset();
		showLoading = false;
	}

	// reuse=true  → restore the saved puzzle (Try Again after game-over)
	// reuse=false → generate a fresh puzzle and save it (New Level)
	function reset(reuse = false) {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed    = new Set();
		markedRed  = new Set();
		anims      = {};
		lives      = MAX_LIVES;
		winCounted = false;
		lostCounted = false;
		if (reuse) {
			level = loadSavedPuzzle() ?? generateLevel(W, H);
		} else {
			level = generateLevel(W, H);
			savePuzzle(level);
		}
		pz.reset();
	}

	function goToMenu() {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed   = new Set();
		markedRed = new Set();
		anims     = {};
		menuOpen  = false;
		pz.reset();
		navGoToMenu();
	}

	onMount(() => {
		startGame(session.cellsRequested, session.squareRequested);
	});
</script>

<!-- ─── Game screen ──────────────────────────────────────────────────────────── -->
<main class="relative w-full h-dvh {settings.darkMode ? 'bg-slate-900' : 'bg-slate-100'} flex flex-col overflow-hidden">

	<!-- ── Top bar ──────────────────────────────────────────────────────────────── -->
	<div class="shrink-0 flex items-center gap-2 px-3 border-b {settings.darkMode ? 'border-slate-800/80 bg-slate-900/95' : 'border-slate-300/80 bg-slate-100/95'} backdrop-blur-sm"
	     style="padding-top: env(safe-area-inset-top); min-height: calc(3rem + env(safe-area-inset-top))">

		<!-- Hamburger button -->
		<button
			class="flex items-center justify-center w-9 h-9 rounded-lg transition-colors active:scale-95
			       {settings.darkMode
			           ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
			           : 'bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-slate-800'}"
			onclick={() => (menuOpen = !menuOpen)}
			aria-label={menuOpen ? 'Close menu' : 'Open menu'}
		>
			{#if menuOpen}
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
					<line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
				</svg>
			{:else}
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<line x1="2" y1="4.5" x2="14" y2="4.5"/>
					<line x1="2" y1="8"   x2="14" y2="8"/>
					<line x1="2" y1="11.5" x2="14" y2="11.5"/>
				</svg>
			{/if}
		</button>

		<div class="flex-1"></div>

		<!-- Hearts + arrows left -->
		<div class="flex items-center gap-4 pr-1">
			{#if !showLoading}
				<span class="text-sm font-medium {settings.darkMode ? 'text-slate-400' : 'text-slate-500'}">
					{level.arrows.length - removed.size} arrows left
				</span>
			{/if}
			<div class="flex items-center gap-1.5">
				{#each Array(MAX_LIVES) as _, i}
					<span
						class="text-xl leading-none select-none transition-all duration-300
						       {i < lives ? 'text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]' : settings.darkMode ? 'text-slate-700' : 'text-slate-300'}"
					>♥</span>
				{/each}
			</div>
		</div>
	</div>

	<!-- Mobile overlay menu -->
	{#if menuOpen}
		<button
			class="absolute inset-0 z-30 {settings.darkMode ? 'bg-slate-950/40' : 'bg-slate-400/30'}"
			style="top: calc(3rem + env(safe-area-inset-top))"
			onclick={() => (menuOpen = false)}
			aria-label="Close menu"
		></button>

		<div
			class="absolute left-0 right-0 z-40 flex flex-col gap-2 p-3 border-b shadow-xl
			       {settings.darkMode
			           ? 'bg-slate-900/95 backdrop-blur-md border-slate-700/60'
			           : 'bg-white/95 backdrop-blur-md border-slate-300/60'}"
			style="top: calc(3rem + env(safe-area-inset-top))"
			transition:fly={{ y: -6, duration: 160, opacity: 0 }}
		>
			<div class="flex gap-2">
				<button
					onclick={() => { goToMenu(); menuOpen = false; }}
					class="flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors
					       {settings.darkMode
					           ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
					           : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}"
				>← Main Menu</button>
				<button
					onclick={() => { reset(lost); menuOpen = false; }}
					class="flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5
					       {lost
					           ? 'bg-red-600 text-white hover:bg-red-500'
					           : settings.darkMode
					               ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
					               : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}"
				>
					{#if lost}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M1 7a6 6 0 1 0 1.2-3.6"/><polyline points="1 2 1 5.5 4.5 5.5"/>
						</svg>
						Try Again
					{:else}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M13 2v3.5H9.5"/><path d="M1 7a6 6 0 0 1 10.2-4.3L13 5.5"/>
							<path d="M1 12v-3.5H4.5"/><path d="M13 7a6 6 0 0 1-10.2 4.3L1 8.5"/>
						</svg>
						Regenerate Puzzle
					{/if}
				</button>
			</div>

			<!-- Toggle: Dark Mode -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-0.5">
				<span class="{settings.darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm flex items-center gap-1.5">
					{#if settings.darkMode}
						<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<path d="M11 8.5A5 5 0 0 1 4.5 2a5 5 0 1 0 6.5 6.5z"/>
						</svg>
					{:else}
						<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="6.5" cy="6.5" r="2.2"/>
							<line x1="6.5" y1="1" x2="6.5" y2="0.1"/>
							<line x1="6.5" y1="12" x2="6.5" y2="12.9"/>
							<line x1="1" y1="6.5" x2="0.1" y2="6.5"/>
							<line x1="12" y1="6.5" x2="12.9" y2="6.5"/>
							<line x1="2.9" y1="2.9" x2="2.2" y2="2.2"/>
							<line x1="10.1" y1="10.1" x2="10.8" y2="10.8"/>
							<line x1="10.1" y1="2.9" x2="10.8" y2="2.2"/>
							<line x1="2.9" y1="10.1" x2="2.2" y2="10.8"/>
						</svg>
					{/if}
					Dark Mode
				</span>
				<button
					role="switch"
					aria-checked={settings.darkMode}
					onclick={() => (settings.darkMode = !settings.darkMode)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.darkMode ? 'bg-emerald-500' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
					             {settings.darkMode ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>

			<!-- Toggle: Show Grid -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-0.5">
				<span class="{settings.darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm">Show Grid</span>
				<button
					role="switch"
					aria-checked={settings.showGrid}
					onclick={() => (settings.showGrid = !settings.showGrid)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.showGrid ? 'bg-emerald-500' : settings.darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
					             {settings.showGrid ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>

			<!-- Toggle: Rounded Corners -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-0.5">
				<span class="{settings.darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm">Rounded Corners</span>
				<button
					role="switch"
					aria-checked={settings.roundedCorners}
					onclick={() => (settings.roundedCorners = !settings.roundedCorners)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.roundedCorners ? 'bg-emerald-500' : settings.darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
					             {settings.roundedCorners ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>

			<!-- Toggle: Win Animation -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-0.5">
				<span class="{settings.darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm">Win Animation</span>
				<button
					role="switch"
					aria-checked={settings.winAnimation}
					onclick={() => (settings.winAnimation = !settings.winAnimation)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.winAnimation ? 'bg-emerald-500' : settings.darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
					             {settings.winAnimation ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>
		</div>
	{/if}

	<!-- ── Board area ───────────────────────────────────────────────────────────── -->
	<div class="flex-1 min-h-0 flex items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
		<div
			style="width: min(calc(100vw - 1.5rem), calc((100dvh - 4.5rem - env(safe-area-inset-top)) * {W / H})); aspect-ratio: {W} / {H};"
			class="relative overflow-hidden rounded-xl touch-none"
			use:pz.action
		>
			<svg
				viewBox="-0.1 -0.1 {W + 0.2} {H + 0.2}"
				style="width:100%;height:100%;transform:translate({pz.panX}px,{pz.panY}px) scale({pz.scale});transform-origin:0 0;"
				overflow="hidden"
			>
				<!-- Grid background -->
				<defs>
					<pattern id="cell-bg" x="0" y="0" width="1" height="1" patternUnits="userSpaceOnUse">
						<rect x="0.06" y="0.06" width="0.88" height="0.88" rx="0.18"
							fill={settings.darkMode ? 'rgba(51,65,85,0.6)' : 'rgba(203,213,225,0.8)'} />
					</pattern>
				</defs>
				{#if settings.showGrid}
					<rect x="0" y="0" width={W} height={H} fill="url(#cell-bg)" />
				{/if}

				<!-- Arrows: split static vs animating so RAF ticks only re-render
				     the 1–2 arrows that are actively sliding. -->
				{#each level.arrows as arrow (arrow.id)}
					{#if !removed.has(arrow.id)}
						{#if anims[arrow.id]}
							{@const anim = anims[arrow.id]}
							{#if anim.phase === 'exiting'}
								<!-- Drain animation: snake-length dash slides along extended route -->
								{@const el       = Math.max(0, now - anim.startTime)}
								{@const p        = Math.min(1, el / (anim.durationMs ?? 1))}
								{@const travel   = (anim.L_total ?? 0) - (anim.L_snake ?? 0)}
								{@const offset   = -p * travel}
								{@const headLen  = Math.min(anim.L_total ?? 0, (anim.L_snake ?? 0) + p * travel)}
								{@const ref      = pathRefs[arrow.id]}
								{@const headPt   = ref ? ref.getPointAtLength(headLen)
								                       : { x: arrow.path[0].x + 0.5, y: arrow.path[0].y + 0.5 }}
								{@const aheadPt  = ref ? ref.getPointAtLength(Math.min(anim.L_total ?? 0, headLen + 0.1))
								                       : { x: headPt.x + DELTA[arrow.direction].dx, y: headPt.y + DELTA[arrow.direction].dy }}
								{@const angle    = Math.atan2(aheadPt.y - headPt.y, aheadPt.x - headPt.x) * 180 / Math.PI}
								{@const color    = themeColor(arrow.id, settings.darkMode)}
								<g style="cursor:default;pointer-events:none">
									<path
										bind:this={pathRefs[arrow.id]}
										d={anim.routeD}
										fill="none"
										stroke={color}
										stroke-width={0.14}
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-dasharray="{anim.L_snake} {anim.L_total}"
										stroke-dashoffset={offset}
										opacity={0.9}
									/>
									<polygon
										points="0.32,0 -0.16,-0.24 -0.16,0.24"
										transform="translate({headPt.x},{headPt.y}) rotate({angle})"
										fill={color}
										opacity={0.95}
									/>
								</g>
							{:else}
								<!-- Blocked phases: rigid-body nudge / bounce / flash -->
								{@const d    = DELTA[arrow.direction]}
								{@const el   = Math.max(0, now - anim.startTime)}
								{@const s    = computeS(anim, el)}
								{@const pts  = arrow.path.map((_, k) => segPos(arrow.path, k, s, d))}
								{@const head = pts[0]}
								{@const red  = isFlashRed(anim, el)}
								{@const color = themeColor(arrow.id, settings.darkMode)}
								<g style="cursor:default;pointer-events:none">
									<path
										d={roundedPath(pts, settings.roundedCorners ? 0.4 : 0)}
										fill="none"
										stroke={red ? '#ef4444' : color}
										stroke-width={0.14}
										stroke-linecap="round"
										stroke-linejoin="round"
										opacity={0.9}
									/>
									<polygon
										points="0.32,0 -0.16,-0.24 -0.16,0.24"
										transform="translate({head.x + 0.5},{head.y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
										fill={red ? '#ef4444' : color}
										opacity={0.95}
									/>
								</g>
							{/if}
						{:else}
							<!-- Static branch: pre-computed paths, zero per-frame cost -->
							{@const sd        = staticArrowData[arrow.id]}
							{@const penalized = markedRed.has(arrow.id)}
							{@const drawColor = penalized ? '#b91c1c' : themeColor(arrow.id, settings.darkMode)}
							<g onclick={() => handleClick(arrow.id)} style="cursor:pointer">
								{#each arrow.path as seg}
									<rect x={seg.x} y={seg.y} width={1} height={1} fill="transparent" />
								{/each}
								<path
									d={sd.d}
									fill="none"
									stroke={drawColor}
									stroke-width={0.14}
									stroke-linecap="round"
									stroke-linejoin="round"
									opacity={0.9}
								/>
								<polygon
									points="0.32,0 -0.16,-0.24 -0.16,0.24"
									transform="translate({sd.head.x + 0.5},{sd.head.y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
									fill={drawColor}
									opacity={0.95}
								/>
							</g>
						{/if}
					{/if}
				{/each}

				<!-- Vortex collapse — star particles spiral into the board centre on win -->
				{#if vortexAnim}
					{@const elapsed     = Math.max(0, now - vortexAnim.startTime)}
					{@const bx          = W / 2}
					{@const by          = H / 2}
					{@const spinElapsed = Math.max(0, elapsed - VORTEX_FADE_MS)}
					{@const spinP       = Math.min(1, spinElapsed / VORTEX_SPIN_MS)}
					{@const spinEP      = spinP * spinP * spinP}
					<rect x="0" y="0" width={W} height={H}
						fill={settings.darkMode ? '#0f172a' : '#f1f5f9'}
						opacity={spinEP} />
					{#each vortexParticles as pt}
						{@const lElapsed     = Math.max(0, elapsed - pt.delay)}
						{@const fadeP        = Math.min(1, lElapsed / VORTEX_FADE_MS)}
						{@const lSpinElapsed = Math.max(0, lElapsed - VORTEX_FADE_MS)}
						{@const lSpinP       = Math.min(1, lSpinElapsed / (VORTEX_SPIN_MS * pt.speed))}
						{@const lSpinEP      = lSpinP * lSpinP * lSpinP}
						{@const r            = pt.r0 * (1 - lSpinEP)}
						{@const θ            = pt.θ0 + lSpinEP * Math.PI * 4}
						{@const pcx          = bx + r * Math.cos(θ)}
						{@const pcy          = by + r * Math.sin(θ)}
						{@const rot          = pt.rotation + fadeP * 20 + lSpinEP * 180}
						<g
							transform="translate({pcx},{pcy}) rotate({rot}) scale({pt.size})"
							fill={pt.color}
							opacity={fadeP * (1 - lSpinP * lSpinP)}
						>
							<path d={SPARKLE_PATH} />
						</g>
					{/each}
				{/if}

			</svg>

			<!-- Loading overlay -->
			{#if showLoading}
				<div class="absolute inset-0 z-50 flex items-center justify-center {settings.darkMode ? 'bg-slate-950/80' : 'bg-slate-300/80'} backdrop-blur-sm">
					<div class="flex flex-col items-center gap-4 text-center">
						<div class="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
						<p class="text-xl font-bold {settings.darkMode ? 'text-white' : 'text-slate-900'}">Loading...</p>
					</div>
				</div>
			{/if}

			<!-- Win panel — appears after the vortex collapse finishes -->
			{#if won && vortexDone}
				<div class="absolute inset-0 flex items-center justify-center {settings.darkMode ? 'bg-slate-950/75' : 'bg-slate-300/70'}"
				     transition:fly={{ y: 16, duration: 280, opacity: 0 }}>
					<div class="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl shadow-2xl
					            {settings.darkMode
					                ? 'bg-slate-900/90 border border-slate-700/60'
					                : 'bg-white/95 border border-slate-200/60'}">
						<div class="text-4xl mb-2">🎉</div>
						<p class="text-2xl font-extrabold tracking-tight {settings.darkMode ? 'text-white' : 'text-slate-900'}">Level Complete</p>
						<p class="text-sm {settings.darkMode ? 'text-slate-400' : 'text-slate-500'}">All {level.arrows.length} arrows cleared</p>
						<div class="flex gap-1 mt-1">
							{#each Array(MAX_LIVES) as _, i}
								<span class="text-lg transition-all {i < lives ? 'text-red-500' : settings.darkMode ? 'text-slate-700' : 'text-slate-300'}">
									{i < lives ? '♥' : '♡'}
								</span>
							{/each}
						</div>
						<button
							onclick={() => reset(false)}
							class="w-full px-8 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95
							       text-white font-bold text-lg shadow-lg shadow-emerald-900/50 transition-all duration-150
							       flex items-center justify-center gap-2"
						>
							<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polygon points="6,3 15,9 6,15" fill="currentColor" stroke="none"/>
							</svg>
							New Level
						</button>
						<button
							onclick={goToMenu}
							class="px-6 py-2 rounded-xl active:scale-95 text-sm font-medium border transition-all duration-150
							       {settings.darkMode
							           ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
							           : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'}"
						>← Main Menu</button>
					</div>
				</div>
			{/if}

			<!-- Game-over panel -->
			{#if lost}
				<div class="absolute inset-0 flex items-center justify-center {settings.darkMode ? 'bg-slate-950/80' : 'bg-slate-300/75'}">
					<div class="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl shadow-2xl
					            {settings.darkMode
					                ? 'bg-slate-900/90 border border-slate-700/60'
					                : 'bg-white/95 border border-slate-200/60'}">
						<div class="text-4xl mb-2">💔</div>
						<p class="text-2xl font-extrabold text-red-500 tracking-tight">Game Over</p>
						<p class="text-sm {settings.darkMode ? 'text-slate-400' : 'text-slate-500'}">
							{level.arrows.length - removed.size} arrows left
						</p>
						<button
							onclick={() => reset(true)}
							class="w-full px-8 py-3 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-95
							       text-white font-bold text-lg shadow-lg shadow-red-900/50 transition-all duration-150"
						>↺ Try Again</button>
						<button
							onclick={goToMenu}
							class="px-6 py-2 rounded-xl active:scale-95 text-sm font-medium border transition-all duration-150
							       {settings.darkMode
							           ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
							           : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'}"
						>← Main Menu</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</main>
