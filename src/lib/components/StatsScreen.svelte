<script lang="ts">
    import { settings } from '$lib/stores/settings.svelte';
    import { progress as progressStore } from '$lib/stores/progress.svelte';
    import { ENABLED_DIFFICULTIES } from '$lib/config/difficulties';
    import { NON_CLASSIC_SHAPES } from '$lib/config/shapes';
    import { parseWinKey, winsForDifficulty } from '$lib/utils/winKey';

    // Stats screen: a global win-streak header, then two tabs the user can
    // click or swipe between — a per-difficulty breakdown and a per-shape
    // breakdown. Each tab is a donut + legend derived from the progress store.

    interface Props {
        reducedMotion: boolean;
        onBack: () => void;
    }
    let { reducedMotion, onBack }: Props = $props();

    const darkMode = $derived(settings.darkMode);
    const progress = $derived(progressStore.wins);
    const streak   = $derived(progressStore.streak);

    // Donut geometry: each segment gets a start angle (0 = 12 o'clock) and a
    // dash length (px along the ring circumference).
    const DONUT_R = 65;
    const DONUT_C = 2 * Math.PI * DONUT_R;
    const DONUT_GAP = 2; // px cut from each segment's leading edge

    interface Segment {
        key: string;
        label: string;
        color: string;
        icon?: string;        // shape chip path (legend shows an icon, not a dot)
        iconViewBox?: string;
        count: number;
        frac: number;
        total: number;
        angle: number;
        dash: number;
    }

    /** Lay a list of {key,label,color,count,...} out as donut segments. */
    function toSegments(
        rows: Array<{ key: string; label: string; color: string; count: number; icon?: string; iconViewBox?: string }>,
    ): Segment[] {
        const total = rows.reduce((s, r) => s + r.count, 0);
        let cumFrac = 0;
        return rows.map(r => {
            const frac  = total > 0 ? r.count / total : 0;
            const angle = cumFrac * 360 - 90;
            const dash  = Math.max(0, frac * DONUT_C - DONUT_GAP);
            cumFrac += frac;
            return { ...r, frac, total, angle, dash };
        });
    }

    // ── Difficulty breakdown (counts sum across shapes) ──────────────────────
    const diffSegments = $derived(
        toSegments(ENABLED_DIFFICULTIES.map(d => ({
            key:   d.label,
            label: d.label,
            color: d.chartColor,
            count: winsForDifficulty(progress, d.label),
        }))),
    );
    const diffTotal = $derived(diffSegments.reduce((s, x) => s + x.count, 0));

    // ── Shape breakdown (counts sum across difficulties) ─────────────────────
    // Shapes have no chartColor, so assign a stable palette by catalog order.
    const SHAPE_COLORS = [
        '#f43f5e', '#f59e0b', '#10b981', '#3b82f6',
        '#a855f7', '#ec4899', '#14b8a6', '#eab308',
    ];
    const shapeSegments = $derived(
        toSegments(
            NON_CLASSIC_SHAPES.map((shape, i) => ({
                key:         shape.id,
                label:       shape.label,
                color:       SHAPE_COLORS[i % SHAPE_COLORS.length],
                icon:        shape.icon,
                iconViewBox: shape.iconViewBox,
                count: Object.entries(progress)
                    .filter(([key]) => parseWinKey(key).shapeId === shape.id)
                    .reduce((s, [, n]) => s + n, 0),
            }))
            .filter(r => r.count > 0),
        ),
    );
    const shapeTotal = $derived(shapeSegments.reduce((s, x) => s + x.count, 0));

    function srLabel(name: string, total: number, segs: Segment[]): string {
        if (total === 0) return `${name}: no wins yet`;
        const parts = segs.filter(s => s.count > 0).map(s => `${s.label} ${s.count}`).join(', ');
        return `${name}: ${total} total. ${parts}`;
    }

    // ── Tabs (click or swipe) ────────────────────────────────────────────────
    const TABS = ['Difficulties', 'Shapes'];
    let activeTab = $state(0);

    // Horizontal drag-to-swipe. touch-action: pan-y lets vertical scroll stay
    // native; we only claim the gesture once it's clearly horizontal.
    let dragX     = $state(0);
    let dragging  = $state(false);
    let decided   = false;     // has this gesture been classed horizontal/vertical?
    let startX    = 0;
    let startY    = 0;
    let trackW    = 1;

    function onPointerDown(e: PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging = true; decided = false; dragX = 0;
        startX = e.clientX; startY = e.clientY;
        trackW = (e.currentTarget as HTMLElement).clientWidth || 1;
    }
    function onPointerMove(e: PointerEvent) {
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (!decided) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            decided = true;
            if (Math.abs(dx) <= Math.abs(dy)) { dragging = false; return; } // vertical → scroll
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        // Resist dragging past the first / last tab.
        const atEdge = (activeTab === 0 && dx > 0) || (activeTab === TABS.length - 1 && dx < 0);
        dragX = atEdge ? dx * 0.3 : dx;
    }
    function onPointerUp() {
        if (!dragging) return;
        dragging = false;
        const threshold = Math.min(80, trackW * 0.2);
        if (dragX <= -threshold && activeTab < TABS.length - 1) activeTab++;
        else if (dragX >= threshold && activeTab > 0) activeTab--;
        dragX = 0;
    }

    function onTablistKeydown(e: KeyboardEvent) {
        if (e.key === 'ArrowRight' && activeTab < TABS.length - 1) { activeTab++; e.preventDefault(); }
        else if (e.key === 'ArrowLeft' && activeTab > 0) { activeTab--; e.preventDefault(); }
    }

    const trackStyle = $derived(
        `transform: translateX(calc(${-activeTab * 100}% + ${dragX}px));`
        + ` transition: ${dragging || reducedMotion ? 'none' : 'transform 250ms ease'};`,
    );
