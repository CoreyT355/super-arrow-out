// ─── pan / zoom action factory ───────────────────────────────────────────────
// Returns reactive scale/pan state plus the Svelte action that attaches
// touch and wheel gesture listeners to a container element.

const MIN_SCALE = 1;
const MAX_SCALE = 8;

export function createPanZoom() {
	let scale = $state(1);
	let panX  = $state(0);
	let panY  = $state(0);

	// Non-reactive gesture tracking (mutated freely, never drives rendering directly)
	let _node:     HTMLElement | null = null;
	let _activeT   = new Map<number, { x: number; y: number }>();
	let _panX0     = 0, _panY0 = 0;
	let _t0        = { x: 0, y: 0 };
	let _didMove   = false;
	let _pinchD0   = 0, _pinchS0 = 1, _pinchPX0 = 0, _pinchPY0 = 0;
	let _pinchMid  = { x: 0, y: 0 };

	function clampPan(px: number, py: number, s: number) {
		if (!_node) return { x: px, y: py };
		const { width: w, height: h } = _node.getBoundingClientRect();
		return {
			x: s <= 1 ? 0 : Math.min(0, Math.max(w * (1 - s), px)),
			y: s <= 1 ? 0 : Math.min(0, Math.max(h * (1 - s), py)),
		};
	}

	function onTouchStart(e: TouchEvent) {
		for (const t of Array.from(e.changedTouches))
			_activeT.set(t.identifier, { x: t.clientX, y: t.clientY });

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
		e.preventDefault(); // must be non-passive; see action setup below
		for (const t of Array.from(e.changedTouches))
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
		for (const t of Array.from(e.changedTouches))
			_activeT.delete(t.identifier);

		if (_activeT.size === 1) {
			// Dropped to 1 finger — reset single-touch pan baseline
			const [t] = _activeT.values();
			_t0 = { ...t }; _panX0 = panX; _panY0 = panY; _didMove = false;
		}
		// Snap back to unzoomed if barely zoomed
		if (_activeT.size === 0 && scale < 1.05) reset();
	}

	// All pointer listeners go through the action so passive flags are explicit.
	// touchmove must be non-passive to allow preventDefault() which stops the
	// browser from claiming the gesture as a scroll before we can pan.
	function action(node: HTMLElement) {
		_node = node;

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

		node.addEventListener('touchstart',  onTouchStart, { passive: true  });
		node.addEventListener('touchmove',   onTouchMove,  { passive: false }); // ← non-passive
		node.addEventListener('touchend',    onTouchEnd,   { passive: true  });
		node.addEventListener('touchcancel', onTouchEnd,   { passive: true  });
		node.addEventListener('wheel',       onWheel,      { passive: false });

		return {
			destroy() {
				node.removeEventListener('touchstart',  onTouchStart);
				node.removeEventListener('touchmove',   onTouchMove);
				node.removeEventListener('touchend',    onTouchEnd);
				node.removeEventListener('touchcancel', onTouchEnd);
				node.removeEventListener('wheel',       onWheel);
				_node = null;
			}
		};
	}

	function reset() { scale = 1; panX = 0; panY = 0; }

	/** Whether the last touch sequence moved enough to count as a pan (not a tap). */
	function didMove() { return _didMove; }

	return {
		action,
		reset,
		didMove,
		get scale() { return scale; },
		get panX()  { return panX;  },
		get panY()  { return panY;  },
	};
}
