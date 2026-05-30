<script lang="ts">
    import type { Arrow, GridPos, Level, Anim } from '$lib/types';
    import { roundedPath } from '$lib/utils/svgPath';
    import { computeS, isFlashRed } from '$lib/utils/animTiming';
    import { segPos } from '$lib/utils/snakeMath';
    import { DELTA, DIR_ROT } from '$lib/constants/theme';
    import { VORTEX_FADE_MS, VORTEX_SPIN_MS } from '$lib/constants/timing';
    import { panZoom, type PanZoomState } from '$lib/actions/panZoom.svelte';

    // The SVG board: grid background, arrow rendering (static vs animating
    // branches), the win-time vortex collapse, and the loading overlay.
    //
    // Pan/zoom transform state is owned by the parent (the screen needs to
    // call resetView on new puzzles) and threaded through here as a prop.
    // The action mutates panZoomState in place; the parent reads it back
    // through the same proxy.

    // 4-pointed sparkle star — cubic beziers pinch through (±0.08,±0.08)
    // between each tip. Normalized to radius 1; scaled per-particle.
    const SPARKLE_PATH =
        'M 0 -1 C 0.08 -0.08 0.08 -0.08 1 0 C 0.08 0.08 0.08 0.08 0 1 ' +
        'C -0.08 0.08 -0.08 0.08 -1 0 C -0.08 -0.08 -0.08 -0.08 0 -1 Z';

    interface Particle {
        r0: number; θ0: number; color: string; size: number;
        delay: number; rotation: number; speed: number;
    }
    interface StaticArrowDatum { d: string; head: GridPos }

    interface Props {
        // grid
        gridW: number;
        gridH: number;
        level: Level;

        // game state
        removed:   Set<number>;
        markedRed: Set<number>;
        anims:     Record<number, Anim>;
        now:       number;

        // settings
        darkMode:       boolean;
        showGrid:       boolean;
        roundedCorners: boolean;

        // pan/zoom (mutated by the action; parent reads back the same proxy)
        panZoomState: PanZoomState;

        // pre-computed per-arrow path data (idle arrows never re-render
        // during RAF ticks — only ones with an active anim do).
        staticArrowData: Record<number, StaticArrowDatum>;

        // arrow colour by id (delegated to parent so a single source of
        // truth controls dark-mode / penalty palette decisions).
        themeColor: (id: number) => string;

        // vortex win effect
        vortexAnim:      { startTime: number } | null;
        vortexParticles: Particle[];

        // SVG path element refs keyed by arrow id — used by the parent's
        // RAF tick to call getPointAtLength on the active drain animation.
        // Shared $state record: the parent's writes (delete on drain end)
        // and our `bind:this` writes both target the same proxy.
        pathRefs: Record<number, SVGPathElement | null>;

        // loading overlay during puzzle generation
        showLoading: boolean;

        // tap callbacks. onCellTap is for pen taps (action surfaces the
        // cell under the pen); onArrowClick is the finger/mouse path
        // through the arrow `<g>` onclick.
        onCellTap:    (cell: GridPos) => void;
        onArrowClick: (id: number)    => void;
    }

    let {
        gridW, gridH, level,
        removed, markedRed, anims, now,
        darkMode, showGrid, roundedCorners,
        panZoomState,
        staticArrowData,
        themeColor,
        vortexAnim, vortexParticles,
        pathRefs,
        showLoading,
        onCellTap, onArrowClick,
    }: Props = $props();

    const svgViewBox = $derived.by(() => {
        const { containerW, containerH, scale, panX, panY } = panZoomState;
        if (!containerW || !containerH) return `-0.1 -0.1 ${gridW + 0.2} ${gridH + 0.2}`;
        const vbW = (gridW + 0.2) / scale;
        const vbH = (gridH + 0.2) / scale;
        const vbX = -panX * vbW / containerW - 0.1;
        const vbY = -panY * vbH / containerH - 0.1;
        return `${vbX} ${vbY} ${vbW} ${vbH}`;
    });
</script>

<div
    style="width: min(calc(100vw - 1.5rem), calc((100dvh - 4.5rem - env(safe-area-inset-top)) * {gridW / gridH})); aspect-ratio: {gridW} / {gridH};"
    class="relative overflow-hidden rounded-xl touch-none"
    use:panZoom={{ state: panZoomState, gridW, gridH, onTap: onCellTap }}
