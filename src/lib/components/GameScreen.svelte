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
    import { roundedPath, measurePath, buildFullRoute } from '$lib/utils/svgPath';
    import { checkBlocked, exitCellCount } from '$lib/utils/snakeMath';

    import { settings } from '$lib/stores/settings.svelte';
    import { progress as progressStore } from '$lib/stores/progress.svelte';
    import { resume as resumeStore } from '$lib/stores/resume.svelte';

    import { DIFFICULTIES, computeGridSize } from '$lib/config/difficulties';
    import {
        NUDGE_FWD,
        NUDGE_BACK,
        FLASH_HALF,
        EXIT_DURATION,
        EXIT_MIN_DUR,
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
        | { kind: 'new';    cells: number; square: boolean }
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

    // ─── click handler ──────────────────────────────────────────────────────
    function handleClick(id: number) {
        if (panZoomState.didMove) return;
        if (won || lives <= 0) return;
        if (anims[id] || removed.has(id)) return;
        const arrow = level.arrows.find(a => a.id === id);
        if (!arrow) return;

        const { blocked, dist } = checkBlocked(arrow, level.arrows, removed, anims, W, H);
        const t = performance.now();
        now = t;

        if (!blocked) {
            const exitCells = exitCellCount(arrow, W, H);
            const routeD    = buildFullRoute(arrow, W, H, roundedCorners);
            const snakeD    = roundedPath([...arrow.path].reverse(), roundedCorners ? 0.4 : 0);
            const L_total   = measurePath(routeD);
            const L_snake   = measurePath(snakeD);
            const totalTravel = L_snake + exitCells;
            const durationMs  = Math.max(EXIT_MIN_DUR, EXIT_DURATION * Math.min(1, totalTravel / 4));

            anims = { ...anims, [id]: {
                phase: 'exiting', startTime: t,
                routeD, L_total, L_snake, durationMs,
            } };
        } else if (reducedMotion) {
            // Skip nudge/bounce/flash entirely: apply penalty instantly.
            lives = Math.max(0, lives - 1);
            markedRed = new Set([...markedRed, id]);
        } else {
            anims = { ...anims, [id]: { phase: 'blocked-fwd', startTime: t, maxSteps: dist + 0.5 } };
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
            } else if (anim.phase === 'blocked-fwd' && el >= NUDGE_FWD) {
                next[id] = { phase: 'blocked-back', startTime: t, maxSteps: anim.maxSteps };
                dirty = true;
            } else if (anim.phase === 'blocked-back' && el >= NUDGE_BACK) {
                next[id] = { phase: 'blocked-flash', startTime: t };
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
            const { w, h } = computeGridSize(request.cells, request.square);
            if (cancelled) return;
            W = w; H = h;
            removed   = new Set();
            markedRed = new Set();
            anims     = {};
            lives     = MAX_LIVES;
            currentDifficulty = DIFFICULTIES.find(
                d => d.cells === request.cells && d.square === request.square,
            )?.label ?? null;
            const generated = await generateInWorker(w, h);
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
            level = resumeStore.puzzle ?? generateLevel(W, H);
        } else {
            level = generateLevel(W, H);
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
        level = await generateInWorker(W, H);
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
            W,
            H,
            totalArrows:  level.arrows.length,
        };
    });

    // Record a win once per session, advance the streak.
    const progress = $derived(progressStore.wins);
    const streak   = $derived(progressStore.streak);
    $effect(() => {
        if (won && !winCounted && currentDifficulty !== null) {
            winCounted = true;
            progressStore.wins = {
                ...progress,
                [currentDifficulty]: (progress[currentDifficulty] ?? 0) + 1,
            };
            progressStore.streak = {
                current: streak.current + 1,
                best:    Math.max(streak.best, streak.current + 1),
            };
        }
    });

    // Reset the streak on loss.
    $effect(() => {
        if (lost && !lostCounted) {
            lostCounted = true;
            progressStore.streak = { current: 0, best: streak.best };
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
