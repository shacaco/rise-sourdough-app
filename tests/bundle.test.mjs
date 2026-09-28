import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VALUES } from '../calc.js';
import { encodeBundle, decodeBundle, buildBundleUrl, parseBundleHash, MAX_BUNDLE } from '../share.js';
import { fromDoc, toDoc } from '../cloud.js';

const rec = (id, over = {}) => ({
  id,
  name: `Recipe ${id}`,
  values: { ...DEFAULT_VALUES, totalWeight: 800 + id.length },
  mode: 'batch',
  createdAt: 100,
  updatedAt: 200,
  ...over
});

test('bundle round trip keeps ids, timestamps, values and mode; tombstones are dropped', () => {
  const records = [rec('a1'), rec('b2', { mode: 'unit', values: { ...DEFAULT_VALUES, quantity: 4 } }), rec('gone', { deleted: true })];
  const out = decodeBundle(encodeBundle(records));
  assert.equal(out.ok, true);
  assert.deepEqual(out.recipes.map((r) => r.id), ['a1', 'b2']);
  assert.deepEqual(out.recipes[0], { id: 'a1', name: 'Recipe a1', values: records[0].values, mode: 'batch', createdAt: 100, updatedAt: 200 });
  assert.equal(out.recipes[1].mode, 'unit');
  assert.equal(out.recipes[1].values.quantity, 4);
});

test('bundle skips invalid entries and rejects empty or broken payloads', () => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const good = JSON.parse(Buffer.from(encodeBundle([rec('ok')]), 'base64url').toString());
  const bad = { ...good.r[0], w: 999, id: 'bad' };
  const noId = { ...good.r[0], id: 'not valid!' };
  const out = decodeBundle(b64({ v: 1, r: [good.r[0], bad, noId, 'junk'] }));
  assert.equal(out.ok, true);
  assert.deepEqual(out.recipes.map((r) => r.id), ['ok']);

  assert.equal(decodeBundle(b64({ v: 1, r: [] })).reason, 'empty');
  assert.equal(decodeBundle(b64({ v: 1, r: [bad] })).reason, 'empty');
  assert.equal(decodeBundle(b64({ v: 2, r: [] })).reason, 'version');
  assert.equal(decodeBundle(b64({ v: 1 })).reason, 'malformed');
  assert.equal(decodeBundle(b64([1, 2])).reason, 'malformed');
  assert.equal(decodeBundle('x'.repeat(MAX_BUNDLE + 1)).reason, 'too-long');
});

test('bundle url and hash parsing', () => {
  const url = buildBundleUrl('https://new.test/', [rec('z9')]);
  assert.match(url, /^https:\/\/new\.test\/#b=[A-Za-z0-9_-]+$/);
  const parsed = parseBundleHash(url.slice(url.indexOf('#')));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.recipes[0].id, 'z9');
  assert.equal(parseBundleHash('#r=abc'), null);
  assert.equal(parseBundleHash(''), null);
  assert.equal(parseBundleHash('#b=!!'), null);
  assert.equal(parseBundleHash('#b=abc').ok, false);
});

test('fifty recipes fit comfortably in a bundle link', () => {
  const many = Array.from({ length: 50 }, (_, i) => rec(`id-${i}-${'x'.repeat(20)}`, { name: 'A fairly long recipe name for testing' }));
  const payload = encodeBundle(many);
  assert.ok(payload.length < MAX_BUNDLE, `payload is ${payload.length}`);
  assert.equal(decodeBundle(payload).recipes.length, 50);
});

test('Firestore document conversion is lossless and tolerant', () => {
  const record = rec('doc1');
  assert.deepEqual(fromDoc('doc1', toDoc(record)), record);
  const tomb = rec('doc2', { deleted: true });
  assert.equal(toDoc(tomb).deleted, true);
  assert.equal(fromDoc('doc2', toDoc(tomb)).deleted, true);
  assert.equal(Object.keys(toDoc(record)).length, 5);
  assert.equal(Object.keys(toDoc(record).values).length, 8);
  const odd = fromDoc('x', { name: 42, values: { saltPct: 'bad' }, mode: 'weird', createdAt: 'no', updatedAt: null });
  assert.equal(odd.name, 'Untitled');
  assert.equal(odd.values.saltPct, DEFAULT_VALUES.saltPct);
  assert.equal(odd.mode, 'batch');
  assert.equal(odd.createdAt, 0);
  assert.equal(fromDoc('y', null), null);
});
