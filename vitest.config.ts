import { defineConfig } from 'vitest/config'

// Test config for the pure page-array transforms and storage orchestration.
// Kept separate from vite.config.ts so the build-only React/PWA plugins don't
// load during tests; the seams under test are pure logic (node environment).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
