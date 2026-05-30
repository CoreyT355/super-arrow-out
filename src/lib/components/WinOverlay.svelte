<script lang="ts">
    import { fly } from 'svelte/transition';
    import { settings } from '$lib/stores/settings.svelte';
    import { trapFocus } from '$lib/utils/trapFocus';
    import { MAX_LIVES } from '$lib/constants/game';

    // The full-screen "Level Complete" panel. Mounted after the vortex
    // collapse finishes — see the `won && vortexDone` guard at the call site.

    interface Props {
        arrowCount:    number;
        lives:         number;
        reducedMotion: boolean;
        onNewLevel:    () => void;
        onMenu:        () => void;
    }
    let { arrowCount, lives, reducedMotion, onNewLevel, onMenu }: Props = $props();

    const darkMode = $derived(settings.darkMode);
</script>

<!-- Win panel — covers the full screen so it stays interactive when the
     surrounding game UI is marked inert. -->
<div class="absolute inset-0 flex items-center justify-center z-50 {darkMode ? 'bg-slate-950/75' : 'bg-slate-300/70'}"
     transition:fly={{ y: reducedMotion ? 0 : 16, duration: reducedMotion ? 160 : 280, opacity: 0 }}>
    <div
        use:trapFocus
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="win-panel-title"
        class="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl shadow-2xl
               {darkMode
                   ? 'bg-slate-900/90 border border-slate-700/60'
                   : 'bg-white/95 border border-slate-200/60'}"
    >
        <div class="text-4xl mb-2" aria-hidden="true">🎉</div>
        <p id="win-panel-title" class="text-2xl font-extrabold tracking-tight {darkMode ? 'text-white' : 'text-slate-900'}">Level Complete</p>
        <p class="text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">All {arrowCount} arrows cleared</p>
        <div class="flex gap-1 mt-1" role="img" aria-label="{lives} of {MAX_LIVES} lives remaining">
            {#each Array(MAX_LIVES) as _, i}
                <span aria-hidden="true" class="text-lg transition-all {i < lives ? 'text-red-500' : darkMode ? 'text-slate-700' : 'text-slate-300'}">
                    {i < lives ? '♥' : '♡'}
                </span>
            {/each}
        </div>
        <button
            onclick={onNewLevel}
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
            onclick={onMenu}
            class="px-6 py-2 rounded-xl active:scale-95 text-sm font-medium border transition-all duration-150
                   {darkMode
                       ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
                       : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'}"
        >← Main Menu</button>
    </div>
</div>
