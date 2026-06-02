export type Direction = 'N' | 'S' | 'E' | 'W';

export interface GridPos {
  x: number; // column, 0 = left
  y: number; // row, 0 = top
}

export interface Arrow {
  id: number;
  direction: Direction; // exit direction (where the arrow escapes the grid)
  path: GridPos[];      // path[0] = head (exit cell), path[-1] = tail
  color: string;
}

export interface Level {
  width: number;
  height: number;
  arrows: Arrow[];
  shape?: string; // shape id (heart/diamond/circle); undefined = classic rectangle
}

// ─── animation types ──────────────────────────────────────────────────────────
//
// One Anim per arrow currently animating. The `phase` discriminates which
// fields are populated:
//
//   exiting       — drain via stroke-dasharray + dashoffset along routeD.
//   blocked-fwd   — initial nudge toward the blocker (eased out).
//   blocked-back  — spring back to rest (eased in).
//   blocked-flash — red-flash penalty before the arrow becomes inert.

export type AnimPhase = 'exiting' | 'blocked-fwd' | 'blocked-back' | 'blocked-flash';

export interface Anim {
    phase:       AnimPhase;
    startTime:   number;
    totalSteps?: number;
    maxSteps?:   number;
    // drain animation (set when phase === 'exiting')
    routeD?:     string;  // SVG path string for the full route (tail → head → extension)
    L_total?:    number;  // total length of routeD in SVG units (cells)
    L_snake?:    number;  // length of just the snake portion = the visible "dash"
    durationMs?: number;  // total exit animation duration
}
