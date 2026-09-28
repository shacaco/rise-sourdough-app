import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VALUES, calculate, displayRows, round1, formatGrams, formatPct } from '../calc.js';

const close = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected} ± ${tol}, got ${actual}`);

test('defaults reproduce the original app numbers', () => {
  const r = calculate(DEFAULT_VALUES);
  close(r.doughWeight, 750);
  close(r.totalFlour, 436.05);
  close(r.totalWater, 305.23);
  close(r.salt, 8.72);
  close(r.levain, 87.21);
  close(r.levainFlour, 43.60);
  close(r.levainWater, 43.60);
  close(r.mainFlour, 392.44);
  close(r.mainWater, 261.63);
  close(r.whiteFlour, 392.44);
  close(r.otherFlours, 0);
  close(r.inclusions, 0);
  close(r.hydration, 70.0);
  close(r.prefermentedFlourPct, 10.0);
  assert.equal(r.otherFlourPct, 0);
  assert.equal(r.quantity, 1);
});

test('inclusions are removed before the baker percentages apply', () => {
  const r = calculate({ ...DEFAULT_VALUES, inclusions: 100 });
  close(r.doughWeight, 650);
  close(r.totalFlour, 377.91);
  close(r.inclusions, 100);
});

test('white flour percentage splits the main flour', () => {
  const r = calculate({ ...DEFAULT_VALUES, whiteFlourPct: 80 });
  close(r.whiteFlour, r.mainFlour * 0.8);
  close(r.otherFlours, r.mainFlour * 0.2);
  assert.equal(r.otherFlourPct, 20);
});

test('levain hydration changes the flour/water split and prefermented flour', () => {
  const r = calculate({ ...DEFAULT_VALUES, levainHydrationPct: 50 });
  close(r.levainFlour, 87.21 / 1.5);
  close(r.levainWater, r.levain - r.levainFlour);
  close(r.prefermentedFlourPct, 13.33);
});

test('perUnit divides every weight by quantity', () => {
  const r = calculate({ ...DEFAULT_VALUES, quantity: 3 });
  for (const key of ['doughWeight', 'totalFlour', 'mainFlour', 'mainWater', 'salt', 'levain', 'inclusions']) {
    close(r.perUnit[key], r[key] / 3, 1e-9);
  }
  assert.equal(r.quantity, 3);
});

test('hydration is computed from the weights, not copied from the input', () => {
  const r = calculate({ ...DEFAULT_VALUES, waterPct: 82.5 });
  close(r.hydration, 82.5, 1e-9);
});

test('throws when inclusions reach the total or a value is not finite', () => {
  assert.throws(() => calculate({ ...DEFAULT_VALUES, totalWeight: 100, inclusions: 100 }), RangeError);
  assert.throws(() => calculate({ ...DEFAULT_VALUES, totalWeight: 100, inclusions: 150 }), RangeError);
  assert.throws(() => calculate({ ...DEFAULT_VALUES, saltPct: NaN }), RangeError);
  assert.throws(() => calculate({ ...DEFAULT_VALUES, waterPct: Infinity }), RangeError);
  assert.throws(() => calculate({ ...DEFAULT_VALUES, levainPct: '20' }), RangeError);
});

test('round1 rounds half-up and absorbs float noise', () => {
  assert.equal(round1(333.3333), 333.3);
  assert.equal(round1(333.35), 333.4);
  assert.equal(round1(999.9000000000001), 999.9);
  assert.equal(round1(187.5), 187.5);
  assert.equal(round1(0.05), 0.1);
  assert.equal(round1(1000), 1000);
});

test('displayRows reconciles every displayed part with its total', () => {
  const cases = [
    DEFAULT_VALUES,
    { ...DEFAULT_VALUES, totalWeight: 900, waterPct: 80, whiteFlourPct: 90 },
    { ...DEFAULT_VALUES, totalWeight: 1234, inclusions: 77, waterPct: 66.6, saltPct: 2.2, levainPct: 33.3, levainHydrationPct: 80, whiteFlourPct: 33.3 }
  ];
  for (let i = 0; i < 200; i++) {
    cases.push({
      totalWeight: 50 + Math.floor(Math.random() * 5000),
      inclusions: Math.floor(Math.random() * 40),
      quantity: 1,
      waterPct: 50 + Math.random() * 70,
      saltPct: 1 + Math.random() * 2,
      levainPct: 5 + Math.random() * 45,
      levainHydrationPct: 50 + Math.random() * 150,
      whiteFlourPct: Math.random() * 100
    });
  }
  for (const values of cases) {
    const r = calculate(values);
    const d = displayRows(r);
    assert.equal(d.levainFlour + d.levainWater, d.levain);
    assert.equal(d.whiteFlour + d.otherFlours, d.mainFlour);
    assert.equal(d.mainFlour + d.levainFlour, d.totalFlour);
    const listed = d.mainFlour + d.mainWater + d.salt + d.levain + d.inclusions;
    assert.ok(Math.abs(listed - values.totalWeight) <= 0.55, `list sums to ${listed} for ${values.totalWeight}`);
    for (const key of Object.keys(d)) {
      if (key === 'salt') continue;
      assert.ok(Number.isInteger(d[key]), `${key} should be an integer`);
    }
  }
  // Worked example: levain 87.21 splits 43.6 / 43.6; parts must show as 44 + 43, never 44 + 44.
  const d = displayRows(calculate(DEFAULT_VALUES));
  assert.deepEqual([d.levain, d.levainFlour, d.levainWater], [87, 44, 43]);
  assert.deepEqual([d.totalFlour, d.mainFlour, d.mainWater], [436, 392, 262]);
});

test('formatters', () => {
  assert.equal(formatGrams(392.44), '392 g');
  assert.equal(formatGrams(8.72, 1), '8.7 g');
  assert.equal(formatPct(70), '70.0 %');
});
