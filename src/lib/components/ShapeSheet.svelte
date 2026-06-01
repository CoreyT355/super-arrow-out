<script lang="ts">
    import { fly } from 'svelte/transition';
    import { trapFocus } from '$lib/utils/trapFocus';
    import { settings } from '$lib/stores/settings.svelte';
    import { eligibleShapes, type Shape } from '$lib/config/shapes';

    // Bottom sheet for choosing a shape after a difficulty has been picked.
    // Shown only when more than just Classic is eligible at the chosen size
    // (the parent starts Classic immediately otherwise). Classic is listed
    // first and highlighted so a plain game stays a quick second tap.

    interface Props {
        /** Difficulty label, shown in the sheet header. */
        difficultyLabel: string;
        /** Target filled-cell count for eligibility. */
        targetCells:     number;
        reducedMotion:   boolean;
        /** shapeId is undefined for Classic. */
        onPick:          (shapeId?: string) => void;
        onClose:         () => void;
    }
    let { difficultyLabel, targetCells, reducedMotion, onPick, onClose }: Props = $props();

    const darkMode = $derived(settings.darkMode);
    const shapes   = $derived<Shape[]>(eligibleShapes(targetCells));
</script>

<button
    class="absolute inset-0 z-40 {darkMode ? 'bg-slate-950/50' : 'bg-slate-400/40'}"
    onclick={onClose}
    tabindex="-1"
    aria-hidden="true"
></button>

<div
    use:trapFocus={{ onClose }}
    role="dialog"
    aria-modal="true"
    aria-labelledby="shape-sheet-title"
    class="absolute left-0 right-0 bottom-0 z-50 flex flex-col gap-3 p-5 rounded-t-3xl shadow-2xl
           pb-[max(1.25rem,env(safe-area-inset-bottom))]
           {darkMode
               ? 'bg-slate-800 border-t border-slate-700/60'
               : 'bg-white border-t border-slate-200'}"
    transition:fly={{ y: reducedMotion ? 0 : 40, duration: reducedMotion ? 120 : 220, opacity: 0 }}
>
    <div class="flex items-center justify-between">
        <p id="shape-sheet-title" class="text-sm font-semibold uppercase tracking-wide {darkMode ? 'text-slate-300' : 'text-slate-600'}">
            {difficultyLabel} — pick a shape
        </p>
        <button
            onclick={onClose}
            aria-label="Close shape picker"
            class="flex items-center justify-center w-9 h-9 -mr-1 rounded-lg transition-colors
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500
                   {darkMode ? 'text-slate-400 hover:bg-slate-700 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}"
        >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                <line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
            </svg>
        </button>
    </div>

    <div class="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {#each shapes as s (s.id)}
            {@const isClassic = s.id === 'classic'}
            <button
                onclick={() => onPick(isClassic ? undefined : s.id)}
                class="flex flex-col items-center gap-2 py-4 rounded-2xl transition-all duration-150 active:scale-95
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500
                       {isClassic
                           ? 'bg-sky-600 text-white hover:bg-sky-500 shadow-lg shadow-sky-900/30'
                           : darkMode
                               ? 'bg-slate-700/70 text-slate-200 hover:bg-slate-700 border border-slate-600/60'
                               : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}"
            >
                <svg width="32" height="32" viewBox={s.iconViewBox} fill="currentColor" aria-hidden="true">
                    <path d={s.icon} />
                </svg>
                <span class="text-xs font-medium">{s.label}</span>
            </button>
        {/each}
    </div>
</div>
