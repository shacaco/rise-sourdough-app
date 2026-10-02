import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VALUES } from '../calc.js';
import {
  RECIPES_KEY, STATE_KEY, LEGACY_RECIPES_KEY, LEGACY_STATE_KEY,
  generateId, createRecipe, signature, isDirty, migrateV1,
  loadWorkingState, saveWorkingState, planMerge, createLocalStore
} from '../recipes.js';

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    map
  };
}

const idFactory = () => { let n = 0; return () => `id${++n}`; };

const v1Recipe = (over = {}) => ({
  'total-weight': '900', 'inclusions-weight': '0', 'single-loaf-weight': '900', 'number-of-loaves': '1',
  'inclusions-weight-single': '0', 'water-percent': '75', 'salt-percent': '2', 'levain-percent': '20',
  'levain-hydration-percent': '100', 'white-flour-percent': '90', 'calculation-mode-toggle': false, ...over
});

test('generateId is unique and well-formed', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(generateId());
  assert.equal(ids.size, 1000);
  assert.match(generateId(), /^[0-9a-f-]{36}$|^[0-9a-z]+-[0-9a-z]{10}$/);
});

test('createRecipe sanitises and stamps', () => {
  const r = createRecipe({ name: '  My loaf ', values: { ...DEFAULT_VALUES, saltPct: 'bad' }, mode: 'unit' }, 123, 'abc');
  assert.equal(r.id, 'abc');
  assert.equal(r.name, 'My loaf');
  assert.equal(r.values.saltPct, DEFAULT_VALUES.saltPct);
  assert.equal(r.mode, 'unit');
  assert.equal(r.createdAt, 123);
  assert.equal(r.updatedAt, 123);
  assert.equal(createRecipe({ name: 'x', values: DEFAULT_VALUES, mode: 'weird' }).mode, 'batch');
});

test('signature and isDirty compare numbers and mode only', () => {
  const rec = createRecipe({ name: 'a', values: DEFAULT_VALUES, mode: 'batch' });
  assert.equal(isDirty(rec, DEFAULT_VALUES, 'batch'), false);
  assert.equal(isDirty(rec, { ...DEFAULT_VALUES, waterPct: 71 }, 'batch'), true);
  assert.equal(isDirty(rec, DEFAULT_VALUES, 'unit'), true);
  assert.equal(isDirty(null, DEFAULT_VALUES, 'batch'), false);
  assert.equal(signature({ ...DEFAULT_VALUES, totalWeight: '750' }, 'batch'), signature(DEFAULT_VALUES, 'batch'));
});

test('migrateV1 converts the name-keyed map and resolves the active recipe', () => {
  const recipesRaw = JSON.stringify({
    Country: v1Recipe(),
    Rolls: v1Recipe({ 'number-of-loaves': '8', 'single-loaf-weight': '100', 'salt-percent': 'abc', 'calculation-mode-toggle': true })
  });
  const stateRaw = JSON.stringify({ ...v1Recipe({ 'water-percent': '80' }), activeRecipeName: 'Rolls' });
  const { library, state } = migrateV1({ recipesRaw, stateRaw }, { now: 500, newId: idFactory() });

  assert.equal(library.version, 2);
  const list = Object.values(library.recipes);
  assert.equal(list.length, 2);
  const country = list.find((r) => r.name === 'Country');
  const rolls = list.find((r) => r.name === 'Rolls');
  assert.equal(country.id, 'id1');
  assert.equal(country.mode, 'batch');
  assert.equal(country.values.whiteFlourPct, 90);
  assert.equal(country.createdAt, 500);
  assert.equal(country.updatedAt, 500);
  assert.equal(rolls.mode, 'unit');
  assert.equal(rolls.values.quantity, 8);
  assert.equal(rolls.values.saltPct, DEFAULT_VALUES.saltPct);
  assert.equal(rolls.values.totalWeight, 900);

  assert.equal(state.version, 2);
  assert.equal(state.values.waterPct, 80);
  assert.equal(state.activeRecipeId, rolls.id);
});

