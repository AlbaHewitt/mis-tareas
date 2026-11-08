import { firebaseConfig } from './config.js';
import { parseQuick, fold } from './parse.js';
import { toICS, googleURL } from './cal.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLORS = ['violeta', 'naranja', 'verde', 'azul', 'gris', 'rosa', 'rojo', 'amarillo', 'turquesa', 'marron'];
const DEFAULT_CATS = [
  { id: 'evento', name: 'Evento', color: 'violeta' }, { id: 'entreno', name: 'Entreno', color: 'naranja' },
  { id: 'casa', name: 'Casa', color: 'verde' }, { id: 'estudio', name: 'Estudio', color: 'azul' },
  { id: 'trabajo', name: 'Trabajo', color: 'gris' }, { id: 'personal', name: 'Personal', color: 'rosa' },
];
const NO_CAT = { id: '', name: 'Sin categoría', color: 'gris' };
const VIEWS = { hoy: 'Hoy', semana: 'Agenda', habitos: 'Hábitos', proximas: 'Próximas', sinfecha: 'Sin fecha', hechas: 'Progreso' };
const DEFAULT_RATO = { budgets: { 0: 60, 1: 45, 2: 45, 3: 45, 4: 45, 5: 45, 6: 60 }, extra: { date: '', min: 0 }, log: {} };
const LOOKAHEAD = 8;
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };
const TICK = c => `<svg viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>`;
const $ = s => document.querySelector(s);

let tasks = [];
let cats = DEFAULT_CATS;
let loaded = false;
let view = 'hoy';
let catFilter = null;
let query = '';
let editingId = null;
let formCat = 'personal';
let formDays = [];
let formSubs = [];
let weekOffset = 0;
let rato = structuredClone(DEFAULT_RATO);
let habits = [];
let stats = { goal: 100, days: {} };
let agendaMode = 'semana';
const expanded = new Set();

// ---------- Que no parezca una web ----------
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, .code')) e.preventDefault(); });

// ---------- Utilidades ----------
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); }
function addMonths(iso, n) {
  const d = parseISO(iso), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return isoDate(d);
}
function nextDate(t) {
  let d = t.date || todayISO();
  const days = Array.isArray(t.days) && t.days.length ? t.days : null;
  const step = x => t.repeat === 'diario' ? addDays(x, 1) : t.repeat === 'mensual' ? addMonths(x, 1)
    : t.repeat === 'dias' && days ? (() => { let y = x; do { y = addDays(y, 1); } while (!days.includes(parseISO(y).getDay())); return y; })()
    : addDays(x, 7);
  do { d = step(d); } while (d <= todayISO());
  return d;
}
function friendlyDate(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoy';
  if (iso === addDays(t, 1)) return 'Mañana';
  if (iso === addDays(t, -1)) return 'Ayer';
  const d = parseISO(iso);
  const o = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  const s = d.toLocaleDateString('es-ES', o);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const repeatLabel = t => t.repeat === 'diario' ? 'Cada día' : t.repeat === 'semanal' ? 'Cada semana' : t.repeat === 'mensual' ? 'Cada mes'
  : t.repeat === 'dias' ? DAY_ORDER.filter(d => (t.days || []).includes(d)).map(d => DAY_LETTER[d]).join(' ') : '';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const catOf = id => cats.find(c => c.id === id) || NO_CAT;
const colorVar = c => `var(--k-${COLORS.includes(c) ? c : 'gris'})`;
function clean(t) {
  return {
    title: String(t.title || '').slice(0, 300), cat: String(t.cat ?? 'personal'),
    date: t.date || '', time: t.time || '', prio: t.prio || 'normal', repeat: t.repeat || '',
    days: Array.isArray(t.days) ? t.days.filter(d => d >= 0 && d <= 6) : [],
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter(s => s && s.text).map(s => ({ id: String(s.id || uid()), text: String(s.text).slice(0, 200), done: !!s.done })) : [],
    notes: String(t.notes || ''), done: !!t.done, doneAt: t.doneAt || null, created: t.created || Date.now(), spawned: !!t.spawned,
    remind: t.remind === '' || t.remind === null || t.remind === undefined ? null : Number(t.remind),
    minutes: Number(t.minutes) > 0 ? Math.min(480, Math.round(Number(t.minutes))) : null,
    rota: ['final', 'frecuente', 'una'].includes(t.rota) ? t.rota : '',
    rotaOrder: Number.isFinite(Number(t.rotaOrder)) ? Number(t.rotaOrder) : (t.created || Date.now()),
    last: t.last || '', times: Number(t.times) || 0,
    streak: Number(t.streak) || 0, best: Number(t.best) || 0,
    history: Array.isArray(t.history) ? t.history.filter(d => typeof d === 'string').slice(-120) : [],
    pts: Number(t.pts) || 0, ptsDay: t.ptsDay || '',
  };
}
function cleanHabit(h) {
  const log = {};
  Object.entries(h.log || {}).sort().slice(-400).forEach(([k, v]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(k) && [1, -1].includes(Number(v))) log[k] = Number(v); });
  return {
    name: String(h.name || '').slice(0, 80), kind: h.kind === 'quit' ? 'quit' : 'build',
    freq: h.kind !== 'quit' && h.freq === 'weekly' ? 'weekly' : 'daily',
    target: Math.min(7, Math.max(1, Number(h.target) || 3)),
    minutes: Number(h.minutes) > 0 ? Math.min(240, Math.round(Number(h.minutes))) : 10,
    order: Number(h.order) || Date.now(), log,
  };
}
const normRato = r => ({
  budgets: { ...DEFAULT_RATO.budgets, ...(r?.budgets || {}) },
  extra: r?.extra && typeof r.extra === 'object' ? { date: r.extra.date || '', min: Number(r.extra.min) || 0 } : { date: '', min: 0 },
  log: r?.log && typeof r.log === 'object' ? r.log : {},
});

// ---------- Almacenamiento ----------
const LKEY = 'mis-tareas-v1', LCATS = 'mis-tareas-cats';
const store = {
  fb: null, uid: null, user: null, auth: null, authLib: null,
  ref(...p) { return this.fb.doc(this.fb.db, 'users', this.uid, ...p); },
  async put(t) { if (!this.fb) return saveLocal(); return this.fb.setDoc(this.ref('tasks', t.id), clean(t)); },
  async remove(id) { if (!this.fb) return saveLocal(); return this.fb.deleteDoc(this.ref('tasks', id)); },
  async putMany(list) {
    if (!this.fb) { list.forEach(t => { const i = tasks.findIndex(x => x.id === t.id); if (i >= 0) tasks[i] = t; else tasks.push(t); }); return saveLocal(); }
    for (let i = 0; i < list.length; i += 400) {
      const b = this.fb.writeBatch(this.fb.db);
      list.slice(i, i + 400).forEach(t => b.set(this.ref('tasks', t.id), clean(t)));
      await b.commit();
    }
  },
  async saveCats(list) {
    cats = list;
    if (!this.fb) { try { localStorage.setItem(LCATS, JSON.stringify(list)); } catch {} return; }
    return this.fb.setDoc(this.ref('settings', 'categories'), { list });
  },
  async saveRato() {
    // El registro diario solo guarda los últimos 60 días
    const keep = Object.keys(rato.log).sort().slice(-60);
    rato.log = Object.fromEntries(keep.map(k => [k, rato.log[k]]));
    if (!this.fb) { try { localStorage.setItem(LRATO, JSON.stringify(rato)); } catch {} return; }
    return this.fb.setDoc(this.ref('settings', 'rato'), structuredClone(rato));
  },
};
const LRATO = 'mis-tareas-rato', LHAB = 'mis-tareas-habitos', LSTATS = 'mis-tareas-puntos';
const saveLocalHabits = () => { try { localStorage.setItem(LHAB, JSON.stringify(habits)); } catch {} };
Object.assign(store, {
  async putHabit(h) {
    if (!this.fb) return saveLocalHabits();
    const { id, ...rest } = h; return this.fb.setDoc(this.ref('habits', id), cleanHabit(rest));
  },
  async removeHabit(id) { if (!this.fb) return saveLocalHabits(); return this.fb.deleteDoc(this.ref('habits', id)); },
  async setHabitDay(h, day, val) {
    if (!this.fb) return saveLocalHabits();
    return this.fb.setDoc(this.ref('habits', h.id), { log: { [day]: val === null ? this.fb.deleteField() : val } }, { merge: true });
  },
  async addPoints(n, day) {
    if (!this.fb) { try { localStorage.setItem(LSTATS, JSON.stringify(stats)); } catch {} return; }
    return this.fb.setDoc(this.ref('settings', 'stats'), { days: { [day]: this.fb.increment(n) } }, { merge: true });
  },
  async saveGoal(goal) {
    if (!this.fb) { try { localStorage.setItem(LSTATS, JSON.stringify(stats)); } catch {} return; }
    return this.fb.setDoc(this.ref('settings', 'stats'), { goal }, { merge: true });
  },
});

// ---------- Puntos: 1 punto por minuto (10 si no tiene minutos) ----------
const taskPoints = t => Number(t.minutes) > 0 ? Math.round(Number(t.minutes)) : 10;
const habitPoints = h => Number(h.minutes) > 0 ? Math.round(Number(h.minutes)) : 10;
function addPoints(n, day = todayISO()) {
  if (!n) return;
  stats.days[day] = Math.max(0, (stats.days[day] || 0) + n);
  store.addPoints(n, day).catch(writeFailed);
}
const pointsOn = d => Math.round(stats.days[d] || 0);
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(tasks)); } catch {} }
function setSync(kind, text) { $('#sync').className = 'sync ' + kind; $('#syncText').textContent = text; }
function writeFailed() { setSync('warn', 'No se guardó el último cambio'); }

const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PEGA');

