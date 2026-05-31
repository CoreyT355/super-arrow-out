import { test, expect } from '@playwright/test';
import { freshSession, openMenuSettings, openGameMenu, startEasy } from './helpers';

test.describe('Settings persistence', () => {
    test.beforeEach(async ({ page }) => {
        await freshSession(page);
    });

    test('toggling Dark Mode from menu persists across reload', async ({ page }) => {
        await openMenuSettings(page);
        const darkSwitch = page.getByRole('switch', { name: 'Dark Mode' });
        const initialState = await darkSwitch.getAttribute('aria-checked');
        await darkSwitch.click();
        const flipped = initialState === 'true' ? 'false' : 'true';
        await expect(darkSwitch).toHaveAttribute('aria-checked', flipped);

        await page.reload();
        await openMenuSettings(page);
        await expect(page.getByRole('switch', { name: 'Dark Mode' }))
            .toHaveAttribute('aria-checked', flipped);
    });

    test('toggling Show Grid from menu persists across reload', async ({ page }) => {
        await openMenuSettings(page);
        const gridSwitch = page.getByRole('switch', { name: 'Show Grid' });
        const initialState = await gridSwitch.getAttribute('aria-checked');
        await gridSwitch.click();
        const flipped = initialState === 'true' ? 'false' : 'true';

        await page.reload();
        await openMenuSettings(page);
        await expect(page.getByRole('switch', { name: 'Show Grid' }))
            .toHaveAttribute('aria-checked', flipped);
    });

    test('settings changed in-game reflect on the start menu', async ({ page }) => {
        await startEasy(page);
        await openGameMenu(page);

        const gameDark = page.getByRole('switch', { name: 'Dark Mode' });
        const initialState = await gameDark.getAttribute('aria-checked');
        await gameDark.click();
        const flipped = initialState === 'true' ? 'false' : 'true';

        // Back to main menu and verify the menu's panel shows the new value.
        await page.getByRole('button', { name: /Main Menu/ }).click();
        await openMenuSettings(page);
        await expect(page.getByRole('switch', { name: 'Dark Mode' }))
            .toHaveAttribute('aria-checked', flipped);
    });
});
