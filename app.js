// Rise – DOM wiring. All calculation, validation, storage and sharing logic
// lives in the pure modules; this file only moves data between them and the page.
import { DEFAULT_VALUES, calculate, displayRows, round1, formatGrams } from './calc.js';
import { applyEdit, counterpartFields, draftFromValues, scaleValues, scaleFromUnits } from './sync.js';
import { RULES, FIELDS_FOR_MODE, parseNumber, validateField, validate, crossFieldOk, cleanName } from './validation.js';
import {
  RECIPES_KEY, THEME_KEY, createRecipe, isDirty, createLocalStore, loadWorkingState, saveWorkingState
} from './recipes.js';
import { buildShareUrl, parseShareHash, formatRecipeText, buildBundleUrl, parseBundleHash } from './share.js';
import { initCloud, authMessage } from './cloud.js';

const APP_VERSION = document.documentElement.dataset.appVersion || '';
const TOUCH_DELAY_MS = 600;
const THEME_COLORS = { light: '#f4f4f2', dark: '#121312' };

// The app is moving from GitHub Pages to Firebase Hosting. On the old host a
// banner offers to carry the local library over as a bundle link.
const NEW_HOME_URL = 'https://rise-sourdough.web.app/';
const OLD_HOST = 'shacaco.github.io';
const MOVED_DISMISSED_KEY = 'rise-moved-dismissed';

const $ = (id) => document.getElementById(id);

// --- storage guard ------------------------------------------------------------

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
}

