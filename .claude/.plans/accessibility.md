# Accessibility Plan: Super Arrow Out

**Standard:** WCAG 2.1 AA
**Created:** 2026-05-27
**Scope:** Full app — menus, settings, stats, and gameplay (Easy + Normal modes)
**Rollout:** One PR per phase. Each phase is independently shippable and reverts cleanly.
**Testing:** Self-test only with VoiceOver on macOS Safari + iOS Safari. NVDA/TalkBack issues fixed reactively if reported. No external SR user recruitment for v1.

---

## Phase sizing (T-shirt)

| Phase | Size | Notes |
|---|---|---|
| 1 — Shell fixes | **S** | ~2 hours. Pure text/meta/class edits. Zero architectural change. |
| 2 — Touch targets + toggle ARIA | **S** | ~1 hour. Mechanical. |
| 3 — Reduced motion | **M** | ~3 hours. Needs the truth table right and tested on real OS setting. |
| 4 — Modal focus management | **M** | ~4 hours. New `trapFocus` action + `inert` backdrop pattern + four overlays. |
| 5 — Status announcements | **S** | ~2 hours. Depends on Phase 4 for the `alertdialog` role wiring. |
| 6 — Keyboard/SR board nav | **L** | ~1–2 days. New focus model, derived sorted view, focus restoration after launch, SVG focus indicator, mode gating. |

**Minimum viable shippable subset:** Phases 1–3. These are universal wins, low risk, no architectural change. If you only had a weekend, ship those and stop.

### Ordering rationale

The order is optimised for **coherent shipping units**, not strict risk-ascending. Each phase = one PR with a single-sentence changelog summary. That priority drives two deliberate compromises:

1. **Phase 5 (status announcements) has lower risk than Phase 4 (modal focus), but ships later.** Strict risk-ascending would put 5 before 4. Two reasons it doesn't:
   - Phase 5 references `role="alertdialog"` on the win/loss panels, which Phase 4 establishes. Decoupling is possible (move all panel ARIA into 5, leave 4 as pure interaction work) but produces a weirdly fragmented PR sequence — "more ARIA labels" twice with focus-trap work between.
   - Functionally, an SR user benefits more from working modal focus (Phase 4) than from live-region announcements alone. Shipping 5 before 4 would announce state changes the user could then get stuck inside.
2. **Phase 3 (reduced motion) ships before Phase 4 even though both are medium risk.** Reason: Phase 3 impact is universal (anyone with OS reduce-motion set), Phase 4 impact is keyboard/SR-only. Ordering by audience breadth at equal risk.

If you'd rather have strict risk-ascending and accept the fragmented changelog, the order is: 1 → 2 → 5 → 3 → 4 → 6. Both orderings are defensible; this plan picks coherence.

---

## Risk register (developer land mines)

These are the parts where "it depends" will bite. Listed upfront so they don't surprise mid-implementation.

1. **[Phase 6] Focus restoration after an arrow is launched.** The focused `<g>` is removed from the DOM mid-animation; focus falls back to `<body>`. Mitigation in plan: track focused arrow id, on removal move focus to next in `orderedArrows`. Fallback: focus the board `<svg>` and announce next state via live region.
2. **[Phase 6] SVG focus indicator cross-browser.** Don't bet on `:focus-visible` outlines on `<g>` — Safari has historically been spotty. **Decision: commit to the `<rect>` overlay approach** (render a yellow stroke rect over the focused arrow's head cell, keyed off a `focusedArrowId` state). Works in every browser, slightly more code.
3. **[Phase 6] Pinch/pan handler may swallow keyboard events.** The board container has `touch-action: none` and a `panZoomAction` use-directive. Verify Tab can enter the SVG and Enter/Space fire on the inner `<g>` without the action eating them. Likely fine since `panZoomAction` only binds touch/wheel listeners, but verify.
4. **[Phase 4] `aria-modal` + focus trap is not enough.** Modern screen readers can virtual-cursor outside the modal. **Set `inert` on the background main content** when an overlay is open, not just `aria-hidden`. Removes the entire subtree from accessibility tree and focus order.
5. **[Phase 6] Arrow ID stability.** Colors and stable snake numbering both rely on `arrow.id`. Verify the worker-generated `Level` assigns sequential, stable IDs and that they survive serialise/parse through `localStorage` for "Try Again." Spot-check by logging `level.arrows.map(a => a.id)` before and after `savePuzzle` → `loadPuzzle`.