</script>

{#snippet donut(segments: Segment[], total: number, ariaLabel: string)}
    <svg
        viewBox="0 0 200 200" width="200" height="200" style="overflow:visible"
        role="img" aria-label={ariaLabel}
    >
        <circle cx="100" cy="100" r={DONUT_R} fill="none"
            stroke={darkMode ? 'rgba(51,65,85,0.5)' : 'rgba(203,213,225,0.8)'}
            stroke-width="28" />

        {#if total > 0}
            {#each segments as seg (seg.key)}
                {#if seg.frac > 0}
                    <circle
                        cx="100" cy="100" r={DONUT_R}
                        fill="none"
                        stroke={seg.color}
                        stroke-width="28"
                        stroke-dasharray="{seg.dash} {DONUT_C}"
                        transform="rotate({seg.angle}, 100, 100)"
                        stroke-linecap="butt"
                    />
                {/if}
            {/each}
            <text x="100" y="90" text-anchor="middle" dominant-baseline="middle"
                font-size="36" font-weight="800" fill={darkMode ? 'white' : 'rgb(15,23,42)'}>{total}</text>
            <text x="100" y="116" text-anchor="middle" dominant-baseline="middle"
                font-size="12" fill="rgb(100,116,139)" letter-spacing="1">
                {total === 1 ? 'TOTAL WIN' : 'TOTAL WINS'}
            </text>
        {:else}
            <text x="100" y="100" text-anchor="middle" dominant-baseline="middle"
                font-size="13" fill={darkMode ? 'rgb(100,116,139)' : 'rgb(148,163,184)'}>No wins yet</text>
        {/if}
    </svg>
{/snippet}

{#snippet legend(segments: Segment[])}
    <div class="w-full max-w-xs flex flex-col {darkMode ? 'divide-slate-800/60' : 'divide-slate-300/60'} divide-y">
        {#each segments as seg (seg.key)}
            <div class="flex items-center gap-3 py-3">
                {#if seg.icon}
                    <svg viewBox={seg.iconViewBox} class="w-4 h-4 shrink-0" aria-hidden="true">
                        <path d={seg.icon} fill={seg.color} />
                    </svg>
                {:else}
                    <div class="w-3 h-3 rounded-full shrink-0" style="background:{seg.color}"></div>
                {/if}
                <span class="{darkMode ? 'text-slate-300' : 'text-slate-700'} flex-1 text-sm font-medium">{seg.label}</span>
                <span class="{darkMode ? 'text-white' : 'text-slate-900'} font-bold tabular-nums w-8 text-right">{seg.count}</span>
                <span class="{darkMode ? 'text-slate-500' : 'text-slate-400'} text-sm tabular-nums w-10 text-right">
                    {seg.total > 0 ? Math.round(seg.frac * 100) : 0}%
                </span>
            </div>
        {/each}
    </div>
{/snippet}

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

    <!-- Win Streak (global, above the tabs) -->
    <div class="shrink-0 flex flex-col items-center gap-2 px-6 pt-6 pb-4">
        <div class="w-full max-w-xs flex gap-3">
            <div class="flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl
                        {darkMode ? 'bg-slate-800 border border-slate-700/60' : 'bg-white border border-slate-200'}">
                <span class="text-2xl font-extrabold {streak.current > 0 ? 'text-emerald-400' : darkMode ? 'text-slate-500' : 'text-slate-400'}">
                    {streak.current}
                </span>
                <span class="text-[0.65rem] uppercase tracking-widest {darkMode ? 'text-slate-400' : 'text-slate-500'}">Current</span>
            </div>
            <div class="flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl
                        {darkMode ? 'bg-slate-800 border border-slate-700/60' : 'bg-white border border-slate-200'}">
                <span class="text-2xl font-extrabold {streak.best > 0 ? (darkMode ? 'text-amber-400' : 'text-amber-500') : darkMode ? 'text-slate-500' : 'text-slate-400'}">
                    {streak.best}
                </span>
                <span class="text-[0.65rem] uppercase tracking-widest {darkMode ? 'text-slate-400' : 'text-slate-500'}">Best</span>
            </div>
        </div>
        <p class="text-xs {darkMode ? 'text-slate-400' : 'text-slate-500'} tracking-wide uppercase">Win Streak</p>
    </div>

    <!-- Tab bar: underline tabs, each sized to its label -->
    <div
        role="tablist"
        aria-label="Stats breakdown"
        tabindex="0"
        onkeydown={onTablistKeydown}
        class="shrink-0 flex justify-center gap-6 px-6 mb-1 border-b {darkMode ? 'border-slate-800' : 'border-slate-300/70'}"
    >
        {#each TABS as tab, i}
            <button
                role="tab"
                id="stats-tab-{i}"
                aria-selected={activeTab === i}
                aria-controls="stats-panel-{i}"
                onclick={() => (activeTab = i)}
                class="px-3 py-2.5 -mb-px text-sm font-semibold border-b-2 transition-colors
                       {activeTab === i
                           ? (darkMode ? 'border-sky-400 text-white' : 'border-sky-500 text-slate-900')
                           : (darkMode ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-500 hover:text-slate-700')}"
            >{tab}</button>
        {/each}
    </div>

    <!-- Swipeable panels -->
    <div class="relative flex-1 min-h-0 overflow-hidden">
        <!-- Swipe affordance: points to the other page, vertically centered.
             Right on the first page, left on the second. Also tappable. -->
        <div
            class="pointer-events-none absolute inset-y-0 z-10 flex items-center
                   {activeTab === 0 ? 'right-0' : 'left-0'}"
        >
            <button
                type="button"
                onclick={() => (activeTab = activeTab === 0 ? 1 : 0)}
                aria-label={activeTab === 0 ? 'Next: Shapes' : 'Previous: Difficulties'}
                class="pointer-events-auto mx-3 flex items-center justify-center w-10 h-10 rounded-full
                       border transition-colors {reducedMotion ? '' : (activeTab === 0 ? 'bob-r' : 'bob-l')}
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500
                       {darkMode
                           ? 'border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-700 hover:text-white'
                           : 'border-slate-300 bg-white/80 text-slate-500 hover:bg-slate-100 hover:text-slate-800'}"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
                     aria-hidden="true">
                    {#if activeTab === 0}
                        <path d="M5 12h14M13 6l6 6-6 6" />
                    {:else}
                        <path d="M19 12H5M11 6l-6 6 6 6" />
                    {/if}
                </svg>
            </button>
        </div>

        <!-- Gesture surface only; the tab buttons above are the a11y controls. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="flex h-full"
            style="{trackStyle} touch-action: pan-y;"
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={onPointerUp}
        >
            <!-- Tab 0: Difficulties -->
            <div
                role="tabpanel" id="stats-panel-0" aria-labelledby="stats-tab-0"
                class="w-full shrink-0 h-full overflow-y-auto flex flex-col items-center gap-6 px-6 py-6
                       pb-[max(2rem,env(safe-area-inset-bottom))]"
            >
                {@render donut(diffSegments, diffTotal, srLabel('Wins by difficulty', diffTotal, diffSegments))}
                {@render legend(diffSegments)}
            </div>

            <!-- Tab 1: Shapes -->
            <div
                role="tabpanel" id="stats-panel-1" aria-labelledby="stats-tab-1"
                class="w-full shrink-0 h-full overflow-y-auto flex flex-col items-center gap-6 px-6 py-6
                       pb-[max(2rem,env(safe-area-inset-bottom))]"
            >
                {@render donut(shapeSegments, shapeTotal, srLabel('Wins by shape', shapeTotal, shapeSegments))}
                {#if shapeTotal > 0}
                    {@render legend(shapeSegments)}
                {:else}
                    <p class="max-w-xs text-center text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">
                        No shaped wins yet. Win a puzzle on any shape (heart, D20, etc.) to see it here.
                    </p>
                {/if}
            </div>
        </div>
    </div>
</main>

<style>
    /* Gentle nudge in the arrow's direction to hint the swipe gesture. */
    @keyframes bob-right { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(4px); } }
    @keyframes bob-left  { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-4px); } }
    .bob-r { animation: bob-right 1.4s ease-in-out infinite; }
    .bob-l { animation: bob-left  1.4s ease-in-out infinite; }
</style>