async function initStore() {
  if (!configured) {
    try { tasks = JSON.parse(localStorage.getItem(LKEY)) || []; } catch { tasks = []; }
    try { cats = JSON.parse(localStorage.getItem(LCATS)) || DEFAULT_CATS; } catch {}
    try { rato = normRato(JSON.parse(localStorage.getItem(LRATO))); } catch {}
    try { habits = (JSON.parse(localStorage.getItem(LHAB)) || []).map(h => ({ id: h.id, ...cleanHabit(h) })); } catch {}
    try { stats = { goal: 100, days: {}, ...(JSON.parse(localStorage.getItem(LSTATS)) || {}) }; } catch {}
    loaded = true;
    setSync('warn', 'Solo en este dispositivo');
    $('#accountInfo').textContent = 'La sincronización no está configurada. Las tareas se guardan solo en este dispositivo.';
    document.querySelectorAll('[data-cloud]').forEach(b => b.hidden = true);
    render();
    return;
  }
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  await auth.setPersistence(a, auth.indexedDBLocalPersistence).catch(() => {});
  let db;
  try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch { db = fs.getFirestore(app); }
  store.auth = a; store.authLib = auth;
  let unsubs = [];

  setupLogin(a, auth);
  setupAccount();
  setupSiri();

  auth.onAuthStateChanged(a, user => {
    unsubs.forEach(u => u()); unsubs = [];
    if (!user) {
      store.fb = null; store.user = null; tasks = []; cats = DEFAULT_CATS; rato = structuredClone(DEFAULT_RATO);
      habits = []; stats = { goal: 100, days: {} }; loaded = false;
      $('#login').hidden = false; $('#logoutBtn').hidden = true;
      render(); return;
    }
    $('#login').hidden = true; $('#logoutBtn').hidden = false;
    store.fb = { db, ...fs }; store.uid = user.uid; store.user = user;
    showAccount();
    setSync('', 'Conectando…');
    const slow = setTimeout(() => { if (!loaded) setSync('warn', 'Sin conexión'); }, 10000);
    unsubs.push(fs.onSnapshot(fs.collection(db, 'users', user.uid, 'tasks'), { includeMetadataChanges: true }, snap => {
      tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      loaded = true; clearTimeout(slow);
      if (snap.metadata.fromCache) setSync('warn', 'Sin conexión · se sincroniza al volver');
      else setSync('ok', snap.metadata.hasPendingWrites ? 'Guardando…' : 'Sincronizado');
      adoptSiriTasks();
      render();
    }, () => { clearTimeout(slow); loaded = true; setSync('warn', 'No se pudo sincronizar'); render(); }));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'categories'), snap => {
      const list = snap.exists() ? snap.data().list : null;
      cats = Array.isArray(list) ? list : DEFAULT_CATS;
      render(); if (!$('#catSheet').hidden) renderCatSheet();
    }, () => {}));
    unsubs.push(fs.onSnapshot(fs.collection(db, 'users', user.uid, 'habits'), snap => {
      habits = snap.docs.map(d => ({ id: d.id, ...cleanHabit(d.data()) }));
      render();
    }, () => {}));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'stats'), snap => {
      const d = snap.exists() ? snap.data() : {};
      stats = { goal: Number(d.goal) > 0 ? Number(d.goal) : 100, days: d.days && typeof d.days === 'object' ? d.days : {} };
      render();
    }, () => {}));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'rato'), snap => {
      rato = normRato(snap.exists() ? snap.data() : null);
      render(); if (!$('#ratoSheet').hidden) renderRatoSheet();
    }, () => {}));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'siri'), snap => {
      siriKey = snap.exists() ? snap.data().key : null;
      renderSiri();
    }, () => {}));
  });
  $('#logoutBtn').addEventListener('click', () => { closeSheets(); auth.signOut(a); });
}

// Las tareas que llegan desde Siri traen solo el texto dictado: aquí se interpretan y se completan.
const adopting = new Set();
function adoptSiriTasks() {
  tasks.filter(t => t.siriKey !== undefined && !adopting.has(t.id)).forEach(t => {
    adopting.add(t.id);
    const p = parseQuick(t.title, cats);
    const full = { id: t.id, title: p.title, cat: p.cat || (cats[0]?.id ?? ''), date: p.date ?? todayISO(), time: p.time || '',
      prio: p.prio || 'normal', repeat: p.repeat || '', days: p.days || [], notes: '', done: false, created: Date.now() };
    if (full.repeat === 'dias' && full.days.length) {
      for (let i = 0; i < 7 && !full.days.includes(parseISO(full.date).getDay()); i++) full.date = addDays(full.date, 1);
    }
    Object.keys(t).forEach(k => delete t[k]); Object.assign(t, full);
    store.put(full).catch(writeFailed);
  });
}

function setupLogin(a, auth) {
  const err = m => { $('#loginErr').textContent = m; $('#loginErr').hidden = !m; };
  const creds = () => [$('#email').value.trim(), $('#password').value];
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); err('');
    try { await auth.signInWithEmailAndPassword(a, ...creds()); } catch (x) { err(authMsg(x)); }
  });
  $('#signupBtn').addEventListener('click', async () => {
    err('');
    if (!$('#loginForm').reportValidity()) return;
    try { await auth.createUserWithEmailAndPassword(a, ...creds()); } catch (x) { err(authMsg(x)); }
  });
  $('#resetBtn').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) return err('Escribe tu correo y vuelve a pulsar.');
    try { await auth.sendPasswordResetEmail(a, email); err('Te he enviado un correo para cambiar la contraseña.'); }
    catch (x) { err(authMsg(x)); }
  });
}
const authMsg = e => ({
  'auth/invalid-credential': 'Correo o contraseña incorrectos.', 'auth/wrong-password': 'La contraseña no es correcta.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese correo. Pulsa “Crear cuenta”.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
  'auth/invalid-email': 'Ese correo no parece válido.', 'auth/network-request-failed': 'No hay conexión. Prueba otra vez cuando tengas internet.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un momento y vuelve a probar.',
  'auth/current-password': 'La contraseña actual no es correcta.',
  'auth/requires-recent-login': 'Por seguridad, cierra sesión, vuelve a entrar y repite el cambio.',
  'auth/operation-not-allowed': 'Firebase no permite este cambio ahora mismo. Revisa la configuración de Authentication.',
})[e.code] || 'No se pudo completar. Inténtalo otra vez.';

// ---------- Cuenta ----------
function showAccount() {
  const u = store.user; if (!u) return;
  $('#accountInfo').textContent = 'Sesión iniciada como ' + u.email;
  $('#hello').textContent = u.displayName ? `Hola, ${u.displayName}` : 'Ajustes';
  $('#currentEmail').textContent = u.email;
  if (document.activeElement !== $('#nameInput')) $('#nameInput').value = u.displayName || '';
}
function setupAccount() {
  const say = (el, text, ok) => { el.textContent = text; el.className = ok ? 'okmsg' : 'err'; el.hidden = !text; };
  const reauth = async pass => {
    const { EmailAuthProvider, reauthenticateWithCredential } = store.authLib;
    try { await reauthenticateWithCredential(store.user, EmailAuthProvider.credential(store.user.email, pass)); }
    catch (x) {
      if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(x.code)) throw { code: 'auth/current-password' };
      throw x;
    }
  };
  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await store.authLib.updateProfile(store.user, { displayName: $('#nameInput').value.trim() }); showAccount(); say($('#nameMsg'), 'Nombre guardado.', true); }
    catch (x) { say($('#nameMsg'), authMsg(x)); }
  });
  $('#emailForm').addEventListener('submit', async e => {
    e.preventDefault(); const msg = $('#emailMsg'); say(msg, '');
    const email = $('#newEmail').value.trim();
    try {
      await reauth($('#emailPass').value);
      await store.authLib.verifyBeforeUpdateEmail(store.user, email);
      $('#emailForm').reset();
      say(msg, `Te he enviado un correo a ${email}. El cambio se hace cuando pulses el enlace. Después tendrás que volver a entrar con el correo nuevo.`, true);
    } catch (x) { say(msg, authMsg(x)); }
  });
  $('#passForm').addEventListener('submit', async e => {
    e.preventDefault(); const msg = $('#passMsg'); say(msg, '');
    try {
      await reauth($('#oldPass').value);
      await store.authLib.updatePassword(store.user, $('#newPass').value);
      $('#passForm').reset(); say(msg, 'Contraseña cambiada.', true);
    } catch (x) { say(msg, authMsg(x)); }
  });
}

