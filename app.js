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
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const TICK = c => `<svg viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>`;
const $ = s => document.querySelector(s);

let tasks = [];
let cats = DEFAULT_CATS;
let habits = [];
let stats = { goal: 100, days: {} };
let loaded = false;
let view = 'hoy';
let agendaMode = 'semana';
let weekOffset = 0;
let catFilter = null;
let query = '';
let showDone = false;
let selectedDay = null;
// Estado del formulario de tarea
let editingId = null, formCat = 'personal', formDays = [], formParts = [], formNoDate = false, splitDays = [1, 2, 3, 4, 5];

// ---------- Que no parezca una web ----------
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, .code')) e.preventDefault(); });

// ---------- Utilidades ----------
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
const mondayOf = iso => addDays(iso, -((parseISO(iso).getDay() + 6) % 7));
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Día concreto del mes (1–31, o -1 = último día) en el mes de "iso" + n meses
function monthDate(iso, n, md) {
  const d = parseISO(iso), y = d.getFullYear(), m = d.getMonth() + n;
  const last = dim(y, m);
  return isoDate(new Date(y, m, md === -1 ? last : Math.min(md || d.getDate(), last)));
}
function stepDate(t, x) {
  const days = Array.isArray(t.days) && t.days.length ? t.days : null;
  if (t.repeat === 'diario') return addDays(x, 1);
  if (t.repeat === 'mensual') return monthDate(x, 1, t.monthDay);
  if (t.repeat === 'dias' && days) { let y = x; do { y = addDays(y, 1); } while (!days.includes(parseISO(y).getDay())); return y; }
  return addDays(x, 7);
}
// Siguiente repetición (nunca en el pasado); null si ya ha pasado la fecha de fin
function nextDate(t) {
  let d = t.date || todayISO(), n = 0;
  do { d = stepDate(t, d); } while (d <= todayISO() && n++ < 1000);
  return t.until && d > t.until ? null : d;
}
// Coloca la primera fecha en un día válido de la repetición (hoy incluido)
function alignStart(t) {
  if (!t.date) return;
  if (t.repeat === 'dias' && t.days.length) { for (let i = 0; i < 7 && !t.days.includes(parseISO(t.date).getDay()); i++) t.date = addDays(t.date, 1); }
  if (t.repeat === 'mensual' && t.monthDay) { const c = monthDate(t.date, 0, t.monthDay); t.date = c >= t.date ? c : monthDate(t.date, 1, t.monthDay); }
}
function friendlyDate(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoy';
  if (iso === addDays(t, 1)) return 'Mañana';
  if (iso === addDays(t, -1)) return 'Ayer';
  const d = parseISO(iso), o = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return cap(d.toLocaleDateString('es-ES', o));
}
function longDate(iso) {
  const f = friendlyDate(iso), d = parseISO(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  return ['Hoy', 'Mañana', 'Ayer'].includes(f) ? `${f} · ${d}` : f;
}
const repeatLabel = t => t.repeat === 'diario' ? 'Cada día' : t.repeat === 'semanal' ? 'Cada semana'
  : t.repeat === 'mensual' ? (t.monthDay === -1 ? 'Último día de cada mes' : `El ${t.monthDay || parseISO(t.date || todayISO()).getDate()} de cada mes`)
  : t.repeat === 'dias' ? DAY_ORDER.filter(d => (t.days || []).includes(d)).map(d => DAY_LETTER[d]).join(' ') : '';
const catOf = id => cats.find(c => c.id === id) || NO_CAT;
const colorVar = c => `var(--k-${COLORS.includes(c) ? c : 'gris'})`;
const children = id => tasks.filter(x => x.parentId === id);
const progressOf = id => { const ch = children(id); return { done: ch.filter(c => c.done).length, total: ch.length }; };
const durationMin = t => t.date && t.time && t.endTime ? ((toMin(t.endTime) - toMin(t.time) + 1440) % 1440) || null : null;
// Puntos: los que pongas a mano; si no, la duración (hora inicio–fin) o los minutos; si no hay nada, 10
const autoPoints = t => durationMin(t) || (Number(t.minutes) > 0 ? Math.round(Number(t.minutes)) : 10);
const taskPoints = t => t.points !== null && t.points !== undefined && t.points !== '' ? Number(t.points) : autoPoints(t);
const isLate = x => !x.done && x.date && x.date < todayISO();

function clean(t) {
  const num = v => v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
  return {
    title: String(t.title || '').slice(0, 300), cat: String(t.cat ?? 'personal'),
    date: t.date || '', time: t.date ? (t.time || '') : '', endTime: t.date && t.time ? (t.endTime || '') : '',
    prio: t.prio || 'normal', repeat: t.date ? (t.repeat || '') : '',
    days: Array.isArray(t.days) ? t.days.filter(d => d >= 0 && d <= 6) : [],
    monthDay: num(t.monthDay), until: t.until || '',
    notes: String(t.notes || ''), done: !!t.done, doneAt: t.doneAt || null, created: t.created || Date.now(), spawned: !!t.spawned,
    remind: num(t.remind), minutes: Number(t.minutes) > 0 ? Math.min(480, Math.round(Number(t.minutes))) : null,
    points: num(t.points) === null ? null : Math.max(0, Math.min(1000, Math.round(num(t.points)))),
    parentId: t.parentId || '',
    streak: Number(t.streak) || 0, best: Number(t.best) || 0,
    history: Array.isArray(t.history) ? t.history.filter(d => typeof d === 'string').slice(-120) : [],
    pts: Number(t.pts) || 0, ptsDay: t.ptsDay || '',
  };
}
function cleanHabit(h) {
  const log = {};
  Object.entries(h.log || {}).sort().slice(-400).forEach(([k, v]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(k) && [1, -1].includes(Number(v))) log[k] = Number(v); });
  const kind = ['quit', 'sleep'].includes(h.kind) ? h.kind : 'build';
  const hm = (v, d) => /^\d{2}:\d{2}$/.test(v || '') ? v : d;
  const out = {
    name: String(h.name || '').slice(0, 80), kind,
    freq: kind === 'build' && h.freq === 'weekly' ? 'weekly' : 'daily',
    target: Math.min(7, Math.max(1, Number(h.target) || 3)),
    minutes: Number(h.minutes) > 0 ? Math.min(240, Math.round(Number(h.minutes))) : 10,
    order: Number(h.order) || Date.now(), log,
  };
  if (kind === 'sleep') {
    const nights = {};
    Object.entries(h.nights || {}).sort().slice(-400).forEach(([k, v]) => { if (log[k] !== undefined && v && hm(v.bed) && hm(v.wake)) nights[k] = { bed: v.bed, wake: v.wake }; });
    Object.assign(out, { bed: hm(h.bed, '23:30'), wakeWk: hm(h.wakeWk, '07:15'), wakeWe: hm(h.wakeWe, '08:15'),
      hours: Math.min(12, Math.max(4, Number(h.hours) || 7.5)), tol: Math.min(60, Math.max(0, Number(h.tol ?? 15))), nights });
  }
  return out;
}

// ---------- Almacenamiento ----------
const LKEY = 'mis-tareas-v1', LCATS = 'mis-tareas-cats', LHAB = 'mis-tareas-habitos', LSTATS = 'mis-tareas-puntos';
const local = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const store = {
  fb: null, uid: null, user: null, authLib: null,
  ref(...p) { return this.fb.doc(this.fb.db, 'users', this.uid, ...p); },
  async put(t) { if (!this.fb) return local(LKEY, tasks); return this.fb.setDoc(this.ref('tasks', t.id), clean(t)); },
  async remove(id) { if (!this.fb) return local(LKEY, tasks); return this.fb.deleteDoc(this.ref('tasks', id)); },
  async putMany(list) {
    if (!this.fb) { list.forEach(t => { const i = tasks.findIndex(x => x.id === t.id); if (i >= 0) tasks[i] = t; else tasks.push(t); }); return local(LKEY, tasks); }
    for (let i = 0; i < list.length; i += 400) {
      const b = this.fb.writeBatch(this.fb.db);
      list.slice(i, i + 400).forEach(t => b.set(this.ref('tasks', t.id), clean(t)));
      await b.commit();
    }
  },
  async saveCats(list) { cats = list; if (!this.fb) return local(LCATS, list); return this.fb.setDoc(this.ref('settings', 'categories'), { list }); },
  async putHabit(h) { if (!this.fb) return local(LHAB, habits); const { id, ...rest } = h; return this.fb.setDoc(this.ref('habits', id), cleanHabit(rest)); },
  async removeHabit(id) { if (!this.fb) return local(LHAB, habits); return this.fb.deleteDoc(this.ref('habits', id)); },
  async setHabitDay(h, day, val) {
    if (!this.fb) return local(LHAB, habits);
    return this.fb.setDoc(this.ref('habits', h.id), { log: { [day]: val === null ? this.fb.deleteField() : val } }, { merge: true });
  },
  async setSleep(h, day, val, night) {
    if (!this.fb) return local(LHAB, habits);
    const del = this.fb.deleteField();
    return this.fb.setDoc(this.ref('habits', h.id), { log: { [day]: val === null ? del : val }, nights: { [day]: val === null ? del : night } }, { merge: true });
  },
  async addPoints(n, day) { if (!this.fb) return local(LSTATS, stats); return this.fb.setDoc(this.ref('settings', 'stats'), { days: { [day]: this.fb.increment(n) } }, { merge: true }); },
  async saveGoal(goal) { if (!this.fb) return local(LSTATS, stats); return this.fb.setDoc(this.ref('settings', 'stats'), { goal }, { merge: true }); },
};
function setSync(kind, text) { $('#sync').className = 'sync ' + kind; $('#syncText').textContent = text; }
function writeFailed() { setSync('warn', 'No se guardó el último cambio'); }
function addPoints(n, day = todayISO()) {
  if (!n) return;
  stats.days[day] = Math.max(0, (stats.days[day] || 0) + n);
  store.addPoints(n, day).catch(writeFailed);
}
const pointsOn = d => Math.round(stats.days[d] || 0);

