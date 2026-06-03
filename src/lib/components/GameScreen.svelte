<script lang="ts">
    import { tick, onMount } from 'svelte';
    import { fly } from 'svelte/transition';
    import type { GridPos, Level, Anim } from '$lib/types';

    import Board from '$lib/components/Board.svelte';
    import TopBar from '$lib/components/TopBar.svelte';
    import SettingsPanel from '$lib/components/SettingsPanel.svelte';
    import WinOverlay from '$lib/components/WinOverlay.svelte';
    import LoseOverlay from '$lib/components/LoseOverlay.svelte';

    import { trapFocus } from '$lib/utils/trapFocus';
    import { generateLevel } from '$lib/utils/puzzleGenerator';
    import { generateInWorker } from '$lib/workers/workerBridge';
    import { roundedPath, measurePath, buildFullRoute, buildBlockedRoute, drainDurationMs, BLOCKED_BACK_EXT } from '$lib/utils/svgPath';
    import { checkBlocked } from '$lib/utils/snakeMath';

    import { settings } from '$lib/stores/settings.svelte';
    import { progress as progressStore } from '$lib/stores/progress.svelte';
import { winKey, winsForDifficulty } from '$lib/utils/winKey';
import { unlockAchievements } from '$lib/stores/achievements.svelte';
import { showAchievementToasts } from '$lib/stores/toasts.svelte';
import { type AchievementStats } from '$lib/config/achievements';
    import { resume as resumeStore } from '$lib/stores/resume.svelte';

    import { DIFFICULTIES, computeGridSize } from '$lib/config/difficulties';
    import { shapeById, rasterizeShape, computeShapedGridSize, shapePathInGrid } from '$lib/config/shapes';
    import {
        BOUNCE_MS,
        FLASH_HALF,
        VORTEX_DURATION,
    } from '$lib/constants/timing';
    import { COLORS_DARK, COLORS_LIGHT } from '$lib/constants/theme';
    import { MAX_LIVES } from '$lib/constants/game';

    import { panZoom, type PanZoomState } from '$lib/actions/panZoom.svelte';

    // ─── boot request ───────────────────────────────────────────────────────
    //
    // The parent router tells GameScreen what to load by passing one of two
    // requests. The component processes it once on mount, then runs as a
    // self-contained game session until the user navigates back.

    type StartRequest =
        | { kind: 'new';    cells: number; square: boolean; shape?: string }
        | { kind: 'resume' };

    interface Props {
        request:      StartRequest;
        reducedMotion: boolean;
        onBackToMenu: () => void;
    }
    let { request, reducedMotion, onBackToMenu }: Props = $props();

    // ─── settings aliases ───────────────────────────────────────────────────
    const showGrid       = $derived(settings.showGrid);
    const roundedCorners = $derived(settings.roundedCorners);
    const darkMode       = $derived(settings.darkMode);
    const winAnimation   = $derived(settings.winAnimation);

    // ─── runtime game state ─────────────────────────────────────────────────
    // Everything below is local to the game session — leaving and returning
    // to this screen unmounts and remounts it, which resets these to defaults.
    let W = $state(9);
    let H = $state(9);
    let level             = $state<Level>({ width: 9, height: 9, arrows: [] });
    let removed           = $state(new Set<number>());
    let markedRed         = $state(new Set<number>());
    let anims             = $state<Record<number, Anim>>({});
    let now               = $state(performance.now());
    let lives             = $state(MAX_LIVES);
    let currentDifficulty = $state<string | null>(null);
    let currentShape      = $state<string | null>(null); // shape id; null = classic
    let mask              = $state<boolean[] | null>(null); // in-shape mask (null = classic)
    let winCounted        = false; // plain bool — fires once per game session
    let lostCounted       = false; // same
    let rafId: number | null = null;

    let menuOpen     = $state(false);
    let showLoading  = $state(true); // shown during initial generate/resume
    let regenerating = $state(false);

    // SVG path refs keyed by arrow id, used by Board's drain branch via
    // bind:this and by us to delete on drain completion. The same proxy is
    // shared by both writers.
    let pathRefs = $state<Record<number, SVGPathElement | null>>({});

    // ─── vortex collapse ────────────────────────────────────────────────────
    interface Particle {
        r0: number; θ0: number; color: string; size: number;
        delay: number; rotation: number; speed: number;
    }
    let vortexAnim      = $state<{ startTime: number } | null>(null);
    let vortexParticles = $state<Particle[]>([]);
    const vortexP    = $derived(vortexAnim ? Math.min(1, (now - vortexAnim.startTime) / VORTEX_DURATION) : 0);
    const shouldPlayVortex = $derived(winAnimation && !reducedMotion);
    // Stay "not done" from the moment won=true so the win panel doesn't flash
    // before the spiral starts, even if the $effect that sets vortexAnim
    // hasn't run yet.
    const vortexDone = $derived(!shouldPlayVortex || (vortexAnim !== null && vortexP >= 1));

    // ─── pan / zoom ─────────────────────────────────────────────────────────
    const panZoomState: PanZoomState = $state({
        scale: 1, panX: 0, panY: 0,
        containerW: 0, containerH: 0,
        didMove: false,
    });
    function resetView() {
        panZoomState.scale = 1;
        panZoomState.panX  = 0;
        panZoomState.panY  = 0;
    }

    // Pencil tap → arrow lookup. Same shape as the action's onTap consumer.
    function onBoardTap(cell: GridPos) {
        for (const arrow of level.arrows) {
            if (removed.has(arrow.id)) continue;
            if (arrow.path.some(p => p.x === cell.x && p.y === cell.y)) {
                handleClick(arrow.id);
                break;
            }
        }
    }

    // ─── derived render data ────────────────────────────────────────────────
    function themeColor(id: number): string {
        return (darkMode ? COLORS_DARK : COLORS_LIGHT)[id % 10];
    }
    const staticArrowData = $derived(
        Object.fromEntries(level.arrows.map(arrow => [
            arrow.id,
            { d: roundedPath(arrow.path, roundedCorners ? 0.4 : 0), head: arrow.path[0] },
        ]))
    );
    const won  = $derived(level.arrows.length > 0 && level.arrows.every(a => removed.has(a.id)));
    const lost = $derived(lives <= 0 && !won);

    // Silhouette / clip path for the current shape, in grid units. null when
    // classic (Board renders the full rectangle as today).
    const shapePathD = $derived(
        currentShape ? shapePathInGrid(shapeById(currentShape), W, H) : null,
    );

    // ─── click handler ──────────────────────────────────────────────────────
    function handleClick(id: number) {
        if (panZoomState.didMove) return;
        if (won || lives <= 0) return;
        if (anims[id] || removed.has(id)) return;
        const arrow = level.arrows.find(a => a.id === id);
        if (!arrow) return;

        const { blocked } = checkBlocked(arrow, level.arrows, removed, anims, W, H);
        const t = performance.now();
        now = t;

        if (!blocked) {
            const routeD    = buildFullRoute(arrow, W, H, roundedCorners);
            const snakeD    = roundedPath([...arrow.path].reverse(), roundedCorners ? 0.4 : 0);
            const L_total   = measurePath(routeD);
            const L_snake   = measurePath(snakeD);

            // Constant on-screen speed, ignoring off-screen travel. The snake
            // could slide `fullTravel` grid units to fully clear the GRID, but
            // anything past the visible viewport is invisible — so we cap the
            // animated slide at the on-screen distance (the visible span in the
            // exit axis, plus the on-screen part of the body). Duration is then
            // that distance ÷ a constant px/ms speed. At scale 1 the viewport is
            // the whole board, so this equals the full slide (no early cut);
            // zoomed in, the off-screen tail is "free" and drains stay snappy.
            const fullTravel  = L_total - L_snake;
            const scale       = panZoomState.scale > 0 ? panZoomState.scale : 1;
            const horizontal  = arrow.direction === 'E' || arrow.direction === 'W';
            const visibleSpan = (horizontal ? W : H) / scale;          // cells across the viewport
            const N           = arrow.path.length;
            const travel      = Math.min(fullTravel, visibleSpan + Math.min(N, visibleSpan));
            const pxPerCell   = panZoomState.containerH > 0
                ? (panZoomState.containerH / H) * scale
                : 0;
            const durationMs  = drainDurationMs(travel, pxPerCell);

            anims = { ...anims, [id]: {
                phase: 'exiting', startTime: t,
                routeD, L_total, L_snake, travel, durationMs,
            } };
        } else if (reducedMotion) {
            // Skip nudge/bounce/flash entirely: apply penalty instantly.
            lives = Math.max(0, lives - 1);
            markedRed = new Set([...markedRed, id]);
        } else {
            // Render the bounce exactly like a drain: a snake-length dash
            // sliding along a fixed, pre-rounded route. (The old per-frame
            // point recompute cut corners and didn't match an exit.)
            const routeD  = buildBlockedRoute(arrow, roundedCorners);
            const snakeD  = roundedPath([...arrow.path].reverse(), roundedCorners ? 0.4 : 0);
            const L_total = measurePath(routeD);
            const L_snake = measurePath(snakeD);
            anims = { ...anims, [id]: {
                phase: 'blocked-bounce', startTime: t,
                routeD, L_total, L_snake, restOffset: BLOCKED_BACK_EXT,
            } };
        }

        if (rafId === null) rafId = requestAnimationFrame(loop);
    }

    // ─── RAF loop ───────────────────────────────────────────────────────────
    function loop(t: number) {
        now = t;
        let next    = { ...anims };
        let nextRem = new Set(removed);
        let dirty   = false;

        for (const [sid, anim] of Object.entries(next)) {
            const id = +sid;
            const el = t - anim.startTime;

            if (anim.phase === 'exiting' && el >= (anim.durationMs ?? 0)) {
                delete next[id]; nextRem.add(id);
                delete pathRefs[id];
                dirty = true;
            } else if (anim.phase === 'blocked-bounce' && el >= BOUNCE_MS) {
                // Keep the route fields: the flash re-renders through the same
                // dash-on-route branch (held at rest), so the body must stay.
                next[id] = {
                    phase: 'blocked-flash', startTime: t,
                    routeD: anim.routeD, L_total: anim.L_total,
                    L_snake: anim.L_snake, restOffset: anim.restOffset,
                };
                lives = Math.max(0, lives - 1);
                dirty = true;
            } else if (anim.phase === 'blocked-flash' && el >= FLASH_HALF * 4) {
                delete next[id];
                markedRed = new Set([...markedRed, id]);
                dirty = true;
            }
        }
        if (dirty) { anims = next; removed = nextRem; }

        const vortexRunning = vortexAnim !== null && (t - vortexAnim.startTime) < VORTEX_DURATION;
        if (Object.keys(next).length > 0 || vortexRunning) rafId = requestAnimationFrame(loop);
        else rafId = null;
    }

    // ─── boot: process the start request ────────────────────────────────────
    //
    // Runs once after mount. Critically NOT a $effect — the boot reads
    // `resumeStore.data`/`puzzle` and writes `removed`, while the auto-save
    // effect below reads `removed` and writes `resumeStore.data`. As an
    // effect those two form a tracked cycle that Svelte aborts after a few
    // iterations, leaving the UI in a half-restored, unclickable state.
    // `onMount` is fire-once and outside the reactive graph, which breaks
    // the cycle cleanly.
    let cancelled = false;
    onMount(() => {
        (async () => {
            if (request.kind === 'resume') {
                const r = resumeStore.data;
                const saved = resumeStore.puzzle;
                if (!r || !saved || saved.width !== r.W || saved.height !== r.H) {
                    // Stale resume — bail back to the menu rather than crash.
                    resumeStore.clear();
                    onBackToMenu();
                    return;
                }
                W = r.W; H = r.H;
                currentDifficulty = r.difficulty;
                // Re-derive the mask from the saved puzzle's shape (deterministic
                // from shape id + W + H), so the silhouette/clip render on resume.
                const shapeObj = shapeById(saved.shape ?? r.shape);
                currentShape = shapeObj.polygon ? shapeObj.id : null;
                mask = shapeObj.polygon ? rasterizeShape(shapeObj, W, H) : null;
                level    = saved;
                removed  = new Set(r.removedIds);
                markedRed = new Set(r.markedRedIds);
                lives    = r.lives;
                anims    = {};
                resetView();
                showLoading = false;
                return;
            }
            // 'new'
            await tick(); // flush DOM so the loading overlay paints first
            // Both paths size to the same viewport-aware grid aspect so the
            // board rectangle fills the same on-screen area. Classic fills it
            // with cells; shaped contain-fits the (undistorted) shape inside
            // and pads the rest with out-of-shape cells, so pan/zoom still uses
            // the whole area instead of a small box.
            const shapeObj = shapeById(request.shape);
            const classic  = computeGridSize(request.cells, request.square);
            let w: number, h: number, m: boolean[] | null;
            if (shapeObj.polygon) {
                const g = computeShapedGridSize(shapeObj, request.cells, classic.w / classic.h);
                w = g.w; h = g.h; m = g.mask;
            } else {
                w = classic.w; h = classic.h; m = null;
            }
            if (cancelled) return;
            W = w; H = h;
            mask         = m;
            currentShape = shapeObj.polygon ? shapeObj.id : null;
            removed   = new Set();
            markedRed = new Set();
            anims     = {};
            lives     = MAX_LIVES;
            currentDifficulty = DIFFICULTIES.find(
                d => d.cells === request.cells && d.square === request.square,
            )?.label ?? null;
            const generated = await generateInWorker(w, h, currentShape ?? undefined, m ?? undefined);
            if (cancelled) return;
            level = generated;
            resumeStore.puzzle = generated;
            resumeStore.clear();
            resetView();
            showLoading = false;
        })();
        return () => { cancelled = true; };
    });

    // ─── in-game game-control buttons ───────────────────────────────────────
    // reuse=true  → restore the saved puzzle (Try Again after lose)
    // reuse=false → generate a fresh puzzle synchronously (New Level after win)
    function reset(reuse = false) {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        removed     = new Set();
        markedRed   = new Set();
        anims       = {};
        lives       = MAX_LIVES;
        winCounted  = false;
        lostCounted = false;
        resumeStore.clear();
        if (reuse) {
            level = resumeStore.puzzle ?? generateLevel(W, H, undefined, mask ?? undefined);
        } else {
            level = generateLevel(W, H, undefined, mask ?? undefined);
            if (currentShape) level.shape = currentShape;
            resumeStore.puzzle = level;
        }
        resetView();
    }

    async function regeneratePuzzle() {
        if (regenerating) return;
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        removed      = new Set();
        markedRed    = new Set();
        anims        = {};
        lives        = MAX_LIVES;
        winCounted   = false;
        lostCounted  = false;
        regenerating = true;
        menuOpen     = false;
        showLoading  = true;
        await tick();
        level = await generateInWorker(W, H, currentShape ?? undefined, mask ?? undefined);
        resumeStore.puzzle = level;
        resetView();
        showLoading  = false;
        regenerating = false;
    }

    function goToMenu() {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        removed   = new Set();
        markedRed = new Set();
        anims     = {};
        menuOpen  = false;
        resetView();
        onBackToMenu();
    }

    // ─── lifecycle effects ──────────────────────────────────────────────────

    // Auto-save in-progress state. Mirrors the original page-owned effect,
    // minus the gameState guard (this component only mounts during play).
    $effect(() => {
        if (won || lost) {
            resumeStore.clear();
            return;
        }
        if (removed.size === 0) return;
        resumeStore.data = {
            removedIds:   [...removed],
            markedRedIds: [...markedRed],
            lives,
            difficulty:   currentDifficulty,
            shape:        currentShape,
            W,
            H,
            totalArrows:  level.arrows.length,
        };
    });

    // Record a win once per session, advance the streak.
    const progress = $derived(progressStore.wins);
    const streak   = $derived(progressStore.streak);

    // Snapshot for achievement predicates. Reads the store directly (not the
    // $derived views) so it reflects values written earlier in the same effect.
    function currentStats(): AchievementStats {
        const wins = progressStore.wins;
        return {
            totalWins:        Object.values(wins).reduce((a, b) => a + b, 0),
            totalLosses:      progressStore.losses,
            bestStreak:       progressStore.streak.best,
            winsByDifficulty: Object.fromEntries(
                DIFFICULTIES.map(d => [d.label, winsForDifficulty(wins, d.label)]),
            ),
        };
    }

    $effect(() => {
        if (won && !winCounted && currentDifficulty !== null) {
            winCounted = true;
            const key = winKey(currentDifficulty, currentShape);
            progressStore.wins = {
                ...progress,
                [key]: (progress[key] ?? 0) + 1,
            };
            progressStore.streak = {
                current: streak.current + 1,
                best:    Math.max(streak.best, streak.current + 1),
            };
            showAchievementToasts(unlockAchievements(currentStats()));
        }
    });

    // Reset the streak on loss; tally the loss.
    $effect(() => {
        if (lost && !lostCounted) {
            lostCounted = true;
            progressStore.streak = { current: 0, best: streak.best };
            progressStore.losses = progressStore.losses + 1;
            showAchievementToasts(unlockAchievements(currentStats()));
        }
    });

    // Vortex collapse on win. Cleared on the next reset.
    $effect(() => {
        if (won && !vortexAnim && shouldPlayVortex) {
            vortexAnim = { startTime: performance.now() };
            const cx = W / 2, cy = H / 2;
            const count = Math.min(80, Math.max(24, level.arrows.length * 3));
            const palette = COLORS_DARK; // pastels pop on both light and dark
            vortexParticles = Array.from({ length: count }, (_, i) => {
                const px = Math.random() * W;
                const py = Math.random() * H;
                const dx = px - cx, dy = py - cy;
                return {
                    r0: Math.hypot(dx, dy),
                    θ0: Math.atan2(dy, dx),
                    color: palette[i % palette.length],
                    size: 0.07 + Math.random() * 0.09,
                    delay: Math.random() * 300,
                    rotation: Math.random() * 360,
                    speed: 0.35 + Math.random() * 0.65,
                };
            });
            if (rafId === null) rafId = requestAnimationFrame(loop);
        }
        if (!won) { vortexAnim = null; vortexParticles = []; }
    });
