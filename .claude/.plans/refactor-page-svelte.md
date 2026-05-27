# Refactor +page.svelte: extract utilities, stores, action, and screen components

## Context

`src/routes/+page.svelte` has grown to **1,414 lines** and houses the entire game: state declarations, persistence, animation math, RAF loop, gesture handling, theme palette, three full screens (menu / stats / game), win-loss effects, and the vortex animation. The codebase has clean utilities in `src/lib/utils/puzzleGenerator.ts` and `src/lib/types.ts` but no other modular structure — `+layout.svelte` is the only other Svelte file.

The goal is to break this monolith into a tree of small, single-purpose modules while preserving every existing behavior. Decisions confirmed with the user:

- **Scope: balanced** — extract pure utilities, persistence/session stores, and the pan/zoom action. Keep the RAF loop, click handler, vortex spawn, and win/loss effects co-located with the game screen.
- **Screen split: yes** — `MenuScreen.svelte`, `StatsScreen.svelte`, `GameScreen.svelte` become separate files. `+page.svelte` becomes a thin router.

Expected outcome: `+page.svelte` shrinks from 1,414 → ~50 lines (just routing); the largest remaining file (`GameScreen.svelte`) is ~600 lines, with the rest in small focused modules.

---

## Architecture overview

```
src/lib/
├── config/
│   └── difficulties.ts          ← DIFFICULTIES, ENABLED_DIFFICULTIES, computeGridSize, gridCaption
├── constants/
│   ├── timing.ts                ← MS_PER_STEP, NUDGE_FWD/BACK, FLASH_HALF, EXIT_*, VORTEX_*
│   └── theme.ts                 ← COLORS_DARK, COLORS_LIGHT, themeColor(id, darkMode)
├── utils/
│   ├── svgPath.ts               ← roundedPath, SPARKLE_PATH, buildFullRoute, measurePath (singleton)
│   ├── snakeMath.ts             ← extPos, segPos, exitCellCount(arrow, W, H)
│   ├── easing.ts                ← easeIn, easeOut
│   └── animTiming.ts            ← computeS, isFlashRed (pure functions over Anim + elapsed)
├── stores/
│   ├── settings.svelte.ts       ← reactive settings + load/save (showGrid, roundedCorners, darkMode, winAnimation)
│   ├── progress.svelte.ts       ← reactive progress + streak + savedPuzzle, with load/save effects
│   └── session.svelte.ts        ← screen state ('menu'|'stats'|'game'), currentDifficulty, navigation actions
├── actions/
│   └── panZoom.svelte.ts        ← createPanZoom() factory returning {action, scale, panX, panY, reset}
└── components/
    ├── MenuScreen.svelte        ← title, difficulty buttons, settings overlay, stats link
    ├── StatsScreen.svelte       ← top bar, streak cards, donut chart, legend
    └── GameScreen.svelte        ← top bar, settings drawer, SVG board, vortex, loading/win/lose overlays
                                    OWNS: RAF loop, handleClick, vortex spawn, win/loss effects,
                                          game session state (level, removed, anims, lives, etc.)

src/routes/
└── +page.svelte                  ← Thin router: reads session.screen and renders the right component
```

### Why screens own different layers of state

- **`settings`, `progress`, `streak`** — read by multiple screens, so they live in stores
- **`session.screen` / `currentDifficulty`** — drives routing, so it lives in a tiny navigation store
- **`level`, `removed`, `anims`, `lives`, `markedRed`, `vortexAnim`, etc.** — only the game is active; this state lives inside `GameScreen.svelte` (no need for a global store)
- **`pathRefs`, `now`, RAF `rafId`** — render-loop concerns, stay in `GameScreen.svelte`

This avoids putting game-session state into a global store just because we split screens. Stores hold what's actually shared.

---

## Module-by-module breakdown

### 1. Pure utility modules (plain `.ts`)

#### `src/lib/config/difficulties.ts`
Move `DIFFICULTIES`, `ENABLED_DIFFICULTIES`, `computeGridSize(cells, square, ratio?)`, `gridCaption(cells, square)` from lines 8–37. All pure; `computeGridSize` already takes optional `ratio` for testability.

