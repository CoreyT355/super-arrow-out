# Game Development Plan: "Arrow Out" Clone
**Architecture, Level Generation, and Implementation Blueprint using SvelteKit, TypeScript, and Tailwind CSS**

---

## 1. Project Overview & Mechanics
"Arrow Out" is a spatial puzzle game played on an $N \times N$ grid. The board is populated by interlocking, multi-segmented arrows that twist at 90-degree angles. 

### Core Gameplay Rules:
1. **Selection:** The player clicks/taps an arrow.
2. **Trajectory Evaluation:** The selected arrow projects an exit ray from its forward-facing head along its designated orientation vector (North, South, East, or West) toward the boundary of the board.
3. **Collision Resolution:**
   - **Clear Path:** If the exit path and the coordinates occupied by the arrow's own body are entirely clear of intersections with any *other* active arrow bodies, the arrow animates linearly off the edge of the board and is permanently evicted from the game state.
   - **Obstructed Path:** If the ray intersects any coordinate occupied by another arrow body, the move is invalidated. The arrow triggers a visual visual disruption (shake animation) and remains fixed on the board.
4. **Win Condition:** The level is successfully completed when all arrows are evicted from the board.

---

## 2. Technical Stack Configuration

- **Framework:** **SvelteKit** (Configured as a Single-Page Application layout for state-driven views)
- **State System:** Svelte Native Reactivity (Utilizing Svelte 5 Runes for scalable structural bindings)
- **Styling & Presentation Engine:** **Tailwind CSS** (Utilizing arbitrary value interpolation and utility classes for positional rendering)
- **Graphics Pipeline:** Inline **SVG (Scalable Vector Graphics)** mapped across a responsive layout container to maintain pixel-perfect multi-segment scaling.

---

## 3. Data Architecture

The state of the board and individual entities must be explicitly structured to facilitate $O(1)$ coordinate-to-entity lookups and smooth layout transforms.

```typescript
export type Direction = 'N' | 'S' | 'E' | 'W';

export interface Point {
  x: number;
  y: number;
}

export interface ArrowData {
  id: string;
  points: Point[];          // Ordered collection of coordinates tracking from Tail [0] to Head [length - 1]
  exitDirection: Direction; // The architectural orientation the arrow head points towards
  color: string;            // Tailwind color configuration classes (e.g., 'stroke-red-500')
  isExiting: boolean;       // Reactive flag triggering the linear translation out of the viewport
  isBlocked: boolean;       // Reactive flag triggering the horizontal displacement shaking mechanism
}

export interface GameLevel {
  gridSize: number;
  arrows: ArrowData[];
}

```

---

## 4. Procedural Level Generation (The Inverse Simulation Pipeline)

Generating a valid, highly dense, and complex layout from scratch via forward random placement causes frequent logical deadlocks, resulting in unsolvable boards. To circumvent this, the generation pipeline relies entirely on a **Backward Trajectory Simulation Engine**.

Instead of determining how arrows exit, the algorithm calculates how arrows enter an empty board, constructing a mathematically sound **Directed Acyclic Graph (DAG)** of dependencies.

### Step-by-Step Generation Algorithm

1. **Initialization Phase:**
Create a global hash map or spatial tracking system `occupiedCells` containing stringified coordinate vectors (`"x,y"` format). This ensures $O(1)$ execution overhead during overlap checks.
2. **Growth Iteration Loop:**
For a specified count of total arrows $K$:
* **Boundary Seeding:** Select an edge index along the grid parameter boundaries. Establish the entry heading matching the inverse layout geometry:
* North Edge $\rightarrow$ Enters moving South (`S`)
* South Edge $\rightarrow$ Enters moving North (`N`)
* East Edge $\rightarrow$ Enters moving West (`W`)
* West Edge $\rightarrow$ Enters moving East (`E`)


* **Path Propagation:** Advance node-by-node into the system grid. At each spatial increment, evaluate a random decision tree:
* Maintain current heading velocity vector ($60\%$ weight).
* Shift vector direction by exactly $90^\circ$ perpendicular to current alignment ($40\%$ weight).