const storage = (() => {
  try {
    const probe = '__rise_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
})();

// --- elements -----------------------------------------------------------------

const els = {
  form: $('calc-form'),
  results: $('results'),
  status: $('results-status'),
  caption: $('results-caption'),
  otherFlours: $('other-flours-value'),
  modeBatch: $('mode-batch'),
  modeUnit: $('mode-unit'),
  panelBatch: $('panel-batch'),
  panelUnit: $('panel-unit'),
  chip: $('recipe-chip'),
  chipName: $('recipe-chip-name'),
  chipState: $('recipe-chip-state'),
  sheet: $('recipe-sheet'),
  sheetClose: $('recipe-sheet-close'),
  list: $('recipe-list'),
  listEmpty: $('recipe-list-empty'),
  save: $('recipe-save'),
  saveAs: $('recipe-save-as'),
  rename: $('recipe-rename'),
  del: $('recipe-delete'),
  newBtn: $('recipe-new'),
  nameDialog: $('name-dialog'),
  nameForm: $('name-form'),
  nameInput: $('recipe-name'),
  nameError: $('recipe-name-error'),
  nameTitle: $('name-dialog-title'),
  nameOk: $('name-ok'),
  nameCancel: $('name-cancel'),
  confirmDialog: $('confirm-dialog'),
  confirmTitle: $('confirm-title'),
  confirmMessage: $('confirm-message'),
  confirmOk: $('confirm-ok'),
  confirmCancel: $('confirm-cancel'),
  toast: $('toast'),
  pill: $('update-pill'),
  pillText: $('update-pill-text'),
  pillReload: $('update-reload'),
  menu: $('app-menu'),
  menuBtn: $('menu-btn'),
  print: $('menu-print'),
  version: $('app-version'),
  menuSignin: $('menu-signin'),
  menuAccount: $('menu-account'),
  menuAccountName: $('menu-account-name'),
  menuSignout: $('menu-signout'),
  wake: $('wake-lock'),
  copy: $('copy-recipe'),
  copyLabel: $('copy-recipe-label'),
  share: $('share-recipe'),
  banner: $('share-banner'),
  bannerText: $('share-banner-text'),
  shareOpen: $('share-open'),
  shareSave: $('share-save'),
  shareDismiss: $('share-dismiss'),
  movedBanner: $('moved-banner'),
  movedExport: $('moved-export'),
  movedDismiss: $('moved-dismiss'),
  summary: $('summary'),
  edit: $('edit-recipe'),
  editBar: $('edit-bar'),
  editCancel: $('edit-cancel'),
  editDone: $('edit-done'),
  editSave: $('edit-save'),
  batch: $('batch'),
  batchSize: $('batch-size'),
  batchNote: $('batch-note'),
  batchReset: $('batch-reset'),
  batchScale: $('batch-scale'),
  scaleDialog: $('scale-dialog'),
  scaleForm: $('scale-form'),
  scaleTotalField: $('scale-total-field'),
  scaleUnitFields: $('scale-unit-fields'),
  scaleCancel: $('scale-cancel')
};

// Inputs of the batch-size dialog, keyed by the rule they are checked against.
const scaleFields = {};
for (const [field, id] of [['totalWeight', 'scale-total'], ['quantity', 'scale-quantity'], ['unitWeight', 'scale-unit-weight']]) {
  const input = $(id);
  scaleFields[field] = { input, wrapper: input.closest('.field'), error: $(`${id}-error`) };
}

const sum = {
  dough: $('summary-dough'),
  water: $('summary-water'),
  salt: $('summary-salt'),
  levain: $('summary-levain'),
  flour: $('summary-flour')
};

const out = {
  totalFlour: $('total-flour-result'),
  hydration: $('hydration-result'),
  pff: $('pff-result'),
  mainFlour: $('main-flour-result'),
  whiteFlour: $('white-flour-result'),
  otherFlours: $('other-flours-result'),
  mainWater: $('main-water-result'),
  salt: $('salt-result'),
  levain: $('levain-result'),
  inclusions: $('inclusions-result'),
  levainFlour: $('levain-flour-result'),
  levainWater: $('levain-water-result')
};

// data-field -> { input, wrapper, error }
const fields = {};
for (const input of els.form.querySelectorAll('input[data-field]')) {
  fields[input.dataset.field] = {
    input,
    wrapper: input.closest('.field'),
    error: $(`${input.id}-error`)
  };
}

// --- state --------------------------------------------------------------------

const state = {
  values: { ...DEFAULT_VALUES },
  mode: 'batch',
  draft: {},
  touched: new Set(),
  validation: { valid: true, errors: [], byField: {} },
  result: null,
  activeRecipeId: null,
  activeRecipe: null,
  draftName: null, // name of an opened shared recipe before it is saved
  editing: false, // a saved recipe is read-only until Edit is pressed
  editSnapshot: null, // values, mode and scale when Edit was pressed, for Cancel
  scale: null, // batch size for this bake ({ totalWeight, quantity }); never part of the recipe
  recipes: [],
  pendingShare: null
};

let localStore;
let store; // the local store, or the cloud-backed store while signed in
let cloud = null;
const touchTimers = new Map();

// --- boot ---------------------------------------------------------------------

registerServiceWorker();
initTheme();
init();

async function init() {
  localStore = createLocalStore({ storage });
  store = localStore;

  const saved = loadWorkingState(storage);
  if (saved) {
    state.values = saved.values;
    state.mode = saved.mode;
    state.activeRecipeId = saved.activeRecipeId;
    state.scale = saved.scale;
  }
  state.activeRecipe = state.activeRecipeId ? await store.get(state.activeRecipeId) : null;
  if (!state.activeRecipe) {
    state.activeRecipeId = null;
    state.scale = null;
  }

  state.recipes = await store.list();
  store.subscribe(onRecipesChanged);

  applyMode(state.mode);
  wireEvents();
  initWakeLock();
  initMenuFallback();
  els.version.textContent = APP_VERSION ? `Rise ${APP_VERSION}` : 'Rise';

  await handleShareHash();
  await handleBundleHash();
  renderMovedBanner();

  if (store.persistFailed) toast('Changes will not be saved on this device');

  startCloud();
}

// --- mode and draft -------------------------------------------------------------

// What the ingredient list is calculated from: the recipe values, at the batch
// size chosen for this bake when there is one.
function shownValues() {
  return scaleValues(state.values, state.scale);
}

function applyMode(mode, { persist = false } = {}) {
  state.mode = mode;
  state.result = calculate(shownValues());
  els.modeBatch.checked = mode === 'batch';
  els.modeUnit.checked = mode === 'unit';
  els.panelBatch.hidden = mode !== 'batch';
  els.panelUnit.hidden = mode !== 'unit';

  state.draft = draftFromValues(state.values);
  for (const [field, el] of Object.entries(fields)) el.input.value = state.draft[field];
  // Fields that just became visible are shown with any error right away, so an
  // out-of-range projection never hides behind the touched rule.
  for (const field of FIELDS_FOR_MODE[mode]) state.touched.add(field);

  revalidate();
  renderAll();
  if (persist) persistState();
}

function revalidate() {
  state.validation = validate(state.draft, state.mode);
}

function persistState() {
  saveWorkingState(storage, {
    values: state.values,
    mode: state.mode,
    activeRecipeId: state.activeRecipeId,
    scale: state.scale
  });
}

function onFieldInput(field, raw) {
  state.draft[field] = raw;
  scheduleTouch(field);

  const error = validateField(field, raw);
  if (!error) {
    const candidate = applyEdit(state.values, field, parseNumber(raw));
    if (crossFieldOk(candidate)) {
      state.values = candidate;
      const derived = draftFromValues(candidate);
      for (const other of counterpartFields(field)) {
        state.draft[other] = derived[other];
        fields[other].input.value = derived[other];
      }
      state.result = calculate(candidate);
      persistState();
    }
  }

  revalidate();
  renderAll();
}

function scheduleTouch(field) {
  clearTimeout(touchTimers.get(field));
  if (state.touched.has(field)) return;
  touchTimers.set(field, setTimeout(() => touch(field), TOUCH_DELAY_MS));
}

function touch(field) {
  clearTimeout(touchTimers.get(field));
  touchTimers.delete(field);
  if (state.touched.has(field)) return;
  state.touched.add(field);
  renderErrors();
}

function currentlyDirty() {
  return state.activeRecipe ? isDirty(state.activeRecipe, state.values, state.mode) : false;
}

function currentName() {
  return state.activeRecipe ? state.activeRecipe.name : (state.draftName ?? 'Sourdough recipe');
}

// --- rendering ----------------------------------------------------------------

function renderAll() {
  renderResults();
  renderErrors();
  renderChip();
  renderView();
}

function trimNumber(x) {
  return String(Number(x.toFixed(1)));
}

function renderResults() {
  const r = state.result;
  const v = shownValues();
  const valid = state.validation.valid;

  const d = displayRows(r);
  out.totalFlour.textContent = String(d.totalFlour);
  out.hydration.textContent = r.hydration.toFixed(1);
  out.pff.textContent = r.prefermentedFlourPct.toFixed(1);
  out.mainFlour.textContent = formatGrams(d.mainFlour);
  out.whiteFlour.textContent = formatGrams(d.whiteFlour);
  out.otherFlours.textContent = formatGrams(d.otherFlours);
  out.mainWater.textContent = formatGrams(d.mainWater);
  out.salt.textContent = formatGrams(d.salt, 1);
  out.levain.textContent = formatGrams(d.levain);
  out.inclusions.textContent = formatGrams(d.inclusions);
  out.levainFlour.textContent = formatGrams(d.levainFlour);
  out.levainWater.textContent = formatGrams(d.levainWater);
  els.otherFlours.textContent = trimNumber(r.otherFlourPct);

  // The read-only view states the batch in its own row instead.
  els.caption.textContent = !isReadOnly() && state.mode === 'unit' && v.quantity > 1
    ? `Batch for ${v.quantity} units, ${trimNumber(round1(v.totalWeight / v.quantity))} g each`
    : '';

  els.results.classList.toggle('is-stale', !valid);
  els.copy.disabled = !valid;
  els.share.disabled = !valid;
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function renderErrors() {
  const { byField, valid } = state.validation;
  const shown = [];
  for (const [field, el] of Object.entries(fields)) {
    const error = byField[field];
    const display = Boolean(error)
      && (state.touched.has(field) || (error.related ?? []).some((f) => state.touched.has(f)));
    el.wrapper.classList.toggle('is-invalid', display);
    if (display) {
      el.input.setAttribute('aria-invalid', 'true');
      el.error.textContent = error.message;
      shown.push(error);
    } else {
      el.input.removeAttribute('aria-invalid');
      el.error.textContent = '';
    }
  }

  if (valid) {
    els.status.textContent = '';
    return;
  }
  const names = [...new Set(shown.map((e) => RULES[e.field].label))];
  els.status.textContent = names.length
    ? `Showing the last valid recipe. Fix ${joinNames(names)} to update.`
    : 'Showing the last valid recipe. Finish editing to update.';
}

function renderChip() {
  const dirty = currentlyDirty();
  const name = state.activeRecipe ? state.activeRecipe.name : (state.draftName ?? 'Untitled');
  els.chip.dataset.dirty = String(dirty);
  els.chip.dataset.untitled = String(!state.activeRecipe);
  els.chipName.textContent = name;
  els.chipState.textContent = dirty ? ', unsaved changes' : '';

  els.save.disabled = state.activeRecipe ? !dirty : false;
  els.rename.disabled = !state.activeRecipe;
  els.del.disabled = !state.activeRecipe;
}

function svgIcon(id, className) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function doughSize(v, mode) {
  if (mode === 'unit' && v.quantity > 1) {
    return `${v.quantity} × ${trimNumber(round1(v.totalWeight / v.quantity))} g`;
  }
  return `${trimNumber(v.totalWeight)} g`;
}

function recipeMeta(r) {
  return `${doughSize(r.values, r.mode)} · ${trimNumber(r.values.waterPct)} %`;
}

// A saved recipe opens read-only: ingredients first, the inputs behind Edit,
// so a stray tap cannot change the amounts. A recipe that is not saved yet has
// nothing to protect and stays editable.
function isReadOnly() {
  return Boolean(state.activeRecipe) && !state.editing;
}

function sameSize(a, b) {
  return a.totalWeight === b.totalWeight && a.quantity === b.quantity;
}

function renderView() {
  const readOnly = isReadOnly();
  const scaled = Boolean(state.scale);
  els.batch.hidden = !readOnly;
  els.batch.dataset.scaled = String(scaled);
  els.batchSize.textContent = doughSize(shownValues(), state.mode);
  els.batchNote.textContent = scaled ? `Recipe: ${doughSize(state.values, state.mode)}` : 'Recipe size';
  els.batchReset.hidden = !scaled;

  els.form.hidden = readOnly;
  els.summary.hidden = !readOnly;
  els.editBar.hidden = !(state.activeRecipe && state.editing);
  els.editDone.disabled = !state.validation.valid;
  els.editSave.disabled = !state.validation.valid || !currentlyDirty();

  const v = state.values;
  const other = state.result.otherFlourPct;
  sum.dough.textContent = doughSize(v, state.mode);
  sum.water.textContent = `${trimNumber(v.waterPct)} %`;
  sum.salt.textContent = `${trimNumber(v.saltPct)} %`;
  sum.levain.textContent = `${trimNumber(v.levainPct)} % at ${trimNumber(v.levainHydrationPct)} % hydration`;
  sum.flour.textContent = other > 0
    ? `${trimNumber(v.whiteFlourPct)} % white, ${trimNumber(other)} % other`
    : '100 % white';
}

function renderRecipeList() {
  for (const li of els.list.querySelectorAll('li[data-id]')) li.remove();
  for (const r of state.recipes) {
    const li = document.createElement('li');
    li.dataset.id = r.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recipe-item';
    button.dataset.id = r.id;
    const current = r.id === state.activeRecipeId;
    button.setAttribute('aria-current', current ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'recipe-item__name';
    name.textContent = r.name;

    const meta = document.createElement('span');
    meta.className = 'recipe-item__meta';
    meta.textContent = recipeMeta(r);
    if (current) meta.append(' ', svgIcon('i-check', 'icon icon--sm recipe-item__check'));

    button.append(name, meta);
    li.append(button);
    els.list.append(li);
  }
  els.listEmpty.hidden = state.recipes.length > 0;
}

function renderAccount(user) {
  els.menuSignin.hidden = Boolean(user);
  els.menuAccount.hidden = !user;
  els.menuAccountName.textContent = user ? (user.email || user.displayName || 'Google account') : '';
}

function renderMovedBanner() {
  let dismissed = false;
  try { dismissed = storage.getItem(MOVED_DISMISSED_KEY) === '1'; } catch { /* ignore */ }
  els.movedBanner.hidden = !(window.location.hostname === OLD_HOST && !dismissed);
}

// The library changed (this tab, another tab, or another device via sync).
function onRecipesChanged(list) {
  state.recipes = list;
  renderRecipeList();
  if (!state.activeRecipe) return;

  const latest = list.find((r) => r.id === state.activeRecipeId);
  if (!latest) {
    detachRecipe();
    toast('This recipe was deleted on another device');
    return;
  }
  if (latest.updatedAt <= state.activeRecipe.updatedAt && latest.name === state.activeRecipe.name) return;

  const hadLocalEdits = currentlyDirty();
  const valuesChanged = isDirty(latest, state.values, state.mode);
  state.activeRecipe = latest;
  if (valuesChanged && !hadLocalEdits) {
    state.values = { ...latest.values };
    state.touched = new Set();
    applyMode(latest.mode, { persist: true });
    // Cancel must not bring back the values this update just replaced.
    if (state.editing) state.editSnapshot = { ...state.editSnapshot, values: { ...state.values }, mode: state.mode };
    toast('Updated from another device');
  } else {
    renderChip();
    renderView();
  }
}

// --- dialogs and toast --------------------------------------------------------

function promptName({ title, initial = '', okLabel = 'Save' }) {
  return new Promise((resolve) => {
    els.nameTitle.textContent = title;
    els.nameOk.textContent = okLabel;
    els.nameInput.value = initial;
    els.nameError.textContent = '';
    els.nameInput.closest('.field').classList.remove('is-invalid');
    const onClose = () => {
      els.nameDialog.removeEventListener('close', onClose);
      resolve(els.nameDialog.returnValue === 'ok' ? cleanName(els.nameInput.value, '') : null);
    };
    els.nameDialog.addEventListener('close', onClose);
    els.nameDialog.returnValue = '';
    els.nameDialog.showModal();
    els.nameInput.focus();
    els.nameInput.select();
  });
}

function confirmDialog({ title, message, confirmLabel = 'OK', danger = true, selectable = false, hideCancel = false }) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmMessage.classList.toggle('is-selectable', selectable);
    els.confirmOk.textContent = confirmLabel;
    els.confirmOk.classList.toggle('btn--danger', danger);
    els.confirmOk.classList.toggle('btn--primary', !danger);
    els.confirmCancel.hidden = hideCancel;
    const onClose = () => {
      els.confirmDialog.removeEventListener('close', onClose);
      resolve(els.confirmDialog.returnValue === 'ok');
    };
    els.confirmDialog.addEventListener('close', onClose);
    els.confirmDialog.returnValue = '';
    els.confirmDialog.showModal();
    (hideCancel ? els.confirmOk : els.confirmCancel).focus();
  });
}

