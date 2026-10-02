// Recipe records and the local store. Pure helpers plus an injectable
// storage-backed store so it runs in Node tests and in the browser alike.
import { sanitizeValues, sanitizeScale, cleanName, VALUE_FIELDS } from './validation.js';

export const RECIPES_KEY = 'rise-recipes-v2';
export const STATE_KEY = 'rise-state-v2';
export const THEME_KEY = 'rise-theme';
export const LEGACY_RECIPES_KEY = 'rise-recipes-v1';
export const LEGACY_STATE_KEY = 'rise-recipe-v1';

// Tombstones older than this are dropped on load; long enough for any device
// that was offline to have synced its deletion.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function generateId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // randomUUID needs a secure context; plain-http LAN testing falls back here.
  let rand = '';
  if (c && typeof c.getRandomValues === 'function') {
    const words = new Uint32Array(3);
    c.getRandomValues(words);
    rand = Array.from(words, (w) => w.toString(36)).join('');
  } else {
    rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  return `${Date.now().toString(36)}-${rand.slice(0, 10)}`;
}

function normalizeMode(mode) {
  return mode === 'unit' ? 'unit' : 'batch';
}

export function createRecipe({ name, values, mode }, now = Date.now(), id = generateId()) {
  return {
    id,
    name: cleanName(name),
    values: sanitizeValues(values),
    mode: normalizeMode(mode),
    createdAt: now,
    updatedAt: now
  };
}

// Stable string over the fields that define a recipe, for dirty comparison.
export function signature(values, mode) {
  const ordered = {};
  for (const key of VALUE_FIELDS) ordered[key] = Number(values?.[key]);
  ordered.mode = normalizeMode(mode);
  return JSON.stringify(ordered);
}

export function isDirty(recipe, values, mode) {
  if (!recipe) return false;
  return signature(recipe.values, recipe.mode) !== signature(values, mode);
}

// --- v1 migration -----------------------------------------------------------

const V1_FIELD_MAP = Object.freeze({
  'total-weight': 'totalWeight',
  'inclusions-weight': 'inclusions',
  'number-of-loaves': 'quantity',
  'water-percent': 'waterPct',
  'salt-percent': 'saltPct',
  'levain-percent': 'levainPct',
  'levain-hydration-percent': 'levainHydrationPct',
  'white-flour-percent': 'whiteFlourPct'
});

