export const METRICS = {
  enrichReadyMs: 'Enrich container visible (end-to-end)',
  ttfbMs: 'Top-level TTFB (navigation start to first byte)',
  domContentLoadedMs: 'Top-level DOMContentLoaded',
  loadMs: 'Top-level load event',
  fcpMs: 'Top-level first contentful paint',
  enrichDocumentLoadMs: 'Enrich document load (relative to its own navigation)',
};

export function summarize(values) {
  if (!values.length) return null;
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Timing samples must be finite, non-negative numbers');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted.at(-1),
  };
}

export function compare(samples, generic = false) {
  const metrics = generic ? {
    pageReadyMs: 'Page-specific readiness (end-to-end)',
    ...Object.fromEntries(Object.entries(METRICS).filter(([key]) => !key.startsWith('enrich'))),
    documentLoadMs: 'Legacy document load (relative to its own navigation)',
  } : METRICS;
  return Object.entries(metrics).map(([key, label]) => {
    const summaries = ['app', 'portal2'].map(site => summarize(samples
      .filter(sample => sample.site === site && sample.status === 'passed' && sample.metrics[key] != null)
      .map(sample => sample.metrics[key])));
    const [app, portal2] = summaries;
    const deltaMs = app && portal2 ? portal2.median - app.median : null;
    return {
      key, label, app, portal2, deltaMs,
      deltaPercent: deltaMs !== null && app.median > 0 ? deltaMs / app.median * 100 : null,
    };
  });
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
  })[character]);
}

export function renderReport(report, embedded = false) {
  if (report.pages?.length) {
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Legacy pages load comparison</title>
<style>body{font:16px system-ui;margin:32px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccd1d1;padding:10px}section{border-top:3px solid #ccd1d1;margin-top:32px}
pre,code{overflow-wrap:anywhere;white-space:pre-wrap}</style>
<h1>Legacy pages load comparison</h1><p>${escapeHtml(report.status)} - ${escapeHtml(report.configuration)}</p>
${report.failures.length ? `<h2>Failures / blockers</h2><ul>${report.failures
  .map(failure => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>` : ''}
<p>Each page is compared independently. Results from different pages are never pooled.
Tab scenarios include loading the containing application and selecting the tab, not a standalone tab navigation.</p>
${report.pages.map(page => `<section>${renderReport(page, true)}</section>`).join('\n')}</html>`;
  }
  const number = value => value === null ? 'N/A' : value.toFixed(1);
  const summary = (value, site) => {
    if (value) return `${number(value.median)} / ${number(value.p95)} (${value.count})`;
    const valid = report.samples.filter(sample => sample.site === site && sample.status === 'passed').length;
    const reason = report.siteResults?.[site]?.reason
      ?? (valid ? 'Timing entry unavailable in successful loads.' : 'No successful measured loads; see failures / blockers.');
    return `N/A (n=0): ${escapeHtml(reason)}`;
  };
  const rows = report.comparison.map(row => `<tr><td>${escapeHtml(row.label)}</td>`
    + `<td>${summary(row.app, 'app')}</td><td>${summary(row.portal2, 'portal2')}</td>`
    + `<td>${number(row.deltaMs)}</td><td>${number(row.deltaPercent)}</td></tr>`).join('\n');
  const failures = report.failures.map(failure => `<li>${escapeHtml(failure)}</li>`).join('\n');
  const counts = ['app', 'portal2'].map(site => ({
    site,
    passed: report.samples.filter(sample => sample.site === site && sample.status === 'passed').length,
    failed: report.samples.filter(sample => sample.site === site && sample.status === 'failed').length,
  }));
  const title = `${report.name ?? 'Enrich'} page load comparison`;
  return `${embedded ? '' : `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Enrich page load comparison</title>
<style>
body{font:16px system-ui;margin:32px;color:#17202a;max-width:1200px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd1d1;padding:10px;text-align:left}
th{background:#eef2f5}.status{font-weight:bold}code{overflow-wrap:anywhere}
</style>`}
<h1>${escapeHtml(title)}</h1>
<p class="status">${escapeHtml(report.status)} — ${escapeHtml(report.generatedAt)}</p>
<p>App: <code>${escapeHtml(report.targets.app)}</code><br>
Portal2: <code>${escapeHtml(report.targets.portal2)}</code></p>
<p>Configuration: ${escapeHtml(report.configuration)}.
Chromium ${escapeHtml(report.browserVersion ?? 'not launched')}, ${escapeHtml(report.mode)}, 1280 × 960 viewport.</p>
<p>Planned: ${report.runs} measured loads per site after one discarded warm-up per site, alternating order.
Collected: ${counts.map(count => `${count.site}: ${count.passed} valid, ${count.failed} failed`).join('; ')}.
${report.siteResults ? `Site status: ${Object.entries(report.siteResults)
  .map(([site, result]) => `${site}: ${escapeHtml(result.status)}`).join('; ')}.` : ''}
Each load uses a fresh browser context with authenticated storage state; login is excluded.
Browser HTTP cache is fresh, but OS DNS, shared browser connections and server caches are not reset.
Service workers are blocked. No CPU/network throttling. No fixed sleeps or network-idle readiness.</p>
<p>Primary metric: navigation start until the page-specific readiness checks pass
(root: <code>${escapeHtml(report.readiness ?? '#main-container')}</code>)
(inside the legacy iframe on app). This matches the existing page-object readiness check,
not a guarantee that all data or interactive controls have finished loading.
Document timings on app describe the shell; portal2 describes the direct legacy document.
The legacy document metric is relative to each document's own start, not end-to-end.
Missing paint entries are N/A. P95 uses nearest rank and is descriptive for small samples.</p>
<table><thead><tr><th>Metric (ms)</th><th>App median / p95 (n)</th><th>Portal2 median / p95 (n)</th>
<th>Median delta (ms)</th><th>Median delta (%)</th></tr></thead><tbody>${rows}</tbody></table>
<p>Delta = portal2 minus app. Negative means portal2 was faster; positive means app was faster.
Incomplete results do not establish a winner. This is a local synthetic benchmark, not field Core Web Vitals.</p>
${report.includesTabSelection ? '<p>Readiness includes selection and visibility of the requested Syndicate tab.</p>' : ''}
${failures ? `<h2>Failures / blockers</h2><ul>${failures}</ul>` : ''}
<h2>Raw samples</h2><pre>${escapeHtml(JSON.stringify(report.samples, null, 2))}</pre>${embedded ? '' : '</html>'}`;
}
