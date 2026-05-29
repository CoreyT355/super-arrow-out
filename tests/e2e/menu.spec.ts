import { test, expect } from '@playwright/test';
import { freshSession, openMenuSettings } from './helpers';

test.describe('Start menu', () => {
    test.beforeEach(async ({ page }) => {
        await freshSession(page);
    });

    test('renders title and stats button', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Super Arrow Out' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Stats' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    });

    test('shows all enabled difficulty buttons', async ({ page }) => {
        for (const label of ['Easy', 'Normal', 'Hard', 'Super Hard', 'Expert', 'Ludicrous']) {
            await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
        }
        // The Iron Tangle is hidden by default; the menu should not surface it.
        await expect(page.getByRole('button', { name: /^The Iron Tangle/ })).toHaveCount(0);
    });

    test('starting Easy transitions to the game screen', async ({ page }) => {
        await page.getByRole('button', { name: /^Easy/ }).click();
        await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
        await expect(page.getByText(/\d+ arrows left/)).toBeVisible();
    });

    test('settings dialog opens and closes', async ({ page }) => {
        await openMenuSettings(page);
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('button', { name: 'Close settings' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('stats button navigates to the stats screen', async ({ page }) => {
        await page.getByRole('button', { name: 'Stats' }).click();
        // Stats screen shows a donut with an aria-labelled role="img".
        await expect(page.getByRole('img').first()).toBeVisible();
    });
});