let toastTimer = null;
function toast(text) {
  clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
    setTimeout(() => {
      if (!els.toast.classList.contains('is-visible')) els.toast.textContent = '';
    }, 300);
  }, 2400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some in-app browsers block the async API but still honour the legacy
    // copy command from a user gesture.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

// --- recipes ------------------------------------------------------------------

function openSheet() {
  renderRecipeList();
  renderChip();
  els.sheet.showModal();
  document.documentElement.classList.add('is-locked');
  els.sheetClose.focus();
}

function closeSheet() {
  if (els.sheet.open) els.sheet.close();
}

async function confirmDiscard() {
  if (!currentlyDirty()) return true;
  return confirmDialog({
    title: 'Discard unsaved changes?',
    message: `“${state.activeRecipe.name}” has changes that have not been saved.`,
    confirmLabel: 'Discard',
    danger: true
  });
}

// The inputs always hold the recipe's own size, so the batch size of this bake
// is set aside while they are open.
function startEditing() {
  state.editing = true;
  state.editSnapshot = { values: { ...state.values }, mode: state.mode, scale: state.scale };
  state.scale = null;
  applyMode(state.mode, { persist: true });
  // The inputs appear above the ingredients, so bring them into view.
  window.scrollTo(0, 0);
  els.editDone.focus({ preventScroll: true });
}

