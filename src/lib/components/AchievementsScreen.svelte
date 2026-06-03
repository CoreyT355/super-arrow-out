<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { achievements as store } from '$lib/stores/achievements.svelte';
    import { ACHIEVEMENTS } from '$lib/config/achievements';

    // Discovered-only list: locked achievements are hidden entirely so they
    // stay a surprise. We don't reveal a total count either — just how many
    // you've uncovered so far, newest first.

    interface Props { onBack: () => void }
    let { onBack }: Props = $props();

    const darkMode = $derived(settings.darkMode);
    const unlocked = $derived(store.unlocked);

    const rows = $derived(
        ACHIEVEMENTS
            .filter(a => unlocked[a.id] != null)
            .map(a => ({ id: a.id, icon: a.icon, title: a.title, flavor: a.flavor, at: unlocked[a.id] }))
            .sort((x, y) => y.at - x.at), // most recently discovered first
    );
</script>

<main class="w-full h-dvh {darkMode ? 'bg-slate-900' : 'bg-slate-100'} flex flex-col overflow-hidden">

    <!-- Top bar -->
    <div class="shrink-0 flex items-center px-4 border-b {darkMode ? 'border-slate-800/80 bg-slate-900/95' : 'border-slate-300/80 bg-slate-100/95'} backdrop-blur-sm"
         style="padding-top: env(safe-area-inset-top); min-height: calc(3rem + env(safe-area-inset-top))">
        <button
            onclick={onBack}
            class="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors
                   {darkMode
                       ? 'bg-slate-800 text-slate-400 border border-slate-700/60 hover:bg-slate-700 hover:text-slate-200'
                       : 'bg-slate-200 text-slate-600 border border-slate-300/60 hover:bg-slate-300 hover:text-slate-800'}"
        >← Back</button>
        <span class="flex-1 text-center {darkMode ? 'text-white' : 'text-slate-900'} font-bold tracking-wide">Achievements</span>
        <div class="w-[4.5rem]"></div>
    </div>

    <!-- Scrollable content -->
    <div class="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-4 px-6 py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">

        {#if rows.length === 0}
            <!-- Empty state: hint that there's something to find -->
            <div class="m-auto flex flex-col items-center text-center gap-3 max-w-xs">
                <span class="text-5xl" aria-hidden="true">🔒</span>
                <p class="text-base font-bold {darkMode ? 'text-white' : 'text-slate-900'}">Nothing discovered yet</p>
                <p class="text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">
                    Achievements unlock as you play — win games, lose a few, push your streak. The System is watching. It's always watching.
                </p>
            </div>
        {:else}
            <!-- Discovered count (no total — locked ones stay secret) -->
            <div class="w-full max-w-md flex items-center justify-between">
                <span class="text-sm font-semibold uppercase tracking-widest {darkMode ? 'text-slate-400' : 'text-slate-500'}">Discovered</span>
                <span class="text-sm font-bold tabular-nums {darkMode ? 'text-white' : 'text-slate-900'}">
                    {rows.length} {rows.length === 1 ? 'achievement' : 'achievements'}
                </span>
            </div>

            <!-- Discovered list -->
            <div class="w-full max-w-md flex flex-col gap-2">
                {#each rows as row (row.id)}
                    <div class="flex items-start gap-3 px-4 py-3 rounded-2xl border
                                {darkMode ? 'bg-slate-800 border-slate-700/60' : 'bg-white border-slate-200'}">
                        <span class="text-2xl leading-none shrink-0 mt-0.5" aria-hidden="true">{row.icon}</span>
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-bold {darkMode ? 'text-white' : 'text-slate-900'}">{row.title}</p>
                            <p class="text-xs mt-0.5 {darkMode ? 'text-slate-400' : 'text-slate-500'}">{row.flavor}</p>
                        </div>
                        <svg class="shrink-0 mt-0.5 text-emerald-500" width="20" height="20" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="Unlocked">
                            <path d="M20 6 9 17l-5-5" />
                        </svg>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</main>
