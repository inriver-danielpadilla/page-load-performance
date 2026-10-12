import type { Browser, Page } from '@playwright/test';
import type { Scenario } from './pageLoadScenarios.mjs';

export type Site = 'app' | 'portal2';
export type StorageState = Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;

export interface Settings {
  timeout: number;
  runs: number;
  [key: string]: unknown;
}

export interface Summary {
  median: number;
  [key: string]: unknown;
}

export interface ComparisonRow {
  key: string;
  label: string;
  app: Summary | null;
  portal2: Summary | null;
  deltaMs: number | null;
  deltaPercent: number | null;
}

export interface PageReport {
  id: string;
  name: string;
  status: string;
  samples: object[];
  failures: string[];
  comparison: ComparisonRow[];
  [key: string]: unknown;
}

export type Measure = (
  browser: Browser,
  site: Site,
  url: string,
  storageState: StorageState,
  settings: Settings,
  scenario?: Scenario,
) => Promise<object>;

export function openManualEnrich(page: Page, site: Site, url: string, environmentPath: string, timeout: number): Promise<void>;
export function waitForPage(page: Page, site: Site, scenario: Scenario, timeout: number, activateTab?: boolean): Promise<void>;
export function selectLegacyEnvironment(page: Page, customerSafename: string, environmentSafename: string, timeout: number): Promise<void>;
export function authenticate(
  browser: Browser,
  site: Site,
  url: string,
  settings: { timeout: number; manualLogin?: boolean },
  environmentPath: string,
): Promise<StorageState>;
export const measure: Measure;
export function runPageComparison(
  browser: Browser,
  scenario: Scenario,
  states: Record<Site, StorageState>,
  settings: Settings,
  metadata: object,
  measurePage?: Measure,
  onProgress?: (progress: PageReport) => Promise<void> | void,
): Promise<PageReport>;
export function saveReport(report: object, output: string): Promise<void>;
