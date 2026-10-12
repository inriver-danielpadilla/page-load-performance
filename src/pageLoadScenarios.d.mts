export interface Scenario {
  id: string;
  name: string;
  route: string;
  [key: string]: unknown;
}

export const SCENARIOS: Scenario[];
export function selectScenarios(value?: string): Scenario[];
export function validateTargetUrl(value: string, origin: string, allowFragment?: boolean): string;
export function buildPageTargets(
  scenarios: Scenario[],
  targets: { app: string; portal2: string },
  environmentPath: string,
  legacyUrls?: Record<string, string>,
): Scenario[];
