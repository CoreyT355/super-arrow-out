<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import { dev } from '$app/environment';

	injectAnalytics({ mode: dev ? 'development' : 'production' });

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
