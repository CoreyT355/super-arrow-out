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
}

export type Phase = 'exiting' | 'blocked-fwd' | 'blocked-back' | 'blocked-flash';

export interface Anim {
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
