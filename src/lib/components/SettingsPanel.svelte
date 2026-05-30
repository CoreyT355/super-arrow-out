<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';

    // Renders the 4 settings toggles (Dark Mode, Show Grid, Rounded
    // Corners, Win Animation). Used in two places: the start-menu
    // settings drawer and the in-game settings drawer.
    //
    // Both call sites read/write the same `settings` store directly, so
    // this component takes no value props — just a visual `compact`
    // flag that preserves the small style differences between the two
    // original inline panels:
    //
    //   menu   (compact=false): py-2 row padding, 14px icons, gap-2,    text-slate-200
    //   game   (compact=true ): no row py,         13px icons, gap-1.5, text-slate-300
    //
    // Behavior is identical in both modes — the store is the single
    // source of truth so toggling either panel updates the other live.

    interface Props { compact?: boolean }
    let { compact = false }: Props = $props();

    // Aliases keep the template readable. Writes go through `settings.X = …`
    // so reactivity propagates back to every consumer of the store.
    const darkMode       = $derived(settings.darkMode);
    const showGrid       = $derived(settings.showGrid);
    const roundedCorners = $derived(settings.roundedCorners);
    const winAnimation   = $derived(settings.winAnimation);

    // Style fragments that differ between compact/non-compact. Kept as
    // $derived strings rather than `class:` to match the exact original
    // markup verbatim — easier to diff against the pre-extraction code.
    const rowPad      = $derived(compact ? 'min-h-11 px-1'        : 'min-h-11 px-1 py-2');
    const labelColor  = $derived(compact ? 'text-slate-300'       : 'text-slate-200');
    const iconSize    = $derived(compact ? 13                     : 14);
    const labelGap    = $derived(compact ? 'gap-1.5'              : 'gap-2');
</script>

<!-- Dark Mode -->
<button
    role="switch" aria-checked={darkMode}
    onclick={() => (settings.darkMode = !settings.darkMode)}
    class="flex items-center justify-between w-full {rowPad} rounded-lg select-none transition-colors
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
>
    <span class="{darkMode ? labelColor : 'text-slate-700'} text-sm flex items-center {labelGap}">
        {#if darkMode}
            <!-- Moon -->
            <svg width={iconSize} height={iconSize} viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 8.5A5 5 0 0 1 4.5 2a5 5 0 1 0 6.5 6.5z"/>
            </svg>
        {:else}
            <!-- Sun -->
            <svg width={iconSize} height={iconSize} viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="6.5" cy="6.5" r="2.2"/>
                <line x1="6.5" y1="1" x2="6.5" y2="0.1"/><line x1="6.5" y1="12" x2="6.5" y2="12.9"/>
                <line x1="1" y1="6.5" x2="0.1" y2="6.5"/><line x1="12" y1="6.5" x2="12.9" y2="6.5"/>
                <line x1="2.9" y1="2.9" x2="2.2" y2="2.2"/><line x1="10.1" y1="10.1" x2="10.8" y2="10.8"/>
                <line x1="10.1" y1="2.9" x2="10.8" y2="2.2"/><line x1="2.9" y1="10.1" x2="2.2" y2="10.8"/>
            </svg>
        {/if}
        Dark Mode
    </span>
    <span
        class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
               {darkMode ? 'bg-emerald-500' : 'bg-slate-300'}"
    >
        <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {darkMode ? 'translate-x-4' : 'translate-x-0'}"></span>
    </span>
</button>

<!-- Show Grid -->
<button
    role="switch" aria-checked={showGrid}
    onclick={() => (settings.showGrid = !settings.showGrid)}
    class="flex items-center justify-between w-full {rowPad} rounded-lg select-none transition-colors
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
>
    <span class="{darkMode ? labelColor : 'text-slate-700'} text-sm">Show Grid</span>
    <span
        class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
               {showGrid ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
    >
        <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {showGrid ? 'translate-x-4' : 'translate-x-0'}"></span>
    </span>
</button>

<!-- Rounded Corners -->
<button
    role="switch" aria-checked={roundedCorners}
    onclick={() => (settings.roundedCorners = !settings.roundedCorners)}
    class="flex items-center justify-between w-full {rowPad} rounded-lg select-none transition-colors
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
>
    <span class="{darkMode ? labelColor : 'text-slate-700'} text-sm">Rounded Corners</span>
    <span
        class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
               {roundedCorners ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
    >
        <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {roundedCorners ? 'translate-x-4' : 'translate-x-0'}"></span>
    </span>
</button>

<!-- Win Animation -->
<button
    role="switch" aria-checked={winAnimation}
    onclick={() => (settings.winAnimation = !settings.winAnimation)}
    class="flex items-center justify-between w-full {rowPad} rounded-lg select-none transition-colors
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
>
    <span class="{darkMode ? labelColor : 'text-slate-700'} text-sm">Win Animation</span>
    <span
        class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
               {winAnimation ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
    >
        <span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {winAnimation ? 'translate-x-4' : 'translate-x-0'}"></span>
    </span>
</button>