---

## Guiding principles

1. **Honest scope.** The game is a 2D spatial puzzle. We make Easy (6×6) and Normal (9×9) keyboard- and screen-reader-operable. Hard / Super Hard / Expert / Ludicrous remain pointer-only by design — a 46×89 grid is not meaningfully playable via Tab cycling. We say so plainly in the UI rather than pretending otherwise.
2. **Universal wins first.** Contrast, button sizes, viewport zoom, reduced-motion, ARIA on toggles, and modal focus management help everyone and have nothing to do with the game's spatial nature. These come before keyboard board nav.
3. **No regressions for pointer users.** Every change must preserve the existing tap/pinch/pan experience exactly.

---

## Phasing

Six phases, ordered by ROI and risk. Each phase is independently shippable.

- **Phase 1** — Shell fixes (viewport zoom, page title, contrast, focus ring bug). Low risk, biggest universal impact.
- **Phase 2** — Touch targets and toggle ARIA. Mechanical changes.
- **Phase 3** — Reduced-motion support.
- **Phase 4** — Modal/menu keyboard handling (Escape, focus trap, return focus).
- **Phase 5** — Status announcements (hearts, arrows-left, win/loss, donut).
- **Phase 6** — Keyboard + screen-reader board nav for Easy and Normal, with mode-aware messaging.

---

## Phase 1 — Shell fixes (universal wins)

**Goal:** unblock browser zoom, fix the broken focus ring, raise text contrast to AA.

### Tasks

- [ ] **Remove `user-scalable=no`** from the viewport meta in [src/app.html:5](src/app.html:5).
  - Current: `width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover`
  - New: `width=device-width, initial-scale=1, viewport-fit=cover`
  - **Why:** WCAG 1.4.4 — low-vision users must be able to pinch-zoom the page. The in-game pinch handler calls `preventDefault` only inside the board, so page-level zoom outside the board will work fine.
  - **Verify:** On mobile Safari, pinch-zoom the menu screen — it should zoom. Inside the board, pinch should still zoom the board, not the page.

- [ ] **Add a `<title>` tag** in [src/routes/+layout.svelte](src/routes/+layout.svelte).
  - Inside `<svelte:head>`, add `<title>Super Arrow Out</title>`.
  - **Why:** WCAG 2.4.2.

- [ ] **Fix the broken Tailwind dynamic ring class** at [src/routes/+page.svelte:861](src/routes/+page.svelte:861).
  - Current: `focus-visible:{d.ring}` — Tailwind cannot resolve dynamic class names at build time, so the focus ring never appears.
  - New: replace with a static, theme-aware focus style: `focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none`.
  - **Verify:** Tab through the difficulty buttons on the menu — a visible white ring should appear on each.

- [ ] **Raise small-text contrast on gradient buttons.**
  - At [src/routes/+page.svelte:867](src/routes/+page.svelte:867): change `text-white/70` → `text-white/90` for the grid-size caption.
  - At [src/routes/+page.svelte:873](src/routes/+page.svelte:873): change `text-white/60` → `text-white/85` for the "win/wins" label.
  - **Why:** WCAG 1.4.3 — 60% white on saturated mid-tones is under 4.5:1.

- [ ] **Raise `text-slate-500` to `text-slate-400`** on dark backgrounds.
  - Find all `darkMode ? 'text-slate-500'` patterns and bump to `text-slate-400`. Audit each by hand — some are decorative dividers where contrast doesn't apply.
  - Key offenders: stats footer link ([+page.svelte:890](src/routes/+page.svelte:890)), win/loss subtitles ([1372](src/routes/+page.svelte:1372), [1411](src/routes/+page.svelte:1411)).

- [ ] **Verify contrast ratios** with a tool (e.g. Colour Contrast Analyser). Document any remaining failures in this file under "Known gaps."

