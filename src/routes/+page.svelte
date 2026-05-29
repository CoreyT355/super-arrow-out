<script lang="ts">
	import { generateLevel } from '$lib/utils/puzzleGenerator';
	import { trapFocus } from '$lib/utils/trapFocus';
	import { clampPan as clampPanPure, cellAt as cellAtPure } from '$lib/utils/gestures';
	import type { Direction, GridPos, Arrow, Level } from '$lib/types';
	import { fly } from 'svelte/transition';
	import { tick } from 'svelte';
	import GeneratorWorker from '$lib/workers/puzzleGenerator.worker?worker';
	import { settings } from '$lib/stores/settings.svelte';
	import { progress as progressStore } from '$lib/stores/progress.svelte';
	import { resume as resumeStore, type ResumeData } from '$lib/stores/resume.svelte';

	// ─── difficulty config ───────────────────────────────────────────────────────

	// cells: target cell count for adaptive grids; square: always use equal W/H
	const DIFFICULTIES = [
		{ label: 'Easy',       cells:    36, square: true,  color: 'from-emerald-500 to-emerald-600', ring: 'ring-emerald-400', chartColor: '#10b981', hidden: false },
		{ label: 'Normal',     cells:    81, square: true,  color: 'from-sky-500 to-sky-600',         ring: 'ring-sky-400',     chartColor: '#0ea5e9', hidden: false },
		{ label: 'Hard',       cells:   256, square: false, color: 'from-violet-500 to-violet-600',   ring: 'ring-violet-400',  chartColor: '#8b5cf6', hidden: false },
		{ label: 'Super Hard', cells:  1024, square: false, color: 'from-orange-500 to-orange-600',   ring: 'ring-orange-400',  chartColor: '#f97316', hidden: false },
		{ label: 'Expert',     cells:  4096, square: false, color: 'from-rose-600 to-rose-700',       ring: 'ring-rose-400',    chartColor: '#e11d48', hidden: false },
		{ label: 'Ludicrous', cells: 16384, square: false, color: 'from-fuchsia-500 to-fuchsia-600', ring: 'ring-fuchsia-400', chartColor: '#d946ef', hidden: false,
		  bgStyle: 'background:repeating-linear-gradient(0deg,transparent 0px,transparent 7px,rgba(255,255,255,0.18) 7px,rgba(255,255,255,0.18) 9px,transparent 9px,transparent 19px,rgba(255,255,255,0.28) 19px,rgba(255,255,255,0.28) 21px),repeating-linear-gradient(90deg,transparent 0px,transparent 7px,rgba(255,255,255,0.18) 7px,rgba(255,255,255,0.18) 9px,transparent 9px,transparent 19px,rgba(255,255,255,0.28) 19px,rgba(255,255,255,0.28) 21px),linear-gradient(135deg,#d946ef,#a21caf)' },
		{ label: 'The Iron Tangle', cells: 32400, square: false, color: 'from-zinc-500 to-zinc-700', ring: 'ring-zinc-400', chartColor: '#71717a', hidden: true,
		  bgStyle: 'background:linear-gradient(rgba(0,0,0,0.25),rgba(0,0,0,0.25)),url(/iron-tangle-bg.svg) center/cover,linear-gradient(135deg,#52525b,#27272a);text-shadow:0 1px 3px rgba(0,0,0,0.7)' },
	];

	const ENABLED_DIFFICULTIES = DIFFICULTIES.filter(d => !d.hidden);

	// Compute W × H for a difficulty, fitting the current viewport aspect ratio.
	function computeGridSize(cells: number, square: boolean): { w: number; h: number } {
		const s = Math.round(Math.sqrt(cells));
		if (square || typeof window === 'undefined') return { w: s, h: s };
		// Available play area (rough estimate: 80px for button row + padding)
		const ratio = Math.max(0.4, Math.min(2.5, window.innerWidth / (window.innerHeight - 80)));
		const w = Math.max(4, Math.round(Math.sqrt(cells * ratio)));
		const h = Math.max(4, Math.round(Math.sqrt(cells / ratio)));
		return { w, h };
	}

	function gridCaption(cells: number, square: boolean): string {
		const { w, h } = computeGridSize(cells, square);
		return `${w} × ${h} grid`;
	}

	// ─── game state ──────────────────────────────────────────────────────────────

	let gameState = $state<'menu' | 'playing' | 'stats'>('menu');
	let menuOpen = $state(false);
	let W = $state(9);
	let H = $state(9);

	// Timing constants
	const MS_PER_STEP   = 90;
	const NUDGE_FWD     = 140; // ms to nudge toward blocker
	const NUDGE_BACK    = 140; // ms to spring back
	const FLASH_HALF    = 90;  // ms per flash half (×4 = total flash duration)
	const EXIT_DURATION  = 450; // ms — constant drain duration regardless of snake length
	const EXIT_MIN_DUR   = 220; // ms — floor so a 1-cell snake at the edge isn't instant
	const VORTEX_DURATION = 2000; // ms — win collapse animation (fade-in + spiral)
	const VORTEX_FADE_MS  =  600; // ms — stars fade in from nothing during this phase
	const VORTEX_SPIN_MS  = VORTEX_DURATION - VORTEX_FADE_MS; // 1400ms — spiral with ease-in

	const DIR_ROT: Record<Direction, number> = { E: 0, S: 90, W: 180, N: 270 };

	const DELTA: Record<Direction, { dx: number; dy: number }> = {
		N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
		E: { dx: 1,  dy: 0 }, W: { dx: -1, dy: 0 },
	};

	type Phase = 'exiting' | 'blocked-fwd' | 'blocked-back' | 'blocked-flash';

	interface Anim {
		phase: Phase;
		startTime: number;
		totalSteps?: number;
		maxSteps?: number;
		// drain animation (set when phase === 'exiting')
		routeD?: string;     // SVG path string for the full route (tail → head → extension)
		L_total?: number;    // total length of routeD in SVG units (cells)
		L_snake?: number;    // length of just the snake portion = the visible "dash"
		durationMs?: number; // total exit animation duration
	}

	const MAX_LIVES = 3;

	let level             = $state(generateLevel(9, 9));
	let removed           = $state(new Set<number>());
	let markedRed         = $state(new Set<number>());
	let anims             = $state<Record<number, Anim>>({});
	let now               = $state(performance.now());
	let lives             = $state(MAX_LIVES);
	let currentDifficulty = $state<string | null>(null); // label of the active difficulty
	let winCounted        = false; // plain bool — not reactive; reset on new game
	let lostCounted       = false; // same pattern — reset on new game
	let rafId: number | null = null;

	// Settings are owned by the settings store; these $derived aliases keep
	// the rest of this file readable (template references still say
	// `darkMode` etc. rather than `settings.darkMode`). Writes go through the
	// store directly: `settings.darkMode = !settings.darkMode`.
	const showGrid       = $derived(settings.showGrid);
	const roundedCorners = $derived(settings.roundedCorners);
	const darkMode       = $derived(settings.darkMode);
	const winAnimation   = $derived(settings.winAnimation);

	// Per-screen view state that ISN'T persisted.
	let showLoading    = $state(false);
	let regenerating   = $state(false);
	let menuSettingsOpen = $state(false);

	// Read-only aliases over the progress / resume stores. Same pattern: keep
	// the call sites looking like the originals; route writes through the
	// store (e.g. `progressStore.wins = next`, `resumeStore.data = data`).
	const progress    = $derived(progressStore.wins);
	const streak      = $derived(progressStore.streak);
	const resumeState = $derived(resumeStore.data);

	// OS-level reduce-motion preference. Reactive — picks up live changes from
	// System Settings without a reload. Gates the vortex, blocked-nudge, and
	// fly transitions; drain animations keep running because they're core to
	// gameplay feedback (short, linear, non-spinning).
	let reducedMotion = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const handler = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	});

	// SVG path refs for in-flight drain animations — keyed by arrow id.
	// Used to call .getPointAtLength(...) for arrowhead positioning each frame.
	let pathRefs = $state<Record<number, SVGPathElement | null>>({});

	// 4-pointed sparkle star — cubic beziers pinch through (±0.08,±0.08) between each tip.
	// Normalized to radius 1; scaled per-particle via SVG transform.
	const SPARKLE_PATH =
		'M 0 -1 C 0.08 -0.08 0.08 -0.08 1 0 C 0.08 0.08 0.08 0.08 0 1 ' +
		'C -0.08 0.08 -0.08 0.08 -1 0 C -0.08 -0.08 -0.08 -0.08 0 -1 Z';

	// Vortex collapse: plays when the player wins, before the win panel appears.
	interface Particle { r0: number; θ0: number; color: string; size: number; delay: number; rotation: number; speed: number }
	let vortexAnim      = $state<{ startTime: number } | null>(null);
	let vortexParticles = $state<Particle[]>([]);
	const vortexP    = $derived(vortexAnim ? Math.min(1, (now - vortexAnim.startTime) / VORTEX_DURATION) : 0);
	// Whether the vortex should actually play. OS reduce-motion overrides the
	// user's app setting — see the truth table in .claude/.plans/accessibility.md.
	const shouldPlayVortex = $derived(winAnimation && !reducedMotion);
	// If the vortex is going to play, stay "not done" from the moment won=true
	// (even before the $effect has had a chance to set vortexAnim) — prevents a
	// one-frame flash of the win panel before the spiral starts.
	const vortexDone = $derived(!shouldPlayVortex || (vortexAnim !== null && vortexP >= 1));

	// ─── pan / zoom ──────────────────────────────────────────────────────────────

	const MIN_SCALE = 1;
	const MAX_SCALE = 8;

	let scale = $state(1);
	let panX  = $state(0);
	let panY  = $state(0);
	let containerW = $state(0);
	let containerH = $state(0);

	// Non-reactive gesture tracking (mutated freely, never drives rendering directly)
	let _node: HTMLElement | null = null;
	let _activeT = new Map<number, { x: number; y: number }>();
	let _panX0 = 0, _panY0 = 0, _t0 = { x: 0, y: 0 }, _didMove = false;
	let _pinchD0 = 0, _pinchS0 = 1, _pinchPX0 = 0, _pinchPY0 = 0;
	let _pinchMid = { x: 0, y: 0 };

	function clampPan(px: number, py: number, s: number) {
		if (!_node) return { x: px, y: py };
		return clampPanPure(px, py, s, containerW, containerH);
	}

	function resetView() { scale = 1; panX = 0; panY = 0; }

	const svgViewBox = $derived.by(() => {
		if (!containerW || !containerH) return `-0.1 -0.1 ${W + 0.2} ${H + 0.2}`;
		const vbW = (W + 0.2) / scale;
		const vbH = (H + 0.2) / scale;
		const vbX = -panX * vbW / containerW - 0.1;
		const vbY = -panY * vbH / containerH - 0.1;
		return `${vbX} ${vbY} ${vbW} ${vbH}`;
	});

	// iPad Safari fires TouchEvents AND PointerEvents for Apple Pencil contacts.
	// Pencil input is handled exclusively through the pointer-event path
	// (onPenDown/Move/Up below), so skip stylus touches here to avoid the
	// same physical contact corrupting _activeT — without this, the pen's
	// touch + pointer entries make _activeT.size jump to 2, triggering the
	// pinch branch with _pinchD0 = 0 and zooming the board to max.
	// touchType is a WebKit-specific property: 'direct' = finger, 'stylus' = pen.
	function isStylusTouch(t: Touch): boolean {
		return (t as Touch & { touchType?: string }).touchType === 'stylus';
	}

	function onTouchStart(e: TouchEvent) {
		for (const t of Array.from(e.changedTouches)) {
			if (isStylusTouch(t)) continue;
			_activeT.set(t.identifier, { x: t.clientX, y: t.clientY });
		}

		if (_activeT.size === 1) {
			const [t] = _activeT.values();
			_t0 = { ...t }; _panX0 = panX; _panY0 = panY; _didMove = false;
		} else if (_activeT.size === 2) {
			const [a, b] = _activeT.values();
			const rect = _node!.getBoundingClientRect();
			_pinchD0  = Math.hypot(b.x - a.x, b.y - a.y);
			_pinchS0  = scale; _pinchPX0 = panX; _pinchPY0 = panY;
			_pinchMid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
		}
	}

	function onTouchMove(e: TouchEvent) {
		// Skip stylus-only moves so we don't preventDefault on pen gestures
		// the pointer-event path is handling.
		const fingerTouches = Array.from(e.changedTouches).filter(t => !isStylusTouch(t));
		if (fingerTouches.length === 0) return;
		e.preventDefault(); // must be non-passive to work; see panZoomAction
		for (const t of fingerTouches)
			_activeT.set(t.identifier, { x: t.clientX, y: t.clientY });

		if (_activeT.size === 1) {
			const [t] = _activeT.values();
			const dx = t.x - _t0.x, dy = t.y - _t0.y;
			if (Math.hypot(dx, dy) > 4) _didMove = true;
			if (_didMove) {
				const c = clampPan(_panX0 + dx, _panY0 + dy, scale);
				panX = c.x; panY = c.y;
			}
		} else if (_activeT.size >= 2) {
			const [a, b] = _activeT.values();
			const d = Math.hypot(b.x - a.x, b.y - a.y);
			const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, _pinchS0 * d / _pinchD0));
			const r = s / _pinchS0;
			const c = clampPan(
				_pinchMid.x - (_pinchMid.x - _pinchPX0) * r,
				_pinchMid.y - (_pinchMid.y - _pinchPY0) * r,
				s
			);
			scale = s; panX = c.x; panY = c.y;
		}
	}

	function onTouchEnd(e: TouchEvent) {
		for (const t of Array.from(e.changedTouches)) {
			if (isStylusTouch(t)) continue;
			_activeT.delete(t.identifier);
		}

		if (_activeT.size === 1) {
			// Dropped to 1 finger — reset single-touch pan baseline
			const [t] = _activeT.values();
			_t0 = { ...t }; _panX0 = panX; _panY0 = panY; _didMove = false;
		}
		// Snap back to unzoomed if barely zoomed
		if (_activeT.size === 0 && scale < 1.05) resetView();
	}

	// All pointer listeners go through the action so passive flags are explicit.
	// touchmove must be non-passive to allow preventDefault() which stops the
	// browser from claiming the gesture as a scroll before we can pan.
	function panZoomAction(node: HTMLElement) {
		_node = node;

		const ro = new ResizeObserver(entries => {
			const { width, height } = entries[0].contentRect;
			containerW = width;
			containerH = height;
		});
		ro.observe(node);

		function onWheel(e: WheelEvent) {
			e.preventDefault();
			const rect = node.getBoundingClientRect();
			const mx = e.clientX - rect.left, my = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
			const r = s / scale;
			const c = clampPan(mx - (mx - panX) * r, my - (my - panY) * r, s);
			scale = s; panX = c.x; panY = c.y;
		}

		// ─── Apple Pencil (PointerEvent path) ──────────────────────────────
		// Apple Pencil fires PointerEvents with pointerType='pen' that the
		// touch handlers don't (and can't) see correctly. This block gives
		// the pen its own pan + tap path. Listeners are attached via
		// addEventListener (not Svelte event-attribute syntax) to avoid
		// Svelte 5's event delegation, which conflicts with onclick when
		// pointerup is also delegated on SVG elements.
		const PEN_KEY = -1; // touch identifiers are always >= 0
		const PEN_MOVE_THRESHOLD = 12; // px; lenient — pencil precision can
		                               // trip the touch threshold (4) easily

		// Coordinate-based hit-testing is more reliable than
		// document.elementFromPoint for SVG content under transforms.
		// Pure logic lives in $lib/utils/gestures so it can be unit-tested.
		function cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
			return cellAtPure(clientX, clientY, node.getBoundingClientRect(),
				containerW, containerH, panX, panY, scale, W, H);
		}

		function onPenDown(e: PointerEvent) {
			if (e.pointerType !== 'pen') return;
			_activeT.set(PEN_KEY, { x: e.clientX, y: e.clientY });
			_t0 = { x: e.clientX, y: e.clientY };
			_panX0 = panX; _panY0 = panY; _didMove = false;
			try { node.setPointerCapture(e.pointerId); } catch { /* not supported */ }
		}

		function onPenMove(e: PointerEvent) {
			if (e.pointerType !== 'pen' || !_activeT.has(PEN_KEY)) return;
			_activeT.set(PEN_KEY, { x: e.clientX, y: e.clientY });
			const dx = e.clientX - _t0.x, dy = e.clientY - _t0.y;
			if (Math.hypot(dx, dy) > PEN_MOVE_THRESHOLD) _didMove = true;
			if (_didMove) {
				e.preventDefault(); // suppress native scroll once we own the gesture
				const c = clampPan(_panX0 + dx, _panY0 + dy, scale);
				panX = c.x; panY = c.y;
			}
		}

		function onPenUp(e: PointerEvent) {
			if (e.pointerType !== 'pen' || !_activeT.has(PEN_KEY)) return;
			_activeT.delete(PEN_KEY);
			try { node.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
			if (_activeT.size === 0 && scale < 1.05) resetView();

			if (e.type === 'pointerup' && !_didMove) {
				const cell = cellAt(e.clientX, e.clientY);
				if (!cell) return;
				for (const arrow of level.arrows) {
					if (removed.has(arrow.id)) continue;
					if (arrow.path.some(p => p.x === cell.x && p.y === cell.y)) {
						handleClick(arrow.id);
						break;
					}
				}
			}
		}

		node.addEventListener('touchstart',   onTouchStart, { passive: true  });
		node.addEventListener('touchmove',    onTouchMove,  { passive: false }); // ← non-passive
		node.addEventListener('touchend',     onTouchEnd,   { passive: true  });
		node.addEventListener('touchcancel',  onTouchEnd,   { passive: true  });
		node.addEventListener('wheel',        onWheel,      { passive: false });
		node.addEventListener('pointerdown',  onPenDown, { passive: true  });
		node.addEventListener('pointermove',  onPenMove, { passive: false }); // ← non-passive for preventDefault
		node.addEventListener('pointerup',    onPenUp,   { passive: true  });
		node.addEventListener('pointercancel', onPenUp,  { passive: true  });

		return {
			destroy() {
				ro.disconnect();
				node.removeEventListener('touchstart',   onTouchStart);
				node.removeEventListener('touchmove',    onTouchMove);
				node.removeEventListener('touchend',     onTouchEnd);
				node.removeEventListener('touchcancel',  onTouchEnd);
				node.removeEventListener('wheel',        onWheel);
				node.removeEventListener('pointerdown',  onPenDown);
				node.removeEventListener('pointermove',  onPenMove);
				node.removeEventListener('pointerup',    onPenUp);
				node.removeEventListener('pointercancel', onPenUp);
				_node = null;
			}
		};
	}

	// ─── rounded snake path ──────────────────────────────────────────────────────

	// Converts animated segment positions into an SVG path string.
	// Straight runs use L; turns use a quadratic bézier (Q) so corners are smooth.
	function roundedPath(pts: { x: number; y: number }[], r: number): string {
		if (pts.length === 0) return '';
		const cx = (p: { x: number; y: number }) => p.x + 0.5;
		const cy = (p: { x: number; y: number }) => p.y + 0.5;
		if (pts.length === 1) return `M ${cx(pts[0])} ${cy(pts[0])}`;
		if (pts.length === 2) return `M ${cx(pts[0])} ${cy(pts[0])} L ${cx(pts[1])} ${cy(pts[1])}`;

		let d = `M ${cx(pts[0])} ${cy(pts[0])}`;

		for (let i = 1; i < pts.length - 1; i++) {
			const ax = cx(pts[i - 1]), ay = cy(pts[i - 1]);
			const bx = cx(pts[i    ]), by = cy(pts[i    ]);
			const ex = cx(pts[i + 1]), ey = cy(pts[i + 1]);

			const dx1 = bx - ax, dy1 = by - ay;
			const dx2 = ex - bx, dy2 = ey - by;
			const len1 = Math.hypot(dx1, dy1) || 1;
			const len2 = Math.hypot(dx2, dy2) || 1;

			// Cross product detects a direction change (turn vs straight)
			if (Math.abs(dx1 * dy2 - dy1 * dx2) < 0.001 * len1 * len2) {
				d += ` L ${bx} ${by}`; // straight — pass through
			} else {
				const r1 = Math.min(r, len1 / 2);
				const r2 = Math.min(r, len2 / 2);
				const p1x = bx - (dx1 / len1) * r1, p1y = by - (dy1 / len1) * r1;
				const p2x = bx + (dx2 / len2) * r2, p2y = by + (dy2 / len2) * r2;
				d += ` L ${p1x} ${p1y} Q ${bx} ${by} ${p2x} ${p2y}`;
			}
		}

		d += ` L ${cx(pts[pts.length - 1])} ${cy(pts[pts.length - 1])}`;
		return d;
	}

	// ─── easing ─────────────────────────────────────────────────────────────────

	function easeOut(t: number) { return 1 - (1 - t) ** 2; }
	function easeIn(t:  number) { return t * t; }

	// ─── snake-flow math ─────────────────────────────────────────────────────────

	function extPos(path: GridPos[], i: number, d: { dx: number; dy: number }) {
		if (i >= 0) return path[i];
		return { x: path[0].x + (-i) * d.dx, y: path[0].y + (-i) * d.dy };
	}

	function segPos(path: GridPos[], k: number, s: number, d: { dx: number; dy: number }) {
		const lo = Math.floor(s), f = s - lo;
		const a = extPos(path, k - lo,     d);
		const b = extPos(path, k - lo - 1, d);
		return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
	}

	// Number of cells from the arrow's head to the grid boundary, in the exit direction.
	// Equals 1 when the head is already on the edge row/column.
	function exitCellCount(arrow: Arrow): number {
		const h = arrow.path[0];
		return arrow.direction === 'W' ? h.x + 1
			:  arrow.direction === 'E' ? W - h.x
			:  arrow.direction === 'N' ? h.y + 1
			:                            H - h.y;
	}

	// ─── drain animation: dasharray + dashoffset along an extended path ──────────

	// Hidden singleton path used to measure SVG path lengths off-screen.
	// (getTotalLength works on detached elements in Chrome/Safari, but Firefox
	//  historically required attachment — so we keep one in a hidden <svg>.)
	let _measurer: SVGPathElement | null = null;
	function measurePath(d: string): number {
		if (typeof document === 'undefined') return 0;
		if (!_measurer) {
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('width',  '0');
			svg.setAttribute('height', '0');
			svg.style.position      = 'absolute';
			svg.style.visibility    = 'hidden';
			svg.style.pointerEvents = 'none';
			_measurer = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			svg.appendChild(_measurer);
			document.body.appendChild(svg);
		}
		_measurer.setAttribute('d', d);
		return _measurer.getTotalLength();
	}

	// Build the full drain route: the snake's cells in TAIL → HEAD order,
	// followed by enough extension cells in arrow.direction that the snake-
	// length dash can fully slide off the grid.
	function buildFullRoute(arrow: Arrow): string {
		const dir = DELTA[arrow.direction];
		const N   = arrow.path.length;
		const extra = exitCellCount(arrow) + N + 2; // generous so dash exits cleanly

		const pts: GridPos[] = [];
		for (let i = N - 1; i >= 0; i--) pts.push(arrow.path[i]);
		for (let k = 1; k <= extra; k++) {
			pts.push({ x: arrow.path[0].x + k * dir.dx, y: arrow.path[0].y + k * dir.dy });
		}
		return roundedPath(pts, roundedCorners ? 0.4 : 0);
	}

	// ─── step position for blocked phases ────────────────────────────────────────

	// The exiting phase no longer uses computeS — it's driven by elapsed/durationMs
	// directly via stroke-dashoffset. Only the blocked nudge needs this.
	function computeS(anim: Anim | undefined, elapsed: number): number {
		if (!anim) return 0;
		if (anim.phase === 'blocked-fwd')
			return easeOut(Math.min(elapsed / NUDGE_FWD, 1)) * (anim.maxSteps ?? 0);
		if (anim.phase === 'blocked-back')
			return (1 - easeIn(Math.min(elapsed / NUDGE_BACK, 1))) * (anim.maxSteps ?? 0);
		return 0;
	}

	function isFlashRed(anim: Anim, elapsed: number) {
		return anim.phase === 'blocked-flash' && Math.floor(elapsed / FLASH_HALF) % 2 === 0;
	}

	// ─── blocking check ──────────────────────────────────────────────────────────

	function checkBlocked(arrow: Arrow): { blocked: boolean; dist: number } {
		const d = DELTA[arrow.direction];
		const walls = new Set<string>();
		for (const a of level.arrows) {
			if (a.id === arrow.id || removed.has(a.id)) continue;
			if (anims[a.id]?.phase === 'exiting') continue;
			for (const p of a.path) walls.add(`${p.x},${p.y}`);
		}
		let { x, y } = arrow.path[0];
		x += d.dx; y += d.dy;
		let dist = 0;
		while (x >= 0 && x < W && y >= 0 && y < H) {
			if (walls.has(`${x},${y}`)) return { blocked: true, dist };
			dist++; x += d.dx; y += d.dy;
		}
		return { blocked: false, dist };
	}

	// ─── click handler ───────────────────────────────────────────────────────────

	function handleClick(id: number) {
		if (_didMove) return; // swallow taps that ended a pan gesture
		if (won || lives <= 0) return; // game already decided
		if (anims[id] || removed.has(id)) return;
		const arrow = level.arrows.find(a => a.id === id);
		if (!arrow) return;

		const { blocked, dist } = checkBlocked(arrow);
		const t = performance.now();
		now = t;

		if (!blocked) {
			// Compute drain metadata up-front: build the extended route and
			// measure both the full route and the snake-only portion so we know
			// how far the dash needs to slide.
			const exitCells = exitCellCount(arrow);
			const routeD    = buildFullRoute(arrow);
			const snakeD    = roundedPath([...arrow.path].reverse(), roundedCorners ? 0.4 : 0);
			const L_total   = measurePath(routeD);
			const L_snake   = measurePath(snakeD);
			// Constant duration regardless of length — long snakes drain faster
			// (visually whip out), short ones drain slower, but wall-clock time
			// to clear is the same. EXIT_MIN_DUR keeps a 1-cell-at-edge snake
			// from looking instant.
			const totalTravel = L_snake + exitCells;
			const durationMs  = Math.max(EXIT_MIN_DUR, EXIT_DURATION * Math.min(1, totalTravel / 4));

			anims = { ...anims, [id]: {
				phase: 'exiting', startTime: t,
				routeD, L_total, L_snake, durationMs,
			} };
		} else if (reducedMotion) {
			// Reduced motion: skip the nudge / bounce / flash sequence entirely.
			// Apply the penalty (life lost, marked red) instantly. No animation at
			// all — the user sees a heart disappear and the arrow tint to dark red.
			lives = Math.max(0, lives - 1);
			markedRed = new Set([...markedRed, id]);
		} else {
			anims = { ...anims, [id]: { phase: 'blocked-fwd', startTime: t, maxSteps: dist + 0.5 } };
		}

		if (rafId === null) rafId = requestAnimationFrame(loop);
	}

	// ─── animation loop ───────────────────────────────────────────────────────────

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
				lives = Math.max(0, lives - 1); // life lost when the red-flash penalty fires
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

	// ─── game control ────────────────────────────────────────────────────────────

	function generateInWorker(w: number, h: number): Promise<Level> {
		return new Promise((resolve) => {
			const worker = new GeneratorWorker();
			worker.onmessage = (e: MessageEvent<Level>) => {
				resolve(e.data);
				worker.terminate();
			};
			worker.postMessage({ w, h });
		});
	}

	async function startGame(cells: number, square: boolean) {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		gameState = 'playing';
		showLoading = true;
		await tick(); // flush DOM so the loading overlay paints before we kick off the worker

		const { w, h } = computeGridSize(cells, square);
		W = w; H = h;
		removed           = new Set();
		markedRed         = new Set();
		anims             = {};
		lives             = MAX_LIVES;
		menuOpen          = false;
		winCounted        = false;
		lostCounted       = false;
		currentDifficulty = DIFFICULTIES.find(d => d.cells === cells && d.square === square)?.label ?? null;
		level             = await generateInWorker(w, h);
		resumeStore.puzzle = level;
		resumeStore.clear();
		resetView();
		showLoading = false;
	}

	// reuse=true  → restore the saved puzzle (Try Again / New Level)
	// reuse=false → generate a fresh puzzle synchronously (win-panel New Level)
	function reset(reuse = false) {
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		removed    = new Set();
		markedRed  = new Set();
		anims      = {};
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

	// Generate a fresh puzzle in the worker and swap it in — used by the
	// in-game Regenerate button so the icon can spin during generation.
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
		gameState = 'menu';
	}

	function goToStats() { gameState = 'stats'; }

	// ─── chart data ──────────────────────────────────────────────────────────────

	// Pre-compute donut segments from win counts.
	// Each segment has: startAngle (deg, 0 = top), dash (px along circumference).
	const DONUT_R = 65;
	const DONUT_C = 2 * Math.PI * DONUT_R;
	const DONUT_GAP = 2; // px gap cut from each segment's leading edge

	const chartSegments = $derived(
		(() => {
			const total = ENABLED_DIFFICULTIES.reduce((s, d) => s + (progress[d.label] ?? 0), 0);
			let cumFrac = 0;
			return ENABLED_DIFFICULTIES.map(d => {
				const count  = progress[d.label] ?? 0;
				const frac   = total > 0 ? count / total : 0;
				const angle  = cumFrac * 360 - 90; // -90° → start segment at 12 o'clock
				const dash   = Math.max(0, frac * DONUT_C - DONUT_GAP);
				cumFrac += frac;
				return { ...d, count, frac, total, angle, dash };
			});
		})()
	);

	const totalWins = $derived(ENABLED_DIFFICULTIES.reduce((s, d) => s + (progress[d.label] ?? 0), 0));

	// One-line summary of the donut chart for screen-reader users. The visible
	// legend below the chart already lists per-difficulty counts; this is the
	// at-a-glance equivalent that an SR user gets without scanning all rows.
	const donutLabel = $derived.by(() => {
		if (totalWins === 0) return 'Win breakdown: no wins yet';
		const parts = ENABLED_DIFFICULTIES
			.map(d => `${d.label} ${progress[d.label] ?? 0}`)
			.join(', ');
		return `Win breakdown: ${totalWins} total. ${parts}`;
	});

	// Settings auto-persist via the settings store's root effect; no in-page
	// $effect needed.

	// ─── theme-aware arrow colors ────────────────────────────────────────────────

	// Dark palette: bright pastels readable on dark backgrounds.
	// Light palette: saturated -600/-700 variants readable on light backgrounds.
	const COLORS_DARK  = ['#f87171','#60a5fa','#4ade80','#c084fc','#fb923c','#f472b6','#facc15','#2dd4bf','#22d3ee','#a3e635'];
	const COLORS_LIGHT = ['#dc2626','#2563eb','#16a34a','#9333ea','#ea580c','#db2777','#a16207','#0d9488','#0891b2','#65a30d'];

	function themeColor(id: number): string {
		return (darkMode ? COLORS_DARK : COLORS_LIGHT)[id % 10];
	}

	// Pre-compute SVG path strings and head positions for every arrow at s=0.
	// These are used by the static (non-animating) render branch so idle arrows
	// never re-render during RAF ticks — only arrows with an active anim do.
	const staticArrowData = $derived(
		Object.fromEntries(level.arrows.map(arrow => [
			arrow.id,
			{ d: roundedPath(arrow.path, roundedCorners ? 0.4 : 0), head: arrow.path[0] },
		]))
	);

	const won  = $derived(level.arrows.length > 0 && level.arrows.every(a => removed.has(a.id)));
	const lost = $derived(lives <= 0 && !won);

	// ─── resume-state persistence ─────────────────────────────────────────────────

	// Auto-save in-progress state whenever arrows are removed. Clears on
	// win/lose so a completed or dead game never shows as resumable. The
	// localStorage write itself is owned by the resume store's root effect;
	// here we just mutate the reactive snapshot.
	$effect(() => {
		if (gameState !== 'playing') return;
		if (won || lost) {
			resumeStore.clear();
			return;
		}
		if (removed.size === 0) return; // no progress yet — nothing worth saving
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

	async function resumeGame() {
		const r = resumeStore.data;
		if (!r) return;
		const savedLevel = resumeStore.puzzle;
		if (!savedLevel || savedLevel.width !== r.W || savedLevel.height !== r.H) {
			// Saved puzzle doesn't match resume metadata — stale data, discard.
			resumeStore.clear();
			return;
		}

		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
		gameState = 'playing';
		W = r.W; H = r.H;
		currentDifficulty = r.difficulty;
		winCounted  = false;
		lostCounted = false;
		menuOpen    = false;
		level    = savedLevel;
		removed  = new Set(r.removedIds);
		markedRed = new Set(r.markedRedIds);
		lives    = r.lives;
		anims    = {};
		resetView();
	}

	// ─── completion tracking ──────────────────────────────────────────────────────

	// Record a completion when the player clears the board.
	// winCounted is a plain bool (not reactive) so this fires exactly once per game.
	$effect(() => {
		if (won && !winCounted && currentDifficulty !== null) {
			winCounted = true;
			progressStore.wins = {
				...progress,
				[currentDifficulty]: (progress[currentDifficulty] ?? 0) + 1,
			};
			// Advance win streak; the store auto-persists the new snapshot.
			progressStore.streak = {
				current: streak.current + 1,
				best:    Math.max(streak.best, streak.current + 1),
			};
		}
	});

	// Reset streak when the player loses.
	$effect(() => {
		if (lost && !lostCounted) {
			lostCounted = true;
			progressStore.streak = { current: 0, best: streak.best };
		}
	});

	// Trigger vortex collapse on win (if enabled); clear it when the game resets.
	$effect(() => {
		if (won && !vortexAnim && shouldPlayVortex) {
			vortexAnim = { startTime: performance.now() };
			// Spawn star particles spread across the board, spiraling inward
			const cx = W / 2, cy = H / 2;
			const count = Math.min(80, Math.max(24, level.arrows.length * 3));
			const palette = COLORS_DARK; // bright pastels pop on both light and dark backgrounds
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
					speed: 0.35 + Math.random() * 0.65,  // fraction of VORTEX_SPIN_MS each particle uses
				};
			});
			if (rafId === null) rafId = requestAnimationFrame(loop);
		}
		if (!won) { vortexAnim = null; vortexParticles = []; }
	});