#### `src/lib/constants/timing.ts`
Move all timing constants from lines 117–125 (game) and the vortex constants from lines 122–124. Export as named consts.

#### `src/lib/constants/theme.ts`
Move `COLORS_DARK`, `COLORS_LIGHT` from lines 627–628. Refactor `themeColor(id)` to take an explicit `darkMode: boolean` parameter so it stays pure.

#### `src/lib/utils/svgPath.ts`
- `roundedPath(pts, r)` (lines 302–335) — pure SVG path builder
- `SPARKLE_PATH` constant (lines 167–169)
- `buildFullRoute(arrow, W, H, roundedCorners)` (lines 392–403) — refactor to take params instead of reading component state
- `measurePath(d)` (lines 372–387) — keep singleton SVG measurer here since it's the only DOM-touching helper and it's already lazily initialized

#### `src/lib/utils/snakeMath.ts`
- `extPos(path, i, d)`, `segPos(path, k, s, d)` (lines 344–354) — already pure
- `exitCellCount(arrow, W, H)` (lines 358–364) — refactor to take `W, H` as params

#### `src/lib/utils/easing.ts`
- `easeIn(t)`, `easeOut(t)` (lines 339–340)

#### `src/lib/utils/animTiming.ts`
- `computeS(anim, elapsed, NUDGE_FWD, NUDGE_BACK)` (lines 409–416) — pure if timing constants passed in or imported here
- `isFlashRed(anim, elapsed, FLASH_HALF)` (lines 418–420)

### 2. Stores (`.svelte.ts`)

Svelte 5 runes work in `.svelte.ts` files. Each store exports reactive state and the auto-save effect.

#### `src/lib/stores/settings.svelte.ts`

```ts
const SETTINGS_KEY = 'arrow-out-settings';

interface Settings { showGrid: boolean; roundedCorners: boolean; darkMode: boolean; winAnimation: boolean }

function load(): Settings { /* ... existing loadSettings logic ... */ }
function save(s: Settings) { /* ... */ }

export const settings = $state<Settings>(load());

// Auto-save effect runs in modules that subscribe — use $effect.root for module-level reactivity
$effect.root(() => {
  $effect(() => { save({ ...settings }); });
});
```

Imported as `import { settings } from '$lib/stores/settings.svelte.ts';` then read `settings.darkMode` etc.

#### `src/lib/stores/progress.svelte.ts`
Move `STORAGE_KEY`, `PUZZLE_KEY`, `STREAK_KEY`, all four load/save fn pairs (lines 41–103). Export reactive:

```ts
export const progress = $state<Record<string, number>>(loadProgress());
export const streak   = $state<{ current: number; best: number }>(loadStreak());
export function savePuzzle(lvl: Level): void { /* ... */ }
export function loadSavedPuzzle(): Level | null { /* ... */ }
```

Auto-save effects for `progress` and `streak` registered via `$effect.root`.

#### `src/lib/stores/session.svelte.ts`
Tiny navigation/session store:

```ts
type Screen = 'menu' | 'stats' | 'game';

export const session = $state<{
  screen: Screen;
  currentDifficulty: string | null;
  W: number;
  H: number;
  cellsRequested: number;
  squareRequested: boolean;
}>({
  screen: 'menu',
  currentDifficulty: null,
  W: 9, H: 9,
  cellsRequested: 9,
  squareRequested: true,
});

export function goToMenu()  { session.screen = 'menu'; }
export function goToStats() { session.screen = 'stats'; }
export function goToGame(label: string, cells: number, square: boolean) {
  session.currentDifficulty = label;
  session.cellsRequested = cells;
  session.squareRequested = square;
  session.screen = 'game';
}
```

`GameScreen` reads `W`, `H`, `cellsRequested`, `squareRequested` to know what to generate. `MenuScreen` calls `goToGame()`.

### 3. Pan/zoom action

#### `src/lib/actions/panZoom.svelte.ts`

