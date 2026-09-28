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
