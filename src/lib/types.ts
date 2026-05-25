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
