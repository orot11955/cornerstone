import { defineConfig, devices } from '@playwright/test'

const browserProjects = {
  chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  webkit: { name: 'webkit', use: { ...devices['Desktop Safari'] } },
} as const
const requestedBrowsers = (process.env.PLAYWRIGHT_BROWSERS ?? 'chromium')
  .split(',')
  .map((browser) => browser.trim())
const unknownBrowsers = requestedBrowsers.filter((browser) => !(browser in browserProjects))
if (unknownBrowsers.length > 0)
  throw new Error(`Unsupported Playwright browser: ${unknownBrowsers.join(', ')}`)

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:3117',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: requestedBrowsers.map(
    (browser) => browserProjects[browser as keyof typeof browserProjects],
  ),
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3117',
    url: 'http://127.0.0.1:3117/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
