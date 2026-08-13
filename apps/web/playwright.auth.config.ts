import { defineConfig, devices } from '@playwright/test'

const apiPort = requiredPort('M6_E2E_API_PORT')
const webPort = requiredPort('M6_E2E_WEB_PORT')

export default defineConfig({
  testDir: './e2e-auth',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  outputDir: 'test-results/auth',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${webPort}`,
    env: {
      NEXT_DIST_DIR: '.next-playwright/auth',
      SITE_URL: `http://127.0.0.1:${webPort}`,
      INTERNAL_API_URL: `http://127.0.0.1:${apiPort}`,
    },
    url: `http://127.0.0.1:${webPort}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

function requiredPort(name: string): number {
  const value = process.env[name]
  if (!value || !/^\d{1,5}$/.test(value)) throw new Error(`${name} must be a TCP port`)
  const port = Number(value)
  if (port < 1024 || port > 65_535) throw new Error(`${name} must be between 1024 and 65535`)
  return port
}
