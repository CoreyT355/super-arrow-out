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

Grid dimensions adapt to your screen's aspect ratio on non-square modes.

---

## Features

- **Procedural puzzles** — every level is generated fresh; no two games are the same
- **3-life system** — blocked arrows bounce back with a red flash and cost a heart
- **Try Again** — replays the exact same generated layout (saved to `localStorage`)
- **Progress tracking** — wins per difficulty are persisted locally and shown on the menu
- **Stats screen** — donut chart breaking down your win history by difficulty, plus current and best win streak
- **Win streak** — consecutive wins without a loss are tracked across sessions; resets on any failed puzzle
- **Win animation** — sparkle particles spiral into a vortex when you clear the board (can be disabled in settings)
- **Pinch-to-zoom** — full pan and zoom on larger grids, mobile-optimised
- **Smooth animations** — rounded snake paths, eased nudge/bounce, per-frame RAF loop
- **Settings** — dark mode, grid lines, rounded corners, and win animation toggle; accessible from both the menu and mid-game

---

## Tech Stack

- [SvelteKit](https://kit.svelte.dev) with Svelte 5 Runes
- [Tailwind CSS v4](https://tailwindcss.com)
- SVG rendering — all game graphics are inline SVG, no canvas
- TypeScript throughout
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
│   ├── types.ts                # Arrow, Level, Direction, GridPos
│   └── utils/
│       └── puzzleGenerator.ts  # Procedural level generator
└── routes/
    ├── +layout.svelte
    ├── layout.css              # Global styles, Tailwind import, mobile scroll lock
    └── +page.svelte            # Entire game — menu, play, stats screens
```

The puzzle generator fills a grid using a constrained random walk, rejects placements that strand cells into pockets too small for a valid arrow, and absorbs any short stubs into adjacent tails as a safety net.
