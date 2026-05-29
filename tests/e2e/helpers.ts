import type { Page } from '@playwright/test';

/**
 * Shared helpers for the safety-net e2e suite.
 *
 * Tests rely on stable selectors: aria-labels, role names, and a single
 * `data-testid="arrow"` hook on the tappable arrow `<g>` in the SVG board.
 * Nothing else in the source code was modified to support tests.
 */

/** Wipe persistent state before each test so puzzles, progress, and resume
 *  saves don't leak between cases. Call inside a beforeEach. */
export async function freshSession(page: Page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
}

/** Open the start-screen settings panel (the floating dialog from the gear). */
export async function openMenuSettings(page: Page) {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog').waitFor();
}

/** Open the in-game hamburger menu. */
export async function openGameMenu(page: Page) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('dialog', { name: 'Game menu' }).waitFor();
}

/** Close the in-game hamburger menu via its X button. */
export async function closeGameMenu(page: Page) {
    await page.getByRole('button', { name: 'Close menu' }).click();
    await page.getByRole('dialog', { name: 'Game menu' }).waitFor({ state: 'detached' });
}

/** Start the Easy difficulty from the start menu and wait for the puzzle to
 *  finish generating. The loading overlay (`role="status"` with "Loading…")
 *  appears while the worker runs; we wait for it to clear AND for the arrow
 *  set to render. */
export async function startEasy(page: Page) {
    await page.getByRole('button', { name: /^Easy/ }).click();
    // The hamburger button confirms screen transition.
    await page.getByRole('button', { name: 'Open menu' }).waitFor();
    // Wait for the worker-generated puzzle to render (no more loading
    // overlay AND at least one tappable arrow on the board).
    await page.locator('[role="status"]').waitFor({ state: 'detached', timeout: 30_000 });
    await page.locator('[data-testid="arrow"]').first().waitFor({ state: 'attached', timeout: 15_000 });
}

/** Tap one visible arrow on the board. Returns true if at least one arrow
 *  was present and tapped; false if none were found (i.e. game ended).
 *
 *  IMPORTANT: we click a `<rect>` child of the `<g>` rather than the `<g>`
 *  itself. SVG `<g>` elements only receive pointer events through their
 *  CHILDREN — `force:true` on the `<g>` clicks at the bbox center, which for
 *  an L-shaped or curved snake lands in empty space between cells and the
 *  click silently misses. The transparent `<rect>` overlays cover the actual
 *  path cells and are guaranteed hit targets. */
export async function tapAnyArrow(page: Page): Promise<boolean> {
    const arrows = page.locator('[data-testid="arrow"]');
    const count = await arrows.count();
    if (count === 0) return false;
    // First rect of arrow nth(0) corresponds to arrow.path[0] = the head cell.
    await arrows.nth(0).locator('rect').first().click({ force: true });
    return true;
}

/** Tap arrows until at least one is REMOVED from the board (not merely a
 *  life lost). Some tests need a confirmed removal because the resume-state
 *  save only fires when `removed.size > 0`.
 *
 *  Note: the `data-testid="arrow"` element disappears from the DOM as soon
 *  as the drain animation STARTS, but the arrow isn't formally added to
 *  the `removed` set (and the resume-save `$effect` doesn't fire) until the
 *  drain completes (~450ms). We wait the full EXIT_DURATION before returning. */
export async function tapUntilArrowRemoved(page: Page, maxAttempts = 12): Promise<boolean> {
    const EXIT_DURATION_MS = 600; // EXIT_DURATION=450, padded for safety.
    const initial = await page.locator('[data-testid="arrow"]').count();
    if (initial === 0) return false;
    for (let i = 0; i < maxAttempts; i++) {
        const before = await page.locator('[data-testid="arrow"]').count();
        if (!await tapAnyArrow(page)) return false;
        // Phase 1: wait up to 1.5s for the count to drop (drain started).
        const deadline = Date.now() + 1500;
        let draining = false;
        while (Date.now() < deadline) {
            const now = await page.locator('[data-testid="arrow"]').count();
            if (now < before) { draining = true; break; }
            await page.waitForTimeout(80);
        }
        if (draining) {
            // Phase 2: wait for the drain to complete and the $effect to flush.
            await page.waitForTimeout(EXIT_DURATION_MS);
            return true;
        }
        // Blocked tap. Pause briefly so the nudge animation clears and the
        // click handler will accept the next tap.
        await page.waitForTimeout(700);
        // Check we didn't run out of lives mid-loop.
        const loseDlg = page.getByRole('alertdialog', { name: /Game Over/i });
        if (await loseDlg.isVisible().catch(() => false)) return false;
    }
    return false;
}