const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PEGA');

async function initStore() {
  if (!configured) {
    const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
    tasks = get(LKEY, []); cats = get(LCATS, DEFAULT_CATS);
    habits = get(LHAB, []).map(h => ({ id: h.id, ...cleanHabit(h) }));
    stats = { goal: 100, days: {}, ...get(LSTATS, {}) };
    loaded = true;
    setSync('warn', 'Solo en este dispositivo');
    $('#accountInfo').textContent = 'La sincronización no está configurada. Las tareas se guardan solo en este dispositivo.';
    document.querySelectorAll('[data-cloud]').forEach(b => b.hidden = true);
    migrate(); render();
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
  store.authLib = auth;
  let unsubs = [];
  setupLogin(a, auth); setupAccount(); setupSiri();

  auth.onAuthStateChanged(a, user => {
    unsubs.forEach(u => u()); unsubs = [];
    if (!user) {
      store.fb = null; store.user = null; tasks = []; cats = DEFAULT_CATS; habits = []; stats = { goal: 100, days: {} }; loaded = false;
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
      adoptSiriTasks(); migrate();
      render();
    }, () => { clearTimeout(slow); loaded = true; setSync('warn', 'No se pudo sincronizar'); render(); }));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'categories'), snap => {
      const list = snap.exists() ? snap.data().list : null;
      cats = Array.isArray(list) ? list : DEFAULT_CATS;
      render(); if (!$('#catSheet').hidden) renderCatSheet();
    }, () => {}));
    unsubs.push(fs.onSnapshot(fs.collection(db, 'users', user.uid, 'habits'), snap => {
      habits = snap.docs.map(d => ({ id: d.id, ...cleanHabit(d.data()) })); render();
    }, () => {}));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'stats'), snap => {
      const d = snap.exists() ? snap.data() : {};
      stats = { goal: Number(d.goal) > 0 ? Number(d.goal) : 100, days: d.days && typeof d.days === 'object' ? d.days : {} };
      render();
    }, () => {}));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'siri'), snap => { siriKey = snap.exists() ? snap.data().key : null; renderSiri(); }, () => {}));
  });
  $('#logoutBtn').addEventListener('click', () => { closeSheets(); auth.signOut(a); });
}

// Las tareas que llegan desde Siri traen solo el texto dictado: aquí se interpretan y se completan.
const adopting = new Set();
function adoptSiriTasks() {
  tasks.filter(t => t.siriKey !== undefined && !adopting.has(t.id)).forEach(t => {
    adopting.add(t.id);
    const p = parseQuick(t.title, cats);
    const full = { id: t.id, title: p.title, cat: p.cat || (cats[0]?.id ?? ''), date: p.date ?? todayISO(), time: p.time || '', endTime: p.endTime || '',
      prio: p.prio || 'normal', repeat: p.repeat || '', days: p.days || [], notes: '', done: false, created: Date.now() };
    alignStart(full);
    Object.keys(t).forEach(k => delete t[k]); Object.assign(t, full);
    store.put(full).catch(writeFailed);
  });
}

// Arreglos automáticos de datos antiguos (solo tocan lo que lo necesita)
const migrated = new Set();
function migrate() {
  const fixes = [];
  tasks.forEach(t => {
    if (migrated.has(t.id) || t.siriKey !== undefined) return;
    migrated.add(t.id);
    const n = (t.notes || '').trim(); let ch = null, m;
    // Horas en las notas ("20:00–23:00") → hora de inicio y fin
    if ((m = n.match(/^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/)) && t.date) {
      ch = { time: t.time || `${pad(+m[1])}:${m[2]}`, endTime: `${pad(+m[3])}:${m[4]}`, notes: '' };
    } else if ((m = n.match(/^Sale de (.+?) a las (\d{1,2}):(\d{2}), llega a las (\d{1,2}):(\d{2})$/)) && t.date) {
      ch = { time: t.time || `${pad(+m[2])}:${m[3]}`, endTime: `${pad(+m[4])}:${m[5]}`, notes: `Sale de ${m[1]}` };
    } else if ((m = n.match(/^(\d+)\s*min$/i)) && !t.date) {
      ch = { minutes: +m[1], notes: '' }; // minutos de Rotación de la casa
    }
    // Los antiguos "pasos" pasan a ser partes de la tarea
    if (Array.isArray(t.subtasks) && t.subtasks.length) {
      t.subtasks.forEach((s, i) => {
        const part = { id: t.id + '-p' + i, title: s.text, cat: t.cat, date: '', done: !!s.done, doneAt: s.done ? Date.now() : null, parentId: t.id, created: (t.created || Date.now()) + i + 1 };
        tasks.push(part); fixes.push(part); migrated.add(part.id);
      });
      ch = { ...(ch || {}), subtasks: [] };
    }
    if (t.rota) ch = { ...(ch || {}), rota: '' };
    if (ch) { Object.assign(t, ch); delete t.subtasks; delete t.rota; fixes.push(t); }
  });
  if (fixes.length) store.putMany(fixes).catch(writeFailed);
}

// ---------- Acceso ----------
function setupLogin(a, auth) {
  const err = m => { $('#loginErr').textContent = m; $('#loginErr').hidden = !m; };
  const creds = () => [$('#email').value.trim(), $('#password').value];
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); err(''); try { await auth.signInWithEmailAndPassword(a, ...creds()); } catch (x) { err(authMsg(x)); } });
  $('#signupBtn').addEventListener('click', async () => { err(''); if (!$('#loginForm').reportValidity()) return; try { await auth.createUserWithEmailAndPassword(a, ...creds()); } catch (x) { err(authMsg(x)); } });
  $('#resetBtn').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) return err('Escribe tu correo y vuelve a pulsar.');
    try { await auth.sendPasswordResetEmail(a, email); err('Te he enviado un correo para cambiar la contraseña.'); } catch (x) { err(authMsg(x)); }
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
    catch (x) { if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(x.code)) throw { code: 'auth/current-password' }; throw x; }
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
    try { await reauth($('#oldPass').value); await store.authLib.updatePassword(store.user, $('#newPass').value); $('#passForm').reset(); say(msg, 'Contraseña cambiada.', true); }
    catch (x) { say(msg, authMsg(x)); }
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
    const el = $('#' + b.dataset.copy);
    try { await navigator.clipboard.writeText(el.textContent); $('#copyMsg').textContent = 'Copiado. Pégalo en Atajos.'; }
    catch { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copyMsg').textContent = 'Seleccionado: mantén pulsado y elige Copiar.'; }
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
// En ordenador, al pulsar un botón de fecha/hora se abre el selector
document.addEventListener('click', e => {
  const b = e.target.closest('.pickbtn'); if (!b || e.target.tagName === 'INPUT') return;
  const i = b.querySelector('input'); try { i?.showPicker?.(); } catch { i?.focus(); }
});

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
  store.saveCats([...cats, { id: 'c' + uid(), name, color: COLORS.find(c => !used.includes(c)) || COLORS[cats.length % COLORS.length] }]).catch(writeFailed);
  $('#catNew').value = ''; renderCatSheet(); render();
});

