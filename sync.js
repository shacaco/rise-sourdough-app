// Keeps the Total Batch and Per Unit views consistent. Pure: no DOM.
//
// Batch weights are canonical. The per-unit view shows a projection
// (total / quantity) rounded to one decimal for display. That projection is
// never multiplied back: an edit in the per-unit view writes back only the
// field that was edited, so untouched numbers never drift.
import { round1, VALUE_FIELDS } from './calc.js';

const UNIT_FIELDS = ['unitWeight', 'unitInclusions'];
const BATCH_FIELDS = ['totalWeight', 'inclusions'];

function safeQuantity(values) {
  return values.quantity > 0 ? values.quantity : 1;
}

export function projectToUnit(values) {
  const q = safeQuantity(values);
  return {
    unitWeight: round1(values.totalWeight / q),
    unitInclusions: round1(values.inclusions / q)
  };
}

// Returns a new RecipeValues with `field` edited to `num`. Never mutates.
export function applyEdit(values, field, num) {
  const next = { ...values };
  switch (field) {
    case 'unitWeight':
      next.totalWeight = round1(num * safeQuantity(next));
      break;
    case 'unitInclusions':
      next.inclusions = round1(num * safeQuantity(next));
      break;
    case 'quantity': {
      // Quantity edits keep the unit weight fixed and scale the batch.
      const q = safeQuantity(next);
      next.totalWeight = round1(next.totalWeight * num / q);
      next.inclusions = round1(next.inclusions * num / q);
      next.quantity = num;
      break;
    }
    default:
      if (VALUE_FIELDS.includes(field)) next[field] = num;
  }
  return next;
}

// --- batch size for one bake ------------------------------------------------
//
// A scale is { totalWeight, quantity }: the size to bake at. It is kept apart
// from the recipe values, so choosing it never edits the recipe.

// Recipe values at the scaled size. Inclusions keep their share of the dough.
export function scaleValues(values, scale) {
  if (!scale) return values;
  const inclusions = round1(values.inclusions * scale.totalWeight / values.totalWeight);
  return {
    ...values,
    totalWeight: scale.totalWeight,
    quantity: scale.quantity,
    // Rounding must never lift the inclusions up to the whole batch.
    inclusions: Math.min(inclusions, round1(scale.totalWeight - 0.1))
  };
}

// Scale from a per-unit answer. `values` is what is on screen; its unit weight
// is a rounded projection, so when that number comes back untouched only the
// quantity ratio is applied and the total cannot drift.
export function scaleFromUnits(values, quantity, unitWeight) {
  const untouched = unitWeight === projectToUnit(values).unitWeight;
  const totalWeight = untouched
    ? round1(values.totalWeight * quantity / safeQuantity(values))
    : round1(unitWeight * quantity);
  return { totalWeight, quantity };
}

// Which draft fields must be re-derived from canonical after `field` changes.
export function counterpartFields(field) {
  if (BATCH_FIELDS.includes(field)) return [...UNIT_FIELDS];
  if (UNIT_FIELDS.includes(field)) return [...BATCH_FIELDS];
  if (field === 'quantity') return [...BATCH_FIELDS, ...UNIT_FIELDS];
  return [];
}

// Full draft (input strings) from canonical values.
export function draftFromValues(values) {
  const projection = projectToUnit(values);
  const draft = {};
  for (const key of VALUE_FIELDS) draft[key] = String(values[key]);
  draft.unitWeight = String(projection.unitWeight);
  draft.unitInclusions = String(projection.unitInclusions);
  return draft;
}
