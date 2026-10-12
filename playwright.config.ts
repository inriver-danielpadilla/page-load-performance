import { PlaywrightTestConfig, defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// ENV_FILE selects an alternative env file, e.g. .env.test (see pnpm run perf:env-test).
dotenv.config({ path: path.resolve(__dirname, process.env.ENV_FILE || '.env'), quiet: true, override: true });

const reporters: PlaywrightTestConfig['reporter'] = [
  ['html', { open: 'never' }],
  ['junit', { outputFile: 'test-results/results.xml' }],
  ['list'],
];

const chrome = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 960 } };

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: reporters,
  use: {
    // Tracing every benchmark context would distort timings and stall teardown.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'login',
    testMatch: /login\.setup\.ts$/,
    use: chrome,
    retries: process.env.CI ? 1 : 0,
  }, {
    name: 'perf',
    testMatch: /\.perf\.ts$/,
    use: chrome,
    retries: 0,
    dependencies: ['login'],
  }],
});