// Back to the read-only view. Half-typed input is dropped so the fields match
// the values again the next time they are shown.
function stopEditing() {
  const focusInBar = els.editBar.contains(document.activeElement);
  const snapshot = state.editSnapshot;
  // The batch size of this bake comes back, unless the edit gave the recipe a
  // new size of its own.
  if (snapshot && sameSize(snapshot.values, state.values)) state.scale = snapshot.scale;
  state.editing = false;
  state.editSnapshot = null;
  state.touched = new Set();
  applyMode(state.mode, { persist: true });
  window.scrollTo(0, 0);
  if (focusInBar) els.edit.focus({ preventScroll: true });
}

function cancelEditing() {
  const snapshot = state.editSnapshot;
  if (snapshot) {
    state.values = snapshot.values;
    state.mode = snapshot.mode;
  }
  stopEditing();
}

// The active recipe is gone. What is on screen stays as an unsaved recipe.
function detachRecipe() {
  state.values = shownValues();
  state.scale = null;
  state.activeRecipe = null;
  state.activeRecipeId = null;
  state.editing = false;
  state.editSnapshot = null;
  state.touched = new Set();
  applyMode(state.mode, { persist: true });
}

function setScale(scale) {
  state.scale = scale;
  applyMode(state.mode, { persist: true });
}

