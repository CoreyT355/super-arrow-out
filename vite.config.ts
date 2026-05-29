import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    test: {
        // Vitest by default picks up every *.spec.ts. The Playwright e2e
        // suite under tests/e2e/ uses Playwright's own test runner and must
        // be excluded here, otherwise `npm run test` tries to load it as a
        // vitest file and crashes on the `import` of @playwright/test.
        exclude: ['**/node_modules/**', '**/tests/e2e/**'],
    },
});
