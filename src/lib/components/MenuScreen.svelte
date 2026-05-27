<script lang="ts">
	import { fly, scale } from 'svelte/transition';
	import { settings } from '$lib/stores/settings.svelte';
	import { progress } from '$lib/stores/progress.svelte';
	import { goToGame, goToStats } from '$lib/stores/session.svelte';
	import { ENABLED_DIFFICULTIES, gridCaption } from '$lib/config/difficulties';

	let menuSettingsOpen = $state(false);

	// ── Easter egg: swipe ↑ ↑ ↓ ↓ ← → ← → within 45 seconds ─────────────────
	const KONAMI      = ['up','up','down','down','left','right','left','right'] as const;
	const TIMEOUT_MS  = 45_000;
	const SWIPE_MIN   = 30; // px — minimum travel to count as a swipe

	let swipeIdx        = $state(0);
	let sequenceStart   = 0;
	let easterEggActive = $state(false);
	let _tx0 = 0, _ty0 = 0;

	function handleSwipe(dir: string) {
		const now = Date.now();
		// Timeout: reset progress if the window has expired
		if (swipeIdx > 0 && now - sequenceStart > TIMEOUT_MS) swipeIdx = 0;

		if (dir === KONAMI[swipeIdx]) {
			if (swipeIdx === 0) sequenceStart = now; // start the clock on first correct swipe
			swipeIdx++;
			if (swipeIdx === KONAMI.length) { easterEggActive = true; swipeIdx = 0; }
		} else {
			// Wrong direction — restart from 1 if this matches the first gesture, else 0
			swipeIdx = dir === KONAMI[0] ? 1 : 0;
			if (swipeIdx === 1) sequenceStart = now;
		}
	}

	function onTouchStart(e: TouchEvent) {
		const t = e.changedTouches[0];
		_tx0 = t.clientX; _ty0 = t.clientY;
	}

	function onTouchEnd(e: TouchEvent) {
		const t = e.changedTouches[0];
		const dx = t.clientX - _tx0, dy = t.clientY - _ty0;
		if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return; // tap, not swipe
		handleSwipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
	}

	function onKeyDown(e: KeyboardEvent) {
		const map: Record<string, string> = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
		if (map[e.key]) { e.preventDefault(); handleSwipe(map[e.key]); }
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<main class="relative w-full h-dvh {settings.darkMode ? 'bg-slate-900' : 'bg-slate-100'} flex flex-col p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      style="padding-top: max(1.5rem, env(safe-area-inset-top))"
      ontouchstart={onTouchStart}
      ontouchend={onTouchEnd}>

	<!-- Top row: easter egg slot (left) + gear button (right) -->
	<div class="flex justify-between items-center shrink-0">

		<!-- Easter egg icon — appears after the gesture sequence is completed -->
		<div class="w-9 h-9 flex items-center justify-center">
			{#if easterEggActive}
				<button
					class="w-9 h-9 rounded-lg flex items-center justify-center transition-colors
					       {settings.darkMode
					           ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
					           : 'bg-amber-100 text-amber-500 hover:bg-amber-200'}"
					aria-label="???"
					transition:scale={{ duration: 250, start: 0.4 }}
					onclick={() => { /* TODO: wire up easter egg behavior */ }}
				>
					<!-- 5-pointed star -->
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
						<polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
					</svg>
				</button>
			{/if}
		</div>

		<button
			onclick={() => (menuSettingsOpen = true)}
			class="flex items-center justify-center w-9 h-9 rounded-lg transition-colors
			       {settings.darkMode
			           ? 'bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white'
			           : 'bg-slate-300 text-slate-800 hover:bg-slate-400 hover:text-slate-900'}"
			aria-label="Settings"
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
				<path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/>
				<path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
			</svg>
		</button>
	</div>

	<!-- Centered content -->
	<div class="flex-1 flex flex-col items-center justify-center gap-6">

	<!-- Settings overlay -->
	{#if menuSettingsOpen}
		<button
			class="absolute inset-0 z-40 {settings.darkMode ? 'bg-slate-950/50' : 'bg-slate-400/40'}"
			onclick={() => (menuSettingsOpen = false)}
			aria-label="Close settings"
		></button>
		<div
			class="absolute z-50 w-72 flex flex-col gap-1 p-5 rounded-2xl shadow-2xl
			       {settings.darkMode
			           ? 'bg-slate-800 border border-slate-700/60'
			           : 'bg-white border border-slate-200'}"
			transition:fly={{ y: 8, duration: 180, opacity: 0 }}
		>
			<p class="text-sm font-semibold {settings.darkMode ? 'text-slate-300' : 'text-slate-600'} mb-2 tracking-wide uppercase">Settings</p>

			<!-- Dark Mode -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-2">
				<span class="{settings.darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm flex items-center gap-2">
					{#if settings.darkMode}
						<svg width="14" height="14" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<path d="M11 8.5A5 5 0 0 1 4.5 2a5 5 0 1 0 6.5 6.5z"/>
						</svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="6.5" cy="6.5" r="2.2"/>
							<line x1="6.5" y1="1" x2="6.5" y2="0.1"/><line x1="6.5" y1="12" x2="6.5" y2="12.9"/>
							<line x1="1" y1="6.5" x2="0.1" y2="6.5"/><line x1="12" y1="6.5" x2="12.9" y2="6.5"/>
							<line x1="2.9" y1="2.9" x2="2.2" y2="2.2"/><line x1="10.1" y1="10.1" x2="10.8" y2="10.8"/>
							<line x1="10.1" y1="2.9" x2="10.8" y2="2.2"/><line x1="2.9" y1="10.1" x2="2.2" y2="10.8"/>
						</svg>
					{/if}
					Dark Mode
				</span>
				<button
					role="switch" aria-checked={settings.darkMode}
					onclick={() => (settings.darkMode = !settings.darkMode)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.darkMode ? 'bg-emerald-500' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {settings.darkMode ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>

			<!-- Show Grid -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-2">
				<span class="{settings.darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm">Show Grid</span>
				<button
					role="switch" aria-checked={settings.showGrid}
					onclick={() => (settings.showGrid = !settings.showGrid)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.showGrid ? 'bg-emerald-500' : settings.darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {settings.showGrid ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>

			<!-- Rounded Corners -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-2">
				<span class="{settings.darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm">Rounded Corners</span>
				<button
					role="switch" aria-checked={settings.roundedCorners}
					onclick={() => (settings.roundedCorners = !settings.roundedCorners)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.roundedCorners ? 'bg-emerald-500' : settings.darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {settings.roundedCorners ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>

			<!-- Win Animation -->
			<label class="flex items-center justify-between cursor-pointer select-none px-1 py-2">
				<span class="{settings.darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm">Win Animation</span>
				<button
					role="switch" aria-checked={settings.winAnimation}
					onclick={() => (settings.winAnimation = !settings.winAnimation)}
					class="relative w-10 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
					       {settings.winAnimation ? 'bg-emerald-500' : settings.darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
				>
					<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {settings.winAnimation ? 'translate-x-4' : 'translate-x-0'}"></span>
				</button>
			</label>

			<!-- Divider -->
			<div class="my-1 border-t {settings.darkMode ? 'border-slate-700/60' : 'border-slate-200'}"></div>

			<!-- Stats link -->
			<button
				onclick={() => { menuSettingsOpen = false; goToStats(); }}
				class="flex items-center justify-between w-full px-1 py-2 rounded-lg transition-colors
				       {settings.darkMode ? 'text-slate-200 hover:text-white' : 'text-slate-700 hover:text-slate-900'}"
			>
				<span class="flex items-center gap-2 text-sm">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
						<rect x="1" y="7" width="3" height="6" rx="0.5"/>
						<rect x="5.5" y="4" width="3" height="9" rx="0.5"/>
						<rect x="10" y="1" width="3" height="12" rx="0.5"/>
					</svg>
					Stats
				</span>
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="opacity-40">
					<polyline points="5,3 9,7 5,11"/>
				</svg>
			</button>
		</div>
	{/if}

	<div class="text-center">
		<h1 class="text-5xl font-extrabold {settings.darkMode ? 'text-white' : 'text-slate-900'} tracking-tight mb-2">Super Arrow Out</h1>
	</div>

	<div class="flex flex-col gap-4 w-full max-w-xs">
		{#each ENABLED_DIFFICULTIES as d}
			{@const count = progress[d.label] ?? 0}
			<button
				onclick={() => goToGame(d.label, d.cells, d.square)}
				class="group relative flex items-center py-4 px-5 rounded-2xl bg-gradient-to-br {d.color}
				       shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-transform duration-150
				       ring-2 ring-transparent hover:{d.ring} focus-visible:{d.ring} focus-visible:outline-none"
				style={'bgStyle' in d ? d.bgStyle : ''}
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

	</div><!-- end centered content -->

	<!-- Stats button pinned to the bottom -->
	<div class="shrink-0 flex justify-center pb-1">
		<button
			onclick={goToStats}
			class="{settings.darkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'} text-sm transition-colors flex items-center gap-1.5"
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
				<rect x="1" y="7" width="3" height="6" rx="0.5"/>
				<rect x="5.5" y="4" width="3" height="9" rx="0.5"/>
				<rect x="10" y="1" width="3" height="12" rx="0.5"/>
			</svg>
			Stats
		</button>
	</div>
</main>
