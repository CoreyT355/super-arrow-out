<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { gridCaption, type Difficulty } from '$lib/config/difficulties';

    // One difficulty card on the start menu. Receives the static metadata
    // (label, palette, optional bgStyle) and the player's current win count
    // for that difficulty. Single onclick → parent kicks off generation.

    interface Props {
        difficulty: Difficulty;
        wins:       number;
        onStart:    () => void;
    }
    let { difficulty: d, wins, onStart }: Props = $props();

    const darkMode = $derived(settings.darkMode);
</script>

<button
    onclick={onStart}
    class="group relative flex items-center py-4 px-5 rounded-2xl bg-gradient-to-br {d.color}
           shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-transform duration-150
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white
           focus-visible:ring-offset-2 {darkMode ? 'focus-visible:ring-offset-slate-900' : 'focus-visible:ring-offset-slate-100'}"
    style={d.bgStyle ?? ''}
>
    <!-- Label + grid size -->
    <div class="flex flex-col items-start flex-1 min-w-0">
        <span class="text-white font-bold text-xl tracking-wide">{d.label}</span>
        <span class="text-white/90 text-sm">{gridCaption(d.cells, d.square)}</span>
    </div>
    <!-- Completion count badge -->
    <div class="flex flex-col items-center justify-center ml-3 shrink-0 min-w-[3rem]">
        {#if wins > 0}
            <span class="text-2xl font-extrabold text-white leading-none">{wins}</span>
            <span class="text-white/85 text-[10px] uppercase tracking-widest mt-0.5">
                {wins === 1 ? 'win' : 'wins'}
            </span>
        {:else}
            <span class="text-white/30 text-xs">—</span>
        {/if}
    </div>
</button>