// ---------- Formulario de tarea ----------
function renderCatChips() {
  $('#catChips').innerHTML = cats.map(c =>
    `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${formCat === c.id}"><span class="dot" style="background:${colorVar(c.color)}"></span>${esc(c.name)}</button>`).join('')
    + `<button type="button" class="chip" data-cat="" aria-pressed="${formCat === ''}">Ninguna</button>`;
}
const dayChips = (sel, attr) => DAY_ORDER.map(d => `<button type="button" class="chip" ${attr}="${d}" aria-pressed="${sel.includes(d)}">${DAY_LETTER[d]}</button>`).join('');
function renderWhen() {
  const date = $('#date').value, rep = $('#repeat').value;
  $('#noDateBtn').setAttribute('aria-pressed', formNoDate);
  $('#dateBtn').classList.toggle('off', formNoDate);
  $('#dateText').textContent = formNoDate ? 'Sin fecha' : (date ? longDate(date) : 'Elige un día');
  $('#dateLabel').textContent = rep && !formNoDate ? 'Fecha (empieza)' : 'Fecha';
  $('#timeRow').hidden = formNoDate;
  $('#timeText').textContent = $('#time').value || '—';
  $('#endText').textContent = $('#endTime').value || '—';
  $('#endTime').disabled = !$('#time').value;
  $('#endTime').closest('.pickbtn').classList.toggle('off', !$('#time').value);
  $('#clearTimes').hidden = formNoDate || !$('#time').value;
  $('#minutesField').hidden = !formNoDate;
  $('#repeat').disabled = formNoDate || formParts.length > 0;
  if (formNoDate || formParts.length) $('#repeat').value = '';
  const r = $('#repeat').value;
  $('#repeatOpts').hidden = !r;
  $('#daysRow').hidden = r !== 'dias';
  if (r === 'dias') $('#daysRow').innerHTML = dayChips(formDays, 'data-day');
  $('#monthDayField').hidden = r !== 'mensual';
  $('#startText').textContent = date ? longDate(date) : '—';
  $('#untilText').textContent = $('#until').value ? longDate($('#until').value) : 'Nunca';
  $('#clearUntil').hidden = !$('#until').value;
  renderPointsHint();
}
function renderPointsHint() {
  const draft = { date: formNoDate ? '' : $('#date').value, time: $('#time').value, endTime: $('#endTime').value, minutes: $('#minutes').value };
  const auto = autoPoints(draft);
  $('#points').placeholder = `auto · ${auto}`;
  $('#pointsHint').textContent = $('#points').value === ''
    ? `Al completarla te dará ${auto} ⭐ (${durationMin(draft) ? 'su duración en minutos' : Number(draft.minutes) > 0 ? 'sus minutos' : 'por defecto'}). Escribe otro número para cambiarlo, o 0 para que no puntúe.`
    : `Al completarla te dará ${Number($('#points').value) || 0} ⭐.`;
}
function renderMonthDay() {
  const md = $('#monthDay').value;
  $('#monthDay').innerHTML = [...Array(31)].map((_, i) => `<option value="${i + 1}">El día ${i + 1}</option>`).join('') + '<option value="-1">El último día del mes</option>';
  $('#monthDay').value = md || String(parseISO($('#date').value || todayISO()).getDate());
}
function renderDetected() {
  if (editingId) { $('#detected').hidden = true; return; }
  const p = parseQuick($('#title').value, cats), bits = [];
  if (p.date) bits.push(friendlyDate(p.date));
  if (p.time) bits.push(p.time + (p.endTime ? '–' + p.endTime : ''));
  if (p.cat) bits.push('#' + catOf(p.cat).name);
  if (p.prio) bits.push('Prioridad alta');
  if (p.repeat) bits.push('↻ ' + repeatLabel({ ...p, date: p.date || $('#date').value }));
  $('#detected').innerHTML = bits.map(b => `<span>${esc(b)}</span>`).join('');
  $('#detected').hidden = !bits.length;
}
$('#catChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { formCat = b.dataset.cat; renderCatChips(); } });
$('#date').addEventListener('change', () => { if ($('#date').value) formNoDate = false; renderMonthDay(); renderWhen(); });
$('#noDateBtn').addEventListener('click', () => {
  formNoDate = !formNoDate;
  if (!formNoDate && !$('#date').value) $('#date').value = todayISO();
  renderWhen();
});
$('#time').addEventListener('change', renderWhen);
$('#endTime').addEventListener('change', renderWhen);
$('#clearTimes').addEventListener('click', () => { $('#time').value = ''; $('#endTime').value = ''; renderWhen(); });
$('#repeat').addEventListener('change', () => {
  if ($('#repeat').value === 'dias' && !formDays.length) formDays = [parseISO($('#date').value || todayISO()).getDay()];
  if ($('#repeat').value === 'mensual') renderMonthDay();
  renderWhen();
});
$('#daysRow').addEventListener('click', e => {
  const b = e.target.closest('[data-day]'); if (!b) return;
  const d = +b.dataset.day; formDays = formDays.includes(d) ? formDays.filter(x => x !== d) : [...formDays, d]; renderWhen();
});
$('#until').addEventListener('change', renderWhen);
$('#clearUntil').addEventListener('click', () => { $('#until').value = ''; renderWhen(); });
$('#minutes').addEventListener('input', renderPointsHint);
$('#points').addEventListener('input', renderPointsHint);
$('#title').addEventListener('input', renderDetected);

// --- Partes ---
function renderParts() {
  const done = formParts.filter(p => p.done).length;
  $('#partsCount').textContent = formParts.length ? `· ${done}/${formParts.length} (${Math.round(done / formParts.length * 100)}%)` : '';
  $('#partList').innerHTML = formParts.map((p, i) => `<div class="partrow" data-i="${i}">
    <button type="button" class="box" data-pact="toggle" aria-pressed="${p.done}" aria-label="Hecha">${TICK('var(--accent-ink)')}</button>
    <input class="inp" type="text" value="${esc(p.title)}" data-pact="title" aria-label="Parte">
    <label class="pickbtn"><span>${p.date ? friendlyDate(p.date) : 'Sin fecha'}</span><input type="date" value="${p.date}" data-pact="date" aria-label="Día de la parte"></label>
    <button type="button" class="x" data-pact="del" aria-label="Quitar parte">✕</button></div>`).join('');
  $('#splitDays').innerHTML = dayChips(splitDays, 'data-sday');
  $('#splitFromText').textContent = $('#splitFrom').value ? longDate($('#splitFrom').value) : 'Hoy';
  renderWhen();
}
function addPart(title, date) { formParts.push({ id: (editingId || 'nuevo') + '-' + uid(), title, date: date || '', done: false, isNew: true }); }
$('#partAdd').addEventListener('click', () => {
  const t = $('#partNew').value.trim(); if (!t) return;
  const last = formParts.map(p => p.date).filter(Boolean).sort().pop();
  addPart(t, last ? addDays(last, 1) : ''); $('#partNew').value = ''; renderParts();
});
$('#partNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#partAdd').click(); } });
$('#partList').addEventListener('click', e => {
  const b = e.target.closest('[data-pact]'); if (!b || b.tagName === 'INPUT') return;
  const i = +b.closest('.partrow').dataset.i;
  if (b.dataset.pact === 'toggle') formParts[i].done = !formParts[i].done;
  if (b.dataset.pact === 'del') formParts.splice(i, 1);
  renderParts();
});
$('#partList').addEventListener('input', e => { if (e.target.dataset.pact === 'title') formParts[+e.target.closest('.partrow').dataset.i].title = e.target.value; });
$('#partList').addEventListener('change', e => { if (e.target.dataset.pact === 'date') { formParts[+e.target.closest('.partrow').dataset.i].date = e.target.value; renderParts(); } });
$('#splitDays').addEventListener('click', e => {
  const b = e.target.closest('[data-sday]'); if (!b) return;
  const d = +b.dataset.sday; splitDays = splitDays.includes(d) ? splitDays.filter(x => x !== d) : [...splitDays, d]; renderParts();
});
$('#splitFrom').addEventListener('change', renderParts);
$('#splitGo').addEventListener('click', () => {
  const n = Math.max(1, Math.min(60, Number($('#splitN').value) || 0));
  const base = $('#splitName').value.trim() || $('#title').value.trim() || 'Parte';
  let d = $('#splitFrom').value || todayISO(), made = 0, guard = 0;
  const start = formParts.length;
  while (made < n && guard++ < 500) {
    if (!splitDays.length || splitDays.includes(parseISO(d).getDay())) { made++; addPart(`${base} ${start + made}`, d); }
    d = addDays(d, 1);
  }
  $('#splitBox').open = false; renderParts();
});

