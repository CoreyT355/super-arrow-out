import type { GridPos } from '$lib/types';
import { clampPan as clampPanPure, cellAt as cellAtPure } from '$lib/utils/gestures';

// Pan / zoom Svelte action for the SVG board.
//
// The consumer creates a reactive `PanZoomState` object (use `$state({...})`)
// and passes it in. The action mutates the state's transform fields
// (`scale`, `panX`, `panY`, `containerW`, `containerH`) in response to
// touch, pointer (Apple Pencil), and wheel events — Svelte's reactivity
// then drives any UI that reads them (typically the SVG `viewBox`).
//
// Hit-testing for arrow taps is NOT done in the action; instead the
// action emits `onTap(cell)` and the consumer figures out which arrow
// (if any) owns that cell. Keeps the action ignorant of game state.

export interface PanZoomState {
    scale:      number;
    panX:       number;
    panY:       number;
    containerW: number;
    containerH: number;
    // True if the most recent gesture was a pan/pinch rather than a tap.
    // The consumer reads this in its arrow onclick handler to swallow the
    // synthetic click the browser fires at the end of a finger pan.
    didMove:    boolean;
}

export interface PanZoomParams {
    state:  PanZoomState;
    gridW:  number;
    gridH:  number;
    onTap:  (cell: GridPos) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;

// Pencil pan-vs-tap classification.
// touch-event identifiers are always >= 0, so -1 is a safe slot for pen.
const PEN_KEY = -1;
// 12px before a pencil drag counts as a pan. Touch's 4px threshold is too
// tight for Pencil — the pen's stillness varies by hand.
const PEN_MOVE_THRESHOLD = 12;
// Snap back to "fit" if the user lets go after barely zooming.
const RESET_SNAP_THRESHOLD = 1.05;

// iPad Safari fires TouchEvents AND PointerEvents for Apple Pencil
// contacts. Pencil input is handled exclusively through the pointer-event
// path, so skip stylus touches in the touch handlers to avoid the same
// physical contact corrupting our active-touch map — without this the
// pen's touch + pointer entries make the map's size jump to 2, triggering
// the pinch branch with pinchD0 = 0 and zooming the board to max.
// `touchType` is a WebKit-specific property: 'direct' = finger, 'stylus' = pen.
function isStylusTouch(t: Touch): boolean {
    return (t as Touch & { touchType?: string }).touchType === 'stylus';
}

export function panZoom(node: HTMLElement, params: PanZoomParams) {
    // These three may change between renders. The `update` callback below
    // refreshes them so the event handlers always see the latest values.
    let { state, gridW, gridH, onTap } = params;

    // Non-reactive gesture tracking — mutated freely, never drives rendering.
    const activeT  = new Map<number, { x: number; y: number }>();
    let panX0 = 0, panY0 = 0;
    let t0    = { x: 0, y: 0 };
    let pinchD0 = 0, pinchS0 = 1, pinchPX0 = 0, pinchPY0 = 0;
    let pinchMid = { x: 0, y: 0 };

    // `didMove` lives on the reactive state object so the consumer can read
    // it from its arrow `onclick` handler to swallow taps that ended a pan.

    function clampPan(px: number, py: number, s: number) {
        return clampPanPure(px, py, s, state.containerW, state.containerH);
    }

    function resetView() {
        state.scale = 1;
        state.panX  = 0;
        state.panY  = 0;
    }

    // Coordinate-based hit-testing is more reliable than
    // `document.elementFromPoint` for SVG content under transforms.
    function cellAt(clientX: number, clientY: number): GridPos | null {
        return cellAtPure(
            clientX, clientY,
            node.getBoundingClientRect(),
            state.containerW, state.containerH,
            state.panX, state.panY, state.scale,
            gridW, gridH,
        );
    }

    // ─── touch (finger) handlers ─────────────────────────────────────────

    function onTouchStart(e: TouchEvent) {
        for (const t of Array.from(e.changedTouches)) {
            if (isStylusTouch(t)) continue;
            activeT.set(t.identifier, { x: t.clientX, y: t.clientY });
        }

        if (activeT.size === 1) {
            const [t] = activeT.values();
            t0      = { ...t };
            panX0   = state.panX;
            panY0   = state.panY;
            state.didMove = false;
        } else if (activeT.size === 2) {
            const [a, b] = activeT.values();
            const rect = node.getBoundingClientRect();
            pinchD0  = Math.hypot(b.x - a.x, b.y - a.y);
            pinchS0  = state.scale;
            pinchPX0 = state.panX;
            pinchPY0 = state.panY;
            pinchMid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
        }
    }

    function onTouchMove(e: TouchEvent) {
        // Skip stylus-only moves so we don't preventDefault on pen gestures
        // the pointer-event path is handling.
        const fingerTouches = Array.from(e.changedTouches).filter(t => !isStylusTouch(t));
        if (fingerTouches.length === 0) return;
        e.preventDefault(); // must be non-passive to work; listener flag below
        for (const t of fingerTouches)
            activeT.set(t.identifier, { x: t.clientX, y: t.clientY });

        if (activeT.size === 1) {
            const [t] = activeT.values();
            const dx = t.x - t0.x, dy = t.y - t0.y;
            if (Math.hypot(dx, dy) > 4) state.didMove = true;
            if (state.didMove) {
                const c = clampPan(panX0 + dx, panY0 + dy, state.scale);
                state.panX = c.x;
                state.panY = c.y;
            }
        } else if (activeT.size >= 2) {
            const [a, b] = activeT.values();
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchS0 * d / pinchD0));
            const r = s / pinchS0;
            const c = clampPan(
                pinchMid.x - (pinchMid.x - pinchPX0) * r,
                pinchMid.y - (pinchMid.y - pinchPY0) * r,
                s,
            );
            state.scale = s;
            state.panX  = c.x;
            state.panY  = c.y;
        }
    }

    function onTouchEnd(e: TouchEvent) {
        for (const t of Array.from(e.changedTouches)) {
            if (isStylusTouch(t)) continue;
            activeT.delete(t.identifier);
        }
        if (activeT.size === 1) {
            // Dropped to 1 finger — reset single-touch pan baseline.
            const [t] = activeT.values();
            t0      = { ...t };
            panX0   = state.panX;
            panY0   = state.panY;
            state.didMove = false;
        }
        // Snap back to unzoomed if the user lifted while barely zoomed.
        if (activeT.size === 0 && state.scale < RESET_SNAP_THRESHOLD) resetView();
    }

    // ─── wheel ───────────────────────────────────────────────────────────

    function onWheel(e: WheelEvent) {
        e.preventDefault();
        const rect = node.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
        const r = s / state.scale;
        const c = clampPan(mx - (mx - state.panX) * r, my - (my - state.panY) * r, s);
        state.scale = s;
        state.panX  = c.x;
        state.panY  = c.y;
    }

    // ─── pointer (Apple Pencil) handlers ─────────────────────────────────
    // Pen is intentionally separate from touch — Pencil PointerEvents
    // carry sub-pixel coordinates and a stylus pointerType the touch path
    // can't see correctly. addEventListener (not Svelte event syntax) is
    // used here to avoid Svelte 5's event delegation, which conflicts with
    // arrow `onclick` handlers when `pointerup` is also delegated on SVG.

    function onPenDown(e: PointerEvent) {
        if (e.pointerType !== 'pen') return;
        activeT.set(PEN_KEY, { x: e.clientX, y: e.clientY });
        t0      = { x: e.clientX, y: e.clientY };
        panX0   = state.panX;
        panY0   = state.panY;
        state.didMove = false;
        try { node.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    }

    function onPenMove(e: PointerEvent) {
        if (e.pointerType !== 'pen' || !activeT.has(PEN_KEY)) return;
        activeT.set(PEN_KEY, { x: e.clientX, y: e.clientY });
        const dx = e.clientX - t0.x, dy = e.clientY - t0.y;
        if (Math.hypot(dx, dy) > PEN_MOVE_THRESHOLD) state.didMove = true;
        if (state.didMove) {
            e.preventDefault(); // suppress native scroll once we own the gesture
            const c = clampPan(panX0 + dx, panY0 + dy, state.scale);
            state.panX = c.x;
            state.panY = c.y;
        }
    }

    function onPenUp(e: PointerEvent) {
        if (e.pointerType !== 'pen' || !activeT.has(PEN_KEY)) return;
        activeT.delete(PEN_KEY);
        try { node.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        if (activeT.size === 0 && state.scale < RESET_SNAP_THRESHOLD) resetView();

        if (e.type === 'pointerup' && !state.didMove) {
            const cell = cellAt(e.clientX, e.clientY);
            if (cell) onTap(cell);
        }
    }

    // ─── ResizeObserver ──────────────────────────────────────────────────

    const ro = new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect;
        state.containerW = width;
        state.containerH = height;
    });
    ro.observe(node);

    // ─── listeners ───────────────────────────────────────────────────────
    // touchmove and pointermove are non-passive so preventDefault() can stop
    // the browser from claiming the gesture as a scroll mid-pan.

    node.addEventListener('touchstart',    onTouchStart, { passive: true  });
    node.addEventListener('touchmove',     onTouchMove,  { passive: false });
    node.addEventListener('touchend',      onTouchEnd,   { passive: true  });
    node.addEventListener('touchcancel',   onTouchEnd,   { passive: true  });
    node.addEventListener('wheel',         onWheel,      { passive: false });
    node.addEventListener('pointerdown',   onPenDown,    { passive: true  });
    node.addEventListener('pointermove',   onPenMove,    { passive: false });
    node.addEventListener('pointerup',     onPenUp,      { passive: true  });
    node.addEventListener('pointercancel', onPenUp,      { passive: true  });

    return {
        update(newParams: PanZoomParams) {
            // The state object reference should stay the same across renders
            // (the consumer holds it in a `$state` slot). gridW/gridH/onTap
            // may change between renders; refresh the closure references.
            state = newParams.state;
            gridW = newParams.gridW;
            gridH = newParams.gridH;
            onTap = newParams.onTap;
        },
        destroy() {
            ro.disconnect();
            node.removeEventListener('touchstart',    onTouchStart);
            node.removeEventListener('touchmove',     onTouchMove);
            node.removeEventListener('touchend',      onTouchEnd);
            node.removeEventListener('touchcancel',   onTouchEnd);
            node.removeEventListener('wheel',         onWheel);
            node.removeEventListener('pointerdown',   onPenDown);
            node.removeEventListener('pointermove',   onPenMove);
            node.removeEventListener('pointerup',     onPenUp);
            node.removeEventListener('pointercancel', onPenUp);
        },
    };
}
