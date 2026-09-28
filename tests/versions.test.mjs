import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

test('service worker VERSION matches the page data-app-version', () => {
  const sw = read('service-worker.js');
  const html = read('index.html');
  const swVersion = /const VERSION = '([^']+)'/.exec(sw)?.[1];
  const htmlVersion = /data-app-version="([^"]+)"/.exec(html)?.[1];
  assert.ok(swVersion, 'VERSION not found in service-worker.js');
  assert.ok(htmlVersion, 'data-app-version not found in index.html');
  assert.equal(swVersion, htmlVersion);
});

test('every precached file exists on disk', () => {
  const sw = read('service-worker.js');
  const block = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)?.[1];
  assert.ok(block, 'PRECACHE list not found');
  const entries = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(entries.length > 5);
  for (const entry of entries) {
    const rel = entry === './' ? 'index.html' : entry.replace(/^\.\//, '');
    assert.ok(existsSync(join(root, rel)), `missing precache entry: ${entry}`);
  }
});

test('page references only files that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const ref of refs) {
    assert.ok(existsSync(join(root, ref)), `missing file referenced by index.html: ${ref}`);
  }
});

test('firebase SDK version is consistent when cloud.js exists', () => {
  const cloudPath = join(root, 'cloud.js');
  if (!existsSync(cloudPath)) return;
  const sw = read('service-worker.js');
  const cloud = read('cloud.js');
  const swSdk = /const SDK_VERSION = '([^']+)'/.exec(sw)?.[1];
  const cloudSdk = /FIREBASE_SDK_VERSION = '([^']+)'/.exec(cloud)?.[1];
  assert.equal(swSdk, cloudSdk);
});