test('migrateV1 tolerates garbage', () => {
  assert.deepEqual(migrateV1({ recipesRaw: '{not json', stateRaw: null }), { library: { version: 2, recipes: {} }, state: null });
  assert.deepEqual(migrateV1({ recipesRaw: null, stateRaw: '[]' }).state, { version: 2, values: DEFAULT_VALUES, mode: 'batch', activeRecipeId: null });
  const { library } = migrateV1({ recipesRaw: JSON.stringify({ ok: v1Recipe(), bad: 7, '': v1Recipe() }), stateRaw: null }, { newId: idFactory() });
  assert.deepEqual(Object.values(library.recipes).map((r) => r.name).sort(), ['Untitled', 'ok']);
});

test('store migrates v1 on first load, writes v2, and leaves v1 in place', async () => {
  const storage = memStorage({
    [LEGACY_RECIPES_KEY]: JSON.stringify({ Country: v1Recipe() }),
    [LEGACY_STATE_KEY]: JSON.stringify({ ...v1Recipe(), activeRecipeName: 'Country' })
  });
  const store = createLocalStore({ storage, now: () => 42, newId: idFactory() });
  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Country');
  assert.ok(storage.map.has(RECIPES_KEY));
  assert.ok(storage.map.has(LEGACY_RECIPES_KEY));
  assert.equal(loadWorkingState(storage).activeRecipeId, 'id1');
});

test('store skips migration when v2 exists and writes v2 even when empty', async () => {
  const v2 = { version: 2, recipes: { z: { id: 'z', name: 'Zed', values: DEFAULT_VALUES, mode: 'batch', createdAt: 1, updatedAt: 1 } } };
  const storage = memStorage({ [RECIPES_KEY]: JSON.stringify(v2), [LEGACY_RECIPES_KEY]: JSON.stringify({ Ignored: v1Recipe() }) });
  const store = createLocalStore({ storage });
  assert.deepEqual((await store.list()).map((r) => r.name), ['Zed']);

  const empty = memStorage();
  createLocalStore({ storage: empty });
  assert.deepEqual(JSON.parse(empty.getItem(RECIPES_KEY)), { version: 2, recipes: {} });
});

test('store CRUD, sorting, tombstones, findByName and subscribe', async () => {
  const storage = memStorage();
  const store = createLocalStore({ storage, now: () => 1000 });
  const events = [];
  const unsubscribe = store.subscribe((list) => events.push(list.map((r) => r.name)));

  const b = createRecipe({ name: 'Bagels', values: DEFAULT_VALUES, mode: 'batch' }, 1, 'b');
  const a = createRecipe({ name: 'apple loaf', values: DEFAULT_VALUES, mode: 'batch' }, 2, 'a');
  await store.put(b);
  await store.put(a);
  assert.deepEqual((await store.list()).map((r) => r.id), ['a', 'b']);
  assert.equal((await store.get('a')).name, 'apple loaf');
  assert.equal((await store.findByName('  APPLE loaf ')).id, 'a');
  assert.equal(await store.findByName('nope'), null);
  assert.equal(await store.findByName(''), null);

  await store.remove('a');
  assert.equal(await store.get('a'), null);
  assert.deepEqual((await store.list()).map((r) => r.id), ['b']);
  const all = await store.all();
  const tomb = all.find((r) => r.id === 'a');
  assert.equal(tomb.deleted, true);
  assert.equal(tomb.updatedAt, 1000);
  await store.remove('missing');

  assert.deepEqual(events, [['Bagels'], ['apple loaf', 'Bagels'], ['Bagels']]);
  unsubscribe();
  await store.put(b);
  assert.equal(events.length, 3);

  // Persisted shape survives a reload through a fresh store.
  const again = createLocalStore({ storage, now: () => 1000 });
  assert.deepEqual((await again.list()).map((r) => r.id), ['b']);
  assert.equal((await again.all()).length, 2);
});

