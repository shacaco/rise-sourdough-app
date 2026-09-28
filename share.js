// Share-by-link: a recipe encoded into the URL hash, plus a bundle format used
// to move a whole library between origins. Pure: no DOM.
import { displayRows, formatGrams, formatPct } from './calc.js';
import { sanitizeValues, crossFieldOk, cleanName, VALUE_FIELDS } from './validation.js';

export const SHARE_VERSION = 1;
export const SHARE_PARAM = 'r';
export const BUNDLE_PARAM = 'b';
export const MAX_PAYLOAD = 2000;
export const MAX_BUNDLE = 50000;

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
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

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

function parsePayload(payload, max) {
  if (typeof payload !== 'string' || payload.length === 0) return { ok: false, reason: 'malformed' };
  if (payload.length > max) return { ok: false, reason: 'too-long' };
  if (!B64URL.test(payload)) return { ok: false, reason: 'malformed' };
  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(payload));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'malformed' };
  return { ok: true, parsed };
}

function pack({ name, values, mode }, fallbackName) {
  const out = { n: cleanName(name, fallbackName), m: mode === 'unit' ? 'u' : 'b' };
  for (const [field, key] of Object.entries(KEY_MAP)) {
    // toFixed(3) strips float noise; the unary plus turns it back into a number.
    out[key] = +Number(values[field]).toFixed(3);
  }
  return out;
}

// Shared data is never silently clamped: if sanitising changes anything,
// the entry is rejected outright.
function unpack(o, fallbackName) {
  if (!o || typeof o !== 'object') return { ok: false, reason: 'malformed' };
  const partial = {};
  for (const [field, key] of Object.entries(KEY_MAP)) {
    const n = o[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, reason: 'malformed' };
    partial[field] = n;
  }
  const values = sanitizeValues(partial);
  for (const field of VALUE_FIELDS) {
    if (values[field] !== partial[field]) return { ok: false, reason: 'out-of-range' };
  }
  if (!crossFieldOk(values)) return { ok: false, reason: 'out-of-range' };
  return {
    ok: true,
    recipe: { name: cleanName(o.n, fallbackName), values, mode: o.m === 'u' ? 'unit' : 'batch' }
  };
}

// --- single recipe --------------------------------------------------------------

export function encodeRecipe(recipe) {
  return toBase64Url(JSON.stringify({ v: SHARE_VERSION, ...pack(recipe, 'Shared recipe') }));
}

export function decodeRecipe(payload) {
  const result = parsePayload(payload, MAX_PAYLOAD);
  if (!result.ok) return result;
  if (result.parsed.v !== SHARE_VERSION) return { ok: false, reason: 'version' };
  return unpack(result.parsed, 'Shared recipe');
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

// --- library bundle (moving between origins) --------------------------------------

export function encodeBundle(records) {
  const entries = records
    .filter((r) => r && !r.deleted)
    .map((r) => ({ ...pack(r, 'Untitled'), id: r.id, c: r.createdAt, u: r.updatedAt }));
  return toBase64Url(JSON.stringify({ v: SHARE_VERSION, r: entries }));
}

// Returns { ok: true, recipes: Recipe[] } with invalid entries skipped, or
// { ok: false, reason } when nothing usable remains.
export function decodeBundle(payload) {
  const result = parsePayload(payload, MAX_BUNDLE);
  if (!result.ok) return result;
  const { parsed } = result;
  if (parsed.v !== SHARE_VERSION) return { ok: false, reason: 'version' };
  if (!Array.isArray(parsed.r)) return { ok: false, reason: 'malformed' };
  const recipes = [];
  for (const entry of parsed.r) {
    const unpacked = unpack(entry, 'Untitled');
    if (!unpacked.ok) continue;
    if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) continue;
    const createdAt = Number(entry.c);
    const updatedAt = Number(entry.u);
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) continue;
    recipes.push({ id: entry.id, ...unpacked.recipe, createdAt, updatedAt });
  }
  if (recipes.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, recipes };
}

export function buildBundleUrl(baseUrl, records) {
  return `${baseUrl}#${BUNDLE_PARAM}=${encodeBundle(records)}`;
}

export function parseBundleHash(hash) {
  if (typeof hash !== 'string') return null;
  const match = new RegExp(`^#?${BUNDLE_PARAM}=([A-Za-z0-9_-]+)$`).exec(hash);
  if (!match) return null;
  return decodeBundle(match[1]);
}

// --- clipboard text ---------------------------------------------------------------

export function formatRecipeText({ name, values, mode }, result, url) {
  const g = (x, d = 0) => formatGrams(x, d);
  const rows = displayRows(result);
  const lines = [
    cleanName(name, 'Sourdough recipe'),
    `Total flour ${g(rows.totalFlour)} · Hydration ${formatPct(result.hydration)} · Prefermented flour ${formatPct(result.prefermentedFlourPct)}`
  ];
  if (mode === 'unit' && values.quantity > 1) {
    lines.push(`Makes ${values.quantity} × ${g(values.totalWeight / values.quantity)}`);
  }
  lines.push(
    '',
    `Flour: ${g(rows.mainFlour)}`,
    `  White: ${g(rows.whiteFlour)}`,
    `  Other: ${g(rows.otherFlours)}`,
    `Water: ${g(rows.mainWater)}`,
    `Salt: ${g(rows.salt, 1)}`,
    `Levain: ${g(rows.levain)}`,
    `Inclusions: ${g(rows.inclusions)}`,
    '',
    'Levain build',
    `  Flour: ${g(rows.levainFlour)}`,
    `  Water: ${g(rows.levainWater)}`,
    '',
    `Formula: water ${values.waterPct} %, salt ${values.saltPct} %, levain ${values.levainPct} % at ${values.levainHydrationPct} % hydration, white flour ${values.whiteFlourPct} %`
  );
  if (url) lines.push('', url);
  return lines.join('\n');
}
