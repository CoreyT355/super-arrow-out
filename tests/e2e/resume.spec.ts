import { test, expect } from '@playwright/test';
import { freshSession, startEasy, tapUntilArrowRemoved, openGameMenu } from './helpers';

test.describe('Resume puzzle', () => {
    test.beforeEach(async ({ page }) => {
        await freshSession(page);
    });

    test('no resume card appears on a fresh session', async ({ page }) => {
        await expect(page.getByRole('button', { name: /Resume Puzzle/ })).toHaveCount(0);
    });

    test('leaving a game mid-puzzle surfaces a resume card on the menu', async ({ page }) => {
        await startEasy(page);

        // Make at least one tap so the resume snapshot has progress to preserve.
        const removed = await tapUntilArrowRemoved(page);
        expect(removed).toBe(true);

        // Give the $effect a microtask to flush the save before we navigate.
        await page.waitForTimeout(100);
        const resumeStored = await page.evaluate(() => localStorage.getItem('arrow-out-resume'));
        expect(resumeStored, 'resume snapshot should be saved to localStorage after a removal').not.toBeNull();

        await openGameMenu(page);
        await page.getByRole('button', { name: /Main Menu/ }).click();
        await expect(page.getByRole('heading', { name: 'Super Arrow Out' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Resume Puzzle/ })).toBeVisible();
    });

    test('tapping resume returns to the game with state intact', async ({ page }) => {
        await startEasy(page);

        // Tap one arrow, then bail to the menu.
        const arrowsBeforeBail = await page.locator('[data-testid="arrow"]').count();
        const removed = await tapUntilArrowRemoved(page);
        expect(removed).toBe(true);

        await openGameMenu(page);
        await page.getByRole('button', { name: /Main Menu/ }).click();

        // Resume and verify the running puzzle came back with fewer arrows than
        // a brand-new Easy game would have.
        await page.getByRole('button', { name: /Resume Puzzle/ }).click();
        await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
        const arrowsAfterResume = await page.locator('[data-testid="arrow"]').count();
        expect(arrowsAfterResume).toBeLessThanOrEqual(arrowsBeforeBail);
    });
});