function openForm(id) {
  const t = id ? tasks.find(x => x.id === id) : null;
  editingId = t ? t.id : null;
  $('#title').value = t ? t.title : '';
  formCat = t ? (t.cat ?? '') : (catFilter || cats[cats.length - 1]?.id || '');
  if (!t && !cats.some(c => c.id === formCat)) formCat = cats[0]?.id || '';
  formNoDate = t ? !t.date : view === 'sinfecha';
  $('#date').value = t ? (t.date || todayISO()) : todayISO();
  $('#time').value = t ? (t.time || '') : '';
  $('#endTime').value = t ? (t.endTime || '') : '';
  $('#prio').value = t ? (t.prio || 'normal') : 'normal';
  $('#repeat').value = t ? (t.repeat || '') : '';
  formDays = t && Array.isArray(t.days) ? [...t.days] : [];
  $('#monthDay').value = '';
  renderMonthDay();
  if (t && t.monthDay) $('#monthDay').value = String(t.monthDay);
  $('#until').value = t ? (t.until || '') : '';
  $('#minutes').value = t && t.minutes ? t.minutes : '';
  $('#points').value = t && t.points !== null && t.points !== undefined ? t.points : '';
  $('#remind').value = t && t.remind !== null && t.remind !== undefined ? String(t.remind) : '';
  $('#notes').value = t ? (t.notes || '') : '';
  formParts = t ? children(t.id).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.created || 0) - (b.created || 0)).map(c => ({ id: c.id, title: c.title, date: c.date || '', done: !!c.done })) : [];
  $('#partsField').hidden = !!(t && t.parentId);
  $('#splitFrom').value = ''; $('#splitName').value = ''; $('#splitBox').open = false; $('#partNew').value = '';
  $('#sheetTitle').textContent = t ? (t.parentId ? 'Editar parte' : 'Editar tarea') : 'Nueva tarea';
  $('#submitBtn').textContent = t ? 'Guardar' : 'Añadir';
  $('#deleteBtn').hidden = !t;
  $('#calRow').hidden = !(t && t.date);
  renderCatChips(); renderParts(); renderDetected();
  openSheet('#taskSheet');
  if (!t) setTimeout(() => $('#title').focus(), 60);
}
$('#fab').addEventListener('click', () => (view === 'habitos' && !query) ? openHabit(null) : openForm(null));
$('#taskSheet').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#title').value.trim();
  if (!title) { $('#title').focus(); return; }
  const pend = $('#partNew').value.trim(); if (pend) addPart(pend, '');
  const data = {
    title, cat: formCat, date: formNoDate ? '' : ($('#date').value || todayISO()),
    time: $('#time').value, endTime: $('#time').value ? $('#endTime').value : '',
    prio: $('#prio').value, repeat: $('#repeat').value, days: $('#repeat').value === 'dias' ? formDays : [],
    monthDay: $('#repeat').value === 'mensual' ? Number($('#monthDay').value) : null, until: $('#repeat').value ? $('#until').value : '',
    minutes: formNoDate && Number($('#minutes').value) > 0 ? Number($('#minutes').value) : null,
    points: $('#points').value === '' ? null : Number($('#points').value),
    remind: $('#remind').value === '' ? null : Number($('#remind').value), notes: $('#notes').value.trim(),
  };
  if (!editingId) {
    const p = parseQuick(title, cats);
    data.title = p.title;
    if (p.date) { data.date = p.date; formNoDate = false; }
    if (p.time) { data.time = p.time; data.endTime = p.endTime || data.endTime; if (!data.date) data.date = todayISO(); }
    if (p.cat) data.cat = p.cat;
    if (p.prio) data.prio = p.prio;
    if (p.repeat && !formParts.length) { data.repeat = p.repeat; data.days = p.days || []; }
  }
  if (!data.date) { data.time = ''; data.endTime = ''; data.repeat = ''; }
  if (data.repeat === 'dias' && !data.days.length) data.repeat = 'semanal';
  alignStart(data);
  let t;
  if (editingId) { t = tasks.find(x => x.id === editingId); if (!t) return closeSheets(); Object.assign(t, data); }
  else { t = { id: uid(), done: false, created: Date.now(), ...data }; tasks.push(t); }
  store.put(t).catch(writeFailed);
  saveParts(t);
  closeSheets(); render();
});
// Guarda las partes como tareas propias, ligadas a la tarea principal
function saveParts(parent) {
  const existing = children(parent.id), keep = new Set(formParts.map(p => p.id)), writes = [];
  existing.filter(c => !keep.has(c.id)).forEach(c => { tasks = tasks.filter(x => x.id !== c.id); store.remove(c.id).catch(writeFailed); });
  formParts.forEach((p, i) => {
    let c = tasks.find(x => x.id === p.id);
    const id = p.isNew ? parent.id + '-' + uid() : p.id;
    if (!c) { c = { id, created: Date.now() + i, done: false }; tasks.push(c); }
    const was = !!c.done;
    Object.assign(c, { title: p.title.trim() || `Parte ${i + 1}`, date: p.date, cat: parent.cat, parentId: parent.id, prio: parent.prio });
    if (p.done !== was) setDone(c, p.done);
    writes.push(c);
  });
  if (writes.length) store.putMany(writes).catch(writeFailed);
}
$('#deleteBtn').addEventListener('click', () => { const id = editingId; closeSheets(); remove(id); });

