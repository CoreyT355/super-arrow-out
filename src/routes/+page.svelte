<script lang="ts">
	// Thin router. Owns nothing but `gameState` and the request that
	// describes how to boot a new game session. Each screen is a
	// self-contained component that reads stores directly for
	// cross-cutting state (settings, progress, resume).
	import MenuScreen from '$lib/components/MenuScreen.svelte';
	import GameScreen from '$lib/components/GameScreen.svelte';
	import StatsScreen from '$lib/components/StatsScreen.svelte';

	type StartRequest =
		| { kind: 'new';    cells: number; square: boolean; shape?: string }
		| { kind: 'resume' };

	let gameState   = $state<'menu' | 'playing' | 'stats'>('menu');
	let pendingRequest = $state<StartRequest>({ kind: 'new', cells: 81, square: true });

	// OS-level reduce-motion preference. Gating the vortex / fly transitions
	// is a screen concern but the listener is shared, so it lives here and
	// is threaded into each screen as a prop.
	let reducedMotion = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const handler = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	});

	function startGame(cells: number, square: boolean, shape?: string) {
		pendingRequest = { kind: 'new', cells, square, shape };
		gameState = 'playing';
	}
	function resumeGame() {
		pendingRequest = { kind: 'resume' };
		gameState = 'playing';
	}
	function goToMenu()  { gameState = 'menu'; }
	function goToStats() { gameState = 'stats'; }
</script>

{#if gameState === 'menu'}
	<MenuScreen
		{reducedMotion}
		onStart={startGame}
		onResume={resumeGame}
		onGoToStats={goToStats}
	/>
{:else if gameState === 'stats'}
	<StatsScreen onBack={goToMenu} />
{:else}
	<!-- Keyed so navigating back to the menu and starting a new game
	     unmounts and remounts GameScreen, resetting all its local state. -->
	{#key pendingRequest}
		<GameScreen
			request={pendingRequest}
			{reducedMotion}
			onBackToMenu={goToMenu}
		/>
	{/key}
{/if}