>
    <svg
        viewBox={svgViewBox}
        preserveAspectRatio="none"
        style="width:100%;height:100%;"
        overflow="hidden"
    >
        <!-- Grid background: single SVG pattern — no per-cell rects needed.
             Rect covers exactly the grid area (0 0 W H) so the -0.1 viewBox
             border doesn't show partial tile slivers at the edges. -->
        <defs>
            <pattern id="cell-bg" x="0" y="0" width="1" height="1" patternUnits="userSpaceOnUse">
                <rect x="0.06" y="0.06" width="0.88" height="0.88" rx="0.18"
                    fill={darkMode ? 'rgba(51,65,85,0.6)' : 'rgba(203,213,225,0.8)'} />
            </pattern>
        </defs>
        {#if showGrid}
            <rect x="0" y="0" width={gridW} height={gridH} fill="url(#cell-bg)" />
        {/if}

        <!-- Arrows: split static vs animating so RAF ticks only re-render
             the 1–2 arrows that are actively sliding. -->
        {#each level.arrows as arrow (arrow.id)}
            {#if !removed.has(arrow.id)}
                {#if anims[arrow.id]}
                    {@const anim = anims[arrow.id]}
                    {#if anim.phase === 'exiting'}
                        <!-- Drain animation: snake-length dash slides along extended route via stroke-dashoffset -->
                        {@const el       = Math.max(0, now - anim.startTime)}
                        {@const p        = Math.min(1, el / (anim.durationMs ?? 1))}
                        {@const travel   = (anim.L_total ?? 0) - (anim.L_snake ?? 0)}
                        {@const offset   = -p * travel}
                        {@const headLen  = Math.min(anim.L_total ?? 0, (anim.L_snake ?? 0) + p * travel)}
                        {@const ref      = pathRefs[arrow.id]}
                        {@const headPt   = ref ? ref.getPointAtLength(headLen)
                                               : { x: arrow.path[0].x + 0.5, y: arrow.path[0].y + 0.5 }}
                        {@const aheadPt  = ref ? ref.getPointAtLength(Math.min(anim.L_total ?? 0, headLen + 0.1))
                                               : { x: headPt.x + DELTA[arrow.direction].dx, y: headPt.y + DELTA[arrow.direction].dy }}
                        {@const angle    = Math.atan2(aheadPt.y - headPt.y, aheadPt.x - headPt.x) * 180 / Math.PI}
                        {@const color    = themeColor(arrow.id)}
                        <g style="cursor:default;pointer-events:none" opacity={0.95}>
                            <path
                                bind:this={pathRefs[arrow.id]}
                                d={anim.routeD}
                                fill="none"
                                stroke={color}
                                stroke-width={0.14}
                                stroke-linecap="round"
                                stroke-linejoin={roundedCorners ? 'round' : 'miter'}
                                stroke-dasharray="{anim.L_snake} {anim.L_total}"
                                stroke-dashoffset={offset}
                            />
                            <polygon
                                points="0.32,0 -0.16,-0.24 -0.16,0.24"
                                transform="translate({headPt.x},{headPt.y}) rotate({angle})"
                                fill={color}
                            />
                        </g>
                    {:else}
                        <!-- Blocked phases: rigid-body nudge / bounce / flash -->
                        {@const d    = DELTA[arrow.direction]}
                        {@const el   = Math.max(0, now - anim.startTime)}
                        {@const s    = computeS(anim, el)}
                        {@const pts  = arrow.path.map((_, k) => segPos(arrow.path, k, s, d))}
                        {@const head = pts[0]}
                        {@const red  = isFlashRed(anim, el)}
                        {@const color = themeColor(arrow.id)}
                        <g style="cursor:default;pointer-events:none" opacity={0.95}>
                            <path
                                d={roundedPath(pts, roundedCorners ? 0.4 : 0)}
                                fill="none"
                                stroke={red ? '#ef4444' : color}
                                stroke-width={0.14}
                                stroke-linecap="round"
                                stroke-linejoin={roundedCorners ? 'round' : 'miter'}
                            />
                            <polygon
                                points="0.32,0 -0.16,-0.24 -0.16,0.24"
                                transform="translate({head.x + 0.5},{head.y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
                                fill={red ? '#ef4444' : color}
                            />
                        </g>
                    {/if}
                {:else}
                    <!-- Static branch: pre-computed paths, zero per-frame cost -->
                    {@const sd        = staticArrowData[arrow.id]}
                    {@const penalized = markedRed.has(arrow.id)}
                    {@const drawColor = penalized ? '#b91c1c' : themeColor(arrow.id)}
                    <g data-testid="arrow" data-arrow-id={arrow.id} onclick={() => onArrowClick(arrow.id)} style="cursor:pointer" opacity={0.95}>
                        {#each arrow.path as seg}
                            <rect x={seg.x} y={seg.y} width={1} height={1} fill="transparent" />
                        {/each}
                        <path
                            d={sd.d}
                            fill="none"
                            stroke={drawColor}
                            stroke-width={0.14}
                            stroke-linecap="round"
                            stroke-linejoin={roundedCorners ? 'round' : 'miter'}
                        />
                        <polygon
                            points="0.32,0 -0.16,-0.24 -0.16,0.24"
                            transform="translate({sd.head.x + 0.5},{sd.head.y + 0.5}) rotate({DIR_ROT[arrow.direction]})"
                            fill={drawColor}
                        />
                    </g>
                {/if}
            {/if}
        {/each}

        <!-- Vortex collapse — star particles spiral into the board centre on win -->
        <!-- Phase 1 (0–600ms): stars fade in from nothing, static              -->
        <!-- Phase 2 (600–2000ms): cubic ease-in spiral accelerating to centre  -->
        {#if vortexAnim}
            {@const elapsed = Math.max(0, now - vortexAnim.startTime)}
            {@const bx = gridW / 2}
            {@const by = gridH / 2}
            <!-- Global spiral progress (0→1 over phase 2) drives the bg overlay -->
            {@const spinElapsed = Math.max(0, elapsed - VORTEX_FADE_MS)}
            {@const spinP  = Math.min(1, spinElapsed / VORTEX_SPIN_MS)}
            {@const spinEP = spinP * spinP * spinP}
            <!-- Fade the board colour over the grid lines as the spiral completes -->
            <rect x="0" y="0" width={gridW} height={gridH}
                fill={darkMode ? '#0f172a' : '#f1f5f9'}
                opacity={spinEP} />
            {#each vortexParticles as pt}
                {@const lElapsed    = Math.max(0, elapsed - pt.delay)}
                <!-- Phase 1: fade in linearly over VORTEX_FADE_MS -->
                {@const fadeP       = Math.min(1, lElapsed / VORTEX_FADE_MS)}
                <!-- Phase 2: cubic ease-in spiral — each particle has its own speed -->
                {@const lSpinElapsed = Math.max(0, lElapsed - VORTEX_FADE_MS)}
                {@const lSpinP      = Math.min(1, lSpinElapsed / (VORTEX_SPIN_MS * pt.speed))}
                {@const lSpinEP     = lSpinP * lSpinP * lSpinP}
                {@const r           = pt.r0 * (1 - lSpinEP)}
                {@const θ           = pt.θ0 + lSpinEP * Math.PI * 4}
                {@const pcx         = bx + r * Math.cos(θ)}
                {@const pcy         = by + r * Math.sin(θ)}
                <!-- Slow drift during fade-in, then spin with the vortex -->
                {@const rot         = pt.rotation + fadeP * 20 + lSpinEP * 180}
                <g
                    transform="translate({pcx},{pcy}) rotate({rot}) scale({pt.size})"
                    fill={pt.color}
                    opacity={fadeP * (1 - lSpinP * lSpinP)}
                >
                    <path d={SPARKLE_PATH} />
                </g>
            {/each}
        {/if}
    </svg>

    <!-- Loading screen -->
    {#if showLoading}
        <div
            class="absolute inset-0 z-50 flex items-center justify-center {darkMode ? 'bg-slate-950/80' : 'bg-slate-300/80'} backdrop-blur-sm"
            role="status"
            aria-live="polite"
        >
            <div class="flex flex-col items-center gap-4 text-center">
                <div class="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" aria-hidden="true"></div>
                <p class="text-xl font-bold {darkMode ? 'text-white' : 'text-slate-900'}">Loading…</p>
            </div>
        </div>
    {/if}
</div>