// ---------- Siri ----------
let siriKey = null;
function setupSiri() {
  const newKey = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 28); };
  $('#siriOn').addEventListener('click', () => store.fb.setDoc(store.ref('settings', 'siri'), { key: newKey() }).catch(writeFailed));
  let armed = null;
  $('#siriRotate').addEventListener('click', () => {
    const b = $('#siriRotate');
    if (!armed) { b.textContent = 'Toca otra vez: el atajo actual dejará de funcionar'; armed = setTimeout(() => { armed = null; b.textContent = 'Cambiar clave'; }, 4000); return; }
    clearTimeout(armed); armed = null; b.textContent = 'Cambiar clave';
    store.fb.setDoc(store.ref('settings', 'siri'), { key: newKey() }).catch(writeFailed);
  });
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const text = $('#' + b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); $('#copyMsg').textContent = 'Copiado. Pégalo en Atajos.'; }
    catch { const r = document.createRange(); r.selectNodeContents($('#' + b.dataset.copy)); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copyMsg').textContent = 'Seleccionado: mantén pulsado y elige Copiar.'; }
    $('#copyMsg').hidden = false;
  }));
}
function renderSiri() {
  $('#siriOff').hidden = !!siriKey; $('#siriSetup').hidden = !siriKey;
  if (!siriKey || !store.uid) return;
  $('#siriUrl').textContent = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${store.uid}/tasks?key=${firebaseConfig.apiKey}`;
  $('#siriBody').textContent = `{"fields":{"title":{"stringValue":"DICTADO"},"siriKey":{"stringValue":"${siriKey}"}}}`;
}

// ---------- Hojas ----------
let sheetToken = 0;
function openSheet(id) {
  closeSheets(true);
  const s = $(id), scrim = $('#scrim'), token = ++sheetToken;
  s.hidden = false; scrim.hidden = false; s.scrollTop = 0;
  void s.offsetHeight;
  if (token === sheetToken) { s.classList.add('show'); scrim.classList.add('show'); }
}
function closeSheets(instant) {
  sheetToken++;
  document.querySelectorAll('.sheet.show').forEach(s => {
    s.classList.remove('show');
    instant ? (s.hidden = true) : setTimeout(() => { if (!s.classList.contains('show')) s.hidden = true; }, 260);
  });
  const scrim = $('#scrim'); scrim.classList.remove('show');
  instant ? (scrim.hidden = true) : setTimeout(() => { if (!scrim.classList.contains('show')) scrim.hidden = true; }, 260);
  document.activeElement?.blur?.();
}
$('#scrim').addEventListener('click', () => closeSheets());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeSheets()));
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => openSheet('#menuSheet')));
$('#menuBtn').addEventListener('click', () => { showAccount(); openSheet('#menuSheet'); });
$('#openAccount').addEventListener('click', () => { showAccount(); ['#nameMsg', '#emailMsg', '#passMsg'].forEach(s => $(s).hidden = true); openSheet('#accountSheet'); });
$('#openCats').addEventListener('click', () => { renderCatSheet(); openSheet('#catSheet'); });
$('#openSiri').addEventListener('click', () => { renderSiri(); $('#copyMsg').hidden = true; openSheet('#siriSheet'); });

// ---------- Categorías ----------
let catDelArmed = null;
function renderCatSheet() {
  const counts = {}; tasks.forEach(t => { counts[t.cat] = (counts[t.cat] || 0) + 1; });
  $('#catList').innerHTML = cats.map((c, i) => `<div class="catrow" data-i="${i}">
      <button type="button" class="swatch" data-cact="color" style="background:${colorVar(c.color)}" aria-label="Cambiar color de ${esc(c.name)}"></button>
      <input class="inp" type="text" value="${esc(c.name)}" data-cact="name" maxlength="30" aria-label="Nombre de la categoría">
      <button type="button" class="x" data-cact="up" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="x" data-cact="down" aria-label="Bajar" ${i === cats.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="x ${catDelArmed === c.id ? 'confirm' : ''}" data-cact="del" aria-label="Borrar ${esc(c.name)}">${catDelArmed === c.id ? (counts[c.id] ? `¿Borrar? ${counts[c.id]} tareas quedarán sin categoría` : '¿Borrar?') : '✕'}</button>
    </div>`).join('') || '<p class="hint">No tienes categorías. Añade una abajo.</p>';
}
$('#catList').addEventListener('click', e => {
  const b = e.target.closest('[data-cact]'); if (!b || b.dataset.cact === 'name') return;
  const i = +b.closest('.catrow').dataset.i, list = cats.map(c => ({ ...c })), c = list[i];
  if (b.dataset.cact !== 'del') catDelArmed = null;
  if (b.dataset.cact === 'color') c.color = COLORS[(COLORS.indexOf(c.color) + 1) % COLORS.length];
  if (b.dataset.cact === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
  if (b.dataset.cact === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  if (b.dataset.cact === 'del') {
    if (catDelArmed !== c.id) { catDelArmed = c.id; renderCatSheet(); return; }
    catDelArmed = null; list.splice(i, 1);
    if (catFilter === c.id) catFilter = null;
  }
  store.saveCats(list).catch(writeFailed); renderCatSheet(); render();
});
$('#catList').addEventListener('change', e => {
  if (e.target.dataset.cact !== 'name') return;
  const i = +e.target.closest('.catrow').dataset.i, name = e.target.value.trim();
  if (!name) { e.target.value = cats[i].name; return; }
  const list = cats.map(c => ({ ...c })); list[i].name = name;
  store.saveCats(list).catch(writeFailed); render();
});
$('#catAdd').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#catNew').value.trim(); if (!name) return;
  const used = cats.map(c => c.color);
  const color = COLORS.find(c => !used.includes(c)) || COLORS[cats.length % COLORS.length];
  store.saveCats([...cats, { id: 'c' + uid(), name, color }]).catch(writeFailed);
  $('#catNew').value = ''; renderCatSheet(); render();
});

// ---------- Formulario ----------
function renderCatChips() {
  $('#catChips').innerHTML = cats.map(c =>
    `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${formCat === c.id}"><span class="dot" style="background:${colorVar(c.color)}"></span>${esc(c.name)}</button>`).join('')
    + `<button type="button" class="chip" data-cat="" aria-pressed="${formCat === ''}">Ninguna</button>`;
}
function renderWhenChips() {
  const v = $('#date').value, t = todayISO();
  document.querySelectorAll('#whenChips .chip').forEach(b => {
    const w = b.dataset.when;
    b.setAttribute('aria-pressed', (w === 'today' && v === t) || (w === 'tomorrow' && v === addDays(t, 1)) || (w === 'none' && !v));
  });
}
function renderDays() {
  $('#daysRow').hidden = $('#repeat').value !== 'dias';
  $('#daysRow').innerHTML = DAY_ORDER.map(d => `<button type="button" class="chip" data-day="${d}" aria-pressed="${formDays.includes(d)}">${DAY_LETTER[d]}</button>`).join('');
}
function renderSubs() {
  $('#subList').innerHTML = formSubs.map((s, i) => `<div class="subrow" data-i="${i}">
    <button type="button" class="box" data-sact="toggle" aria-pressed="${s.done}" aria-label="Hecho">${TICK('var(--accent-ink)')}</button>
    <input class="inp" type="text" value="${esc(s.text)}" data-sact="text" aria-label="Paso">
    <button type="button" class="x" data-sact="del" aria-label="Quitar paso">✕</button></div>`).join('');
}
function renderDetected() {
  if (editingId) { $('#detected').hidden = true; return; }
  const p = parseQuick($('#title').value, cats), bits = [];
  if (p.date) bits.push(friendlyDate(p.date));
  if (p.time) bits.push(p.time);
  if (p.cat) bits.push('#' + catOf(p.cat).name);
  if (p.prio) bits.push('Prioridad alta');
  if (p.repeat) bits.push('↻ ' + repeatLabel(p));
  $('#detected').innerHTML = bits.map(b => `<span>${esc(b)}</span>`).join('');
  $('#detected').hidden = !bits.length;
}
$('#catChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { formCat = b.dataset.cat; renderCatChips(); } });
$('#whenChips').addEventListener('click', e => {
  const b = e.target.closest('[data-when]'); if (!b) return;
  const w = b.dataset.when;
  $('#date').value = w === 'today' ? todayISO() : w === 'tomorrow' ? addDays(todayISO(), 1) : '';
  renderWhenChips();
});
$('#date').addEventListener('input', renderWhenChips);
$('#title').addEventListener('input', renderDetected);
$('#repeat').addEventListener('change', () => {
  if ($('#repeat').value === 'dias' && !formDays.length) formDays = [parseISO($('#date').value || todayISO()).getDay()];
  renderDays();
});
$('#daysRow').addEventListener('click', e => {
  const b = e.target.closest('[data-day]'); if (!b) return;
  const d = +b.dataset.day;
  formDays = formDays.includes(d) ? formDays.filter(x => x !== d) : [...formDays, d];
  renderDays();
});
$('#subNew').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const text = $('#subNew').value.trim(); if (!text) return;
  formSubs.push({ id: uid(), text, done: false }); $('#subNew').value = ''; renderSubs();
});
$('#subList').addEventListener('click', e => {
  const b = e.target.closest('[data-sact]'); if (!b) return;
  const i = +b.closest('.subrow').dataset.i;
  if (b.dataset.sact === 'toggle') formSubs[i].done = !formSubs[i].done;
  if (b.dataset.sact === 'del') formSubs.splice(i, 1);
  if (b.dataset.sact !== 'text') renderSubs();
});
$('#subList').addEventListener('input', e => { if (e.target.dataset.sact === 'text') formSubs[+e.target.closest('.subrow').dataset.i].text = e.target.value; });

function openForm(id) {
  const t = id ? tasks.find(x => x.id === id) : null;
  editingId = t ? t.id : null;
  $('#title').value = t ? t.title : '';
  formCat = t ? (t.cat ?? '') : (catFilter || cats[cats.length - 1]?.id || '');
  if (!t && !cats.some(c => c.id === formCat)) formCat = cats[0]?.id || '';
  $('#date').value = t ? (t.date || '') : (view === 'sinfecha' ? '' : view === 'proximas' ? addDays(todayISO(), 1) : todayISO());
  $('#time').value = t ? (t.time || '') : '';
  $('#prio').value = t ? (t.prio || 'normal') : 'normal';
  $('#repeat').value = t ? (t.repeat || '') : '';
  formDays = t && Array.isArray(t.days) ? [...t.days] : [];
  formSubs = t && Array.isArray(t.subtasks) ? t.subtasks.map(s => ({ ...s })) : [];
  $('#notes').value = t ? (t.notes || '') : '';
  $('#remind').value = t && t.remind !== null && t.remind !== undefined ? String(t.remind) : '';
  $('#minutes').value = t && t.minutes ? t.minutes : '';
  $('#rota').value = t ? (t.rota || '') : '';
  $('#calRow').hidden = !(t && t.date);
  $('#subNew').value = '';
  $('#sheetTitle').textContent = t ? 'Editar tarea' : 'Nueva tarea';
  $('#submitBtn').textContent = t ? 'Guardar' : 'Añadir';
  $('#deleteBtn').hidden = !t;
  renderCatChips(); renderWhenChips(); renderDays(); renderSubs(); renderDetected();
  openSheet('#taskSheet');
  if (!t) setTimeout(() => $('#title').focus(), 60);
}
$('#fab').addEventListener('click', () => (view === 'habitos' && !query) ? openHabit(null) : openForm(null));
$('#taskSheet').addEventListener('submit', e => {
  e.preventDefault();
  let title = $('#title').value.trim();
  if (!title) { $('#title').focus(); return; }
  const pending = $('#subNew').value.trim();
  if (pending) formSubs.push({ id: uid(), text: pending, done: false });
  const data = { title, cat: formCat, date: $('#date').value, time: $('#time').value, prio: $('#prio').value,
    repeat: $('#repeat').value, days: $('#repeat').value === 'dias' ? formDays : [], notes: $('#notes').value.trim(),
    subtasks: formSubs.filter(s => s.text.trim()).map(s => ({ ...s, text: s.text.trim() })),
    remind: $('#remind').value === '' ? null : Number($('#remind').value),
    minutes: Number($('#minutes').value) > 0 ? Number($('#minutes').value) : null,
    rota: $('#rota').value };
  if (!editingId) {
    const p = parseQuick(title, cats);
    data.title = p.title;
    if (p.date) data.date = p.date;
    if (p.time) { data.time = p.time; if (!p.date && !data.date) data.date = todayISO(); }
    if (p.cat) data.cat = p.cat;
    if (p.prio) data.prio = p.prio;
    if (p.repeat) { data.repeat = p.repeat; data.days = p.days || []; }
  }
  if (data.repeat === 'dias' && !data.days.length) data.repeat = 'semanal';
  // Con días concretos, la primera vez cae en el siguiente día elegido (hoy incluido)
  if (data.repeat === 'dias') {
    let d = data.date || todayISO();
    for (let i = 0; i < 7 && !data.days.includes(parseISO(d).getDay()); i++) d = addDays(d, 1);
    data.date = d;
  }
  // Las tareas de la rotación no tienen fecha: salen solas en el rato de casa
  if (data.rota) { data.date = ''; data.time = ''; data.repeat = ''; data.days = []; if (!data.minutes) data.minutes = 15; }
  let t;
  if (editingId) {
    t = tasks.find(x => x.id === editingId); if (!t) return closeSheets();
    if (data.rota && !t.rota) data.rotaOrder = maxRotaOrder() + 1;
    Object.assign(t, data);
  } else {
    t = { id: uid(), done: false, created: Date.now(), ...data };
    if (data.rota) t.rotaOrder = maxRotaOrder() + 1;
    tasks.push(t);
  }
  store.put(t).catch(writeFailed);
  closeSheets(); render();
});
$('#rota').addEventListener('change', () => { if ($('#rota').value && !$('#minutes').value) $('#minutes').value = 15; });

