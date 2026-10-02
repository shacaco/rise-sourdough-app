import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VALUES, calculate } from '../calc.js';
import { projectToUnit, applyEdit, counterpartFields, draftFromValues, scaleValues, scaleFromUnits } from '../sync.js';

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

test('scaleValues resizes the batch and leaves the recipe alone', () => {
  const recipe = Object.freeze(v({ totalWeight: 1000, inclusions: 60, quantity: 4, waterPct: 75 }));
  assert.equal(scaleValues(recipe, null), recipe);

  const scaled = scaleValues(recipe, { totalWeight: 1500, quantity: 6 });
  assert.deepEqual(scaled, { ...recipe, totalWeight: 1500, quantity: 6, inclusions: 90 });
  assert.deepEqual(recipe, v({ totalWeight: 1000, inclusions: 60, quantity: 4, waterPct: 75 }));
  assert.deepEqual(projectToUnit(scaled), { unitWeight: 250, unitInclusions: 15 });

  // Inclusions keep their share and are rounded to one decimal.
  assert.equal(scaleValues(v({ totalWeight: 750, inclusions: 33.3 }), { totalWeight: 1000, quantity: 1 }).inclusions, 44.4);
});

test('scaled inclusions always stay below the batch weight', () => {
  const nearlyAllInclusions = v({ totalWeight: 750, inclusions: 749.9 });
  const scaled = scaleValues(nearlyAllInclusions, { totalWeight: 100, quantity: 1 });
  assert.equal(scaled.inclusions, 99.9);
  assert.doesNotThrow(() => calculate(scaled));
});

test('scaleFromUnits does not drift when only the quantity changes', () => {
  const shown = v({ totalWeight: 1000, inclusions: 0, quantity: 3 });
  // 333.3 is the projection on screen; doubling the units must give 2000, not 1999.8.
  assert.deepEqual(scaleFromUnits(shown, 6, 333.3), { totalWeight: 2000, quantity: 6 });
  // A typed unit weight is taken at face value.
  assert.deepEqual(scaleFromUnits(shown, 6, 300), { totalWeight: 1800, quantity: 6 });
  assert.deepEqual(scaleFromUnits(shown, 3, 280.5), { totalWeight: 841.5, quantity: 3 });
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