// Reads the batch-size dialog. Returns the scale, or null after showing why
// the numbers cannot be used.
function readScaleDialog() {
  const shown = shownValues();
  const raw = (field) => scaleFields[field].input.value;
  const errors = {};
  let scale = null;
  if (state.mode === 'unit') {
    errors.quantity = validateField('quantity', raw('quantity'));
    errors.unitWeight = validateField('unitWeight', raw('unitWeight'));
    if (!errors.quantity && !errors.unitWeight) {
      scale = scaleFromUnits(shown, parseNumber(raw('quantity')), parseNumber(raw('unitWeight')));
      if (scale.totalWeight > RULES.totalWeight.max) {
        errors.unitWeight = { message: `Batch above ${RULES.totalWeight.max} g` };
        scale = null;
      }
    }
  } else {
    errors.totalWeight = validateField('totalWeight', raw('totalWeight'));
    if (!errors.totalWeight) scale = { totalWeight: round1(parseNumber(raw('totalWeight'))), quantity: shown.quantity };
  }

  for (const [field, el] of Object.entries(scaleFields)) {
    const error = errors[field];
    el.wrapper.classList.toggle('is-invalid', Boolean(error));
    el.error.textContent = error ? error.message : '';
    if (error) el.input.setAttribute('aria-invalid', 'true');
    else el.input.removeAttribute('aria-invalid');
  }
  return scale;
}

// Opens the batch-size dialog on the size shown now. Apply is handled by the
// form's submit listener.
function openScaleDialog() {
  const unit = state.mode === 'unit';
  const draft = draftFromValues(shownValues());
  els.scaleTotalField.hidden = unit;
  els.scaleUnitFields.hidden = !unit;
  for (const [field, el] of Object.entries(scaleFields)) {
    el.input.value = draft[field];
    el.wrapper.classList.remove('is-invalid');
    el.error.textContent = '';
    el.input.removeAttribute('aria-invalid');
  }
  els.scaleDialog.showModal();
  const first = scaleFields[unit ? 'quantity' : 'totalWeight'].input;
  first.focus();
  first.select();
}

function loadValues(values, mode, recipe, draftName = null) {
  state.values = { ...values };
  state.activeRecipe = recipe;
  state.activeRecipeId = recipe ? recipe.id : null;
  state.draftName = draftName;
  state.scale = null;
  state.editing = false;
  state.editSnapshot = null;
  state.touched = new Set();
  applyMode(mode, { persist: true });
}

// Stores `record` as the active recipe. The active record is set before the
// store call so the library listener sees no "remote" change.
async function storeActive(record) {
  state.activeRecipe = record;
  state.activeRecipeId = record.id;
  state.draftName = null;
  await store.put(record);
  renderChip();
  persistState();
}

// Saves what is on screen under `name`, replacing an existing recipe of that
// name when the user agrees. A batch size chosen for this bake becomes the
// new recipe's own size. Returns the stored record or null.
async function saveCurrentAs(name) {
  const existing = await store.findByName(name);
  const values = shownValues();
  let record;
  if (existing && existing.id === state.activeRecipeId) {
    record = { ...existing, values: { ...values }, mode: state.mode, updatedAt: Date.now() };
  } else if (existing) {
    const replace = await confirmDialog({
      title: `Replace “${existing.name}”?`,
      message: 'A recipe with this name already exists. It will be replaced with the current values.',
      confirmLabel: 'Replace',
      danger: false
    });
    if (!replace) return null;
    record = { ...existing, values: { ...values }, mode: state.mode, updatedAt: Date.now() };
  } else {
    record = createRecipe({ name, values, mode: state.mode });
  }
  state.values = values;
  state.scale = null;
  await storeActive(record);
  stopEditing();
  toast('Saved');
  return record;
}

