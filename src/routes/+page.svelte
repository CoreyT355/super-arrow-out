<script lang="ts">
	import { session } from '$lib/stores/session.svelte';
	import MenuScreen  from '$lib/components/MenuScreen.svelte';
	import StatsScreen from '$lib/components/StatsScreen.svelte';
	import GameScreen  from '$lib/components/GameScreen.svelte';
</script>

{#if session.screen === 'menu'}
	<MenuScreen />
{:else if session.screen === 'stats'}
	<StatsScreen />
{:else}
	<GameScreen />
{/if}
