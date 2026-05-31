# Refactor Plan — `+page.svelte` Decomposition

**Branch:** `feature/refactor-all` (integration branch)
**Status:** Planned — not yet started
**Last updated:** 2026-05-28

---

## Goals

1. **Zero regressions.** Behavior, persistence, animations, and gestures must match `main` exactly. Visual polish that falls out naturally from extraction is acceptable; intentional UI changes are out of scope.
2. **Clearer separation of concerns.** `+page.svelte` is currently 1,793 lines holding three screens, persistence, gesture handling, the animation engine, the SVG board, and all overlays. Split into focused components and modules with clear ownership.
3. **Reusability where possible.** The settings panel is currently duplicated between the menu screen and the in-game menu — same UI inlined twice. Cross-cutting persistent state is read in many places. Both deserve single sources of truth.

## Non-goals

- Tailwind / CSS cleanup. Inline classes stay as-is.
- Adding features. Iron Tangle, resume puzzle, pencil tap, etc. all stay behaviorally identical.
- Rewriting `puzzleGenerator.ts`, `gestures.ts`, or `trapFocus.ts`. Those modules are already well-shaped.
- Component-level unit tests beyond the safety net and the pure-utility extractions.

---

## Why this attempt and not the last one

The prior refactor (`e073d10` on the abandoned `feature/refactor` branch) split `+page.svelte` into three screen components plus stores and utilities. It never merged. The post-mortem reasons we're designing around:

1. **It was one big PR with no atomic mergeable units.** When work paused, all of it was lost.
2. **`main` moved a lot during the refactor** (Iron Tangle difficulty, resume-puzzle feature, pencil tap fix, puzzle generator overhaul) and the branch drifted past the point of clean rebase.
3. **There was no safety net.** Without an executable contract for "the app still works", verifying zero regressions before merge was a manual slog — discouraging frequent integration.

This plan addresses each:

- **Atomic per-step PRs** into the integration branch, each independently mergeable.
- **Weekly merge cadence** from `main` into `feature/refactor-all` + a feature freeze on `main` while in flight.
- **Playwright e2e safety net built first** so every step PR can verify "still works" automatically.

---

## Strategy

### Delivery shape

- `feature/refactor-all` is the integration branch.
- Each refactor step gets its own short-lived branch off `feature/refactor-all`.
- Step branches open PRs targeted at `feature/refactor-all` (not `main`).
- When all steps are complete and the integration branch is stable, one final PR merges `feature/refactor-all` → `main`.
- If we abandon the refactor partway, the integration branch already contains atomic, individually-shippable improvements. Nothing is wasted.

### Branch hygiene

- **Feature freeze on `main`.** Only bug fixes land while the refactor is in flight. No new features.
- **Weekly merge from `main` into `feature/refactor-all`** (or immediately after any `main` commit, whichever is sooner). Keeps conflicts tiny.
- **No time target** — but every step PR is independently valuable, so we always have a salvageable stopping point.

### Regression bar

- **Behavioral identity.** Game logic, persistence, animations, gestures must produce the same observable outcomes as `main`.
- UI/UX polish that falls naturally out of extraction is permitted (consolidating duplicated panels, removing dead inline styles). Every such change is called out in the relevant PR description so reviewers can verify.
- **Verification = Playwright e2e + manual smoke test on real iPad.** The Playwright suite is the gate for each step PR.

---

## Target architecture