async function saveRecipe() {
  if (state.activeRecipe) {
    const updated = { ...state.activeRecipe, values: { ...state.values }, mode: state.mode, updatedAt: Date.now() };
    await storeActive(updated);
    if (state.editing) stopEditing();
    closeSheet();
    toast('Saved');
    return;
  }
  await saveRecipeAs();
}

async function saveRecipeAs() {
  const initial = state.activeRecipe ? `${state.activeRecipe.name} copy` : (state.draftName ?? '');
  closeSheet();
  const name = await promptName({ title: 'Save recipe', initial, okLabel: 'Save' });
  if (name === null) return;
  await saveCurrentAs(name);
}

async function renameRecipe() {
  const active = state.activeRecipe;
  if (!active) return;
  closeSheet();
  const name = await promptName({ title: 'Rename recipe', initial: active.name, okLabel: 'Rename' });
  if (name === null || name === active.name) return;
  const clash = await store.findByName(name);
  if (clash && clash.id !== active.id) {
    toast('A recipe with that name already exists');
    return;
  }
  await storeActive({ ...active, name, updatedAt: Date.now() });
  toast('Renamed');
}

async function deleteRecipe() {
  const active = state.activeRecipe;
  if (!active) return;
  const ok = await confirmDialog({
    title: `Delete “${active.name}”?`,
    message: 'The current values stay in the calculator. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true
  });
  if (!ok) return;
  detachRecipe();
  await store.remove(active.id);
  closeSheet();
  toast('Deleted');
}

async function loadRecipe(id) {
  const recipe = state.recipes.find((r) => r.id === id) ?? await store.get(id);
  if (!recipe) return;
  if (recipe.id !== state.activeRecipeId && !(await confirmDiscard())) return;
  loadValues(recipe.values, recipe.mode, recipe);
  hideShareBanner();
  closeSheet();
}

async function newRecipe() {
  if (!(await confirmDiscard())) return;
  loadValues(DEFAULT_VALUES, 'batch', null);
  hideShareBanner();
  closeSheet();
}

// --- share, copy, bundles -------------------------------------------------------

function baseUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function shareRecipe() {
  if (!state.validation.valid) return;
  const url = buildShareUrl(baseUrl(), { name: currentName(), values: shownValues(), mode: state.mode });
  const data = { title: `${currentName()} · Rise`, text: 'Sourdough recipe from Rise', url };
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  if (await copyText(url)) {
    toast('Link copied');
    return;
  }
  await confirmDialog({ title: 'Share link', message: url, confirmLabel: 'Done', danger: false, selectable: true, hideCancel: true });
}

let copyResetTimer = null;
async function copyRecipe() {
  if (!state.validation.valid) return;
  const text = formatRecipeText({ name: currentName(), values: shownValues(), mode: state.mode }, state.result);
  if (!(await copyText(text))) {
    toast('Copy is not available here');
    return;
  }
  const use = els.copy.querySelector('use');
  els.copyLabel.textContent = 'Copied';
  use.setAttribute('href', '#i-check');
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    els.copyLabel.textContent = 'Copy';
    use.setAttribute('href', '#i-copy');
  }, 1500);
}

function hideShareBanner() {
  els.banner.hidden = true;
  state.pendingShare = null;
}