// ---------- Calendario ----------
$('#calIOS').addEventListener('click', async () => {
  const t = tasks.find(x => x.id === editingId); if (!t || !t.date) return;
  const name = (t.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'tarea') + '.ics';
  const file = new File([toICS(t)], name, { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#calGoogle').addEventListener('click', () => {
  const t = tasks.find(x => x.id === editingId); if (!t || !t.date) return;
  window.open(googleURL(t), '_blank', 'noopener');
});
$('#deleteBtn').addEventListener('click', () => { const id = editingId; closeSheets(); remove(id); });

// ---------- Acciones ----------
function toggle(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  if (t.done) { t.pts = taskPoints(t); t.ptsDay = todayISO(); addPoints(t.pts); }
  else if (t.pts) { addPoints(-t.pts, t.ptsDay || todayISO()); t.pts = 0; t.ptsDay = ''; }
  const spawn = t.done && t.repeat && !t.spawned;
  if (spawn) {
    t.spawned = true;
    // Racha: suma si se hace a tiempo (el día que tocaba o antes); si estaba atrasada, vuelve a empezar
    const onTime = !t.date || t.date >= todayISO();
    t.streak = onTime ? (t.streak || 0) + 1 : 1;
    t.best = Math.max(t.best || 0, t.streak);
    t.history = [...(t.history || []), todayISO()].slice(-120);
  }
  store.put(t).catch(writeFailed);
  if (spawn) {
    const { id: _i, done, doneAt, spawned, pts, ptsDay, ...rest } = t;
    const next = { ...rest, id: uid(), done: false, created: Date.now(), date: nextDate(t),
      subtasks: (t.subtasks || []).map(s => ({ ...s, done: false })) };
    if (t.streak >= 2) navigator.vibrate?.([10, 40, 10]);
    tasks.push(next);
    store.put(next).catch(writeFailed);
    showToast(`+${t.pts} ⭐ · ${t.streak >= 2 ? `🔥 Racha de ${t.streak} · ` : ''}Siguiente: ${friendlyDate(next.date).toLowerCase()}`, false);
  } else if (t.done) showToast(`+${t.pts} ⭐ · ${t.title}`, false);
  navigator.vibrate?.(10);
  render();
}
function toggleSub(id, sid) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const s = (t.subtasks || []).find(x => x.id === sid); if (!s) return;
  s.done = !s.done;
  store.put(t).catch(writeFailed); render();
}
let lastDeleted = null, toastTimer = null;
function remove(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  tasks = tasks.filter(x => x.id !== id);
  store.remove(id).catch(writeFailed);
  lastDeleted = [t];
  showToast(`Borrada: ${t.title}`, true);
  render();
}
let toastMode = null;
function showToast(text, undo) {
  $('#toastText').textContent = text;
  $('#toastUndo').hidden = !undo;
  toastMode = undo === 'rato' ? 'rato' : 'delete';
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; lastDeleted = null; ratoUndo = null; }, 5000);
}
$('#toastUndo').addEventListener('click', () => {
  if (toastMode === 'rato') { undoRato(); $('#toast').hidden = true; return; }
  if (lastDeleted) { lastDeleted.forEach(t => { if (!tasks.some(x => x.id === t.id)) tasks.push(t); }); store.putMany(lastDeleted).catch(writeFailed); lastDeleted = null; render(); }
  $('#toast').hidden = true;
});
let clearArmed = null;
$('#clearDone').addEventListener('click', () => {
  const done = tasks.filter(x => x.done);
  if (!done.length) return;
  if (!clearArmed) {
    $('#clearDone').textContent = `Toca otra vez para borrar ${done.length}`;
    clearArmed = setTimeout(() => { clearArmed = null; render(); }, 4000);
    return;
  }
  clearTimeout(clearArmed); clearArmed = null;
  tasks = tasks.filter(x => !x.done);
  done.forEach(t => store.remove(t.id).catch(writeFailed));
  lastDeleted = done;
  showToast(`${done.length} borrada${done.length === 1 ? '' : 's'}`, true);
  render();
});

// ---------- Deslizar para completar / borrar ----------
let swipe = null, suppressClick = false;
const SW_MAX = 120, SW_GO = 90;
$('#list').addEventListener('pointerdown', e => {
  const li = e.target.closest('li.task'); if (!li || e.button > 0) return;
  swipe = { li, row: li.querySelector('.row'), x: e.clientX, y: e.clientY, dx: 0, active: false, id: li.dataset.id };
});
$('#list').addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 12) return;
    swipe.active = true; swipe.li.classList.remove('snap');
    try { swipe.li.setPointerCapture(e.pointerId); } catch {}
  }
  swipe.dx = Math.max(-SW_MAX, Math.min(SW_MAX, dx));
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
  swipe.li.classList.toggle('sw-right', swipe.dx > 0);
  swipe.li.classList.toggle('sw-left', swipe.dx < 0);
});
const endSwipe = () => {
  if (!swipe) return;
  const s = swipe; swipe = null;
  if (!s.active) return;
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
  s.li.classList.add('snap');
  if (s.dx >= SW_GO) { s.row.style.transform = 'translateX(100%)'; setTimeout(() => toggle(s.id), 160); }
  else if (s.dx <= -SW_GO) { s.row.style.transform = 'translateX(-100%)'; setTimeout(() => remove(s.id), 160); }
  else { s.row.style.transform = ''; setTimeout(() => s.li.classList.remove('sw-right', 'sw-left'), 200); }
};
$('#list').addEventListener('pointerup', endSwipe);
$('#list').addEventListener('pointercancel', endSwipe);

// ---------- Buscar ----------
$('#searchBtn').addEventListener('click', () => {
  const on = $('#searchBar').hidden;
  $('#searchBar').hidden = !on; $('#searchBtn').setAttribute('aria-pressed', on);
  if (on) $('#searchInput').focus(); else { $('#searchInput').value = ''; query = ''; render(); }
});
$('#searchInput').addEventListener('input', () => { query = $('#searchInput').value.trim(); render(); });
const matches = (t, q) => fold([t.title, t.notes, ...(t.subtasks || []).map(s => s.text)].join(' ')).includes(fold(q));

