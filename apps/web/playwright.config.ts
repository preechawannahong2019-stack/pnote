import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] },
  },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', cwd: new URL('.', import.meta.url).pathname, port: 4173, reuseExistingServer: true },
});
