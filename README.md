# Page load performance: app vs portal2

Compares page-load times of legacy PIM pages, page by page:

- **app** – `https://app-{stack}-{region}.productmarketingcloud.com` (New Tech Stack, legacy page in an iframe)
- **portal2** – `https://portal2-{stack}-{region}.productmarketingcloud.com` (legacy portal)

Both sites are signed in with Playwright using the credentials from `.env`. Every page gets one discarded
warm-up load per site, followed by `PERF_RUNS` measured loads that alternate between sites in fresh browser
contexts. The readiness metric is the visibility of the page root, not full content completion.

## Setup

```powershell
pnpm install
pnpm exec playwright install chromium
Copy-Item .env.example .env   # then fill in the values
```

`.env` (git-ignored, takes precedence over shell variables):

| Variable | Required | Description |
| --- | --- | --- |
| `TEST_CONFIGURATION_NAME` | yes | `<stack>-<region>-<customer>-<environment>`, e.g. `dev1a-euw-autotestuideveuw-autotestuiodl` |
| `TEST_USERNAME` / `TEST_PASSWORD` | yes | Test user that can access the customer/environment |
| `TEST_PORTAL2_URL` | no | Overrides the derived portal2 origin |

### Alternative env file (`.env.test`)

Set `ENV_FILE` to load a different file from the project root instead of `.env`. Shortcut scripts use `.env.test`
(also git-ignored):

```powershell
Copy-Item .env.example .env.test   # fill in values for the other customer/environment
pnpm run perf:env-test               # Playwright run using .env.test
pnpm run perf:compare:env-test -- --pages enrich --output temp/env-test
```

## Run locally

```powershell
pnpm run perf                                        # login (app + portal2), then all pages, 10 runs each
$env:PERF_RUNS="3"; $env:PERF_PAGES="enrich,dashboard"; pnpm run perf
```

| Variable | Default | Description |
| --- | --- | --- |
| `PERF_RUNS` | `10` | Measured loads per page and site |
| `PERF_PAGES` | `all` | `all` or comma-separated page IDs |
| `PERF_TIMEOUT` | `60000` | Timeout per load, ms |
| `PERF_OUTPUT_DIR` | `perf-results` | Report output directory |

Page IDs: `enrich`, `dashboard`, `planner`, `planrelease`, `supplieronboarding`, `glossary`, `workflows`,
`syndications`, `syndication-configuration`, `syndication-history`, `contentstore`, `contentstore-settings`.

Results:

- `perf-results/comparison.html` and `comparison.json` show the median, p95, raw samples and failures per page
  and site. The status is `COMPLETE` only when every page finished without failures.
- `playwright-report/` holds the HTML report, with the comparison attached.
- `test-results/results.xml` holds the JUnit results.

### Standalone CLI

The benchmark can also run without the Playwright test runner, e.g. with manual login:

```powershell
pnpm run perf:compare -- --configuration <stack>-<region>-<customer>-<environment> --pages enrich --output temp/run1
pnpm run perf:compare -- --configuration <...> --pages enrich --manual-login
```

The Copilot skill in `.github/skills/page-load-performance-comparison` walks through this interactively.

## Azure Pipelines

`azure-pipelines/page-load-performance.yml` runs nightly at 02:00 on `main`, or manually with the parameters
`configurationName`, `runs` and `pages`.

1. Push this folder to an Azure DevOps git repository.
2. Create the variable group `pim-autotest-perf` with `TEST_USERNAME` and `TEST_PASSWORD` (secret).
3. Create a pipeline from the existing YAML file and authorize the variable group.

The pipeline writes `.env` from the parameters and secrets, then runs `pnpm run perf`. It publishes the JUnit
results and the `perf-results` and `playwright-report` artifacts.

## Development

```powershell
pnpm run typecheck
pnpm run perf:test   # unit tests for metrics, comparison and URL-map generation
```