// ---------- Calendario ----------
$('#calIOS').addEventListener('click', async () => {
  const t = tasks.find(x => x.id === editingId); if (!t || !t.date) return;
  const name = (t.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || 'tarea') + '.ics';
  const file = new File([toICS(t)], name, { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#calGoogle').addEventListener('click', () => { const t = tasks.find(x => x.id === editingId); if (t && t.date) window.open(googleURL(t), '_blank', 'noopener'); });

// ---------- Completar, deshacer y borrar ----------
// Marca una tarea como hecha o pendiente y suma/resta sus puntos
function setDone(t, done) {
  if (!!t.done === done) return;
  t.done = done; t.doneAt = done ? Date.now() : null;
  if (done) { t.pts = taskPoints(t); t.ptsDay = todayISO(); addPoints(t.pts); }
  else if (t.pts) { addPoints(-t.pts, t.ptsDay || todayISO()); t.pts = 0; t.ptsDay = ''; }
}
let undoAction = null, toastTimer = null;
function showToast(text, action) {
  undoAction = action || null;
  $('#toastText').textContent = text;
  $('#toastUndo').hidden = !action;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; undoAction = null; }, 6000);
}
$('#toastUndo').addEventListener('click', () => { const a = undoAction; undoAction = null; $('#toast').hidden = true; a?.(); render(); });
const snapshot = list => list.map(t => structuredClone(t));
function restore(snaps) {
  snaps.forEach(s => {
    const t = tasks.find(x => x.id === s.id);
    if (t) { Object.keys(t).forEach(k => delete t[k]); Object.assign(t, s); } else tasks.push(s);
  });
  store.putMany(snaps).catch(writeFailed);
}
function toggle(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const parent = t.parentId ? tasks.find(x => x.id === t.parentId) : null;
  const before = snapshot([t, ...(parent ? [parent] : [])]);
  const ptsBefore = pointsOn(todayISO());
  const created = [];
  const nowDone = !t.done;
  setDone(t, nowDone);
  let msg = nowDone ? `Hecha: ${t.title} · +${t.pts} ⭐` : `Pendiente otra vez: ${t.title}`;
  if (nowDone && t.repeat && !t.spawned) {
    t.spawned = true;
    const onTime = !t.date || t.date >= todayISO();
    t.streak = onTime ? (t.streak || 0) + 1 : 1; t.best = Math.max(t.best || 0, t.streak);
    t.history = [...(t.history || []), todayISO()].slice(-120);
    const nd = nextDate(t);
    if (nd) {
      const { id: _i, done, doneAt, spawned, pts, ptsDay, ...rest } = t;
      const next = { ...rest, id: uid(), done: false, created: Date.now(), date: nd };
      tasks.push(next); created.push(next.id); store.put(next).catch(writeFailed);
      msg += `${t.streak >= 2 ? ` · 🔥 ${t.streak}` : ''} · siguiente ${friendlyDate(nd).toLowerCase()}`;
    } else msg += ' · era la última repetición';
  }
  // La tarea principal se completa sola cuando terminas todas sus partes
  if (parent) {
    const pr = progressOf(parent.id);
    if (pr.total && pr.done === pr.total && !parent.done) { setDone(parent, true); store.put(parent).catch(writeFailed); msg = `¡Terminaste ${parent.title}! ${pr.done}/${pr.total} · +${t.pts + parent.pts} ⭐`; }
    else if (!nowDone && parent.done) { setDone(parent, false); store.put(parent).catch(writeFailed); }
    else if (nowDone) msg = `${t.title} · ${pr.done}/${pr.total} de ${parent.title} · +${t.pts} ⭐`;
  }
  store.put(t).catch(writeFailed);
  navigator.vibrate?.(10);
  showToast(msg, () => {
    // Deshacer: vuelve todo como estaba (incluida la siguiente repetición y los puntos)
    const diff = pointsOn(todayISO()) - ptsBefore;
    created.forEach(cid => { tasks = tasks.filter(x => x.id !== cid); store.remove(cid).catch(writeFailed); });
    restore(before);
    if (diff) addPoints(-diff);
  });
  render();
}
function remove(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const gone = [t, ...children(t.id)];
  tasks = tasks.filter(x => !gone.includes(x));
  gone.forEach(g => store.remove(g.id).catch(writeFailed));
  const snaps = snapshot(gone);
  showToast(gone.length > 1 ? `Borrada: ${t.title} y sus ${gone.length - 1} partes` : `Borrada: ${t.title}`, () => restore(snaps));
  render();
}
let clearArmed = null;
$('#clearDone').addEventListener('click', () => {
  const done = tasks.filter(x => x.done && !x.parentId);
  if (!done.length) return;
  if (!clearArmed) { $('#clearDone').textContent = `Toca otra vez para borrar ${done.length}`; clearArmed = setTimeout(() => { clearArmed = null; render(); }, 4000); return; }
  clearTimeout(clearArmed); clearArmed = null;
  const gone = done.flatMap(t => [t, ...children(t.id)]);
  tasks = tasks.filter(x => !gone.includes(x));
  gone.forEach(t => store.remove(t.id).catch(writeFailed));
  const snaps = snapshot(gone);
  showToast(`${done.length} borrada${done.length === 1 ? '' : 's'}`, () => restore(snaps));
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
  try { localStorage.setItem('tip-swipe', '1'); } catch {}
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
const matches = (t, q) => fold([t.title, t.notes].join(' ')).includes(fold(q));

// ---------- Copias ----------
$('#exportBtn').addEventListener('click', async () => {
  const name = `mis-tareas-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(tasks.map(t => ({ id: t.id, ...clean(t) })), null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Copia de Mis Tareas' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const info = $('#importInfo');
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data)) throw 0;
    const list = data.filter(x => x && x.title).map(x => ({ ...x, id: String(x.id || uid()).replace(/[^\w.~:@+-]/g, '_') }));
    list.forEach(x => migrated.delete(x.id));
    info.textContent = `Importando ${list.length} tareas…`;
    list.forEach(x => { const i = tasks.findIndex(t => t.id === x.id); if (i >= 0) tasks[i] = x; else tasks.push(x); });
    migrate();
    await store.putMany(list.map(x => tasks.find(t => t.id === x.id)));
    info.textContent = `Listo: ${list.length} tareas importadas.`;
    render();
  } catch { info.textContent = 'Ese archivo no es una copia de Mis Tareas.'; }
});

// ---------- Hábitos ----------
const habitPoints = h => Number(h.minutes) > 0 ? Math.round(Number(h.minutes)) : 10;
const habitOK = (h, d) => (h.log[d] || 0) === 1;
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
  const ok = Object.keys(h.log).filter(d => h.log[d] === 1).sort();
  let best = 0, run = 0, prev = null;
  ok.forEach(d => { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  return best;
}
// --- Rutina de sueño: se apunta cada mañana; la noche cuenta en el día en que te levantas ---
const wakeTarget = (h, day) => [0, 6].includes(parseISO(day).getDay()) ? h.wakeWe : h.wakeWk;
// Hora de acostarse en minutos, contando las horas de madrugada como "después de medianoche"
const bedMin = hm => { const m = toMin(hm); return m < 12 * 60 ? m + 1440 : m; };
const fmtDur = m => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
function judgeSleep(h, day, bed, wake) {
  const slept = (toMin(wake) + 1440 - bedMin(bed)) % 1440 || 1440;
  const bedOK = bedMin(bed) <= bedMin(h.bed) + h.tol;
  const wakeOK = toMin(wake) <= toMin(wakeTarget(h, day)) + h.tol;
  const hoursOK = slept >= h.hours * 60 - h.tol;
  const fails = [!bedOK && 'te acostaste tarde', !wakeOK && 'te levantaste tarde', !hoursOK && `dormiste ${fmtDur(slept)}`].filter(Boolean);
  return { ok: bedOK && wakeOK && hoursOK, slept, fails };
}
function saveSleep(id, bed, wake) {
  const h = habits.find(x => x.id === id); if (!h || !bed || !wake) return;
  const d = todayISO(), prev = h.log[d], r = judgeSleep(h, d, bed, wake), next = r.ok ? 1 : -1;
  if (prev === 1) addPoints(-habitPoints(h));
  if (next === 1) addPoints(habitPoints(h));
  h.log[d] = next; h.nights[d] = { bed, wake };
  store.setSleep(h, d, next, { bed, wake }).catch(writeFailed);
  const s = habitStreak(h);
  showToast(r.ok ? `+${habitPoints(h)} ⭐ · Rutina de sueño cumplida · ${fmtDur(r.slept)}${s >= 2 ? ` · 🔥 ${s} noches` : ''}` : `Esta noche no: ${r.fails.join(', ')}`);
  render();
}
function clearSleep(id) {
  const h = habits.find(x => x.id === id); if (!h) return;
  const d = todayISO(); if (h.log[d] === 1) addPoints(-habitPoints(h));
  delete h.log[d]; delete h.nights[d]; store.setSleep(h, d, null).catch(writeFailed); render();
}
function sleepRowHTML(h) {
  const d = todayISO(), n = h.nights[d], s = habitStreak(h), b = habitBest(h);
  const r = n ? judgeSleep(h, d, n.bed, n.wake) : null;
  const meta = `Luz apagada ${h.bed} · despertar ${h.wakeWk} (L–V), ${h.wakeWe} (S–D) · ${fmtDur(h.hours * 60)}`;
  const streak = s ? (s === 1 ? '🔥 1 noche' : `🔥 ${s} noches seguidas`) : 'Sin racha todavía';
  return `<div class="hab sleep" style="--c:var(--k-violeta)">
    <div class="hb"><div class="n" data-act="hedit" data-id="${h.id}">🌙 ${esc(h.name)}</div><div class="m">${meta}</div>
      <div class="m">${streak}${b > s ? ` · récord ${b}` : ''} · +${habitPoints(h)} ⭐</div>${dotsHTML(h)}
      <div class="sleeplog" data-sid="${h.id}">
        <label class="pickbtn tbtn"><span class="label">Anoche me acosté</span><span>${n ? n.bed : h.bed}</span><input type="time" data-sl="bed" value="${n ? n.bed : h.bed}" aria-label="Hora a la que te acostaste"></label>
        <label class="pickbtn tbtn"><span class="label">Hoy me levanté</span><span>${n ? n.wake : wakeTarget(h, d)}</span><input type="time" data-sl="wake" value="${n ? n.wake : wakeTarget(h, d)}" aria-label="Hora a la que te levantaste"></label>
        <button class="btn primary" data-act="slsave" data-id="${h.id}">${n ? 'Cambiar' : 'Apuntar'}</button>
      </div>
      ${r ? `<div class="sleepres ${r.ok ? 'ok' : 'bad'}">${r.ok ? `✓ Cumplida · dormiste ${fmtDur(r.slept)}` : `✗ ${cap(r.fails.join(', '))}`} <button class="btn ghost small" data-act="slclear" data-id="${h.id}">Borrar</button></div>` : ''}
    </div></div>`;
}
const SLEEP_DEFAULT = { name: 'Rutina de sueño', kind: 'sleep', minutes: 20, bed: '23:30', wakeWk: '07:15', wakeWe: '08:15', hours: 7.5, tol: 15 };
const habitDoneToday = h => (h.kind === 'quit' || h.kind === 'sleep') ? h.log[todayISO()] !== undefined
  : h.freq === 'weekly' ? (habitOK(h, todayISO()) || weekCount(h, mondayOf(todayISO())) >= h.target) : habitOK(h, todayISO());
const sortedHabits = () => [...habits].sort((a, b) => a.order - b.order);
function setHabit(id, val) {
  const h = habits.find(x => x.id === id); if (!h) return;
  const d = todayISO(), prev = h.log[d], next = prev === val ? null : val;
  if (prev === 1) addPoints(-habitPoints(h));
  if (next === 1) addPoints(habitPoints(h));
  if (next === null) delete h.log[d]; else h.log[d] = next;
  store.setHabitDay(h, d, next).catch(writeFailed);
  if (next === 1) {
    navigator.vibrate?.(10);
    const s = habitStreak(h);
    showToast(`+${habitPoints(h)} ⭐ · ${h.name}${s >= 2 ? ` · 🔥 ${s} ${h.freq === 'weekly' ? 'semanas' : 'días'}` : ''}`, () => setHabit(id, 1));
  }
  render();
}
function dotsHTML(h) {
  const mon = mondayOf(todayISO()), today = todayISO();
  return `<div class="dots">${DAY_ORDER.map((wd, i) => { const d = addDays(mon, i), v = h.log[d]; return `<i class="${v === 1 ? 'on' : v === -1 ? 'bad' : d > today ? 'off' : ''}">${DAY_LETTER[wd]}</i>`; }).join('')}</div>`;
}
function habitRowHTML(h) {
  const s = habitStreak(h), today = todayISO(), v = h.log[today];
  const unit = h.freq === 'weekly' ? (s === 1 ? 'semana' : 'semanas') : (s === 1 ? 'día' : 'días');
  let meta = h.kind === 'quit' ? (s ? `🔥 ${s} ${unit} sin caer` : 'Empieza hoy')
    : h.freq === 'weekly' ? `${weekCount(h, mondayOf(today))}/${h.target} esta semana${s ? ` · 🔥 ${s} ${unit}` : ''}`
    : (s ? `🔥 ${s} ${unit}` : 'Sin racha todavía');
  const b = habitBest(h); if (b > s && h.freq !== 'weekly') meta += ` · récord ${b}`;
  meta += ` · +${habitPoints(h)} ⭐`;
  const actions = h.kind === 'quit'
    ? `<div class="qbtns"><button class="qb ok ${v === 1 ? 'on' : ''}" data-act="hok" data-id="${h.id}" aria-label="Lo he evitado hoy">✓</button><button class="qb bad ${v === -1 ? 'on' : ''}" data-act="hbad" data-id="${h.id}" aria-label="Hoy he caído">✗</button></div>`
    : `<button class="hcheck ${v === 1 ? 'on' : ''}" data-act="hok" data-id="${h.id}" aria-label="Hecho hoy: ${esc(h.name)}">${TICK('var(--surface)')}</button>`;
  return `<div class="hab ${h.kind}" style="--c:${h.kind === 'quit' ? 'var(--k-turquesa)' : 'var(--k-verde)'}">
    <div class="hb" data-act="hedit" data-id="${h.id}"><div class="n">${esc(h.name)}</div><div class="m">${meta}</div>${dotsHTML(h)}</div>${actions}</div>`;
}
function habitsViewHTML() {
  const today = todayISO(), all = sortedHabits(), pts = pointsOn(today), goal = stats.goal;
  let html = `<section class="summary"><div class="rato-head"><h2>Hoy</h2><span class="hint">${all.filter(habitDoneToday).length} de ${all.length} hábitos</span></div>
    <div class="rato-meter" style="max-width:none"><div class="nums"><span>⭐ ${pts} puntos</span><span>objetivo ${goal}</span></div><div class="bar"><i style="width:${Math.min(100, pts / goal * 100)}%"></i></div></div></section>`;
  if (!all.length) {
    return html + `<div class="empty"><strong>Aún no tienes hábitos</strong><span>Crea los que quieres cumplir y los que quieres dejar.</span>
      <button class="btn primary" data-act="hseed" style="margin-top:10px">Añadir los que me dijiste</button>
      <span class="hint">Leer, 15' de silencio, estirar, 10.000 pasos, meditar, inglés, limpiar fotos · y dejar pantallas antes de dormir y scrollear de más</span></div>
      <button class="btn block" data-act="hsleep">🌙 Añadir mi rutina de sueño (23:30 · 7:15)</button>
      <button class="btn block" data-act="hnew" style="margin-top:8px">+ Nuevo hábito</button>`;
  }
  const sec = (title, list) => list.length ? `<h2 class="group"><span>${title}</span><span>${list.length}</span></h2><div class="habs">${list.map(habitRowHTML).join('')}</div>` : '';
  const sleep = all.filter(h => h.kind === 'sleep');
  html += sleep.length ? `<h2 class="group"><span>Sueño</span></h2><div class="habs">${sleep.map(sleepRowHTML).join('')}</div>`
    : `<button class="btn block" data-act="hsleep" style="margin-top:10px">🌙 Añadir mi rutina de sueño (23:30 · 7:15)</button>`;
  html += sec('Cada día', all.filter(h => h.kind === 'build' && h.freq === 'daily'));
  html += sec('Cada semana', all.filter(h => h.kind === 'build' && h.freq === 'weekly'));
  html += sec('Para dejar', all.filter(h => h.kind === 'quit'));
  return html + `<button class="btn block" data-act="hnew" style="margin-top:14px">+ Nuevo hábito</button>`;
}
const SEED_HABITS = [
  { name: 'Leer', kind: 'build', freq: 'daily', minutes: 20 }, { name: "15' de silencio", kind: 'build', freq: 'daily', minutes: 15 },
  { name: 'Estirar por las mañanas', kind: 'build', freq: 'daily', minutes: 10 }, { name: '10.000 pasos', kind: 'build', freq: 'daily', minutes: 30 },
  { name: 'Meditar', kind: 'build', freq: 'daily', minutes: 10 }, { name: 'Estudiar inglés', kind: 'build', freq: 'daily', minutes: 20 },
  { name: 'Limpieza de fotos', kind: 'build', freq: 'daily', minutes: 5 },
  { name: 'Pantallas antes de dormir', kind: 'quit', freq: 'daily', minutes: 15 }, { name: 'Scrollear de más', kind: 'quit', freq: 'daily', minutes: 15 },
];
function seedHabits() {
  const base = Date.now();
  SEED_HABITS.forEach((s, i) => { const h = { id: 'h' + uid(), ...cleanHabit({ ...s, order: base + i }) }; habits.push(h); store.putHabit(h).catch(writeFailed); });
  render();
}
let editingHabit = null, hKind = 'build', hFreq = 'daily', hDelArmed = false;
function renderHabitChips() {
  document.querySelectorAll('#hKind [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === hKind));
  document.querySelectorAll('#hFreq [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === hFreq));
  $('#hFreqField').hidden = hKind !== 'build';
  $('#hTargetField').hidden = hKind !== 'build' || hFreq !== 'weekly';
  $('#hSleepFields').hidden = hKind !== 'sleep';
  $('#hMinLabel').textContent = hKind === 'quit' ? 'Puntos por cada día que lo evitas' : hKind === 'sleep' ? 'Puntos por cada noche cumplida' : 'Minutos (= puntos al cumplirlo)';
  ['hBed', 'hWakeWk', 'hWakeWe'].forEach(k => { $('#' + k + 'Text').textContent = $('#' + k).value || '—'; });
}
['hBed', 'hWakeWk', 'hWakeWe'].forEach(k => $('#' + k).addEventListener('change', renderHabitChips));
function openHabit(id) {
  const h = id ? habits.find(x => x.id === id) : null;
  editingHabit = h ? h.id : null; hKind = h ? h.kind : 'build'; hFreq = h ? h.freq : 'daily';
  $('#hName').value = h ? h.name : ''; $('#hTarget').value = h ? h.target : 3; $('#hMin').value = h ? h.minutes : 10;
  const sl = h && h.kind === 'sleep' ? h : SLEEP_DEFAULT;
  $('#hBed').value = sl.bed; $('#hWakeWk').value = sl.wakeWk; $('#hWakeWe').value = sl.wakeWe; $('#hHours').value = sl.hours; $('#hTol').value = sl.tol;
  $('#habitTitle').textContent = h ? 'Editar hábito' : 'Nuevo hábito';
  $('#hSave').textContent = h ? 'Guardar' : 'Crear hábito';
  $('#hDelete').hidden = !h; $('#hDelete').textContent = 'Borrar hábito'; hDelArmed = false;
  $('#hSuggest').hidden = !!h;
  renderHabitChips(); openSheet('#habitSheet');
  if (!h) setTimeout(() => $('#hName').focus(), 60);
}
$('#hKind').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hKind = b.dataset.v; renderHabitChips(); } });
$('#hFreq').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hFreq = b.dataset.v; renderHabitChips(); } });
$('#hSuggest').innerHTML = SEED_HABITS.map((s, i) => `<button type="button" class="chip" data-i="${i}">${s.kind === 'quit' ? '🚫 ' : ''}${esc(s.name)}</button>`).join('');
$('#hSuggest').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  const s = SEED_HABITS[+b.dataset.i]; $('#hName').value = s.name; hKind = s.kind; hFreq = s.freq; $('#hMin').value = s.minutes; renderHabitChips();
});
$('#habitSheet').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#hName').value.trim(); if (!name) { $('#hName').focus(); return; }
  const data = { name, kind: hKind, freq: hFreq, target: Number($('#hTarget').value) || 3, minutes: Number($('#hMin').value) || 10 };
  if (hKind === 'sleep') Object.assign(data, { bed: $('#hBed').value, wakeWk: $('#hWakeWk').value, wakeWe: $('#hWakeWe').value, hours: Number($('#hHours').value), tol: Number($('#hTol').value) });
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

// ---------- Progreso ----------
function buildProgress() {
  const today = todayISO(), tot = {}, area = {};
  const add = (key, d, due, done) => { for (const m of [tot, (area[key] ||= {})]) { const e = (m[d] ||= { due: 0, done: 0 }); e.due += due; e.done += done; } };
  tasks.forEach(t => {
    if (children(t.id).length) return; // la tarea grande cuenta a través de sus partes
    const key = 'c:' + (t.cat || '');
    if (t.date && t.date <= today) add(key, t.date, 1, t.done ? 1 : 0);
    else if (t.done && t.doneAt) add(key, isoDate(new Date(t.doneAt)), 1, 1);
  });
  habits.forEach(h => {
    const key = 'h:' + h.id;
    if (h.freq === 'weekly') { Object.keys(h.log).forEach(d => { if (h.log[d] === 1 && d <= today) add(key, d, 1, 1); }); return; }
    const start = isoDate(new Date(h.order)), first = Object.keys(h.log).sort()[0];
    let d = first && first < start ? first : start, n = 0;
    while (d <= today && n++ < 800) { add(key, d, 1, h.log[d] === 1 ? 1 : 0); d = addDays(d, 1); }
  });
  return { tot, area };
}
const level = e => { if (!e || !e.due) return -1; const r = Math.min(1, e.done / e.due); return r === 0 ? 0 : r <= .25 ? 1 : r <= .5 ? 2 : r < 1 ? 3 : 4; };
const cell = (e, d, today) => `<i class="lv${level(e)}${d > today ? ' fut' : ''}${d === selectedDay ? ' sel' : ''}" data-act="yday" data-d="${d}"></i>`;
function summaryHTML() {
  const today = todayISO(), mon = mondayOf(today), week = [...Array(7)].map((_, i) => addDays(mon, i));
  const ptsWeek = week.reduce((s, d) => s + pointsOn(d), 0);
  const doneWeek = tasks.filter(t => t.done && t.doneAt && isoDate(new Date(t.doneAt)) >= mon);
  const maxP = Math.max(stats.goal, ...week.map(pointsOn));
  const byCatCount = {}; doneWeek.forEach(t => { byCatCount[t.cat || ''] = (byCatCount[t.cat || ''] || 0) + 1; });
  const maxC = Math.max(1, ...Object.values(byCatCount));
  return `<section class="summary">
    <div class="rato-head"><h2>Esta semana</h2><button class="btn ghost small" data-act="goal">Objetivo: ${stats.goal} ⭐/día</button></div>
    <div class="kpis"><div class="kpi"><b>${pointsOn(today)}</b><span>puntos hoy</span></div><div class="kpi"><b>${ptsWeek}</b><span>puntos semana</span></div><div class="kpi"><b>${doneWeek.length}</b><span>tareas hechas</span></div></div>
    <div class="weekbars">${week.map((d, i) => { const p = pointsOn(d); return `<div class="wb ${d === today ? 'today' : ''}"><span class="v">${p || ''}</span><div class="col"><i style="height:${p / maxP * 100}%"></i><b style="bottom:${stats.goal / maxP * 100}%"></b></div><span>${DAY_LETTER[DAY_ORDER[i]]}</span></div>`; }).join('')}</div>
    ${Object.keys(byCatCount).length ? `<div class="catbars">${Object.entries(byCatCount).sort((a, b) => b[1] - a[1]).map(([id, n]) => { const c = catOf(id); return `<div class="catbar" style="--c:${colorVar(c.color)}"><span>${esc(c.name)}</span><div class="bar"><i style="width:${n / maxC * 100}%"></i></div><span>${n}</span></div>`; }).join('')}</div>` : ''}
  </section>`;
}
function monthHTML(p) {
  const today = todayISO(), now = parseISO(today), y = now.getFullYear(), m = now.getMonth(), n = dim(y, m);
  const days = [...Array(n)].map((_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
  const past = days.filter(d => d <= today && p.tot[d]?.due);
  const full = past.filter(d => level(p.tot[d]) === 4).length;
  const avg = past.length ? Math.round(past.reduce((s, d) => s + Math.min(1, p.tot[d].done / p.tot[d].due), 0) / past.length * 100) : 0;
  let streak = 0; for (let d = level(p.tot[today]) === 4 ? today : addDays(today, -1); level(p.tot[d]) === 4 && streak < 400; d = addDays(d, -1)) streak++;
  return `<section class="summary"><div class="rato-head"><h2>${cap(now.toLocaleDateString('es-ES', { month: 'long' }))}</h2><span class="hint">${avg}% de media</span></div>
    <div class="kpis"><div class="kpi"><b>${full}</b><span>días al 100%</span></div><div class="kpi"><b>${streak}</b><span>días seguidos al 100%</span></div><div class="kpi"><b>${days.reduce((s, d) => s + pointsOn(d), 0)}</b><span>puntos del mes</span></div></div>
    <div class="mchart" style="--n:${n}">${days.map(d => { const e = p.tot[d], r = e && e.due ? Math.min(1, e.done / e.due) : 0;
      return `<div class="mc ${d === today ? 'today' : ''} ${d > today ? 'fut' : ''}" data-act="yday" data-d="${d}"><i class="lv${level(e)}" style="height:${d > today ? 0 : Math.max(e?.due ? 6 : 0, r * 100)}%"></i></div>`; }).join('')}</div>
    <div class="mticks"><span>1</span><span>${Math.ceil(n / 2)}</span><span>${n}</span></div></section>`;
}
function yearHTML(p) {
  const today = todayISO(), y = parseISO(today).getFullYear();
  let rows = '';
  for (let m = 0; m < 12; m++) {
    rows += `<span class="ml">${MONTHS_SHORT[m]}</span>`;
    for (let day = 1; day <= 31; day++) { if (day > dim(y, m)) { rows += '<i class="na"></i>'; continue; } const d = `${y}-${pad(m + 1)}-${pad(day)}`; rows += cell(p.tot[d], d, today); }
  }
  let detail = 'Toca un cuadrado para ver ese día.';
  if (selectedDay) { const e = p.tot[selectedDay]; detail = `${cap(parseISO(selectedDay).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}: ${e && e.due ? `${e.done} de ${e.due} cosas cumplidas` : 'nada que hacer'} · ⭐ ${pointsOn(selectedDay)}`; }
  return `<section class="summary"><div class="rato-head"><h2>${y}</h2><span class="legend">Menos <i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i> Todo</span></div>
    <div class="year">${rows}</div><p class="hint" id="dayDetail">${detail}</p></section>`;
}
function areasHTML(p) {
  const today = todayISO(), now = parseISO(today), y = now.getFullYear(), m = now.getMonth(), n = dim(y, m);
  const days = [...Array(n)].map((_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
  const row = (label, color, map) => {
    const past = days.filter(d => d <= today && map?.[d]?.due); if (!past.length) return '';
    const pct = Math.round(past.reduce((s, d) => s + Math.min(1, map[d].done / map[d].due), 0) / past.length * 100);
    return `<div class="area" style="--g:${color}"><div class="an"><span>${esc(label)}</span><span>${pct}%</span></div><div class="acells" style="--n:${n}">${days.map(d => cell(map?.[d], d, today)).join('')}</div></div>`;
  };
  const allH = {};
  habits.forEach(h => Object.entries(p.area['h:' + h.id] || {}).forEach(([d, e]) => { const a = (allH[d] ||= { due: 0, done: 0 }); a.due += e.due; a.done += e.done; }));
  let html = row('Todos los hábitos', 'var(--k-verde)', allH);
  html += cats.map(c => row(c.name, colorVar(c.color), p.area['c:' + c.id])).join('');
  html += sortedHabits().map(h => row(h.name, h.kind === 'quit' ? 'var(--k-turquesa)' : 'var(--k-verde)', p.area['h:' + h.id])).join('');
  return html ? `<section class="summary"><div class="rato-head"><h2>Por apartado</h2><span class="hint">este mes</span></div><div class="areas">${html}</div></section>` : '';
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

// ---------- Agenda ----------
function weekHTML(byCat) {
  const today = todayISO(), mon = addDays(mondayOf(today), weekOffset * 7), sun = addDays(mon, 6);
  const f = iso => parseISO(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const ghosts = {};
  tasks.filter(t => byCat(t) && t.repeat && !t.done && t.date).forEach(t => {
    let d = t.date, n = 0;
    while (n++ < 400) { d = stepDate(t, d); if (d > sun || (t.until && d > t.until)) break; if (d >= mon) (ghosts[d] ||= []).push(t); }
  });
  let nDone = 0;
  let html = `<div class="weeknav"><button class="iconbtn" data-act="wprev" aria-label="Semana anterior">‹</button><strong>${f(mon)} – ${f(sun)}</strong><button class="iconbtn" data-act="wnext" aria-label="Semana siguiente">›</button></div>`;
  if (weekOffset) html += `<button class="btn ghost small" data-act="wtoday" style="display:block;margin:0 auto">Volver a esta semana</button>`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const doneHere = tasks.filter(x => byCat(x) && x.done && x.doneAt && isoDate(new Date(x.doneAt)) === d);
    nDone += doneHere.length;
    const real = tasks.filter(x => byCat(x) && !x.done && (x.date === d || (d === today && isLate(x)))).concat(showDone ? doneHere : []).sort((a, b) => (a.done - b.done) || sortTasks(a, b));
    const gh = (ghosts[d] || []).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    const name = parseISO(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });
    html += `<div class="day ${d === today ? 'today' : ''}"><h2 class="group"><span>${d === today ? 'Hoy · ' : ''}${cap(name)}</span><span>${real.length + gh.length || ''}</span></h2>
      ${real.length ? `<ul class="list">${real.map(taskHTML).join('')}</ul>` : ''}
      ${gh.length ? `<div style="display:grid;gap:6px;margin-top:6px">${gh.map(t => `<button class="ghost" data-act="edit" data-id="${t.id}"><span class="dot" style="background:${colorVar(catOf(t.cat).color)}"></span><span><b>${esc(t.title)}</b>${t.time ? ' · ' + t.time + (t.endTime ? '–' + t.endTime : '') : ''}</span><span>↻</span></button>`).join('')}</div>` : ''}
      ${!real.length && !gh.length ? '<p class="free">Libre</p>' : ''}</div>`;
  }
  return { html, nDone };
}
const agendaSwitchHTML = () => `<div class="chips" style="margin:2px 0 8px"><button class="chip" data-act="amode" data-m="semana" aria-pressed="${agendaMode === 'semana'}">Semana</button><button class="chip" data-act="amode" data-m="lista" aria-pressed="${agendaMode === 'lista'}">Todo lo próximo</button></div>`;

// ---------- Pintar ----------
const prioRank = { alta: 0, normal: 1, baja: 2 };
const sortTasks = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99')
  || prioRank[a.prio || 'normal'] - prioRank[b.prio || 'normal'] || (a.created || 0) - (b.created || 0);
function inView(x, v) {
  const t = todayISO();
  if (v === 'hoy') return !x.done && x.date && x.date <= t;
  if (v === 'proximas') return !x.done && x.date && x.date > t;
  if (v === 'sinfecha') return !x.done && !x.date;
  return x.done;
}
const doneInView = (x, v) => x.done && (v === 'hoy' ? x.doneAt && isoDate(new Date(x.doneAt)) === todayISO() : v === 'sinfecha' ? !x.date : v === 'hechas');
const currentStreak = t => (t.date && t.date < todayISO()) ? 0 : (t.streak || 0);
function taskHTML(x) {
  const cat = catOf(x.cat), c = colorVar(cat.color), late = isLate(x);
  const showDate = x.date && (view === 'hechas' || late || query || (view === 'sinfecha') || (x.parentId && view !== 'semana' && view !== 'hoy'));
  const parent = x.parentId ? tasks.find(p => p.id === x.parentId) : null;
  const pr = progressOf(x.id), ppr = parent ? progressOf(parent.id) : null;
  const pct = o => o.total ? Math.round(o.done / o.total * 100) : 0;
  const meta = [
    `<span class="catn"><span class="dot" style="background:${c}"></span>${esc(cat.name)}</span>`,
    x.time ? `<span>${x.time}${x.endTime ? '–' + x.endTime : ''}</span>` : '',
    showDate ? `<span class="${late ? 'late' : ''}">${friendlyDate(x.date)}</span>` : '',
    x.repeat ? `<span>↻ ${repeatLabel(x)}${x.until ? ' hasta ' + friendlyDate(x.until).toLowerCase() : ''}</span>` : '',
    x.repeat && !x.done && currentStreak(x) >= 2 ? `<span class="streak">🔥 ${currentStreak(x)}</span>` : '',
    pr.total ? `<span class="prog"><span class="pbar"><i style="width:${pct(pr)}%"></i></span>${pr.done}/${pr.total} · ${pct(pr)}%</span>` : '',
    parent ? `<span class="prog">▦ ${esc(parent.title)} · ${ppr.done}/${ppr.total} (${pct(ppr)}%)</span>` : '',
    !x.date && x.minutes && !x.done ? `<span>${x.minutes} min</span>` : '',
    x.done && x.pts ? `<span>+${x.pts} ⭐</span>` : '',
    x.prio === 'alta' && !x.done ? `<span class="prio">Alta</span>` : '',
  ].join('');
  return `<li class="task ${x.done ? 'done' : ''}" data-id="${x.id}" style="--c:${c}">
    <div class="swipe-bg" aria-hidden="true">
      <span class="l"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>${x.done ? 'Pendiente' : 'Hecha'}</span>
      <span class="r">Borrar<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span>
    </div>
    <div class="row">
      <button class="check" data-act="toggle" data-id="${x.id}" aria-label="${x.done ? 'Marcar como pendiente' : 'Completar'}: ${esc(x.title)}">${TICK('var(--surface)')}</button>
      <div class="body" data-act="edit" data-id="${x.id}"><div class="t">${esc(x.title)}</div><div class="meta">${meta}</div>${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ''}</div>
      <button class="more" data-act="edit" data-id="${x.id}" aria-label="Editar ${esc(x.title)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
    </div></li>`;
}
const EMPTY = {
  hoy: ['Nada pendiente para hoy', 'Pulsa + para apuntar algo.'],
  proximas: ['Nada programado', 'Escribe “mañana” o una fecha al crear una tarea.'],
  sinfecha: ['No hay tareas sin fecha', 'Úsalo para ideas y cosas sin día fijo.'],
  hechas: ['', ''],
};
const groupedHTML = list => {
  const t = todayISO(), groups = new Map();
  list.forEach(x => { const g = x.date < t ? 'Atrasadas' : friendlyDate(x.date); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); });
  return [...groups].map(([g, items]) => `<h2 class="group ${g === 'Atrasadas' ? 'late' : ''}"><span>${g}</span><span>${items.length}</span></h2><ul class="list">${items.map(taskHTML).join('')}</ul>`).join('');
};
function render() {
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#viewTitle').textContent = query ? 'Buscar' : VIEWS[view];
  $('#ptsToday').textContent = `⭐ ${pointsOn(todayISO())}`;
  $('#filters').hidden = view === 'habitos' && !query;
  $('#fab').setAttribute('aria-label', view === 'habitos' && !query ? 'Nuevo hábito' : 'Nueva tarea');
  const byCat = x => catFilter === null || (x.cat || '') === catFilter;
  document.querySelectorAll('#tabs button').forEach(b => {
    const v = b.dataset.view; b.setAttribute('aria-selected', !query && v === view);
    const badge = b.querySelector('.badge'), n = v === 'hoy' ? tasks.filter(x => inView(x, 'hoy')).length : 0;
    badge.hidden = !n; badge.textContent = n;
  });
  const hasOrphans = tasks.some(t => !cats.some(c => c.id === t.cat));
  $('#filters').innerHTML = `<button class="chip" data-filter="*" aria-pressed="${catFilter === null}">Todas</button>` +
    cats.map(c => `<button class="chip" data-filter="${esc(c.id)}" aria-pressed="${catFilter === c.id}"><span class="dot" style="background:${colorVar(c.color)}"></span>${esc(c.name)}</button>`).join('') +
    (hasOrphans ? `<button class="chip" data-filter="" aria-pressed="${catFilter === ''}">Sin categoría</button>` : '') +
    `<button class="chip edit" data-filter="edit">Editar</button>`;
  $('#showDoneBtn').hidden = true; $('#clearDone').hidden = true;
  if (!loaded) { $('#list').innerHTML = `<div class="empty"><strong>Cargando tus tareas…</strong></div>`; $('#stats').textContent = ''; return; }

  let html = '', count = 0, doneCount = 0;
  if (query) {
    const list = tasks.filter(x => byCat(x) && matches(x, query)).sort((a, b) => (a.done - b.done) || sortTasks(a, b));
    count = list.length;
    html = list.length ? `<ul class="list">${list.map(taskHTML).join('')}</ul>` : `<div class="empty"><strong>Nada con “${esc(query)}”</strong><span>Busca por título o notas.</span></div>`;
  } else if (view === 'habitos') {
    html = habitsViewHTML();
  } else if (view === 'semana' && agendaMode === 'semana') {
    const w = weekHTML(byCat); html = agendaSwitchHTML() + w.html; doneCount = w.nDone; count = 1;
  } else {
    const v = view === 'semana' ? 'proximas' : view;
    const list = tasks.filter(x => byCat(x) && inView(x, v) && v !== 'hechas').sort(sortTasks);
    const done = tasks.filter(x => byCat(x) && doneInView(x, v)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    count = list.length; doneCount = v === 'proximas' ? 0 : done.length;
    if (v === 'hechas') html += summaryHTML() + (() => { const p = buildProgress(); return monthHTML(p) + yearHTML(p) + areasHTML(p); })();
    if (view === 'semana') html += agendaSwitchHTML();
    if (v !== 'hechas') {
      if (!list.length) { const [h, p] = EMPTY[v]; html += `<div class="empty"><strong>${h}</strong><span>${p}</span></div>`; }
      else html += v === 'sinfecha' ? `<ul class="list">${list.map(taskHTML).join('')}</ul>` : groupedHTML(list);
    }
    if (showDone && done.length) html += `<h2 class="group"><span>${v === 'hoy' ? 'Hechas hoy' : 'Hechas'}</span><span>${done.length}</span></h2><ul class="list">${done.map(taskHTML).join('')}</ul>`;
    $('#clearDone').hidden = !(v === 'hechas' && showDone && done.length);
  }
  $('#list').innerHTML = html;
  if (doneCount && !query && view !== 'habitos') {
    $('#showDoneBtn').hidden = false;
    $('#showDoneBtn').textContent = showDone ? 'Ocultar las hechas' : `Ver las hechas (${doneCount})`;
  }
  const pending = tasks.filter(x => !x.done).length;
  const doneToday = tasks.filter(x => x.done && x.doneAt && isoDate(new Date(x.doneAt)) === todayISO()).length;
  $('#stats').textContent = view === 'habitos' ? '' : `${pending} pendiente${pending === 1 ? '' : 's'} · ${doneToday} hecha${doneToday === 1 ? '' : 's'} hoy`;
  let tipSeen = false; try { tipSeen = localStorage.getItem('tip-swipe') === '1'; } catch {}
  $('#tip').hidden = tipSeen || !count || view === 'habitos';
  if (!clearArmed) $('#clearDone').textContent = 'Borrar las hechas';
}
$('#showDoneBtn').addEventListener('click', () => { showDone = !showDone; render(); });
// Las horas del registro de sueño se ven en el botón al elegirlas
$('#list').addEventListener('change', e => { if (e.target.dataset.sl) e.target.previousElementSibling.textContent = e.target.value || '—'; });
$('#list').addEventListener('click', e => {
  if (suppressClick) return;
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id } = el.dataset;
  if (act === 'toggle') toggle(id);
  else if (act === 'wprev' || act === 'wnext') { weekOffset += act === 'wnext' ? 1 : -1; render(); }
  else if (act === 'wtoday') { weekOffset = 0; render(); }
  else if (act === 'amode') { agendaMode = el.dataset.m; render(); }
  else if (act === 'hok') setHabit(id, 1);
  else if (act === 'hbad') setHabit(id, -1);
  else if (act === 'hedit') openHabit(id);
  else if (act === 'hnew') openHabit(null);
  else if (act === 'hseed') seedHabits();
  else if (act === 'hsleep') { const h = { id: 'h' + uid(), ...cleanHabit({ ...SLEEP_DEFAULT, order: Date.now() }) }; habits.push(h); store.putHabit(h).catch(writeFailed); render(); }
  else if (act === 'slsave') { const box = el.closest('.sleeplog'); saveSleep(id, box.querySelector('[data-sl=bed]').value, box.querySelector('[data-sl=wake]').value); }
  else if (act === 'slclear') clearSleep(id);
  else if (act === 'goal') openGoal();
  else if (act === 'yday') { selectedDay = selectedDay === el.dataset.d ? null : el.dataset.d; const y = $('#scroller').scrollTop; render(); $('#scroller').scrollTop = y; }
  else if (act === 'edit') openForm(id);
});
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  if (query) { query = ''; $('#searchInput').value = ''; $('#searchBar').hidden = true; $('#searchBtn').setAttribute('aria-pressed', 'false'); }
  else if (view === b.dataset.view) { $('#scroller').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  view = b.dataset.view; showDone = false; $('#scroller').scrollTop = 0; render();
});
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  const f = b.dataset.filter;
  if (f === 'edit') { renderCatSheet(); openSheet('#catSheet'); return; }
  catFilter = f === '*' ? null : f; render();
});

let lastDay = todayISO();
const dayCheck = () => { if (todayISO() !== lastDay) { lastDay = todayISO(); render(); } };
setInterval(dayCheck, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) dayCheck(); });

// ---------- Funcionar sin conexión ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

render();
initStore().catch(() => { loaded = true; setSync('warn', 'No se pudo conectar'); render(); });
