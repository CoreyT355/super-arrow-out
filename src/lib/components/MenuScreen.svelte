<script lang="ts">
    import { fly } from 'svelte/transition';
    import ResumeCard from '$lib/components/ResumeCard.svelte';
    import DifficultyButton from '$lib/components/DifficultyButton.svelte';
    import SettingsPanel from '$lib/components/SettingsPanel.svelte';
    import { trapFocus } from '$lib/utils/trapFocus';
    import { settings } from '$lib/stores/settings.svelte';
    import { progress as progressStore } from '$lib/stores/progress.svelte';
    import { resume as resumeStore } from '$lib/stores/resume.svelte';
    import { visibleDifficulties } from '$lib/config/difficulties';

    // Start screen. Owns its own little menuSettingsOpen overlay; everything
    // else (Resume card, difficulty buttons, Stats link) just emits.

    interface Props {
        reducedMotion: boolean;
        onStart:      (cells: number, square: boolean) => void;
        onResume:     () => void;
        onGoToStats: () => void;
    }
    let { reducedMotion, onStart, onResume, onGoToStats }: Props = $props();

    const darkMode    = $derived(settings.darkMode);
    const progress    = $derived(progressStore.wins);
    const resumeState = $derived(resumeStore.data);

    // Difficulty list reacts to progress so secret entries (The Iron Tangle)
    // appear as soon as their unlock condition (a Ludicrous win) is met.
    const difficulties = $derived(visibleDifficulties(progress));

    let menuSettingsOpen = $state(false);
</script>

<main class="relative w-full h-dvh {darkMode ? 'bg-slate-900' : 'bg-slate-100'} flex flex-col p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      style="padding-top: max(1.5rem, env(safe-area-inset-top))">

    <!-- Top row: centered title with gear button right-aligned -->
    <div class="relative flex items-center justify-center shrink-0 h-11" inert={menuSettingsOpen}>
        <h1 class="text-3xl md:text-5xl font-extrabold {darkMode ? 'text-white' : 'text-slate-900'} tracking-tight">Super Arrow Out</h1>
        <button
            onclick={() => (menuSettingsOpen = true)}
            class="absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center w-11 h-11 rounded-lg transition-colors
                   {darkMode
                       ? 'bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white'
                       : 'bg-slate-300 text-slate-800 hover:bg-slate-400 hover:text-slate-900'}"
            aria-label="Settings"
        >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/>
                <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
            </svg>
        </button>
    </div>

    <!-- Centered content — overflow-y-auto + my-auto keeps items centred when
         they fit and lets them scroll when they don't (e.g. many difficulty
         buttons on a short screen). -->
    <div class="flex-1 flex flex-col items-center overflow-y-auto" inert={menuSettingsOpen}>
        <div class="my-auto flex flex-col items-center gap-6 w-full py-4">
            <div class="flex flex-col gap-4 w-full max-w-xs">
                {#if resumeState}
                    <ResumeCard resume={resumeState} onResume={onResume} />
                {/if}

                {#each difficulties as d}
                    <DifficultyButton
                        difficulty={d}
                        wins={progress[d.label] ?? 0}
                        onStart={() => onStart(d.cells, d.square)}
                    />
                {/each}
            </div>
        </div>
    </div>

    <!-- Stats button pinned to the bottom -->
    <div class="shrink-0 flex justify-center pb-1" inert={menuSettingsOpen}>
        <button
            onclick={onGoToStats}
            class="{darkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'} text-sm transition-colors flex items-center gap-1.5"
        >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="7" width="3" height="6" rx="0.5"/>
                <rect x="5.5" y="4" width="3" height="9" rx="0.5"/>
                <rect x="10" y="1" width="3" height="12" rx="0.5"/>
            </svg>
            Stats
        </button>
    </div>

    <!-- Settings overlay (outside the inert page chrome) -->
    {#if menuSettingsOpen}
        <button
            class="absolute inset-0 z-40 {darkMode ? 'bg-slate-950/50' : 'bg-slate-400/40'}"
            onclick={() => (menuSettingsOpen = false)}
            tabindex="-1"
            aria-hidden="true"
        ></button>
        <div
            use:trapFocus={{ onClose: () => (menuSettingsOpen = false) }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-settings-title"
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-72 flex flex-col gap-1 p-5 rounded-2xl shadow-2xl
                   {darkMode
                       ? 'bg-slate-800 border border-slate-700/60'
                       : 'bg-white border border-slate-200'}"
            transition:fly={{ y: reducedMotion ? 0 : 8, duration: reducedMotion ? 120 : 180, opacity: 0 }}
        >
            <!-- Header row: title + explicit close button. The gear that
                 opened this dialog is inert while the dialog is open, so
                 keyboard and SR users need a dismissal target inside. -->
            <div class="flex items-center justify-between mb-2">
                <p id="menu-settings-title" class="text-sm font-semibold {darkMode ? 'text-slate-300' : 'text-slate-600'} tracking-wide uppercase">Settings</p>
                <button
                    onclick={() => (menuSettingsOpen = false)}
                    aria-label="Close settings"
                    class="flex items-center justify-center w-11 h-11 -mr-2 rounded-lg transition-colors
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
                           {darkMode
                               ? 'text-slate-400 hover:bg-slate-700 hover:text-white'
                               : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}"
                >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                        <line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
                    </svg>
                </button>
            </div>

            <SettingsPanel />

            <div class="my-1 border-t {darkMode ? 'border-slate-700/60' : 'border-slate-200'}"></div>

            <button
                onclick={() => { menuSettingsOpen = false; onGoToStats(); }}
                class="flex items-center justify-between w-full px-1 py-2 rounded-lg transition-colors
                       {darkMode ? 'text-slate-200 hover:text-white' : 'text-slate-700 hover:text-slate-900'}"
            >
                <span class="flex items-center gap-2 text-sm">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="1" y="7" width="3" height="6" rx="0.5"/>
                        <rect x="5.5" y="4" width="3" height="9" rx="0.5"/>
                        <rect x="10" y="1" width="3" height="12" rx="0.5"/>
                    </svg>
                    Stats
                </span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="opacity-40">
                    <polyline points="5,3 9,7 5,11"/>
                </svg>
            </button>
        </div>
    {/if}
</main>
