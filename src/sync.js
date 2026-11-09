// Rata & Smudge — live sync between her iPad and other devices (Firebase Auth + Firestore).
// Adapted from Family Screen's sync.js: households → businesses, plus roles and an offline "will sync" marker.
// The UI keeps one in-memory state object S. This module fills S from the business's documents,
// keeps it up to date in real time, and writes back whatever the UI changes (only changed records are sent).
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,  signOut as fbSignOut, connectAuthEmulator, signInWithCredential, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, doc, collection,
  onSnapshot, query, where, getDocs, addDoc, writeBatch, serverTimestamp, updateDoc, arrayUnion, arrayRemove, deleteField, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

// every sub-collection the rules allow, and which ones each role may read
export const COLS = ['inputs', 'recipes', 'products', 'deals', 'sessions', 'sales', 'batches', 'orders', 'todos', 'pins', 'audit', 'receipts', 'contacts',
  'places', 'events', 'plans', 'ideas', 'costs', 'prices', 'fuel', 'stockmoves', 'shopping', 'voicenotes', 'pay'];
const OWNER_ONLY = ['recipes', 'pay'];                                     // recipes are the business's secret; pay is private
const HELPER_COLS = ['products', 'deals', 'sessions', 'sales', 'places', 'events', 'plans', 'stockmoves', 'shopping', 'todos', 'voicenotes'];
const MINE_ONLY = { todos: 'who', voicenotes: 'by' };                       // a helper sees only their own of these
// managers see recipes (and costs worked out from them) only when an owner switches that on; pay stays owners-only
export const readableCols = (role, mgrCosts) => role === 'helper' ? HELPER_COLS.slice() : role === 'manager' ? COLS.filter(c => !OWNER_ONLY.includes(c) || (mgrCosts && c === 'recipes')) : COLS.slice();
// sales and sessions grow forever: phase 3 will listen to recent ones only. Until then, listen to all.

let app, auth, db, bid = null, unsub = [], S = null, onChange = () => {}, synced = null, user = null;
let members = [], owners = [], mainOwner = null, roles = {}, redirectError = null, redirectP = Promise.resolve(), pending = {}, onPending = () => {};

const clean = o => JSON.parse(JSON.stringify(o));                 // drops undefined + functions

// keep object identity stable so open screens keep editing the live object
function mergeArray(target, incoming) {
  const byId = new Map(target.map(x => [x.id, x]));
  const out = incoming.map(n => {
    const ex = byId.get(n.id);
    if (!ex) return n;
    for (const k of Object.keys(ex)) if (!(k in n)) delete ex[k];
    return Object.assign(ex, n);
  });
  target.length = 0; out.forEach(x => target.push(x));
}

// iPad/iPhone (iPadOS reports itself as a Mac with a touch screen)
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function init(config, opts = {}) {
  const cfg = Object.assign({}, config);
  // iPad lesson: Safari blocks sign-in across two sites, so sign in through the app's own address.
  // Firebase Hosting serves the sign-in pages (/__/auth/) on every hosting address.
  if (/\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) cfg.authDomain = location.hostname;
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), ignoreUndefinedProperties: true });
  if (opts.emulator) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8080); }
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  redirectP = getRedirectResult(auth).catch(e => { redirectError = e; });   // shown on the sign-in screen, never swallowed
}
export const afterRedirect = () => redirectP;
export const takeRedirectError = () => { const e = redirectError; redirectError = null; return e; };
export function watchAuth(cb) { return onAuthStateChanged(auth, u => { user = u; cb(u); }); }
export async function signIn() {
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  if (isIOS()) return signInWithRedirect(auth, p);                 // pop-ups are unreliable in an iPad home-screen app
  try { await signInWithPopup(auth, p); }
  catch (e) { if (e && /popup-blocked|operation-not-supported|cancelled-popup/.test(e.code || '')) return signInWithRedirect(auth, p); throw e; }
}
export async function testSignIn(email) { // emulator and mock only
  const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true }));
  await signInWithCredential(auth, cred);
}
export function signOut() { stop(); return fbSignOut(auth); }
// practice mode ("View as"): the app behaves as another person or role, nothing is sent to the cloud,
// and leaving it reloads the app from the cloud, so everything done in practice is thrown away
let asMe = null, asRole = null, readOnly = false;
export const inPractice = () => readOnly;
export const me = () => asMe || (user && user.email && user.email.toLowerCase());
// when this account last signed in with Google (used to reset a forgotten PIN by signing in again)
export const lastSignIn = () => { try { return Date.parse(user.metadata.lastSignInTime) || 0; } catch (e) { return 0; } };

