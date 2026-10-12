import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from '../../../../src/pageLoadScenarios.mjs';

export function createLegacyUrls(stack, region) {
  for (const [label, value] of [['stack', stack], ['region', region]]) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value ?? '')) {
      throw new Error(`${label} must contain only letters, numbers, and hyphen-separated components`);
    }
  }
  const origin = `https://portal2-${stack}-${region}.productmarketingcloud.com`;
  return Object.fromEntries(SCENARIOS.map(scenario => [
    scenario.id,
    `${origin}/app/${scenario.route}`,
  ]));
}

async function main() {
  const [, , stack, region, output] = process.argv;
  if (!stack || !region || !output) {
    throw new Error('Usage: node create-legacy-page-urls.mjs <stack> <region> <output.json>');
  }
  const urls = createLegacyUrls(stack, region);
  const outputPath = path.resolve(output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(urls, null, 2)}\n`);
  console.log(`Created ${Object.keys(urls).length} legacy page URLs at ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
