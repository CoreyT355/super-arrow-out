<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { achievements as store } from '$lib/stores/achievements.svelte';
    import { ACHIEVEMENTS } from '$lib/config/achievements';

    // Read-only list of every achievement with its locked / unlocked state.
    // Secret achievements stay masked ("???") until earned.

    interface Props { onBack: () => void }
    let { onBack }: Props = $props();

    const darkMode = $derived(settings.darkMode);
    const unlocked = $derived(store.unlocked);

    const rows = $derived(
        ACHIEVEMENTS.map(a => {
            const at = unlocked[a.id];
            const isUnlocked = at != null;
            const hidden = a.secret && !isUnlocked;
            return {
                id:          a.id,
                icon:        hidden ? '🔒' : a.icon,
                title:       hidden ? 'Secret achievement' : a.title,
                description: hidden ? 'Keep playing to discover this one.' : a.description,
                isUnlocked,
            };
        }),
    );
    const earned = $derived(rows.filter(r => r.isUnlocked).length);
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

        <!-- Progress summary -->
        <div class="w-full max-w-md flex items-center justify-between">
            <span class="text-sm font-semibold uppercase tracking-widest {darkMode ? 'text-slate-400' : 'text-slate-500'}">Unlocked</span>
            <span class="text-sm font-bold tabular-nums {darkMode ? 'text-white' : 'text-slate-900'}">{earned} / {rows.length}</span>
        </div>
        <div class="w-full max-w-md h-2 rounded-full overflow-hidden {darkMode ? 'bg-slate-800' : 'bg-slate-200'}">
            <div class="h-full rounded-full bg-amber-500 transition-[width] duration-300"
                 style="width: {rows.length ? (earned / rows.length) * 100 : 0}%"></div>
        </div>

        <!-- Achievement list -->
        <div class="w-full max-w-md flex flex-col gap-2 mt-2">
            {#each rows as row (row.id)}
                <div
                    class="flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors
                           {row.isUnlocked
                               ? (darkMode ? 'bg-slate-800 border-slate-700/60' : 'bg-white border-slate-200')
                               : (darkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-slate-100 border-slate-200/70')}
                           {row.isUnlocked ? '' : 'opacity-60'}"
                >
                    <span class="text-2xl leading-none shrink-0 {row.isUnlocked ? '' : 'grayscale'}" aria-hidden="true">{row.icon}</span>
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-bold truncate {darkMode ? 'text-white' : 'text-slate-900'}">{row.title}</p>
                        <p class="text-xs {darkMode ? 'text-slate-400' : 'text-slate-500'}">{row.description}</p>
                    </div>
                    {#if row.isUnlocked}
                        <svg class="shrink-0 text-emerald-500" width="20" height="20" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-label="Unlocked">
                            <path d="M20 6 9 17l-5-5" />
                        </svg>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
</main>