### Acceptance

- Mobile Safari pinch-zoom works outside the game board.
- Tab → menu cards show a visible focus ring.
- All body-sized text on `bg-slate-900` measures ≥ 4.5:1 (or ≥ 3:1 for large text).
- Browser tab title reads "Super Arrow Out."

---

## Phase 2 — Touch targets and toggle ARIA

**Goal:** every interactive control is ≥ 44×44 and has a programmatic name.

### Tasks

- [ ] **Enlarge the gear button** at [src/routes/+page.svelte:725](src/routes/+page.svelte:725) and the hamburger at [1006](src/routes/+page.svelte:1006): `w-9 h-9` → `w-11 h-11`. Keep the inner SVG at 18px.

- [ ] **Enlarge the toggle switch hit areas.** The switch button itself (`w-10 h-6`) is fine visually but too small to tap reliably. Wrap the row in a clickable container OR add `min-h-11` and `py-3` to the `<label>`. Test that tapping anywhere on the row toggles the switch.

- [ ] **Add `aria-label` to every toggle button.** The pattern `<label><span>Dark Mode</span><button role="switch">` does **not** wire the label name to the button — `<label>` only labels native form controls. Fix:
  - [src/routes/+page.svelte:778](src/routes/+page.svelte:778) — Dark Mode toggle (menu settings): `aria-label="Dark mode"`.
  - [src/routes/+page.svelte:791](src/routes/+page.svelte:791) — Show Grid: `aria-label="Show grid lines"`.
  - [src/routes/+page.svelte:804](src/routes/+page.svelte:804) — Rounded Corners: `aria-label="Rounded corners"`.
  - [src/routes/+page.svelte:817](src/routes/+page.svelte:817) — Win Animation: `aria-label="Win animation"`.
  - Same four in the in-game menu: [1126](src/routes/+page.svelte:1126), [1141](src/routes/+page.svelte:1141), [1156](src/routes/+page.svelte:1156), [1170](src/routes/+page.svelte:1170).

- [ ] **Verify with VoiceOver:** focus a toggle → it should announce "Dark mode, switch, on" (or off), not just "switch, on."

### Acceptance

- Every interactive element has a tap target ≥ 44×44 (visually small icons are OK; the hit area is what matters).
- Every toggle has an accessible name spoken by VoiceOver/NVDA.

---

## Phase 3 — Reduced motion

**Goal:** respect `prefers-reduced-motion: reduce` for vestibular safety.

### Decision

- **Disable:** the win vortex spiral (2s spinning particles), the blocked-snake shake/bounce.
- **Keep:** the drain animation (short, linear, core gameplay feedback), the fly-in transitions on panels (replace with a simple opacity fade).

### Truth table for vortex playback

| `winAnimation` setting | OS `prefers-reduced-motion` | Vortex plays? |
|---|---|---|
| off | off | no (existing behaviour) |
| off | on  | no |
| on  | off | yes |
| on  | on  | **no** (OS preference wins over app setting) |

Implementation: `const shouldPlayVortex = $derived(winAnimation && !reducedMotion);` — gate both the `$effect` that spawns particles and the `vortexDone` derived on this single value.

### Tasks

- [ ] **Add a reactive `reducedMotion` flag** in [src/routes/+page.svelte](src/routes/+page.svelte):
  ```ts
  let reducedMotion = $state(false);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    const handler = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });
  ```

- [ ] **Gate the vortex.** In the `won && !vortexAnim && winAnimation` effect at [+page.svelte:691](src/routes/+page.svelte:691), add `&& !reducedMotion`. When skipped, the win panel appears immediately (it already gates on `vortexDone`, and `vortexDone` is true when `winAnimation` is off — extend that derived to also return true when `reducedMotion` is true).

- [ ] **Short-circuit the blocked-fwd/back nudge.** When `reducedMotion` is true, skip directly from `blocked-fwd` to `blocked-flash` (or skip the flash too — flashing is also a vestibular/seizure concern, replace with a static red tint for ~250ms).

