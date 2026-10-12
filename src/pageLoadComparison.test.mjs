import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { measure, openManualEnrich, runPageComparison } from './pageLoadComparison.mjs';
import { SCENARIOS } from './pageLoadScenarios.mjs';

let browser;
let server;
let origin;
const settings = { timeout: 5000 };
const storageState = { cookies: [], origins: [] };

before(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    const fixtures = {
      dashboard: '<div id="dashboard-app"><div class="dashboard__grid-wrapper">Dashboard</div></div>',
      planner: '<div class="planner-entity-content">Planner</div>',
      planrelease: '<div class="planrelease-startpage">Plan and Release</div>',
      supplieronboarding: '<div id="start-main-imports-container">Imports</div>',
      glossary: '<div id="app"><div role="toolbar">Glossary</div></div>',
      workflows: '<div class="q-page-container">No Workflows yet</div>',
      contentstore: '<div id="start-main-container">Content Store</div>',
      'contentstore-settings': '<div class="general-settings-box">Settings</div>',
    };
    if (request.url.startsWith('/shell/')) {
      response.end(`<iframe data-testid="legacy-portal-iframe" src="/view/${request.url.split('/').at(-1)}"></iframe>`);
      return;
    }
    if (request.url.startsWith('/view/')) {
      const id = request.url.split('/').at(-1);
      const scenario = SCENARIOS.find(item => item.id === id);
      if (scenario?.tab) {
        response.end(`<div id="main-container"><div class="syndication-box">
<ul class="js-main-tabs"><li><button class="${scenario.tab.split('.').at(-1)}"
onclick="document.querySelector('${scenario.slot}').hidden = false">Select tab</button></li></ul>
<div class="${scenario.slot.slice(1)}" hidden>Tab content</div></div></div>`);
      } else {
        response.end(fixtures[id] ?? '<div id="main-container">Enrich</div>');
      }
      return;
    }
    switch (request.url) {
      case '/shell':
        response.end('<iframe data-testid="legacy-portal-iframe" src="/delayed-enrich"></iframe>');
        break;
      case '/delayed-enrich':
        setTimeout(() => response.end('<div id="main-container">Enrich</div>'), 150);
        break;
      case '/enrich':
      case '/app/enrich':
        response.end('<div id="main-container">Enrich</div>');
        break;
      case '/app/dashboard':
        response.end('<div id="dashboard-app">Authenticated dashboard</div>');
        break;
      case '/env/customer/environment':
        response.end('<div>Selected app environment</div>');
        break;
      case '/env/customer/environment/app/enrich':
        response.end('<iframe data-testid="legacy-portal-iframe" src="/enrich"></iframe>');
        break;
      case '/failure':
        response.writeHead(503);
        response.end('Unavailable');
        break;
      case '/redirect':
        response.writeHead(302, { Location: origin.replace('127.0.0.1', 'localhost') + '/enrich' });
        response.end();
        break;
      default:
        response.end('<form>Login page, not Enrich</form>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('app readiness includes iframe delay and captures completed document timings', async () => {
  const sample = await measure(browser, 'app', `${origin}/shell`, storageState, settings);
  assert.ok(sample.metrics.enrichReadyMs >= 150);
  assert.ok(sample.metrics.loadMs > 0);
  assert.ok(sample.metrics.enrichDocumentLoadMs > 0);
  assert.equal(sample.finalLocation, `${origin}/shell`);
  assert.equal(browser.contexts().length, 0);
});

test('portal2 measures the direct Enrich document with the same metric shape', async () => {
  const sample = await measure(browser, 'portal2', `${origin}/enrich`, storageState, settings);
  assert.ok(sample.metrics.enrichReadyMs >= sample.metrics.domContentLoadedMs);
  assert.equal(sample.metrics.enrichDocumentLoadMs, sample.metrics.loadMs);
  assert.deepEqual(Object.keys(sample.metrics).sort(), [
    'domContentLoadedMs', 'enrichDocumentLoadMs', 'enrichReadyMs', 'fcpMs', 'loadMs', 'ttfbMs',
  ]);
});

test('HTTP errors, authentication redirects and login pages are not timing samples', async () => {
  await assert.rejects(measure(browser, 'portal2', `${origin}/failure`, storageState, settings), /HTTP 503/);
  await assert.rejects(measure(browser, 'portal2', `${origin}/redirect`, storageState, settings), /redirected/);
  await assert.rejects(measure(browser, 'portal2', `${origin}/login`, storageState, { timeout: 200 }), /Timeout/);
  assert.equal(browser.contexts().length, 0);
});

test('all concrete legacy pages use their own readiness checks on both hosts', async () => {
  for (const scenario of SCENARIOS.filter(item => item.id !== 'enrich')) {
    for (const site of ['app', 'portal2']) {
      const route = site === 'app' ? 'shell' : 'view';
      const sample = await measure(browser, site, `${origin}/${route}/${scenario.id}`, storageState, settings, scenario);
      assert.ok(sample.metrics.pageReadyMs > 0, `${site} ${scenario.id}`);
      assert.ok(sample.metrics.documentLoadMs > 0, `${site} ${scenario.id}`);
      assert.ok(!Object.hasOwn(sample.metrics, 'enrichReadyMs'));
    }
  }
  assert.equal(browser.contexts().length, 0);
});

test('a different legacy page cannot satisfy another page readiness check', async () => {
  const dashboard = SCENARIOS.find(item => item.id === 'dashboard');
  await assert.rejects(
    measure(browser, 'portal2', `${origin}/view/contentstore`, storageState, { timeout: 200 }, dashboard),
    /Timeout/,
  );
});

test('page orchestration discards warm-ups, alternates order and collects each sample only once', async () => {
  const scenario = {
    ...SCENARIOS.find(item => item.id === 'dashboard'),
    targets: { app: `${origin}/shell/dashboard`, portal2: `${origin}/view/dashboard` },
  };
  const calls = [];
  const pageReport = await runPageComparison(browser, scenario, { app: storageState, portal2: storageState },
    { ...settings, runs: 2 }, {}, async (...args) => {
      calls.push(args[1]);
      return await measure(...args);
    });
  assert.deepEqual(calls, ['app', 'portal2', 'app', 'portal2', 'portal2', 'app']);
  assert.equal(pageReport.samples.length, 4);
  assert.equal(pageReport.status, 'COMPLETE');
  assert.equal(pageReport.comparison[0].app.count, 2);
  assert.equal(pageReport.comparison[0].portal2.count, 2);
});

test('unavailable pages return explicit incomplete reports without manufactured samples', async () => {
  const scenario = {
    ...SCENARIOS.find(item => item.id === 'dashboard'),
    targets: { app: `${origin}/shell/contentstore`, portal2: `${origin}/view/contentstore` },
  };
  const pageReport = await runPageComparison(browser, scenario, { app: storageState, portal2: storageState },
    { timeout: 200, runs: 2 }, {});
  assert.equal(pageReport.status, 'INCOMPLETE');
  assert.equal(pageReport.failures.length, 2);
  assert.equal(pageReport.samples.length, 0);
  assert.equal(pageReport.comparison[0].app, null);
});

test('manual login advances from environment landing pages to Enrich automatically on both sites', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/app/dashboard`);
    await openManualEnrich(page, 'portal2', origin, '/env/customer/environment', settings.timeout);
    assert.equal(page.url(), `${origin}/app/enrich`);
    await page.goto(`${origin}/env/customer/environment`);
    await openManualEnrich(page, 'app', `${origin}/env/customer/environment/app/enrich`,
      '/env/customer/environment', settings.timeout);
    assert.equal(page.url(), `${origin}/env/customer/environment/app/enrich`);
    await page.goto(`${origin}/env/wrong/environment`);
    await assert.rejects(openManualEnrich(page, 'app', `${origin}/env/customer/environment/app/enrich`,
      '/env/customer/environment', 200), /Timeout/);
    await page.goto(`${origin}/app/Environment`);
    await assert.rejects(openManualEnrich(page, 'portal2', origin, '/env/customer/environment', 200), /Timeout/);
  } finally {
    await context.close();
  }
});

test('one failed warm-up does not suppress healthy-site measurements or progress checkpoints', async () => {
  const scenario = { ...SCENARIOS[0], targets: { app: 'https://app.example/', portal2: 'https://portal2.example/' } };
  const calls = [];
  const checkpoints = [];
  const fakeMeasure = (_browser, site) => {
    calls.push(site);
    if (site === 'portal2') return Promise.reject(new Error('Warm-up rejected'));
    return Promise.resolve({ metrics: { enrichReadyMs: 123, enrichDocumentLoadMs: 100 } });
  };
  const result = await runPageComparison(browser, scenario, { app: storageState, portal2: storageState },
    { runs: 10 }, {}, fakeMeasure, (report) => {
      checkpoints.push(report.samples.length);
      return Promise.resolve();
    });
  assert.equal(calls.filter(site => site === 'portal2').length, 1);
  assert.equal(result.samples.length, 10);
  assert.equal(result.comparison[0].app.count, 10);
  assert.equal(result.comparison[0].portal2, null);
  assert.equal(result.comparison[0].deltaMs, null);
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.siteResults.app.status, 'COMPLETE');
  assert.equal(result.siteResults.portal2.status, 'BLOCKED');
  assert.deepEqual(checkpoints, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
});

test('failed authentication blocks only that site and never measures it without storage state', async () => {
  const scenario = { ...SCENARIOS[0], targets: { app: 'https://app.example/', portal2: 'https://portal2.example/' } };
  const calls = [];
  const result = await runPageComparison(browser, scenario, { app: storageState }, { runs: 2 },
    { authenticationFailures: { portal2: 'Manual login did not complete.' } }, (_browser, site) => {
      calls.push(site);
      return Promise.resolve({ metrics: { enrichReadyMs: 100 } });
    });
  assert.deepEqual(calls, ['app', 'app', 'app']);
  assert.equal(result.samples.length, 2);
  assert.equal(result.siteResults.portal2.reason, 'Manual login did not complete.');
  assert.equal(result.status, 'INCOMPLETE');
});