function safeParse(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function v1ToValues(v1) {
  const partial = {};
  for (const [v1Key, field] of Object.entries(V1_FIELD_MAP)) {
    if (v1 && v1Key in v1) partial[field] = v1[v1Key];
  }
  return sanitizeValues(partial);
}

function v1ToMode(v1) {
  return v1 && v1['calculation-mode-toggle'] === true ? 'unit' : 'batch';
}

// Converts the v1 name-keyed map and v1 working state into v2 shapes. Pure and
// forgiving: garbage in yields an empty library and a null state, never a throw.
export function migrateV1({ recipesRaw, stateRaw }, { now = Date.now(), newId = generateId } = {}) {
  const library = { version: 2, recipes: {} };
  const idByName = new Map();

  const v1Recipes = safeParse(recipesRaw);
  if (v1Recipes && !Array.isArray(v1Recipes)) {
    for (const [rawName, v1] of Object.entries(v1Recipes)) {
      if (!v1 || typeof v1 !== 'object') continue;
      const id = newId();
      library.recipes[id] = {
        id,
        name: cleanName(rawName),
        values: v1ToValues(v1),
        mode: v1ToMode(v1),
        createdAt: now,
        updatedAt: now
      };
      idByName.set(rawName, id);
    }
  }

  let state = null;
  const v1State = safeParse(stateRaw);
  if (v1State) {
    const activeName = v1State.activeRecipeName;
    state = {
      version: 2,
      values: v1ToValues(v1State),
      mode: v1ToMode(v1State),
      activeRecipeId: typeof activeName === 'string' ? (idByName.get(activeName) ?? null) : null
    };
  }

  return { library, state };
}

// --- working state ----------------------------------------------------------

function readJson(storage, key) {
  try {
    return safeParse(storage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Private mode, quota, disabled storage: persistence is best-effort.
    return false;
  }
}

export function loadWorkingState(storage) {
  const s = readJson(storage, STATE_KEY);
  if (!s || s.version !== 2) return null;
  return {
    version: 2,
    values: sanitizeValues(s.values),
    mode: normalizeMode(s.mode),
    activeRecipeId: typeof s.activeRecipeId === 'string' ? s.activeRecipeId : null,
    scale: sanitizeScale(s.scale)
  };
}

// `scale` is the batch size chosen for the current bake, or null.
export function saveWorkingState(storage, { values, mode, activeRecipeId, scale }) {
  return writeJson(storage, STATE_KEY, {
    version: 2,
    values,
    mode: normalizeMode(mode),
    activeRecipeId: activeRecipeId ?? null,
    scale: scale ?? null
  });
}

// --- merge planning (used by the cloud store) --------------------------------

function recordKey(r) {
  return JSON.stringify([r.name, signature(r.values, r.mode), r.createdAt, r.updatedAt, r.deleted === true]);
}

// Per id: newest updatedAt wins; ties keep the cloud copy. Tombstones take
// part like any record so a deletion is never resurrected by a stale device.
export function planMerge(localAll, cloudAll) {
  const local = new Map(localAll.map((r) => [r.id, r]));
  const cloud = new Map(cloudAll.map((r) => [r.id, r]));
  const toCloud = [];
  const toLocal = [];
  for (const id of new Set([...local.keys(), ...cloud.keys()])) {
    const L = local.get(id);
    const C = cloud.get(id);
    if (L && !C) toCloud.push(L);
    else if (!L && C) toLocal.push(C);
    else if (L.updatedAt > C.updatedAt) toCloud.push(L);
    else if (C.updatedAt > L.updatedAt || recordKey(L) !== recordKey(C)) toLocal.push(C);
  }
  return { toCloud, toLocal };
}

// --- local store ------------------------------------------------------------

function normalizeRecord(id, r, now) {
  if (!r || typeof r !== 'object') return null;
  const deleted = r.deleted === true;
  const updatedAt = Number(r.updatedAt) || 0;
  if (deleted && now - updatedAt > TOMBSTONE_TTL_MS) return null;
  const record = {
    id,
    name: cleanName(r.name),
    values: sanitizeValues(r.values),
    mode: normalizeMode(r.mode),
    createdAt: Number(r.createdAt) || 0,
    updatedAt
  };
  if (deleted) record.deleted = true;
  return record;
}

export function createLocalStore({ storage, now = Date.now, newId = generateId } = {}) {
  let recipes = {};
  const listeners = new Set();
  let persistFailed = false;

  function persist() {
    const ok = writeJson(storage, RECIPES_KEY, { version: 2, recipes });
    if (!ok) persistFailed = true;
    return ok;
  }

  function load() {
    const lib = readJson(storage, RECIPES_KEY);
    if (lib && lib.version === 2 && lib.recipes && typeof lib.recipes === 'object') {
      recipes = {};
      for (const [id, r] of Object.entries(lib.recipes)) {
        const record = normalizeRecord(id, r, now());
        if (record) recipes[id] = record;
      }
      return;
    }
    // First run on this device: migrate v1 (if any) and write v2 even when
    // empty so this branch never runs again. v1 keys are left untouched.
    let recipesRaw = null;
    let stateRaw = null;
    try {
      recipesRaw = storage.getItem(LEGACY_RECIPES_KEY);
      stateRaw = storage.getItem(LEGACY_STATE_KEY);
    } catch {
      // storage unavailable; start empty
    }
    const migrated = migrateV1({ recipesRaw, stateRaw }, { now: now(), newId });
    recipes = migrated.library.recipes;
    persist();
    if (migrated.state && !readJson(storage, STATE_KEY)) {
      saveWorkingState(storage, migrated.state);
    }
  }

  function live() {
    return Object.values(recipes)
      .filter((r) => !r.deleted)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function notify() {
    const snapshot = live();
    for (const fn of listeners) fn(snapshot);
  }

  load();

  return {
    get persistFailed() {
      return persistFailed;
    },
    async list() {
      return live();
    },
    async all() {
      return Object.values(recipes);
    },
    async get(id) {
      const r = recipes[id];
      return r && !r.deleted ? r : null;
    },
    async put(recipe) {
      recipes[recipe.id] = { ...recipe };
      persist();
      notify();
      return recipes[recipe.id];
    },
    async remove(id) {
      const r = recipes[id];
      if (!r) return;
      recipes[id] = { ...r, deleted: true, updatedAt: now() };
      persist();
      notify();
    },
    async findByName(name) {
      const wanted = cleanName(name, '').toLowerCase();
      if (wanted === '') return null;
      return live().find((r) => r.name.toLowerCase() === wanted) ?? null;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async reload() {
      load();
      notify();
    }
  };
}