- [ ] **Replace `transition:fly` with `transition:fade`** when `reducedMotion` is true. Pattern:
  ```svelte
  {#if reducedMotion}
    <div transition:fade={{ duration: 120 }}>…</div>
  {:else}
    <div transition:fly={{ y: 16, duration: 280 }}>…</div>
  {/if}
  ```
  Or simpler: pass `duration: reducedMotion ? 0 : 280` and `y: reducedMotion ? 0 : 16`.

- [ ] **Audit the `animate-shake` keyframe** in [src/routes/layout.css:15](src/routes/layout.css:15). If it's still used anywhere, wrap in `@media (prefers-reduced-motion: no-preference)`.

### Acceptance

- macOS System Settings → Accessibility → Display → "Reduce motion" enabled → vortex doesn't play, win panel still appears, blocked feedback is non-jarring, board still drains smoothly.

---

## Phase 4 — Modal and menu keyboard handling

**Goal:** Escape closes overlays, focus is trapped while open, focus returns to the trigger on close.

### Affected overlays

1. Menu-screen settings overlay ([+page.svelte:744](src/routes/+page.svelte:744))
2. In-game overlay menu ([+page.svelte:1050](src/routes/+page.svelte:1050))
3. Win panel ([+page.svelte:1363](src/routes/+page.svelte:1363))
4. Loss panel ([+page.svelte:1403](src/routes/+page.svelte:1403))

### Tasks

- [ ] **Write a small `trapFocus` Svelte action** in `src/lib/utils/trapFocus.ts`. Spec:
  - On mount, store `document.activeElement` as `previousFocus`.
  - Find all focusable descendants (`button, [href], input, [tabindex]:not([tabindex="-1"])`).
  - Move focus to the first one.
  - Listen for `Tab` / `Shift+Tab` — cycle within the trap.
  - Listen for `Escape` — call the provided `onClose` callback.
  - On destroy, restore focus to `previousFocus`.

- [ ] **Apply `use:trapFocus`** to each of the four overlays above, passing the appropriate close handler.

- [ ] **Re-order DOM** so the backdrop `<button>` comes *after* the panel content. Currently the backdrop is rendered first ([+page.svelte:745](src/routes/+page.svelte:745), [1052](src/routes/+page.svelte:1052)), so Tab lands on "Close menu" before the actual options. Either move the backdrop after the panel in source order, or set `tabindex="-1"` on the backdrop and rely on Escape + outside-click.
  - **Recommendation:** set `tabindex="-1"` on the backdrop. Outside-click still works; Escape closes; Tab skips it.

- [ ] **Mark the panel `role="dialog"`** (or `role="alertdialog"` for win/loss since they interrupt the game flow), with `aria-modal="true"` and `aria-labelledby` pointing at the panel's heading.

- [ ] **Apply `inert` to the background while an overlay is open.** `aria-modal` alone doesn't stop screen readers from virtual-cursoring outside the modal. Wrap the main content in a div whose `inert` attribute is bound to "is any overlay open":
  ```svelte
  <div inert={menuOpen || menuSettingsOpen || won || lost}>
    <!-- main content -->
  </div>
  ```
  This removes the background from focus order and the a11y tree. Overlays render as siblings, not children. Confirms keyboard and SR users genuinely can't escape the modal.

### Acceptance

- Open settings, press Escape → closes, focus returns to gear button.
- Open in-game menu, Tab → cycles through panel buttons + toggles, never escapes to background.
- Win panel appears → focus moves to "New Level" button; Escape doesn't close it (game is decided, dismissal is via the button).

---

## Phase 5 — Status announcements

**Goal:** screen-reader users hear meaningful state changes without losing focus.

### Tasks

- [ ] **Wrap "arrows left" counter in a live region** at [+page.svelte:1034](src/routes/+page.svelte:1034):
  ```svelte
  <span aria-live="polite" aria-atomic="true" class="…">
    {level.arrows.length - removed.size} arrows left
  </span>
  ```