/* ---------- finding, creating and joining a business ---------- */
export async function findBusiness() {
  const r = await getDocs(query(collection(db, 'businesses'), where('members', 'array-contains', me())));
  return r.empty ? null : r.docs[0].id;
}
// a new business starts EMPTY: no products, recipes or sales. Never seed real data here.
export async function createBusiness(name) {
  const d = await addDoc(collection(db, 'businesses'), {
    name: String(name || '').trim() || 'My business',
    settings: { tz: 'Pacific/Auckland', gst: true, pricesIncludeGst: true, gstRate: 0.15, payments: ['cash', 'eftpos', 'other'],
      channels: ['market', 'farmgate', 'tour', 'shop', 'online', 'wholesale'], overheads: [], pinHash: '', staff: [] },
    members: [me()], owner: me(), owners: [me()], roles: {}, created: serverTimestamp()
  });
  return d.id;
}
export const getMembers = () => members.slice();
export const getOwners = () => owners.slice();
export const getMainOwner = () => mainOwner;   // created the business; can never be removed or demoted
export const roleOf = email => !email ? null : owners.includes(email) ? 'owner' : (roles[email] || 'helper');
export const myRole = () => asRole || roleOf(me());
export function startPractice(email, role) {
  const keepBid = bid; stop(); bid = keepBid; readOnly = true; asMe = email || ('practice-' + role + '@example.invalid'); asRole = role;
  const allowed = readableCols(role, !!(S.settings && S.settings.mgrCosts));
  for (const c of COLS) {
    if (!allowed.includes(c)) { S[c].length = 0; continue; }
    if (role === 'helper' && MINE_ONLY[c]) { const keep = S[c].filter(x => x[MINE_ONLY[c]] === asMe); S[c].length = 0; keep.forEach(x => S[c].push(x)); }
  }
}
// One write sets a person's role: owners go in the "owners" list, everyone else in the roles map.
// Emails contain dots, so the lists and the map are always written whole rather than by field path.
// The main owner can never be changed or removed, and there are at most 2 owners (the rules enforce both).
function peopleWith(email, role) {
  const e = email.trim().toLowerCase(), r = Object.assign({}, roles); let o = owners.filter(x => x !== e);
  if (e === mainOwner) { const err = new Error('The main owner can never be changed or removed.'); err.code = 'main-owner'; throw err; }
  delete r[e];
  if (role === 'owner') o.push(e); else if (role) r[e] = role === 'manager' ? 'manager' : 'helper';
  if (o.length > 2) { const err = new Error('A business can have at most 2 owners.'); err.code = 'too-many-owners'; throw err; }
  return { owners: o, roles: r };
}
export const addMember = (email, role) => { if (readOnly) return Promise.resolve(); const e = email.trim().toLowerCase(); return updateDoc(doc(db, 'businesses', bid), Object.assign({ members: arrayUnion(e) }, peopleWith(e, role))); };
export const setRole = (email, role) => readOnly ? Promise.resolve() : updateDoc(doc(db, 'businesses', bid), peopleWith(email, role));
// Hand the main owner role to the co-owner. Only the main owner can do this (the rules enforce it);
// afterwards the old main owner is co-owner and the new main owner can never be removed by anyone else.
export const handOver = email => { if (readOnly) return Promise.resolve();
  if (me() !== mainOwner) { const e = new Error('Only the main owner can hand the business over.'); e.code = 'not-main-owner'; return Promise.reject(e); }
  if (!owners.includes(email)) { const e = new Error('Make them co-owner first.'); e.code = 'not-co-owner'; return Promise.reject(e); }
  return updateDoc(doc(db, 'businesses', bid), { owner: email });
};
export const removeMember = email => readOnly ? Promise.resolve() : updateDoc(doc(db, 'businesses', bid), Object.assign({ members: arrayRemove(email) }, peopleWith(email, null)));