function stripHash() {
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

async function handleShareHash() {
  const parsed = parseShareHash(window.location.hash);
  if (!parsed) return;
  // Strip the hash so reloads and re-shares never re-trigger the banner.
  stripHash();
  if (!parsed.ok) {
    toast('This link is not a valid Rise recipe');
    return;
  }
  state.pendingShare = parsed.recipe;
  els.bannerText.textContent = `“${parsed.recipe.name}” was shared with you.`;
  els.shareOpen.hidden = false;
  els.shareSave.hidden = true;
  els.banner.hidden = false;
  if (!currentlyDirty()) openSharedRecipe();
}

function openSharedRecipe() {
  const shared = state.pendingShare;
  if (!shared) return;
  loadValues(shared.values, shared.mode, null, shared.name);
  els.shareOpen.hidden = true;
  els.shareSave.hidden = false;
}

// A whole library arriving from the old origin: add what is new or newer.
async function handleBundleHash() {
  const parsed = parseBundleHash(window.location.hash);
  if (!parsed) return;
  stripHash();
  if (!parsed.ok) {
    toast('This link is not a valid Rise export');
    return;
  }
  const count = parsed.recipes.length;
  const ok = await confirmDialog({
    title: `Add ${count} recipe${count === 1 ? '' : 's'}?`,
    message: 'They come from your previous Rise app. Recipes you already have with newer changes are kept as they are.',
    confirmLabel: 'Add',
    danger: false
  });
  if (!ok) return;
  const existing = new Map((await store.all()).map((r) => [r.id, r]));
  let added = 0;
  for (const record of parsed.recipes) {
    const mine = existing.get(record.id);
    if (mine && mine.updatedAt >= record.updatedAt) continue;
    await store.put(record);
    added += 1;
  }
  toast(added ? `Added ${added} recipe${added === 1 ? '' : 's'}` : 'Nothing new to add');
}

async function exportToNewHome() {
  const records = await store.list();
  const url = records.length ? buildBundleUrl(NEW_HOME_URL, records) : NEW_HOME_URL;
  window.location.assign(url);
}

// --- cloud sync -----------------------------------------------------------------

async function startCloud() {
  cloud = await initCloud({
    localStore,
    onUser: (user, cloudStore) => {
      store = user && cloudStore ? cloudStore : localStore;
      renderAccount(user);
    },
    onError: (message) => toast(message)
  });
  if (!cloud) return;
  els.menuSignin.hidden = false;
}

async function signIn() {
  closeMenu();
  if (!cloud) return;
  try {
    await cloud.signIn();
  } catch (err) {
    const message = authMessage(err);
    if (message) toast(message);
  }
}

async function signOut() {
  closeMenu();
  if (!cloud) return;
  await cloud.signOut();
  toast('Signed out. Your recipes stay on this device.');
}

// --- theme --------------------------------------------------------------------

function applyTheme(value) {
  const html = document.documentElement;
  if (value === 'light' || value === 'dark') {
    html.dataset.theme = value;
    html.style.colorScheme = value;
  } else {
    delete html.dataset.theme;
    html.style.colorScheme = '';
  }
  updateThemeColor();
}

function updateThemeColor() {
  const forced = document.documentElement.dataset.theme;
  const dark = forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const color = dark ? THEME_COLORS.dark : THEME_COLORS.light;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', color);
}

function initTheme() {
  let stored = null;
  try { stored = storage.getItem(THEME_KEY); } catch { /* ignore */ }
  const value = stored === 'light' || stored === 'dark' ? stored : 'system';
  const radio = document.querySelector(`input[name="theme"][value="${value}"]`);
  if (radio) radio.checked = true;
  applyTheme(value);

  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      applyTheme(input.value);
      try {
        if (input.value === 'system') storage.removeItem(THEME_KEY);
        else storage.setItem(THEME_KEY, input.value);
      } catch { /* best effort */ }
    });
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);
}

// Browsers without the Popover API get a plain toggle with outside-click close.
function initMenuFallback() {
  if ('popover' in HTMLElement.prototype) return;
  els.menuBtn.removeAttribute('popovertarget');
  const close = () => els.menu.classList.remove('is-open');
  els.menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.menu.classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!els.menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function closeMenu() {
  if (typeof els.menu.hidePopover === 'function') {
    try { els.menu.hidePopover(); } catch { /* not open */ }
  }
  els.menu.classList.remove('is-open');
}

// --- keep screen on -------------------------------------------------------------

function initWakeLock() {
  if (!('wakeLock' in navigator)) return;
  els.wake.hidden = false;
  let lock = null;
  let wanted = false;
  const render = () => els.wake.setAttribute('aria-pressed', String(wanted));

  async function request() {
    try {
      lock = await navigator.wakeLock.request('screen');
      // The system can release the lock (tab hidden, battery saver); keep the
      // button honest if that happens while the page is visible.
      lock.addEventListener('release', () => {
        lock = null;
        if (!document.hidden) {
          wanted = false;
          render();
        }
      });
    } catch {
      wanted = false;
      render();
      toast('Could not keep the screen on');
    }
  }

  async function release() {
    const current = lock;
    lock = null;
    if (!current) return;
    try { await current.release(); } catch { /* already released */ }
  }

  els.wake.addEventListener('click', () => {
    wanted = !wanted;
    render();
    if (wanted) request();
    else release();
  });

  // Re-acquire after the page comes back into view.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && wanted && lock === null) request();
  });
}

// --- service worker and updates ---------------------------------------------------

