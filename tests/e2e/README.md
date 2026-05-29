# e2e safety net

Playwright suite that locks down user-facing behavior of `+page.svelte` so the
`feature/refactor-all` decomposition has an executable contract for "the app
still works."

## Running

```sh
npm run test:e2e         # headless run, list reporter
npm run test:e2e:headed  # watch the browser
npm run test:e2e:ui      # interactive Playwright UI
```

The dev server starts automatically (`webServer` in `playwright.config.ts`).

## What's covered

| File                | Flows |
|---------------------|-------|
| `menu.spec.ts`      | Start screen renders, all enabled difficulties shown, Easy starts game, settings dialog opens/closes, stats navigation |
| `settings.spec.ts`  | Dark mode / Show Grid persist across reload; settings changed in-game reflect on the menu |
| `game.spec.ts`      | Top bar, hamburger open/close (single X), Main Menu button, Regenerate Puzzle changes geometry, single-tap removes-or-blocks, play-to-completion reaches a terminal dialog |
| `resume.spec.ts`    | No resume card on fresh session, resume card appears after a removal, tapping resume restores the puzzle |
| `stats.spec.ts`     | Stats screen renders donut + breakdown, navigation works |

## Selectors

The suite leans on existing ARIA hooks (role/aria-label/aria-checked). The
only test-only attribute added to source is `data-testid="arrow"` (with
`data-arrow-id`) on the tappable `<g>` in the SVG board — needed because
nothing else uniquely identifies a tappable snake.

## Gotchas (read before adding tests)

- **Tap arrows via `<rect>` children, not the `<g>`.** SVG `<g>` elements only
  receive pointer events when a child covers the click point. Playwright's
  `force: true` clicks at the bbox center, which for an L-shaped snake lands
  in empty space between path cells and silently misses. Use
  `arrows.nth(i).locator('rect').first().click()` — see `tapAnyArrow`.
- **Drain animation takes ~450ms.** `data-testid="arrow"` disappears as soon
  as the drain *starts* (the arrow swaps to the animated render branch with
  no testid), but `removed` isn't updated until the drain *ends*. The
  resume-save `$effect` fires off `removed`, not the visual state. Helpers
  that need a confirmed removal (e.g. `tapUntilArrowRemoved`) wait the full
  EXIT_DURATION before returning.
- **Blocked-arrow animation takes ~640ms.** Don't tap the same arrow
  immediately after a blocked attempt — the click handler ignores taps for
  any arrow currently in `anims`.
- **Worker loading.** `startEasy` waits for the loading overlay to clear AND
  for at least one arrow to render. New tests that start games should reuse
  this helper.

## Maintenance

If a test goes flaky, first suspect: did the refactor change a selector,
animation timing, or state-update ordering? The contract here is behavioral,
not implementation — but any of those three can break it.
