import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  fullyParallel: true,
  workers: process.env.CI ? '50%' : 4,
  maxFailures: process.env.CI ? 10 : undefined,
  reportSlowTests: {
    max: 15,
    threshold: 20_000,
  },
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
