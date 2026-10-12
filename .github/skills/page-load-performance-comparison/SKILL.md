---
name: page-load-performance-comparison
description: 'Run an authenticated Playwright load-performance comparison between the inriver New Tech Stack app and legacy portal2. Use when asked to compare or benchmark page-load performance, compare legacy pages, or run the PIM UI performance test.'
argument-hint: 'Compare all pages or a comma-separated set of page IDs'
user-invocable: true
---

# inriver page-load performance comparison

Run the repository benchmark at `src/pageLoadComparison.mjs` for
`https://app-<stack>-<region>.productmarketingcloud.com` versus
`https://portal2-<stack>-<region>.productmarketingcloud.com`.

## Collect run settings

Use `ask_user` to collect one answer per question, in this order:

1. Stack name, e.g. `test1a`.
2. Region, e.g. `euw`.
3. Customer safe name, e.g. `productmanagementconcepts`.
4. Environment safe name, e.g. `testuiux`.
5. Credential method: use credentials already stored in the repository-root
   `.env` (recommended), or sign in interactively in the browser.
6. Scope: all 12 legacy page views (default), Enrich only, or a comma-separated
   selection of page IDs from the table below.

Do not ask users to paste passwords, tokens, or authentication URLs into chat.
For automatic authentication, require the user to configure `TEST_USERNAME` and
`TEST_PASSWORD` in the repository-root `.env`; verify presence without printing
either value. The benchmark loads that exact `.env` and gives it precedence over
inherited shell variables. If credentials are unavailable or the user prefers
not to store them in `.env`, use interactive browser authentication instead.
Never echo credentials, embed them in command arguments, reports, or URL maps.

Validate stack, region, customer, and environment as URL-safe DNS/path components
before constructing the configuration `<stack>-<region>-<customer>-<environment>`.
The benchmark validates its configuration and target URLs before launching.

## Page IDs

| ID | Legacy page view |
| --- | --- |
| `enrich` | Enrich |
| `dashboard` | Dashboard |
| `planner` | Planner Dashboard |
| `planrelease` | Plan and Release |
| `supplieronboarding` | Supplier Onboarding Imports |
| `glossary` | Glossary |
| `workflows` | Workflows: No Workflows Yet |
| `syndications` | Syndicate: Syndications |
| `syndication-configuration` | Syndicate: Configuration |
| `syndication-history` | Syndicate: History |
| `contentstore` | Content Store |
| `contentstore-settings` | Content Store General Settings |

`all` selects every concrete page-object view currently declared in
`src/pageLoadScenarios.mjs`. The workflow view requires its page object's
empty state. If the environment contains workflows, report it as unavailable;
do not create or remove workflows to force a match. Syndicate tab timings include
opening the Syndicate page and activating the selected tab.

## Build the legacy URL map

Before an all-page or multi-page run, generate URLs for the requested stack and
region from the verified route map. Do not reuse a map from a different stack.
Run this from the repository root:

```powershell
node .github/skills/page-load-performance-comparison/scripts/create-legacy-page-urls.mjs <stack> <region> temp/page-load-performance/legacy-urls-<stack>-<region>.json
```

The generator uses the route IDs and paths declared by the repository and creates
only URLs on the matching portal2 origin. It does not contain credentials.
The benchmark will explicitly report unavailable routes, redirects to the older
`portal-` host, or HTTP errors. Do not override those results with guessed pages.

## Run the benchmark

For all views, use the configuration and map generated from the answers:

```powershell
pnpm run perf:compare -- --configuration <stack>-<region>-<customer>-<environment> --pages all --targets-file temp/page-load-performance/legacy-urls-<stack>-<region>.json --output temp/page-load-performance/<stack>-<region>-<customer>-<environment>
```

For Enrich only, omit `--targets-file` and use `--pages enrich`. For a selected subset, set `--pages id1,id2` and generate a URL map for that stack
and region.
Use `--manual-login` instead of `.env` credentials when requested. The benchmark
opens app then portal2; ask the user to sign in and select the requested
customer/environment when each browser opens. It navigates to Enrich after
environment selection, captures browser storage in memory, and closes the
authentication context. Do not ask the user to navigate to Enrich manually.

Run one site at a time for authentication; a failure on one site must not prevent
valid measurements on the other. Within each view the benchmark discards one
warm-up per site, then alternates ten fresh-context measured loads. It checkpoints
JSON and HTML report output during the run.

## Report and communicate results

Read `comparison.json` and `comparison.html` from the chosen output directory.
Report each page independently, including site status, valid/failed counts,
median, p95, raw samples and any unavailable-value reasons. Do not pool page
timings. Do not turn a missing measurement into zero, infer a missing value, or
claim a winner if either side is blocked or sample counts are incomplete.
Explain that the readiness metric is page-root visibility, not proof that all
content or controls have finished loading. `COMPLETE` requires every selected
page to have completed without failures; otherwise describe the result as
`INCOMPLETE` and summarize blockers.

Run the targeted validation before changing the benchmark:

```powershell
pnpm run perf:test
pnpm run typecheck
```