function workerVersion() {
  return new Promise((resolve) => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && e.data.version ? e.data.version : null);
    };
    controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let refreshing = false;
  let autoApply = false;

  const apply = (reg) => {
    if (!reg.waiting) return;
    refreshing = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  const offer = (reg) => {
    if (!reg.waiting || !navigator.serviceWorker.controller) return;
    if (autoApply) {
      apply(reg);
      return;
    }
    els.pill.hidden = false;
    els.pillText.textContent = 'Update ready';
    els.pillReload.onclick = () => {
      els.pillReload.disabled = true;
      apply(reg);
    };
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) window.location.reload();
  });

  try {
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    offer(reg);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer(reg);
      });
    });

    // If this page and the controlling worker come from different releases,
    // apply the pending update without asking: the page is already inconsistent.
    if (navigator.serviceWorker.controller) {
      const version = await workerVersion();
      if (version && APP_VERSION && version !== APP_VERSION) {
        autoApply = true;
        offer(reg);
        reg.update().catch(() => {});
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
    setInterval(() => reg.update().catch(() => {}), 6 * 60 * 60 * 1000);
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

// --- events -------------------------------------------------------------------

function wireEvents() {
  els.form.addEventListener('submit', (e) => e.preventDefault());

  els.form.addEventListener('input', (e) => {
    const field = e.target && e.target.dataset ? e.target.dataset.field : null;
    if (field) onFieldInput(field, e.target.value);
  });

  els.form.addEventListener('focusout', (e) => {
    const field = e.target && e.target.dataset ? e.target.dataset.field : null;
    if (field) touch(field);
  });

  els.form.addEventListener('focusin', (e) => {
    if (e.target && e.target.matches && e.target.matches('input[data-field]')) e.target.select();
  });

  // Enter moves to the next visible field; on the last one it just closes the keyboard.
  els.form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('input[data-field]')) return;
    e.preventDefault();
    const visible = [...els.form.querySelectorAll('input[data-field]')].filter((i) => i.offsetParent !== null);
    const next = visible[visible.indexOf(e.target) + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      e.target.blur();
    }
  });

  els.form.addEventListener('change', (e) => {
    if (e.target && e.target.name === 'mode' && e.target.checked) applyMode(e.target.value, { persist: true });
  });

  els.edit.addEventListener('click', startEditing);
  els.editCancel.addEventListener('click', cancelEditing);
  els.editDone.addEventListener('click', stopEditing);
  els.editSave.addEventListener('click', saveRecipe);

  els.batchScale.addEventListener('click', openScaleDialog);
  els.batchReset.addEventListener('click', () => setScale(null));
  els.scaleCancel.addEventListener('click', () => els.scaleDialog.close('cancel'));
  els.scaleForm.addEventListener('submit', (e) => {
    if (!(e.submitter && e.submitter.value === 'ok')) return;
    const scale = readScaleDialog();
    if (scale) {
      // Choosing the recipe's own size again simply removes the scale.
      setScale(sameSize(scale, state.values) ? null : scale);
      return;
    }
    e.preventDefault();
    const invalid = Object.values(scaleFields).find((el) => el.wrapper.classList.contains('is-invalid'));
    if (invalid) invalid.input.focus();
  });

  els.chip.addEventListener('click', openSheet);
  els.sheetClose.addEventListener('click', closeSheet);
  els.sheet.addEventListener('click', (e) => {
    if (e.target === els.sheet) closeSheet();
  });
  els.sheet.addEventListener('close', () => {
    document.documentElement.classList.remove('is-locked');
  });

  els.list.addEventListener('click', (e) => {
    const button = e.target.closest ? e.target.closest('button.recipe-item[data-id]') : null;
    if (button) loadRecipe(button.dataset.id);
  });

  els.save.addEventListener('click', saveRecipe);
  els.saveAs.addEventListener('click', saveRecipeAs);
  els.rename.addEventListener('click', renameRecipe);
  els.del.addEventListener('click', deleteRecipe);
  els.newBtn.addEventListener('click', newRecipe);

  els.nameForm.addEventListener('submit', (e) => {
    const okPressed = e.submitter && e.submitter.value === 'ok';
    if (okPressed && cleanName(els.nameInput.value, '') === '') {
      e.preventDefault();
      els.nameError.textContent = 'Enter a name';
      els.nameInput.closest('.field').classList.add('is-invalid');
      els.nameInput.focus();
    }
  });
  els.nameCancel.addEventListener('click', () => els.nameDialog.close('cancel'));
  els.confirmCancel.addEventListener('click', () => els.confirmDialog.close('cancel'));
  els.nameInput.addEventListener('input', () => {
    els.nameError.textContent = '';
    els.nameInput.closest('.field').classList.remove('is-invalid');
  });

  els.copy.addEventListener('click', copyRecipe);
  els.share.addEventListener('click', shareRecipe);

  els.shareOpen.addEventListener('click', async () => {
    if (!(await confirmDiscard())) return;
    openSharedRecipe();
  });
  els.shareSave.addEventListener('click', async () => {
    const shared = state.pendingShare;
    if (!shared) return;
    const name = await promptName({ title: 'Save recipe', initial: shared.name, okLabel: 'Save' });
    if (name === null) return;
    if (await saveCurrentAs(name)) hideShareBanner();
  });
  els.shareDismiss.addEventListener('click', hideShareBanner);
  window.addEventListener('hashchange', () => {
    handleShareHash();
    handleBundleHash();
  });

  els.movedExport.addEventListener('click', exportToNewHome);
  els.movedDismiss.addEventListener('click', () => {
    try { storage.setItem(MOVED_DISMISSED_KEY, '1'); } catch { /* ignore */ }
    els.movedBanner.hidden = true;
  });

  els.menuSignin.addEventListener('click', signIn);
  els.menuSignout.addEventListener('click', signOut);

  els.print.addEventListener('click', () => {
    closeMenu();
    window.print();
  });

  // Another tab changed the library.
  window.addEventListener('storage', (e) => {
    if (e.key === RECIPES_KEY && localStore) localStore.reload();
  });
}
