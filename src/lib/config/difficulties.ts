// ─── difficulty config ──────────────────────────────────────────────────────

// cells: target cell count for adaptive grids; square: always use equal W/H
export const DIFFICULTIES = [
	{ label: 'Easy',       cells:    36, square: true,  color: 'from-emerald-500 to-emerald-600', ring: 'ring-emerald-400', chartColor: '#10b981', hidden: false },
	{ label: 'Normal',     cells:    81, square: true,  color: 'from-sky-500 to-sky-600',         ring: 'ring-sky-400',     chartColor: '#0ea5e9', hidden: false },
	{ label: 'Hard',       cells:   256, square: false, color: 'from-violet-500 to-violet-600',   ring: 'ring-violet-400',  chartColor: '#8b5cf6', hidden: false },
	{ label: 'Super Hard', cells:  1024, square: false, color: 'from-orange-500 to-orange-600',   ring: 'ring-orange-400',  chartColor: '#f97316', hidden: false },
	{ label: 'Expert',     cells:  4096, square: false, color: 'from-rose-600 to-rose-700',       ring: 'ring-rose-400',    chartColor: '#e11d48', hidden: false },
	{ label: 'Ludicrous', cells: 16384, square: false, color: 'from-fuchsia-500 to-fuchsia-600', ring: 'ring-fuchsia-400', chartColor: '#d946ef', hidden: false,
	  bgStyle: 'background:repeating-linear-gradient(0deg,transparent 0px,transparent 7px,rgba(255,255,255,0.18) 7px,rgba(255,255,255,0.18) 9px,transparent 9px,transparent 19px,rgba(255,255,255,0.28) 19px,rgba(255,255,255,0.28) 21px),repeating-linear-gradient(90deg,transparent 0px,transparent 7px,rgba(255,255,255,0.18) 7px,rgba(255,255,255,0.18) 9px,transparent 9px,transparent 19px,rgba(255,255,255,0.28) 19px,rgba(255,255,255,0.28) 21px),linear-gradient(135deg,#d946ef,#a21caf)' },
];

export const ENABLED_DIFFICULTIES = DIFFICULTIES.filter(d => !d.hidden);

// Compute W × H for a difficulty, fitting the current viewport aspect ratio.
export function computeGridSize(cells: number, square: boolean): { w: number; h: number } {
	const s = Math.round(Math.sqrt(cells));
	if (square || typeof window === 'undefined') return { w: s, h: s };
	// Available play area (rough estimate: 80px for button row + padding)
	const ratio = Math.max(0.4, Math.min(2.5, window.innerWidth / (window.innerHeight - 80)));
	const w = Math.max(4, Math.round(Math.sqrt(cells * ratio)));
	const h = Math.max(4, Math.round(Math.sqrt(cells / ratio)));
	return { w, h };
}

export function gridCaption(cells: number, square: boolean): string {
	const { w, h } = computeGridSize(cells, square);
	return `${w} × ${h} grid`;
}
