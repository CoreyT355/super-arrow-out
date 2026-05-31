<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { MAX_LIVES } from '$lib/constants/game';
    import type { ResumeData } from '$lib/stores/resume.svelte';

    // The "Resume Puzzle" card on the start menu. Shows the saved puzzle's
    // difficulty label, remaining arrows, and lives. Single onclick →
    // hands back to the parent which actually restores the level.

    interface Props {
        resume:    ResumeData;
        onResume: () => void;
    }
    let { resume, onResume }: Props = $props();

    const darkMode  = $derived(settings.darkMode);
    const remaining = $derived(resume.totalArrows - resume.removedIds.length);
</script>

<button
    onclick={onResume}
    class="flex items-center gap-4 py-4 px-5 rounded-2xl border-2 transition-all duration-150
           hover:scale-[1.02] active:scale-[0.98]
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
           {darkMode
               ? 'bg-emerald-950/60 border-emerald-700 hover:bg-emerald-900/70'
               : 'bg-emerald-50 border-emerald-400 hover:bg-emerald-100'}"
>
    <!-- Play icon -->
    <span class="shrink-0 flex items-center justify-center w-10 h-10 rounded-full
                 {darkMode ? 'bg-emerald-700' : 'bg-emerald-500'}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
            <polygon points="3,1 13,7 3,13"/>
        </svg>
    </span>
    <div class="flex flex-col items-start flex-1 min-w-0">
        <div class="flex items-center justify-between w-full">
            <span class="font-bold text-base {darkMode ? 'text-emerald-300' : 'text-emerald-700'}">
                Resume Puzzle
            </span>
            <!-- Lives remaining -->
            <div class="flex gap-0.5" aria-label="{resume.lives} lives remaining">
                {#each Array(MAX_LIVES) as _, i}
                    <span class="text-base {i < resume.lives
                        ? (darkMode ? 'text-red-400' : 'text-red-500')
                        : (darkMode ? 'text-slate-700' : 'text-slate-300')}">
                        {i < resume.lives ? '♥' : '♡'}
                    </span>
                {/each}
            </div>
        </div>
        <span class="text-sm {darkMode ? 'text-emerald-500' : 'text-emerald-600'}">
            {resume.difficulty ?? 'Custom'} · {remaining} arrow{remaining === 1 ? '' : 's'} left
        </span>
    </div>
</button>
