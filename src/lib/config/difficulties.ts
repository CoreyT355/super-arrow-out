// Difficulty configuration for the puzzle board.
//
// Each entry's `cells` is a TARGET cell count. The grid's actual W × H is
// derived by `computeGridSize` so square difficulties stay square and
// non-square difficulties adapt to the player's viewport aspect ratio.
//
// `hidden: true` keeps an entry out of the rendered start-menu list while
// preserving the metadata for cases where the level was already started
// from a saved-puzzle blob (e.g. the secret Iron Tangle).
//
// `unlockedBy` reveals an otherwise-hidden entry once the named difficulty
// has at least one recorded win (summed across shapes) — that's how The Iron
// Tangle surfaces after the player clears Ludicrous on any shape.

import { winsForDifficulty } from '$lib/utils/winKey';

export interface Difficulty {
    label:       string;
    cells:       number;
    square:      boolean;
    color:       string;       // Tailwind gradient classes
    ring:        string;       // Tailwind focus-ring classes
    chartColor:  string;       // hex used by the stats donut
    hidden:      boolean;
    bgStyle?:    string;       // optional inline CSS overrides (Ludicrous + Iron Tangle)
    unlockedBy?: string;       // label whose first win reveals this hidden entry
}

export const DIFFICULTIES: Difficulty[] = [
    { label: 'Easy',       cells:    36, square: true,  color: 'from-emerald-500 to-emerald-600', ring: 'ring-emerald-400', chartColor: '#10b981', hidden: false },
    { label: 'Normal',     cells:    81, square: true,  color: 'from-sky-500 to-sky-600',         ring: 'ring-sky-400',     chartColor: '#0ea5e9', hidden: false },
    { label: 'Hard',       cells:   256, square: false, color: 'from-violet-500 to-violet-600',   ring: 'ring-violet-400',  chartColor: '#8b5cf6', hidden: false },
    { label: 'Super Hard', cells:  1024, square: false, color: 'from-orange-500 to-orange-600',   ring: 'ring-orange-400',  chartColor: '#f97316', hidden: false },
    { label: 'Expert',     cells:  4096, square: false, color: 'from-rose-600 to-rose-700',       ring: 'ring-rose-400',    chartColor: '#e11d48', hidden: false },
    { label: 'Ludicrous', cells: 14000, square: false, color: 'from-fuchsia-500 to-fuchsia-600', ring: 'ring-fuchsia-400', chartColor: '#d946ef', hidden: false,
      bgStyle: 'background:repeating-linear-gradient(0deg,transparent 0px,transparent 7px,rgba(255,255,255,0.18) 7px,rgba(255,255,255,0.18) 9px,transparent 9px,transparent 19px,rgba(255,255,255,0.28) 19px,rgba(255,255,255,0.28) 21px),repeating-linear-gradient(90deg,transparent 0px,transparent 7px,rgba(255,255,255,0.18) 7px,rgba(255,255,255,0.18) 9px,transparent 9px,transparent 19px,rgba(255,255,255,0.28) 19px,rgba(255,255,255,0.28) 21px),linear-gradient(135deg,#d946ef,#a21caf)' },
    { label: 'The Iron Tangle', cells: 26000, square: false, color: 'from-zinc-500 to-zinc-700', ring: 'ring-zinc-400', chartColor: '#71717a', hidden: true, unlockedBy: 'Ludicrous',
      bgStyle: 'background:linear-gradient(rgba(0,0,0,0.25),rgba(0,0,0,0.25)),url(/iron-tangle-bg.svg) center/cover,linear-gradient(135deg,#52525b,#27272a);text-shadow:0 1px 3px rgba(0,0,0,0.7)' },
];

/** Difficulties the start menu surfaces. Hidden entries still exist in
 *  `DIFFICULTIES` so an old saved puzzle from a hidden difficulty can
 *  still find its metadata. */
export const ENABLED_DIFFICULTIES: Difficulty[] = DIFFICULTIES.filter(d => !d.hidden);

/** Difficulties to surface given the player's win record. Starts from the
 *  always-enabled set, then reveals any hidden entry whose `unlockedBy`
 *  difficulty has at least one win (e.g. The Iron Tangle after Ludicrous).
 *  Order follows `DIFFICULTIES`, so unlocked entries slot into their natural
 *  position rather than being appended. */
export function visibleDifficulties(wins: Record<string, number>): Difficulty[] {
    return DIFFICULTIES.filter(
        d => !d.hidden || (d.unlockedBy != null && winsForDifficulty(wins, d.unlockedBy) > 0),
    );
}

/** Compute the grid W × H for a difficulty target.
 *
 *  Square difficulties always use `√cells × √cells`. Non-square difficulties
 *  bias toward the viewport's aspect ratio so the board fills the visible
 *  play area. Returns the square form on the server (`window` undefined).
 *
 *  The 80px subtracted from height is a rough top-bar + bottom-padding
 *  estimate — historical value, kept the same so existing puzzles remain
 *  identical. */
export function computeGridSize(cells: number, square: boolean): { w: number; h: number } {
    const s = Math.round(Math.sqrt(cells));
    if (square || typeof window === 'undefined') return { w: s, h: s };
    const ratio = Math.max(0.4, Math.min(2.5, window.innerWidth / (window.innerHeight - 80)));
    const w = Math.max(4, Math.round(Math.sqrt(cells * ratio)));
    const h = Math.max(4, Math.round(Math.sqrt(cells / ratio)));
    return { w, h };
}

/** Format a difficulty as the "W × H grid" caption shown on each button. */
export function gridCaption(cells: number, square: boolean): string {
    const { w, h } = computeGridSize(cells, square);
    return `${w} × ${h} grid`;
}
