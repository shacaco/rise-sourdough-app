// Field rules, parsing and validation. Pure: no DOM.
import { DEFAULT_VALUES, VALUE_FIELDS } from './calc.js';

export { VALUE_FIELDS };

export const NAME_MAX = 60;

// Bounds are unchanged from the original app. Quantity additionally requires
// a whole number, which the old <input min max> enforced only in the browser.
export const RULES = Object.freeze({
  totalWeight:        { min: 50,  max: 50000, label: 'Total dough weight' },
  inclusions:         { min: 0,   max: 20000, label: 'Inclusions' },
  unitWeight:         { min: 50,  max: 2000,  label: 'Unit weight' },
  quantity:           { min: 1,   max: 100,   label: 'Quantity', integer: true },
  unitInclusions:     { min: 0,   max: 500,   label: 'Inclusions per unit' },
  waterPct:           { min: 50,  max: 120,   label: 'Water' },
  saltPct:            { min: 1,   max: 3,     label: 'Salt' },
  levainPct:          { min: 5,   max: 50,    label: 'Levain' },
  levainHydrationPct: { min: 50,  max: 200,   label: 'Levain hydration' },
  whiteFlourPct:      { min: 0,   max: 100,   label: 'White flour' }
});

export const FIELDS_FOR_MODE = Object.freeze({
  batch: Object.freeze(['totalWeight', 'inclusions']),
  unit: Object.freeze(['unitWeight', 'quantity', 'unitInclusions'])
});

export const PCT_FIELDS = Object.freeze([
  'waterPct', 'saltPct', 'levainPct', 'levainHydrationPct', 'whiteFlourPct'
]);

// Accepts "750", " 7.5 ", "7,5", ".5". Rejects "", "abc", "1e3", "1.2.3".
export function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bounds(rule) {
  return `${rule.min}–${rule.max}`;
}

// Single-field check only. Never evaluates the cross-field rule, so a blur
// re-check of one field can never clear an error that depends on another.
export function validateField(field, raw) {
  const rule = RULES[field];
  if (!rule) return null;
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === '' || s === null || s === undefined) {
    return { field, code: 'empty', message: 'Enter a number' };
  }
  const n = parseNumber(raw);
  if (n === null) {
    return { field, code: 'nan', message: 'Enter a number' };
  }
  if (rule.integer && !Number.isInteger(n)) {
    return { field, code: 'integer', message: `Whole number ${bounds(rule)}` };
  }
  if (n < rule.min || n > rule.max) {
    return { field, code: 'range', message: `Use ${bounds(rule)}` };
  }
  return null;
}

// Validates only the fields visible in `mode` plus the percentages, so errors
// from the hidden panel can never leak into the summary.
export function validate(draft, mode) {
  const modeFields = FIELDS_FOR_MODE[mode] ?? FIELDS_FOR_MODE.batch;
  const errors = [];
  const byField = {};
  for (const field of [...modeFields, ...PCT_FIELDS]) {
    const error = validateField(field, draft?.[field]);
    if (error) {
      errors.push(error);
      byField[field] = error;
    }
  }

  const [weightField, inclusionsField] = mode === 'unit'
    ? ['unitWeight', 'unitInclusions']
    : ['totalWeight', 'inclusions'];
  if (!byField[inclusionsField]) {
    const w = parseNumber(draft?.[weightField]);
    const i = parseNumber(draft?.[inclusionsField]);
    if (w !== null && i !== null && i >= w) {
      const error = {
        field: inclusionsField,
        code: 'inclusions-exceed',
        message: 'Exceeds dough weight',
        related: [weightField]
      };
      errors.push(error);
      byField[inclusionsField] = error;
    }
  }

  return { valid: errors.length === 0, errors, byField };
}

export function crossFieldOk(values) {
  return values.inclusions < values.totalWeight;
}

// Returns a complete RecipeValues. Each field is kept only when it parses and
// sits inside its rule; anything else falls back to the default for that field.
export function sanitizeValues(partial) {
  const out = {};
  for (const key of VALUE_FIELDS) {
    const rule = RULES[key];
    const n = parseNumber(partial?.[key]);
    const ok = n !== null
      && n >= rule.min && n <= rule.max
      && (!rule.integer || Number.isInteger(n));
    out[key] = ok ? n : DEFAULT_VALUES[key];
  }
  if (out.inclusions >= out.totalWeight) out.inclusions = DEFAULT_VALUES.inclusions;
  return out;
}

// Strips control characters, collapses whitespace, trims, caps at NAME_MAX.
export function cleanName(name, fallback = 'Untitled') {
  if (typeof name !== 'string') return fallback;
  const s = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return s === '' ? fallback : s;
}