// ---------- Copias ----------
$('#exportBtn').addEventListener('click', async () => {
  const name = `mis-tareas-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(tasks.map(t => ({ id: t.id, ...clean(t) })), null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Mis Tareas' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const info = $('#importInfo');
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data)) throw 0;
    const list = data.filter(x => x && x.title).map(x => ({ id: String(x.id || uid()).replace(/[^\w.~:@+-]/g, '_'), ...clean(x) }));
    info.textContent = `Importando ${list.length} tareas…`;
    await store.putMany(list);
    info.textContent = `Listo: ${list.length} tareas importadas.`;
    render();
  } catch { info.textContent = 'Ese archivo no es una copia de Mis Tareas.'; }
});

// ---------- Rato de casa ----------
const rotaTasks = () => tasks.filter(t => t.rota && !t.done).sort((a, b) => a.rotaOrder - b.rotaOrder);
function maxRotaOrder() { return tasks.reduce((m, t) => t.rota ? Math.max(m, Number(t.rotaOrder) || 0) : m, 0); }
const dayLog = d => rato.log[d] || { min: 0, n: 0, ids: [] };
function budgetToday() {
  const b = Number(rato.budgets[new Date().getDay()]) || 0;
  return Math.max(0, b + (rato.extra.date === todayISO() ? rato.extra.min : 0));
}
function picksToday() {
  const left = Math.max(0, budgetToday() - dayLog(todayISO()).min);
  const q = rotaTasks(), picks = []; let rem = left;
  for (let i = 0; i < q.length && i < LOOKAHEAD; i++) { const m = q[i].minutes || 15; if (m <= rem) { picks.push(q[i]); rem -= m; } }
  return { picks, left, next: q.find(t => !picks.includes(t)) };
}
const agoText = d => { const n = Math.round((parseISO(todayISO()) - parseISO(d)) / 864e5); return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`; };
let ratoUndo = null;
function rotaDone(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const d = todayISO(), before = structuredClone(t), prevLog = rato.log[d] ? structuredClone(rato.log[d]) : null;
  const log = structuredClone(dayLog(d));
  const pts = taskPoints(t);
  log.min += t.minutes || 15; log.n += 1; log.ids = [...(log.ids || []), t.id].slice(-50);
  rato.log[d] = log;
  t.last = d; t.times = (t.times || 0) + 1;
  if (t.rota === 'una') { t.done = true; t.doneAt = Date.now(); t.pts = pts; t.ptsDay = d; }
  else {
    const q = rotaTasks().filter(x => x.id !== t.id);
    if (t.rota === 'frecuente' && q.length > 1) { const mid = Math.ceil(q.length / 2); t.rotaOrder = (q[mid - 1].rotaOrder + q[mid].rotaOrder) / 2; }
    else t.rotaOrder = maxRotaOrder() + 1;
  }
  addPoints(pts);
  store.put(t).catch(writeFailed); store.saveRato().catch(writeFailed);
  ratoUndo = { before, prevLog, d, pts };
  navigator.vibrate?.(10);
  showToast(`+${pts} ⭐ · ${t.title}${t.rota === 'una' ? '' : ' vuelve a la cola'}`, 'rato');
  render();
}
function undoRato() {
  const u = ratoUndo; if (!u) return; ratoUndo = null;
  const t = tasks.find(x => x.id === u.before.id); if (t) { Object.keys(t).forEach(k => delete t[k]); Object.assign(t, u.before); store.put(t).catch(writeFailed); }
  if (u.prevLog) rato.log[u.d] = u.prevLog; else delete rato.log[u.d];
  addPoints(-u.pts, u.d);
  store.saveRato().catch(writeFailed); render();
}
function rotaSkip(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const q = rotaTasks().filter(x => x.id !== id); if (!q.length) return;
  const i = Math.min(LOOKAHEAD, q.length);
  t.rotaOrder = i >= q.length ? maxRotaOrder() + 1 : (q[i - 1].rotaOrder + q[i].rotaOrder) / 2;
  store.put(t).catch(writeFailed); render();
}
function ratoAdjust(delta) {
  const d = todayISO();
  if (rato.extra.date !== d) rato.extra = { date: d, min: 0 };
  const base = Number(rato.budgets[new Date().getDay()]) || 0;
  rato.extra.min = Math.max(-base, rato.extra.min + delta);
  store.saveRato().catch(writeFailed); render();
}
function ratoHTML() {
  if (!rotaTasks().length && !dayLog(todayISO()).n) return '';
  const b = budgetToday(), spent = dayLog(todayISO()).min, { picks, left, next } = picksToday();
  const doneNames = (dayLog(todayISO()).ids || []).map(id => tasks.find(t => t.id === id)?.title).filter(Boolean);
  let msg = '';
  if (!picks.length) msg = b === 0 ? 'Hoy es día libre de casa.' : left === 0 ? 'Rato de hoy cumplido. Lo demás, otro día.'
    : next ? `Lo siguiente (${esc(next.title)}) necesita ${next.minutes || 15} min y te quedan ${left}.` : 'La cola está vacía.';
  return `<section class="rato">
    <div class="rato-head"><h2>Rato de casa</h2>
      <div class="rato-meter"><div class="nums"><span>${spent} de ${b} min</span><span>${left ? 'quedan ' + left : (b ? 'cumplido' : 'libre')}</span></div>
      <div class="bar"><i style="width:${b ? Math.min(100, spent / b * 100) : 0}%"></i></div></div></div>
    ${picks.length ? `<ul class="picks">${picks.map(t => `<li class="pick" style="--c:${colorVar(catOf(t.cat).color)}">
      <button class="check" data-act="rdone" data-id="${t.id}" aria-label="Hecha: ${esc(t.title)}">${TICK('var(--surface)')}</button>
      <div data-act="edit" data-id="${t.id}"><div class="t">${esc(t.title)}</div><div class="m">${t.minutes || 15} min · ${t.last ? 'hecha ' + agoText(t.last) : 'aún no hecha'}</div></div>
      <button class="btn ghost small" data-act="rskip" data-id="${t.id}">Otro día</button></li>`).join('')}</ul>` : ''}
    ${msg ? `<p class="hint">${msg}</p>` : ''}
    ${doneNames.length ? `<div class="donechips">${doneNames.map(n => `<span>✓ ${esc(n)}</span>`).join('')}</div>` : ''}
    <div class="rato-adj"><button class="btn small" data-act="radj" data-d="-15">−15 min hoy</button><button class="btn small" data-act="radj" data-d="15">+15 min hoy</button></div>
  </section>`;
}
// Tareas que vinieron de Rotación de la casa (notas "25 min"): se pasan a la rotación con su frecuencia original
const ROTA_MODES = {
  frecuente: ['t03', 't05', 't10'],
  final: ['t08', 't17', 't20', 't23', 't25', 't27', 't33', 'tmw3aza28dg8q', 'tmw3azihzepm6', 'tmw3b0fwyk9jd', 'tmw3b0lyhu2ow', 'tmw3b0whwyqr9', 'tmw3b1duv5a6s', 'tmw3b5acs3oe9', 'tmw3b9g843v83'],
};
const migratable = () => tasks.filter(t => !t.done && !t.rota && !t.date && /^\d+\s*min$/i.test((t.notes || '').trim()));
function renderRatoSheet() {
  if (!$('#ratoSheet').contains(document.activeElement)) {
    $('#budgets').innerHTML = DAY_ORDER.map(d => `<label>${DAY_LETTER[d]}<input class="inp" type="number" inputmode="numeric" min="0" max="300" step="5" data-bud="${d}" value="${rato.budgets[d]}" aria-label="Minutos ${DAY_LETTER[d]}"></label>`).join('');
  }
  const m = migratable();
  $('#migrateBox').hidden = !m.length;
  $('#migrateText').textContent = `Hay ${m.length} tareas sin fecha con los minutos en las notas (las que vinieron de Rotación de la casa). Pásalas a la rotación para que salgan solas en tu rato de casa, en el mismo orden y con la frecuencia que tenían.`;
}
$('#openRato').addEventListener('click', () => { renderRatoSheet(); openSheet('#ratoSheet'); });
$('#budgets').addEventListener('change', e => {
  const d = e.target.dataset.bud; if (d === undefined) return;
  rato.budgets[d] = Math.max(0, Math.min(300, Math.round(Number(e.target.value)) || 0));
  e.target.value = rato.budgets[d];
  store.saveRato().catch(writeFailed); render();
});
$('#migrateBtn').addEventListener('click', async () => {
  const list = migratable().map(t => {
    const orig = t.id.replace(/^r-/, '');
    const rota = ROTA_MODES.frecuente.includes(orig) ? 'frecuente' : ROTA_MODES.final.includes(orig) ? 'final' : 'una';
    return { ...t, minutes: parseInt(t.notes, 10), notes: '', rota, rotaOrder: t.created || Date.now() };
  });
  list.forEach(n => Object.assign(tasks.find(t => t.id === n.id), n));
  await store.putMany(list).catch(writeFailed);
  $('#migrateText').textContent = `Listo: ${list.length} tareas en la rotación.`;
  render(); renderRatoSheet(); $('#migrateBox').hidden = false; $('#migrateBtn').hidden = true;
});

// ---------- Agenda (semana) ----------
function stepDate(t, x) {
  const days = Array.isArray(t.days) && t.days.length ? t.days : null;
  if (t.repeat === 'diario') return addDays(x, 1);
  if (t.repeat === 'mensual') return addMonths(x, 1);
  if (t.repeat === 'dias' && days) { let y = x; do { y = addDays(y, 1); } while (!days.includes(parseISO(y).getDay())); return y; }
  return addDays(x, 7);
}
function weekHTML(byCat) {
  const today = todayISO(), dow = (parseISO(today).getDay() + 6) % 7;
  const mon = addDays(today, -dow + weekOffset * 7), sun = addDays(mon, 6);
  const f = iso => parseISO(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const ghosts = {};
  tasks.filter(t => byCat(t) && t.repeat && !t.done && t.date).forEach(t => {
    let d = t.date, n = 0;
    while (n++ < 400) { d = stepDate(t, d); if (d > sun) break; if (d >= mon) (ghosts[d] ||= []).push(t); }
  });
  let html = `<div class="weeknav"><button class="iconbtn" data-act="wprev" aria-label="Semana anterior">‹</button><strong>${f(mon)} – ${f(sun)}</strong><button class="iconbtn" data-act="wnext" aria-label="Semana siguiente">›</button></div>`;
  if (weekOffset) html += `<button class="btn ghost small" data-act="wtoday" style="display:block;margin:0 auto">Volver a esta semana</button>`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const real = tasks.filter(x => byCat(x) && ((!x.done && (x.date === d || (d === today && x.date && x.date < today)))
      || (x.done && x.doneAt && isoDate(new Date(x.doneAt)) === d))).sort((a, b) => (a.done - b.done) || sortTasks(a, b));
    const gh = (ghosts[d] || []).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    const name = parseISO(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });
    html += `<div class="day ${d === today ? 'today' : ''}"><h2 class="group"><span>${d === today ? 'Hoy · ' : ''}${name.charAt(0).toUpperCase() + name.slice(1)}</span><span>${real.length + gh.length || ''}</span></h2>
      ${real.length ? `<ul class="list">${real.map(taskHTML).join('')}</ul>` : ''}
      ${gh.length ? `<div class="list" style="display:grid;gap:6px;margin-top:6px">${gh.map(t => `<button class="ghost" data-act="edit" data-id="${t.id}"><span class="dot" style="background:${colorVar(catOf(t.cat).color)}"></span><span><b>${esc(t.title)}</b>${t.time ? ' · ' + t.time : ''}</span><span>↻</span></button>`).join('')}</div>` : ''}
      ${!real.length && !gh.length ? '<p class="free">Libre</p>' : ''}</div>`;
  }
  return html;
}

