export const SCENARIOS = [
  { id: 'enrich', name: 'Enrich', route: 'enrich', selector: '#main-container' },
  { id: 'dashboard', name: 'Dashboard', route: 'dashboard', selector: '#dashboard-app .dashboard__grid-wrapper' },
  { id: 'planner', name: 'Planner Dashboard', route: 'planner#dashboard', selector: '.planner-entity-content' },
  { id: 'planrelease', name: 'Plan and Release', route: 'planrelease', selector: '.planrelease-startpage' },
  {
    id: 'supplieronboarding', name: 'Supplier Onboarding Imports',
    route: 'supplieronboarding#imports', selector: '#start-main-imports-container',
  },
  { id: 'glossary', name: 'Glossary', route: 'glossary', selector: '#app', toolbar: true },
  {
    id: 'workflows', name: 'Workflows (No Workflows Yet)', route: 'workflows',
    selector: '.q-page-container', text: 'No Workflows yet',
  },
  {
    id: 'syndications', name: 'Syndicate - Syndications', route: 'syndication',
    selector: '#main-container .syndication-box', slot: '.js-syndications-slot',
    tab: 'ul.js-main-tabs .js-syndications-tab',
  },
  {
    id: 'syndication-configuration', name: 'Syndicate - Configuration', route: 'syndication',
    selector: '#main-container .syndication-box', slot: '.js-setup-configuration-slot',
    tab: 'ul.js-main-tabs .js-setup-configuration-tab',
  },
  {
    id: 'syndication-history', name: 'Syndicate - History', route: 'syndication',
    selector: '#main-container .syndication-box', slot: '.js-history-slot',
    tab: 'ul.js-main-tabs .js-history-tab',
  },
  { id: 'contentstore', name: 'Content Store', route: 'contentstore', selector: '#start-main-container' },
  {
    id: 'contentstore-settings', name: 'Content Store General Settings',
    route: 'contentstore#settings', selector: '.general-settings-box',
  },
];

export function selectScenarios(value = 'enrich') {
  if (value === 'all') return [...SCENARIOS];
  const ids = value.split(',');
  if (new Set(ids).size !== ids.length) throw new Error('--pages contains duplicate page IDs');
  return ids.map((id) => {
    const scenario = SCENARIOS.find(item => item.id === id);
    if (!scenario) throw new Error(`Unknown page ID: ${id}. Use --pages all or a documented page ID.`);
    return scenario;
  });
}

export function validateTargetUrl(value, origin, allowFragment = false) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || (!allowFragment && url.hash)) {
    throw new Error('Target URLs must use HTTPS without credentials or query parameters; only known page fragments are allowed');
  }
  if (origin && url.origin !== origin) throw new Error('Page target must use the configured site origin');
  return url.href;
}

export function buildPageTargets(scenarios, targets, environmentPath, legacyUrls = {}) {
  const appOrigin = new URL(targets.app).origin;
  const legacyOrigin = new URL(targets.portal2).origin;
  return scenarios.map((scenario) => {
    const legacy = legacyUrls[scenario.id] ?? (scenario.id === 'enrich' ? targets.portal2 : undefined);
    if (!legacy) {
      throw new Error(`Missing legacy URL for ${scenario.id}. Provide --targets-file with a URL for each selected page ID.`);
    }
    const fragment = new URL(legacy).hash;
    if (fragment && !/^#[a-zA-Z0-9/_-]+$/.test(fragment)) {
      throw new Error(`Legacy URL fragment for ${scenario.id} must be a plain route, without query parameters or tokens`);
    }
    return {
      ...scenario,
      targets: {
        app: scenario.id === 'enrich' ? targets.app
          : validateTargetUrl(`${appOrigin}${environmentPath}/app/${scenario.route}`, appOrigin, true),
        portal2: validateTargetUrl(legacy, legacyOrigin, true),
      },
    };
  });
}