* **Collision Processing & Constraints:** Before writing a new cell coordinate to the active path buffer, verify:
1. The node coordinates are bound within $[0 \dots N-1]$.
2. The node coordinate string does not intersect with any element stored inside `occupiedCells`.
*If any constraint fails, discard the active workspace buffer, clear local iterations, and re-seed from a new boundary coordinate.*


* **Structural Finalization:** Once the arrow trace matches a randomly determined sequence depth (e.g., $3$ to $7$ cells long), terminate growth.
* The final cell location processed becomes the **Head** of the arrow object.
* The initial boundary node becomes the **Tail**.
* Invert the entry vector to set the logical `exitDirection` (ensuring it accurately matches the path leading back out off the board edge).


* **Global Memory Write:** Map all coordinate keys from the active workspace buffer into the main `occupiedCells` collection. Append the metadata properties into the global tracking grid.


3. **Forward Topological Validation Lifecycle:**
To ensure that complex turning patterns have not isolated an arrow or caused an unintentional interlocking block, execute a virtual solve pass before exporting the matrix data structures to the component state tree:
1. Clone the generated layout state array.
2. Iterate through elements to identify any arrow object where a computed exit ray boundary path contains zero coordinate intersections with other active entities.
3. If an unobstructed entity is found, pop it from the structural simulator tracking model and return to Step 2.
4. If the loop completes and all entities are successfully cleared, the level structural integrity is guaranteed. If entities remain but no valid exit transformations are found, discard the entire map data layout, reset generation routines, and rerun the algorithm.



---

## 5. Blueprint SvelteKit Component Architecture

### Implementation: Level Generator Utility

Create this file under `src/lib/utils/puzzleGenerator.ts`.

```typescript
import type { ArrowData, Point, Direction } from '$lib/types';

export function generateLevel(gridSize: number, arrowCount: number): ArrowData[] {
  let attempts = 0;
  while (attempts < 100) {
    attempts++;
    const arrows: ArrowData[] = [];
    const occupied = new Set<string>();

    for (let i = 0; i < arrowCount; i++) {
      const arrow = tryGenerateArrow(gridSize, occupied, `arrow-${i}`);
      if (arrow) {
        arrows.push(arrow);
        arrow.points.forEach(p => occupied.add(`${p.x},${p.y}`));
      }
    }

    if (arrows.length === arrowCount && validateLevel(arrows, gridSize)) {
      return arrows;
    }
  }
  throw new Error("Failed to generate a valid, solvable level layout within constraints.");
}

function tryGenerateArrow(gridSize: number, occupied: Set<string>, id: string): ArrowData | null {
  const edges = ['N', 'S', 'E', 'W'];
  const startEdge = edges[Math.floor(Math.random() * edges.length)];
  let x = 0, y = 0, dx = 0, dy = 0;

  // Configure boundary entry points based on edge placement
  if (startEdge === 'N') { x = Math.floor(Math.random() * gridSize); y = 0; dx = 0; dy = 1; }
  else if (startEdge === 'S') { x = Math.floor(Math.random() * gridSize); y = gridSize - 1; dx = 0; dy = -1; }
  else if (startEdge === 'E') { x = gridSize - 1; y = Math.floor(Math.random() * gridSize); dx = -1; dy = 0; }
  else if (startEdge === 'W') { x = 0; y = Math.floor(Math.random() * gridSize); dx = 1; dy = 0; }

  if (occupied.has(`${x},${y}`)) return null;

  const points: Point[] = [{ x, y }];
  const currentPathSet = new Set<string>([`${x},${y}`]);
  const targetLength = Math.floor(Math.random() * 4) + 3; // Length range: 3-6 cells

  for (let step = 1; step < targetLength; step++) {
    // 40% chance to turn 90 degrees if not on the first step
    if (step > 1 && Math.random() < 0.4) {
      const oldDx = dx;
      dx = dy;
      dy = -oldDx; // Perpendicular rotation transformation matrix logic
      if (Math.random() > 0.5) {
        dx = -dx;
        dy = -dy;
      }
    }

    const nextX = x + dx;
    const nextY = y + dy;

    // Boundary constraint evaluation
    if (nextX < 0 || nextX >= gridSize || nextY < 0 || nextY >= gridSize) return null;
    // Structural intersection evaluation
    if (occupied.has(`${nextX},${nextY}`) || currentPathSet.has(`${nextX},${nextY}`)) return null;

    x = nextX;
    y = nextY;
    points.push({ x, y });
    currentPathSet.add(`${x},${y}`);
  }

  // The final entry orientation points back out the way it entered the grid block
  const exitDirection: Direction = startEdge as Direction;
  const colors = [
    'stroke-red-500 fill-red-500', 
    'stroke-blue-500 fill-blue-500', 
    'stroke-green-500 fill-green-500', 
    'stroke-orange-500 fill-orange-500'
  ];
  const color = colors[Math.floor(Math.random() * colors.length)];

  return {
    id,
    points, // Note: ordered tail-to-head for storage
    exitDirection,
    color,
    isExiting: false,
    isBlocked: false
  };
}

function validateLevel(arrows: ArrowData[], gridSize: number): boolean {
  const simulatedArrows = JSON.parse(JSON.stringify(arrows)) as ArrowData[];
  let eliminatedAny = true;

  while (eliminatedAny && simulatedArrows.length > 0) {
    eliminatedAny = false;
    for (let i = 0; i < simulatedArrows.length; i++) {
      if (!checkCollision(simulatedArrows[i], simulatedArrows, gridSize)) {
        simulatedArrows.splice(i, 1);
        eliminatedAny = true;
        break;
      }
    }
  }
  return simulatedArrows.length === 0;
}

export function checkCollision(target: ArrowData, allArrows: ArrowData[], gridSize: number): boolean {
  const head = target.points[target.points.length - 1];
  let checkX = head.x;
  let checkY = head.y;
  let dx = 0, dy = 0;

  if (target.exitDirection === 'N') dy = -1;
  else if (target.exitDirection === 'S') dy = 1;
  else if (target.exitDirection === 'E') dx = 1;
  else if (target.exitDirection === 'W') dx = -1;

  // Build active occupancy lookups across remaining active paths
  const alternativePoints = new Set<string>();
  allArrows.forEach(arrow => {
    if (arrow.id !== target.id) {
      arrow.points.forEach(p => alternativePoints.add(`${p.x},${p.y}`));
    }
  });

  // Project vector beam to the map edge
  while (true) {
    checkX += dx;
    checkY += dy;
    if (checkX < 0 || checkX >= gridSize || checkY < 0 || checkY >= gridSize) {
      break; // Reached the edge without collision
    }
    if (alternativePoints.has(`${checkX},${checkY}`)) {
      return true; // Collided with another arrow path
    }
  }
  return false;
}

```