// ---------- Hábitos ----------
const habitOK = (h, d) => (h.log[d] || 0) === 1;
const mondayOf = iso => addDays(iso, -((parseISO(iso).getDay() + 6) % 7));
const weekCount = (h, mon) => { let n = 0; for (let i = 0; i < 7; i++) if (habitOK(h, addDays(mon, i))) n++; return n; };
function habitStreak(h) {
  const today = todayISO();
  if (h.freq === 'weekly') {
    let w = mondayOf(today), n = 0;
    if (weekCount(h, w) < h.target) w = addDays(w, -7);
    while (weekCount(h, w) >= h.target && n < 520) { n++; w = addDays(w, -7); }
    return n;
  }
  let d = habitOK(h, today) ? today : addDays(today, -1), n = 0;
  while (habitOK(h, d) && n < 1000) { n++; d = addDays(d, -1); }
  return n;
}
function habitBest(h) {
  if (h.freq === 'weekly') return habitStreak(h);
  const ok = Object.keys(h.log).filter(d => h.log[d] === 1).sort();
  let best = 0, run = 0, prev = null;
  ok.forEach(d => { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  return best;
}
const habitDoneToday = h => h.kind === 'quit' ? h.log[todayISO()] !== undefined
  : h.freq === 'weekly' ? (habitOK(h, todayISO()) || weekCount(h, mondayOf(todayISO())) >= h.target) : habitOK(h, todayISO());
const sortedHabits = () => [...habits].sort((a, b) => a.order - b.order);
function setHabit(id, val) {
  const h = habits.find(x => x.id === id); if (!h) return;
  const d = todayISO(), prev = h.log[d];
  const next = prev === val ? null : val;
  if (prev === 1) addPoints(-habitPoints(h));
  if (next === 1) addPoints(habitPoints(h));
  if (next === null) delete h.log[d]; else h.log[d] = next;
  store.setHabitDay(h, d, next).catch(writeFailed);
  if (next === 1) {
    navigator.vibrate?.(10);
    const s = habitStreak(h);
    showToast(`+${habitPoints(h)} ⭐ · ${h.name}${s >= 2 ? ` · 🔥 ${s} ${h.freq === 'weekly' ? 'semanas' : 'días'}` : ''}`, false);
  }
  render();
}
function dotsHTML(h) {
  const mon = mondayOf(todayISO()), today = todayISO();
  return `<div class="dots">${DAY_ORDER.map((wd, i) => {
    const d = addDays(mon, i), v = h.log[d];
    const cls = v === 1 ? 'on' : v === -1 ? 'bad' : d > today ? 'off' : '';
    return `<i class="${cls}">${DAY_LETTER[wd]}</i>`;
  }).join('')}</div>`;
}
function habitRowHTML(h, compact) {
  const s = habitStreak(h), today = todayISO(), v = h.log[today];
  const unit = h.freq === 'weekly' ? (s === 1 ? 'semana' : 'semanas') : (s === 1 ? 'día' : 'días');
  let meta = h.kind === 'quit' ? (s ? `🔥 ${s} ${unit} sin caer` : 'Empieza hoy')
    : h.freq === 'weekly' ? `${weekCount(h, mondayOf(today))}/${h.target} esta semana${s ? ` · 🔥 ${s} ${unit}` : ''}`
    : (s ? `🔥 ${s} ${unit}` : 'Sin racha todavía');
  if (!compact) { const b = habitBest(h); if (b > s && h.freq !== 'weekly') meta += ` · récord ${b}`; meta += ` · +${habitPoints(h)} ⭐`; }
  const actions = h.kind === 'quit'
    ? `<div class="qbtns"><button class="qb ok ${v === 1 ? 'on' : ''}" data-act="hok" data-id="${h.id}" aria-label="Lo he evitado hoy">✓</button><button class="qb bad ${v === -1 ? 'on' : ''}" data-act="hbad" data-id="${h.id}" aria-label="Hoy he caído">✗</button></div>`
    : `<button class="hcheck ${v === 1 ? 'on' : ''}" data-act="hok" data-id="${h.id}" aria-label="Hecho hoy: ${esc(h.name)}">${TICK('var(--surface)')}</button>`;
  return `<div class="hab ${h.kind}" style="--c:${h.kind === 'quit' ? 'var(--k-turquesa)' : 'var(--k-verde)'}">
    <div class="hb" data-act="hedit" data-id="${h.id}"><div class="n">${esc(h.name)}</div><div class="m">${meta}</div>${compact ? '' : dotsHTML(h)}</div>
    ${actions}</div>`;
}
function habitsTodayHTML() {
  if (!habits.length) return '';
  const all = sortedHabits(), pending = all.filter(h => !habitDoneToday(h)), done = all.length - pending.length;
  return `<section class="rato"><div class="rato-head"><h2>Hábitos de hoy</h2><span class="hint">${done} de ${all.length}</span></div>
    ${pending.length ? `<div class="habs">${pending.map(h => habitRowHTML(h, true)).join('')}</div>` : '<p class="hint">¡Todos los hábitos de hoy cumplidos! 🎉</p>'}
    <button class="btn ghost small" data-act="gohabits">Ver todos los hábitos</button></section>`;
}
function habitsViewHTML() {
  const today = todayISO(), all = sortedHabits();
  const pts = pointsOn(today), goal = stats.goal;
  let html = `<section class="summary"><div class="rato-head"><h2>Hoy</h2><span class="hint">${all.filter(habitDoneToday).length} de ${all.length} hábitos</span></div>
    <div class="rato-meter" style="max-width:none"><div class="nums"><span>⭐ ${pts} puntos</span><span>objetivo ${goal}</span></div><div class="bar"><i style="width:${Math.min(100, pts / goal * 100)}%"></i></div></div></section>`;
  if (!all.length) {
    return html + `<div class="empty"><strong>Aún no tienes hábitos</strong><span>Crea los que quieres cumplir y los que quieres dejar.</span>
      <button class="btn primary" data-act="hseed" style="margin-top:10px">Añadir los que me dijiste</button>
      <span class="hint">Leer, 15' de silencio, estirar, 10.000 pasos, meditar, inglés, limpiar fotos · y dejar pantallas antes de dormir y scrollear de más</span></div>
      <button class="btn block" data-act="hnew">+ Nuevo hábito</button>`;
  }
  const sec = (title, list) => list.length ? `<h2 class="group"><span>${title}</span><span>${list.length}</span></h2><div class="habs">${list.map(h => habitRowHTML(h, false)).join('')}</div>` : '';
  html += sec('Cada día', all.filter(h => h.kind === 'build' && h.freq === 'daily'));
  html += sec('Cada semana', all.filter(h => h.kind === 'build' && h.freq === 'weekly'));
  html += sec('Para dejar', all.filter(h => h.kind === 'quit'));
  return html + `<button class="btn block" data-act="hnew" style="margin-top:14px">+ Nuevo hábito</button>`;
}
const SEED_HABITS = [
  { name: 'Leer', kind: 'build', freq: 'daily', minutes: 20 },
  { name: "15' de silencio", kind: 'build', freq: 'daily', minutes: 15 },
  { name: 'Estirar por las mañanas', kind: 'build', freq: 'daily', minutes: 10 },
  { name: '10.000 pasos', kind: 'build', freq: 'daily', minutes: 30 },
  { name: 'Meditar', kind: 'build', freq: 'daily', minutes: 10 },
  { name: 'Estudiar inglés', kind: 'build', freq: 'daily', minutes: 20 },
  { name: 'Limpieza de fotos', kind: 'build', freq: 'daily', minutes: 5 },
  { name: 'Pantallas antes de dormir', kind: 'quit', freq: 'daily', minutes: 15 },
  { name: 'Scrollear de más', kind: 'quit', freq: 'daily', minutes: 15 },
];
function seedHabits() {
  const base = Date.now();
  SEED_HABITS.forEach((s, i) => { const h = { id: 'h' + uid(), ...cleanHabit({ ...s, order: base + i }) }; habits.push(h); store.putHabit(h).catch(writeFailed); });
  render();
}
// Hoja de hábito
let editingHabit = null, hKind = 'build', hFreq = 'daily';
function renderHabitChips() {
  document.querySelectorAll('#hKind [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === hKind));
  document.querySelectorAll('#hFreq [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === hFreq));
  $('#hFreqField').hidden = hKind === 'quit';
  $('#hTargetField').hidden = hKind === 'quit' || hFreq !== 'weekly';
  $('#hMinLabel').textContent = hKind === 'quit' ? 'Puntos por cada día que lo evitas' : 'Minutos (= puntos al cumplirlo)';
}
function openHabit(id) {
  const h = id ? habits.find(x => x.id === id) : null;
  editingHabit = h ? h.id : null;
  hKind = h ? h.kind : 'build'; hFreq = h ? h.freq : 'daily';
  $('#hName').value = h ? h.name : ''; $('#hTarget').value = h ? h.target : 3; $('#hMin').value = h ? h.minutes : 10;
  $('#habitTitle').textContent = h ? 'Editar hábito' : 'Nuevo hábito';
  $('#hSave').textContent = h ? 'Guardar' : 'Crear hábito';
  $('#hDelete').hidden = !h; $('#hDelete').textContent = 'Borrar hábito'; hDelArmed = false;
  $('#hSuggest').hidden = !!h;
  renderHabitChips(); openSheet('#habitSheet');
  if (!h) setTimeout(() => $('#hName').focus(), 60);
}
let hDelArmed = false;
$('#hKind').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hKind = b.dataset.v; renderHabitChips(); } });
$('#hFreq').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hFreq = b.dataset.v; renderHabitChips(); } });
$('#hSuggest').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  const s = SEED_HABITS[+b.dataset.i]; $('#hName').value = s.name; hKind = s.kind; hFreq = s.freq; $('#hMin').value = s.minutes; renderHabitChips();
});
$('#hSuggest').innerHTML = SEED_HABITS.map((s, i) => `<button type="button" class="chip" data-i="${i}">${s.kind === 'quit' ? '🚫 ' : ''}${esc(s.name)}</button>`).join('');
$('#habitSheet').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#hName').value.trim(); if (!name) { $('#hName').focus(); return; }
  const data = { name, kind: hKind, freq: hFreq, target: Number($('#hTarget').value) || 3, minutes: Number($('#hMin').value) || 10 };
  let h = editingHabit ? habits.find(x => x.id === editingHabit) : null;
  if (h) Object.assign(h, cleanHabit({ ...h, ...data }));
  else { h = { id: 'h' + uid(), ...cleanHabit({ ...data, order: Date.now() }) }; habits.push(h); }
  store.putHabit(h).catch(writeFailed); closeSheets(); render();
});
$('#hDelete').addEventListener('click', () => {
  if (!hDelArmed) { hDelArmed = true; $('#hDelete').textContent = 'Toca otra vez: se borra con todo su historial'; return; }
  const id = editingHabit; habits = habits.filter(x => x.id !== id);
  store.removeHabit(id).catch(writeFailed); closeSheets(); render();
});

