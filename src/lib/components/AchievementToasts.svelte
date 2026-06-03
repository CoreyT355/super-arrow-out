<script lang="ts">
    import { fly } from 'svelte/transition';
    import { settings } from '$lib/stores/settings.svelte';
    import { achievementToasts } from '$lib/stores/toasts.svelte';

    // App-root overlay that renders queued achievement-unlocked toasts. Fixed to
    // the viewport so it floats above whatever screen is showing.

    interface Props { reducedMotion: boolean }
    let { reducedMotion }: Props = $props();

    const darkMode = $derived(settings.darkMode);
    const items    = $derived(achievementToasts.items);
</script>

{#if items.length > 0}
    <div
        class="pointer-events-none fixed left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4"
        style="top: calc(0.75rem + env(safe-area-inset-top))"
        role="status"
        aria-live="polite"
    >
        {#each items as toast (toast.uid)}
            <div
                transition:fly={{ y: reducedMotion ? 0 : -16, duration: reducedMotion ? 120 : 260, opacity: 0 }}
                class="w-full max-w-sm flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl border
                       {darkMode ? 'bg-slate-800/95 border-slate-700/60' : 'bg-white/95 border-slate-200'}"
            >
                <span class="text-2xl leading-none shrink-0 mt-0.5" aria-hidden="true">{toast.achievement.icon}</span>
                <div class="min-w-0">
                    <p class="text-[0.7rem] font-bold uppercase tracking-widest {darkMode ? 'text-amber-400' : 'text-amber-500'}">
                        New Achievement!
                    </p>
                    <p class="text-sm font-extrabold {darkMode ? 'text-white' : 'text-slate-900'}">{toast.achievement.title}</p>
                    <p class="text-xs mt-0.5 {darkMode ? 'text-slate-400' : 'text-slate-500'}">{toast.achievement.flavor}</p>
                </div>
            </div>
        {/each}
    </div>
{/if}
