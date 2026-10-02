import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VALUES } from '../calc.js';
import {
  RULES, FIELDS_FOR_MODE, PCT_FIELDS, parseNumber, validateField, validate,
  crossFieldOk, sanitizeValues, sanitizeScale, cleanName, NAME_MAX
} from '../validation.js';

const validDraft = () => ({
  totalWeight: '750', inclusions: '0', unitWeight: '750', quantity: '1', unitInclusions: '0',
  waterPct: '70', saltPct: '2', levainPct: '20', levainHydrationPct: '100', whiteFlourPct: '100'
});

test('parseNumber accepts plain decimals with dot or comma and rejects the rest', () => {
  assert.equal(parseNumber('750'), 750);
  assert.equal(parseNumber(' 7.5 '), 7.5);
  assert.equal(parseNumber('7,5'), 7.5);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber(12), 12);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('1e3'), null);
  assert.equal(parseNumber('1.2.3'), null);
  assert.equal(parseNumber(NaN), null);
  assert.equal(parseNumber(null), null);
});

test('every rule rejects just outside its bounds and accepts the bounds', () => {
  for (const [field, rule] of Object.entries(RULES)) {
    const step = rule.integer ? 1 : 0.001;
    assert.equal(validateField(field, String(rule.min))?.code, undefined, `${field} min`);
    assert.equal(validateField(field, String(rule.max))?.code, undefined, `${field} max`);
    assert.equal(validateField(field, String(rule.min - step)).code, 'range', `${field} below`);
    assert.equal(validateField(field, String(rule.max + step)).code, 'range', `${field} above`);
    assert.match(validateField(field, String(rule.max + step)).message, /^Use /);
  }
});

test('empty, non-numeric and non-integer inputs', () => {
  assert.equal(validateField('totalWeight', '').code, 'empty');
  assert.equal(validateField('totalWeight', '   ').code, 'empty');
  assert.equal(validateField('totalWeight', 'abc').code, 'nan');
  assert.equal(validateField('quantity', '1.5').code, 'integer');
  assert.equal(validateField('quantity', '2'), null);
  assert.equal(validateField('unknownField', 'x'), null);
});

test('B8: hidden-mode fields are never inspected', () => {
  const batch = validate({ ...validDraft(), unitWeight: '9999', quantity: 'abc', unitInclusions: '' }, 'batch');
  assert.equal(batch.valid, true);
  assert.deepEqual(batch.errors, []);

  const unit = validate({ ...validDraft(), totalWeight: 'abc', inclusions: '999999' }, 'unit');
  assert.equal(unit.valid, true);

  const unitBad = validate({ ...validDraft(), unitWeight: '1' }, 'unit');
  assert.equal(unitBad.errors.length, 1);
  assert.equal(unitBad.errors[0].field, 'unitWeight');
});

test('B9: the cross-field error is reported by validate but invisible to validateField', () => {
  const draft = { ...validDraft(), inclusions: '800' };
  const vr = validate(draft, 'batch');
  assert.equal(vr.valid, false);
  assert.deepEqual(vr.byField.inclusions, {
    field: 'inclusions', code: 'inclusions-exceed', message: 'Exceeds dough weight', related: ['totalWeight']
  });
  assert.equal(validateField('inclusions', '800'), null);
});

test('cross-field boundary uses >= and works in unit mode', () => {
  assert.equal(validate({ ...validDraft(), inclusions: '750' }, 'batch').byField.inclusions.code, 'inclusions-exceed');
  assert.equal(validate({ ...validDraft(), inclusions: '749' }, 'batch').valid, true);
  const unit = validate({ ...validDraft(), unitWeight: '450', unitInclusions: '500' }, 'unit');
  assert.equal(unit.byField.unitInclusions.code, 'inclusions-exceed');
  assert.deepEqual(unit.byField.unitInclusions.related, ['unitWeight']);
});

test('a range error on the inclusions field takes precedence over the cross-field error', () => {
  const vr = validate({ ...validDraft(), inclusions: '30000' }, 'batch');
  assert.equal(vr.errors.length, 1);
  assert.equal(vr.byField.inclusions.code, 'range');
});

test('validate collects one error per invalid field, in field order', () => {
  const vr = validate({ ...validDraft(), waterPct: '', saltPct: '9' }, 'batch');
  assert.deepEqual(vr.errors.map((e) => e.field), ['waterPct', 'saltPct']);
  assert.deepEqual([...FIELDS_FOR_MODE.batch, ...PCT_FIELDS].length, 7);
});

test('crossFieldOk', () => {
  assert.equal(crossFieldOk({ totalWeight: 750, inclusions: 0 }), true);
  assert.equal(crossFieldOk({ totalWeight: 750, inclusions: 750 }), false);
});

test('sanitizeValues repairs field by field and resets impossible inclusions', () => {
  const s = sanitizeValues({ ...DEFAULT_VALUES, totalWeight: 'abc', saltPct: 99, quantity: 2.5, waterPct: '80' });
  assert.equal(s.totalWeight, DEFAULT_VALUES.totalWeight);
  assert.equal(s.saltPct, DEFAULT_VALUES.saltPct);
  assert.equal(s.quantity, DEFAULT_VALUES.quantity);
  assert.equal(s.waterPct, 80);
  assert.equal(s.levainPct, 20);
  assert.deepEqual(sanitizeValues(undefined), DEFAULT_VALUES);
  assert.equal(sanitizeValues({ totalWeight: 100, inclusions: 100 }).inclusions, 0);
  assert.deepEqual(sanitizeValues(DEFAULT_VALUES), DEFAULT_VALUES);
});

test('sanitizeScale keeps a batch size only when both numbers are in range', () => {
  assert.deepEqual(sanitizeScale({ totalWeight: 1500, quantity: 6 }), { totalWeight: 1500, quantity: 6 });
  assert.deepEqual(sanitizeScale({ totalWeight: '1500.5', quantity: '6', extra: 1 }), { totalWeight: 1500.5, quantity: 6 });
  assert.equal(sanitizeScale(null), null);
  assert.equal(sanitizeScale(undefined), null);
  assert.equal(sanitizeScale({ totalWeight: 1500 }), null);
  assert.equal(sanitizeScale({ totalWeight: 10, quantity: 1 }), null);
  assert.equal(sanitizeScale({ totalWeight: 60000, quantity: 1 }), null);
  assert.equal(sanitizeScale({ totalWeight: 1500, quantity: 2.5 }), null);
  assert.equal(sanitizeScale({ totalWeight: 1500, quantity: 101 }), null);
});

test('cleanName strips controls, collapses whitespace and caps length', () => {
  assert.equal(cleanName('  Country \u0000 loaf\n\n  '), 'Country loaf');
  assert.equal(cleanName('x'.repeat(80)).length, NAME_MAX);
  assert.equal(cleanName(''), 'Untitled');
  assert.equal(cleanName('   ', 'Shared recipe'), 'Shared recipe');
  assert.equal(cleanName(42), 'Untitled');
  assert.equal(cleanName('Pão de 🥖'), 'Pão de 🥖');
});
