import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLegacyUrls } from './create-legacy-page-urls.mjs';

test('creates a portal2 route for every benchmark page on the requested stack and region', () => {
  const urls = createLegacyUrls('test1a', 'euw');
  assert.equal(Object.keys(urls).length, 12);
  assert.equal(urls.enrich, 'https://portal2-test1a-euw.productmarketingcloud.com/app/enrich');
  assert.equal(urls.planner, 'https://portal2-test1a-euw.productmarketingcloud.com/app/planner#dashboard');
  assert.equal(urls['contentstore-settings'],
    'https://portal2-test1a-euw.productmarketingcloud.com/app/contentstore#settings');
});

test('rejects malformed stack and region components', () => {
  assert.throws(() => createLegacyUrls('', 'euw'), /stack/);
  assert.throws(() => createLegacyUrls('test1a', 'euw?token=secret'), /region/);
  assert.throws(() => createLegacyUrls('https://example.com', 'euw'), /stack/);
});
