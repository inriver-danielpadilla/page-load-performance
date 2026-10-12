import * as path from 'path';

const namePart = /^[a-z0-9]+$/i;

function readConfiguration() {
  const configurationName = process.env.TEST_CONFIGURATION_NAME ?? '';
  const parts = configurationName.split('-');
  if (parts.length !== 4 || parts.some(part => !namePart.test(part))) {
    throw new Error('TEST_CONFIGURATION_NAME must be <stack>-<region>-<customer>-<environment> (letters and numbers only per part)');
  }
  const [stack, region, customerSafename, environmentSafename] = parts;
  return { configurationName, stack, region, customerSafename, environmentSafename };
}

export const { configurationName, stack, region, customerSafename, environmentSafename } = readConfiguration();
export const appUrl = `https://app-${stack}-${region}.productmarketingcloud.com/`;
export const portal2Url = process.env.TEST_PORTAL2_URL || `https://portal2-${stack}-${region}.productmarketingcloud.com/`;
export const environmentPath = `/env/${customerSafename}/${environmentSafename}`;
export const appEnrichUrl = new URL(`${environmentPath}/app/enrich`, appUrl).href;
export const portal2EnrichUrl = new URL('/app/enrich', portal2Url).href;

export const storageStateDir = path.resolve(__dirname, '../storageStates');
export const storageStatePath = (site: 'app' | 'portal2') => path.join(storageStateDir, `${configurationName}.${site}.json`);

export const perfSettings = {
  runs: Number(process.env.PERF_RUNS ?? 10),
  pages: process.env.PERF_PAGES || 'all',
  timeout: Number(process.env.PERF_TIMEOUT ?? 60_000),
  outputDir: path.resolve(process.env.PERF_OUTPUT_DIR || 'perf-results'),
};
