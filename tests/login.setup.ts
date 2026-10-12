import { expect, test } from '@playwright/test';
import * as fs from 'fs/promises';
import {
  appEnrichUrl, environmentPath, perfSettings, portal2EnrichUrl, storageStateDir, storageStatePath,
} from '../src/config';

const targets = { app: appEnrichUrl, portal2: portal2EnrichUrl } as const;

for (const site of ['app', 'portal2'] as const) {
  test(`Login to ${site} and save storage state`, async ({ browser }) => {
    test.setTimeout(perfSettings.timeout * 5);
    const { authenticate } = await import('../src/pageLoadComparison.mjs');

    const storageState = await authenticate(browser, site, targets[site], { timeout: perfSettings.timeout, manualLogin: false }, environmentPath);
    expect(storageState.cookies.length, `${site} login should produce cookies`).toBeGreaterThan(0);

    await fs.mkdir(storageStateDir, { recursive: true });
    await fs.writeFile(storageStatePath(site), JSON.stringify(storageState));
  });
}
