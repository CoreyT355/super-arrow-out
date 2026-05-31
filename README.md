# Arrow Out

A puzzle game where you clear a grid by launching colour-coded arrow snakes out of bounds — one blocked move costs a life.

**[Play it live →](https://arrows.coreytess.dev)**

---

## How to Play

Each cell of the grid is occupied by a coloured arrow snake. Tap an arrow to send it sliding in the direction it points. If the path to the edge is clear, the snake exits and the cells open up. If something is blocking it, the snake bounces back and you lose a heart.

Clear every snake to win the level.

**Controls**
- **Tap** an arrow to launch it
- **Pinch / scroll** to zoom in on larger grids
- **Drag** to pan around when zoomed

**Lives** — you have 3 hearts per puzzle. Each blocked move costs one. Lose all three and the level ends; tap **Try Again** to replay the exact same puzzle.

---

## Difficulty

| Mode | Grid | Notes |
|------|------|-------|
| Easy | 6 × 6 | Straight-forward, great for learning |
| Normal | 9 × 9 | Balanced warmup |
| Hard | ~11 × 22 | Starts requiring planned order |
| Super Hard | ~23 × 45 | Zoom and pan essential |
| Expert | ~46 × 89 | One for the patient |
| Ludicrous | ~91 × 179 | Not for the faint-hearted |

Grid dimensions adapt to your screen's aspect ratio on non-square modes.

---

## Features

- **Procedural puzzles** — every level is generated fresh; no two games are the same
- **Background puzzle generation** — levels are built in a Web Worker so the UI stays responsive; a loading screen covers the wait on larger grids
- **3-life system** — blocked arrows bounce back with a red flash and cost a heart
- **Try Again** — replays the exact same generated layout (saved to `localStorage`)
- **Regenerate Puzzle** — swap in a fresh random puzzle at any time from the in-game menu
- **Progress tracking** — wins per difficulty are persisted locally and shown on the menu
- **Stats screen** — donut chart breaking down your win history by difficulty, plus current and best win streak
- **Win streak** — consecutive wins without a loss are tracked across sessions; resets on any failed puzzle
- **Win animation** — sparkle particles spiral into a vortex when you clear the board (can be disabled in settings)
- **Pinch-to-zoom** — full pan and zoom on larger grids, mobile-optimised
- **Smooth animations** — rounded snake paths, eased nudge/bounce, per-frame RAF loop
- **Reduced-motion support** — respects `prefers-reduced-motion: reduce`; vortex and nudge animations are suppressed while drain animations keep running as core gameplay feedback
- **Accessibility** — ARIA roles on all overlays, focus trapping in modals, live-region announcements for lives lost and arrows remaining, screen-reader label on the stats donut chart
- **PWA-ready** — installable as a standalone app on mobile and desktop via the web manifest
- **Settings** — dark mode, grid lines, rounded corners, and win animation toggle; accessible from both the menu and mid-game

---

## Tech Stack

- [SvelteKit](https://kit.svelte.dev) with Svelte 5 Runes
- [Tailwind CSS v4](https://tailwindcss.com)
- SVG rendering — all game graphics are inline SVG, no canvas
- TypeScript throughout
- Web Workers for off-main-thread puzzle generation
- `localStorage` for progress and puzzle persistence (SSR-safe)

---

## Development

```sh
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

```sh
pnpm build      # production build
pnpm preview    # preview the production build locally
pnpm check      # svelte-check + TypeScript
```

---

## Project Structure

```
src/
├── lib/
│   ├── types.ts                              # Arrow, Level, Direction, GridPos
│   ├── config/
│   │   └── difficulties.ts                   # Difficulty table + grid-size derivation
│   ├── constants/
│   │   ├── game.ts                           # Lives, arrow lengths, generation tuning
│   │   ├── theme.ts                          # Colour palette, gradients
│   │   └── timing.ts                         # Animation durations
│   ├── stores/
│   │   ├── settings.svelte.ts                # Dark mode, grid lines, win animation, etc.
│   │   ├── progress.svelte.ts                # Wins per difficulty + win streak
│   │   └── resume.svelte.ts                  # Saved puzzle blob for Try Again / resume
│   ├── components/
│   │   ├── MenuScreen.svelte                 # Start menu (difficulty list, resume card)
│   │   ├── GameScreen.svelte                 # In-game view (board, top bar, overlays)
│   │   ├── StatsScreen.svelte                # Win-history donut + streaks
│   │   ├── Board.svelte                      # SVG grid + arrow rendering
│   │   ├── TopBar.svelte                     # Lives, menu, settings buttons
│   │   ├── SettingsPanel.svelte              # Settings modal
│   │   ├── WinOverlay.svelte                 # Win screen + vortex animation
│   │   ├── LoseOverlay.svelte                # Out-of-lives screen
│   │   ├── ResumeCard.svelte                 # Resume-saved-puzzle card
│   │   └── DifficultyButton.svelte           # Single difficulty entry
│   ├── actions/
│   │   └── panZoom.svelte.ts                 # Pinch-to-zoom / pan Svelte action
│   ├── utils/
│   │   ├── puzzleGenerator.ts                # Procedural level generator
│   │   ├── snakeMath.ts                      # Arrow geometry / collision helpers
│   │   ├── svgPath.ts                        # Rounded SVG path construction
│   │   ├── easing.ts                         # Easing curves
│   │   ├── animTiming.ts                     # RAF animation timing helpers
│   │   ├── gestures.ts                       # Touch / pointer gesture parsing
│   │   ├── persisted.ts                      # SSR-safe localStorage wrapper
│   │   └── trapFocus.ts                      # Svelte action: focus trap for modals
│   └── workers/
│       ├── puzzleGenerator.worker.ts         # Off-thread puzzle generation
│       └── workerBridge.ts                   # Promise-based worker messaging wrapper
└── routes/
    ├── +layout.svelte
    ├── layout.css                            # Global styles, Tailwind import, mobile scroll lock
    └── +page.svelte                          # Thin router — switches between menu / game / stats
```

The puzzle generator fills a grid using a constrained random walk, rejects placements that strand cells into pockets too small for a valid arrow, and absorbs any short stubs into adjacent tails as a safety net. Generation runs in a Web Worker (`workers/`) so the UI stays responsive on large grids.