```
src/
├── routes/
│   ├── +layout.svelte                     (unchanged)
│   └── +page.svelte                       (~50 lines: thin router on gameState)
└── lib/
    ├── actions/
    │   └── panZoom.svelte.ts              (Svelte action: touch + pointer + wheel + pinch)
    ├── components/
    │   ├── MenuScreen.svelte              (start menu)
    │   ├── GameScreen.svelte              (owns runtime game state + RAF loop)
    │   ├── StatsScreen.svelte             (donut + breakdown)
    │   ├── Board.svelte                   (SVG board; uses panZoom action)
    │   ├── TopBar.svelte                  (hamburger + hearts + arrows-left)
    │   ├── SettingsPanel.svelte           (shared by Menu + Game; was duplicated)
    │   ├── ResumeCard.svelte              (resume puzzle card on menu)
    │   ├── DifficultyButton.svelte        (single difficulty card)
    │   ├── WinOverlay.svelte
    │   └── LoseOverlay.svelte
    ├── stores/
    │   ├── settings.svelte.ts             (darkMode, showGrid, roundedCorners, winAnimation)
    │   ├── progress.svelte.ts             (wins per difficulty + streak)
    │   └── resume.svelte.ts               (current puzzle save + removed/lives/markedRed)
    ├── config/
    │   └── difficulties.ts                (DIFFICULTIES array + grid-size math)
    ├── constants/
    │   ├── timing.ts                      (MS_PER_STEP, EXIT_DURATION, NUDGE_*, VORTEX_*)
    │   └── theme.ts                       (color palettes, DIR_ROT, INWARD)
    ├── utils/
    │   ├── puzzleGenerator.ts             (unchanged)
    │   ├── gestures.ts                    (unchanged — math)
    │   ├── trapFocus.ts                   (unchanged)
    │   ├── svgPath.ts                     (NEW: roundedPath, buildFullRoute, measurePath singleton)
    │   ├── snakeMath.ts                   (NEW: extPos, segPos, exitCellCount, checkBlocked)
    │   ├── easing.ts                      (NEW: easeOut, easeIn)
    │   ├── animTiming.ts                  (NEW: computeS, isFlashRed, animation phase helpers)
    │   └── persisted.ts                   (NEW: persisted<T>(key, defaults) helper)
    └── workers/
        ├── puzzleGenerator.worker.ts      (unchanged)
        └── workerBridge.ts                (NEW: generateInWorker promise wrapper)
```

### State model

| Kind | Owner | Pattern |
|---|---|---|
| Persistent settings (dark mode, grid, etc.) | `settings.svelte.ts` store | `$state`-backed, auto-persists via `$effect` |
| Persistent progress (wins per difficulty, streak) | `progress.svelte.ts` store | Same |
| Persistent resume (current puzzle save) | `resume.svelte.ts` store | Same |
| Runtime game state (level, removed, lives, anims, vortex) | `GameScreen.svelte` | Local `$state`, passed to children as props |
| Pan/zoom transform (scale, panX, panY) | `Board.svelte` | Local `$state`, driven by `panZoom` action |
| Screen routing (`gameState`) | `+page.svelte` | Local `$state`; the router |

### Component responsibilities

- **`+page.svelte`** — Pure router. Reads `gameState`, renders one of `MenuScreen` / `GameScreen` / `StatsScreen`.
- **`MenuScreen.svelte`** — Start screen UI. Composes `ResumeCard`, `DifficultyButton[]`, `SettingsPanel`.
- **`GameScreen.svelte`** — Runtime game state, RAF loop, win/lose detection, vortex effect lifecycle. Composes `TopBar`, `Board`, `SettingsPanel` (in-game overlay), `WinOverlay`, `LoseOverlay`.
- **`StatsScreen.svelte`** — Donut chart + per-difficulty breakdown. Reads from `progress` store.
- **`Board.svelte`** — SVG render of the level and arrows. Hosts the `panZoom` action. Emits `tap(cell)` callbacks.
- **`TopBar.svelte`** — Hamburger + hearts + arrows-left counter.
- **`SettingsPanel.svelte`** — Reads/writes the `settings` store directly. Same component used by `MenuScreen` and `GameScreen` (game-menu overlay).
- **`ResumeCard.svelte`** — Resume puzzle card. Reads `resume` store, shows lives + arrows left.
- **`DifficultyButton.svelte`** — Single difficulty card. Receives a difficulty config + win count as props.
- **`WinOverlay.svelte` / `LoseOverlay.svelte`** — Self-contained post-game UI.

---

## Step-by-step execution

Each step is a separate PR into `feature/refactor-all`. The Playwright suite must pass for every PR.