/* ---------- live data ---------- */
function markPending(key, v) { if (!!pending[key] === v) return; pending[key] = v; onPending(Object.values(pending).some(Boolean)); }
export const onPendingChange = cb => { onPending = cb; };

export function start(businessId, state, changed) {
  stop(); bid = businessId; S = state; onChange = changed; pending = {};
  synced = { biz: null, cols: Object.fromEntries(COLS.map(c => [c, new Map()])) };
  let first = true;
  unsub.push(onSnapshot(doc(db, 'businesses', bid), { includeMetadataChanges: true }, snap => {
    markPending('biz', snap.metadata.hasPendingWrites);
    if (!snap.exists()) return;
    const d = snap.data(); members = d.members || []; owners = d.owners || []; mainOwner = d.owner || null; roles = d.roles || {};
    S.name = d.name || ''; S.settings = Object.assign(S.settings || {}, d.settings || {});
    S.receiptHelper = d.receiptHelper || null;
    S.aiUsage = d.aiUsage || null;
    S.helperSeen = d.helperSeen || null;
    S.shopifyHelper = d.shopifyHelper || null;     // written by the helper: last Shopify check                // written by the helper: voice notes worked out this month   // written by the Google helper script: last run, account, errors
    synced.biz = JSON.stringify(bizOf(S));
    onChange('business');
    if (first) { first = false; listenCols(); }                   // the role decides which collections we may read
  }, err => onChange('error', err)));
}
function listenCols() {
  const role = myRole(), allowed = readableCols(role, !!(S.settings && S.settings.mgrCosts));
  for (const c of allowed) {
    const ref = role === 'helper' && MINE_ONLY[c] ? query(collection(db, 'businesses', bid, c), where(MINE_ONLY[c], '==', me())) : collection(db, 'businesses', bid, c);
    unsub.push(onSnapshot(ref, { includeMetadataChanges: true }, snap => {
      markPending(c, snap.metadata.hasPendingWrites);
      const list = snap.docs.map(x => Object.assign({ id: x.id }, x.data()));
      mergeArray(S[c], list);
      const m = synced.cols[c]; m.clear(); S[c].forEach(x => m.set(x.id, JSON.stringify(clean(x))));
      onChange(c);
    }, err => onChange('colerror', { col: c, err })));   // one collection refused must not lock out the whole business
  }
}
export function stop() { unsub.forEach(u => { try { u(); } catch (e) {} }); unsub = []; bid = null; }
const bizOf = s => clean({ name: s.name || '', settings: s.settings || {} });

