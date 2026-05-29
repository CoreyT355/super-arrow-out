import { test, expect } from '@playwright/test';
import {
    freshSession,
    startEasy,
    openGameMenu,
    closeGameMenu,
    tapAndWait,
    arrowsLeft,
    playToCompletion,
} from './helpers';

test.describe('In-game UI', () => {
    test.beforeEach(async ({ page }) => {
        await freshSession(page);
        await startEasy(page);
    });

    test('top bar shows arrows-left counter and lives', async ({ page }) => {
        await expect(page.getByText(/\d+ arrows left/)).toBeVisible();
        await expect(page.getByRole('img', { name: /\d+ of \d+ lives remaining/ })).toBeVisible();
    });

    test('hamburger opens game menu and X closes it (single close affordance)', async ({ page }) => {
        await openGameMenu(page);
        // Exactly one Close-menu affordance should exist while the menu is open
        // (post the duplicate-X bug fix).
        await expect(page.getByRole('button', { name: 'Close menu' })).toHaveCount(1);
        await closeGameMenu(page);
        await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    });

    test('Main Menu button returns to start screen', async ({ page }) => {
        await openGameMenu(page);
        await page.getByRole('button', { name: /Main Menu/ }).click();
        await expect(page.getByRole('heading', { name: 'Super Arrow Out' })).toBeVisible();
    });

    test('Regenerate Puzzle creates a different puzzle', async ({ page }) => {
        // Arrow ids are reassigned per generation as 0..N-1, so they're
        // useless for change detection. Compare the actual SVG path `d`
        // attributes — randomized generation will produce different paths.
        const pathsBefore = await page.locator('[data-testid="arrow"] path').evaluateAll(
            nodes => nodes.map(n => n.getAttribute('d')).join('|')
        );

        await openGameMenu(page);
        await page.getByRole('button', { name: /Regenerate Puzzle/ }).click();

        // Wait for the loading overlay to clear and arrows to render again.
        await expect(page.getByText(/\d+ arrows left/)).toBeVisible();
        await page.waitForFunction(() => {
            return document.querySelectorAll('[data-testid="arrow"]').length > 0;
        }, { timeout: 15_000 });

        const pathsAfter = await page.locator('[data-testid="arrow"] path').evaluateAll(
            nodes => nodes.map(n => n.getAttribute('d')).join('|')
        );

        expect(pathsBefore.length).toBeGreaterThan(0);
        expect(pathsAfter.length).toBeGreaterThan(0);
        // Astronomically unlikely the random generator produces identical
        // path geometry twice. Any difference proves regeneration worked.
        expect(pathsAfter).not.toBe(pathsBefore);
    });
});

test.describe('Gameplay end-to-end', () => {
    test.beforeEach(async ({ page }) => {
        await freshSession(page);
    });

    test('tapping an arrow either removes it or costs a life', async ({ page }) => {
        await startEasy(page);

        const initialArrows = await arrowsLeft(page);
        expect(initialArrows).toBeGreaterThan(0);

        const changed = await tapAndWait(page);
        expect(changed).toBe(true);
    });

    test('playing to completion reaches a terminal dialog (win or lose)', async ({ page }) => {
        test.setTimeout(120_000); // Easy can take ~60s of taps + 4s vortex.
        await startEasy(page);
        const result = await playToCompletion(page, 200);
        expect(['win', 'lose']).toContain(result);
    });
});