/** Tap an arrow and wait for SOMETHING to change (arrow removed, life lost,
 *  or terminal dialog). Cheaper than a fixed sleep. Returns true if state
 *  changed within the deadline. */
export async function tapAndWait(page: Page, maxMs = 1500): Promise<boolean> {
    const arrowsBefore = await page.locator('[data-testid="arrow"]').count();
    const liveLabelBefore = await page.getByRole('img', { name: /lives remaining/ })
        .getAttribute('aria-label').catch(() => null);
    const livesBefore = Number(liveLabelBefore?.match(/^(\d+)/)?.[1] ?? -1);

    if (!await tapAnyArrow(page)) return false;

    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const arrowsNow = await page.locator('[data-testid="arrow"]').count();
        const liveLabelNow = await page.getByRole('img', { name: /lives remaining/ })
            .getAttribute('aria-label').catch(() => null);
        const livesNow = Number(liveLabelNow?.match(/^(\d+)/)?.[1] ?? -1);
        if (arrowsNow < arrowsBefore || livesNow < livesBefore) return true;
        await page.waitForTimeout(80);
    }
    return false;
}

/** Read the "N arrows left" counter from the game top bar. Returns -1 if
 *  the counter isn't visible (e.g. before puzzle generation completes). */
export async function arrowsLeft(page: Page): Promise<number> {
    const text = await page.getByText(/\d+ arrows left/).first().textContent({ timeout: 1000 }).catch(() => null);
    if (!text) return -1;
    const m = text.match(/(\d+) arrows left/);
    return m ? Number(m[1]) : -1;
}

/** Play a game by tapping arrows until either the win or lose dialog appears,
 *  or we hit `maxTaps`. Returns 'win' | 'lose' | 'timeout'.
 *
 *  After each tap, we poll for one of: arrow count decreased (unblocked
 *  drain finished), lives decreased (blocked nudge resolved), or a terminal
 *  dialog appeared. This is faster than a fixed 750ms wait for clean taps
 *  while still tolerating the full blocked-arrow animation (~640ms). */
export async function playToCompletion(page: Page, maxTaps = 200): Promise<'win' | 'lose' | 'timeout'> {
    const winDlg = page.getByRole('alertdialog', { name: /Level Complete/i });
    const loseDlg = page.getByRole('alertdialog', { name: /Game Over/i });

    const readLives = async () => {
        const lbl = await page.getByRole('img', { name: /lives remaining/ })
            .getAttribute('aria-label').catch(() => null);
        return Number(lbl?.match(/^(\d+)/)?.[1] ?? -1);
    };

    for (let i = 0; i < maxTaps; i++) {
        if (await winDlg.isVisible().catch(() => false)) return 'win';
        if (await loseDlg.isVisible().catch(() => false)) return 'lose';

        const arrowsBefore = await page.locator('[data-testid="arrow"]').count();
        const livesBefore = await readLives();

        if (arrowsBefore === 0) {
            // Vortex playing; wait for the win dialog.
            for (let j = 0; j < 30; j++) {
                if (await winDlg.isVisible().catch(() => false)) return 'win';
                await page.waitForTimeout(200);
            }
            return 'timeout';
        }

        await tapAnyArrow(page);

        // Wait up to 1.5s for arrow count to drop or a life to be lost.
        // (Blocked-arrow animation is ~640ms; we add slack for vortex
        // start, RAF scheduling jitter, and CI variance.)
        const deadline = Date.now() + 1500;
        let progressed = false;
        while (Date.now() < deadline) {
            if (await winDlg.isVisible().catch(() => false)) return 'win';
            if (await loseDlg.isVisible().catch(() => false)) return 'lose';
            const arrowsNow = await page.locator('[data-testid="arrow"]').count();
            const livesNow = await readLives();
            if (arrowsNow < arrowsBefore || livesNow < livesBefore) {
                progressed = true;
                break;
            }
            await page.waitForTimeout(80);
        }
        if (!progressed) {
            // Tap fell on deaf ears (animation still locked). Brief pause
            // and re-loop — next iteration tries again.
            await page.waitForTimeout(200);
        }
    }
    return 'timeout';
}
