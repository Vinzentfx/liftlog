import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 20_000,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
});