### Step 0 — Branch setup (½ day)

- ✅ `feature/refactor-all` created off `main`.
- Cherry-pick or copy reference code from `e073d10` (`panZoom.svelte.ts`, `snakeMath.ts`) into scratch notes, but do not blindly reuse — much of the underlying code has moved on since that commit.
- Decide what to do with the old `feature/refactor` branch (likely: delete after this plan is approved).

### Step 1 — Playwright safety net ⭐ BLOCKER FOR ALL OTHERS (1–2 days)

- Install `@playwright/test`. Add `playwright.config.ts`.
- Write tests covering:
  - Menu loads. Each enabled difficulty button starts a game.
  - In-game tap on an unblocked arrow removes it.
  - In-game tap on a blocked arrow loses a life.
  - Win flow: vortex plays, win overlay shows, progress increments.
  - Lose flow: lives reach 0, lose overlay shows.
  - Settings panel from menu: toggle dark mode → reload → still dark.
  - Settings panel from game menu: same.
  - Hamburger opens game menu, X closes it (single X — currently fixed on this branch).
  - "Main Menu" button from in-game returns to menu.
  - "Regenerate Puzzle" generates a new level with the same difficulty.
  - Resume card appears after partial game; tapping it resumes correctly.
  - Stats screen counts match a sequence of wins.
- Tests must pass on `main` first, then re-pass after every subsequent step.
- **No source code refactoring in this PR.**

### Step 2 — Persistence stores + `persisted<T>` helper (½ day)

- Add `lib/utils/persisted.ts` — typed reactive-localStorage wrapper.
- Add the three `.svelte.ts` stores. Each uses `persisted()` internally.
- Replace in-file `load*` / `save*` calls in `+page.svelte` with store imports.
- Smallest possible behavioral diff; safety net must pass.

### Step 3 — Constants + config + worker bridge (½ day)

- Move `DIFFICULTIES`, `computeGridSize`, `gridCaption` → `config/difficulties.ts`.
- Move timing constants → `constants/timing.ts`. Color/direction maps → `constants/theme.ts`.
- Move `generateInWorker` → `workers/workerBridge.ts`.
- Trivial-risk extraction.

### Step 4 — Pure math utilities (1 day)

- Move `roundedPath`, `buildFullRoute`, `measurePath` (+ the singleton `_measurer` SVGPathElement) → `utils/svgPath.ts`.
- Move `extPos`, `segPos`, `exitCellCount`, `checkBlocked` → `utils/snakeMath.ts`.
- Move easing → `utils/easing.ts`.
- Move `computeS`, `isFlashRed` → `utils/animTiming.ts`.
- Add vitest coverage for each — `computeS` and `isFlashRed` especially (timing-sensitive).

### Step 5 — `createPanZoom` action (1 day)

- Move all gesture event handlers (`onTouchStart/Move/End`, `onPenDown/Move/Up`, `onWheel`, `clampPan`, `resetView`, `cellAt`) into `lib/actions/panZoom.svelte.ts`.
- Action signature:
  ```ts
  panZoom(node, {
    onTap: (cell: GridPos) => void,
    scale: writable,
    panX: writable,
    panY: writable,
    containerW: writable,
    containerH: writable,
  })
  ```
- Reference the prior `panZoom.svelte.ts` from `e073d10` but rewrite — the pen-handling code has changed substantially since (`25767a0`).
- Verify on real iPad with pencil before merging this step.

### Step 6 — `SettingsPanel.svelte` (½ day)

- Extract the settings panel UI (currently duplicated at lines ~1074 and ~1382) into one component.
- Component reads/writes the `settings` store directly — no props needed.
- Use it from both `+page.svelte` (menu version) and `GameScreen.svelte` (game version). Same component, same behavior, single source of truth.

### Step 7 — `Board.svelte` ⚠️ HIGHEST RISK (1–2 days)

