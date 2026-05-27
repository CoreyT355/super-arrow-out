// ─── easing helpers ──────────────────────────────────────────────────────────

export function easeOut(t: number): number { return 1 - (1 - t) ** 2; }
export function easeIn(t:  number): number { return t * t; }
