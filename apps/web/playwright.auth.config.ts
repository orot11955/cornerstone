import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-auth',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  outputDir: 'test-results/auth',
  use: {
    baseURL: 'http://127.0.0.1:3107',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3107',
    env: {
      NEXT_DIST_DIR: '.next-playwright/auth',
      SITE_URL: 'http://127.0.0.1:3107',
      INTERNAL_API_URL: 'http://127.0.0.1:4107',
    },
    url: 'http://127.0.0.1:3107/login',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