test('store drops tombstones older than 90 days on load', async () => {
  const old = 1000;
  const storage = memStorage({ [RECIPES_KEY]: JSON.stringify({ version: 2, recipes: {
    x: { id: 'x', name: 'X', values: DEFAULT_VALUES, mode: 'batch', createdAt: old, updatedAt: old, deleted: true }
  } }) });
  const store = createLocalStore({ storage, now: () => old + 91 * 24 * 3600 * 1000 });
  assert.equal((await store.all()).length, 0);
});

test('store keeps working in memory when storage throws', async () => {
  const storage = memStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const store = createLocalStore({ storage });
  await store.put(createRecipe({ name: 'Q', values: DEFAULT_VALUES, mode: 'batch' }, 1, 'q'));
  assert.equal(store.persistFailed, true);
  assert.equal((await store.list()).length, 1);
  assert.equal(saveWorkingState(storage, { values: DEFAULT_VALUES, mode: 'batch', activeRecipeId: null }), false);
});

test('working state round trip and validation', () => {
  const storage = memStorage();
  assert.equal(loadWorkingState(storage), null);
  assert.equal(saveWorkingState(storage, { values: { ...DEFAULT_VALUES, waterPct: 77 }, mode: 'unit', activeRecipeId: 'abc' }), true);
  assert.deepEqual(loadWorkingState(storage), { version: 2, values: { ...DEFAULT_VALUES, waterPct: 77 }, mode: 'unit', activeRecipeId: 'abc', scale: null });
  storage.setItem(STATE_KEY, JSON.stringify({ version: 1, values: {} }));
  assert.equal(loadWorkingState(storage), null);
  storage.setItem(STATE_KEY, JSON.stringify({ version: 2, values: { saltPct: 50 }, mode: 'x', activeRecipeId: 5 }));
  assert.deepEqual(loadWorkingState(storage), { version: 2, values: DEFAULT_VALUES, mode: 'batch', activeRecipeId: null, scale: null });
});

test('working state keeps the batch size of the current bake', () => {
  const storage = memStorage();
  const scale = { totalWeight: 1500, quantity: 6 };
  saveWorkingState(storage, { values: DEFAULT_VALUES, mode: 'unit', activeRecipeId: 'abc', scale });
  assert.deepEqual(loadWorkingState(storage).scale, scale);
  // A scale that no longer fits the rules is dropped, never repaired.
  saveWorkingState(storage, { values: DEFAULT_VALUES, mode: 'unit', activeRecipeId: 'abc', scale: { totalWeight: 1500, quantity: 0 } });
  assert.equal(loadWorkingState(storage).scale, null);
});

test('planMerge', () => {
  const rec = (id, updatedAt, extra = {}) => ({ id, name: id, values: DEFAULT_VALUES, mode: 'batch', createdAt: 1, updatedAt, ...extra });
  const local = [rec('localOnly', 5), rec('newerLocal', 9), rec('newerCloud', 2), rec('tie', 4), rec('deletedInCloud', 3)];
  const cloud = [rec('cloudOnly', 5), rec('newerLocal', 3), rec('newerCloud', 8), rec('tie', 4), rec('deletedInCloud', 7, { deleted: true })];
  const { toCloud, toLocal } = planMerge(local, cloud);
  assert.deepEqual(toCloud.map((r) => r.id).sort(), ['localOnly', 'newerLocal']);
  assert.deepEqual(toLocal.map((r) => r.id).sort(), ['cloudOnly', 'deletedInCloud', 'newerCloud']);
  assert.equal(toLocal.find((r) => r.id === 'deletedInCloud').deleted, true);

  // Same timestamp but different content: cloud wins.
  const diff = planMerge([rec('t', 4, { name: 'A' })], [rec('t', 4, { name: 'B' })]);
  assert.deepEqual(diff.toLocal.map((r) => r.name), ['B']);
  assert.deepEqual(diff.toCloud, []);
});
