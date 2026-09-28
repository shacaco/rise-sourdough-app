// Firebase sync layer. The Firebase SDK is loaded only when firebase-config.js
// exists, so the app works exactly as before without it.
//
// Model: the local store stays the source of truth for the UI. When signed in,
// writes go to the local store and to Firestore, and server-confirmed snapshots
// are merged back into the local store (newest updatedAt wins, tombstones
// included). Firestore's offline persistence queues writes while offline.
import { planMerge } from './recipes.js';
import { sanitizeValues, cleanName } from './validation.js';

export const FIREBASE_SDK_VERSION = '12.19.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
const BATCH_LIMIT = 450;

function normalizeMode(mode) {
  return mode === 'unit' ? 'unit' : 'batch';
}

// Firestore document -> local record. Tolerant of missing or odd fields.
export function fromDoc(id, data) {
  if (!data || typeof data !== 'object') return null;
  const record = {
    id,
    name: cleanName(data.name),
    values: sanitizeValues(data.values),
    mode: normalizeMode(data.mode),
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || 0
  };
  if (data.deleted === true) record.deleted = true;
  return record;
}

// Local record -> Firestore document. Exactly the keys the security rules allow.
export function toDoc(record) {
  const doc = {
    name: record.name,
    values: { ...record.values },
    mode: record.mode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
  if (record.deleted) doc.deleted = true;
  return doc;
}

export function isStandalone() {
  return navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

export function authMessage(err) {
  const code = err && err.code;
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/unauthorized-domain':
      return 'This site is not authorised for sign-in';
    case 'auth/network-request-failed':
      return 'No connection. Try again when you are online';
    case 'rise/standalone-not-supported':
      return 'Open Rise in Safari to sign in';
    default:
      return 'Sign-in failed';
  }
}

async function loadConfig() {
  try {
    const mod = await import('./firebase-config.js');
    const config = mod.firebaseConfig;
    if (!config || !config.apiKey || !config.projectId || /YOUR_/.test(config.apiKey)) return null;
    return config;
  } catch {
    return null;
  }
}

// Returns null when there is no config (feature hidden), otherwise
// { signIn, signOut, user, store } and calls onUser(user, store) on every
// auth change. `store` implements the same interface as the local store.
export async function initCloud({ localStore, onUser, onError }) {
  const config = await loadConfig();
  if (!config) return null;

  // On Firebase Hosting the auth helper is same-origin, which is what makes
  // sign-in work inside an installed iOS app. Elsewhere use the project's
  // default auth domain (popup flow).
  const host = window.location.hostname;
  const firstParty = host.endsWith('.web.app') || host.endsWith('.firebaseapp.com');
  const authDomain = firstParty ? host : `${config.projectId}.firebaseapp.com`;

  let sdk;
  try {
    const [appMod, authMod, firestoreMod] = await Promise.all([
      import(`${CDN}firebase-app.js`),
      import(`${CDN}firebase-auth.js`),
      import(`${CDN}firebase-firestore.js`)
    ]);
    sdk = { ...appMod, ...authMod, ...firestoreMod };
  } catch {
    onError?.('Could not load the sync service');
    return null;
  }

  const app = sdk.initializeApp({ ...config, authDomain });
  const auth = sdk.getAuth(app);
  let db;
  try {
    db = sdk.initializeFirestore(app, {
      localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() })
    });
  } catch {
    // Persistence unavailable (e.g. private mode): memory cache still syncs while online.
    db = sdk.getFirestore(app);
  }

  let user = null;
  let store = null;
  let unsubscribeSnapshot = null;
  let reportedSyncError = false;

  const recipesRef = (uid) => sdk.collection(db, 'users', uid, 'recipes');
  const docRef = (uid, id) => sdk.doc(db, 'users', uid, 'recipes', id);

  function reportSyncError(err) {
    // A stale queued write is rejected by the rules on purpose; the snapshot
    // brings the newer version. Anything else is worth one toast per session.
    if (err && err.code === 'permission-denied') return;
    if (reportedSyncError) return;
    reportedSyncError = true;
    onError?.('Could not sync with the cloud');
  }

  async function writeMany(uid, records) {
    for (let i = 0; i < records.length; i += BATCH_LIMIT) {
      const batch = sdk.writeBatch(db);
      for (const record of records.slice(i, i + BATCH_LIMIT)) {
        batch.set(docRef(uid, record.id), toDoc(record));
      }
      await batch.commit();
    }
  }

  // Merge a server-confirmed snapshot with the local library, both ways.
  async function applySnapshot(uid, snapshot) {
    if (snapshot.metadata.fromCache) return;
    const cloudAll = snapshot.docs.map((d) => fromDoc(d.id, d.data())).filter(Boolean);
    const localAll = await localStore.all();
    const { toCloud, toLocal } = planMerge(localAll, cloudAll);
    for (const record of toLocal) await localStore.put(record);
    if (toCloud.length) {
      try {
        await writeMany(uid, toCloud);
      } catch (err) {
        reportSyncError(err);
      }
    }
  }

  function makeStore(uid) {
    return {
      get persistFailed() {
        return localStore.persistFailed;
      },
      list: () => localStore.list(),
      all: () => localStore.all(),
      get: (id) => localStore.get(id),
      findByName: (name) => localStore.findByName(name),
      subscribe: (fn) => localStore.subscribe(fn),
      reload: () => localStore.reload(),
      async put(record) {
        const stored = await localStore.put(record);
        sdk.setDoc(docRef(uid, stored.id), toDoc(stored)).catch(reportSyncError);
        return stored;
      },
      async remove(id) {
        await localStore.remove(id);
        const tombstone = (await localStore.all()).find((r) => r.id === id);
        if (tombstone) sdk.setDoc(docRef(uid, id), toDoc(tombstone)).catch(reportSyncError);
      }
    };
  }

  function stopSnapshot() {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
  }

  sdk.onAuthStateChanged(auth, (nextUser) => {
    stopSnapshot();
    user = nextUser;
    store = user ? makeStore(user.uid) : null;
    if (user) {
      unsubscribeSnapshot = sdk.onSnapshot(
        recipesRef(user.uid),
        (snapshot) => { applySnapshot(user.uid, snapshot).catch(reportSyncError); },
        (err) => reportSyncError(err)
      );
    }
    onUser?.(user, store);
  });

  // Completes a redirect sign-in started on the previous page load.
  sdk.getRedirectResult(auth).catch((err) => {
    const message = authMessage(err);
    if (message) onError?.(message);
  });

  async function signIn() {
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    if (isStandalone()) {
      if (!firstParty) {
        const err = new Error('Sign-in needs a first-party auth domain in standalone mode');
        err.code = 'rise/standalone-not-supported';
        throw err;
      }
      await sdk.signInWithRedirect(auth, provider);
      return;
    }
    try {
      await sdk.signInWithPopup(auth, provider);
    } catch (err) {
      const code = err && err.code;
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await sdk.signInWithRedirect(auth, provider);
        return;
      }
      throw err;
    }
  }

  async function signOut() {
    stopSnapshot();
    await sdk.signOut(auth);
  }

  return {
    signIn,
    signOut,
    get user() {
      return user;
    },
    get store() {
      return store;
    }
  };
}