- [ ] **Make the hearts row a single labeled image.**
  - Wrap the heart container ([+page.svelte:1038](src/routes/+page.svelte:1038)) with:
    ```svelte
    <div role="img" aria-label="{lives} of {MAX_LIVES} lives remaining">
      {#each Array(MAX_LIVES) as _, i}
        <span aria-hidden="true" class="…">♥</span>
      {/each}
    </div>
    ```
  - Add `aria-live="polite"` on the wrapper so life loss is announced.
  - Same treatment on the win-panel hearts ([+page.svelte:1374](src/routes/+page.svelte:1374)) — no live region needed there since it's static.

- [ ] **Mark win/loss panels as `role="alertdialog"`** with `aria-labelledby` (covered in Phase 4 — note the dependency).

- [ ] **Donut chart text alternative.** On the `<svg>` at [+page.svelte:943](src/routes/+page.svelte:943), add `role="img"` and an `aria-label` summarising totals. Compute in a `$derived`:
  ```ts
  const donutLabel = $derived(() => {
    if (totalWins === 0) return 'Win breakdown: no wins yet';
    const parts = ENABLED_DIFFICULTIES
      .map(d => `${d.label} ${progress[d.label] ?? 0}`)
      .join(', ');
    return `Win breakdown: ${totalWins} total. ${parts}`;
  });
  ```

- [ ] **Loading spinner status.** Add `role="status"` to the loading container at [+page.svelte:1354](src/routes/+page.svelte:1354). The visible "Loading…" text serves as the accessible name.

### Acceptance

- VoiceOver announces "2 of 3 lives remaining" when a life is lost.
- VoiceOver announces "10 arrows left" → "9 arrows left" as arrows exit.
- VoiceOver, on the stats page, announces a one-line summary of the donut.

---

## Phase 6 — Keyboard + SR board nav (Easy and Normal only)

**Goal:** on 6×6 and 9×9 boards, all arrows are Tab-focusable with descriptive labels including blocked/clear status. On larger grids, the board is explicitly marked non-keyboard-playable.

### Design