- Extract the SVG board: grid lines, arrow rendering (animated + static branches), vortex overlay.
- Props: `level`, `removed`, `markedRed`, `anims`, `now`, `vortexAnim`, `vortexParticles`, `pathRefs`, `showGrid`, `roundedCorners`, `darkMode`, `themeColor`, `onTap`.
- Uses `panZoom` action internally.
- This step has the largest behavioral surface. Run the full Playwright suite + manual smoke test on real iPad before merging.

### Step 8 — Mechanical UI extractions (1 day)

- `TopBar.svelte`, `ResumeCard.svelte`, `DifficultyButton.svelte`, `WinOverlay.svelte`, `LoseOverlay.svelte`.
- Self-contained UI chunks. Low risk; covered by safety net.

### Step 9 — Screens + thin router (1 day)

- `MenuScreen.svelte` — composes `ResumeCard`, `DifficultyButton[]`, `SettingsPanel`.
- `GameScreen.svelte` — owns runtime state (`level`, `removed`, `lives`, `anims`, vortex), the RAF loop, and composes `TopBar`, `Board`, `SettingsPanel`, `WinOverlay`, `LoseOverlay`.
- `StatsScreen.svelte` — donut + breakdown.
- `+page.svelte` shrinks to ~50 lines: imports stores, branches on `gameState`, dispatches.

### Step 10 — Polish, regression sweep, merge to `main` (½–1 day)

- Final pass: dead code removed, file sizes verified (target ≤250 lines per component), any lingering inline TODO addressed.
- Full Playwright run.
- Manual test pass on iPad with pencil, mobile Safari, desktop Chrome.
- Open final PR `feature/refactor-all` → `main`. Squash-merge as one commit; step PRs remain in the integration branch history for archaeology.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Branch rots before completion | Weekly `merge main` + atomic per-step PRs (each is independently shippable) |
| Pencil tap regresses (recently fixed in `25767a0`) | Step 5 explicitly rewrites it; Playwright covers tap via `dispatchEvent` with `pointerType: 'pen'`; manual iPad verification gate before Step 5 merges |
| Performance regression on Iron Tangle (~2,300 arrows) | Add a perf test to the Playwright suite measuring render time at Iron Tangle; record baseline on `main` and compare per step |
| Vortex animation breaks | Visual snapshot of win-state via Playwright |
| Settings drift between Menu + Game panels | Single store as source of truth — both panel instances read the same `$state` |
| Long-running feature freeze on `main` | Atomic step PRs amortize the cost; bug fixes can still land |

---

## Deferred / out of scope

- Tailwind class normalization or design-token extraction.
- Per-component test suites (beyond Playwright + extracted-utils vitests).
- Storybook / component catalog.
- Changes to `puzzleGenerator.ts` internals.
- `feature-easter-egg` branch (unrelated; not affected by this plan).

---

## Decision log

| Decision | Choice | Why |
|---|---|---|
| Delivery shape | Integration branch with atomic step PRs | Salvageability; reviewable in slices; prior attempt died as one big un-mergeable blob |
| Verification | Playwright e2e suite (built first) | Executable contract; runs on every step PR; the prior refactor had no safety net |
| Regression bar | Behavioral identity (UI polish OK if natural) | Lets us consolidate duplicated UI (SettingsPanel) without ballooning scope |
| Component granularity | 3 screens + ~10 cross-cutting components | Prior refactor's GameScreen was still 692 lines — going one level further |
| Persistent state | `.svelte.ts` stores via `persisted()` helper | Single source of truth; no prop-drilling for cross-cutting state |
| Runtime game state | Owned by `GameScreen.svelte`, props down | Lifecycle stays tied to the screen; no implicit global session |
| Engine extraction | Pure helpers → modules; RAF loop stays in `GameScreen` | Tests the math; keeps the lifecycle simple |
| Pan/zoom | `createPanZoom` Svelte action | Already-extracted gesture math composes well; clean component contract |
| Branch hygiene | Feature freeze on `main` + weekly merge | Drift is the #1 killer of long-lived refactor branches |
| Timeline | No hard target; atomic step PRs as compensating control | Personal-project pace; salvageability replaces deadline pressure |