Factory that returns reactive scale/pan plus the Svelte action. Encapsulates all gesture state (the 9 `_*` non-reactive vars):

```ts
export function createPanZoom() {
  let scale = $state(1);
  let panX  = $state(0);
  let panY  = $state(0);

  // ... all non-reactive _activeT, _panX0, etc. as closures ...
  // ... onTouchStart, onTouchMove, onTouchEnd, onWheel implementations ...

  function action(node: HTMLElement) {
    // attach listeners, return destroy
  }

  function reset() { scale = 1; panX = 0; panY = 0; }

  return {
    action,
    reset,
    get scale() { return scale; },
    get panX()  { return panX; },
    get panY()  { return panY; },
  };
}
```

Consumed in `GameScreen.svelte`:
```ts
const pz = createPanZoom();
// template: use:pz.action  +  transform="translate({pz.panX},{pz.panY}) scale({pz.scale})"
```

### 4. Screen components (`.svelte`)

#### `src/lib/components/MenuScreen.svelte`
Move template lines 700–882 (title, difficulty buttons, settings overlay, stats button). Imports:
- `settings` from settings store (for darkMode + toggles)
- `progress` from progress store (for win counts on buttons)
- `goToGame, goToStats` from session store
- `DIFFICULTIES, ENABLED_DIFFICULTIES, gridCaption` from config

No props needed — everything comes from stores.

#### `src/lib/components/StatsScreen.svelte`
Move template lines 884–975 (top bar, streak cards, donut, legend) plus the `chartSegments` / `totalWins` derived calculations (lines 588–611). Imports:
- `settings` (darkMode)
- `progress`, `streak`
- `goToMenu` from session
- `DIFFICULTIES, ENABLED_DIFFICULTIES, themeColor` from config/theme

#### `src/lib/components/GameScreen.svelte`
**The big one** (~600 lines). Owns the entire game session. Move template lines 978–1414 plus all of:
- Game session `$state`: `level`, `removed`, `markedRed`, `anims`, `lives`, `winCounted`, `lostCounted`, `now`, `rafId`, `pathRefs`
- Vortex `$state`: `vortexAnim`, `vortexParticles`
- Derived: `won`, `lost`, `staticArrowData`, `vortexP`, `vortexDone`
- `handleClick`, `loop` (RAF), `checkBlocked`, `generateInWorker`, `startGame`, `reset`
- Win/loss `$effect`s (update progress/streak via store actions; spawn vortex)
- The puzzle worker import

Reads from stores: `settings.darkMode`, `settings.showGrid`, `settings.roundedCorners`, `settings.winAnimation`, `session.cellsRequested`, `session.squareRequested`, `session.currentDifficulty`, `progress` (for the `currentPuzzle` reload on mount).

`onMount` of `GameScreen` reads `session.cellsRequested/squareRequested` and starts the game (or loads the saved puzzle).

### 5. `+page.svelte` (router)

Reduces to ~50 lines:

```svelte
<script lang="ts">
  import { session } from '$lib/stores/session.svelte.ts';
  import MenuScreen  from '$lib/components/MenuScreen.svelte';
  import StatsScreen from '$lib/components/StatsScreen.svelte';
  import GameScreen  from '$lib/components/GameScreen.svelte';
</script>

{#if session.screen === 'menu'}
  <MenuScreen />
{:else if session.screen === 'stats'}
  <StatsScreen />
{:else}
  <GameScreen />
{/if}
```

---

## Phased execution order

Each phase is a coherent commit-sized step. Run `pnpm dev` after each and verify nothing regresses by playing one round on Easy.

**Phase 1 — Pure utilities (lowest risk, biggest mechanical change)**
- Create `config/difficulties.ts`, `constants/timing.ts`, `constants/theme.ts`
- Create `utils/svgPath.ts`, `utils/snakeMath.ts`, `utils/easing.ts`, `utils/animTiming.ts`
- Update imports in `+page.svelte`; delete the now-extracted blocks
- Verify game still plays end-to-end