// ---------- Resumen y puntos ----------
function summaryHTML() {
  const today = todayISO(), mon = mondayOf(today);
  const week = [...Array(7)].map((_, i) => addDays(mon, i));
  const ptsWeek = week.reduce((s, d) => s + pointsOn(d), 0);
  const doneWeek = tasks.filter(t => t.done && t.doneAt && !t.rota && isoDate(new Date(t.doneAt)) >= mon);
  const ratoWeek = week.reduce((s, d) => s + (rato.log[d]?.n || 0), 0), ratoMin = week.reduce((s, d) => s + (rato.log[d]?.min || 0), 0);
  const maxP = Math.max(stats.goal, ...week.map(pointsOn));
  const byCatCount = {};
  doneWeek.forEach(t => { byCatCount[t.cat || ''] = (byCatCount[t.cat || ''] || 0) + 1; });
  week.forEach(d => (rato.log[d]?.ids || []).forEach(id => { const t = tasks.find(x => x.id === id); const c = t ? t.cat || '' : 'casa'; byCatCount[c] = (byCatCount[c] || 0) + 1; }));
  const maxC = Math.max(1, ...Object.values(byCatCount));
  return `<section class="summary">
    <div class="rato-head"><h2>Esta semana</h2><button class="btn ghost small" data-act="goal">Objetivo: ${stats.goal} ⭐/día</button></div>
    <div class="kpis">
      <div class="kpi"><b>${pointsOn(today)}</b><span>puntos hoy</span></div>
      <div class="kpi"><b>${ptsWeek}</b><span>puntos semana</span></div>
      <div class="kpi"><b>${doneWeek.length + ratoWeek}</b><span>tareas hechas</span></div>
    </div>
    <div class="weekbars">${week.map((d, i) => { const p = pointsOn(d); return `<div class="wb ${d === today ? 'today' : ''}"><span class="v">${p || ''}</span><div class="col"><i style="height:${p / maxP * 100}%"></i><b style="bottom:${stats.goal / maxP * 100}%"></b></div><span>${DAY_LETTER[DAY_ORDER[i]]}</span></div>`; }).join('')}</div>
    ${ratoMin ? `<p class="hint">🏠 ${ratoMin} min de casa esta semana</p>` : ''}
    ${Object.keys(byCatCount).length ? `<div class="catbars">${Object.entries(byCatCount).sort((a, b) => b[1] - a[1]).map(([id, n]) => { const c = catOf(id); return `<div class="catbar" style="--c:${colorVar(c.color)}"><span>${esc(c.name)}</span><div class="bar"><i style="width:${n / maxC * 100}%"></i></div><span>${n}</span></div>`; }).join('')}</div>` : ''}
  </section>`;
}
// ---------- Progreso: cuánto de lo que tocaba cada día se ha cumplido ----------
let selectedDay = null;
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function buildProgress() {
  const today = todayISO(), tot = {}, area = {};
  const add = (key, d, due, done) => {
    for (const m of [tot, (area[key] ||= {})]) { const e = (m[d] ||= { due: 0, done: 0 }); e.due += due; e.done += done; }
  };
  tasks.forEach(t => {
    const key = 'c:' + (t.cat || '');
    if (t.date && t.date <= today && !t.rota) add(key, t.date, 1, t.done ? 1 : 0);          // tocaba ese día
    else if (t.done && t.doneAt) { const d = isoDate(new Date(t.doneAt)); add(key, d, 1, 1); } // hecha sin fecha: suma
  });
  Object.entries(rato.log).forEach(([d, l]) => { if (l.n) add('c:casa', d, l.n, l.n); });
  habits.forEach(h => {
    const key = 'h:' + h.id;
    if (h.freq === 'weekly') { Object.keys(h.log).forEach(d => { if (h.log[d] === 1 && d <= today) add(key, d, 1, 1); }); return; }
    const start = isoDate(new Date(h.order));
    const first = Object.keys(h.log).sort()[0];
    let d = first && first < start ? first : start, n = 0;
    while (d <= today && n++ < 800) { add(key, d, 1, h.log[d] === 1 ? 1 : 0); d = addDays(d, 1); }
  });
  return { tot, area };
}
const level = e => {
  if (!e || !e.due) return -1;
  const r = Math.min(1, e.done / e.due);
  return r === 0 ? 0 : r <= .25 ? 1 : r <= .5 ? 2 : r < 1 ? 3 : 4;
};
const cell = (e, d, today) => `<i class="lv${level(e)}${d > today ? ' fut' : ''}${d === selectedDay ? ' sel' : ''}" data-act="yday" data-d="${d}"></i>`;
function yearHTML(p) {
  const today = todayISO(), y = parseISO(today).getFullYear();
  let rows = '';
  for (let m = 0; m < 12; m++) {
    const dim = new Date(y, m + 1, 0).getDate();
    rows += `<span class="ml">${MONTHS_SHORT[m]}</span>`;
    for (let day = 1; day <= 31; day++) {
      if (day > dim) { rows += '<i class="na"></i>'; continue; }
      const d = `${y}-${pad(m + 1)}-${pad(day)}`;
      rows += cell(p.tot[d], d, today);
    }
  }
  let detail = 'Toca un cuadrado para ver ese día.';
  if (selectedDay) {
    const e = p.tot[selectedDay], name = parseISO(selectedDay).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    detail = `${name.charAt(0).toUpperCase() + name.slice(1)}: ${e && e.due ? `${e.done} de ${e.due} cosas cumplidas` : 'nada que hacer'} · ⭐ ${pointsOn(selectedDay)}`;
  }
  return `<section class="summary"><div class="rato-head"><h2>${y}</h2>
      <span class="legend">Menos <i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i> Todo</span></div>
    <div class="year">${rows}</div><p class="hint" id="dayDetail">${detail}</p></section>`;
}
function monthHTML(p) {
  const today = todayISO(), now = parseISO(today), y = now.getFullYear(), m = now.getMonth();
  const dim = new Date(y, m + 1, 0).getDate(), days = [...Array(dim)].map((_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
  const past = days.filter(d => d <= today && p.tot[d]?.due);
  const full = past.filter(d => level(p.tot[d]) === 4).length;
  const avg = past.length ? Math.round(past.reduce((s, d) => s + Math.min(1, p.tot[d].done / p.tot[d].due), 0) / past.length * 100) : 0;
  const ptsMonth = days.reduce((s, d) => s + pointsOn(d), 0);
  let streak = 0; for (let d = level(p.tot[today]) === 4 ? today : addDays(today, -1); level(p.tot[d]) === 4 && streak < 400; d = addDays(d, -1)) streak++;
  const name = now.toLocaleDateString('es-ES', { month: 'long' });
  return `<section class="summary"><div class="rato-head"><h2>${name.charAt(0).toUpperCase() + name.slice(1)}</h2><span class="hint">${avg}% de media</span></div>
    <div class="kpis">
      <div class="kpi"><b>${full}</b><span>días al 100%</span></div>
      <div class="kpi"><b>${streak}</b><span>días seguidos al 100%</span></div>
      <div class="kpi"><b>${ptsMonth}</b><span>puntos del mes</span></div>
    </div>
    <div class="mchart" style="--n:${dim}">${days.map(d => {
      const e = p.tot[d], r = e && e.due ? Math.min(1, e.done / e.due) : 0;
      return `<div class="mc ${d === today ? 'today' : ''} ${d > today ? 'fut' : ''}" data-act="yday" data-d="${d}"><i class="lv${level(e)}" style="height:${d > today ? 0 : Math.max(e?.due ? 6 : 0, r * 100)}%"></i></div>`;
    }).join('')}</div>
    <div class="mticks"><span>1</span><span>${Math.ceil(dim / 2)}</span><span>${dim}</span></div>
  </section>`;
}
function areasHTML(p) {
  const today = todayISO(), now = parseISO(today), y = now.getFullYear(), m = now.getMonth();
  const dim = new Date(y, m + 1, 0).getDate(), days = [...Array(dim)].map((_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
  const row = (label, color, map) => {
    const past = days.filter(d => d <= today && map?.[d]?.due);
    if (!past.length) return '';
    const pct = Math.round(past.reduce((s, d) => s + Math.min(1, map[d].done / map[d].due), 0) / past.length * 100);
    return `<div class="area" style="--g:${color}"><div class="an"><span>${esc(label)}</span><span>${pct}%</span></div><div class="acells" style="--n:${dim}">${days.map(d => cell(map?.[d], d, today)).join('')}</div></div>`;
  };
  // Todos los hábitos juntos
  const allH = {};
  habits.forEach(h => Object.entries(p.area['h:' + h.id] || {}).forEach(([d, e]) => { const a = (allH[d] ||= { due: 0, done: 0 }); a.due += e.due; a.done += e.done; }));
  let html = row('Todos los hábitos', 'var(--k-verde)', allH);
  html += cats.map(c => row(c.name, colorVar(c.color), p.area['c:' + c.id])).join('');
  html += sortedHabits().map(h => row(h.name, h.kind === 'quit' ? 'var(--k-turquesa)' : 'var(--k-verde)', p.area['h:' + h.id])).join('');
  return html ? `<section class="summary"><div class="rato-head"><h2>Por apartado</h2><span class="hint">este mes</span></div><div class="areas">${html}</div></section>` : '';
}
function progressHTML() {
  const p = buildProgress();
  return summaryHTML() + monthHTML(p) + yearHTML(p) + areasHTML(p) + `<h2 class="group" style="margin-top:22px"><span>Tareas hechas</span></h2>`;
}

// ---------- Pintar ----------
const prioRank = { alta: 0, normal: 1, baja: 2 };
const sortTasks = (a, b) => (a.date || '9999').localeCompare(b.date || '9999')
  || (a.time || '99').localeCompare(b.time || '99')
  || prioRank[a.prio || 'normal'] - prioRank[b.prio || 'normal'] || (a.created || 0) - (b.created || 0);
function inView(x, v) {
  const t = todayISO();
  if (v === 'hoy') return !x.done && x.date && x.date <= t;
  if (v === 'proximas') return !x.done && x.date && x.date > t;
  if (v === 'sinfecha') return !x.done && !x.date && !x.rota;
  return x.done;
}
// La racha se rompe si la tarea repetida se ha quedado atrasada
const currentStreak = t => (t.date && t.date < todayISO()) ? 0 : (t.streak || 0);
function taskHTML(x) {
  const cat = catOf(x.cat), c = colorVar(cat.color);
  const late = !x.done && x.date && x.date < todayISO();
  const showDate = x.date && (view === 'hechas' || late || query);
  const subs = x.subtasks || [], nDone = subs.filter(s => s.done).length, open = expanded.has(x.id);
  const meta = [
    `<span class="catn"><span class="dot" style="background:${c}"></span>${esc(cat.name)}</span>`,
    x.time ? `<span>${x.time}</span>` : '',
    showDate ? `<span class="${late ? 'late' : ''}">${friendlyDate(x.date)}</span>` : '',
    x.repeat ? `<span>↻ ${repeatLabel(x)}</span>` : '',
    x.repeat && !x.done && currentStreak(x) >= 2 ? `<span class="streak">🔥 ${currentStreak(x)}</span>` : '',
    x.rota ? `<span>🏠 ${x.minutes || 15} min</span>` : (x.minutes && !x.done ? `<span>${x.minutes} min</span>` : ''),
    x.done && x.pts ? `<span>+${x.pts} ⭐</span>` : '',
    subs.length ? `<button class="subpill ${nDone === subs.length ? 'all' : ''}" data-act="subs" data-id="${x.id}" aria-expanded="${open}">☑ ${nDone}/${subs.length}</button>` : '',
    x.prio === 'alta' && !x.done ? `<span class="prio">Alta</span>` : '',
  ].join('');
  const subsHTML = subs.length && open ? `<ul class="subs">${subs.map(s => `<li><button class="${s.done ? 'on' : ''}" data-act="sub" data-id="${x.id}" data-sub="${esc(s.id)}"><span class="box">${TICK('var(--surface)')}</span><span>${esc(s.text)}</span></button></li>`).join('')}</ul>` : '';
  return `<li class="task ${x.done ? 'done' : ''}" data-id="${x.id}" style="--c:${c}">
    <div class="swipe-bg" aria-hidden="true">
      <span class="l"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>${x.done ? 'Pendiente' : 'Hecha'}</span>
      <span class="r">Borrar<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span>
    </div>
    <div class="row">
      <button class="check" data-act="toggle" data-id="${x.id}" aria-label="${x.done ? 'Marcar como pendiente' : 'Completar'}: ${esc(x.title)}">${TICK('var(--surface)')}</button>
      <div class="body" data-act="edit" data-id="${x.id}">
        <div class="t">${esc(x.title)}</div>
        <div class="meta">${meta}</div>
        ${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ''}
        ${subsHTML}
      </div>
      <button class="more" data-act="edit" data-id="${x.id}" aria-label="Editar ${esc(x.title)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
  </li>`;
}
const EMPTY = {
  hoy: ['Nada pendiente para hoy', 'Pulsa + para apuntar algo.'],
  proximas: ['Nada programado', 'Escribe “mañana” o una fecha al crear una tarea.'],
  sinfecha: ['No hay tareas sin fecha', 'Úsalo para ideas y cosas sin día fijo.'],
  hechas: ['Aún no has completado nada', 'Toca el círculo o desliza una tarea a la derecha.'],
};
function render() {
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#viewTitle').textContent = query ? 'Buscar' : VIEWS[view];
  $('#ptsToday').textContent = `⭐ ${pointsOn(todayISO())}`;
  $('#filters').hidden = view === 'habitos' && !query;
  $('#fab').setAttribute('aria-label', view === 'habitos' && !query ? 'Nuevo hábito' : 'Nueva tarea');
  const byCat = x => catFilter === null || (x.cat || '') === catFilter;
  document.querySelectorAll('#tabs button').forEach(b => {
    const v = b.dataset.view;
    b.setAttribute('aria-selected', !query && v === view);
    const badge = b.querySelector('.badge');
    const n = v === 'hoy' ? tasks.filter(x => inView(x, 'hoy')).length : 0;
    badge.hidden = !n; badge.textContent = n;
  });
  const hasOrphans = tasks.some(t => !cats.some(c => c.id === t.cat));
  $('#filters').innerHTML = `<button class="chip" data-filter="*" aria-pressed="${catFilter === null}">Todas</button>` +
    cats.map(c => `<button class="chip" data-filter="${esc(c.id)}" aria-pressed="${catFilter === c.id}"><span class="dot" style="background:${colorVar(c.color)}"></span>${esc(c.name)}</button>`).join('') +
    (hasOrphans ? `<button class="chip" data-filter="" aria-pressed="${catFilter === ''}">Sin categoría</button>` : '') +
    `<button class="chip edit" data-filter="edit">Editar</button>`;

  if (!loaded) { $('#list').innerHTML = `<div class="empty"><strong>Cargando tus tareas…</strong></div>`; $('#stats').textContent = ''; return; }
  let list;
  if (query) {
    list = tasks.filter(x => byCat(x) && matches(x, query)).sort((a, b) => (a.done - b.done) || sortTasks(a, b));
    $('#list').innerHTML = list.length ? `<ul class="list">${list.map(taskHTML).join('')}</ul>`
      : `<div class="empty"><strong>Nada con “${esc(query)}”</strong><span>Busca por título, notas o pasos.</span></div>`;
  } else if (view === 'habitos') {
    list = [];
    $('#list').innerHTML = habitsViewHTML();
  } else if (view === 'semana' && agendaMode === 'semana') {
    list = tasks.filter(x => byCat(x) && x.date);
    $('#list').innerHTML = agendaSwitchHTML() + weekHTML(byCat);
  } else {
    const v = view === 'semana' ? 'proximas' : view;
    list = tasks.filter(x => byCat(x) && inView(x, v));
    if (v === 'hechas') list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)); else list.sort(sortTasks);
    let html = '';
    if (v === 'hoy') html += habitsTodayHTML() + ratoHTML();
    if (v === 'hechas') html += progressHTML();
    if (view === 'semana') html += agendaSwitchHTML();
    if (!list.length) {
      const [h, p] = EMPTY[v];
      html += `<div class="empty"><strong>${h}</strong><span>${p}</span></div>`;
    } else if (v === 'hechas' || v === 'sinfecha') {
      html += `<ul class="list">${list.map(taskHTML).join('')}</ul>`;
    } else {
      const t = todayISO(), groups = new Map();
      list.forEach(x => { const g = x.date < t ? 'Atrasadas' : friendlyDate(x.date); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); });
      html += [...groups].map(([g, items]) =>
        `<h2 class="group ${g === 'Atrasadas' ? 'late' : ''}"><span>${g}</span><span>${items.length}</span></h2><ul class="list">${items.map(taskHTML).join('')}</ul>`).join('');
    }
    if (v === 'sinfecha') {
      const q = rotaTasks().filter(byCat);
      if (q.length) {
        const m = q.reduce((s, t) => s + (t.minutes || 15), 0);
        html += `<h2 class="group"><span>Cola del rato de casa</span><span>${q.length} · ${Math.floor(m / 60)} h ${m % 60} min</span></h2><ul class="list">${q.map(taskHTML).join('')}</ul>`;
        list = list.concat(q);
      }
    }
    $('#list').innerHTML = html;
  }
  const pending = tasks.filter(x => !x.done).length;
  const doneToday = tasks.filter(x => x.done && x.doneAt && isoDate(new Date(x.doneAt)) === todayISO()).length;
  $('#stats').textContent = `${pending} pendiente${pending === 1 ? '' : 's'} · ${doneToday} hecha${doneToday === 1 ? '' : 's'} hoy`;
  let tipSeen = false; try { tipSeen = localStorage.getItem('tip-swipe') === '1'; } catch {}
  $('#tip').hidden = tipSeen || !list.length;
  $('#clearDone').hidden = !(view === 'hechas' && !query && tasks.some(x => x.done));
  if (!clearArmed) $('#clearDone').textContent = 'Borrar las hechas';
}
$('#list').addEventListener('click', e => {
  if (suppressClick) return;
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id } = el.dataset;
  if (act === 'toggle') toggle(id);
  else if (act === 'subs') { expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); }
  else if (act === 'sub') toggleSub(id, el.dataset.sub);
  else if (act === 'rdone') rotaDone(id);
  else if (act === 'rskip') rotaSkip(id);
  else if (act === 'radj') ratoAdjust(Number(el.dataset.d));
  else if (act === 'wprev' || act === 'wnext') { weekOffset += act === 'wnext' ? 1 : -1; render(); }
  else if (act === 'wtoday') { weekOffset = 0; render(); }
  else if (act === 'amode') { agendaMode = el.dataset.m; render(); }
  else if (act === 'hok') setHabit(id, 1);
  else if (act === 'hbad') setHabit(id, -1);
  else if (act === 'hedit') openHabit(id);
  else if (act === 'hnew') openHabit(null);
  else if (act === 'hseed') seedHabits();
  else if (act === 'gohabits') { view = 'habitos'; $('#scroller').scrollTop = 0; render(); }
  else if (act === 'goal') openGoal();
  else if (act === 'yday') { selectedDay = selectedDay === el.dataset.d ? null : el.dataset.d; const y = $('#scroller').scrollTop; render(); $('#scroller').scrollTop = y; }
  else if (act === 'edit') openForm(id);
});
function agendaSwitchHTML() {
  return `<div class="chips" style="margin:2px 0 8px"><button class="chip" data-act="amode" data-m="semana" aria-pressed="${agendaMode === 'semana'}">Semana</button><button class="chip" data-act="amode" data-m="lista" aria-pressed="${agendaMode === 'lista'}">Todo lo próximo</button></div>`;
}
function openGoal() { $('#goalInput').value = stats.goal; $('#goalMsg').hidden = true; openSheet('#goalSheet'); }
$('#goalForm').addEventListener('submit', e => {
  e.preventDefault();
  stats.goal = Math.max(10, Math.min(2000, Math.round(Number($('#goalInput').value)) || 100));
  store.saveGoal(stats.goal).catch(writeFailed);
  $('#goalMsg').textContent = 'Objetivo guardado.'; $('#goalMsg').hidden = false; render();
});
$('#openGoal').addEventListener('click', openGoal);
$('#ptsToday').addEventListener('click', openGoal);
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  if (query) { query = ''; $('#searchInput').value = ''; $('#searchBar').hidden = true; $('#searchBtn').setAttribute('aria-pressed', 'false'); }
  else if (view === b.dataset.view) { $('#scroller').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  view = b.dataset.view; $('#scroller').scrollTop = 0; render();
});
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  const f = b.dataset.filter;
  if (f === 'edit') { renderCatSheet(); openSheet('#catSheet'); return; }
  catFilter = f === '*' ? null : f; render();
});
// El consejo de deslizar desaparece la primera vez que se usa
$('#list').addEventListener('pointerup', () => { if (suppressClick) { try { localStorage.setItem('tip-swipe', '1'); } catch {} $('#tip').hidden = true; } });

let lastDay = todayISO();
const dayCheck = () => { if (todayISO() !== lastDay) { lastDay = todayISO(); render(); } };
setInterval(dayCheck, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) dayCheck(); });

// ---------- Funcionar sin conexión ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
initStore().catch(() => { loaded = true; setSync('warn', 'No se pudo conectar'); render(); });
