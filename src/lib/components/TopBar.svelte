<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { MAX_LIVES } from '$lib/constants/game';

    // The in-game top bar: hamburger that toggles the game menu, an
    // arrows-left counter, and the lives indicator. Owns no state of its
    // own — `menuOpen` is parent-owned and toggled via `onToggleMenu`.

    interface Props {
        menuOpen:    boolean;
        arrowsLeft:  number;
        lives:       number;
        showLoading: boolean;
        onToggleMenu: () => void;
    }
    let { menuOpen, arrowsLeft, lives, showLoading, onToggleMenu }: Props = $props();

    const darkMode = $derived(settings.darkMode);
</script>

<!-- h-12 = 3rem fixed; shrink-0 prevents flex from squishing it -->
<div class="shrink-0 flex items-center gap-2 px-3 border-b {darkMode ? 'border-slate-800/80 bg-slate-900/95' : 'border-slate-300/80 bg-slate-100/95'} backdrop-blur-sm"
     style="padding-top: env(safe-area-inset-top); min-height: calc(3rem + env(safe-area-inset-top))">

    <!-- Hamburger button — always visible -->
    <button
        class="flex items-center justify-center w-11 h-11 rounded-lg transition-colors active:scale-95
               {darkMode
                   ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                   : 'bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-slate-800'}"
        onclick={onToggleMenu}
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

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- Hearts — always visible on every screen size -->
    <div class="flex items-center gap-4 pr-1">
        {#if !showLoading}
            <span
                class="text-sm font-medium {darkMode ? 'text-slate-400' : 'text-slate-500'}"
                aria-live="polite"
                aria-atomic="true"
            >
                {arrowsLeft} arrows left
            </span>
        {/if}
        <div
            class="flex items-center gap-1.5"
            role="img"
            aria-label="{lives} of {MAX_LIVES} lives remaining"
            aria-live="polite"
        >
            {#each Array(MAX_LIVES) as _, i}
                <span
                    aria-hidden="true"
                    class="text-xl leading-none select-none transition-all duration-300
                           {i < lives ? 'text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]' : darkMode ? 'text-slate-700' : 'text-slate-300'}"
                >♥</span>
            {/each}
        </div>
    </div>
</div>
