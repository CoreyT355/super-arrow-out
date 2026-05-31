# Tech Stack — Arrow Out

> Current-state reference for the shipped game. For the original design blueprint
> (8×8 / 12-arrow prototype, backward-trajectory generation) see the historical
> doc at `.claude/.plans/overview.md` — it predates most of what's below.

## Stack

| Layer | Tool | Installed |
|---|---|---|
| Runtime | Node.js | `>=22` (engine-strict via `.npmrc`; dev on v22.14) |
| Package Manager | pnpm | `>=10` |
| Framework | SvelteKit | `^2.57` |
| UI Library | Svelte | `^5.55` (Runes mode, forced in `svelte.config.js`) |
| Bundler | Vite | `^8.0.7` |
| Tailwind Vite plugin | `@tailwindcss/vite` | `^4.2.2` |
| Styling | Tailwind CSS | `^4.2.2` (CSS-first config — no `tailwind.config.js`) |
| Language | TypeScript | `^6.0.2` |
| Type checking | `svelte-check` | `^4.4.6` |
| Unit tests | Vitest | `^4.1.7` |
| E2E tests | Playwright | `^1.60` |
| Adapter | `@sveltejs/adapter-auto` | `^7.0.1` |
| Analytics | `@vercel/analytics` | `^2.0.1` |

Hosted at https://arrows.coreytess.dev (Vercel).

---

## Scripts

```bash
pnpm dev            # vite dev — http://localhost:5173
pnpm build          # production build
pnpm preview        # preview the production build
pnpm check          # svelte-kit sync && svelte-check
pnpm test           # vitest run (unit; excludes tests/e2e/)
pnpm test:e2e       # playwright test
pnpm test:e2e:ui    # playwright test --ui
```

---

## Implementation Notes

### Svelte 5 Runes
All reactive state uses the Runes API (`$state`, `$effect`, `$props`, `$derived`).
Runes mode is forced for project files via `compilerOptions.runes` in
`svelte.config.js` (libraries under `node_modules` are exempt). Do **not** use
legacy `let` + reactive labels (`$:`).

Cross-component state lives in `src/lib/stores/*.svelte.ts` (settings, progress,
resume) — plain modules exporting rune-backed state, not Svelte 4 stores.

### Inline block destructuring
Where the old blueprint used the invalid `{#get ...}` syntax, the real code uses
`{@const ...}` inside `{#each}` blocks (see `lib/components/Board.svelte`).

### Tailwind v4 (CSS-first)
- No `tailwind.config.js`. Configuration lives in CSS via `@theme {}` in
  `src/routes/layout.css`.
- `@tailwindcss/vite` is registered in `vite.config.ts`; it replaces the old
  PostCSS setup and auto-detects content from Vite.
- The shake animation is defined as `--animate-shake` + a `@keyframes shake`
  block inside `@theme`, exposing `animate-shake` as a utility.
- Arbitrary values like `stroke-[0.25]` still work.

### Reduced motion
`@media (prefers-reduced-motion: reduce)` in `layout.css` suppresses the shake
(and the win vortex / nudge) while leaving core drain animations running.

### SVG coordinate system
The board renders as inline SVG with the viewBox in grid units (each cell = 1
unit). Centering within a cell uses `+ 0.5` offsets; stroke width is in grid
units, not pixels. No canvas anywhere.

### Off-thread generation
Puzzle generation runs in a Web Worker (`lib/workers/puzzleGenerator.worker.ts`)
via a promise-based bridge (`workerBridge.ts`) so the UI stays responsive on the
large grids (up to 128×128, plus the hidden 32400-cell Iron Tangle).

### Persistence
Progress, settings, and the resumable puzzle blob persist to `localStorage`
through an SSR-safe wrapper (`lib/utils/persisted.ts`) — guards `window` so the
server render doesn't touch storage.

### Game rules
Rule constants live in `lib/constants/game.ts` (e.g. `MAX_LIVES = 3`).
Difficulty definitions and grid-size derivation live in
`lib/config/difficulties.ts`.
