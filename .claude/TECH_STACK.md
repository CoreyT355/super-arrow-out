# Tech Stack Setup — Arrow Out

## Stack

| Layer | Tool | Version Constraint |
|---|---|---|
| Runtime | Node.js | `>=22` (engine-strict enforced via `.npmrc`) |
| Package Manager | pnpm | `>=10` |
| Framework | SvelteKit | `^2.x` |
| UI Library | Svelte | `^5.x` (Runes mode) |
| Bundler | Vite | `^6.x` (bundled with SvelteKit) |
| Styling | Tailwind CSS | `^4.x` |
| Tailwind Svelte plugin | `@tailwindcss/vite` | `^4.x` |
| Language | TypeScript | `^5.x` |
| Type checking | `svelte-check` | `^4.x` |

---

## Current State

The `.svelte-kit/` directory and `.npmrc` exist, meaning the repo was cloned or partially scaffolded. **There is no `package.json` yet.** The full scaffold must be run before any dev work can begin.

---

## Setup Todos

### 1. Scaffold the SvelteKit project

Run this from the repo root. When the Svelte CLI prompts, choose:
- **Template:** SvelteKit minimal (Skeleton project)
- **TypeScript:** Yes — use TypeScript syntax
- **Add-ons:** none needed at scaffold time (Tailwind is added separately below)

```bash
pnpm create svelte@latest .
```

> If the CLI warns that the directory is non-empty, confirm you want to continue. It will not overwrite `.claude/` or `.gitignore`.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Add Tailwind CSS v4

Tailwind v4 ships as a Vite plugin — there is no `tailwind.config` file by default. Install it and the Svelte-specific adapter:

```bash
pnpm add -D tailwindcss @tailwindcss/vite
```

Then register the plugin in `vite.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
});
```

Import Tailwind in your global CSS entry (`src/app.css`):

```css
@import 'tailwindcss';
```

Then import that file in `src/routes/+layout.svelte`:

```svelte
<script>
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

### 4. Add the custom shake animation

Tailwind v4 uses CSS-first configuration. Add the keyframe directly in `src/app.css` instead of a JS config file:

```css
@import 'tailwindcss';

@theme {
  --animate-shake: shake 0.25s ease-in-out;

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-4px); }
    40%, 80% { transform: translateX(4px); }
  }
}
```

This makes `animate-shake` available as a utility class everywhere.

### 5. Create the type definitions file

```bash
mkdir -p src/lib
```

Create `src/lib/types.ts`:

```ts
export type Direction = 'N' | 'S' | 'E' | 'W';

export interface Point {
  x: number;
  y: number;
}

export interface ArrowData {
  id: string;
  points: Point[];
  exitDirection: Direction;
  color: string;
  isExiting: boolean;
  isBlocked: boolean;
}

export interface GameLevel {
  gridSize: number;
  arrows: ArrowData[];
}
```

### 6. Create the puzzle generator utility

```bash
mkdir -p src/lib/utils
```

Place the full `generateLevel`, `tryGenerateArrow`, `validateLevel`, and `checkCollision` implementations in `src/lib/utils/puzzleGenerator.ts`. Source: `.claude/.plans/overview.md` § 5.

### 7. Implement the game page

Replace the scaffolded `src/routes/+page.svelte` with the full game component from `.claude/.plans/overview.md` § 5.

> **Note on `{#get}` syntax:** The plan uses `{#get head = ...}` which is a Svelte 5 snippet/let shorthand. Verify the exact Svelte 5 block syntax for destructuring in the installed version — it may need to be `{@const head = ...}` instead.

### 8. Verify the build

```bash
pnpm run check      # svelte-check type pass
pnpm run dev        # local dev server at http://localhost:5173
pnpm run build      # production build
```

---

## Implementation Notes

### Why pnpm
`.npmrc` sets `engine-strict=true`, which npm handles less gracefully than pnpm when Node version constraints are enforced. Stick with pnpm throughout.

### Svelte 5 Runes
All reactive state uses the Runes API (`$state`, `$effect`, `$props`). Do **not** use legacy `let` + reactive labels (`$:`) — they are deprecated in Svelte 5 and mix poorly with Runes in the same component.

### SVG coordinate system
The game board renders as a single SVG with `viewBox="0 0 {GRID_SIZE} {GRID_SIZE}"`. All arrow coordinates are in grid units (each cell = 1 unit). Centering within a cell uses `+ 0.5` offsets. The stroke width (`stroke-[0.25]`) is also in grid units — do not use pixel values here.

### Pointer event layering
Each arrow is wrapped in a full-board `<button>` (absolute, inset-0). The SVG itself is `pointer-events-none`; only the `<path>` and `<polygon>` elements inside set `pointer-events-auto`. This prevents bounding-box overlap between arrows from swallowing clicks.

### Exit animation direction mapping
The `exitDirection` on each arrow is the direction the **head** faces (the direction it exits). The generation algorithm seeds arrows entering from the opposite edge, so `exitDirection === startEdge` is correct — an arrow entering from the North edge exits North.

### Level generation failure budget
`generateLevel` retries up to 100 times before throwing. On an 8×8 grid with 12 arrows this rarely triggers. If you increase `arrowCount` significantly, raise the retry cap or reduce `targetLength` range.

### Tailwind v4 vs v3 differences
- No `tailwind.config.js` — configuration lives in CSS via `@theme {}`
- Arbitrary values like `stroke-[0.25]` still work
- The `content` array is auto-detected from Vite; no manual glob needed
- `@tailwindcss/vite` replaces the old PostCSS setup entirely
