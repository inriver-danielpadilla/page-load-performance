import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import { compare, renderReport } from './pageLoadMetrics.mjs';
import { buildPageTargets, SCENARIOS, selectScenarios, validateTargetUrl } from './pageLoadScenarios.mjs';

dotenv.config({
  path: path.resolve(fileURLToPath(new URL('..', import.meta.url)), process.env.ENV_FILE || '.env'),
  override: true,
  quiet: true,
});

function options(argv) {
  const result = {
    configuration: process.env.PERF_CONFIGURATION_NAME ?? process.env.TEST_CONFIGURATION_NAME,
    runs: 10,
    timeout: 60000,
    output: 'temp/page-load-comparison',
    headed: false,
    manualLogin: false,
    appUrl: undefined,
    portal2Url: undefined,
    pages: 'enrich',
    targetsFile: undefined,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    // pnpm forwards the `--` script-argument separator verbatim.
    if (flag === '--') continue;
    if (flag === '--headed') { result.headed = true; continue; }
    if (flag === '--manual-login') { result.manualLogin = true; result.headed = true; continue; }
    const keys = {
      '--configuration': 'configuration', '--runs': 'runs', '--timeout': 'timeout',
      '--output': 'output', '--app-url': 'appUrl', '--portal2-url': 'portal2Url',
      '--pages': 'pages', '--targets-file': 'targetsFile',
    };
    const key = keys[flag];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Unknown option or missing value: ${flag}`);
    }
    const value = argv[++index];
    result[key] = key === 'runs' || key === 'timeout' ? Number(value) : value;
  }
  if (!Number.isInteger(result.runs) || result.runs < 2 || result.runs > 100) {
    throw new Error('--runs must be an integer between 2 and 100');
  }
  if (!Number.isInteger(result.timeout) || result.timeout < 1000) {
    throw new Error('--timeout must be an integer of at least 1000 milliseconds');
  }
  if (!/^[^-]+-[^-]+-[^-]+-[^-]+$/.test(result.configuration ?? '')) {
    throw new Error('Provide --configuration <stack>-<region>-<customer>-<environment>');
  }
  return result;
}

function safeLocation(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

class BenchmarkError extends Error {}

function failureReason(error) {
  if (error instanceof BenchmarkError) return error.message;
  if (error.name === 'TimeoutError') return 'Timed out waiting for navigation or the expected page element.';
  return `Browser operation failed (${error.name ?? 'Error'}); raw call logs omitted to protect authentication data.`;
}

async function waitForEnrich(page, site, timeout) {
  await waitForPage(page, site, SCENARIOS[0], timeout);
}

export async function openManualEnrich(page, site, url, environmentPath, timeout) {
  const target = new URL(url);
  await page.waitForURL((location) => {
    if (location.origin !== target.origin) return false;
    return site === 'app'
      ? location.pathname === environmentPath || location.pathname.startsWith(`${environmentPath}/`)
      : location.pathname.startsWith('/app/') && !/^\/app\/environment\/?$/i.test(location.pathname);
  }, { timeout, waitUntil: 'domcontentloaded' });
  const enrichUrl = site === 'portal2' && target.pathname === '/'
    ? new URL('/app/enrich', target.origin).href : url;
  await page.goto(enrichUrl, { waitUntil: 'domcontentloaded', timeout });
  await waitForEnrich(page, site, timeout);
}

export async function waitForPage(page, site, scenario, timeout, activateTab = false) {
  const scope = site === 'app' ? page.frameLocator('[data-testid="legacy-portal-iframe"]') : page;
  if (activateTab && scenario.tab) {
    await scope.locator(scenario.tab).click({ timeout });
  }
  let root = scope.locator(scenario.selector);
  if (scenario.text) root = root.filter({ hasText: scenario.text });
  if (scenario.toolbar) root = root.filter({ has: scope.getByRole('toolbar') });
  await root.waitFor({ state: 'visible', timeout });
  if (scenario.slot) await scope.locator(scenario.slot).waitFor({ state: 'visible', timeout });
}

const normalizeName = value => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function selectLegacyEnvironment(page, customerSafename, environmentSafename, timeout) {
  const cards = page.locator('.js-environment-card');
  await cards.first().waitFor({ state: 'visible', timeout });
  const tiles = await cards.evaluateAll(elements => elements.map(element => ({
    environment: element.getAttribute('title'),
    customer: element.querySelector('.environment-card__customer-name')?.getAttribute('title'),
  })));
  const index = tiles.findIndex(tile => normalizeName(tile.environment) === normalizeName(environmentSafename)
    && normalizeName(tile.customer) === normalizeName(customerSafename));
  if (index < 0) {
    throw new BenchmarkError(`Environment ${customerSafename}/${environmentSafename} is not available on the legacy environment picker`);
  }
  await cards.nth(index).click();
  await page.waitForURL(location => !/^\/app\/environment\/?$/i.test(location.pathname), { timeout });
}

export async function authenticate(browser, site, url, settings, environmentPath) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  let stage = 'opening the target URL';
  try {
    page.setDefaultTimeout(settings.timeout);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: settings.timeout });
    if (settings.manualLogin) {
      stage = 'manual sign-in, environment selection and automatic Enrich navigation';
      console.log(`${site}: sign in and select the requested environment (up to 5 minutes). Enrich opens automatically.`);
      await openManualEnrich(page, site, url, environmentPath, 300000);
    } else {
      if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
        throw new BenchmarkError('TEST_USERNAME and TEST_PASSWORD must be configured in .env, or use --manual-login');
      }
      const email = page.locator('input#username, input[type="email"]');
      if (await email.count()) {
        stage = 'submitting the email address';
        await email.fill(process.env.TEST_USERNAME);
        await page.locator('button[type="submit"], input[type="submit"]').click();
        stage = 'submitting the password';
        await page.locator('input[type="password"]:visible').fill(process.env.TEST_PASSWORD);
        await page.locator('button[type="submit"], input[type="submit"]').click();
        stage = 'completing sign-in';
        await page.waitForURL((location) => {
          const target = new URL(url);
          return location.origin === target.origin
            || (site === 'portal2' && location.hostname === target.hostname.replace('portal2-', 'portal-'));
        }, { timeout: settings.timeout, waitUntil: 'domcontentloaded' });
      }
      if (site === 'app' && new URL(page.url()).pathname !== new URL(url).pathname) {
        stage = 'finding the requested customer/environment';
        const environmentLink = page.locator(`a[href="${environmentPath}"]`);
        await environmentLink.waitFor({ state: 'visible' });
        await environmentLink.click();
      }
      if (site === 'portal2' && /^\/app\/environment\/?$/i.test(new URL(page.url()).pathname)) {
        stage = 'selecting the requested customer/environment';
        const [, , customer, environment] = environmentPath.split('/');
        await selectLegacyEnvironment(page, customer, environment, settings.timeout);
      }
      stage = 'opening authenticated Enrich';
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: settings.timeout });
      await waitForEnrich(page, site, settings.timeout);
    }
    if (new URL(page.url()).origin !== new URL(url).origin) {
      throw new BenchmarkError(`Authentication redirected away from the requested host to ${safeLocation(page.url())}`);
    }
    return await context.storageState();
  } catch (error) {
    const rejected = await page.getByText('wrong email or password', { exact: true }).isVisible();
    const reason = rejected ? 'The sign-in page rejected the configured credentials.' : failureReason(error);
    const location = new URL(page.url());
    const target = new URL(url);
    const knownHost = location.origin === target.origin
      || (site === 'portal2' && location.hostname === target.hostname.replace('portal2-', 'portal-'));
    const current = knownHost ? safeLocation(page.url()) : 'external sign-in page';
    throw new BenchmarkError(`Failed while ${stage}. ${reason} Current location: ${current}.`);
  } finally {
    await context.close();
  }
}

async function documentMetrics(frame, timeout) {
  await frame.waitForFunction(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    return navigation && navigation.loadEventEnd > 0;
  }, undefined, { timeout });
  return frame.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (!navigation || navigation.loadEventEnd <= 0) {
      throw new Error('No completed navigation timing entry');
    }
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      ttfbMs: navigation.responseStart - navigation.startTime,
      domContentLoadedMs: navigation.domContentLoadedEventEnd - navigation.startTime,
      loadMs: navigation.loadEventEnd - navigation.startTime,
      fcpMs: paint?.startTime ?? null,
    };
  });
}

export async function measure(browser, site, url, storageState, settings, scenario = SCENARIOS[0]) {
  const context = await browser.newContext({
    storageState, viewport: { width: 1280, height: 960 }, serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: settings.timeout });
    if (!response || !response.ok()) {
      throw new BenchmarkError(`Navigation returned HTTP ${response?.status() ?? 'no response'}`);
    }
    if (new URL(page.url()).origin !== new URL(url).origin) {
      const current = new URL(page.url());
      const requested = new URL(url);
      const isOlderPortal = site === 'portal2' && current.hostname === requested.hostname.replace('portal2-', 'portal-');
      throw new BenchmarkError(isOlderPortal
        ? `Requested portal2 page redirected to the older portal: ${safeLocation(page.url())}`
        : 'Navigation redirected to another host; authentication may have expired');
    }
    await waitForPage(page, site, scenario, settings.timeout, true);
    const enrichReadyMs = await page.evaluate(() => performance.now());
    await page.waitForLoadState('load', { timeout: settings.timeout });
    const top = await documentMetrics(page.mainFrame(), settings.timeout);
    let enrich = top;
    if (site === 'app') {
      const iframe = await page.locator('[data-testid="legacy-portal-iframe"]').elementHandle();
      const frame = await iframe?.contentFrame();
      if (!frame) throw new BenchmarkError('Legacy application iframe is unavailable');
      await frame.waitForLoadState('load', { timeout: settings.timeout });
      enrich = await documentMetrics(frame, settings.timeout);
    }
    return {
      metrics: scenario.id === 'enrich'
        ? { enrichReadyMs, ...top, enrichDocumentLoadMs: enrich.loadMs }
        : { pageReadyMs: enrichReadyMs, ...top, documentLoadMs: enrich.loadMs },
      finalLocation: safeLocation(page.url()),
    };
  } finally {
    await context.close();
  }
}

export async function runPageComparison(browser, scenario, states, settings, metadata, measurePage = measure, onProgress) {
  const pageReport = {
    ...metadata, id: scenario.id, name: scenario.name, targets: scenario.targets,
    readiness: scenario.selector, includesTabSelection: !!scenario.tab,
    samples: [], failures: [], comparison: [],
    siteResults: {},
    status: 'IN_PROGRESS',
  };
  delete pageReport.pages;
  for (const site of ['app', 'portal2']) {
    if (!states[site]) {
      const reason = metadata.authenticationFailures?.[site] ?? 'No authenticated storage state is available.';
      pageReport.siteResults[site] = { status: 'BLOCKED', reason };
      pageReport.failures.push(`${site}: ${reason}`);
      continue;
    }
    try {
      await measurePage(browser, site, scenario.targets[site], states[site], settings, scenario);
      pageReport.siteResults[site] = { status: 'READY', reason: null };
    } catch (error) {
      const message = `${scenario.name} ${site}: warm-up failed. ${failureReason(error)}`;
      console.error(message);
      pageReport.failures.push(message);
      pageReport.siteResults[site] = { status: 'BLOCKED', reason: message };
    }
  }
  if (onProgress) await onProgress(pageReport);
  if (Object.values(pageReport.siteResults).some(result => result.status === 'READY')) {
    for (let run = 1; run <= settings.runs; run++) {
      const order = run % 2 ? ['app', 'portal2'] : ['portal2', 'app'];
      for (const site of order) {
        if (pageReport.siteResults[site].status === 'BLOCKED') continue;
        try {
          const sample = await measurePage(browser, site, scenario.targets[site], states[site], settings, scenario);
          pageReport.samples.push({ site, run, status: 'passed', ...sample });
          const ready = sample.metrics.pageReadyMs ?? sample.metrics.enrichReadyMs;
          console.log(`${scenario.name} ${site} run ${run}: visible in ${ready.toFixed(1)} ms`);
        } catch (error) {
          const message = `${site} run ${run}: ${failureReason(error)} Excluded from timing statistics.`;
          console.error(message);
          pageReport.failures.push(message);
          pageReport.samples.push({ site, run, status: 'failed', error: message });
        }
        pageReport.comparison = compare(pageReport.samples, scenario.id !== 'enrich');
        if (onProgress) await onProgress(pageReport);
      }
    }
  }
  pageReport.status = pageReport.failures.length ? 'INCOMPLETE' : 'COMPLETE';
  for (const site of ['app', 'portal2']) {
    if (pageReport.siteResults[site].status === 'BLOCKED') continue;
    const failures = pageReport.samples.filter(sample => sample.site === site && sample.status === 'failed');
    pageReport.siteResults[site] = {
      status: failures.length ? 'INCOMPLETE' : 'COMPLETE',
      reason: failures.length ? `${failures.length} measured loads failed; see sample errors.` : null,
    };
  }
  pageReport.comparison = compare(pageReport.samples, scenario.id !== 'enrich');
  if (onProgress) await onProgress(pageReport);
  return pageReport;
}

async function main() {
  const settings = options(process.argv.slice(2));
  const [stack, region, customer, environment] = settings.configuration.split('-');
  const environmentPath = `/env/${customer}/${environment}`;
  const targets = {
    app: settings.appUrl ?? `https://app-${stack}-${region}.productmarketingcloud.com${environmentPath}/app/enrich`,
    portal2: settings.portal2Url ?? `https://portal2-${stack}-${region}.productmarketingcloud.com/`,
  };
  for (const url of Object.values(targets)) validateTargetUrl(url);
  const selected = selectScenarios(settings.pages);
  let legacyUrls = {};
  if (settings.targetsFile) {
    legacyUrls = JSON.parse(await fs.readFile(settings.targetsFile, 'utf8'));
    if (!legacyUrls || typeof legacyUrls !== 'object' || Array.isArray(legacyUrls)
      || Object.entries(legacyUrls).some(([id, url]) => !SCENARIOS.some(scenario => scenario.id === id) || typeof url !== 'string')) {
      throw new Error('--targets-file must be a JSON object mapping known page IDs to legacy HTTPS URL strings');
    }
  }
  const pageTargets = buildPageTargets(selected, targets, environmentPath, legacyUrls);
  await fs.mkdir(settings.output, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(), configuration: settings.configuration,
    targets, runs: settings.runs, mode: settings.headed ? 'headed' : 'headless',
    status: 'IN_PROGRESS', browserVersion: null, samples: [], failures: [], comparison: [],
    pages: [],
    authenticationFailures: {},
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: !settings.headed });
    report.browserVersion = browser.version();
    const states = {};
    for (const [site, url] of Object.entries(targets)) {
      console.log(`Authenticating ${site}; login is outside the timed samples.`);
      try {
        states[site] = await authenticate(browser, site, url, settings, environmentPath);
      } catch (error) {
        // Playwright call logs can contain form values or authentication URLs; do not persist them.
        const message = `${site}: authentication/Enrich readiness failed. ${failureReason(error)}`;
        console.error(message);
        report.failures.push(message);
        report.authenticationFailures[site] = message;
      }
    }
    for (const scenario of pageTargets) {
      await runPageComparison(browser, scenario, states, settings, report, measure, async (pageReport) => {
        const index = report.pages.findIndex(page => page.id === scenario.id);
        if (index < 0) report.pages.push(pageReport);
        else report.pages[index] = pageReport;
        report.samples = report.pages.flatMap(page => page.samples.map(sample => ({ pageId: page.id, ...sample })));
        report.failures = [
          ...Object.values(report.authenticationFailures),
          ...report.pages.flatMap(page => page.failures.map(failure => `${page.name}: ${failure}`)),
        ];
        await saveReport(report, settings.output);
      });
    }
    report.status = report.failures.length ? 'INCOMPLETE' : 'COMPLETE';
  } catch (error) {
    const message = `Browser setup failed. ${failureReason(error)}`;
    console.error(message);
    report.failures.push(message);
  } finally {
    if (browser) await browser.close();
    for (const scenario of pageTargets) {
      if (!report.pages.some(page => page.id === scenario.id)) {
        report.pages.push({
          ...report, pages: undefined, id: scenario.id, name: scenario.name, targets: scenario.targets,
          readiness: scenario.selector, includesTabSelection: !!scenario.tab, samples: [],
          failures: ['Not measured: browser setup or authentication failed.'],
          comparison: compare([], scenario.id !== 'enrich'), status: 'INCOMPLETE',
        });
      }
    }
    if (selected.length === 1 && report.pages.length) {
      report.comparison = report.pages[0].comparison;
    }
    await saveReport(report, settings.output);
  }
  console.log(`${report.status}: reports saved in ${path.resolve(settings.output)}`);
  if (report.status !== 'COMPLETE') process.exitCode = 1;
}

export async function saveReport(report, output) {
  await fs.writeFile(path.join(output, 'comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(output, 'comparison.html'), renderReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