</script>

<main class="relative w-full h-dvh {darkMode ? 'bg-slate-900' : 'bg-slate-100'} flex flex-col overflow-hidden">

    <div inert={won || lost}>
        <TopBar
            {menuOpen}
            arrowsLeft={level.arrows.length - removed.size}
            {lives}
            {showLoading}
            onToggleMenu={() => (menuOpen = !menuOpen)}
        />
    </div>

    <!-- Mobile overlay menu (floats over the board, doesn't push layout) -->
    {#if menuOpen}
        <button
            class="absolute inset-0 z-30 {darkMode ? 'bg-slate-950/40' : 'bg-slate-400/30'}"
            style="top: calc(3rem + env(safe-area-inset-top))"
            onclick={() => (menuOpen = false)}
            tabindex="-1"
            aria-hidden="true"
        ></button>
        <div
            use:trapFocus={{ onClose: () => (menuOpen = false) }}
            role="dialog"
            aria-modal="true"
            aria-label="Game menu"
            class="absolute left-0 right-0 z-40 flex flex-col gap-2 p-3 border-b shadow-xl
                   {darkMode
                       ? 'bg-slate-900/95 backdrop-blur-md border-slate-700/60'
                       : 'bg-white/95 backdrop-blur-md border-slate-300/60'}"
            style="top: calc(3rem + env(safe-area-inset-top))"
            transition:fly={{ y: reducedMotion ? 0 : -6, duration: reducedMotion ? 120 : 160, opacity: 0 }}
        >
            <div class="flex gap-2">
                <button
                    onclick={() => { goToMenu(); menuOpen = false; }}
                    class="flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors
                           {darkMode
                               ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                               : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}"
                >← Main Menu</button>
                <button
                    onclick={() => lost ? (reset(true), menuOpen = false) : regeneratePuzzle()}
                    disabled={regenerating}
                    class="flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5
                           disabled:opacity-60 disabled:cursor-not-allowed
                           {lost
                               ? 'bg-red-600 text-white hover:bg-red-500'
                               : darkMode
                                   ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                   : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}"
                >
                    {#if lost}
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 7a6 6 0 1 0 1.2-3.6"/><polyline points="1 2 1 5.5 4.5 5.5"/>
                        </svg>
                        Try Again
                    {:else}
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M13 2v3.5H9.5"/><path d="M1 7a6 6 0 0 1 10.2-4.3L13 5.5"/>
                            <path d="M1 12v-3.5H4.5"/><path d="M13 7a6 6 0 0 1-10.2 4.3L1 8.5"/>
                        </svg>
                        Regenerate Puzzle
                    {/if}
                </button>
            </div>

            <SettingsPanel compact />
        </div>
    {/if}

    <!-- ── Board area — fills all remaining vertical space ─────────────────── -->
    <div class="flex-1 min-h-0 flex items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
         inert={menuOpen || won || lost}>
        <Board
            gridW={W} gridH={H}
            {level} {removed} {markedRed} {anims} {now}
            {darkMode} {showGrid} {roundedCorners}
            {shapePathD}
            {panZoomState}
            {staticArrowData}
            {themeColor}
            {vortexAnim} {vortexParticles}
            {pathRefs}
            {showLoading}
            onCellTap={onBoardTap}
            onArrowClick={handleClick}
        />
    </div>

    {#if won && vortexDone}
        <WinOverlay
            arrowCount={level.arrows.length}
            {lives}
            {reducedMotion}
            onNewLevel={() => reset(false)}
            onMenu={goToMenu}
        />
    {/if}

    {#if lost}
        <LoseOverlay
            arrowsLeft={level.arrows.length - removed.size}
            onTryAgain={() => reset(true)}
            onMenu={goToMenu}
        />
    {/if}
</main>
