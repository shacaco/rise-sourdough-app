// Pure sourdough math. Numbers in, numbers out. No DOM, no storage.

// Canonical recipe defaults. Batch weights (totalWeight, inclusions) are the
// source of truth; per-unit values are projections of these given quantity.
export const DEFAULT_VALUES = Object.freeze({
  totalWeight: 750,
  inclusions: 0,
  quantity: 1,
  waterPct: 70,
  saltPct: 2,
  levainPct: 20,
  levainHydrationPct: 100,
  whiteFlourPct: 100
});

export const VALUE_FIELDS = Object.freeze(Object.keys(DEFAULT_VALUES));

// Round to one decimal, half-up. The tiny epsilon absorbs float noise such as
// 333.35 being stored as 333.349999…, which Math.round would otherwise send down.
export function round1(x) {
  return Math.round((x + 1e-9) * 10) / 10;
}

// Baker's-percentage calculation. Every percentage is relative to total flour,
// and total flour includes the flour inside the levain.
//   dough      = totalWeight - inclusions
//   totalFlour = dough / (1 + water + salt)
//   levain     = totalFlour * levainPct, split into flour/water by its hydration
//   main flour / water = totals minus the levain parts
export function calculate(values) {
  for (const key of VALUE_FIELDS) {
    if (!Number.isFinite(values[key])) {
      throw new RangeError(`${key} must be a finite number`);
    }
  }
  const {
    totalWeight, inclusions, quantity,
    waterPct, saltPct, levainPct, levainHydrationPct, whiteFlourPct
  } = values;
  if (totalWeight <= inclusions) {
    throw new RangeError('inclusions must be less than total dough weight');
  }

  const doughWeight = totalWeight - inclusions;
  const waterRatio = waterPct / 100;
  const saltRatio = saltPct / 100;
  const levainRatio = levainPct / 100;
  const levainHydrationRatio = levainHydrationPct / 100;

  const totalFlour = doughWeight / (1 + waterRatio + saltRatio);
  const totalWater = totalFlour * waterRatio;
  const salt = totalFlour * saltRatio;
  const levain = totalFlour * levainRatio;
  const levainFlour = levain / (1 + levainHydrationRatio);
  const levainWater = levain - levainFlour;
  const mainFlour = totalFlour - levainFlour;
  const mainWater = totalWater - levainWater;
  const whiteFlour = mainFlour * (whiteFlourPct / 100);
  const otherFlours = mainFlour - whiteFlour;

  const weights = {
    doughWeight, totalFlour, totalWater, salt, levain, levainFlour, levainWater,
    mainFlour, mainWater, whiteFlour, otherFlours, inclusions
  };
  const q = quantity > 0 ? quantity : 1;
  const perUnit = {};
  for (const key of Object.keys(weights)) {
    perUnit[key] = weights[key] / q;
  }

  return {
    ...weights,
    otherFlourPct: 100 - whiteFlourPct,
    hydration: totalFlour > 0 ? (totalWater / totalFlour) * 100 : 0,
    prefermentedFlourPct: totalFlour > 0 ? (levainFlour / totalFlour) * 100 : 0,
    quantity: q,
    perUnit
  };
}

export function formatGrams(x, decimals = 0) {
  return `${x.toFixed(decimals)} g`;
}

export function formatPct(x, decimals = 1) {
  return `${x.toFixed(decimals)} %`;
}