- **Focusable element:** the existing `<g onclick={…}>` per arrow at [+page.svelte:1287](src/routes/+page.svelte:1287). Add `tabindex="0"`, `role="button"`, `aria-label`, and Enter/Space key handler.
- **Focus order:** reading order — top-to-bottom, left-to-right by the arrow's head cell position. Sort `level.arrows` for the render loop in this order when `keyboardEnabled` is true. (Don't mutate the underlying array; create a `$derived` sorted view.)
- **Visible focus:** **render a yellow stroke `<rect>` overlay** over the focused arrow's head cell. Track `focusedArrowId` in `$state`; render the rect conditionally inside the SVG. Chosen over CSS `:focus-visible` on `<g>` because SVG focus styling is unreliable in Safari and this gives pixel-perfect control. See risk register #2.
- **Label content:** `"Snake #{stable-id}: {color name}, {length} cells, head at column {x+1} row {y+1}, pointing {direction word}, {clear|blocked}"`. Stable ID = `arrow.id` (does not renumber when other arrows are removed; see risk register #5 for the verification step). Compute `blocked` via the existing `checkBlocked(arrow)` helper. **Perf:** see task 6.4 — labels go through a `$derived` map, not inline computation per render.
- **Activation:** Enter or Space → call `handleClick(arrow.id)`. After activation, move focus to the next focusable arrow (the launched one is now removed). If none remain → focus the win panel's primary button.
- **Mode gating:** only enable on Easy and Normal. Currently `currentDifficulty` is the label string. Add a derived:
  ```ts
  const keyboardEnabled = $derived(
    currentDifficulty === 'Easy' || currentDifficulty === 'Normal'
  );
  ```

### Tasks

#### 6.1 — Mode-aware messaging

- [ ] **Add an accessibility note on the menu screen.** Below the difficulty buttons, a small line: *"Easy and Normal are keyboard- and screen-reader-friendly. Larger grids require pointer input."*
- [ ] **Update the README** with the same note in the "How to Play" section.

#### 6.2 — Color naming helper

- [ ] Add `COLOR_NAMES` array parallel to `COLORS_DARK` / `COLORS_LIGHT`:
  ```ts
  const COLOR_NAMES = ['red', 'blue', 'green', 'purple', 'orange',
                       'pink', 'yellow', 'teal', 'cyan', 'lime'];
  function colorName(id: number) { return COLOR_NAMES[id % 10]; }
  ```

#### 6.3 — Direction words

- [ ] Add a map:
  ```ts
  const DIR_WORD: Record<Direction, string> = {
    N: 'up', S: 'down', E: 'right', W: 'left'
  };
  ```

#### 6.4 — Arrow label builder (cached via $derived)

- [ ] Add the label-builder function:
  ```ts
  function arrowLabel(arrow: Arrow): string {
    const { blocked } = checkBlocked(arrow);
    const head = arrow.path[0];
    return `Snake ${arrow.id}: ${colorName(arrow.id)}, ` +
           `${arrow.path.length} cell${arrow.path.length === 1 ? '' : 's'}, ` +
           `head at column ${head.x + 1} row ${head.y + 1}, ` +
           `pointing ${DIR_WORD[arrow.direction]}, ` +
           `${blocked ? 'blocked' : 'clear'}`;
  }
  ```

- [ ] **Cache labels in a `$derived` map** to avoid recomputing `checkBlocked` on every render frame:
  ```ts
  const arrowLabels = $derived.by(() => {
    if (!keyboardEnabled) return {};
    const out: Record<number, string> = {};
    for (const a of level.arrows) {
      if (!removed.has(a.id)) out[a.id] = arrowLabel(a);
    }
    return out;
  });
  ```
  Reactivity: re-runs when `level`, `removed`, or `anims` (which `checkBlocked` reads) change — i.e. once per game-state change, not once per RAF tick. In the template, read `arrowLabels[arrow.id]` instead of calling `arrowLabel(arrow)`.

  **Perf budget:** on 9×9 (~20 snakes), `checkBlocked` is O(n × avg-path-length) ≈ 60 ops per snake × 20 snakes = ~1200 ops per state change. Negligible. Don't even bother computing for Hard+ — the `keyboardEnabled` short-circuit guarantees it.

#### 6.5 — Sorted render order

- [ ] Add a derived sorted-by-position view of arrows when `keyboardEnabled`:
  ```ts
  const orderedArrows = $derived(
    keyboardEnabled
      ? [...level.arrows].sort((a, b) => {
          const ah = a.path[0], bh = b.path[0];
          return ah.y - bh.y || ah.x - bh.x;
        })
      : level.arrows
  );
  ```
  Replace `{#each level.arrows as arrow (arrow.id)}` with `{#each orderedArrows as arrow, i (arrow.id)}` so the index `i` is the visual reading order.

#### 6.6 — Make arrow groups focusable

- [ ] On the static-branch `<g>` at [+page.svelte:1287](src/routes/+page.svelte:1287), conditionally add:
  ```svelte
  <g
    onclick={() => handleClick(arrow.id)}
    onkeydown={(e) => {
      if (keyboardEnabled && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleClick(arrow.id);
      }
    }}
    onfocus={() => (focusedArrowId = arrow.id)}
    onblur={() => { if (focusedArrowId === arrow.id) focusedArrowId = null; }}
    tabindex={keyboardEnabled ? 0 : -1}
    role={keyboardEnabled ? 'button' : undefined}
    aria-label={keyboardEnabled ? arrowLabels[arrow.id] : undefined}
    style="cursor:pointer"
  >
  ```

#### 6.7 — Visible focus indicator (`<rect>` overlay)

Committed to overlay approach (see risk register #2). Don't try CSS `:focus-visible` on `<g>`.

- [ ] Declare focus tracking state near other game state:
  ```ts
  let focusedArrowId = $state<number | null>(null);
  ```
- [ ] **Render the focus rect inside the SVG**, after all arrow groups but before the vortex layer. Position it on the focused arrow's head cell:
  ```svelte
  {#if focusedArrowId !== null && keyboardEnabled}
    {@const focused = level.arrows.find(a => a.id === focusedArrowId)}
    {#if focused && !removed.has(focused.id)}
      {@const h = focused.path[0]}
      <rect
        x={h.x + 0.04} y={h.y + 0.04} width={0.92} height={0.92}
        rx="0.2"
        fill="none"
        stroke="#fbbf24"
        stroke-width="0.08"
        pointer-events="none"
      />
    {/if}
  {/if}
  ```
- [ ] **Also set a focus-style fallback** in case the user is on desktop and `:focus-visible` *does* paint the default browser focus outline on the `<g>` (double-indicator looks bad):
  ```css
  /* in layout.css */
  svg g[role="button"]:focus { outline: none; }
  ```

#### 6.8 — Board container ARIA

- [ ] On the board `<svg>` at [+page.svelte:1196](src/routes/+page.svelte:1196), add `role="application"` and `aria-label="Arrow puzzle, {W} by {H} grid"`.

#### 6.9 — Focus management after launch

- [ ] After `handleClick` runs and an arrow is removed, the focused `<g>` disappears and focus is lost (lands on `<body>`). Track the focused arrow's index and, on removal, move focus to the next arrow in `orderedArrows` (or previous if it was last).
- [ ] When the win panel appears, focus its primary button.
- [ ] When the loss panel appears, focus the "Try Again" button.

### Acceptance

- On Easy: Tab from the hamburger reaches the first arrow (top-left reading order); each subsequent Tab moves to the next arrow; VoiceOver reads "Snake 1: red, 3 cells, head at column 2 row 1, pointing right, clear, button."
- Pressing Enter on a clear arrow launches it. Focus moves to the next arrow.
- Pressing Enter on a blocked arrow plays the bounce + flash and costs a life (existing behaviour). Focus stays put. The arrow's aria-label updates ("blocked" → reflects new state next time it's re-rendered).
- On Hard+: arrows are not Tab-focusable. Mouse/touch still works exactly as before.
- On Easy/Normal, pointer users see no difference.

---

## Cross-cutting: testing checklist

After all phases:

- [ ] Run `pnpm check` — no new TypeScript errors.
- [ ] Run `pnpm build` and load `pnpm preview` — manual smoke test of all three game states.
- [ ] Keyboard-only run-through (no mouse): start app → menu → Easy → win → main menu → stats → back → Normal → lose → try again. All flows complete with Tab/Enter/Escape only.
- [ ] VoiceOver run-through on macOS Safari: same flow, listening for any silent state changes.
- [ ] iOS Safari: pinch-zoom the menu (should zoom now), then start a game and pinch-zoom the board (board zooms, page doesn't).
- [ ] System reduced-motion on → win Easy → verify no vortex, just panel.
- [ ] Lighthouse accessibility audit on `pnpm preview` build — target score ≥ 95.
- [ ] Manual contrast check on every text/background pair using a tool.

---

## Known gaps (intentional, documented)

- **Hard / Super Hard / Expert / Ludicrous are not keyboard- or screen-reader-playable.** A 46×89 grid with hundreds of snakes cannot be meaningfully navigated by Tab cycling. The menu and README will state this plainly. Easy and Normal are the supported accessible modes.
- **The game is fundamentally visual-spatial.** Even with full SR labels on Easy, holding the 2D layout in working memory from verbal descriptions is hard. We make the controls accessible; we don't claim the gameplay is equally enjoyable across modalities.

---

## Open questions / future work

- **"Describe board" keyboard shortcut.** A key (`?` or `D`) that announces a board summary via a hidden live region: "9 by 9 board, 14 snakes remaining, 3 clear, 11 blocked." Lets an SR user assess progress without Tabbing through every snake. Cut from v1 to keep Phase 6 scope tight; revisit if SR users actually try the game.
- **"Auto-pick a safe move" hint button.** Would benefit SR users dramatically but changes the puzzle's character. Defer until requested.
- **High-contrast outline option** for arrow colors (separate from rounded-corners / grid-lines toggle). Could help low-vision sighted users distinguish adjacent same-color snakes. Defer until requested.
- **NVDA / TalkBack testing.** Self-test on VoiceOver only for v1; fix NVDA/TalkBack issues reactively if reported. The `role="application"` on the board may behave differently on NVDA — worth verifying eventually.
- **Internationalisation** of color names and direction words is a future concern; English-only is fine for v1.