**Phase 2 — Stores**
- Create `stores/settings.svelte.ts`, `stores/progress.svelte.ts`
- Replace inline state and load/save calls in `+page.svelte` with store imports
- Verify settings persist; progress and streak still increment

**Phase 3 — Pan/zoom action**
- Create `actions/panZoom.svelte.ts`
- Replace inline gesture code and `_*` variables; consume `pz.scale/panX/panY/action`
- Verify pan, zoom, pinch on touch device + scroll wheel zoom on desktop

**Phase 4 — Session store + screen components**
- Create `stores/session.svelte.ts`
- Create `MenuScreen.svelte` — move menu template + button handlers
- Create `StatsScreen.svelte` — move stats template + chart derivations
- Create `GameScreen.svelte` — move everything else (game state, RAF loop, board, overlays, vortex)
- Rewrite `+page.svelte` as the 50-line router
- Verify all three screens render, transitions work, and the worker still generates puzzles on game start

---

## Tricky-case decisions (locked in)

| Concern | Decision |
|---|---|
| `checkBlocked` | Stays in `GameScreen` — too many dependencies (`level`, `removed`, `anims`, `W`) for clean extraction; pure-ifying it costs more than it saves |
| RAF `loop` state machine | Stays in `GameScreen` — tied to component-level `anims`/`removed` reactivity and vortex; extracting forces awkward callback wiring |
| Vortex animation | Stays in `GameScreen` — particle spawn is part of the win-effect; rendering is part of the SVG board |
| `measurePath` singleton | Moves to `svgPath.ts` — its lazy-init guard works fine module-scoped, and it's the only place that needs a DOM-level path measurer |
| Settings auto-save | Inside `settings.svelte.ts` via `$effect.root` — keeps persistence next to state |
| Game-session state | Lives inside `GameScreen.svelte` (no global store) — not used by other screens |
| Three screens | Become separate `.svelte` files; navigation via `session` store, not props |

---

## Critical files to touch

**Modified:**
- `/Users/coreytess/code/super-arrow-out/src/routes/+page.svelte` — shrinks to router

**Created** (under `/Users/coreytess/code/super-arrow-out/src/lib/`):
- `config/difficulties.ts`
- `constants/timing.ts`
- `constants/theme.ts`
- `utils/svgPath.ts`
- `utils/snakeMath.ts`
- `utils/easing.ts`
- `utils/animTiming.ts`
- `stores/settings.svelte.ts`
- `stores/progress.svelte.ts`
- `stores/session.svelte.ts`
- `actions/panZoom.svelte.ts`
- `components/MenuScreen.svelte`
- `components/StatsScreen.svelte`
- `components/GameScreen.svelte`

**Reused (no changes):**
- `src/lib/types.ts` — `Direction`, `GridPos`, `Arrow`, `Level`
- `src/lib/utils/puzzleGenerator.ts` — `generateLevel`
- `src/lib/workers/puzzleGenerator.worker.ts` — worker

---

## Verification

After each phase: `pnpm dev`, open the app, play through at least one Easy puzzle (win), one Normal puzzle (lose by exhausting lives). Specific things to verify after the full refactor:

1. **Menu screen** — difficulty buttons show win counts, settings overlay toggles work, stats link navigates
2. **Stats screen** — donut chart renders with correct segments, streak displays current and best, back button returns to menu
3. **Game screen** — board renders, click triggers exit/bounce animations correctly, lives decrement on blocked moves
4. **Pan/zoom** — pinch on touch, scroll-wheel on desktop, drag to pan, reset on new puzzle
5. **Win flow** — vortex animation plays, win panel appears after delay (no flash), progress + streak save
6. **Loss flow** — game-over panel appears, streak resets to 0
7. **Settings persistence** — toggle dark mode, reload page, verify it stuck
8. **Win animation toggle** — disable it, win a puzzle, verify panel appears immediately
9. **Try Again** — replays the same puzzle
10. **Build** — `pnpm build` succeeds with no TypeScript errors

Approximate diff size: `+page.svelte` goes from 1,414 lines → ~50 lines; total LOC across all new modules ~1,500 (similar total, but distributed and individually testable).
