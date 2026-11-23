import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  reporter: [
    ['junit', { outputFile: 'reports/functional.xml' }],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
  ],
  use: { baseURL: 'http://127.0.0.1:4100' },
  webServer: {
    command: 'HOST=127.0.0.1 PORT=4100 npm run start',
    url: 'http://127.0.0.1:4100/health',
    reuseExistingServer: !process.env.CI,
  },
});
