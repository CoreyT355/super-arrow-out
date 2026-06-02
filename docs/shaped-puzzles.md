# Shaped Puzzles — Design & Implementation Plan

> Status: implemented (Phases 1–5 complete; per-shape progress wired)
> Branch: `feature/shaped-puzzles`
> Last updated: 2026-06-01

Lets a puzzle be masked to a shape (heart, diamond, circle, …) so the snakes
fill only the shape's area. Shape is layered on top of the existing difficulty
system as a **difficulty × shape matrix**.

---

## 1. Core model

A shape is a **mask** over the normal rectangular grid. Arrows are generated to
fill **only in-shape cells**; out-of-shape cells stay permanently empty.

### Exit rule: "transparent outside"

An arrow exits when every **in-shape** cell along its facing ray is clear.
Out-of-shape cells are *see-through* — they never block — and the **rectangle
edge remains the visual finish line** (the snake slides fully off-screen as
today).

The big consequence: **the runtime barely changes.**

- `checkBlocked` already treats only *occupied arrow cells* as walls and walks
  to the rectangle edge. Out-of-shape cells never hold an arrow, so they are
  already transparent. **No change needed.**
- `buildFullRoute` / the drain animation already slide to the rectangle edge.
  **No change needed.**

All mask-awareness concentrates in the **generator**.

---

## 2. Resolved design decisions

| Topic | Decision |
| --- | --- |
| Exit semantics | Transparent outside (in-shape cells must clear; rectangle edge = finish) |
| Mask authoring | SVG path in 0–1 space, rasterized via point-in-polygon (cell center inside = in) |
| Post-raster cleanup | Keep largest connected component; enforce per-shape min filled-cell count |
| Access model | Difficulty × shape **matrix** |
| Menu UX | Difficulty first → shape **bottom sheet**; Classic first/highlighted; skip sheet if only Classic is eligible |
| Cell-count meaning | Difficulty count = target **filled (in-shape)** cells; iterate scale until filled ≈ target |
| Aspect ratio | Grid uses the **viewport-adaptive aspect** (same as classic) so the board fills the same on-screen area; the shape is **contain-fit + centred** inside (undistorted), with the leftover band as out-of-shape padding. Pan/zoom therefore uses the whole area, not a small box. |
| Eligibility | Per-shape **minimum filled-cell** threshold; a difficulty offers a shape only if its target clears the min |
| Board look | Grid **clipped to mask** + **faint silhouette** behind; vortex fade rect also clipped |
| Win attribution | **Per-shape** tracking via composite keys (`"Normal"` = classic, `"Normal#heart"` = shaped) |
| Iron Tangle unlock | **Any** Ludicrous win (any shape) unlocks it; Iron Tangle itself stays **Classic-only** |
| v1 shapes | Classic (always), **Heart, Diamond, Circle**. Star deferred. |

**Out of scope here:** tagging GA analytics events by shape — that lives on the
`feat/google-analytics` branch and gets wired when the two merge.

---

## 3. Key engineering risk (de-risk first)

The deterministic solvability repair (`repairDeadlocks` / `repointHeadAt` in
`puzzleGenerator.ts`) relies on this invariant:

> The global topmost-then-leftmost surviving (deadlocked) cell can be re-pointed
> to exit **North or West**, and that ray passes only through **non-survivors**.

Under transparent-outside this *should* still hold — any cell strictly north of
the extreme cell is a non-survivor by extremity, whether or not the ray crosses
out-of-shape gaps. **But it must be proven against the seeded test harness on
heart/concave masks before we trust it.** This is the most likely place to need
iteration, so Phase 1 below tackles it first.

Secondary generator risks:
- **Dead pockets** at concave boundaries (heart notch) — the existing
  `hasDeadPocketNear` / rescue passes should cover it, but watch short-arrow
  counts.
- **Eligibility math** must guarantee a connected mask above the min count at
  the chosen scale.

---

## 4. Data model changes

### `src/lib/types.ts`
```ts
export interface Level {
  width: number;
  height: number;
  arrows: Arrow[];
  shape?: string;   // shape id; undefined/"classic" = rectangle
}
```

### New: `src/lib/config/shapes.ts`
```ts
export interface Shape {
  id: string;            // "heart" | "diamond" | "circle" | "classic"
  label: string;
  svgPath: string;       // in 0..1 space (omit for "classic")
  aspect: number;        // natural w/h
  minFilled: number;     // eligibility threshold (target filled cells)
  maxFilled?: number;    // optional cap
  icon: string;          // small svg path for the menu chip
}

export const SHAPES: Shape[];          // includes "classic"
export const NON_CLASSIC_SHAPES: Shape[];

/** Cell is in-shape iff its center is inside the (largest connected) mask. */
export function rasterizeShape(shape: Shape, w: number, h: number): boolean[]; // length w*h

/** Iterate scale to hit ~targetFilled in-shape cells at the shape's aspect. */
export function computeShapedGridSize(
  shape: Shape, targetFilled: number,
): { w: number; h: number; mask: boolean[]; filled: number };

/** Shapes eligible at a given target filled-cell count. */
export function eligibleShapes(targetFilled: number): Shape[];
```

`rasterizeShape` helpers: point-in-polygon (ray cast) against a flattened
polyline of the SVG path, then a flood-fill to keep the largest connected
component.

### `src/lib/config/difficulties.ts`
- Keep `cells` as the target. For shaped starts, `cells` is interpreted as
  **target filled cells** and fed to `computeShapedGridSize`. Classic keeps
  `computeGridSize` unchanged.

