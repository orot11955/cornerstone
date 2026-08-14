import { defineConfig, devices } from '@playwright/test'

const gate = process.env.PLAYWRIGHT_GATE === 'release' ? 'release' : 'smoke'
const requestedBrowsers = (
  process.env.PLAYWRIGHT_BROWSERS ?? (gate === 'release' ? 'all' : 'chromium')
)
  .split(',')
  .map((browser) => browser.trim())
const browserProjects = {
  chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  webkit: { name: 'webkit', use: { ...devices['Desktop Safari'] } },
} as const

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:3107',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  grep: gate === 'release' ? /@release/ : /@smoke/,
  projects: (requestedBrowsers.includes('all')
    ? Object.values(browserProjects)
    : requestedBrowsers.flatMap((browser) =>
        browser in browserProjects
          ? [browserProjects[browser as keyof typeof browserProjects]]
          : [],
      )) as (typeof browserProjects)[keyof typeof browserProjects][],
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3107',
    env: { NEXT_DIST_DIR: '.next-playwright' },
    url: 'http://127.0.0.1:3107/ui-foundation',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
