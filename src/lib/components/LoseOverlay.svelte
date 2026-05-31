<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { trapFocus } from '$lib/utils/trapFocus';

    // The full-screen "Game Over" panel, shown when `lives` hits zero. No
    // fly transition here (matching pre-extraction behavior — the loss
    // appears immediately rather than animating in).

    interface Props {
        arrowsLeft:  number;
        onTryAgain:  () => void;
        onMenu:      () => void;
    }
    let { arrowsLeft, onTryAgain, onMenu }: Props = $props();

    const darkMode = $derived(settings.darkMode);
</script>

<div class="absolute inset-0 flex items-center justify-center z-50 {darkMode ? 'bg-slate-950/80' : 'bg-slate-300/75'}">
    <div
        use:trapFocus
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="loss-panel-title"
        class="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl shadow-2xl
               {darkMode
                   ? 'bg-slate-900/90 border border-slate-700/60'
                   : 'bg-white/95 border border-slate-200/60'}"
    >
        <div class="text-4xl mb-2" aria-hidden="true">💔</div>
        <p id="loss-panel-title" class="text-2xl font-extrabold text-red-500 tracking-tight">Game Over</p>
        <p class="text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">
            {arrowsLeft} arrows left
        </p>
        <button
            onclick={onTryAgain}
            class="w-full px-8 py-3 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-95
                   text-white font-bold text-lg shadow-lg shadow-red-900/50 transition-all duration-150"
        >↺ Try Again</button>
        <button
            onclick={onMenu}
            class="px-6 py-2 rounded-xl active:scale-95 text-sm font-medium border transition-all duration-150
                   {darkMode
                       ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
                       : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'}"
        >← Main Menu</button>
    </div>
</div>