### Win-key helper (progress)
```ts
// "Normal" (classic) | "Normal#heart" (shaped)
export function winKey(difficultyLabel: string, shapeId?: string): string;
```
Iron Tangle unlock: sum all keys whose difficulty part is `"Ludicrous"`.

### `src/lib/stores/resume.svelte.ts`
- Add `shape?: string` to `ResumeData`; persist + sanitize it.
- The saved puzzle blob is a `Level`, which now carries `shape`. On resume,
  re-derive the mask from `shape + W + H` for rendering.

---

## 5. Generator changes (`puzzleGenerator.ts`)

Thread an optional `mask: boolean[]` (length `w*h`, indexed `y*w+x`) through
generation. When `mask` is undefined, behavior is **byte-for-byte unchanged**
(classic path).

- `inBounds(x,y)` → effectively `inBounds && inMask`. Introduce
  `inShape(x,y) = inBounds(x,y,w,h) && mask[y*w+x]`.
- `clearPathToEdge`: out-of-shape cells are **clear** (skip, keep walking);
  in-shape **empty** cells still block. Reaching the rectangle edge OR stepping
  out of the shape into permanently-empty space = clear exit.
- `getExitDirs`: a cell can exit a direction if the next step leaves the shape,
  or the in-shape cells along the ray are occupied (via the updated
  `clearPathToEdge`).
- Body growth / seed queue: only consider **in-shape** cells.
- `fillEmptyCells`, `rescueEmptyRegions`, `hasDeadPocketNear`: only treat
  in-shape cells as fillable; out-of-shape cells are never "empty to fill".
- `deadlockSurvivors` / `repairDeadlocks` / `repointHeadAt` / `isSelfBlocked`:
  walk rays with `inShape` semantics (out-of-shape transparent). Re-verify the
  repair invariant (see §3).
- `emptyCount` initialized to the **filled-cell count**, not `w*h`.
- Public entry: `generateLevel(w, h, seed?, mask?)`; return `{ ...level, shape }`.

### Worker
`src/lib/workers/workerBridge.ts` + `puzzleGenerator.worker.ts`: pass
`shape`/`mask` (or shape id + dims and rasterize inside the worker) and return
`shape` on the `Level`.

---

## 6. UI changes

### `MenuScreen.svelte`
- Tapping a difficulty: compute `eligibleShapes(d.cells)`.
  - If only Classic → start immediately (current behavior).
  - Else → open a **shape bottom sheet** (Classic first/highlighted, then
    eligible shapes as icon chips). Selecting one starts the game.
- `onStart` signature becomes a request: `(cells, shapeId)` (or a
  `StartRequest`-shaped object). `+page.svelte` threads `shapeId` into the
  `{ kind: 'new', cells, square, shape }` request.

New component: `ShapeSheet.svelte` (bottom sheet, trap-focus, reduced-motion
aware — mirror existing overlay patterns).

### `GameScreen.svelte`
- Boot ('new'): `computeShapedGridSize(shape, cells)` → `{ w, h, mask }`; pass
  `mask` to the worker; store `shape` on the level + resume meta.
- Win effect: increment `winKey(currentDifficulty, shapeId)`.
- Thread `mask` (and shape silhouette path) to `Board`.

### `Board.svelte`
- Add `mask` + `shapePathD` (smooth path at grid scale) props.
- Define `<clipPath>` from `shapePathD`; clip the grid-background rect to it.
- Draw a faint silhouette (filled/outlined `shapePathD`) behind the grid.
- Clip the vortex fade `rect` to the same clip path.
- Classic (no mask) → render exactly as today.

### `StatsScreen.svelte`
- Donut: sum composite keys per difficulty (back-compat with bare keys).
- Add a per-shape breakdown section.

---

## 7. Implementation phases

**Phase 1 — Generator + mask (de-risk).** No UI.
1. `shapes.ts`: `rasterizeShape`, `computeShapedGridSize`, `eligibleShapes`,
   Heart/Diamond/Circle/Classic definitions.
2. Generalize `puzzleGenerator.ts` with optional `mask` (classic path
   unchanged).
3. **Seeded tests** (`puzzleGenerator.test.ts`): for each shape × several sizes
   × many seeds — assert full in-shape coverage, no out-of-shape arrows,
   `isPuzzleSolvable`, no self-blocks, connected mask, reasonable short-arrow
   counts. This validates the repair invariant before any UI exists.

**Phase 2 — Wiring.** Worker passes mask; `Level.shape`; resume meta + sanitize.

**Phase 3 — Rendering.** `Board` clip + silhouette + vortex clip; verify classic
unchanged.

**Phase 4 — Menu/matrix.** `ShapeSheet`, eligibility, `onStart`/request
threading, one-tap classic fast path.

**Phase 5 — Stats/progress.** `winKey`, composite-key aggregation, Iron Tangle
unlock sums Ludicrous across shapes, shape breakdown UI.

**Phase 6 — Polish & verify.** Reduced-motion, a11y on the sheet, Playwright
happy-path (start heart → win), perf sanity on large shaped boards.

---

## 8. Testing

- **Unit (vitest):** `rasterizeShape` (coverage %, connectivity),
  `computeShapedGridSize` (filled ≈ target, aspect), `eligibleShapes`,
  `winKey`, and the seeded generator suite from Phase 1.
- **E2E (playwright):** difficulty → shape sheet → start; classic fast path
  still one tap; resume restores a shaped puzzle with silhouette.
- **Manual:** heart at each eligible difficulty looks recognizable; no snakes
  outside the mask; drain still slides fully off-screen.

---

## 9. Open follow-ups (not v1)

- Star + other concave shapes once convex shapes prove the pipeline.
- GA event tagging by shape (after merge with `feat/google-analytics`).
- Optional "collect all shapes" achievements off the per-shape win data.