// Write whatever changed since the last sync. Called after every edit; cheap when nothing changed.
// Works offline: Firestore keeps the writes on the device and sends them when the signal returns.
export function push() {
  if (readOnly || !bid || !S) return;
  const ops = [];
  if (myRole() !== 'helper') {
    const st = JSON.stringify(bizOf(S));
    if (st !== synced.biz) { ops.push(['update', doc(db, 'businesses', bid), JSON.parse(st)]); synced.biz = st; }
  }
  for (const c of COLS) {
    const m = synced.cols[c], seen = new Set();
    for (const x of S[c]) {
      if (!x.id) continue; seen.add(x.id);
      const body = clean(x); delete body.id;
      const j = JSON.stringify(clean(x));
      if (m.get(x.id) !== j) { ops.push(['set', doc(db, 'businesses', bid, c, x.id), body]); m.set(x.id, j); }
    }
    for (const id of [...m.keys()]) if (!seen.has(id)) { ops.push(['delete', doc(db, 'businesses', bid, c, id)]); m.delete(id); }
  }
  // One batch per kind of record: if the database refuses one kind (e.g. the rules haven't been updated
  // for a new feature), the others, above all the sales, are still saved.
  const groups = {};
  for (const op of ops) { const k = op[1].path.split('/').length > 2 ? op[1].path.split('/')[2] : 'business'; (groups[k] = groups[k] || []).push(op); }
  for (const k of Object.keys(groups)) {
    const list = groups[k];
    for (let i = 0; i < list.length; i += 400) {
      const b = writeBatch(db);
      list.slice(i, i + 400).forEach(([kind, ref, data]) => kind === 'set' ? b.set(ref, data) : kind === 'update' ? b.update(ref, data) : b.delete(ref));
      b.commit().catch(e => onChange(e && e.code === 'permission-denied' && k !== 'business' ? 'colerror' : 'error', k !== 'business' && e && e.code === 'permission-denied' ? { col: k, err: e } : e));
    }
  }
}
export const newId = c => doc(collection(db, 'businesses', bid || 'x', c)).id;

/* ---------- invite-only: who may start a new business ---------- */
// admins are documents admins/{email}, made by hand in the Firebase console (see the README)
let adminCache = null;
export async function isAdmin() {
  if (adminCache && adminCache.who === me()) return adminCache.yes;
  let yes = false; try { yes = (await getDoc(doc(db, 'admins', me()))).exists(); } catch (e) {}
  adminCache = { who: me(), yes }; return yes;
}
export async function isInvited() {
  if (await isAdmin()) return true;
  try { const d = await getDoc(doc(db, 'invites', me())); return d.exists(); } catch (e) { return false; }
}
export async function listInvites() { const r = await getDocs(collection(db, 'invites')); return r.docs.map(d => Object.assign({ email: d.id }, d.data())); }
export const addInvite = email => readOnly ? Promise.resolve() : setDoc(doc(db, 'invites', email.trim().toLowerCase()), { by: me(), at: Date.now() });
export const removeInvite = email => readOnly ? Promise.resolve() : deleteDoc(doc(db, 'invites', email));
export async function useInvite() { try { await deleteDoc(doc(db, 'invites', me())); } catch (e) {} }

/* ---------- a business's own data: download and delete ---------- */
export async function exportBusiness() {
  const out = { exported: new Date().toISOString() };
  const h = await getDoc(doc(db, 'businesses', bid)); out.business = h.data();
  for (const c of COLS) { const r = await getDocs(collection(db, 'businesses', bid, c)); out[c] = r.docs.map(d => Object.assign({ id: d.id }, d.data())); }
  return out;
}
export async function deleteBusiness() {
  if (readOnly) return;
  const id = bid;
  for (const c of COLS) { const r = await getDocs(collection(db, 'businesses', id, c)); for (let i = 0; i < r.docs.length; i += 400) { const b = writeBatch(db); r.docs.slice(i, i + 400).forEach(d => b.delete(d.ref || doc(db, 'businesses', id, c, d.id))); await b.commit(); } }
  stop(); await deleteDoc(doc(db, 'businesses', id));
}

export const businessId = () => bid;

// ---- notifications: this person's devices (one document per person; only they can read or change it)
export async function pushSupported() { try { return await isSupported(); } catch (e) { return false; } }
export async function pushToken(vapidKey, reg) { return getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg }); }
export async function getMyDevices() { const d = await getDoc(doc(db, 'businesses', bid, 'devices', me())); return d.exists() ? d.data() : { tokens: {}, prefs: {} }; }
export const saveMyDevices = data => readOnly ? Promise.resolve() : setDoc(doc(db, 'businesses', bid, 'devices', me()), data);
