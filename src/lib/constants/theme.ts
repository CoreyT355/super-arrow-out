import type { Direction } from '$lib/types';

// Theme-aware arrow palettes.
//
// Both arrays index arrow id mod 10 — colour assignment is deterministic
// per arrow once generation completes, so a snake's hue doesn't change
// between renders or after toggling dark mode.

/** Bright pastel palette — readable on dark backgrounds. */
export const COLORS_DARK = [
    '#f87171', // red-400
    '#60a5fa', // blue-400
    '#4ade80', // green-400
    '#c084fc', // purple-400
    '#fb923c', // orange-400
    '#f472b6', // pink-400
    '#facc15', // yellow-400
    '#2dd4bf', // teal-400
    '#22d3ee', // cyan-400
    '#a3e635', // lime-400
];

/** Saturated -600/-700 variants — readable on light backgrounds. */
export const COLORS_LIGHT = [
    '#dc2626', // red-600
    '#2563eb', // blue-600
    '#16a34a', // green-600
    '#9333ea', // purple-600
    '#ea580c', // orange-600
    '#db2777', // pink-600
    '#a16207', // yellow-700 (the -600 variant is too low-contrast)
    '#0d9488', // teal-600
    '#0891b2', // cyan-600
    '#65a30d', // lime-600
];

/** Arrowhead rotation (degrees, SVG screen-space) for each exit direction.
 *  E points right (0°), then clockwise: S = 90, W = 180, N = 270. */
export const DIR_ROT: Record<Direction, number> = {
    E: 0,
    S: 90,
    W: 180,
    N: 270,
};

/** Unit step vector for each exit direction in grid space (y axis points
 *  down). Used by drain-direction math and the blocked-arrow nudge. */
export const DELTA: Record<Direction, { dx: number; dy: number }> = {
    N: { dx: 0, dy: -1 },
    S: { dx: 0, dy: 1 },
    E: { dx: 1,  dy: 0 },
    W: { dx: -1, dy: 0 },
};
