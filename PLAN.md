# Plan: PIM page-load performance report

## Goal

Produce a per-page load-time comparison of `app-{stack}-{region}` (New Tech Stack) versus
`portal2-{stack}-{region}` (legacy). It must run locally and in Azure Pipelines, using `.env` for the
customer/environment names and the credentials.

## Design

| Area | Decision |
| --- | --- |
| Project | Standalone Playwright + TypeScript project in this folder (moved out of `inriver-pim-autotest`) |
| Config | `src/config.ts` parses `TEST_CONFIGURATION_NAME` = `stack-region-customer-environment` and derives both URLs |
| Login | `tests/login.setup.ts` signs in to app and portal2 and stores the storage states in `storageStates/` |
| Benchmark | `src/pageLoadComparison.mjs` runs a warm-up plus N measured, alternating, fresh-context loads per page and site |
| Metrics | `src/pageLoadMetrics.mjs` computes the median, p95 and raw samples; it never infers missing values |
| Scenarios | `src/pageLoadScenarios.mjs` defines the 12 legacy page views and their readiness selectors |
| Test | `tests/pageLoad.perf.ts` (project `perf`, depends on `login`) writes the HTML/JSON report and attaches it |
| CI | `azure-pipelines/page-load-performance.yml`: nightly or manual run, variable group `pim-autotest-perf` |

## Status

- [x] Benchmark, metrics and scenarios, with unit tests (`pnpm run perf:test`)
- [x] Playwright login for app and portal2 from `.env`
- [x] Perf project and HTML/JSON report
- [x] Azure Pipelines YAML
- [x] Copilot skill
- [x] Smoke run (Enrich, 1 run): app 14.2 s vs portal2 2.7 s
- [ ] Push to an Azure DevOps repository and create the pipeline and variable group
