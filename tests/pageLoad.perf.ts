import { expect, test } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  appEnrichUrl, configurationName, environmentPath, perfSettings, portal2EnrichUrl, portal2Url, storageStatePath,
} from '../src/config';
import type { ComparisonRow, PageReport, Summary } from '../src/pageLoadComparison.mjs';

const { runs, pages, timeout, outputDir } = perfSettings;

function validateSettings() {
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new Error('PERF_RUNS must be an integer between 1 and 100');
  if (!Number.isInteger(timeout) || timeout < 1_000) throw new Error('PERF_TIMEOUT must be an integer of at least 1000 ms');
}

async function readStorageState(site: 'app' | 'portal2') {
  return JSON.parse(await fs.readFile(storageStatePath(site), 'utf8'));
}

function upsertPage(report: { pages: PageReport[]; samples: object[]; failures: string[] }, progress: PageReport) {
  const index = report.pages.findIndex(page => page.id === progress.id);
  if (index < 0) report.pages.push(progress);
  else report.pages[index] = progress;
  report.samples = report.pages.flatMap(page => page.samples.map(sample => ({ pageId: page.id, ...sample })));
  report.failures = report.pages.flatMap(page => page.failures.map(failure => `${page.name}: ${failure}`));
}

function readinessSummary(pageReport: PageReport) {
  const ready = pageReport.comparison.find((row: ComparisonRow) => row.key === 'pageReadyMs' || row.key === 'enrichReadyMs');
  const median = (value?: Summary | null) => (value ? `${value.median.toFixed(1)} ms` : 'n/a');
  return `${pageReport.status}; readiness median app=${median(ready?.app)}, portal2=${median(ready?.portal2)}`;
}

function finalize(report: { pages: PageReport[]; failures: string[]; comparison: ComparisonRow[]; status: string }, pageCount: number) {
  if (pageCount === 1 && report.pages.length) report.comparison = report.pages[0].comparison;
  report.status = report.failures.length ? 'INCOMPLETE' : 'COMPLETE';
}

test('Page load performance: app vs portal2', async ({ browser }, testInfo) => {
  validateSettings();

  const { runPageComparison, saveReport } = await import('../src/pageLoadComparison.mjs');
  const { buildPageTargets, selectScenarios } = await import('../src/pageLoadScenarios.mjs');

  const selected = selectScenarios(pages);
  test.setTimeout(selected.length * (runs + 1) * 2 * timeout + timeout);

  const targets = { app: appEnrichUrl, portal2: portal2EnrichUrl };
  const legacyUrls = Object.fromEntries(selected.map(scenario => [scenario.id, new URL(`/app/${scenario.route}`, portal2Url).href]));
  const pageTargets = buildPageTargets(selected, targets, environmentPath, legacyUrls);

  const states = { app: await readStorageState('app'), portal2: await readStorageState('portal2') };
  const settings = { timeout, runs };

  await fs.mkdir(outputDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(), configuration: configurationName,
    targets, runs, mode: 'headless', status: 'IN_PROGRESS', browserVersion: browser.version(),
    samples: [] as object[], failures: [] as string[], comparison: [] as ComparisonRow[],
    pages: [] as PageReport[], authenticationFailures: {},
  };

  for (const scenario of pageTargets) {
    await test.step(`${scenario.name} (${runs} runs per site)`, async () => {
      const pageReport = await runPageComparison(browser, scenario, states, settings, report, undefined, async (progress) => {
        upsertPage(report, progress);
        await saveReport(report, outputDir);
      });
      testInfo.annotations.push({ type: `perf:${scenario.id}`, description: readinessSummary(pageReport) });
      expect.soft(pageReport.failures, `${scenario.name} measurement failures`).toEqual([]);
    });
  }

  finalize(report, selected.length);
  await saveReport(report, outputDir);
  await testInfo.attach('comparison.html', { path: path.join(outputDir, 'comparison.html'), contentType: 'text/html' });
  await testInfo.attach('comparison.json', { path: path.join(outputDir, 'comparison.json'), contentType: 'application/json' });
});
