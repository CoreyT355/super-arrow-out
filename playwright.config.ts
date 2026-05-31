import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e safety net for the refactor.
 *
 * The suite locks down user-facing behavior of `+page.svelte` BEFORE we begin
 * decomposing it into components. Every refactor step PR re-runs this suite.
 *
 * Tests target a freshly-built dev server (`npm run dev`) and assume no
 * pre-existing localStorage state — `context.clearCookies()` plus a per-test
 * `localStorage.clear()` keeps each test isolated.
 */
export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // localStorage is shared by origin; serial keeps state predictable.
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: process.env.CI ? 'github' : 'list',

    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
        viewport: { width: 800, height: 1000 },
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
