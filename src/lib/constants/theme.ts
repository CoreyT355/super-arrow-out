// ─── theme-aware arrow colors ────────────────────────────────────────────────

// Dark palette: bright pastels readable on dark backgrounds.
// Light palette: saturated -600/-700 variants readable on light backgrounds.
export const COLORS_DARK  = ['#f87171','#60a5fa','#4ade80','#c084fc','#fb923c','#f472b6','#facc15','#2dd4bf','#22d3ee','#a3e635'];
export const COLORS_LIGHT = ['#dc2626','#2563eb','#16a34a','#9333ea','#ea580c','#db2777','#a16207','#0d9488','#0891b2','#65a30d'];

export function themeColor(id: number, darkMode: boolean): string {
	return (darkMode ? COLORS_DARK : COLORS_LIGHT)[id % 10];
}
