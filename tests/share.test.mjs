import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VALUES, calculate } from '../calc.js';
import { encodeRecipe, decodeRecipe, buildShareUrl, parseShareHash, formatRecipeText, MAX_PAYLOAD } from '../share.js';

const recipe = (over = {}) => ({
  name: 'Country loaf',
  values: { ...DEFAULT_VALUES, totalWeight: 1000.5, inclusions: 33.3, quantity: 3, waterPct: 78.5 },
  mode: 'unit',
  ...over
});

test('round trip preserves every field, unit mode and unicode names', () => {
  const r = recipe({ name: 'Pão de 🥖 & "quotes"' });
  const out = decodeRecipe(encodeRecipe(r));
  assert.equal(out.ok, true);
  assert.deepEqual(out.recipe, r);

  const batch = recipe({ mode: 'batch' });
  assert.equal(decodeRecipe(encodeRecipe(batch)).recipe.mode, 'batch');
});

test('payload is base64url and short', () => {
  const p = encodeRecipe(recipe({ name: 'x'.repeat(60) }));
  assert.match(p, /^[A-Za-z0-9_-]+$/);
  assert.ok(p.length < 400);
  assert.ok(p.length <= MAX_PAYLOAD);
});

test('rejections', () => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  assert.equal(decodeRecipe('').reason, 'malformed');
  assert.equal(decodeRecipe('!!!').reason, 'malformed');
  assert.equal(decodeRecipe('x'.repeat(MAX_PAYLOAD + 1)).reason, 'too-long');
  assert.equal(decodeRecipe(b64('not an object')).reason, 'malformed');
  assert.equal(decodeRecipe(b64({ v: 1 })).reason, 'malformed');
  assert.equal(decodeRecipe(b64({ v: 2 })).reason, 'version');

  const good = JSON.parse(Buffer.from(encodeRecipe(recipe()), 'base64url').toString());
  assert.equal(decodeRecipe(b64({ ...good, w: 300 })).reason, 'out-of-range');
  assert.equal(decodeRecipe(b64({ ...good, q: 2.5 })).reason, 'out-of-range');
  assert.equal(decodeRecipe(b64({ ...good, i: 2000 })).reason, 'out-of-range');
  assert.equal(decodeRecipe(b64({ ...good, s: 'abc' })).reason, 'malformed');
  assert.equal(decodeRecipe(b64({ ...good, t: null })).reason, 'malformed');
  assert.equal(decodeRecipe(b64({ ...good, n: 7 })).recipe.name, 'Shared recipe');
  assert.equal(decodeRecipe(b64({ ...good, n: 'a\u0000b'.padEnd(80, 'z') })).recipe.name.length, 60);
});

test('buildShareUrl and parseShareHash', () => {
  const url = buildShareUrl('https://example.test/app/', recipe());
  assert.match(url, /^https:\/\/example\.test\/app\/#r=[A-Za-z0-9_-]+$/);
  const hash = url.slice(url.indexOf('#'));
  assert.equal(parseShareHash(hash).ok, true);
  assert.equal(parseShareHash(hash.slice(1)).ok, true);
  assert.equal(parseShareHash('#x=1'), null);
  assert.equal(parseShareHash(''), null);
  assert.equal(parseShareHash('#r='), null);
  assert.equal(parseShareHash('#r=abc def'), null);
  assert.equal(parseShareHash(undefined), null);
  assert.equal(parseShareHash('#r=!!!'), null);
});

test('formatRecipeText', () => {
  const r = recipe({ values: { ...DEFAULT_VALUES, quantity: 2, totalWeight: 1000 } });
  const text = formatRecipeText(r, calculate(r.values), 'https://x.test/#r=abc');
  const lines = text.split('\n');
  assert.equal(lines[0], 'Country loaf');
  assert.match(lines[1], /^Total flour 581 g · Hydration 70\.0 % · Prefermented flour 10\.0 %$/);
  assert.equal(lines[2], 'Makes 2 × 500 g');
  assert.ok(text.includes('Flour: 523 g'));
  assert.ok(text.includes('Salt: 11.6 g'));
  assert.ok(text.includes('Levain build'));
  assert.ok(text.endsWith('https://x.test/#r=abc'));
  const batchText = formatRecipeText({ ...r, mode: 'batch' }, calculate(r.values));
  assert.ok(!batchText.includes('Makes'));
  assert.ok(!batchText.includes('https://'));
});
