# Shape masks

Each `.svg` file in this directory becomes a playable puzzle shape. **Drop a
file in and it shows up** — no code changes. (See `docs/shaped-puzzles.md` for
how shaped puzzles work overall.)

## How it works

At build time every `*.svg` here is read as raw text and its geometry is
extracted and flattened into a fill mask (the cells the snakes fill). The same
path also renders as the shape's icon in the menu's shape picker.

- `id` comes from the filename (`heart.svg` → `heart`).
- The shape is scaled at play time to roughly match the chosen difficulty's
  target cell count, at the shape's own aspect ratio (it is never stretched).
- After rasterizing, only the **largest connected region** is kept, so stray
  islands are dropped automatically.

## Authoring rules

- Use one logical filled shape. Supported elements: `<path>`, `<polygon>`,
  `<polyline>`, `<rect>`, `<circle>`, `<ellipse>`.
- For `<path>`, use `M L H V C S Q T Z` commands only — **arcs (`A`) are not
  supported**. (Circles/ellipses authored as `<circle>`/`<ellipse>` elements
  are converted to beziers automatically; an `A` command inside a `<path>` is
  not.)
- Orientation is screen-space: **y increases downward** (a heart's point is at
  the bottom = larger y).
- Keep it recognizable at low resolution — fine detail and very thin spikes
  vanish on smaller grids.
- Multiple sub-paths fill by the **nonzero-winding rule** (the SVG default), so
  a sub-path wound opposite the body reads as a hole (e.g. the ghost's eyes).
- **Faceted icons** (a D20 die, a cut gem) draw their outline as many separate
  facet polygons split by thin edge gaps — those rasterize to a gappy,
  disconnected blob, not a solid shape. Add **`data-hull="true"`** to fill the
  shape to its solid convex silhouette instead. The detailed path still renders
  as the menu chip; only the play mask is solidified. (Hull = convex, so use it
  for convex outlines — dice, gems, crystals.)
- `fill="none"` elements (e.g. a transparent bounding-box rect some icon sets
  include) are ignored automatically.

## Per-file metadata (attributes on the root `<svg>`)

| Attribute         | Meaning                              | Default                |
| ----------------- | ------------------------------------ | ---------------------- |
| `data-label`      | Display name in the picker           | title-cased filename   |
| `data-min-filled` | Min target cells to offer this shape | `60`                   |
| `data-max-filled` | Max target cells (optional)          | none                   |
| `data-order`      | Sort order in the picker             | `100`                  |
| `viewBox`         | Chip framing                         | `0 0 24 24`            |

Detailed shapes need a higher `data-min-filled` to stay readable (e.g. the
star uses `120`). After adding a shape, run `npm test` — the seeded generator
suite automatically covers every shape (full tiling + solvability) across many
sizes and seeds.

## Example

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
     data-label="Diamond" data-min-filled="24" data-order="2">
  <polygon points="12,2 22,12 12,22 2,12" fill="currentColor"/>
</svg>
```
