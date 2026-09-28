import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VALUES } from '../calc.js';
import { projectToUnit, applyEdit, counterpartFields, draftFromValues } from '../sync.js';

const v = (overrides) => ({ ...DEFAULT_VALUES, ...overrides });

test('projection shows one decimal', () => {
  assert.deepEqual(projectToUnit(v({ totalWeight: 1000, inclusions: 0, quantity: 3 })), { unitWeight: 333.3, unitInclusions: 0 });
  assert.deepEqual(projectToUnit(v({ totalWeight: 750, inclusions: 0, quantity: 4 })), { unitWeight: 187.5, unitInclusions: 0 });
  assert.deepEqual(projectToUnit(v({ totalWeight: 900, inclusions: 80, quantity: 2 })), { unitWeight: 450, unitInclusions: 40 });
});

test('B10 regression: editing per-unit inclusions never rewrites the total', () => {
  const start = v({ totalWeight: 1000, inclusions: 0, quantity: 3 });
  const next = applyEdit(start, 'unitInclusions', 20);
  assert.equal(next.totalWeight, 1000);
  assert.equal(next.inclusions, 60);
  assert.equal(next.quantity, 3);
});

test('editing unit weight rewrites only the total', () => {
  const start = v({ totalWeight: 1000, inclusions: 60, quantity: 3 });
  const next = applyEdit(start, 'unitWeight', 340);
  assert.equal(next.totalWeight, 1020);
  assert.equal(next.inclusions, 60);
  assert.deepEqual(projectToUnit(next), { unitWeight: 340, unitInclusions: 20 });
});

test('quantity edits keep unit weight fixed and scale the batch', () => {
  const start = v({ totalWeight: 1000, inclusions: 60, quantity: 3 });
  const next = applyEdit(start, 'quantity', 4);
  assert.equal(next.totalWeight, 1333.3);
  assert.equal(next.inclusions, 80);
  assert.equal(next.quantity, 4);
  assert.deepEqual(projectToUnit(next), { unitWeight: 333.3, unitInclusions: 20 });

  const exact = applyEdit(v({ totalWeight: 1050, inclusions: 0, quantity: 3 }), 'quantity', 4);
  assert.equal(exact.totalWeight, 1400);
});

test('float noise in write-backs is rounded away', () => {
  const next = applyEdit(v({ totalWeight: 1000, inclusions: 0, quantity: 3 }), 'unitWeight', 333.3);
  assert.equal(next.totalWeight, 999.9);
});

test('batch and percentage edits touch only their own field', () => {
  const start = v({ totalWeight: 1000, inclusions: 60, quantity: 3 });
  assert.equal(applyEdit(start, 'totalWeight', 800).totalWeight, 800);
  assert.equal(applyEdit(start, 'totalWeight', 800).inclusions, 60);
  assert.equal(applyEdit(start, 'inclusions', 10).totalWeight, 1000);
  assert.equal(applyEdit(start, 'waterPct', 75).waterPct, 75);
  assert.deepEqual(applyEdit(start, 'notAField', 1), start);
});

test('applyEdit never mutates its input', () => {
  const start = Object.freeze(v({ totalWeight: 1000, inclusions: 0, quantity: 3 }));
  const copy = { ...start };
  applyEdit(start, 'unitWeight', 500);
  applyEdit(start, 'quantity', 9);
  applyEdit(start, 'saltPct', 3);
  assert.deepEqual(start, copy);
});

test('counterpart mapping', () => {
  assert.deepEqual(counterpartFields('totalWeight'), ['unitWeight', 'unitInclusions']);
  assert.deepEqual(counterpartFields('inclusions'), ['unitWeight', 'unitInclusions']);
  assert.deepEqual(counterpartFields('unitWeight'), ['totalWeight', 'inclusions']);
  assert.deepEqual(counterpartFields('unitInclusions'), ['totalWeight', 'inclusions']);
  assert.deepEqual(counterpartFields('quantity'), ['totalWeight', 'inclusions', 'unitWeight', 'unitInclusions']);
  assert.deepEqual(counterpartFields('waterPct'), []);
});

test('draftFromValues yields strings for every field including projections', () => {
  const d = draftFromValues(v({ totalWeight: 1000, inclusions: 30, quantity: 3 }));
  assert.equal(d.totalWeight, '1000');
  assert.equal(d.inclusions, '30');
  assert.equal(d.quantity, '3');
  assert.equal(d.unitWeight, '333.3');
  assert.equal(d.unitInclusions, '10');
  assert.equal(d.waterPct, '70');
  assert.equal(Object.keys(d).length, 10);
});
