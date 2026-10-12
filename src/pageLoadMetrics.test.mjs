import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, escapeHtml, METRICS, renderReport, summarize } from './pageLoadMetrics.mjs';
import { buildPageTargets, SCENARIOS, selectScenarios } from './pageLoadScenarios.mjs';

test('median, nearest-rank p95 and bounds use sorted samples without mutation', () => {
  const values = [40, 10, 30, 20];
  assert.deepEqual(summarize(values), { count: 4, median: 25, p95: 40, min: 10, max: 40 });
  assert.deepEqual(values, [40, 10, 30, 20]);
  assert.equal(summarize([3, 1, 2]).median, 2);
  assert.equal(summarize(Array.from({ length: 20 }, (_, index) => index + 1)).p95, 19);
});

test('missing samples are unavailable and invalid timings fail explicitly', () => {
  assert.equal(summarize([]), null);
  for (const value of [NaN, Infinity, -1]) {
    assert.throws(() => summarize([value]), /finite, non-negative/);
  }
});

test('comparison excludes failures and missing paints and computes signed deltas', () => {
  const metrics = value => Object.fromEntries(Object.keys(METRICS).map(key => [key, value]));
  const rows = compare([
    { site: 'app', status: 'passed', metrics: { ...metrics(100), fcpMs: null } },
    { site: 'portal2', status: 'passed', metrics: metrics(80) },
    { site: 'app', status: 'failed' },
  ]);
  assert.equal(rows[0].deltaMs, -20);
  assert.equal(rows[0].deltaPercent, -20);
  assert.equal(rows.find(row => row.key === 'fcpMs').app, null);
  assert.equal(compare([])[0].deltaMs, null);
  assert.equal(compare([
    { site: 'app', status: 'passed', metrics: metrics(0) },
    { site: 'portal2', status: 'passed', metrics: metrics(1) },
  ])[0].deltaPercent, null);
});

test('offline report escapes content and marks unavailable results', () => {
  assert.equal(escapeHtml('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
  const html = renderReport({
    status: 'INCOMPLETE', generatedAt: 'today', configuration: 'test',
    targets: { app: 'https://app.example/', portal2: 'https://portal2.example/' },
    runs: 10, mode: 'headless', samples: [], failures: ['<script>alert(1)</script>'], comparison: compare([]),
  });

  assert.ok(html.includes('INCOMPLETE'));
  assert.ok(html.includes('N/A'));
  assert.ok(html.includes('app: 0 valid, 0 failed'));
  assert.ok(!html.includes('<script>'));
});

test('all concrete pages are selectable and legacy mappings fail explicitly rather than guessing', () => {
  assert.equal(selectScenarios('all').length, 12);
  assert.deepEqual(selectScenarios('dashboard,contentstore').map(item => item.id), ['dashboard', 'contentstore']);
  assert.throws(() => selectScenarios('missing'), /Unknown page/);
  assert.throws(() => selectScenarios('enrich,enrich'), /duplicate/);
  const targets = { app: 'https://app.example/env/c/e/app/enrich', portal2: 'https://portal2.example/' };
  assert.throws(() => buildPageTargets(SCENARIOS, targets, '/env/c/e'), /Missing legacy URL/);
  const mapping = Object.fromEntries(SCENARIOS.map(scenario => [scenario.id, `https://portal2.example/${scenario.id}`]));
  const pages = buildPageTargets(SCENARIOS, targets, '/env/c/e', mapping);
  assert.equal(pages.find(page => page.id === 'planner').targets.app, 'https://app.example/env/c/e/app/planner#dashboard');
  assert.equal(pages.find(page => page.id === 'contentstore-settings').targets.app,
    'https://app.example/env/c/e/app/contentstore#settings');
  assert.throws(() => buildPageTargets(SCENARIOS, targets, '/env/c/e', { ...mapping, dashboard: 'https://other.example/' }),
    /configured site origin/);
  assert.throws(() => buildPageTargets(SCENARIOS, targets, '/env/c/e', {
    ...mapping, dashboard: 'https://portal2.example/?access_token=secret',
  }), /query parameters/);
  assert.throws(() => buildPageTargets(SCENARIOS, targets, '/env/c/e', {
    ...mapping, dashboard: 'https://portal2.example/#access_token=secret',
  }), /plain route/);
  assert.equal(buildPageTargets(selectScenarios('dashboard'), targets, '/env/c/e', {
    dashboard: 'https://portal2.example/#/dashboard',
  })[0].targets.portal2, 'https://portal2.example/#/dashboard');
});

test('multi-page reports keep generic timing statistics and raw samples separated', () => {
  const base = {
    status: 'COMPLETE', generatedAt: 'today', configuration: 'test',
    targets: { app: 'https://app.example/', portal2: 'https://portal2.example/' },
    runs: 2, mode: 'headless', failures: [],
  };
  const pages = ['Dashboard', 'Planner'].map((name, index) => {
    const samples = ['app', 'portal2'].map(site => ({
      site, status: 'passed', metrics: { pageReadyMs: (index + 1) * 100, documentLoadMs: 10 },
    }));
    return { ...base, name, samples, comparison: compare(samples, true) };
  });
  assert.equal(pages[0].comparison[0].app.median, 100);
  assert.equal(pages[1].comparison[0].app.median, 200);
  const html = renderReport({ ...base, pages });
  assert.ok(html.includes('Dashboard page load comparison'));
  assert.ok(html.includes('Planner page load comparison'));
  assert.equal((html.match(/<!doctype html>/g) ?? []).length, 1);
  assert.ok(html.includes('Page-specific readiness'));
});

test('missing results explain blocked sites separately from unavailable browser timing entries', () => {
  const samples = [{ site: 'app', status: 'passed', metrics: { enrichReadyMs: 100, fcpMs: null } }];
  const html = renderReport({
    status: 'INCOMPLETE', generatedAt: 'today', configuration: 'test',
    targets: { app: 'https://app.example/', portal2: 'https://portal2.example/' },
    runs: 2, mode: 'headless', samples, failures: ['portal2 authentication failed'],
    siteResults: {
      app: { status: 'COMPLETE', reason: null },
      portal2: { status: 'BLOCKED', reason: 'Authentication failed <retry>' },
    },
    comparison: compare(samples),
  });
  assert.ok(html.includes('100.0 / 100.0 (1)'));
  assert.ok(html.includes('N/A (n=0): Timing entry unavailable in successful loads.'));
  assert.ok(html.includes('N/A (n=0): Authentication failed &lt;retry&gt;'));
  assert.ok(html.includes('portal2: BLOCKED'));
});
