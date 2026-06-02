<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { progress as progressStore } from '$lib/stores/progress.svelte';
    import { ENABLED_DIFFICULTIES } from '$lib/config/difficulties';
    import { NON_CLASSIC_SHAPES } from '$lib/config/shapes';
    import { parseWinKey, winsForDifficulty } from '$lib/utils/winKey';

    // Stats screen: streak cards, donut chart, per-difficulty breakdown.
    // Read-only — the donut + legend are derived from the progress store.

    interface Props { onBack: () => void }
    let { onBack }: Props = $props();

    const darkMode = $derived(settings.darkMode);
    const progress = $derived(progressStore.wins);
    const streak   = $derived(progressStore.streak);

    // Pre-compute donut segments: each gets a start angle (0 = top) and a
    // dash length (px along the ring circumference).
    const DONUT_R = 65;
    const DONUT_C = 2 * Math.PI * DONUT_R;
    const DONUT_GAP = 2; // px cut from each segment's leading edge

    // Each difficulty's count sums wins across every shape (classic + shaped),
    // so the donut reflects total play on that difficulty.
    const chartSegments = $derived(
        (() => {
            const total = ENABLED_DIFFICULTIES.reduce((s, d) => s + winsForDifficulty(progress, d.label), 0);
            let cumFrac = 0;
            return ENABLED_DIFFICULTIES.map(d => {
                const count = winsForDifficulty(progress, d.label);
                const frac  = total > 0 ? count / total : 0;
                const angle = cumFrac * 360 - 90; // -90° → start at 12 o'clock
                const dash  = Math.max(0, frac * DONUT_C - DONUT_GAP);
                cumFrac += frac;
                return { ...d, count, frac, total, angle, dash };
            });
        })()
    );

    const totalWins = $derived(ENABLED_DIFFICULTIES.reduce((s, d) => s + winsForDifficulty(progress, d.label), 0));

    // Per-shape totals (summed across difficulties), for the shape breakdown.
    // Only shapes with at least one win are shown.
    const shapeSegments = $derived(
        NON_CLASSIC_SHAPES
            .map(shape => {
                const count = Object.entries(progress)
                    .filter(([key]) => parseWinKey(key).shapeId === shape.id)
                    .reduce((s, [, n]) => s + n, 0);
                return { shape, count };
            })
            .filter(seg => seg.count > 0)
    );

    // Single-string label of the donut for screen-reader users.
    const donutLabel = $derived.by(() => {
        if (totalWins === 0) return 'Win breakdown: no wins yet';
        const parts = ENABLED_DIFFICULTIES
            .map(d => `${d.label} ${winsForDifficulty(progress, d.label)}`)
            .join(', ');
        return `Win breakdown: ${totalWins} total. ${parts}`;
    });
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
        <span class="flex-1 text-center {darkMode ? 'text-white' : 'text-slate-900'} font-bold tracking-wide">Stats</span>
        <div class="w-[4.5rem]"></div>
    </div>

    <!-- Scrollable content -->
    <div class="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-8 px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">

        <!-- Win Streak -->
        <div class="w-full max-w-xs flex gap-3">
            <div class="flex-1 flex flex-col items-center gap-1 py-4 rounded-2xl
                        {darkMode ? 'bg-slate-800 border border-slate-700/60' : 'bg-white border border-slate-200'}">
                <span class="text-3xl font-extrabold {streak.current > 0 ? 'text-emerald-400' : darkMode ? 'text-slate-500' : 'text-slate-400'}">
                    {streak.current}
                </span>
                <span class="text-xs uppercase tracking-widest {darkMode ? 'text-slate-400' : 'text-slate-500'}">Current</span>
            </div>
            <div class="flex-1 flex flex-col items-center gap-1 py-4 rounded-2xl
                        {darkMode ? 'bg-slate-800 border border-slate-700/60' : 'bg-white border border-slate-200'}">
                <span class="text-3xl font-extrabold {streak.best > 0 ? (darkMode ? 'text-amber-400' : 'text-amber-500') : darkMode ? 'text-slate-500' : 'text-slate-400'}">
                    {streak.best}
                </span>
                <span class="text-xs uppercase tracking-widest {darkMode ? 'text-slate-400' : 'text-slate-500'}">Best</span>
            </div>
        </div>
        <p class="text-xs {darkMode ? 'text-slate-400' : 'text-slate-500'} -mt-5 tracking-wide uppercase">Win Streak</p>

        <!-- Donut chart -->
        <svg
            viewBox="0 0 200 200"
            width="220"
            height="220"
            style="overflow:visible"
            role="img"
            aria-label={donutLabel}
        >
            <circle cx="100" cy="100" r={DONUT_R} fill="none"
                stroke={darkMode ? 'rgba(51,65,85,0.5)' : 'rgba(203,213,225,0.8)'}
                stroke-width="28" />

            {#if totalWins > 0}
                {#each chartSegments as seg}
                    {#if seg.frac > 0}
                        <circle
                            cx="100" cy="100" r={DONUT_R}
                            fill="none"
                            stroke={seg.chartColor}
                            stroke-width="28"
                            stroke-dasharray="{seg.dash} {DONUT_C}"
                            transform="rotate({seg.angle}, 100, 100)"
                            stroke-linecap="butt"
                        />
                    {/if}
                {/each}
            {/if}

            {#if totalWins === 0}
                <text x="100" y="100" text-anchor="middle" dominant-baseline="middle"
                    font-size="13" fill={darkMode ? 'rgb(100,116,139)' : 'rgb(148,163,184)'}>No wins yet</text>
            {:else}
                <text x="100" y="90" text-anchor="middle" dominant-baseline="middle"
                    font-size="36" font-weight="800" fill={darkMode ? 'white' : 'rgb(15,23,42)'}>{totalWins}</text>
                <text x="100" y="116" text-anchor="middle" dominant-baseline="middle"
                    font-size="12" fill={darkMode ? 'rgb(100,116,139)' : 'rgb(100,116,139)'} letter-spacing="1">
                    {totalWins === 1 ? 'TOTAL WIN' : 'TOTAL WINS'}
                </text>
            {/if}
        </svg>

        <!-- Breakdown legend -->
        <div class="w-full max-w-xs flex flex-col {darkMode ? 'divide-slate-800/60' : 'divide-slate-300/60'} divide-y">
            {#each chartSegments as seg}
                <div class="flex items-center gap-3 py-3">
                    <div class="w-3 h-3 rounded-full shrink-0" style="background:{seg.chartColor}"></div>
                    <span class="{darkMode ? 'text-slate-300' : 'text-slate-700'} flex-1 text-sm font-medium">{seg.label}</span>
                    <span class="{darkMode ? 'text-white' : 'text-slate-900'} font-bold tabular-nums w-8 text-right">{seg.count}</span>
                    <span class="{darkMode ? 'text-slate-500' : 'text-slate-400'} text-sm tabular-nums w-10 text-right">
                        {seg.total > 0 ? Math.round(seg.frac * 100) : 0}%
                    </span>
                </div>
            {/each}
        </div>

        <!-- Per-shape breakdown (only when shaped puzzles have been won) -->
        {#if shapeSegments.length > 0}
            <div class="w-full max-w-xs flex flex-col gap-1">
                <p class="text-xs {darkMode ? 'text-slate-400' : 'text-slate-500'} tracking-widest uppercase mb-1">By Shape</p>
                <div class="flex flex-col {darkMode ? 'divide-slate-800/60' : 'divide-slate-300/60'} divide-y">
                    {#each shapeSegments as seg (seg.shape.id)}
                        <div class="flex items-center gap-3 py-3">
                            <svg viewBox={seg.shape.iconViewBox} class="w-4 h-4 shrink-0" aria-hidden="true">
                                <path d={seg.shape.icon} fill={darkMode ? 'rgb(148,163,184)' : 'rgb(100,116,139)'} />
                            </svg>
                            <span class="{darkMode ? 'text-slate-300' : 'text-slate-700'} flex-1 text-sm font-medium">{seg.shape.label}</span>
                            <span class="{darkMode ? 'text-white' : 'text-slate-900'} font-bold tabular-nums w-8 text-right">{seg.count}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</main>