---

### Implementation: Game Engine Views & Interaction Layer

Create the layout files in `src/routes/+page.svelte`.

```svelte
<script lang="ts">
  import { generateLevel, checkCollision } from '$lib/utils/puzzleGenerator';
  import type { ArrowData } from '$lib/types';

  const GRID_SIZE = 8;
  const ARROW_COUNT = 12;

  let arrows = $state<ArrowData[]>([]);
  let gameWon = $state(false);

  function startNewGame() {
    arrows = generateLevel(GRID_SIZE, ARROW_COUNT);
    gameWon = false;
  }

  function handleArrowClick(id: string) {
    const index = arrows.findIndex(a => a.id === id);
    if (index === -1 || arrows[index].isExiting) return;

    const isBlocked = checkCollision(arrows[index], arrows, GRID_SIZE);

    if (isBlocked) {
      arrows[index].isBlocked = true;
      setTimeout(() => {
        arrows[index].isBlocked = false;
      }, 300);
    } else {
      arrows[index].isExiting = true;
      setTimeout(() => {
        arrows = arrows.filter(a => a.id !== id);
        if (arrows.length === 0) {
          gameWon = true;
        }
      }, 500);
    }
  }

  // Initialize on load
  $effect(() => {
    startNewGame();
  });
</script>

<main class="w-full min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white font-sans p-4">
  <div class="mb-6 flex flex-col items-center">
    <h1 class="text-4xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-400 mb-2">ARROW OUT</h1>
    <p class="text-slate-400 text-sm">Tap arrows to clear the path. Do not block your escape route.</p>
  </div>

  <div class="relative bg-slate-800 p-4 rounded-2xl shadow-2xl border border-slate-700/50">
    <div class="relative w-[80vw] h-[80vw] max-w-[500px] max-h-[500px]">
      {#each arrows as arrow (arrow.id)}
        <button 
          type="button"
          class="absolute inset-0 bg-transparent border-none p-0 cursor-pointer block w-full h-full focus:outline-none"
          onclick={() => handleArrowClick(arrow.id)}
        >
          <svg 
            viewBox="0 0 {GRID_SIZE} {GRID_SIZE}" 
            class="w-full h-full overflow-visible select-none pointer-events-none transition-transform duration-500 ease-in-out"
            class:animate-shake={arrow.isBlocked}
            class:-translate-y-[150%]={arrow.isExiting && arrow.exitDirection === 'N'}
            class:translate-y-[150%]={arrow.isExiting && arrow.exitDirection === 'S'}
            class:translate-x-[150%]={arrow.isExiting && arrow.exitDirection === 'E'}
            class:-translate-x-[150%]={arrow.isExiting && arrow.exitDirection === 'W'}
          >
            <path
              d={arrow.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x + 0.5} ${p.y + 0.5}`).join(' ')}
              class="{arrow.color.split(' ')[0]} stroke-[0.25] fill-none stroke-linecap-round stroke-linejoin-round pointer-events-auto"
            />
            
            {#get head = arrow.points[arrow.points.length - 1]}
              <polygon
                points="
                  {arrow.exitDirection === 'N' ? `${head.x+0.5},${head.y+0.2} ${head.x+0.3},${head.y+0.6} ${head.x+0.7},${head.y+0.6}` : ''}
                  {arrow.exitDirection === 'S' ? `${head.x+0.5},${head.y+0.8} ${head.x+0.3},${head.y+0.4} ${head.x+0.7},${head.y+0.4}` : ''}
                  {arrow.exitDirection === 'E' ? `${head.x+0.8},${head.y+0.5} ${head.x+0.4},${head.y+0.3} ${head.x+0.4},${head.y+0.7}` : ''}
                  {arrow.exitDirection === 'W' ? `${head.x+0.2},${head.y+0.5} ${head.x+0.6},${head.y+0.3} ${head.x+0.6},${head.y+0.7}` : ''}
                "
                class="{arrow.color.split(' ')[1]} pointer-events-auto"
              />
            {/get}
          </svg>
        </button>
      {/each}

      {#if gameWon}
        <div class="absolute inset-0 bg-slate-900/90 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center animate-fade-in z-50">
          <h2 class="text-3xl font-black text-emerald-400 mb-4 tracking-wide animate-bounce">LEVEL CLEARED!</h2>
          <button 
            type="button"
            onclick={startNewGame}
            class="px-6 py-3 bg-gradient-to-r from-teal-500 to-emerald-500 text-slate-950 font-bold rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all"
          >
            Next Puzzle
          </button>
        </div>
      {/if}
    </div>
  </div>

  <button 
    type="button"
    onclick={startNewGame}
    class="mt-6 px-5 py-2 bg-slate-800 text-slate-300 font-medium rounded-lg border border-slate-700/60 hover:bg-slate-700 transition-colors"
  >
    Reset Layout
  </button>
</main>

```

---

### Implementation: Tailwind Configuration Overrides

Extend your `tailwind.config.js` or `tailwind.config.ts` to include the custom animations required for directional blocking shakes.

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      animation: {
        shake: 'shake 0.25s ease-in-out',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-4px)' },
          '40%, 80%': { transform: 'translateX(4px)' },
        }
      }
    },
  },
  plugins: [],
}

```

---

## 6. Optimization, Refinement, & Polish Guidelines

1. **Path-to-Pointer Scaling Optimization:** In the SVG mapping layer, set `pointer-events-auto` strictly on the `<path>` and `<polygon>` elements, leaving the outer layout layers as `pointer-events-none`. This prevents bounding boxes from intercepting clicks when snakes overlap spatial grids.
2. **Animation Easing Curves:** Use dynamic easing classes when translating paths off-screen. An exponential acceleration feels crisp, identical to native mobile engine physics loops.
3. **Responsive Viewport Refinement:** Keep the target layout container constrained relative to viewport sizes (`w-[80vw] h-[80vw] max-w-[500px]`) to ensure the board scales uniformly on phone and desktop browsers alike.
