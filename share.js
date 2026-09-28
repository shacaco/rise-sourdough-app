// Share-by-link: a recipe encoded into the URL hash. Pure: no DOM.
import { formatGrams, formatPct } from './calc.js';
import { sanitizeValues, crossFieldOk, cleanName, VALUE_FIELDS } from './validation.js';

export const SHARE_VERSION = 1;
export const SHARE_PARAM = 'r';
export const MAX_PAYLOAD = 2000;

// Compact JSON keys keep the link short (~140 chars for a typical recipe).
const KEY_MAP = Object.freeze({
  totalWeight: 't',
  inclusions: 'i',
  quantity: 'q',
  waterPct: 'w',
  saltPct: 's',
  levainPct: 'l',
  levainHydrationPct: 'h',
  whiteFlourPct: 'f'
});

const B64URL = /^[A-Za-z0-9_-]+$/;

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeRecipe({ name, values, mode }) {
  const payload = {
    v: SHARE_VERSION,
    n: cleanName(name, 'Shared recipe'),
    m: mode === 'unit' ? 'u' : 'b'
  };
  for (const [field, key] of Object.entries(KEY_MAP)) {
    // toFixed(3) strips float noise; the unary plus turns it back into a number.
    payload[key] = +Number(values[field]).toFixed(3);
  }
  return toBase64Url(JSON.stringify(payload));
}

export function decodeRecipe(payload) {
  if (typeof payload !== 'string' || payload.length === 0) return { ok: false, reason: 'malformed' };
  if (payload.length > MAX_PAYLOAD) return { ok: false, reason: 'too-long' };
  if (!B64URL.test(payload)) return { ok: false, reason: 'malformed' };

  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(payload));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'malformed' };
  if (parsed.v !== SHARE_VERSION) return { ok: false, reason: 'version' };

  const partial = {};
  for (const [field, key] of Object.entries(KEY_MAP)) {
    const n = parsed[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, reason: 'malformed' };
    partial[field] = n;
  }

  // Shared data is never silently clamped: if sanitising changes anything,
  // the link is rejected outright.
  const values = sanitizeValues(partial);
  for (const field of VALUE_FIELDS) {
    if (values[field] !== partial[field]) return { ok: false, reason: 'out-of-range' };
  }
  if (!crossFieldOk(values)) return { ok: false, reason: 'out-of-range' };

  return {
    ok: true,
    recipe: {
      name: cleanName(parsed.n, 'Shared recipe'),
      values,
      mode: parsed.m === 'u' ? 'unit' : 'batch'
    }
  };
}

export function buildShareUrl(baseUrl, recipe) {
  return `${baseUrl}#${SHARE_PARAM}=${encodeRecipe(recipe)}`;
}

// '#r=<payload>' -> decode result; anything else -> null.
export function parseShareHash(hash) {
  if (typeof hash !== 'string') return null;
  const match = new RegExp(`^#?${SHARE_PARAM}=([A-Za-z0-9_-]+)$`).exec(hash);
  if (!match) return null;
  return decodeRecipe(match[1]);
}

// Plain-text ingredient list for the clipboard.
export function formatRecipeText({ name, values, mode }, result, url) {
  const g = (x, d = 0) => formatGrams(x, d);
  const lines = [
    cleanName(name, 'Sourdough recipe'),
    `Total flour ${g(result.totalFlour)} · Hydration ${formatPct(result.hydration)} · Prefermented flour ${formatPct(result.prefermentedFlourPct)}`
  ];
  if (mode === 'unit' && values.quantity > 1) {
    lines.push(`Makes ${values.quantity} × ${g(values.totalWeight / values.quantity)}`);
  }
  lines.push(
    '',
    `Flour: ${g(result.mainFlour)}`,
    `  White: ${g(result.whiteFlour)}`,
    `  Other: ${g(result.otherFlours)}`,
    `Water: ${g(result.mainWater)}`,
    `Salt: ${g(result.salt, 1)}`,
    `Levain: ${g(result.levain)}`,
    `Inclusions: ${g(result.inclusions)}`,
    '',
    'Levain build',
    `  Flour: ${g(result.levainFlour)}`,
    `  Water: ${g(result.levainWater)}`,
    '',
    `Formula: water ${values.waterPct} %, salt ${values.saltPct} %, levain ${values.levainPct} % at ${values.levainHydrationPct} % hydration, white flour ${values.whiteFlourPct} %`
  );
  if (url) lines.push('', url);
  return lines.join('\n');
}