</script>

{#if gameState === 'menu'}
	<!-- ─── Start screen ─────────────────────────────────────────────────────── -->
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
				{@const remaining = resumeState.totalArrows - resumeState.removedIds.length}
				<button
					onclick={resumeGame}
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
							<div class="flex gap-0.5" aria-label="{resumeState.lives} lives remaining">
								{#each Array(MAX_LIVES) as _, i}
									<span class="text-base {i < resumeState.lives
										? (darkMode ? 'text-red-400' : 'text-red-500')
										: (darkMode ? 'text-slate-700' : 'text-slate-300')}">
										{i < resumeState.lives ? '♥' : '♡'}
									</span>
								{/each}
							</div>
						</div>
						<span class="text-sm {darkMode ? 'text-emerald-500' : 'text-emerald-600'}">
							{resumeState.difficulty ?? 'Custom'} · {remaining} arrow{remaining === 1 ? '' : 's'} left
						</span>
					</div>
				</button>
			{/if}

			{#each ENABLED_DIFFICULTIES as d}
				{@const count = progress[d.label] ?? 0}
				<button
					onclick={() => startGame(d.cells, d.square)}
					class="group relative flex items-center py-4 px-5 rounded-2xl bg-gradient-to-br {d.color}
					       shadow-lg hover:scale-[1.03] active:scale-[0.98] transition-transform duration-150
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white
					       focus-visible:ring-offset-2 {darkMode ? 'focus-visible:ring-offset-slate-900' : 'focus-visible:ring-offset-slate-100'}"
					style={'bgStyle' in d ? d.bgStyle : ''}
				>
					<!-- Label + grid size -->
					<div class="flex flex-col items-start flex-1 min-w-0">
						<span class="text-white font-bold text-xl tracking-wide">{d.label}</span>
						<span class="text-white/90 text-sm">{gridCaption(d.cells, d.square)}</span>
					</div>
					<!-- Completion count badge -->
					<div class="flex flex-col items-center justify-center ml-3 shrink-0 min-w-[3rem]">
						{#if count > 0}
							<span class="text-2xl font-extrabold text-white leading-none">{count}</span>
							<span class="text-white/85 text-[10px] uppercase tracking-widest mt-0.5">
								{count === 1 ? 'win' : 'wins'}
							</span>
						{:else}
							<span class="text-white/30 text-xs">—</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>

		</div><!-- end my-auto wrapper -->
		</div><!-- end overflow-y-auto -->

		<!-- Stats button pinned to the bottom -->
		<div class="shrink-0 flex justify-center pb-1" inert={menuSettingsOpen}>
			<button
				onclick={goToStats}
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
				<!-- Header row: title + explicit close button. The gear that opened
				     this dialog is inert while the dialog is open, so keyboard and
				     SR users need a dismissal target inside the panel. -->
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

				<!-- Dark Mode -->
				<button
					role="switch" aria-checked={darkMode}
					onclick={() => (settings.darkMode = !settings.darkMode)}
					class="flex items-center justify-between w-full min-h-11 px-1 py-2 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm flex items-center gap-2">
						{#if darkMode}
							<svg width="14" height="14" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
								<path d="M11 8.5A5 5 0 0 1 4.5 2a5 5 0 1 0 6.5 6.5z"/>
							</svg>
						{:else}
							<svg width="14" height="14" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="6.5" cy="6.5" r="2.2"/>
								<line x1="6.5" y1="1" x2="6.5" y2="0.1"/><line x1="6.5" y1="12" x2="6.5" y2="12.9"/>
								<line x1="1" y1="6.5" x2="0.1" y2="6.5"/><line x1="12" y1="6.5" x2="12.9" y2="6.5"/>
								<line x1="2.9" y1="2.9" x2="2.2" y2="2.2"/><line x1="10.1" y1="10.1" x2="10.8" y2="10.8"/>
								<line x1="10.1" y1="2.9" x2="10.8" y2="2.2"/><line x1="2.9" y1="10.1" x2="2.2" y2="10.8"/>
							</svg>
						{/if}
						Dark Mode
					</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {darkMode ? 'bg-emerald-500' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {darkMode ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>

				<!-- Show Grid -->
				<button
					role="switch" aria-checked={showGrid}
					onclick={() => (settings.showGrid = !settings.showGrid)}
					class="flex items-center justify-between w-full min-h-11 px-1 py-2 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm">Show Grid</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {showGrid ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {showGrid ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>

				<!-- Rounded Corners -->
				<button
					role="switch" aria-checked={roundedCorners}
					onclick={() => (settings.roundedCorners = !settings.roundedCorners)}
					class="flex items-center justify-between w-full min-h-11 px-1 py-2 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm">Rounded Corners</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {roundedCorners ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {roundedCorners ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>

				<!-- Win Animation -->
				<button
					role="switch" aria-checked={winAnimation}
					onclick={() => (settings.winAnimation = !settings.winAnimation)}
					class="flex items-center justify-between w-full min-h-11 px-1 py-2 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-200' : 'text-slate-700'} text-sm">Win Animation</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {winAnimation ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 {winAnimation ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>

				<!-- Divider -->
				<div class="my-1 border-t {darkMode ? 'border-slate-700/60' : 'border-slate-200'}"></div>

				<!-- Stats link -->
				<button
					onclick={() => { menuSettingsOpen = false; goToStats(); }}
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

{:else if gameState === 'stats'}
	<!-- Stats screen -->
	<main class="w-full h-dvh {darkMode ? 'bg-slate-900' : 'bg-slate-100'} flex flex-col overflow-hidden">

		<!-- Top bar -->
		<div class="shrink-0 flex items-center px-4 border-b {darkMode ? 'border-slate-800/80 bg-slate-900/95' : 'border-slate-300/80 bg-slate-100/95'} backdrop-blur-sm"
		     style="padding-top: env(safe-area-inset-top); min-height: calc(3rem + env(safe-area-inset-top))">
			<button
				onclick={goToMenu}
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
				<!-- Background ring -->
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

				<!-- Centre label -->
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
		</div>
	</main>

{:else}
	<!-- ─── Game screen ──────────────────────────────────────────────────────── -->
	<main class="relative w-full h-dvh {darkMode ? 'bg-slate-900' : 'bg-slate-100'} flex flex-col overflow-hidden">

		<!-- ── Top bar ──────────────────────────────────────────────────────────── -->
		<!-- h-12 = 3rem fixed; shrink-0 prevents flex from squishing it -->
		<div class="shrink-0 flex items-center gap-2 px-3 border-b {darkMode ? 'border-slate-800/80 bg-slate-900/95' : 'border-slate-300/80 bg-slate-100/95'} backdrop-blur-sm"
		     style="padding-top: env(safe-area-inset-top); min-height: calc(3rem + env(safe-area-inset-top))"
		     inert={won || lost}>

			<!-- Hamburger button — always visible -->
			<button
				class="flex items-center justify-center w-11 h-11 rounded-lg transition-colors active:scale-95
				       {darkMode
				           ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
				           : 'bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-slate-800'}"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
			>
				{#if menuOpen}
					<!-- × close icon -->
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
						<line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
					</svg>
				{:else}
					<!-- ☰ hamburger icon -->
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<line x1="2" y1="4.5" x2="14" y2="4.5"/>
						<line x1="2" y1="8"   x2="14" y2="8"/>
						<line x1="2" y1="11.5" x2="14" y2="11.5"/>
					</svg>
				{/if}
			</button>

			<!-- Spacer -->
			<div class="flex-1"></div>

<!-- Hearts — always visible on every screen size -->
<div class="flex items-center gap-4 pr-1">
	{#if !showLoading}
		<span
			class="text-sm font-medium {darkMode ? 'text-slate-400' : 'text-slate-500'}"
			aria-live="polite"
			aria-atomic="true"
		>
			{level.arrows.length - removed.size} arrows left
		</span>
	{/if}
	<div
		class="flex items-center gap-1.5"
		role="img"
		aria-label="{lives} of {MAX_LIVES} lives remaining"
		aria-live="polite"
	>
		{#each Array(MAX_LIVES) as _, i}
			<span
				aria-hidden="true"
				class="text-xl leading-none select-none transition-all duration-300
				       {i < lives ? 'text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]' : darkMode ? 'text-slate-700' : 'text-slate-300'}"
			>♥</span>
		{/each}
	</div>
</div>
		</div>

		<!-- Mobile overlay menu (floats over the board, doesn't push layout) -->
		{#if menuOpen}
			<!-- Backdrop: tap anywhere outside the panel to close -->
			<button
				class="absolute inset-0 z-30 {darkMode ? 'bg-slate-950/40' : 'bg-slate-400/30'}"
				style="top: calc(3rem + env(safe-area-inset-top))"
				onclick={() => (menuOpen = false)}
				tabindex="-1"
				aria-hidden="true"
			></button>

			<!-- Panel: slides down from below the top bar -->
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

				<!-- Toggle: Dark Mode -->
				<button
					role="switch" aria-checked={darkMode}
					onclick={() => (settings.darkMode = !settings.darkMode)}
					class="flex items-center justify-between w-full min-h-11 px-1 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm flex items-center gap-1.5">
						{#if darkMode}
							<!-- Moon icon -->
							<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
								<path d="M11 8.5A5 5 0 0 1 4.5 2a5 5 0 1 0 6.5 6.5z"/>
							</svg>
						{:else}
							<!-- Sun icon -->
							<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="6.5" cy="6.5" r="2.2"/>
								<line x1="6.5" y1="1" x2="6.5" y2="0.1"/>
								<line x1="6.5" y1="12" x2="6.5" y2="12.9"/>
								<line x1="1" y1="6.5" x2="0.1" y2="6.5"/>
								<line x1="12" y1="6.5" x2="12.9" y2="6.5"/>
								<line x1="2.9" y1="2.9" x2="2.2" y2="2.2"/>
								<line x1="10.1" y1="10.1" x2="10.8" y2="10.8"/>
								<line x1="10.1" y1="2.9" x2="10.8" y2="2.2"/>
								<line x1="2.9" y1="10.1" x2="2.2" y2="10.8"/>
							</svg>
						{/if}
						Dark Mode
					</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {darkMode ? 'bg-emerald-500' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
						             {darkMode ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>

				<!-- Toggle: Show Grid -->
				<button
					role="switch" aria-checked={showGrid}
					onclick={() => (settings.showGrid = !settings.showGrid)}
					class="flex items-center justify-between w-full min-h-11 px-1 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm">Show Grid</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {showGrid ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
						             {showGrid ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>

				<!-- Toggle: Rounded Corners -->
				<button
					role="switch" aria-checked={roundedCorners}
					onclick={() => (settings.roundedCorners = !settings.roundedCorners)}
					class="flex items-center justify-between w-full min-h-11 px-1 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm">Rounded Corners</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {roundedCorners ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
						             {roundedCorners ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>

				<!-- Toggle: Win Animation -->
				<button
					role="switch" aria-checked={winAnimation}
					onclick={() => (settings.winAnimation = !settings.winAnimation)}
					class="flex items-center justify-between w-full min-h-11 px-1 rounded-lg select-none transition-colors
					       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
				>
					<span class="{darkMode ? 'text-slate-300' : 'text-slate-700'} text-sm">Win Animation</span>
					<span
						class="relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0
						       {winAnimation ? 'bg-emerald-500' : darkMode ? 'bg-slate-600' : 'bg-slate-300'}"
					>
						<span class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
						             {winAnimation ? 'translate-x-4' : 'translate-x-0'}"></span>
					</span>
				</button>
			</div>
		{/if}

		<!-- ── Board area — fills all remaining vertical space ──────────────────── -->
		<!--
			flex-1 min-h-0  → takes leftover height; min-h-0 prevents flex overflow
			Board width: min(viewport width − padding, remaining height × aspect ratio)
			  3rem  = top bar (h-12)
			  1.5rem = padding (p-3 on each side)
		-->
		<div class="flex-1 min-h-0 flex items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
		     inert={menuOpen || won || lost}>
			<div
				style="width: min(calc(100vw - 1.5rem), calc((100dvh - 4.5rem - env(safe-area-inset-top)) * {W / H})); aspect-ratio: {W} / {H};"
				class="relative overflow-hidden rounded-xl touch-none"
				use:panZoomAction
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
						<rect x="0" y="0" width={W} height={H} fill="url(#cell-bg)" />
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
											stroke-linejoin="round"
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
											stroke-linejoin="round"
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
								<g data-testid="arrow" data-arrow-id={arrow.id} onclick={() => handleClick(arrow.id)} style="cursor:pointer" opacity={0.95}>
									{#each arrow.path as seg}
										<rect x={seg.x} y={seg.y} width={1} height={1} fill="transparent" />
									{/each}
									<path
										d={sd.d}
										fill="none"
										stroke={drawColor}
										stroke-width={0.14}
										stroke-linecap="round"
										stroke-linejoin="round"
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
					{@const bx = W / 2}
					{@const by = H / 2}
					<!-- Global spiral progress (0→1 over phase 2) drives the bg overlay -->
					{@const spinElapsed = Math.max(0, elapsed - VORTEX_FADE_MS)}
					{@const spinP  = Math.min(1, spinElapsed / VORTEX_SPIN_MS)}
					{@const spinEP = spinP * spinP * spinP}
					<!-- Fade the board colour over the grid lines as the spiral completes -->
					<rect x="0" y="0" width={W} height={H}
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
		</div>

		<!-- Win panel — appears after the vortex collapse finishes -->
		<!-- Lifted out of the board container so it stays interactive when the
		     surrounding game UI is marked inert. Covers the full screen. -->
		{#if won && vortexDone}
			<div class="absolute inset-0 flex items-center justify-center z-50 {darkMode ? 'bg-slate-950/75' : 'bg-slate-300/70'}"
			     transition:fly={{ y: reducedMotion ? 0 : 16, duration: reducedMotion ? 160 : 280, opacity: 0 }}>
				<div
					use:trapFocus
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="win-panel-title"
					class="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl shadow-2xl
					       {darkMode
					           ? 'bg-slate-900/90 border border-slate-700/60'
					           : 'bg-white/95 border border-slate-200/60'}"
				>
					<div class="text-4xl mb-2" aria-hidden="true">🎉</div>
					<p id="win-panel-title" class="text-2xl font-extrabold tracking-tight {darkMode ? 'text-white' : 'text-slate-900'}">Level Complete</p>
					<p class="text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">All {level.arrows.length} arrows cleared</p>
					<div class="flex gap-1 mt-1" role="img" aria-label="{lives} of {MAX_LIVES} lives remaining">
						{#each Array(MAX_LIVES) as _, i}
							<span aria-hidden="true" class="text-lg transition-all {i < lives ? 'text-red-500' : darkMode ? 'text-slate-700' : 'text-slate-300'}">
								{i < lives ? '♥' : '♡'}
							</span>
						{/each}
					</div>
					<button
						onclick={() => reset(false)}
						class="w-full px-8 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95
						       text-white font-bold text-lg shadow-lg shadow-emerald-900/50 transition-all duration-150
						       flex items-center justify-center gap-2"
					>
						<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polygon points="6,3 15,9 6,15" fill="currentColor" stroke="none"/>
						</svg>
						New Level
					</button>
					<button
						onclick={goToMenu}
						class="px-6 py-2 rounded-xl active:scale-95 text-sm font-medium border transition-all duration-150
						       {darkMode
						           ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
						           : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'}"
					>← Main Menu</button>
				</div>
			</div>
		{/if}

		<!-- Game-over panel — full-screen, alerts the user the game is decided. -->
		{#if lost}
			<div class="absolute inset-0 flex items-center justify-center z-50 {darkMode ? 'bg-slate-950/80' : 'bg-slate-300/75'}">
				<div
					use:trapFocus
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="loss-panel-title"
					class="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl shadow-2xl
					       {darkMode
					           ? 'bg-slate-900/90 border border-slate-700/60'
					           : 'bg-white/95 border border-slate-200/60'}"
				>
					<div class="text-4xl mb-2" aria-hidden="true">💔</div>
					<p id="loss-panel-title" class="text-2xl font-extrabold text-red-500 tracking-tight">Game Over</p>
					<p class="text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">
						{level.arrows.length - removed.size} arrows left
					</p>
					<button
						onclick={() => reset(true)}
						class="w-full px-8 py-3 rounded-2xl bg-red-600 hover:bg-red-500 active:scale-95
						       text-white font-bold text-lg shadow-lg shadow-red-900/50 transition-all duration-150"
					>↺ Try Again</button>
					<button
						onclick={goToMenu}
						class="px-6 py-2 rounded-xl active:scale-95 text-sm font-medium border transition-all duration-150
						       {darkMode
						           ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
						           : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'}"
					>← Main Menu</button>
				</div>
			</div>
		{/if}
	</main>
{/if}
