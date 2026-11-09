import { firebaseConfig } from './config.js';
import { parseQuick, fold } from './parse.js';
import { toICS, googleURL } from './cal.js';
import { DAY_ORDER, DAY_LETTER, MONTHS_SHORT, normTag, pad, isoDate, todayISO, parseISO, addDays, dim, mondayOf, toMin, uid, esc, cap, monthDate, stepDate, nextDate, alignStart, friendlyDate, longDate, repeatLabel, durationMin, autoPoints, taskPoints, isLate, habitPoints, habitOK, weekCount, applies, habitStreak, habitBest, wakeTarget, bedMin, fmtDur, judgeSleep, nowHM, LEVEL_NAMES, levelStart, levelOf } from './logic.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLORS = ['violeta', 'naranja', 'verde', 'azul', 'gris', 'rosa', 'rojo', 'amarillo', 'turquesa', 'marron'];
const DEFAULT_CATS = [
  { id: 'evento', name: 'Evento', color: 'violeta' }, { id: 'entreno', name: 'Entreno', color: 'naranja' },
  { id: 'casa', name: 'Casa', color: 'verde' }, { id: 'estudio', name: 'Estudio', color: 'azul' },
  { id: 'trabajo', name: 'Trabajo', color: 'gris' }, { id: 'personal', name: 'Personal', color: 'rosa' },
];
const NO_CAT = { id: '', name: 'Sin categoría', color: 'gris' };
const VIEWS = { hoy: 'Hoy', semana: 'Agenda', habitos: 'Hábitos', proximas: 'Próximas', sinfecha: 'Sin fecha', hechas: 'Progreso' };
const TICK = c => `<svg viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>`;
const $ = s => document.querySelector(s);

let tasks = [];
let cats = DEFAULT_CATS;
let habits = [];
let stats = { goal: 100, days: {}, focus: {} };
let rewards = { list: [], redeemed: [] };
let templates = [];
let books = [];
// Ajustes extra guardados en la nube: ánimo, filtros y jardín
let extra = { mood: {}, filters: [], garden: [], prefs: {} };
// Secciones que se pueden apagar en ⋯ → Ayuda y secciones
const SECTIONS = [
  ['ahora', 'Ahora toca', 'Tarjeta en Hoy con lo que toca según la hora'],
  ['bandeja', 'Bandeja rápida', 'Campo “Apuntar rápido…” en Hoy'],
  ['planificar', 'Planificar mi día', 'Aviso por la mañana y botón en Hoy'],
  ['repaso', 'Repaso de la semana', 'Aviso de los domingos'],
  ['matriz', 'Matriz de prioridades', 'Vista en Agenda'],
  ['temporizador', 'Temporizador', 'Botón para concentrarte en una tarea'],
  ['jardin', 'Jardín', 'La planta del temporizador y tu jardín en Progreso'],
  ['recompensas', 'Recompensas', 'Canjear puntos por premios'],
  ['logros', 'Niveles y logros', 'En Progreso'],
  ['animo', 'Ánimo y energía', 'En Hábitos, Hoy (aviso) y Progreso'],
  ['estimado', 'Estimado vs real', 'En Progreso'],
  ['concentracion', 'Concentración por asignatura', 'En Progreso'],
];
const on = id => !(extra.prefs?.off || []).includes(id);
let dayOffset = 0, monthOffset = 0, calSel = null, sinfechaMode = 'sinfecha', activeFilter = null;
let loaded = false;
let view = 'hoy';
let agendaMode = 'semana';
let weekOffset = 0;
let catFilter = null;
let query = '';
let showDone = false;
let selectedDay = null;
// Estado del formulario de tarea
let editingId = null, formCat = 'personal', formDays = [], formParts = [], formNoDate = false, splitDays = [1, 2, 3, 4, 5], formSomeday = false, formTonight = false;

document.documentElement.dataset.v = '12';
// ---------- Registro de errores (se ve en ⋯ → Ayuda) ----------
const EKEY = 'mis-tareas-errores';
function logError(msg, where) {
  try {
    const list = JSON.parse(localStorage.getItem(EKEY) || '[]');
    list.push({ at: new Date().toISOString(), msg: String(msg).slice(0, 400), where: String(where || '').slice(0, 200), v: document.documentElement.dataset.v || '' });
    localStorage.setItem(EKEY, JSON.stringify(list.slice(-30)));
  } catch {}
}
window.addEventListener('error', e => logError(e.message, `${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', e => logError(e.reason?.message || e.reason, e.reason?.code || 'promesa'));

// ---------- Que no parezca una web ----------
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, .code')) e.preventDefault(); });

// ---------- Apariencia (por dispositivo) ----------
const ACCENTS = {
  azul: { l: ['#2747c9', '#e4e9fb', '#ffffff'], d: ['#8ea2ff', '#232b52', '#10143a'] },
  violeta: { l: ['#6741d9', '#ece5ff', '#ffffff'], d: ['#b197fc', '#2d2550', '#170f33'] },
  verde: { l: ['#2b8a3e', '#e3f4e7', '#ffffff'], d: ['#69db7c', '#1f3a26', '#0b1f10'] },
  turquesa: { l: ['#0b7285', '#dff3f6', '#ffffff'], d: ['#66d9e8', '#173a40', '#062126'] },
  rosa: { l: ['#c2255c', '#fde6ee', '#ffffff'], d: ['#faa2c1', '#4a2232', '#2b0a17'] },
  naranja: { l: ['#c4510a', '#fff0e3', '#ffffff'], d: ['#ffa94d', '#44301c', '#2a1503'] },
};
let look = { theme: 'auto', accent: 'azul' };
try { look = { ...look, ...JSON.parse(localStorage.getItem('mis-tareas-look')) }; } catch {}
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyLook() {
  const root = document.documentElement;
  if (look.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = look.theme;
  const dark = look.theme === 'dark' || (look.theme === 'auto' && darkMQ.matches);
  const [a, soft, ink] = (ACCENTS[look.accent] || ACCENTS.azul)[dark ? 'd' : 'l'];
  root.style.setProperty('--accent', a); root.style.setProperty('--accent-soft', soft); root.style.setProperty('--accent-ink', ink);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#121413' : '#f3f4f1'));
}
applyLook();
darkMQ.addEventListener?.('change', applyLook);

// ---------- Utilidades ----------
const catOf = id => cats.find(c => c.id === id) || NO_CAT;
const colorVar = c => `var(--k-${COLORS.includes(c) ? c : 'gris'})`;
const children = id => tasks.filter(x => x.parentId === id);
const progressOf = id => { const ch = children(id); return { done: ch.filter(c => c.done).length, total: ch.length }; };

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
    parentId: t.parentId || '', inbox: !!t.inbox && !t.date,
    someday: !!t.someday && !t.date, tonight: !!t.tonight && !!t.date,
    tags: Array.isArray(t.tags) ? [...new Set(t.tags.map(normTag).filter(Boolean))].slice(0, 10) : [],
    streak: Number(t.streak) || 0, best: Number(t.best) || 0,
    history: Array.isArray(t.history) ? t.history.filter(d => typeof d === 'string').slice(-120) : [],
    pts: Number(t.pts) || 0, ptsDay: t.ptsDay || '', focus: Number(t.focus) || 0,
    gcal: t.gcal && t.gcal.id ? { id: String(t.gcal.id), updated: String(t.gcal.updated || '') } : null,
    focusLog: t.focusLog && typeof t.focusLog === 'object' ? Object.fromEntries(Object.entries(t.focusLog).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && Number(v) > 0).sort().slice(-120)) : {},
  };
}
function cleanHabit(h) {
  const log = {};
  Object.entries(h.log || {}).sort().slice(-400).forEach(([k, v]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(k) && [1, -1].includes(Number(v))) log[k] = Number(v); });
  const kind = ['quit', 'sleep', 'routine'].includes(h.kind) ? h.kind : 'build';
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
  if (kind === 'routine') {
    const steps = (Array.isArray(h.steps) ? h.steps : []).filter(s => s && s.text && /^\d{2}:\d{2}$/.test(s.time || ''))
      .map(s => ({ id: String(s.id || Math.random().toString(36).slice(2, 9)), time: s.time, text: String(s.text).slice(0, 120) })).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 30);
    const ids = new Set(steps.map(s => s.id)), stepsDone = {};
    Object.entries(h.stepsDone || {}).sort().slice(-120).forEach(([k, v]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(v)) stepsDone[k] = v.filter(x => ids.has(x)); });
    Object.assign(out, { steps, stepsDone, days: Array.isArray(h.days) ? h.days.filter(d => d >= 0 && d <= 6) : [] });
  }
  return out;
}

// ---------- Almacenamiento ----------
const LKEY = 'mis-tareas-v1', LCATS = 'mis-tareas-cats', LHAB = 'mis-tareas-habitos', LSTATS = 'mis-tareas-puntos', LREW = 'mis-tareas-premios', LTPL = 'mis-tareas-plantillas';
const LBOOKS = 'mis-tareas-libros';
function cleanBook(b) {
  const n = v => Number(v) > 0 ? Math.min(20000, Math.round(Number(v))) : null;
  const pages = n(b.pages);
  return { title: String(b.title || '').slice(0, 200), author: String(b.author || '').slice(0, 120), genre: String(b.genre || '').slice(0, 60),
    status: ['want', 'reading', 'read'].includes(b.status) ? b.status : 'want',
    pages, page: pages ? Math.min(pages, n(b.page) || 0) : (n(b.page) || 0),
    rating: [1, 2, 3, 4, 5].includes(Number(b.rating)) ? Number(b.rating) : null, notes: String(b.notes || '').slice(0, 1000),
    started: /^\d{4}-\d{2}-\d{2}$/.test(b.started || '') ? b.started : '', finished: /^\d{4}-\d{2}-\d{2}$/.test(b.finished || '') ? b.finished : '',
    order: Number(b.order) || Date.now() };
}
const normTemplates = l => (Array.isArray(l) ? l : []).filter(x => x && x.name && x.task).slice(0, 50);
const normRewards = r => ({
  list: Array.isArray(r?.list) ? r.list.filter(x => x && x.name).map(x => ({ id: String(x.id), name: String(x.name).slice(0, 60), cost: Math.max(1, Math.round(Number(x.cost)) || 1) })) : [],
  redeemed: Array.isArray(r?.redeemed) ? r.redeemed.filter(x => x && x.name).slice(-200).map(x => ({ id: String(x.id), name: String(x.name), cost: Number(x.cost) || 0, at: Number(x.at) || 0 })) : [],
});
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
  async setRoutineDay(h, day, ids, val) {
    if (!this.fb) return local(LHAB, habits);
    return this.fb.setDoc(this.ref('habits', h.id), { stepsDone: { [day]: ids }, log: { [day]: val === null ? this.fb.deleteField() : val } }, { merge: true });
  },
  async setSleep(h, day, val, night) {
    if (!this.fb) return local(LHAB, habits);
    const del = this.fb.deleteField();
    return this.fb.setDoc(this.ref('habits', h.id), { log: { [day]: val === null ? del : val }, nights: { [day]: val === null ? del : night } }, { merge: true });
  },
  async addPoints(n, day) { if (!this.fb) return local(LSTATS, stats); return this.fb.setDoc(this.ref('settings', 'stats'), { days: { [day]: this.fb.increment(n) } }, { merge: true }); },
  async saveExtra(key) {
    if (!this.fb) return local('mis-tareas-' + key, extra[key]);
    const val = key === 'mood' ? { days: extra.mood } : key === 'filters' ? { list: extra.filters } : key === 'prefs' ? { value: extra.prefs } : { plants: extra.garden.slice(-600) };
    return this.fb.setDoc(this.ref('settings', key), structuredClone(val));
  },
  async putBook(b) { if (!this.fb) return local(LBOOKS, books); const { id, ...rest } = b; return this.fb.setDoc(this.ref('books', id), cleanBook(rest)); },
  async removeBook(id) { if (!this.fb) return local(LBOOKS, books); return this.fb.deleteDoc(this.ref('books', id)); },
  async saveTemplates() { if (!this.fb) return local(LTPL, templates); return this.fb.setDoc(this.ref('settings', 'templates'), { list: structuredClone(templates) }); },
  async saveRewards() { if (!this.fb) return local(LREW, rewards); return this.fb.setDoc(this.ref('settings', 'rewards'), structuredClone(rewards)); },
  async addFocus(min, day) { if (!this.fb) return local(LSTATS, stats); return this.fb.setDoc(this.ref('settings', 'stats'), { focus: { [day]: this.fb.increment(min) } }, { merge: true }); },
  async saveGoal(goal) { if (!this.fb) return local(LSTATS, stats); return this.fb.setDoc(this.ref('settings', 'stats'), { goal }, { merge: true }); },
};
function setSync(kind, text) { $('#sync').className = 'sync ' + kind; $('#syncText').textContent = text; }
function writeFailed(e) { setSync('warn', 'No se guardó el último cambio'); logError(e?.message || 'Fallo al guardar', e?.code || 'guardar'); }
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
    stats = { goal: 100, days: {}, focus: {}, ...get(LSTATS, {}) };
    rewards = normRewards(get(LREW, {}));
    templates = normTemplates(get(LTPL, []));
    books = get(LBOOKS, []).map(b => ({ id: b.id, ...cleanBook(b) }));
    extra = { mood: get('mis-tareas-mood', {}), filters: get('mis-tareas-filters', []), garden: get('mis-tareas-garden', []), prefs: get('mis-tareas-prefs', {}) };
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
      store.fb = null; store.user = null; tasks = []; books = []; cats = DEFAULT_CATS; habits = []; stats = { goal: 100, days: {}, focus: {} }; rewards = { list: [], redeemed: [] }; extra = { mood: {}, filters: [], garden: [], prefs: {} }; loaded = false;
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
      stats = { goal: Number(d.goal) > 0 ? Number(d.goal) : 100, days: d.days && typeof d.days === 'object' ? d.days : {}, focus: d.focus && typeof d.focus === 'object' ? d.focus : {} };
      render(); if (!$('#rewardSheet').hidden) renderRewards();
    }, () => {}));
    for (const [key, field] of [['mood', 'days'], ['filters', 'list'], ['garden', 'plants'], ['prefs', 'value']]) {
      unsubs.push(fs.onSnapshot(store.ref('settings', key), snap => {
        const v = snap.exists() ? snap.data()[field] : null;
        extra[key] = key === 'mood' || key === 'prefs' ? (v && typeof v === 'object' ? v : {}) : (Array.isArray(v) ? v : []);
        if (key === 'prefs' && !snap.metadata.fromCache) maybeWelcome(!snap.exists());
        render(); if (key === 'filters' && !$('#filterSheet').hidden) renderFilterSheet();
      }, () => {}));
    }
    unsubs.push(fs.onSnapshot(fs.collection(db, 'users', user.uid, 'books'), snap => {
      books = snap.docs.map(d => ({ id: d.id, ...cleanBook(d.data()) }));
      if (!$('#booksSheet').hidden && !document.activeElement?.closest?.('#booksSheet')) renderBooks();
    }, () => {}));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'templates'), snap => {
      templates = normTemplates(snap.exists() ? snap.data().list : []);
      if (!$('#tplSheet').hidden) renderTplSheet();
    }, () => {}));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'rewards'), snap => {
      rewards = normRewards(snap.exists() ? snap.data() : {});
      if (!$('#rewardSheet').hidden) renderRewards();
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
// Google siempre pregunta con qué cuenta entrar (si no, entra sola con la última y puede ser otra)
const googleProvider = lib => { const p = new lib.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; };
function setupLogin(a, auth) {
  const err = m => { $('#loginErr').textContent = m; $('#loginErr').hidden = !m; };
  const creds = () => [$('#email').value.trim(), $('#password').value];
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); err(''); try { await auth.signInWithEmailAndPassword(a, ...creds()); } catch (x) { err(authMsg(x)); } });
  $('#signupBtn').addEventListener('click', async () => {
    err(''); if (!$('#loginForm').reportValidity()) return;
    try { const r = await auth.createUserWithEmailAndPassword(a, ...creds()); auth.sendEmailVerification(r.user).catch(() => {}); } catch (x) { err(authMsg(x)); }
  });
  $('#googleLogin').addEventListener('click', async () => {
    err('');
    try { await auth.signInWithPopup(a, googleProvider(auth)); }
    catch (x) { err(x.code === 'auth/popup-blocked' || x.code === 'auth/operation-not-supported-in-this-environment' ? 'En la app del iPhone Google no puede abrir su ventana. Entra con tu correo, o prueba desde Safari.' : authMsg(x)); }
  });
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
  'auth/popup-closed-by-user': 'Has cerrado la ventana de Google antes de terminar.',
  'auth/cancelled-popup-request': 'Has cerrado la ventana de Google antes de terminar.',
  'auth/account-exists-with-different-credential': 'Ya tienes cuenta con ese correo: entra con tu contraseña y vincula Google en ⋯ → Cuenta.',
  'auth/provider-already-linked': 'Tu cuenta de Google ya estaba vinculada.',
  'auth/popup-blocked': 'No se pudo abrir la ventana de Google. En la app del iPhone hazlo desde Safari o el ordenador.',
  'auth/operation-not-supported-in-this-environment': 'En la app del iPhone Google no puede abrir su ventana. Hazlo desde Safari o el ordenador.',
  'auth/user-mismatch': 'Elige en Google la misma cuenta con la que has entrado.',
  'auth/requires-recent-login': 'Por seguridad, cierra sesión, vuelve a entrar y repite el cambio.',
  'auth/operation-not-allowed': 'Firebase no permite este cambio ahora mismo. Revisa la configuración de Authentication.',
})[e.code] || 'No se pudo completar. Inténtalo otra vez.';

// ---------- Cuenta ----------
function showAccount() {
  const u = store.user; if (!u) return;
  $('#accountInfo').textContent = 'Sesión iniciada como ' + u.email;
  $('#hello').textContent = u.displayName ? `Hola, ${u.displayName}` : 'Ajustes';
  $('#accEmail').textContent = u.email;
  $('#accName').textContent = u.displayName || 'Sin nombre'; $('#accName').classList.toggle('empty', !u.displayName);
  if (document.activeElement !== $('#nameInput')) $('#nameInput').value = u.displayName || '';
  const hasGoogle = u.providerData.some(p => p.providerId === 'google.com'), hasPass = u.providerData.some(p => p.providerId === 'password');
  $('#verifyInfo').textContent = u.emailVerified ? '✓ Tu correo está verificado.' : 'Tu correo aún no está verificado: verifícalo para poder recuperar la cuenta si olvidas la contraseña.';
  $('#verifyBtn').hidden = u.emailVerified;
  $('#googleInfo').textContent = hasGoogle ? '✓ Tu cuenta de Google está vinculada: puedes entrar con Google.' : 'Vincula tu cuenta de Google para poder entrar también con ella (en el ordenador o en Safari).';
  $('#googleLink').hidden = hasGoogle;
  // El correo se puede cambiar siempre: con contraseña, o confirmando con Google si entras solo con Google
  $('#accPassRow').hidden = !hasPass; if (!hasPass) $('#passForm').hidden = true;
  $('#emailPass').hidden = !hasPass; $('#emailPass').required = hasPass;
  $('#emailGoogleHint').hidden = hasPass;
}
function setupAccount() {
  const say = (el, text, ok) => { el.textContent = text; el.className = ok ? 'okmsg' : 'err'; el.hidden = !text; };
  $('#verifyBtn').addEventListener('click', async () => {
    try { await store.authLib.sendEmailVerification(store.user); say($('#secMsg'), `Te he enviado un correo a ${store.user.email}. Pulsa el enlace y vuelve a abrir la app.`, true); }
    catch (x) { say($('#secMsg'), authMsg(x)); }
  });
  $('#googleLink').addEventListener('click', async () => {
    try { await store.authLib.linkWithPopup(store.user, googleProvider(store.authLib)); await store.user.reload(); showAccount(); say($('#secMsg'), 'Cuenta de Google vinculada.', true); }
    catch (x) { say($('#secMsg'), x.code === 'auth/credential-already-in-use' ? 'Esa cuenta de Google ya se usa en otra cuenta de la app.' : x.code === 'auth/popup-blocked' ? 'El navegador bloqueó la ventana de Google. Hazlo desde el ordenador o desde Safari.' : authMsg(x)); }
  });
  const reauth = async pass => {
    const { EmailAuthProvider, reauthenticateWithCredential } = store.authLib;
    try { await reauthenticateWithCredential(store.user, EmailAuthProvider.credential(store.user.email, pass)); }
    catch (x) { if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(x.code)) throw { code: 'auth/current-password' }; throw x; }
  };
  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await store.authLib.updateProfile(store.user, { displayName: $('#nameInput').value.trim() }); showAccount(); $('#nameForm').hidden = true; document.querySelectorAll('[data-acc]').forEach(x => x.classList.remove('on')); }
    catch (x) { say($('#nameMsg'), authMsg(x)); }
  });
  $('#emailForm').addEventListener('submit', async e => {
    e.preventDefault(); const msg = $('#emailMsg'); say(msg, '');
    const email = $('#newEmail').value.trim();
    try {
      if (store.user.providerData.some(p => p.providerId === 'password')) await reauth($('#emailPass').value);
      else await store.authLib.reauthenticateWithPopup(store.user, googleProvider(store.authLib));
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
    // El resumen público de la clave vieja se borra
    if (siriKey) store.fb.deleteDoc(store.fb.doc(store.fb.db, 'siri', siriKey)).catch(() => {});
    lastSummary = '';
    store.fb.setDoc(store.ref('settings', 'siri'), { key: newKey() }).catch(writeFailed);
  });
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const el = $('#' + b.dataset.copy);
    try { await navigator.clipboard.writeText(el.textContent); $('#copyMsg').textContent = 'Copiado. Pégalo en Atajos.'; }
    catch { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copyMsg').textContent = 'Seleccionado: mantén pulsado y elige Copiar.'; }
    $('#copyMsg').hidden = false;
  }));
}
// Resumen del día para el atajo "¿Qué tengo hoy?". Se guarda en siri/<clave>, que solo
// se puede leer sabiendo la clave (no se pueden listar) y solo lo escribe la dueña.
let lastSummary = '', summaryTimer = null;
function daySummary(d) {
  const today = todayISO(), list = tasks.filter(t => !t.done && t.date === d && !children(t.id).length).sort(sortTasks);
  const name = parseISO(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const timed = list.filter(t => t.time).map(t => `a las ${t.time}, ${t.title}`), untimed = list.filter(t => !t.time).map(t => t.title);
  let s = `${d === today ? 'Hoy' : 'Mañana'}, ${name}. ` + (list.length ? `Tienes ${list.length} ${list.length === 1 ? 'tarea' : 'tareas'}. ` : 'No tienes tareas. ');
  if (timed.length) s += cap(timed.join('; ')) + '. ';
  if (untimed.length) s += `Sin hora: ${untimed.join(', ')}. `;
  if (d === today) {
    const late = tasks.filter(isLate).length; if (late) s += `Y ${late} ${late === 1 ? 'atrasada' : 'atrasadas'}. `;
    const hp = habits.filter(h => !habitDoneToday(h)).length; if (hp) s += `Te ${hp === 1 ? 'queda 1 hábito' : `quedan ${hp} hábitos`}. `;
    s += `Llevas ${pointsOn(today)} puntos.`;
  }
  return s.trim();
}
function publishSummary() {
  if (!store.fb || !siriKey || !loaded) return;
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    const today = todayISO(), body = { uid: store.uid, fecha: today, hoy: daySummary(today), manana: daySummary(addDays(today, 1)) };
    const sig = JSON.stringify(body); if (sig === lastSummary) return; lastSummary = sig;
    store.fb.setDoc(store.fb.doc(store.fb.db, 'siri', siriKey), { ...body, actualizado: new Date().toISOString() }).catch(e => { lastSummary = ''; logError(e.message, 'resumen Siri'); });
  }, 3000);
}
function renderSiri() {
  $('#siriOff').hidden = !!siriKey; $('#siriSetup').hidden = !siriKey;
  if (!siriKey || !store.uid) return;
  $('#siriReadUrl').textContent = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/siri/${siriKey}?key=${firebaseConfig.apiKey}`;
  publishSummary();
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
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.back || '#menuSheet')));
$('#openPrefs').addEventListener('click', () => openSheet('#prefSheet'));
$('#openSections').addEventListener('click', () => { renderHelp(); openSheet('#secSheet'); });
$('#openBooks').addEventListener('click', () => { bookOpen = null; renderBooks(); openSheet('#booksSheet'); });
// Cuenta: el lápiz de cada dato abre su formulario
document.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', () => {
  const f = $('#' + b.dataset.acc), show = f.hidden;
  ['#nameForm', '#emailForm', '#passForm'].forEach(x => $(x).hidden = true);
  document.querySelectorAll('[data-acc]').forEach(x => x.classList.remove('on'));
  f.hidden = !show; b.classList.toggle('on', show);
  if (show) f.querySelector('input')?.focus();
}));
$('#menuBtn').addEventListener('click', () => { showAccount(); openSheet('#menuSheet'); });
$('#openAccount').addEventListener('click', () => { showAccount(); ['#nameMsg', '#emailMsg', '#passMsg'].forEach(s => $(s).hidden = true); ['#nameForm', '#emailForm', '#passForm'].forEach(s => $(s).hidden = true); document.querySelectorAll('[data-acc]').forEach(x => x.classList.remove('on')); openSheet('#accountSheet'); });
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
  $('#somedayBtn').hidden = !formNoDate; $('#somedayBtn').setAttribute('aria-pressed', formSomeday);
  $('#tonightBtn').hidden = formNoDate || date !== todayISO(); $('#tonightBtn').setAttribute('aria-pressed', formTonight);
  // Sin fecha no hay prioridad, repetición ni aviso: salen al ponerle un día
  ['#prioField', '#repeatField', '#remindField'].forEach(x => $(x).hidden = formNoDate);
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
  (p.tags || []).forEach(t => bits.push('@' + t));
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
$('#somedayBtn').addEventListener('click', () => { formSomeday = !formSomeday; renderWhen(); });
$('#tonightBtn').addEventListener('click', () => { formTonight = !formTonight; renderWhen(); });
const readTags = () => $('#tags').value.split(/[,\s]+/).map(normTag).filter(Boolean);
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
  $('#splitToText').textContent = $('#splitTo').value ? longDate($('#splitTo').value) : 'Una por día';
  renderWhen();
}
$('#splitTo').addEventListener('change', renderParts);
// Al abrir "Repartir", si la tarea tiene fecha (un examen), propone terminar el día antes
$('#splitBox').addEventListener('toggle', () => {
  if (!$('#splitBox').open || $('#splitTo').value || formNoDate || !$('#date').value || $('#date').value <= todayISO()) return;
  $('#splitTo').value = addDays($('#date').value, -1); renderParts();
});
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
  const from = $('#splitFrom').value || todayISO(), to = $('#splitTo').value;
  const ok = d => !splitDays.length || splitDays.includes(parseISO(d).getDay());
  const start = formParts.length;
  if (to && to >= from) {
    // Reparte las n partes de forma pareja entre los días disponibles hasta la fecha límite
    const avail = []; for (let d = from, g = 0; d <= to && g < 800; d = addDays(d, 1), g++) if (ok(d)) avail.push(d);
    if (!avail.length) { $('#splitHint').textContent = 'No hay ningún día elegido entre esas fechas.'; return; }
    for (let i = 0; i < n; i++) addPart(`${base} ${start + i + 1}`, avail[Math.floor(i * avail.length / n)]);
  } else {
    let d = from, made = 0, guard = 0;
    while (made < n && guard++ < 500) { if (ok(d)) { made++; addPart(`${base} ${start + made}`, d); } d = addDays(d, 1); }
  }
  $('#splitBox').open = false; renderParts();
});

function openForm(id) {
  const t = id ? tasks.find(x => x.id === id) : null;
  editingId = t ? t.id : null; tplParts = null;
  $('#title').value = t ? t.title : '';
  formCat = t ? (t.cat ?? '') : (catFilter || cats[cats.length - 1]?.id || '');
  if (!t && !cats.some(c => c.id === formCat)) formCat = cats[0]?.id || '';
  formNoDate = t ? !t.date : view === 'sinfecha';
  formSomeday = t ? !!t.someday : (view === 'sinfecha' && sinfechaMode === 'someday');
  formTonight = t ? !!t.tonight : false;
  $('#tags').value = t ? (t.tags || []).join(', ') : '';
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
  $('#splitFrom').value = ''; $('#splitTo').value = ''; $('#splitName').value = ''; $('#splitBox').open = false; $('#partNew').value = '';
  $('#sheetTitle').textContent = t ? (t.parentId ? 'Editar parte' : 'Editar tarea') : 'Nueva tarea';
  $('#submitBtn').textContent = t ? 'Guardar' : 'Añadir';
  $('#deleteBtn').hidden = !t;
  $('#calRow').hidden = !(t && t.date);
  $('#timerBtn').hidden = !t || t.done || children(t.id).length > 0 || !on('temporizador');
  $('#tplSave').hidden = !t || !!t.parentId;
  $('#tplChips').hidden = !!t || !templates.length;
  $('#tplChips').innerHTML = templates.map(p => `<button type="button" class="chip" data-tpl="${p.id}">📋 ${esc(p.name)}</button>`).join('');
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
    remind: formNoDate || $('#remind').value === '' ? null : Number($('#remind').value), notes: $('#notes').value.trim(), inbox: false,
    tags: readTags(), someday: formNoDate && formSomeday, tonight: !formNoDate && formTonight,
  };
  if (!editingId) {
    const p = parseQuick(title, cats);
    data.title = p.title;
    if (p.date) { data.date = p.date; formNoDate = false; }
    if (p.time) { data.time = p.time; data.endTime = p.endTime || data.endTime || $('#endTime').value; if (!data.date) data.date = todayISO(); }
    if (p.cat) data.cat = p.cat;
    if (p.prio) data.prio = p.prio;
    if (p.tags) data.tags = [...new Set([...data.tags, ...p.tags.map(normTag)])];
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

// ---------- Plantillas ----------
// Guarda la tarea tal y como está en el formulario; las partes, con su día relativo a la fecha de la tarea
$('#tplSave').addEventListener('click', () => {
  const base = formNoDate ? '' : $('#date').value;
  const name = $('#title').value.trim() || 'Plantilla';
  const tpl = {
    id: 'tp' + uid(), name,
    task: { title: name, cat: formCat, noDate: formNoDate, time: $('#time').value, endTime: $('#endTime').value, prio: $('#prio').value,
      repeat: $('#repeat').value, days: formDays, monthDay: $('#repeat').value === 'mensual' ? Number($('#monthDay').value) : null,
      minutes: $('#minutes').value, points: $('#points').value, remind: $('#remind').value, notes: $('#notes').value.trim() },
    parts: formParts.map(p => ({ title: p.title, offset: p.date && base ? Math.round((parseISO(p.date) - parseISO(base)) / 864e5) : null })),
  };
  templates = [...templates.filter(x => x.name !== name), tpl];
  store.saveTemplates().catch(writeFailed);
  showToast(`📋 Plantilla “${name}” guardada${tpl.parts.length ? ` con ${tpl.parts.length} partes` : ''}`);
});
$('#tplChips').addEventListener('click', e => {
  const b = e.target.closest('[data-tpl]'); if (!b) return;
  const p = templates.find(x => x.id === b.dataset.tpl); if (!p) return;
  const t = p.task;
  $('#title').value = t.title; formCat = t.cat ?? formCat; formNoDate = !!t.noDate;
  if (!$('#date').value) $('#date').value = todayISO();
  $('#time').value = t.time || ''; $('#endTime').value = t.endTime || ''; $('#prio').value = t.prio || 'normal';
  $('#repeat').value = t.repeat || ''; formDays = [...(t.days || [])]; renderMonthDay(); if (t.monthDay) $('#monthDay').value = String(t.monthDay);
  $('#minutes').value = t.minutes || ''; $('#points').value = t.points ?? ''; $('#remind').value = t.remind ?? ''; $('#notes').value = t.notes || '';
  tplParts = p.parts;
  placeTplParts();
  renderCatChips(); renderParts(); renderDetected();
  document.querySelectorAll('#tplChips .chip').forEach(c => c.setAttribute('aria-pressed', c === b));
});
// Las partes de la plantilla se recolocan si cambias la fecha
let tplParts = null;
function placeTplParts() {
  if (!tplParts) return;
  const base = formNoDate ? '' : $('#date').value;
  formParts = tplParts.map(p => ({ id: 'nuevo-' + uid(), title: p.title, date: p.offset !== null && p.offset !== undefined && base ? addDays(base, p.offset) : '', done: false, isNew: true }));
}
$('#date').addEventListener('change', () => { if (tplParts && !editingId) { placeTplParts(); renderParts(); } });
function renderTplSheet() {
  $('#tplList').innerHTML = templates.length ? templates.map(p => `<div class="rwrow"><div><div class="n">📋 ${esc(p.name)}</div><div class="c">${esc(catOf(p.task.cat).name)}${p.parts.length ? ` · ${p.parts.length} partes` : ''}${p.task.repeat ? ' · se repite' : ''}</div></div><span></span><button type="button" class="x" data-tpldel="${p.id}" aria-label="Borrar plantilla">✕</button></div>`).join('')
    : '<p class="hint">Todavía no tienes plantillas.</p>';
}
$('#openTpl').addEventListener('click', () => { renderTplSheet(); openSheet('#tplSheet'); });
$('#tplList').addEventListener('click', e => {
  const b = e.target.closest('[data-tpldel]'); if (!b) return;
  const gone = templates.find(x => x.id === b.dataset.tpldel);
  templates = templates.filter(x => x !== gone); store.saveTemplates().catch(writeFailed); renderTplSheet();
  showToast(`Plantilla borrada: ${gone.name}`, () => { templates.push(gone); store.saveTemplates().catch(writeFailed); renderTplSheet(); });
});

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

// ---------- Temporizador de estudio ----------
// El estado se guarda en el dispositivo, así sigue contando aunque cierres la app un rato
const TKEY = 'mis-tareas-timer';
let tm = null, tmTick = null, tmAudio = null, tmLock = null;
const tmSave = () => { try { tm ? localStorage.setItem(TKEY, JSON.stringify(tm)) : localStorage.removeItem(TKEY); } catch {} };
const tmElapsed = () => tm ? Date.now() - tm.start - tm.paused - (tm.pausedAt ? Date.now() - tm.pausedAt : 0) : 0;
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
function beep() {
  try { const o = tmAudio.createOscillator(), g = tmAudio.createGain(); o.frequency.value = 880; g.gain.value = .15; o.connect(g); g.connect(tmAudio.destination); o.start(); o.stop(tmAudio.currentTime + .4); } catch {}
  navigator.vibrate?.([200, 100, 200]);
}
function creditFocus(min) {
  if (!tm || min <= 0) return;
  const t = tasks.find(x => x.id === tm.taskId), d = todayISO();
  tm.total = (tm.total || 0) + min;
  if (t) { t.focus = (t.focus || 0) + min; t.focusLog = { ...(t.focusLog || {}), [d]: (t.focusLog?.[d] || 0) + min }; store.put(t).catch(writeFailed); }
  stats.focus[d] = (stats.focus[d] || 0) + min; store.addFocus(min, d).catch(writeFailed);
  addPoints(min);
}
function openTimer(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  closeSheets(true);
  if (!tm || tm.taskId !== id) { if (tm) stopTimer(false); tm = { taskId: id, title: t.title, mode: '25/5', phase: 'idle', round: 1, start: 0, paused: 0, pausedAt: null, total: 0 }; }
  showTimer();
}
function showTimer() {
  $('#timer').hidden = false; drawTimer();
  clearInterval(tmTick); tmTick = setInterval(drawTimer, 500);
}
function lens() { const [f, b] = tm.mode === 'free' ? [0, 0] : tm.mode.split('/').map(Number); return { f: f * 60000, b: (tm.round % 4 === 0 && f === 25 ? 15 : b) * 60000 }; }
function drawTimer() {
  if (!tm) return;
  const L = lens(), el = tmElapsed();
  // Cambios de fase (también los que pasaron con la app cerrada)
  let guard = 0;
  // (espera a que estén cargadas las tareas y los puntos para no perder los minutos)
  while (loaded && (store.fb || !configured) && tm.mode !== 'free' && !tm.pausedAt && tm.phase !== 'idle' && guard++ < 50) {
    const len = tm.phase === 'focus' ? L.f : lens().b, e = tmElapsed();
    if (e < len) break;
    if (tm.phase === 'focus') { creditFocus(Math.round(len / 60000)); plant(len / 60000, true); tm.phase = 'break'; }
    else { tm.phase = 'focus'; tm.round++; }
    tm.start = Date.now() - (e - len); tm.paused = 0; tmSave(); beep();
  }
  const running = tm.phase !== 'idle';
  const len = tm.phase === 'break' ? lens().b : L.f;
  $('#timer').classList.toggle('break', tm.phase === 'break');
  $('#timer').classList.toggle('paused', !!tm.pausedAt);
  $('#tmTask').textContent = tm.title;
  // La planta crece mientras te concentras
  const frac = tm.phase !== 'focus' ? (tm.phase === 'break' ? 1 : 0) : tm.mode === 'free' ? Math.min(1, el / (50 * 60000)) : Math.min(1, tmElapsed() / L.f);
  $('#tmPlant').hidden = !on('jardin');
  $('#tmPlant').textContent = frac < .2 ? '🌰' : frac < .45 ? '🌱' : frac < .7 ? '🌿' : frac < .95 ? '🪴' : '🌳';
  $('#tmPhase').textContent = !running ? 'Elige cómo quieres concentrarte' : tm.phase === 'break' ? `Descanso${tm.round % 4 === 0 && tm.mode === '25/5' ? ' largo' : ''}` : tm.mode === 'free' ? 'Concentración libre' : `Concentración · ronda ${tm.round}`;
  $('#tmClock').textContent = !running ? (tm.mode === 'free' ? '00:00' : mmss(L.f)) : tm.mode === 'free' ? mmss(el) : mmss(len - tmElapsed());
  const cur = tm.phase === 'focus' ? Math.floor(tmElapsed() / 60000) : 0;
  const tot = (tm.total || 0) + (tm.mode === 'free' ? Math.floor(el / 60000) : cur);
  const t = tasks.find(x => x.id === tm.taskId);
  $('#tmTotal').textContent = running ? `Hoy en esta tarea: ${fmtDur(tot) || '0 min'} · total ${fmtDur((t?.focus || 0) + (tm.mode === 'free' ? Math.floor(el / 60000) : cur)) || '0 min'}` : (t?.focus ? `Llevas ${fmtDur(t.focus)} en esta tarea. Cada minuto concentrada suma 1 ⭐.` : 'Cada minuto concentrada suma 1 ⭐.');
  document.querySelectorAll('#tmModes [data-tm]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tm === tm.mode));
  $('#tmModes').hidden = running; $('#tmStart').hidden = running; $('#tmRun').hidden = !running; $('#tmDone').hidden = !running;
  $('#tmPause').textContent = tm.pausedAt ? 'Seguir' : 'Pausa';
  $('#tmClose').textContent = running ? 'Seguir en segundo plano' : 'Cerrar';
}
async function wake(on) {
  try { if (on && !tmLock && navigator.wakeLock) tmLock = await navigator.wakeLock.request('screen'); else if (!on && tmLock) { await tmLock.release(); tmLock = null; } } catch { tmLock = null; }
}
function stopTimer(complete) {
  if (!tm) return;
  if (tm.phase === 'focus') {
    const min = Math.floor(tmElapsed() / 60000);
    creditFocus(min);
    // Pomodoro dejado a medias = planta marchita; en modo libre, crece si llegas a 10 min
    if (min >= 1) plant(min, tm.mode === 'free' ? min >= 10 : false);
  }
  const total = tm.total || 0, id = tm.taskId, title = tm.title;
  tm = null; tmSave(); clearInterval(tmTick); wake(false);
  $('#timer').hidden = true;
  if (complete) { const t = tasks.find(x => x.id === id); if (t && !t.done) toggle(id); }
  else if (total) showToast(`⏱ ${fmtDur(total)} en ${title} · +${total} ⭐`);
  render();
}
$('#tmModes').addEventListener('click', e => { const b = e.target.closest('[data-tm]'); if (b && tm) { tm.mode = b.dataset.tm; drawTimer(); } });
$('#tmStart').addEventListener('click', () => {
  try { tmAudio ||= new (window.AudioContext || window.webkitAudioContext)(); tmAudio.resume?.(); } catch {}
  tm.phase = 'focus'; tm.start = Date.now(); tm.paused = 0; tm.pausedAt = null; tmSave(); wake(true); drawTimer();
});
$('#tmPause').addEventListener('click', () => {
  if (tm.pausedAt) { tm.paused += Date.now() - tm.pausedAt; tm.pausedAt = null; wake(true); } else { tm.pausedAt = Date.now(); wake(false); }
  tmSave(); drawTimer();
});
$('#tmStop').addEventListener('click', () => stopTimer(false));
$('#tmDone').addEventListener('click', () => stopTimer(true));
$('#tmClose').addEventListener('click', () => { if (tm && tm.phase === 'idle') tm = null; tmSave(); clearInterval(tmTick); $('#timer').hidden = true; render(); });
$('#timerBtn').addEventListener('click', () => openTimer(editingId));
document.addEventListener('visibilitychange', () => { if (!document.hidden && tm && tm.phase !== 'idle' && !tm.pausedAt) wake(true); });
// Si había un temporizador en marcha, vuelve a aparecer al abrir la app
try { const saved = JSON.parse(localStorage.getItem(TKEY)); if (saved && saved.phase !== 'idle') { tm = saved; setTimeout(showTimer, 0); } } catch {}
const timerBannerHTML = () => tm && tm.phase !== 'idle' && $('#timer').hidden
  ? `<div class="banner"><span>⏱ ${esc(tm.title)} · ${tm.pausedAt ? 'en pausa' : tm.phase === 'break' ? 'descanso' : 'concentrándote'}</span><button class="btn primary small" data-act="timer" data-id="${tm.taskId}">Volver</button></div>` : '';

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
const matches = (t, q) => q.startsWith('@') ? (t.tags || []).some(g => g.startsWith(normTag(q))) : fold([t.title, t.notes, ...(t.tags || [])].join(' ')).includes(fold(q));

// ---------- Copias ----------
// Copia completa: tareas, hábitos, categorías, puntos, recompensas y plantillas.
// En el iPhone se abre el menú Compartir: elige "Guardar en Archivos" o Google Drive.
async function exportBackup() {
  const name = `mis-tareas-copia-${todayISO()}.json`;
  const data = { app: 'mis-tareas', version: 2, exported: new Date().toISOString(),
    tasks: tasks.map(t => ({ id: t.id, ...clean(t) })), habits, cats, stats, rewards, templates, books };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  const done = () => { try { localStorage.setItem('last-backup', String(Date.now())); } catch {} render(); };
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Copia de Mis Tareas' }); done(); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); done();
}
$('#exportBtn').addEventListener('click', exportBackup);
// Recordatorio semanal de copia
function backupBannerHTML() {
  if (!tasks.length) return '';
  let last = 0; try { last = Number(localStorage.getItem('last-backup')) || 0; } catch {}
  if (!last) { try { localStorage.setItem('last-backup', String(Date.now())); } catch {} return ''; } // empieza a contar desde hoy
  const days = Math.floor((Date.now() - last) / 864e5);
  return days >= 7 ? `<div class="banner"><span>Hace ${days} días de tu última copia de seguridad</span><button class="btn primary small" data-act="backup">Guardar</button></div>` : '';
}
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const info = $('#importInfo');
  try {
    const data = JSON.parse(await f.text());
    // Copia completa de la app
    if (data && data.app === 'mis-tareas' && Array.isArray(data.tasks)) {
      const list = data.tasks.filter(x => x && x.title).map(x => ({ ...x, id: String(x.id || uid()).replace(/[^\w.~:@+-]/g, '_') }));
      list.forEach(x => { const i = tasks.findIndex(t => t.id === x.id); if (i >= 0) tasks[i] = x; else tasks.push(x); });
      await store.putMany(list);
      (data.habits || []).forEach(h => { if (!h?.id) return; const c = { id: h.id, ...cleanHabit(h) }; const i = habits.findIndex(x => x.id === c.id); if (i >= 0) habits[i] = c; else habits.push(c); store.putHabit(c).catch(writeFailed); });
      if (Array.isArray(data.cats) && data.cats.length) await store.saveCats(data.cats).catch(writeFailed);
      if (data.rewards) { rewards = normRewards(data.rewards); store.saveRewards().catch(writeFailed); }
      if (Array.isArray(data.templates)) { templates = normTemplates(data.templates); store.saveTemplates().catch(writeFailed); }
      (data.books || []).forEach(b => { if (!b?.id) return; const c = { id: String(b.id), ...cleanBook(b) }; const i = books.findIndex(x => x.id === c.id); if (i >= 0) books[i] = c; else books.push(c); store.putBook(c).catch(writeFailed); });
      info.textContent = `Copia restaurada: ${list.length} tareas y ${(data.habits || []).length} hábitos. Los puntos no se tocan para no sumarlos dos veces.`;
      render(); return;
    }
    // Un archivo de hábitos o rutinas: {"habits":[…]}
    if (data && !Array.isArray(data) && Array.isArray(data.habits)) {
      const base = Date.now(), list = data.habits.filter(h => h && h.name).map((h, i) => ({ id: String(h.id || 'h' + uid()).replace(/[^\w.~:@+-]/g, '_'), ...cleanHabit({ ...h, order: h.order || base + i }) }));
      list.forEach(h => { const i = habits.findIndex(x => x.id === h.id); if (i >= 0) habits[i] = h; else habits.push(h); store.putHabit(h).catch(writeFailed); });
      info.textContent = `Listo: ${list.length} ${list.length === 1 ? 'hábito importado' : 'hábitos o rutinas importados'}. Míralos en la pestaña Hábitos.`;
      render(); return;
    }
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
// --- Rutina de sueño: se apunta cada mañana; la noche cuenta en el día en que te levantas ---
function saveSleep(id, bed, wake) {
  const h = habits.find(x => x.id === id); if (!h || !bed || !wake) return;
  const d = todayISO(), prev = h.log[d], r = judgeSleep(h, d, bed, wake), next = r.ok ? 1 : -1;
  if (prev === 1) addPoints(-habitPoints(h));
  if (next === 1) addPoints(habitPoints(h));
  h.log[d] = next; h.nights[d] = { bed, wake }; sleepEdit = null;
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
const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const editBtn = (act, label, id = '', open = false) => `<button class="iconbtn${open ? ' on' : ''}" data-act="${act}"${id ? ` data-id="${id}"` : ''} aria-label="${label}" aria-pressed="${open}">${PENCIL}</button>`;
let sleepEdit = null;
// Rutina de sueño en Progreso: solo estadísticas; con el lápiz cambias la noche de hoy
function sleepProgHTML(h) {
  const d = todayISO(), n = h.nights[d], s = habitStreak(h), b = habitBest(h);
  const r = n ? judgeSleep(h, d, n.bed, n.wake) : null, open = sleepEdit === h.id;
  const days = [...Array(14)].map((_, i) => addDays(d, i - 13));
  const nights = days.map(x => { const v = h.nights[x]; return v ? { d: x, ...v, ...judgeSleep(h, x, v.bed, v.wake) } : { d: x }; });
  const logged = nights.filter(x => x.bed), min = h.hours * 60;
  let body = '';
  if (logged.length) {
    const avgSlept = Math.round(logged.reduce((t, x) => t + x.slept, 0) / logged.length);
    const avgBed = Math.round(logged.reduce((t, x) => t + bedMin(x.bed), 0) / logged.length) % 1440;
    const reached = logged.filter(x => x.slept >= min).length;
    // Gráfico: un punto por noche (verde si llegaste a tu mínimo, rojo si no), unidos en orden
    const W = 320, H = 150, L = 30, R = 8, T = 10, B = 22;
    const lo = Math.floor(Math.min(min - 60, ...logged.map(x => x.slept)) / 60) * 60, hi = Math.ceil(Math.max(min + 60, ...logged.map(x => x.slept)) / 60) * 60;
    const X = k => L + k * (W - L - R) / 13, Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const pts = nights.map((x, k) => x.bed ? { x: X(k), y: Y(x.slept), x0: x } : null).filter(Boolean);
    let grid = '';
    for (let v = lo; v <= hi; v += 60) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="sg"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end" class="st">${v / 60}h</text>`;
    const labels = nights.map((x, k) => `<text x="${X(k)}" y="${H - 6}" text-anchor="middle" class="st${x.d === d ? ' today' : ''}">${DAY_LETTER[parseISO(x.d).getDay()]}</text>`).join('');
    body = `<div class="kpis"><div class="kpi"><b>${fmtDur(avgSlept)}</b><span>de media</span></div><div class="kpi"><b>${pad(Math.floor(avgBed / 60))}:${pad(avgBed % 60)}</b><span>te acuestas</span></div><div class="kpi"><b>${reached}/${logged.length}</b><span>noches con tus ${fmtDur(min)}</span></div></div>
      <svg class="schart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas dormidas en las últimas 2 semanas">${grid}
        <line x1="${L}" x2="${W - R}" y1="${Y(min)}" y2="${Y(min)}" class="smin"/>
        ${pts.length > 1 ? `<polyline points="${pts.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}" class="sl"/>` : ''}
        ${pts.map(q => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="4.5" class="${q.x0.slept >= min ? 'ok' : 'bad'}"><title>${q.x0.bed}–${q.x0.wake} · ${fmtDur(q.x0.slept)}</title></circle>`).join('')}
        ${labels}</svg>
      <p class="hint">Horas dormidas cada noche de las últimas 2 semanas. Verde si llegaste a tu mínimo (${fmtDur(min)}, la línea discontinua); rojo si no.</p>`;
  } else body = '<p class="hint">Todavía no has apuntado ninguna noche. Se apunta cada mañana en Hoy.</p>';
  return `<section class="summary"><div class="rato-head"><div class="ttl"><h2>🌙 ${esc(h.name)}</h2>${editBtn('sledit', 'Cambiar la noche de hoy', h.id, open)}</div><span class="hint">${s ? `🔥 ${s}` : ''}${b > s ? ` · récord ${b}` : ''}</span></div>
    ${open ? `<div class="editbox"><span class="label">Hoy</span><div class="sleeplog" data-sid="${h.id}">
        <label class="pickbtn tbtn"><span class="label">Anoche me acosté</span><span>${n ? n.bed : h.bed}</span><input type="time" data-sl="bed" value="${n ? n.bed : h.bed}" aria-label="Hora a la que te acostaste"></label>
        <label class="pickbtn tbtn"><span class="label">Hoy me levanté</span><span>${n ? n.wake : wakeTarget(h, d)}</span><input type="time" data-sl="wake" value="${n ? n.wake : wakeTarget(h, d)}" aria-label="Hora a la que te levantaste"></label>
        <button class="btn primary" data-act="slsave" data-id="${h.id}">Guardar</button></div>
      ${r ? `<div class="sleepres ${r.ok ? 'ok' : 'bad'}">${r.ok ? `✓ Cumplida · dormiste ${fmtDur(r.slept)}` : `✗ ${cap(r.fails.join(', '))}`} <button class="btn ghost small" data-act="slclear" data-id="${h.id}">Borrar</button></div>` : ''}</div>` : ''}
    ${body}</section>`;
}
// --- Rutinas: pasos con hora que se marcan cada día ---
// Cada paso vale los minutos hasta el siguiente (máx. 60); el último, 10
const stepPoints = (h, i) => { const s = h.steps[i], n = h.steps[i + 1]; return n ? Math.max(1, Math.min(60, toMin(n.time) - toMin(s.time))) : 10; };
const stepsToday = h => h.stepsDone[todayISO()] || [];
function toggleStep(hid, sid) {
  const h = habits.find(x => x.id === hid); if (!h) return;
  const d = todayISO(), done = new Set(stepsToday(h)), i = h.steps.findIndex(s => s.id === sid); if (i < 0) return;
  const was = done.has(sid);
  was ? done.delete(sid) : done.add(sid);
  addPoints(was ? -stepPoints(h, i) : stepPoints(h, i));
  const ids = h.steps.map(s => s.id).filter(x => done.has(x)), all = ids.length === h.steps.length;
  const prevAll = h.log[d] === 1;
  h.stepsDone[d] = ids; if (all) h.log[d] = 1; else delete h.log[d];
  store.setRoutineDay(h, d, ids, all ? 1 : null).catch(writeFailed);
  if (!was) {
    navigator.vibrate?.(10);
    const s = habitStreak(h);
    showToast(all && !prevAll ? `¡${h.name} completa! · ${ids.length}/${h.steps.length}${s >= 2 ? ` · 🔥 ${s} días` : ''}` : `+${stepPoints(h, i)} ⭐ · ${h.steps[i].text} · ${ids.length}/${h.steps.length}`, () => toggleStep(hid, sid));
  }
  render();
}
function routineRowHTML(h) {
  const today = todayISO(), done = new Set(stepsToday(h)), s = habitStreak(h), b = habitBest(h), now = toMin(nowHM());
  const on = applies(h, today);
  const daysTxt = h.days?.length && h.days.length < 7 ? DAY_ORDER.filter(d => h.days.includes(d)).map(d => DAY_LETTER[d]).join(' ') : 'Todos los días';
  return `<div class="hab routine" style="--c:var(--accent)">
    <div class="hb"><div class="n" data-act="hedit" data-id="${h.id}">🕘 ${esc(h.name)} <span class="m">· ${done.size}/${h.steps.length}</span></div>
      <div class="m">${daysTxt} · ${h.steps[0]?.time || ''}–${h.steps[h.steps.length - 1]?.time || ''} · ${s ? `🔥 ${s} ${s === 1 ? 'día' : 'días'}` : 'Sin racha todavía'}${b > s ? ` · récord ${b}` : ''}</div>
      ${on ? `<ul class="steps-list">${h.steps.map((st, i) => {
        const next = h.steps[i + 1], cur = toMin(st.time) <= now && (!next || now < toMin(next.time));
        return `<li><button class="${done.has(st.id) ? 'on' : ''} ${cur ? 'cur' : ''}" data-act="rstep" data-id="${h.id}" data-step="${st.id}"><span class="box">${TICK('var(--surface)')}</span><span class="tm">${st.time}</span><span>${esc(st.text)}</span></button></li>`;
      }).join('')}</ul>` : '<p class="hint">Hoy no toca.</p>'}
    </div></div>`;
}
// --- Ahora toca: lo que está pasando según las horas, y lo siguiente ---
function nowItems() {
  const today = todayISO(), items = [];
  tasks.filter(t => !t.done && t.date === today && t.time).forEach(t => {
    const s = toMin(t.time); let e = t.endTime ? toMin(t.endTime) : s + 60; if (e <= s) e += 1440;
    items.push({ s, e, title: t.title, sub: `${t.time}${t.endTime ? '–' + t.endTime : ''} · ${catOf(t.cat).name}`, act: `<button class="check" style="--c:${colorVar(catOf(t.cat).color)}" data-act="nowdone" data-id="${t.id}" aria-label="Hecha: ${esc(t.title)}">${TICK('var(--surface)')}</button>`, timer: t.id });
  });
  habits.filter(h => h.kind === 'routine' && applies(h, today)).forEach(h => {
    const done = new Set(stepsToday(h));
    h.steps.forEach((st, i) => {
      if (done.has(st.id)) return;
      const n = h.steps[i + 1], s = toMin(st.time), e = n ? toMin(n.time) : s + 30;
      items.push({ s, e, title: st.text, sub: `${st.time}${n ? '–' + n.time : ''} · ${h.name}`, act: `<button class="check" style="--c:var(--accent)" data-act="rstep" data-id="${h.id}" data-step="${st.id}" aria-label="Hecho: ${esc(st.text)}">${TICK('var(--surface)')}</button>` });
    });
  });
  return items.sort((a, b) => a.s - b.s);
}
function nowHTML() {
  const now = toMin(nowHM()), items = nowItems();
  const cur = items.filter(i => i.s <= now && now < i.e), next = items.find(i => i.s > now);
  if (!cur.length && !next) return '';
  const row = (i, isNext) => `<div class="nowrow ${isNext ? 'next' : ''}"><div><div class="t">${esc(i.title)}</div><div class="m">${esc(i.sub)}</div></div>
    <div class="acts">${i.timer && !isNext && on('temporizador') ? `<button class="iconbtn" data-act="timer" data-id="${i.timer}" aria-label="Empezar temporizador">⏱</button>` : ''}${isNext ? '' : i.act}</div></div>`;
  const inMin = next ? next.s - now : 0;
  return `<section class="now"><span class="lbl">Ahora · ${nowHM()}</span>
    ${cur.length ? cur.slice(0, 3).map(i => row(i, false)).join('') : '<div class="nowrow"><div class="m">Nada programado ahora mismo</div></div>'}
    ${next ? `<span class="lbl next">Luego · ${inMin < 60 ? `en ${inMin} min` : `a las ${pad(Math.floor(next.s / 60) % 24)}:${pad(next.s % 60)}`}</span>${row(next, true)}` : ''}</section>`;
}
// Mientras miras Hoy, se actualiza cada minuto
setInterval(() => {
  if (view === 'hoy' && !query && !document.querySelector('.sheet.show') && $('#timer').hidden && !document.activeElement?.matches?.('input, textarea')) {
    const y = $('#scroller').scrollTop; render(); $('#scroller').scrollTop = y;
  }
}, 60000);
const SLEEP_DEFAULT = { name: 'Rutina de sueño', kind: 'sleep', minutes: 20, bed: '23:30', wakeWk: '07:15', wakeWe: '08:15', hours: 7.5, tol: 15 };
const habitDoneToday = h => h.kind === 'routine' ? (h.log[todayISO()] === 1 || !applies(h, todayISO())) : (h.kind === 'quit' || h.kind === 'sleep') ? h.log[todayISO()] !== undefined
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
  const routines = all.filter(h => h.kind === 'routine');
  if (routines.length) html += `<h2 class="group"><span>Rutinas</span><span>${routines.length}</span></h2><div class="habs">${routines.map(routineRowHTML).join('')}</div>`;
  const sleep = all.filter(h => h.kind === 'sleep');
  // Aquí solo se configura; se apunta en Hoy y se ve y corrige en Progreso
  html += sleep.length ? `<h2 class="group"><span>Sueño</span></h2><div class="habs">${sleep.map(h => { const s = habitStreak(h); return `<div class="hab" style="--c:var(--k-violeta)"><div class="hb" data-act="hedit" data-id="${h.id}"><div class="n">🌙 ${esc(h.name)}</div>
      <div class="m">Luz apagada ${h.bed} · despertar ${h.wakeWk} (L–V), ${h.wakeWe} (S–D) · ${fmtDur(h.hours * 60)}${s ? ` · 🔥 ${s} ${s === 1 ? 'noche' : 'noches'}` : ''}</div>${dotsHTML(h)}</div></div>`; }).join('')}</div>`
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
  const have = new Set(habits.map(x => fold(x.name)));
  SEED_HABITS.filter(s => !have.has(fold(s.name))).forEach((s, i) => { const h = { id: 'h' + uid(), ...cleanHabit({ ...s, order: base + i }) }; habits.push(h); store.putHabit(h).catch(writeFailed); });
  render();
}
let editingHabit = null, hKind = 'build', hFreq = 'daily', hDelArmed = false;
function renderHabitChips() {
  document.querySelectorAll('#hKind [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === hKind));
  document.querySelectorAll('#hFreq [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === hFreq));
  $('#hFreqField').hidden = hKind !== 'build';
  $('#hTargetField').hidden = hKind !== 'build' || hFreq !== 'weekly';
  $('#hSleepFields').hidden = hKind !== 'sleep';
  $('#hRoutineFields').hidden = hKind !== 'routine';
  if (hKind === 'routine') renderSteps();
  $('#hMinLabel').textContent = hKind === 'quit' ? 'Puntos por cada día que lo evitas' : hKind === 'sleep' ? 'Puntos por cada noche cumplida' : 'Minutos (= puntos al cumplirlo)';
  ['hBed', 'hWakeWk', 'hWakeWe'].forEach(k => { $('#' + k + 'Text').textContent = $('#' + k).value || '—'; });
}
['hBed', 'hWakeWk', 'hWakeWe'].forEach(k => $('#' + k).addEventListener('change', renderHabitChips));
let hSteps = [], hRDays = [];
function renderSteps() {
  $('#hRDays').innerHTML = DAY_ORDER.map(d => `<button type="button" class="chip" data-rday="${d}" aria-pressed="${hRDays.includes(d)}">${DAY_LETTER[d]}</button>`).join('');
  $('#hSteps').innerHTML = hSteps.map((s, i) => `<div class="steprow" data-i="${i}">
    <label class="pickbtn"><span>${s.time || '—'}</span><input type="time" value="${s.time}" data-st="time" aria-label="Hora del paso"></label>
    <input class="inp" type="text" value="${esc(s.text)}" data-st="text" placeholder="Qué haces" aria-label="Paso">
    <button type="button" class="x" data-st="del" aria-label="Quitar paso">✕</button></div>`).join('');
}
$('#hRDays').addEventListener('click', e => { const b = e.target.closest('[data-rday]'); if (!b) return; const d = +b.dataset.rday; hRDays = hRDays.includes(d) ? hRDays.filter(x => x !== d) : [...hRDays, d]; renderSteps(); });
$('#hStepAdd').addEventListener('click', () => {
  const last = hSteps[hSteps.length - 1]?.time;
  const t = last ? (() => { const m = Math.min(toMin(last) + 30, 1439); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; })() : '08:00';
  hSteps.push({ id: Math.random().toString(36).slice(2, 9), time: t, text: '' }); renderSteps();
  $('#hSteps').lastElementChild?.querySelector('[data-st=text]')?.focus();
});
$('#hSteps').addEventListener('input', e => { const r = e.target.closest('.steprow'); if (r && e.target.dataset.st === 'text') hSteps[+r.dataset.i].text = e.target.value; });
$('#hSteps').addEventListener('change', e => { const r = e.target.closest('.steprow'); if (r && e.target.dataset.st === 'time') { hSteps[+r.dataset.i].time = e.target.value; renderSteps(); } });
$('#hSteps').addEventListener('click', e => { const b = e.target.closest('[data-st=del]'); if (b) { hSteps.splice(+b.closest('.steprow').dataset.i, 1); renderSteps(); } });
function openHabit(id) {
  const h = id ? habits.find(x => x.id === id) : null;
  editingHabit = h ? h.id : null; hKind = h ? h.kind : 'build'; hFreq = h ? h.freq : 'daily';
  $('#hName').value = h ? h.name : ''; $('#hTarget').value = h ? h.target : 3; $('#hMin').value = h ? h.minutes : 10;
  const sl = h && h.kind === 'sleep' ? h : SLEEP_DEFAULT;
  $('#hBed').value = sl.bed; $('#hWakeWk').value = sl.wakeWk; $('#hWakeWe').value = sl.wakeWe; $('#hHours').value = sl.hours; $('#hTol').value = sl.tol;
  hSteps = h && h.kind === 'routine' ? h.steps.map(s => ({ ...s })) : [];
  hRDays = h && h.kind === 'routine' ? [...(h.days || [])] : [1, 2, 3, 4, 5, 6, 0];
  $('#habitTitle').textContent = h ? 'Editar hábito' : 'Nuevo hábito';
  $('#hSave').textContent = h ? 'Guardar' : 'Crear hábito';
  $('#hDelete').hidden = !h; $('#hDelete').textContent = 'Borrar hábito'; hDelArmed = false;
  // Solo se sugieren los hábitos que aún no tienes (y la rutina de sueño, si no tienes una)
  const have = new Set(habits.map(x => fold(x.name)));
  const sug = SEED_HABITS.map((s, i) => [s, i]).filter(([s]) => !have.has(fold(s.name)));
  $('#hSuggest').innerHTML = sug.map(([s, i]) => `<button type="button" class="chip" data-i="${i}">${s.kind === 'quit' ? '🚫 ' : ''}${esc(s.name)}</button>`).join('');
  $('#hSuggest').hidden = !!h || !sug.length;
  document.querySelector('#hKind [data-v=sleep]').hidden = !h && habits.some(x => x.kind === 'sleep');
  renderHabitChips(); openSheet('#habitSheet');
  if (!h) setTimeout(() => $('#hName').focus(), 60);
}
$('#hKind').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hKind = b.dataset.v; renderHabitChips(); } });
$('#hFreq').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { hFreq = b.dataset.v; renderHabitChips(); } });
$('#hSuggest').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  const s = SEED_HABITS[+b.dataset.i]; $('#hName').value = s.name; hKind = s.kind; hFreq = s.freq; $('#hMin').value = s.minutes; renderHabitChips();
});
$('#habitSheet').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#hName').value.trim(); if (!name) { $('#hName').focus(); return; }
  const data = { name, kind: hKind, freq: hFreq, target: Number($('#hTarget').value) || 3, minutes: Number($('#hMin').value) || 10 };
  if (hKind === 'routine') {
    const steps = hSteps.filter(s => s.text.trim() && s.time).map(s => ({ ...s, text: s.text.trim() }));
    if (!steps.length) { $('#hStepAdd').focus(); return; }
    Object.assign(data, { steps, days: hRDays.length === 7 ? [] : hRDays });
  }
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
    if (h.kind === 'routine') {
      // Cada paso cuenta: hacer 6 de 8 pasos ese día = 75 %
      let d = isoDate(new Date(h.order)), n = 0;
      while (d <= today && n++ < 800) { if (applies(h, d) && h.steps.length) add(key, d, h.steps.length, (h.stepsDone[d] || []).length); d = addDays(d, 1); }
      return;
    }
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
    <div class="rato-head"><h2>Esta semana</h2><span>${on('recompensas') ? `<button class="btn ghost small" data-act="rewards">🎁 ${balance()} ⭐</button>` : ''}<button class="btn ghost small" data-act="goal">Objetivo: ${stats.goal}/día</button></span></div>
    <div class="kpis"><div class="kpi"><b>${pointsOn(today)}</b><span>puntos hoy</span></div><div class="kpi"><b>${ptsWeek}</b><span>puntos semana</span></div><div class="kpi"><b>${doneWeek.length}</b><span>tareas hechas</span></div></div>
    <div class="weekbars">${week.map((d, i) => { const p = pointsOn(d); return `<div class="wb ${d === today ? 'today' : ''}"><span class="v">${p || ''}</span><div class="col"><i style="height:${p / maxP * 100}%"></i><b style="bottom:${stats.goal / maxP * 100}%"></b></div><span>${DAY_LETTER[DAY_ORDER[i]]}</span></div>`; }).join('')}</div>
    ${(() => { const f = week.reduce((s, d) => s + (Number(stats.focus?.[d]) || 0), 0); return f ? `<p class="hint">⏱ ${fmtDur(f)} de concentración esta semana</p>` : ''; })()}
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
let areasEdit = false;
function areasHTML(p) {
  const today = todayISO(), now = parseISO(today), y = now.getFullYear(), m = now.getMonth(), n = dim(y, m);
  const days = [...Array(n)].map((_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
  const off = new Set(extra.prefs?.areasOff || []);
  const row = (key, label, color, map) => {
    if (off.has(key)) return '';
    const past = days.filter(d => d <= today && map?.[d]?.due); if (!past.length) return '';
    const pct = Math.round(past.reduce((s, d) => s + Math.min(1, map[d].done / map[d].due), 0) / past.length * 100);
    return `<div class="area" style="--g:${color}"><div class="an"><span>${esc(label)}</span><span>${pct}%</span></div><div class="acells" style="--n:${n}">${days.map(d => cell(map?.[d], d, today)).join('')}</div></div>`;
  };
  const allH = {};
  habits.forEach(h => Object.entries(p.area['h:' + h.id] || {}).forEach(([d, e]) => { const a = (allH[d] ||= { due: 0, done: 0 }); a.due += e.due; a.done += e.done; }));
  const rows = [['all', 'Todos los hábitos', 'var(--k-verde)', allH],
    ...cats.map(c => ['c:' + c.id, c.name, colorVar(c.color), p.area['c:' + c.id]]),
    ...sortedHabits().map(h => ['h:' + h.id, h.name, h.kind === 'quit' ? 'var(--k-turquesa)' : 'var(--k-verde)', p.area['h:' + h.id]])];
  const html = rows.map(r => row(...r)).join('');
  const pick = areasEdit ? `<div class="editbox"><span class="label">Qué apartados ver</span><div class="areapick">${rows.map(([key, label, color]) => `<label class="chk"><input type="checkbox" data-area="${esc(key)}" ${off.has(key) ? '' : 'checked'}><span class="dot" style="background:${color}"></span>${esc(label)}</label>`).join('')}</div></div>` : '';
  return `<section class="summary"><div class="rato-head"><div class="ttl"><h2>Por apartado</h2>${editBtn('areasedit', 'Elegir qué apartados ver', '', areasEdit)}</div><span class="hint">este mes</span></div>${pick}<div class="areas">${html || '<p class="hint">Nada que mostrar todavía. Con el lápiz eliges qué apartados ver.</p>'}</div></section>`;
}
$('#list').addEventListener('change', e => {
  const k = e.target.dataset?.area; if (k === undefined) return;
  const off = new Set(extra.prefs?.areasOff || []);
  e.target.checked ? off.delete(k) : off.add(k);
  extra.prefs = { ...extra.prefs, areasOff: [...off] }; store.saveExtra('prefs').catch(writeFailed); render();
});
// Concentración por asignatura: las partes cuentan para su tarea grande (p. ej. "Examen Geometría")
function focusHTML() {
  const today = todayISO(), mon = mondayOf(today), m1 = today.slice(0, 8) + '01', groups = {};
  tasks.forEach(t => Object.entries(t.focusLog || {}).forEach(([d, v]) => {
    if (d < m1 && d < mon) return;
    const parent = t.parentId ? tasks.find(p => p.id === t.parentId) : null, key = parent ? parent.id : t.id;
    const g = (groups[key] ||= { name: (parent || t).title, cat: (parent || t).cat, week: 0, month: 0 });
    if (d >= mon) g.week += v; if (d >= m1) g.month += v;
  }));
  const list = Object.values(groups).filter(g => g.week || g.month).sort((a, b) => b.month - a.month || b.week - a.week).slice(0, 10);
  if (!list.length) return '';
  const max = Math.max(...list.map(g => g.month), 1);
  return `<section class="summary"><div class="rato-head"><h2>Concentración</h2><span class="hint">semana · mes</span></div>
    <div class="focusrows">${list.map(g => `<div class="focusrow"><span>${esc(g.name)}</span><span>${fmtDur(g.week)} · ${fmtDur(g.month)}</span><div class="bar"><i style="width:${g.month / max * 100}%;background:${colorVar(catOf(g.cat).color)}"></i></div></div>`).join('')}</div></section>`;
}
// ---------- Ánimo y energía ----------
const MOODS = ['😞', '😕', '😐', '🙂', '😄'], MOOD_TXT = ['Muy mal', 'Regular', 'Normal', 'Bien', 'Genial'];
function moodCardHTML() {
  const d = todayISO(), m = extra.mood[d] || {};
  return `<div class="mood"><span class="label">Hoy · ${m.m ? MOOD_TXT[m.m - 1] : 'sin apuntar'}</span>
    <div class="moodrow">${MOODS.map((e, i) => `<button class="${m.m === i + 1 ? 'on' : ''}" data-act="mood" data-k="m" data-v="${i + 1}" aria-label="${MOOD_TXT[i]}">${e}</button>`).join('')}</div>
    <span class="label">Energía</span>
    <div class="moodrow energy">${[1, 2, 3, 4, 5].map(v => `<button class="${m.e === v ? 'on' : ''}" data-act="mood" data-k="e" data-v="${v}" aria-label="Energía ${v}">${'▮'.repeat(v)}</button>`).join('')}</div>
    <input class="inp" type="text" id="moodNote" value="${esc(m.n || '')}" placeholder="Una nota del día (opcional)" maxlength="140" aria-label="Nota del día"></div>`;
}
function setMood(k, v) {
  const d = todayISO(), cur = { ...(extra.mood[d] || {}) };
  cur[k] = cur[k] === v ? undefined : v;
  if (!cur.m && !cur.e && !cur.n) delete extra.mood[d]; else extra.mood[d] = Object.fromEntries(Object.entries(cur).filter(([, x]) => x !== undefined));
  store.saveExtra('mood').catch(writeFailed); render();
}
$('#list').addEventListener('change', e => {
  if (e.target.id !== 'moodNote') return;
  const d = todayISO(), n = e.target.value.trim(), cur = { ...(extra.mood[d] || {}) };
  if (n) cur.n = n; else delete cur.n;
  if (Object.keys(cur).length) extra.mood[d] = cur; else delete extra.mood[d];
  store.saveExtra('mood').catch(writeFailed);
});
function moodBannerHTML() {
  if (new Date().getHours() < 20 || extra.mood[todayISO()]?.m) return '';
  return `<div class="banner"><span>¿Qué tal ha ido el día? Apunta tu ánimo</span><button class="btn primary small" data-act="gohabits">Apuntar</button></div>`;
}
// ¿Qué tal hoy? en Progreso: el año en cuadraditos (más claro = mejor día) y cómo cambia según duermes, entrenas o cumples
let moodEdit = false, moodSel = null;
function moodProgHTML() {
  const today = todayISO(), y = parseISO(today).getFullYear(), m = extra.mood;
  let rows = '';
  for (let mo = 0; mo < 12; mo++) {
    rows += `<span class="ml">${MONTHS_SHORT[mo]}</span>`;
    for (let day = 1; day <= 31; day++) {
      if (day > dim(y, mo)) { rows += '<i class="na"></i>'; continue; }
      const d = `${y}-${pad(mo + 1)}-${pad(day)}`, v = m[d]?.m;
      rows += `<i class="mo${v || 0}${d > today ? ' fut' : ''}${d === moodSel ? ' sel' : ''}" data-act="moodday" data-d="${d}"></i>`;
    }
  }
  const days = Object.keys(m).filter(d => m[d].m).sort(), last30 = days.filter(d => d > addDays(today, -30));
  const avg = (l, k) => { const v = l.filter(d => m[d][k]); return v.length ? v.reduce((t, d) => t + m[d][k], 0) / v.length : null; };
  const fmt = v => `${MOODS[Math.round(v) - 1]} ${v.toFixed(1)}`;
  let detail = 'Toca un cuadrado para ver ese día.';
  if (moodSel) { const x = m[moodSel] || {}; detail = `${cap(parseISO(moodSel).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}: ${x.m ? `${MOODS[x.m - 1]} ${MOOD_TXT[x.m - 1]}` : 'sin apuntar'}${x.e ? ` · energía ${x.e}/5` : ''}${x.n ? ` · “${esc(x.n)}”` : ''}`; }
  const sleepH = habits.find(h => h.kind === 'sleep'), p = buildProgress();
  const trained = d => tasks.some(t => t.done && t.cat === 'entreno' && ((t.doneAt && isoDate(new Date(t.doneAt)) === d) || t.date === d));
  const pairs = days.length < 3 ? [] : [
    ['Durmiendo bien', sleepH ? d => sleepH.log[d] === 1 : null],
    ['Con entreno', d => trained(d)],
    ['Días al 80 % o más', d => p.tot[d]?.due && p.tot[d].done / p.tot[d].due >= .8],
  ].filter(([, f]) => f).map(([label, f]) => {
    const yes = days.filter(f), no = days.filter(d => !f(d));
    return yes.length >= 2 && no.length >= 2 ? { label, a: avg(yes, 'm'), b: avg(no, 'm') } : null;
  }).filter(Boolean);
  const am = avg(last30, 'm'), ae = avg(last30, 'e');
  return `<section class="summary"><div class="rato-head"><div class="ttl"><h2>¿Qué tal hoy?</h2>${editBtn('moodedit', 'Cambiar lo de hoy', '', moodEdit)}</div><span class="legend">Mejor <i class="mo5"></i><i class="mo4"></i><i class="mo3"></i><i class="mo2"></i><i class="mo1"></i> Peor</span></div>
    ${moodEdit ? `<div class="editbox">${moodCardHTML()}</div>` : ''}
    <div class="kpis"><div class="kpi"><b>${am ? fmt(am) : '—'}</b><span>ánimo (30 días)</span></div><div class="kpi"><b>${ae ? ae.toFixed(1) : '—'}</b><span>energía (30 días)</span></div><div class="kpi"><b>${last30.length}</b><span>días apuntados</span></div></div>
    <div class="year mood">${rows}</div><p class="hint">${detail}</p>
    ${pairs.length ? `<div class="sublist">${pairs.map(x => `<div class="rwhist"><span>${x.label}</span><span>${fmt(x.a)} · si no, ${fmt(x.b)}</span></div>`).join('')}</div>` : ''}
  </section>`;
}

// ---------- Estimado vs real ----------
function estimateHTML() {
  const since = addDays(todayISO(), -60);
  const rows = tasks.filter(t => t.focus > 0 && (durationMin(t) || t.minutes) && (t.date >= since || (t.doneAt && isoDate(new Date(t.doneAt)) >= since)))
    .map(t => ({ t, est: durationMin(t) || Number(t.minutes), real: t.focus })).sort((a, b) => (b.t.doneAt || 0) - (a.t.doneAt || 0));
  if (!rows.length) return '';
  const E = rows.reduce((s, r) => s + r.est, 0), R = rows.reduce((s, r) => s + r.real, 0), diff = Math.round((R / E - 1) * 100);
  return `<section class="summary"><div class="rato-head"><h2>Estimado vs real</h2><span class="hint">${rows.length} tareas</span></div>
    <p class="hint" style="font-size:15px;color:var(--text)">${Math.abs(diff) < 10 ? 'Calculas muy bien lo que tardas.' : diff > 0 ? `Tardas un <b>${diff} %</b> más de lo que calculas.` : `Tardas un <b>${-diff} %</b> menos de lo que calculas.`}</p>
    <div class="sublist">${rows.slice(0, 8).map(r => { const d = Math.round((r.real / r.est - 1) * 100); return `<div class="rwhist"><span>${esc(r.t.title)}</span><span>${fmtDur(r.est)} → ${fmtDur(r.real)} <b class="${d > 15 ? 'late' : ''}">${d > 0 ? '+' : ''}${d} %</b></span></div>`; }).join('')}</div>
    <p class="hint">Estimado = la hora de inicio a fin o los minutos de la tarea. Real = el tiempo con el temporizador.</p></section>`;
}

// ---------- Jardín de concentración ----------
const plantEmoji = p => !p.ok ? '🥀' : p.min < 15 ? '🌱' : p.min < 30 ? '🌿' : p.min < 50 ? '🪴' : '🌳';
function plant(min, ok) {
  if (!tm || !on('jardin')) return;
  extra.garden.push({ d: todayISO(), min: Math.round(min), ok, t: String(tm.title).slice(0, 60) });
  extra.garden = extra.garden.slice(-600);
  store.saveExtra('garden').catch(writeFailed);
}
function gardenHTML() {
  const m1 = todayISO().slice(0, 8) + '01', list = extra.garden.filter(p => p.d >= m1);
  if (!extra.garden.length) return '';
  const alive = list.filter(p => p.ok).length;
  return `<section class="summary"><div class="rato-head"><h2>Tu jardín</h2><span class="hint">este mes · ${alive} 🌱${list.length - alive ? ` · ${list.length - alive} 🥀` : ''}</span></div>
    <div class="garden">${list.length ? list.map(p => `<span title="${esc(p.t)} · ${p.min} min">${plantEmoji(p)}</span>`).join('') : '<p class="hint">Este mes aún no has plantado nada. Usa el temporizador.</p>'}</div>
    <p class="hint">Cada sesión de concentración planta algo: 🌱 menos de 15 min, 🌿 15–30, 🪴 30–50, 🌳 más de 50. Si dejas un pomodoro a medias, se marchita 🥀.</p></section>`;
}

// ---------- Google Calendar ----------
// Permisos mínimos: leer tus calendarios y gestionar solo el calendario que crea la app ("Mis Tareas")
const GSCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.app.created';
const gopt = () => ({ import: true, skipGrey: true, export: true, ...(extra.prefs.gcal || {}) });
let gBusy = false, gcalMsg = '', gAuto = false;
const gToken = () => { try { const t = JSON.parse(localStorage.getItem('gcal-token')); return t && t.exp > Date.now() + 60000 ? t.t : null; } catch { return null; } };
const loadGIS = () => window.google?.accounts?.oauth2 ? Promise.resolve() : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar Google. ¿Tienes conexión?')); document.head.appendChild(s);
});
async function getToken(interactive) {
  const t = gToken(); if (t || !interactive) return t;
  if (!firebaseConfig.googleClientId) throw new Error('Falta configurar el permiso de Google para esta app.');
  await loadGIS();
  return new Promise((res, rej) => {
    const c = google.accounts.oauth2.initTokenClient({
      client_id: firebaseConfig.googleClientId, scope: GSCOPES,
      callback: r => {
        if (r.error) return rej(new Error(r.error === 'access_denied' ? 'No diste permiso a Google Calendar.' : (r.error_description || r.error)));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...GSCOPES.split(' '))) return rej(new Error('Hace falta marcar los dos permisos de calendario.'));
        try { localStorage.setItem('gcal-token', JSON.stringify({ t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 })); } catch {}
        res(r.access_token);
      },
      error_callback: e => rej(new Error(e.type === 'popup_closed' ? 'Has cerrado la ventana de Google.' : e.type === 'popup_failed_to_open' ? 'El navegador no dejó abrir la ventana de Google.' : (e.message || e.type))),
    });
    c.requestAccessToken();
  });
}
async function gapi(token, path, opts = {}) {
  const r = await fetch('https://www.googleapis.com/calendar/v3' + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  if (r.status === 401) { try { localStorage.removeItem('gcal-token'); } catch {} throw new Error('El permiso de Google ha caducado: pulsa Sincronizar otra vez.'); }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || 'Google respondió con un error ' + r.status); e.status = r.status; throw e; }
  return j;
}
const gLocal = ev => { if (ev.date) return { date: ev.date, time: '' }; const d = new Date(ev.dateTime); return { date: isoDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
const toRFC = d => { const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-'; return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${s}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`; };
async function gList(token, cal, q) {
  const out = []; let pt = '';
  do { const j = await gapi(token, `/calendars/${encodeURIComponent(cal)}/events?maxResults=250${q}${pt ? '&pageToken=' + pt : ''}`); out.push(...(j.items || [])); pt = j.nextPageToken || ''; } while (pt && out.length < 2000);
  return out;
}
async function syncGcal(interactive) {
  if (gBusy || !store.fb) return;
  const o = gopt(); let token;
  try { token = await getToken(interactive); } catch (e) { setGcalStatus('✗ ' + e.message); logError(e.message, 'Google Calendar'); return; }
  if (!token) return;
  gBusy = true; setGcalStatus('Sincronizando…');
  try {
    const today = todayISO(), from = addDays(today, -7), to = addDays(today, 90);
    const range = `&timeMin=${encodeURIComponent(new Date(from + 'T00:00:00').toISOString())}&timeMax=${encodeURIComponent(new Date(to + 'T23:59:59').toISOString())}`;
    let got = 0, gone = 0, sent = 0;
    if (o.import) {
      const items = (await gList(token, 'primary', '&singleEvents=true&orderBy=startTime' + range)).filter(ev =>
        ev.status !== 'cancelled' && ev.start && !(o.skipGrey && ev.colorId === '8') && !ev.extendedProperties?.private?.misTareas);
      const ids = new Set(items.map(ev => ev.id)), writes = [];
      for (const ev of items) {
        const id = 'g-' + ev.id.replace(/[^\w-]/g, '_').slice(0, 120), s = gLocal(ev.start), e = gLocal(ev.end || ev.start);
        // Busca la tarea de este evento, o una que ya importé a mano (mismo título y día) para no duplicar
        let t = tasks.find(x => x.gcal?.id === ev.id) || tasks.find(x => !x.gcal && !x.parentId && x.date === s.date && fold(x.title) === fold(ev.summary || ''));
        if (t && t.gcal?.updated === ev.updated) continue;
        const exam = /examen|entrega|parcial|^ex\.? /.test(fold(ev.summary || ''));
        const data = { title: (ev.summary || '(sin título)').slice(0, 300), date: s.date, time: s.time, endTime: s.time && e.date === s.date ? e.time : '', gcal: { id: ev.id, updated: ev.updated } };
        if (!t) { t = { id, cat: exam ? 'estudio' : 'evento', prio: exam ? 'alta' : 'normal', notes: ev.location || '', done: false, created: Date.now(), ...data }; tasks.push(t); }
        else Object.assign(t, data);
        writes.push(t); got++;
      }
      // Un evento borrado en Google se quita de la app (si no lo habías completado)
      tasks.filter(t => t.gcal?.id && !t.done && t.date >= from && t.date <= to && !ids.has(t.gcal.id)).forEach(t => { tasks = tasks.filter(x => x !== t); store.remove(t.id).catch(writeFailed); gone++; });
      if (writes.length) await store.putMany(writes);
    }
    if (o.export) {
      let cal = o.calId;
      if (cal) { try { await gapi(token, `/calendars/${encodeURIComponent(cal)}`); } catch (e) { if (e.status === 404 || e.status === 403) cal = null; else throw e; } }
      if (!cal) { cal = (await gapi(token, '/calendars', { method: 'POST', body: JSON.stringify({ summary: 'Mis Tareas', timeZone: 'Europe/Madrid', description: 'Tareas con hora de la app Mis Tareas' }) })).id; saveGopt({ calId: cal }); }
      const byTask = new Map((await gList(token, cal, `&timeMin=${encodeURIComponent(new Date(addDays(today, -1) + 'T00:00:00').toISOString())}`)).filter(ev => ev.extendedProperties?.private?.taskId).map(ev => [ev.extendedProperties.private.taskId, ev]));
      const want = tasks.filter(t => !t.done && t.date && t.time && !t.gcal && t.date >= addDays(today, -1) && t.date <= to);
      for (const t of want) {
        const st = new Date(`${t.date}T${t.time}:00`), en = new Date(st.getTime() + (durationMin(t) || 60) * 60000);
        const body = { summary: t.title, description: t.notes || '', start: { dateTime: toRFC(st), timeZone: 'Europe/Madrid' }, end: { dateTime: toRFC(en), timeZone: 'Europe/Madrid' },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: t.remind !== null && t.remind !== undefined ? Number(t.remind) : 10 }] },
          extendedProperties: { private: { taskId: t.id, misTareas: '1' } } };
        const ex = byTask.get(t.id); byTask.delete(t.id);
        if (ex && ex.summary === body.summary && new Date(ex.start?.dateTime).getTime() === st.getTime() && new Date(ex.end?.dateTime).getTime() === en.getTime() && (ex.description || '') === body.description) continue;
        await gapi(token, `/calendars/${encodeURIComponent(cal)}/events${ex ? '/' + ex.id : ''}`, { method: ex ? 'PATCH' : 'POST', body: JSON.stringify(body) });
        sent++;
      }
      // Lo que ya no está pendiente con hora (hecho, borrado, sin hora) sale del calendario
      for (const ev of byTask.values()) await gapi(token, `/calendars/${encodeURIComponent(cal)}/events/${ev.id}`, { method: 'DELETE' }).catch(() => {});
    }
    saveGopt({ last: Date.now() });
    setGcalStatus(`✓ Sincronizado: ${got} ${got === 1 ? 'evento actualizado' : 'eventos actualizados'}${gone ? `, ${gone} quitados` : ''}${o.export ? `, ${sent} ${sent === 1 ? 'tarea enviada' : 'tareas enviadas'}` : ''}.`);
    render();
  } catch (e) { setGcalStatus('✗ ' + e.message); logError(e.message, 'Google Calendar'); }
  finally { gBusy = false; if (!$('#gcalSheet').hidden) renderGcal(); }
}
function saveGopt(p) { extra.prefs = { ...extra.prefs, gcal: { ...gopt(), ...p } }; store.saveExtra('prefs').catch(writeFailed); }
function setGcalStatus(s) { gcalMsg = s; if (!$('#gcalSheet').hidden) renderGcal(); }
function renderGcal() {
  const o = gopt(), conn = !!o.last;
  document.querySelectorAll('[data-gopt]').forEach(b => b.setAttribute('aria-checked', !!o[b.dataset.gopt]));
  $('#gcalStatus').textContent = gcalMsg || (conn ? `Última sincronización: ${new Date(o.last).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : firebaseConfig.googleClientId ? 'Aún no está conectado.' : 'Falta configurar el permiso de Google para esta app.');
  $('#gcalSync').textContent = gBusy ? 'Sincronizando…' : conn ? 'Sincronizar ahora' : 'Conectar y sincronizar';
  $('#gcalSync').disabled = gBusy || !firebaseConfig.googleClientId;
  $('#gcalOff').hidden = !conn;
}
$('#openGcal').addEventListener('click', () => { gcalMsg = ''; renderGcal(); openSheet('#gcalSheet'); });
$('#gcalSync').addEventListener('click', () => syncGcal(true));
document.querySelectorAll('[data-gopt]').forEach(b => b.addEventListener('click', () => { saveGopt({ [b.dataset.gopt]: !gopt()[b.dataset.gopt] }); renderGcal(); }));
$('#gcalOff').addEventListener('click', () => {
  const t = gToken(); if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  try { localStorage.removeItem('gcal-token'); } catch {}
  saveGopt({ last: 0 }); gcalMsg = 'Desconectado. Las tareas que ya trajiste se quedan en la app.'; renderGcal();
});
// Al abrir la app, si el permiso de la última hora sigue valiendo, sincroniza sola (como mucho cada 10 min)
function autoGcal() {
  if (gAuto || !loaded || !store.fb || !gToken()) return;
  gAuto = true;
  if (Date.now() - (gopt().last || 0) > 10 * 60000) syncGcal(false);
}

// ---------- Ayuda, secciones y bienvenida ----------
function renderHelp() {
  $('#sectionList').innerHTML = SECTIONS.map(([id, n, d]) => `<div class="secrow"><span><b>${n}</b><small>${d}</small></span><button type="button" class="switch" role="switch" aria-checked="${on(id)}" data-sec="${id}" aria-label="${n}"></button></div>`).join('');
  let errs = []; try { errs = JSON.parse(localStorage.getItem(EKEY) || '[]'); } catch {}
  $('#errInfo').textContent = errs.length ? `${errs.length} errores guardados en este dispositivo. Si algo falla, copia el registro y pásamelo.` : 'No hay errores. ¡Todo bien!';
  $('#errList').hidden = !errs.length;
  $('#errList').textContent = errs.slice().reverse().map(e => `${e.at.slice(0, 16).replace('T', ' ')} · ${e.msg} (${e.where})`).join('\n');
  $('#appVersion').textContent = `Versión ${document.documentElement.dataset.v || ''} · ${navigator.onLine ? 'con conexión' : 'sin conexión'}`;
}
$('#openHelp').addEventListener('click', () => { renderHelp(); openSheet('#helpSheet'); });
$('#sectionList').addEventListener('click', e => {
  const b = e.target.closest('[data-sec]'); if (!b) return;
  const off = new Set(extra.prefs.off || []); off.has(b.dataset.sec) ? off.delete(b.dataset.sec) : off.add(b.dataset.sec);
  extra.prefs = { ...extra.prefs, off: [...off] }; store.saveExtra('prefs').catch(writeFailed); renderHelp(); render();
});
$('#errCopy').addEventListener('click', async () => {
  const t = $('#errList').textContent || 'Sin errores';
  try { await navigator.clipboard.writeText(t); $('#errInfo').textContent = 'Copiado.'; } catch { const r = document.createRange(); r.selectNodeContents($('#errList')); getSelection().removeAllRanges(); getSelection().addRange(r); }
});
$('#errClear').addEventListener('click', () => { try { localStorage.removeItem(EKEY); } catch {} renderHelp(); });
$('#showWelcome').addEventListener('click', () => openSheet('#welcomeSheet'));
$('#welcomeDone').addEventListener('click', () => { extra.prefs = { ...extra.prefs, welcomed: true }; store.saveExtra('prefs').catch(writeFailed); closeSheets(); });
// La bienvenida sale una vez por cuenta (y no a quien ya tenía tareas antes de esta versión)
let welcomeChecked = false;
function maybeWelcome(isNew) {
  if (welcomeChecked || extra.prefs.welcomed) return; welcomeChecked = true;
  if (!isNew || tasks.length > 3) { extra.prefs = { ...extra.prefs, welcomed: true }; store.saveExtra('prefs').catch(writeFailed); return; }
  setTimeout(() => { if (!document.querySelector('.sheet.show')) openSheet('#welcomeSheet'); }, 800);
}

// ---------- Niveles y logros ----------
// Nivel L empieza en 50·L·(L−1) puntos: 2 = 100, 3 = 300, 4 = 600, 5 = 1.000…
function achievements(full) {
  const doneN = tasks.filter(t => t.done).length, focusMin = tasks.reduce((s, t) => s + (t.focus || 0), 0), xp = earned();
  const bestHabit = Math.max(0, ...habits.filter(h => h.kind !== 'sleep').map(habitBest));
  const sleepBest = Math.max(0, ...habits.filter(h => h.kind === 'sleep').map(habitBest));
  const goalDays = Object.values(stats.days).filter(v => v >= stats.goal).length;
  const examDone = tasks.some(t => t.done && children(t.id).length >= 3 && children(t.id).every(c => c.done));
  let perfect = false;
  if (full) { const p = buildProgress(); let run = 0; for (let d = addDays(todayISO(), -120); d <= todayISO(); d = addDays(d, 1)) { run = level(p.tot[d]) === 4 ? run + 1 : 0; if (run >= 7) { perfect = true; break; } } }
  return [
    ['first', '✅', 'Primera tarea', 'Completa tu primera tarea', doneN >= 1],
    ['t10', '🔟', '10 tareas', 'Completa 10 tareas', doneN >= 10],
    ['t100', '💯', '100 tareas', 'Completa 100 tareas', doneN >= 100],
    ['t500', '🏆', '500 tareas', 'Completa 500 tareas', doneN >= 500],
    ['s7', '🔥', 'Racha de 7', '7 días seguidos con un hábito', bestHabit >= 7],
    ['s30', '🌋', 'Racha de 30', '30 días seguidos con un hábito', bestHabit >= 30],
    ['sleep7', '🌙', 'Duermes bien', '7 noches seguidas cumpliendo tu sueño', sleepBest >= 7],
    ['f10', '⏱', '10 horas de foco', '10 h con el temporizador', focusMin >= 600],
    ['f50', '🧠', '50 horas de foco', '50 h con el temporizador', focusMin >= 3000],
    ['exam', '🎓', 'Examen preparado', 'Termina todas las partes de un examen o proyecto', examDone],
    ['goal7', '🎯', 'Objetivo x7', 'Llega a tu objetivo de puntos 7 días', goalDays >= 7],
    ['xp1k', '⭐', '1.000 puntos', 'Gana 1.000 puntos', xp >= 1000],
    ['xp10k', '🌟', '10.000 puntos', 'Gana 10.000 puntos', xp >= 10000],
    ['reward', '🎁', 'Te lo has ganado', 'Canjea tu primera recompensa', rewards.redeemed.length >= 1],
    ['garden', '🌳', 'Jardinera', '10 plantas en tu jardín', extra.garden.filter(p => p.ok).length >= 10],
    ['mood', '😊', 'Te escuchas', 'Apunta tu ánimo 7 días', Object.keys(extra.mood).length >= 7],
    ...(full ? [['perfect', '👑', 'Semana perfecta', '7 días seguidos al 100 %', perfect]] : []),
  ];
}
function levelHTML() {
  const xp = earned(), L = levelOf(xp), a = levelStart(L), b = levelStart(L + 1);
  const list = achievements(true), got = list.filter(x => x[4]).length;
  return `<section class="summary"><div class="rato-head"><h2>Nivel ${L} · ${LEVEL_NAMES[Math.min(L - 1, LEVEL_NAMES.length - 1)]}</h2><span class="hint">${got}/${list.length} logros</span></div>
    <div class="rato-meter" style="max-width:none"><div class="nums"><span>${xp} ⭐</span><span>${b - xp} para el nivel ${L + 1}</span></div><div class="bar"><i style="width:${(xp - a) / (b - a) * 100}%;background:var(--accent)"></i></div></div>
    <details class="sleepstats"><summary>Ver logros (${got}/${list.length})</summary>
    <div class="badges">${[...list].sort((a, b) => b[4] - a[4]).map(([, e, n, d, ok]) => `<div class="badge ${ok ? 'on' : ''}" title="${esc(d)}"><span>${e}</span><b>${esc(n)}</b><small>${esc(d)}</small></div>`).join('')}</div></details></section>`;
}
// Avisa cuando consigues un logro nuevo o subes de nivel
let achTimer = null;
function checkAchievements() {
  if (!loaded || !store.fb && configured || !on('logros')) return;
  clearTimeout(achTimer);
  achTimer = setTimeout(() => {
    if (!$('#toast').hidden && undoAction) { checkAchievements(); return; } // no tapar un "Deshacer"
    let seen; try { seen = JSON.parse(localStorage.getItem('ach-seen') || 'null'); } catch { seen = null; }
    const now = achievements(false).filter(x => x[4]).map(x => x[0]), L = levelOf(earned());
    if (!seen) { try { localStorage.setItem('ach-seen', JSON.stringify({ ids: now, level: L })); } catch {} return; }
    const fresh = now.filter(id => !seen.ids.includes(id));
    const msg = [];
    if (L > (seen.level || 1)) msg.push(`🎉 ¡Nivel ${L}! ${LEVEL_NAMES[Math.min(L - 1, LEVEL_NAMES.length - 1)]}`);
    fresh.forEach(id => { const a = achievements(false).find(x => x[0] === id); msg.push(`🏅 Logro: ${a[2]}`); });
    if (msg.length) { showToast(msg.join(' · ')); navigator.vibrate?.([30, 60, 30]); }
    try { localStorage.setItem('ach-seen', JSON.stringify({ ids: [...new Set([...seen.ids, ...now])], level: Math.max(L, seen.level || 1) })); } catch {}
  }, 1500);
}
function openGoal() { $('#goalInput').value = stats.goal; $('#goalMsg').hidden = true; openSheet('#goalSheet'); }
$('#goalForm').addEventListener('submit', e => {
  e.preventDefault();
  stats.goal = Math.max(10, Math.min(2000, Math.round(Number($('#goalInput').value)) || 100));
  store.saveGoal(stats.goal).catch(writeFailed);
  $('#goalMsg').textContent = 'Objetivo guardado.'; $('#goalMsg').hidden = false; render();
});
$('#openGoal').addEventListener('click', openGoal);

function renderLook() {
  document.querySelectorAll('#lookTheme [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === look.theme));
  $('#lookAccent').innerHTML = Object.entries(ACCENTS).map(([k, v]) =>
    `<button type="button" class="chip" data-v="${k}" aria-pressed="${look.accent === k}"><span class="dot" style="background:${v.l[0]};width:14px;height:14px"></span>${cap(k)}</button>`).join('');
}
const saveLook = () => { try { localStorage.setItem('mis-tareas-look', JSON.stringify(look)); } catch {} applyLook(); renderLook(); };
$('#openLook').addEventListener('click', () => { renderLook(); openSheet('#lookSheet'); });
$('#lookTheme').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { look.theme = b.dataset.v; saveLook(); } });
$('#lookAccent').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { look.accent = b.dataset.v; saveLook(); } });

// ---------- Recompensas: se pagan con los puntos ganados ----------
const earned = () => Math.round(Object.values(stats.days).reduce((s, v) => s + (Number(v) || 0), 0));
const spent = () => rewards.redeemed.reduce((s, r) => s + r.cost, 0);
const balance = () => earned() - spent();
let rwArmed = null;
function renderRewards() {
  const bal = balance();
  $('#rwBalance').textContent = bal; $('#rwEarned').textContent = earned(); $('#rwSpent').textContent = spent();
  $('#rwList').innerHTML = rewards.list.length ? rewards.list.map(r => {
    const can = bal >= r.cost, armed = rwArmed === r.id;
    return `<div class="rwrow"><div><div class="n">${esc(r.name)}</div><div class="c">${r.cost} ⭐${can ? '' : ` · te faltan ${r.cost - bal}`}</div></div>
      <button type="button" class="btn ${armed ? 'primary' : ''} small" data-rw="buy" data-id="${r.id}" ${can ? '' : 'disabled'}>${armed ? '¿Seguro?' : 'Canjear'}</button>
      <button type="button" class="x" data-rw="del" data-id="${r.id}" aria-label="Quitar ${esc(r.name)}">✕</button></div>`;
  }).join('') : '<p class="hint">Añade premios que te apetezcan y ponles un precio en puntos. Cuando tengas suficientes, los canjeas.</p>';
  const hist = [...rewards.redeemed].reverse().slice(0, 15);
  $('#rwHistBox').hidden = !hist.length;
  $('#rwHist').innerHTML = hist.map(r => `<div class="rwhist"><span>${esc(r.name)}</span><span>${new Date(r.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · −${r.cost} ⭐</span></div>`).join('');
}
$('#openRewards').addEventListener('click', () => { rwArmed = null; renderRewards(); openSheet('#rewardSheet'); });
$('#rwAdd').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#rwName').value.trim(), cost = Math.round(Number($('#rwCost').value));
  if (!name || !(cost > 0)) return;
  rewards.list.push({ id: 'r' + uid(), name, cost }); rewards.list.sort((a, b) => a.cost - b.cost);
  store.saveRewards().catch(writeFailed); $('#rwName').value = ''; $('#rwCost').value = ''; renderRewards();
});
$('#rwList').addEventListener('click', e => {
  const b = e.target.closest('[data-rw]'); if (!b) return;
  const r = rewards.list.find(x => x.id === b.dataset.id); if (!r) return;
  if (b.dataset.rw === 'del') { rewards.list = rewards.list.filter(x => x.id !== r.id); store.saveRewards().catch(writeFailed); renderRewards(); return; }
  if (balance() < r.cost) return;
  if (rwArmed !== r.id) { rwArmed = r.id; renderRewards(); return; }
  rwArmed = null;
  const entry = { id: 'x' + uid(), name: r.name, cost: r.cost, at: Date.now() };
  rewards.redeemed.push(entry); store.saveRewards().catch(writeFailed); renderRewards(); render();
  showToast(`🎁 Canjeado: ${r.name} · −${r.cost} ⭐`, () => { rewards.redeemed = rewards.redeemed.filter(x => x.id !== entry.id); store.saveRewards().catch(writeFailed); renderRewards(); });
});
$('#ptsToday').addEventListener('click', openGoal);

// ---------- Libros: los que quiero leer, el que estoy leyendo y los leídos ----------
let bookOpen = null, bookAddStatus = 'want';
// Buscar y filtrar: por defecto, orden alfabético por título
let bookF = { q: '', author: '', genre: '', pages: '', sort: 'title' };
const bcmp = (x, z) => (x || '').localeCompare(z || '', 'es', { sensitivity: 'base', numeric: true });
const STAR = n => '★'.repeat(n) + '☆'.repeat(5 - n);
function saveBook(b) {
  const i = books.findIndex(x => x.id === b.id); if (i >= 0) books[i] = b; else books.push(b);
  store.putBook(b).catch(writeFailed);
}
function bookEditHTML(b) {
  return `<div class="editbox" data-bid="${b.id}">
    <input class="inp" type="text" data-bf="title" value="${esc(b.title)}" placeholder="Título" aria-label="Título">
    <div class="grid2"><input class="inp" type="text" data-bf="author" value="${esc(b.author)}" placeholder="Autor" aria-label="Autor" list="bkAuthors"><input class="inp" type="number" inputmode="numeric" data-bf="pages" value="${b.pages || ''}" placeholder="Páginas" aria-label="Páginas"></div>
    <input class="inp" type="text" data-bf="genre" value="${esc(b.genre)}" placeholder="Categoría (novela, ensayo, fantasía…)" aria-label="Categoría" list="bkGenres">
    <div class="chips">${[['want', 'Quiero leer'], ['reading', 'Leyendo'], ['read', 'Leído']].map(([v, l]) => `<button type="button" class="chip ${b.status === v ? 'on' : ''}" data-bact="status" data-v="${v}">${l}</button>`).join('')}</div>
    ${b.status === 'read' ? `<div class="stars" aria-label="Valoración">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${(b.rating || 0) >= n ? 'on' : ''}" data-bact="rate" data-v="${n}" aria-label="${n} estrellas">★</button>`).join('')}</div>` : ''}
    <textarea class="inp" data-bf="notes" placeholder="Notas, citas, quién te lo recomendó…" aria-label="Notas">${esc(b.notes)}</textarea>
    <div class="grid2"><button type="button" class="btn danger small" data-bact="del">Borrar</button><button type="button" class="btn primary small" data-bact="close">Listo</button></div></div>`;
}
const PAGES = { '': 'Todas', s: 'Menos de 200', m: '200 a 400', l: 'Más de 400', x: 'Sin páginas' };
const pagesOK = (b, f) => !f || (f === 'x' ? !b.pages : !b.pages ? false : f === 's' ? b.pages < 200 : f === 'm' ? b.pages <= 400 : b.pages > 400);
function bookMatch(b) {
  const q = fold(bookF.q.trim());
  return (!q || fold(`${b.title} ${b.author} ${b.genre} ${b.notes}`).includes(q))
    && (!bookF.author || b.author === bookF.author) && (!bookF.genre || b.genre === bookF.genre) && pagesOK(b, bookF.pages);
}
function bookSort(list) {
  const s = bookF.sort;
  return list.sort((x, z) => s === 'author' ? bcmp(x.author || '￿', z.author || '￿') || bcmp(x.title, z.title)
    : s === 'pages' ? (x.pages || 1e9) - (z.pages || 1e9) || bcmp(x.title, z.title)
    : s === 'recent' ? z.order - x.order : bcmp(x.title, z.title));
}
function renderBooks() {
  const uniq = k => [...new Set(books.map(b => b[k]).filter(Boolean))].sort(bcmp);
  const authors = uniq('author'), genres = uniq('genre');
  if (bookF.author && !authors.includes(bookF.author)) bookF.author = '';
  if (bookF.genre && !genres.includes(bookF.genre)) bookF.genre = '';
  const sel = (k, label, opts) => `<label class="field"><span class="label">${label}</span><select class="inp" data-bfil="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${bookF[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const active = ['author', 'genre', 'pages'].filter(k => bookF[k]).length;
  $('#booksBody').innerHTML = `<form class="box-card" id="bookAdd" autocomplete="off">
      <input class="inp" type="text" id="bkTitle" placeholder="Añadir un libro" aria-label="Título del libro" maxlength="200">
      <div class="grid2"><input class="inp" type="text" id="bkAuthor" placeholder="Autor (opcional)" aria-label="Autor" list="bkAuthors"><input class="inp" type="number" inputmode="numeric" id="bkPages" placeholder="Páginas (opcional)" aria-label="Páginas"></div>
      <input class="inp" type="text" id="bkGenre" placeholder="Categoría (opcional)" aria-label="Categoría" list="bkGenres">
      <div class="chips">${[['want', 'Quiero leer'], ['reading', 'Lo estoy leyendo'], ['read', 'Ya lo leí']].map(([v, l]) => `<button type="button" class="chip ${bookAddStatus === v ? 'on' : ''}" data-bact="addst" data-v="${v}">${l}</button>`).join('')}</div>
      <button class="btn primary" type="submit">Añadir</button></form>
    <datalist id="bkAuthors">${authors.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="bkGenres">${genres.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    ${books.length ? `<div class="bfilter">
      <input class="inp" type="search" id="bkSearch" value="${esc(bookF.q)}" placeholder="🔍 Buscar por título, autor o categoría" aria-label="Buscar libros">
      <details class="box-card"${active ? ' open' : ''}><summary>Filtros y orden${active ? ` · ${active}` : ''}</summary>
        <div class="grid2">${sel('author', 'Autor', [['', 'Todos'], ...authors.map(x => [x, x])])}${sel('genre', 'Categoría', [['', 'Todas'], ...genres.map(x => [x, x])])}</div>
        <div class="grid2">${sel('pages', 'Páginas', Object.entries(PAGES))}${sel('sort', 'Ordenar por', [['title', 'Título (A–Z)'], ['author', 'Autor'], ['pages', 'Páginas'], ['recent', 'Añadidos hace poco']])}</div>
        ${active ? '<button type="button" class="btn ghost small" data-bact="clearf">Quitar filtros</button>' : ''}
      </details></div>` : ''}
    <div id="bookLists"></div>`;
  renderBookLists();
}
function renderBookLists() {
  const y = todayISO().slice(0, 4), filtering = bookF.q.trim() || bookF.author || bookF.genre || bookF.pages;
  const by = st => bookSort(books.filter(b => b.status === st && bookMatch(b)));
  const reading = by('reading'), want = by('want'), read = by('read');
  const thisYear = books.filter(b => b.status === 'read' && (b.finished || '').startsWith(y)).length;
  const sub = b => [b.author, b.genre, b.pages ? `${b.pages} págs.` : ''].filter(Boolean).join(' · ');
  let h = '';
  if (filtering && !reading.length && !want.length && !read.length) { $('#bookLists').innerHTML = '<p class="hint">Ningún libro coincide con la búsqueda.</p>'; return; }
  if (reading.length || !filtering) {
    h += `<h2 class="group"><span>Leyendo ahora</span><span>${reading.length || ''}</span></h2>`;
    h += reading.length ? `<div class="books">${reading.map(b => {
      const pct = b.pages ? Math.round(b.page / b.pages * 100) : null;
      return `<div class="book reading" data-bid="${b.id}">
        <div class="bhead"><span><b>${esc(b.title)}</b><small>${esc(sub(b))}${b.started ? ` · desde ${friendlyDate(b.started).toLowerCase()}` : ''}</small></span><button type="button" class="iconbtn" data-bact="edit" aria-label="Editar ${esc(b.title)}">${PENCIL}</button></div>
        ${b.pages ? `<div class="bbar"><i style="width:${pct}%"></i></div>` : ''}
        <div class="bpage"><span>Página</span><input class="inp" type="number" inputmode="numeric" data-bf="page" value="${b.page || ''}" placeholder="0" aria-label="Página por la que vas"><span>${b.pages ? `de ${b.pages} · ${pct}%` : ''}</span><button type="button" class="btn small" data-bact="plus">+10</button></div>
        <button type="button" class="btn primary small" data-bact="finish">✓ Lo he terminado</button>
        ${bookOpen === b.id ? bookEditHTML(b) : ''}</div>`;
    }).join('')}</div>` : `<p class="hint">Nada ahora mismo.${want.length ? ' Empieza uno de tu lista con “Empezar”.' : ''}</p>`;
  }
  if (want.length || !filtering) {
    h += `<h2 class="group"><span>Quiero leer</span><span>${want.length || ''}</span></h2>`;
    h += want.length ? `<div class="books">${want.map(b => `<div data-bid="${b.id}"><div class="brow"><span data-bact="edit"><b>${esc(b.title)}</b><small>${esc(sub(b)) || '&nbsp;'}</small></span>
        <button type="button" class="btn small" data-bact="start">Empezar</button></div>${bookOpen === b.id ? bookEditHTML(b) : ''}</div>`).join('')}</div>` : '<p class="hint">Apunta aquí los libros que te apetece leer.</p>';
  }
  if (read.length) h += `<details class="booksdone"${filtering || (bookOpen && read.some(b => b.id === bookOpen)) ? ' open' : ''}><summary>Leídos · ${read.length}${!filtering && thisYear ? ` (${thisYear} en ${y})` : ''}</summary><div class="books">${read.map(b => `<div data-bid="${b.id}"><div class="brow"><span data-bact="edit"><b>${esc(b.title)}</b><small>${esc(sub(b))}${b.finished ? `${sub(b) ? ' · ' : ''}${parseISO(b.finished).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}` : ''}</small></span>${b.rating ? `<span class="stars ro" aria-label="${b.rating} de 5">${STAR(b.rating)}</span>` : '<span></span>'}</div>${bookOpen === b.id ? bookEditHTML(b) : ''}</div>`).join('')}</div></details>`;
  $('#bookLists').innerHTML = h;
}
$('#booksBody').addEventListener('input', e => { if (e.target.id === 'bkSearch') { bookF.q = e.target.value; renderBookLists(); } });
$('#booksBody').addEventListener('change', e => { const k = e.target.dataset.bfil; if (!k) return; bookF[k] = e.target.value; renderBooks(); });
$('#booksBody').addEventListener('click', e => {
  const el = e.target.closest('[data-bact]'); if (!el) return;
  const act = el.dataset.bact;
  if (act === 'clearf') { bookF = { ...bookF, author: '', genre: '', pages: '' }; renderBooks(); return; }
  if (act === 'addst') { bookAddStatus = el.dataset.v; $('#booksBody').querySelectorAll('[data-bact=addst]').forEach(c => c.classList.toggle('on', c === el)); return; }
  const b = books.find(x => x.id === el.closest('[data-bid]')?.dataset.bid); if (!b) return;
  const today = todayISO();
  if (act === 'edit') bookOpen = bookOpen === b.id ? null : b.id;
  else if (act === 'close') bookOpen = null;
  else if (act === 'start') { saveBook({ ...b, status: 'reading', started: today }); showToast(`📖 Empiezas “${b.title}”`); }
  else if (act === 'plus') saveBook({ ...b, page: b.pages ? Math.min(b.pages, (b.page || 0) + 10) : (b.page || 0) + 10 });
  else if (act === 'finish') { saveBook({ ...b, status: 'read', finished: today, page: b.pages || b.page }); bookOpen = b.id; showToast(`🎉 ¡Terminado! Ponle nota si quieres`); }
  else if (act === 'status') { const st = el.dataset.v; saveBook({ ...b, status: st, started: st !== 'want' ? (b.started || today) : b.started, finished: st === 'read' ? (b.finished || today) : '' }); }
  else if (act === 'rate') saveBook({ ...b, rating: b.rating === Number(el.dataset.v) ? null : Number(el.dataset.v) });
  else if (act === 'del') { books = books.filter(x => x.id !== b.id); store.removeBook(b.id).catch(writeFailed); bookOpen = null; showToast(`Borrado “${b.title}”`, () => { saveBook(b); renderBooks(); }); }
  renderBooks();
});
$('#booksBody').addEventListener('change', e => {
  const f = e.target.dataset.bf; if (!f) return;
  const b = books.find(x => x.id === e.target.closest('[data-bid]')?.dataset.bid); if (!b) return;
  const v = e.target.value.trim();
  if (f === 'title' && !v) { e.target.value = b.title; return; }
  saveBook({ ...b, [f]: f === 'pages' || f === 'page' ? Number(v) || 0 : v });
  if (['page', 'pages', 'author', 'genre', 'title'].includes(f)) renderBooks();
});
$('#booksBody').addEventListener('submit', e => {
  if (e.target.id !== 'bookAdd') return;
  e.preventDefault();
  const title = $('#bkTitle').value.trim(); if (!title) { $('#bkTitle').focus(); return; }
  const today = todayISO(), st = bookAddStatus;
  saveBook({ id: 'b' + uid(), ...cleanBook({ title, author: $('#bkAuthor').value.trim(), genre: $('#bkGenre').value.trim(), pages: $('#bkPages').value, status: st, started: st !== 'want' ? today : '', finished: st === 'read' ? today : '', order: Date.now() }) });
  bookAddStatus = 'want'; renderBooks(); $('#bkTitle').focus();
});

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
const agendaSwitchHTML = () => `<div class="filters" style="margin-bottom:8px">${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['lista', 'Próximas'], ...(on('matriz') ? [['matriz', 'Matriz']] : [])].map(([m, l]) =>
  `<button class="chip" data-act="amode" data-m="${m}" aria-pressed="${agendaMode === m}">${l}</button>`).join('')}${on('repaso') ? '<button class="chip edit" data-act="review">Repaso de la semana</button>' : ''}</div>`;

// --- Planificar mi día: eliges qué harás hoy y ves si cabe en tus horas libres ---
const estMin = t => durationMin(t) || (Number(t.minutes) > 0 ? Number(t.minutes) : 30);
let planPick = null;
function freeMinutesToday() {
  const today = todayISO(), now = Math.max(toMin(nowHM()), 7 * 60), end = 23 * 60 + 30;
  const busy = dayItems(byCatNow, today).items.filter(i => !i.done).map(i => [Math.max(i.s, now), Math.min(i.e, end)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let used = 0, cur = now; busy.forEach(([a, b]) => { if (b > cur) { used += b - Math.max(a, cur); cur = b; } });
  return Math.max(0, end - now - used);
}
function renderPlan() {
  const today = todayISO();
  const cands = tasks.filter(t => !t.done && !children(t.id).length && !t.time && (
    (t.date && t.date <= today) || (!t.date && !t.someday))).sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || prioRank[a.prio || 'normal'] - prioRank[b.prio || 'normal'] || sortTasks(a, b));
  if (!planPick) planPick = new Set(cands.filter(t => t.date).map(t => t.id));
  const chosen = cands.filter(t => planPick.has(t.id)), mins = chosen.reduce((s, t) => s + estMin(t), 0), free = freeMinutesToday();
  const over = mins > free;
  $('#planBody').innerHTML = `<div class="sheet-head"><h3>Planificar hoy</h3><button type="button" class="btn ghost" data-plan="close">Cerrar</button></div>
    <p class="hint">Marca lo que vas a hacer hoy. Las tareas con hora ya están en tu día; aquí eliges el resto.</p>
    <div class="rato-meter" style="max-width:none"><div class="nums"><span>Elegido: ${fmtDur(mins)}</span><span>Libre hoy: ${fmtDur(free)}</span></div>
      <div class="bar"><i style="width:${Math.min(100, free ? mins / free * 100 : 100)}%;background:${over ? 'var(--danger)' : 'var(--ok)'}"></i></div></div>
    ${over ? `<p class="err">No cabe todo: te pasas ${fmtDur(mins - free)}. Quita algo o déjalo para mañana.</p>` : ''}
    <div class="sublist">${cands.map(t => `<button type="button" class="planrow ${planPick.has(t.id) ? 'on' : ''}" data-plan="pick" data-id="${t.id}" style="--c:${colorVar(catOf(t.cat).color)}">
      <span class="box">${TICK('var(--surface)')}</span><span><b>${esc(t.title)}</b><small>${esc(catOf(t.cat).name)} · ${t.date ? (t.date < today ? 'atrasada' : 'para hoy') : 'sin fecha'}${t.prio === 'alta' ? ' · alta' : ''}</small></span><span class="est">${fmtDur(estMin(t))}</span></button>`).join('') || '<p class="hint">No hay nada pendiente sin hora. ¡Día despejado!</p>'}</div>
    <button type="button" class="btn primary block" data-plan="go">Listo: este es mi día</button>
    <p class="hint">Lo que tenía fecha de hoy y no marques pasa a mañana. Cada tarea cuenta sus minutos, o 30 si no los tiene.</p>`;
}
$('#planBody').addEventListener('click', e => {
  const b = e.target.closest('[data-plan]'); if (!b) return;
  if (b.dataset.plan === 'close') { closeSheets(); return; }
  if (b.dataset.plan === 'pick') { const id = b.dataset.id; planPick.has(id) ? planPick.delete(id) : planPick.add(id); renderPlan(); return; }
  const today = todayISO(), changed = [];
  tasks.filter(t => !t.done && !t.time && !children(t.id).length).forEach(t => {
    if (planPick.has(t.id) && t.date !== today) { changed.push(t); }
    else if (!planPick.has(t.id) && t.date && t.date <= today) { changed.push(t); }
  });
  const snaps = snapshot(changed);
  changed.forEach(t => { if (planPick.has(t.id)) { t.date = today; t.inbox = false; t.someday = false; } else t.date = addDays(today, 1); });
  store.putMany(changed).catch(writeFailed);
  try { localStorage.setItem('plan-' + today, '1'); } catch {}
  closeSheets(); render();
  showToast(`Día planificado: ${planPick.size} tareas`, () => restore(snaps));
});
function openPlan() { planPick = null; renderPlan(); openSheet('#planSheet'); }
function planBannerHTML() {
  if (new Date().getHours() >= 13) return '';
  let seen = false; try { seen = localStorage.getItem('plan-' + todayISO()) === '1'; } catch {}
  return seen ? '' : `<div class="banner"><span>Buenos días: elige qué vas a hacer hoy</span><button class="btn primary small" data-act="plan">Planificar</button></div>`;
}

// Ocurrencias de las tareas que se repiten en un rango de días (sin crear tareas)
function ghostsIn(byCat, from, to) {
  const g = {};
  tasks.filter(t => byCat(t) && t.repeat && !t.done && t.date).forEach(t => {
    let d = t.date, n = 0;
    while (n++ < 400) { d = stepDate(t, d); if (d > to || (t.until && d > t.until)) break; if (d >= from) (g[d] ||= []).push(t); }
  });
  return g;
}
// --- Línea del día ---
function dayItems(byCat, d) {
  const items = [];
  const reals = tasks.filter(t => byCat(t) && t.date === d && (!t.done || showDone));
  const gh = (ghostsIn(byCat, d, d)[d] || []);
  [...reals, ...gh.map(t => ({ ...t, ghost: true }))].forEach(t => {
    if (!t.time) return;
    const s = toMin(t.time); let e = t.endTime ? toMin(t.endTime) : s + (Number(t.minutes) || 60); if (e <= s) e += 1440;
    items.push({ s, e, title: t.title, color: colorVar(catOf(t.cat).color), id: t.id, done: t.done, ghost: t.ghost, act: 'edit' });
  });
  habits.filter(h => h.kind === 'routine' && applies(h, d)).forEach(h => {
    const done = new Set(h.stepsDone[d] || []);
    h.steps.forEach((st, i) => { const n = h.steps[i + 1], s = toMin(st.time); items.push({ s, e: n ? toMin(n.time) : s + 30, title: st.text, color: 'var(--accent)', id: h.id, step: st.id, done: done.has(st.id), act: d === todayISO() ? 'rstep' : 'hedit', routine: h.name }); });
  });
  return { items: items.sort((a, b) => a.s - b.s), untimed: reals.filter(t => !t.time) };
}
function dayHTML(byCat) {
  const today = todayISO(), d = addDays(today, dayOffset), { items, untimed } = dayItems(byCat, d);
  const startH = Math.min(7, ...items.map(i => Math.floor(i.s / 60))), endH = Math.max(24, ...items.map(i => Math.ceil(i.e / 60)));
  const PX = 1.1, top = m => (m - startH * 60) * PX;
  // Carriles para lo que se solapa
  const lanes = []; items.forEach(i => { let l = lanes.findIndex(end => end <= i.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = i.e; i.lane = l; });
  const nl = Math.max(1, lanes.length);
  // Huecos libres (desde ahora si es hoy) hasta las 23:30
  const from = Math.max(7 * 60, d === today ? toMin(nowHM()) : 0, 7 * 60), gaps = [];
  let cur = from; [...items].sort((a, b) => a.s - b.s).forEach(i => { if (i.s - cur >= 30 && i.s > cur) gaps.push([cur, i.s]); cur = Math.max(cur, i.e); });
  if (23 * 60 + 30 - cur >= 30) gaps.push([cur, 23 * 60 + 30]);
  const hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const name = parseISO(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  let html = `<div class="weeknav"><button class="iconbtn" data-act="dprev" aria-label="Día anterior">‹</button><strong>${dayOffset === 0 ? 'Hoy · ' : ''}${cap(name)}</strong><button class="iconbtn" data-act="dnext" aria-label="Día siguiente">›</button></div>`;
  if (dayOffset) html += `<button class="btn ghost small" data-act="dtoday" style="display:block;margin:0 auto 6px">Volver a hoy</button>`;
  if (untimed.length) html += `<h2 class="group"><span>Sin hora</span><span>${untimed.length}</span></h2><ul class="list">${untimed.map(taskHTML).join('')}</ul>`;
  html += gaps.length ? `<p class="hint" style="margin:10px 2px">Huecos libres: ${gaps.slice(0, 4).map(([a, b]) => `${hm(a)}–${hm(b)} (${fmtDur(b - a)})`).join(' · ')}</p>` : '';
  html += `<div class="tl" style="height:${(endH - startH) * 60 * PX}px">`;
  for (let h = startH; h <= endH; h++) html += `<div class="tlh" style="top:${top(h * 60)}px"><span>${pad(h % 24)}:00</span></div>`;
  if (d === today) html += `<div class="tlnow" style="top:${top(toMin(nowHM()))}px"></div>`;
  html += items.map(i => `<button class="tli ${i.done ? 'done' : ''} ${i.ghost ? 'ghost' : ''}" style="top:${top(i.s)}px;height:${Math.max(22, (i.e - i.s) * PX - 2)}px;left:calc(3.2em + (100% - 3.2em) * ${i.lane / nl});width:calc((100% - 3.2em) / ${nl} - 4px);--c:${i.color}" data-act="${i.act}" data-id="${i.id}"${i.step ? ` data-step="${i.step}"` : ''}>
    <b>${esc(i.title)}</b><span>${hm(i.s)}–${hm(i.e)}${i.routine ? ' · ' + esc(i.routine) : ''}${i.ghost ? ' · ↻' : ''}</span></button>`).join('');
  return html + '</div>';
}
// --- Calendario del mes ---
function monthCalHTML(byCat) {
  const today = todayISO(), base = parseISO(today), y = base.getFullYear(), m = base.getMonth() + monthOffset;
  const first = new Date(y, m, 1), n = dim(first.getFullYear(), first.getMonth());
  const ym = `${first.getFullYear()}-${pad(first.getMonth() + 1)}`, from = `${ym}-01`, to = `${ym}-${pad(n)}`;
  const gh = ghostsIn(byCat, from, to), lead = (first.getDay() + 6) % 7;
  const sel = calSel && calSel.startsWith(ym) ? calSel : (monthOffset === 0 ? today : from);
  const dayTasks = d => tasks.filter(t => byCat(t) && t.date === d).concat(gh[d] || []);
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let day = 1; day <= n; day++) {
    const d = `${ym}-${pad(day)}`, list = dayTasks(d), late = list.some(t => !t.done && d < today);
    const dots = [...new Set(list.map(t => catOf(t.cat).color))].slice(0, 4).map(c => `<i style="background:${colorVar(c)}"></i>`).join('');
    cells += `<button class="mcell ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${late ? 'late' : ''}" data-act="calday" data-d="${d}"><span>${day}</span><span class="mdots">${dots}</span>${list.length > 4 ? `<em>${list.length}</em>` : ''}</button>`;
  }
  const selReal = tasks.filter(t => byCat(t) && t.date === sel && (!t.done || showDone)).sort(sortTasks), selGh = gh[sel] || [];
  const title = cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
  return `<div class="weeknav"><button class="iconbtn" data-act="mprev" aria-label="Mes anterior">‹</button><strong>${title}</strong><button class="iconbtn" data-act="mnext" aria-label="Mes siguiente">›</button></div>
    <div class="mcal"><b>L</b><b>M</b><b>X</b><b>J</b><b>V</b><b>S</b><b>D</b>${cells}</div>
    <h2 class="group"><span>${cap(parseISO(sel).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</span><span>${selReal.length + selGh.length || ''}</span></h2>
    ${selReal.length ? `<ul class="list">${selReal.map(taskHTML).join('')}</ul>` : ''}
    ${selGh.length ? `<div style="display:grid;gap:6px;margin-top:6px">${selGh.map(t => `<button class="ghost" data-act="edit" data-id="${t.id}"><span class="dot" style="background:${colorVar(catOf(t.cat).color)}"></span><span><b>${esc(t.title)}</b>${t.time ? ' · ' + t.time : ''}</span><span>↻</span></button>`).join('')}</div>` : ''}
    ${!selReal.length && !selGh.length ? '<p class="free">Nada este día</p>' : ''}`;
}
// --- Matriz de prioridades (urgente = vence en 2 días o antes; importante = prioridad alta) ---
function matrixHTML(byCat) {
  const lim = addDays(todayISO(), 2);
  const list = tasks.filter(t => byCat(t) && !t.done && !t.someday && !children(t.id).length);
  const urgent = t => t.date && t.date <= lim, imp = t => t.prio === 'alta';
  const Q = [
    ['Hazlo ya', 'Urgente e importante', list.filter(t => urgent(t) && imp(t)), 'q1'],
    ['Prográmalo', 'Importante, sin prisa', list.filter(t => !urgent(t) && imp(t)), 'q2'],
    ['Hazlo rápido', 'Urgente, poco importante', list.filter(t => urgent(t) && !imp(t)), 'q3'],
    ['Suéltalo', 'Ni urgente ni importante', list.filter(t => !urgent(t) && !imp(t)), 'q4'],
  ];
  return `<p class="hint" style="margin:0 2px 8px">Importante = prioridad alta. Urgente = vence en los próximos 2 días o está atrasada.</p><div class="matrix">${Q.map(([t, s, items, k]) => `<section class="mq ${k}"><h3>${t} <span>${items.length}</span></h3><p>${s}</p>
    ${items.sort(sortTasks).slice(0, 12).map(x => `<div class="mqi"><button data-act="edit" data-id="${x.id}"><span class="dot" style="background:${colorVar(catOf(x.cat).color)}"></span>${esc(x.title)}${x.date ? `<em>${friendlyDate(x.date)}</em>` : ''}</button>${k === 'q4' && !x.date ? `<button class="chip" data-act="someday" data-id="${x.id}">Algún día</button>` : ''}</div>`).join('') || '<p class="free">Nada</p>'}
    ${items.length > 12 ? `<p class="free">y ${items.length - 12} más</p>` : ''}</section>`).join('')}</div>`;
}

// ---------- Hoy: línea de horas ----------
let hoyEdit = false;
const HOUR_PX = 56;
// Lo de hoy, con hora (en la línea) y sin hora (extra). Las tareas grandes con partes no salen: salen sus partes.
function hoyItems() {
  const today = todayISO(), items = [], extras = [];
  tasks.filter(t => t.date === today && !children(t.id).length).forEach(t => {
    const color = colorVar(catOf(t.cat).color);
    if (!t.time) { extras.push({ title: t.title, color, id: t.id, done: t.done, act: 'tltoggle' }); return; }
    const s = toMin(t.time); let e = t.endTime ? toMin(t.endTime) : s + 60; if (e <= s) e += 1440;
    items.push({ s, e, title: t.title, color, id: t.id, done: t.done, act: 'tltoggle' });
  });
  habits.filter(h => h.kind === 'routine' && applies(h, today)).forEach(h => {
    const done = new Set(stepsToday(h));
    h.steps.forEach((st, i) => { const n = h.steps[i + 1], s = toMin(st.time); items.push({ s, e: n ? toMin(n.time) : s + 30, title: st.text, color: 'var(--accent)', id: h.id, step: st.id, done: done.has(st.id), act: 'rstep' }); });
  });
  return { items: items.sort((a, b) => a.s - b.s || a.e - b.e), extras, late: tasks.filter(t => isLate(t) && !children(t.id).length).sort(sortTasks) };
}
function hoyHTML() {
  const now = toMin(nowHM()), { items, extras, late } = hoyItems();
  let html = timerBannerHTML() + backupBannerHTML() + sleepPromptHTML() + moodPromptHTML();
  if (hoyEdit) return html + hoyEditHTML(items, extras);
  const pending = items.filter(i => !i.done).length + extras.filter(i => !i.done).length;
  html += `<div class="hoyhead"><span>${pending ? `${pending} por hacer` : items.length + extras.length ? '¡Todo hecho! 🎉' : 'Nada para hoy'}</span><button class="btn small" data-act="hoyedit">✏️ Editar</button></div>`;
  if (items.length) html += timelineHTML(items, now, false);
  else html += '<p class="hint" style="margin:8px 2px">No tienes nada con hora hoy. Pulsa “Editar” para ponerle hora a tus tareas.</p>';
  const row = (x, cls) => `<button class="xrow ${cls}" data-act="${x.act || 'tltoggle'}" data-id="${x.id}"><span class="dot" style="background:${x.color}"></span><b>${esc(x.title)}</b></button>`;
  if (extras.length) html += `<h2 class="group"><span>Extra</span><span>${extras.length}</span></h2><div class="xlist">${extras.sort((a, b) => a.done - b.done).map(x => row(x, x.done ? 'done' : '')).join('')}</div>`;
  if (late.length) html += `<h2 class="group late"><span>De otros días</span><span>${late.length}</span></h2><div class="xlist">${late.map(t => row({ title: `${t.title} · ${friendlyDate(t.date).toLowerCase()}`, color: colorVar(catOf(t.cat).color), id: t.id }, 'late')).join('')}</div>`;
  return html;
}
// La línea de horas: cada hora mide lo mismo. En modo editar las tareas se pueden arrastrar.
let tlStartH = 7;
function timelineHTML(items, now, edit) {
  const startH = Math.min(7, ...items.map(i => Math.floor(i.s / 60))), endH = Math.min(26, Math.max(23, ...items.map(i => Math.ceil(i.e / 60))));
  tlStartH = startH;
  const top = m => (m - startH * 60) / 60 * HOUR_PX;
  const lanes = []; items.forEach(i => { let l = lanes.findIndex(end => end <= i.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = i.e; i.lane = l; });
  const nl = Math.max(1, lanes.length);
  let html = `<div class="tl2${edit ? ' editing' : ''}" style="height:${(endH - startH) * HOUR_PX}px">`;
  for (let h = startH; h <= endH; h++) html += `<div class="tl2h" style="top:${(h - startH) * HOUR_PX}px"><span>${pad(h % 24)}:00</span></div>`;
  if (now >= startH * 60 && now <= endH * 60) html += `<div class="tl2now" style="top:${top(now)}px"></div>`;
  html += items.map(i => {
    const st = i.done ? 'done' : i.e <= now ? 'late' : i.s <= now ? 'now' : '';
    const h = Math.max(22, (i.e - i.s) / 60 * HOUR_PX - 3);
    const drag = edit && !i.step;
    const pos = `top:${top(i.s) + 1}px;height:${h}px;left:calc(3.4em + (100% - 3.4em) * ${i.lane / nl});width:calc((100% - 3.4em) / ${nl} - 4px)`;
    if (edit) return `<div class="tl2i ${drag ? 'drag' : 'fixed'} ${i.done ? 'done' : ''}" style="${pos}"${drag ? ` data-drag="${i.id}" data-s="${i.s}" data-e="${i.e}"` : ''}>
      ${drag ? '<span class="hdl t" data-h="t"></span>' : ''}<span class="dot" style="background:${i.color}"></span><b>${esc(i.title)}</b><small class="tlt">${hhmm(i.s)}–${hhmm(i.e)}</small>${drag ? '<span class="hdl b" data-h="b"></span>' : ''}</div>`;
    return `<button class="tl2i ${st}" style="${pos}" data-act="${i.act}" data-id="${i.id}"${i.step ? ` data-step="${i.step}"` : ''} aria-label="${esc(i.title)}${i.done ? ' (hecha)' : ''}">
      <span class="dot" style="background:${i.color}"></span><b>${esc(i.title)}</b></button>`;
  }).join('') + '</div>';
  return html;
}
const hhmm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
// Modo editar: cambiar horas, nombres, quitar y añadir tareas de hoy
function hoyEditHTML(items, extras) {
  const today = todayISO(), list = tasks.filter(t => t.date === today && !children(t.id).length).sort(sortTasks);
  const tp = (field, v, label) => `<label class="pickbtn tbtn"><span class="label">${label}</span><span>${v || '—'}</span><input type="time" data-ef="${field}" value="${v || ''}" aria-label="${label}"></label>`;
  const loose = extras.filter(x => !x.done);
  return `<div class="hoyhead"><b>Editar hoy</b><button class="btn primary small" data-act="hoysave">Guardar</button></div>
    <p class="hint" style="margin:0 2px 8px">Arrastra una tarea para moverla. Tira de su borde de arriba o de abajo para cambiar cuándo empieza o acaba.</p>
    ${loose.length ? `<h2 class="group"><span>Sin hora · arrástrala a la línea</span><span>${loose.length}</span></h2><div class="xchips">${loose.map(x => `<span class="xchip" data-xdrag="${x.id}"><span class="dot" style="background:${x.color}"></span>${esc(x.title)}</span>`).join('')}</div>` : ''}
    ${timelineHTML(items, toMin(nowHM()), true)}
    <h2 class="group"><span>Nombres y horas</span><span>${list.length}</span></h2>
    <div class="sublist">${list.map(t => `<div class="erow ${t.done ? 'done' : ''}" data-id="${t.id}">
      <div class="erow1"><span class="dot" style="background:${colorVar(catOf(t.cat).color)}"></span><input class="inp" type="text" data-ef="title" value="${esc(t.title)}" aria-label="Nombre"><button type="button" class="x" data-ef="del" aria-label="Quitar ${esc(t.title)}">✕</button></div>
      <div class="grid2">${tp('time', t.time, 'Empieza')}${tp('endTime', t.endTime, 'Termina')}</div></div>`).join('') || '<p class="hint">Hoy no tienes tareas. Añade una abajo.</p>'}</div>
    <form class="box-card" id="hoyAdd" autocomplete="off">
      <h4>Añadir a hoy</h4>
      <input class="inp" type="text" id="haTitle" placeholder="p. ej. Estudiar Cálculo #estudio" aria-label="Nueva tarea">
      <div class="grid2"><label class="pickbtn tbtn"><span class="label">Empieza</span><span id="haStartT">—</span><input type="time" id="haStart" aria-label="Empieza"></label><label class="pickbtn tbtn"><span class="label">Termina</span><span id="haEndT">—</span><input type="time" id="haEnd" aria-label="Termina"></label></div>
      <button class="btn primary" type="submit">Añadir</button>
    </form>
    <button class="btn block" type="button" data-act="plan">📝 Traer tareas sin fecha a hoy</button>
    <p class="hint">Los pasos de tus rutinas se cambian en Hábitos. Lo que dejes sin hora sale al final como “Extra”.</p>`;
}
// Arrastrar en la línea: mover, estirar por arriba o por abajo, o soltar una tarea sin hora
let tlDrag = null;
const SNAP = 5;
$('#list').addEventListener('pointerdown', e => {
  if (!hoyEdit || e.button > 0) return;
  const blk = e.target.closest('.tl2i[data-drag]'), chip = e.target.closest('[data-xdrag]');
  if (!blk && !chip) return;
  e.preventDefault();
  const line = $('#list .tl2');
  if (blk) {
    tlDrag = { el: blk, id: blk.dataset.drag, mode: e.target.dataset.h || 'm', y0: e.clientY, s0: +blk.dataset.s, e0: +blk.dataset.e, line };
    blk.classList.add('dragging');
  } else {
    const r = chip.getBoundingClientRect(), ghost = chip.cloneNode(true);
    ghost.className = 'xchip ghost'; ghost.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px`;
    document.body.append(ghost);
    tlDrag = { chip, ghost, id: chip.dataset.xdrag, mode: 'new', dx: e.clientX - r.left, dy: e.clientY - r.top, line };
    chip.classList.add('lifted');
  }
});
function tlMinuteAt(y, line = tlDrag.line) {
  const r = line.getBoundingClientRect();
  return Math.round((tlStartH * 60 + (y - r.top) / HOUR_PX * 60) / SNAP) * SNAP;
}
function tlAutoScroll(y) {
  if (y < 90) window.scrollBy(0, -12); else if (y > innerHeight - 110) window.scrollBy(0, 12);
}
document.addEventListener('pointermove', e => {
  const d = tlDrag; if (!d) return;
  e.preventDefault(); tlAutoScroll(e.clientY);
  if (d.mode === 'new') {
    d.ghost.style.left = e.clientX - d.dx + 'px'; d.ghost.style.top = e.clientY - d.dy + 'px';
    const r = d.line.getBoundingClientRect(), over = e.clientY >= r.top && e.clientY <= r.bottom;
    d.line.classList.toggle('drop', over);
    d.ghost.dataset.t = over ? hhmm(Math.max(0, tlMinuteAt(e.clientY - d.dy))) : '';
    return;
  }
  const dm = Math.round((e.clientY - d.y0) / HOUR_PX * 60 / SNAP) * SNAP;
  let s = d.s0, en = d.e0;
  if (d.mode === 'm') { s = Math.max(0, Math.min(1440 - (d.e0 - d.s0), d.s0 + dm)); en = s + (d.e0 - d.s0); }
  else if (d.mode === 't') s = Math.max(0, Math.min(d.e0 - SNAP * 3, d.s0 + dm));
  else en = Math.min(1440, Math.max(d.s0 + SNAP * 3, d.e0 + dm));
  d.s = s; d.e = en;
  d.el.style.top = (s - tlStartH * 60) / 60 * HOUR_PX + 1 + 'px';
  d.el.style.height = Math.max(22, (en - s) / 60 * HOUR_PX - 3) + 'px';
  d.el.querySelector('.tlt').textContent = `${hhmm(s)}–${hhmm(en)}`;
}, { passive: false });
function tlDrop(e, cancel) {
  const d = tlDrag; if (!d) return; tlDrag = null;
  const t = tasks.find(x => x.id === d.id);
  if (d.mode === 'new') {
    d.ghost.remove(); d.chip.classList.remove('lifted'); d.line.classList.remove('drop');
    const r = d.line.getBoundingClientRect();
    if (cancel || !t || e.clientY < r.top || e.clientY > r.bottom) return;
    const s = Math.max(0, Math.min(1380, tlMinuteAt(e.clientY - d.dy, d.line)));
    t.time = hhmm(s); t.endTime = hhmm(s + 60);
  } else {
    d.el.classList.remove('dragging');
    if (cancel || !t || d.s === undefined || (d.s === d.s0 && d.e === d.e0)) return;
    t.time = hhmm(d.s); t.endTime = d.e >= 1440 ? '23:59' : hhmm(d.e);
  }
  store.put(t).catch(writeFailed); render();
}
document.addEventListener('pointerup', e => tlDrop(e, false));
document.addEventListener('pointercancel', e => tlDrop(e, true));

// Los cambios del modo editar se guardan al momento
$('#list').addEventListener('change', e => {
  const el = e.target; if (!el.dataset.ef || el.dataset.ef === 'del') return;
  const t = tasks.find(x => x.id === el.closest('.erow')?.dataset.id); if (!t) return;
  if (el.dataset.ef === 'title') { const v = el.value.trim(); if (!v) { el.value = t.title; return; } t.title = v; }
  else {
    const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const hm = n => { n = Math.min(n, 23 * 60 + 59); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); };
    // Al mover el inicio, el final se mueve con él (misma duración)
    if (el.dataset.ef === 'time' && t.time && t.endTime && el.value) {
      const dur = mins(t.endTime) - mins(t.time);
      if (dur > 0) { t.endTime = hm(mins(el.value) + dur); const end = el.closest('.erow').querySelector('[data-ef=endTime]'); end.value = t.endTime; end.previousElementSibling.textContent = t.endTime; }
    }
    t[el.dataset.ef] = el.value; if (!t.time) t.endTime = '';
  }
  store.put(t).catch(writeFailed);
  if (el.type === 'time') el.previousElementSibling.textContent = el.value || '—';
});
$('#list').addEventListener('click', e => {
  const b = e.target.closest('[data-ef=del]'); if (!b) return;
  remove(b.closest('.erow').dataset.id);
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'hoyAdd') return;
  e.preventDefault();
  const raw = $('#haTitle').value.trim(); if (!raw) { $('#haTitle').focus(); return; }
  const p = parseQuick(raw, cats);
  const t = { id: uid(), title: p.title, cat: p.cat || cats[cats.length - 1]?.id || '', date: todayISO(), time: $('#haStart').value || p.time || '',
    endTime: $('#haEnd').value || p.endTime || '', prio: p.prio || 'normal', tags: (p.tags || []).map(normTag), done: false, created: Date.now() };
  if (!t.time) t.endTime = '';
  tasks.push(t); store.put(t).catch(writeFailed);
  render(); $('#haTitle')?.focus();
});
$('#list').addEventListener('change', e => { if (e.target.id === 'haStart' || e.target.id === 'haEnd') $('#' + e.target.id + 'T').textContent = e.target.value || '—'; });

// "¿Qué tal hoy?" y el sueño salen en Hoy solo hasta que los rellenas
function moodPromptHTML() {
  if (!on('animo') || new Date().getHours() < 18) return '';
  const m = extra.mood[todayISO()] || {};
  if (m.m && m.e) return '';
  return `<section class="summary mood prompt"><div class="rato-head"><h2>¿Qué tal hoy?</h2></div>
    <div class="moodrow">${MOODS.map((em, i) => `<button class="${m.m === i + 1 ? 'on' : ''}" data-act="mood" data-k="m" data-v="${i + 1}" aria-label="${MOOD_TXT[i]}">${em}</button>`).join('')}</div>
    <span class="label">Energía</span>
    <div class="moodrow energy">${[1, 2, 3, 4, 5].map(v => `<button class="${m.e === v ? 'on' : ''}" data-act="mood" data-k="e" data-v="${v}" aria-label="Energía ${v}">${'▮'.repeat(v)}</button>`).join('')}</div></section>`;
}
function sleepPromptHTML() {
  const d = todayISO();
  return habits.filter(h => h.kind === 'sleep' && h.nights[d] === undefined && h.log[d] === undefined).map(h => `<section class="summary prompt"><div class="rato-head"><h2>🌙 ¿Cómo has dormido?</h2></div>
    <div class="sleeplog" data-sid="${h.id}">
      <label class="pickbtn tbtn"><span class="label">Me acosté</span><span>${h.bed}</span><input type="time" data-sl="bed" value="${h.bed}" aria-label="Hora a la que te acostaste"></label>
      <label class="pickbtn tbtn"><span class="label">Me levanté</span><span>${wakeTarget(h, d)}</span><input type="time" data-sl="wake" value="${wakeTarget(h, d)}" aria-label="Hora a la que te levantaste"></label>
      <button class="btn primary" data-act="slsave" data-id="${h.id}">Apuntar</button></div></section>`).join('');
}

// ---------- Pintar ----------
const prioRank = { alta: 0, normal: 1, baja: 2 };
const sortTasks = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99')
  || prioRank[a.prio || 'normal'] - prioRank[b.prio || 'normal'] || (a.created || 0) - (b.created || 0);
function inView(x, v) {
  const t = todayISO();
  if (v === 'hoy') return !x.done && x.date && x.date <= t;
  if (v === 'proximas') return !x.done && x.date && x.date > t;
  if (v === 'sinfecha') return !x.done && !x.date && !x.inbox && !x.someday;
  if (v === 'someday') return !x.done && !x.date && x.someday;
  return x.done;
}
// ---------- Filtros guardados ----------
function filterMatch(f, t) {
  const today = todayISO();
  if (f.tags?.length && !f.tags.every(g => (t.tags || []).includes(g))) return false;
  if (f.cat && (t.cat || '') !== f.cat) return false;
  if (f.prio && t.prio !== f.prio) return false;
  if (f.when === 'hoy' && !(t.date && t.date <= today)) return false;
  if (f.when === 'semana' && !(t.date && t.date <= addDays(today, 7))) return false;
  if (f.when === 'sinfecha' && t.date) return false;
  return !t.done;
}
function renderFilterSheet() {
  $('#fCat').innerHTML = '<option value="">Cualquiera</option>' + cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  const whenTxt = { todo: '', hoy: 'hoy', semana: '7 días', sinfecha: 'sin fecha' };
  $('#filterList').innerHTML = extra.filters.length ? extra.filters.map(f => `<div class="rwrow"><div><div class="n">⚑ ${esc(f.name)}</div><div class="c">${[...(f.tags || []).map(t => '@' + t), f.cat ? catOf(f.cat).name : '', f.prio ? 'alta' : '', whenTxt[f.when] || ''].filter(Boolean).map(esc).join(' · ') || 'todo'} · ${tasks.filter(t => filterMatch(f, t)).length} tareas</div></div>
    <button type="button" class="btn small" data-fl="use" data-id="${f.id}">Ver</button><button type="button" class="x" data-fl="del" data-id="${f.id}" aria-label="Borrar filtro">✕</button></div>`).join('') : '<p class="hint">Aún no tienes filtros.</p>';
}
$('#filterForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#fName').value.trim(); if (!name) { $('#fName').focus(); return; }
  extra.filters.push({ id: 'f' + uid(), name, tags: $('#fTags').value.split(/[,\s]+/).map(normTag).filter(Boolean), cat: $('#fCat').value, prio: $('#fPrio').value, when: $('#fWhen').value });
  store.saveExtra('filters').catch(writeFailed); $('#filterForm').reset(); renderFilterSheet(); render();
});
$('#filterList').addEventListener('click', e => {
  const b = e.target.closest('[data-fl]'); if (!b) return;
  if (b.dataset.fl === 'del') { extra.filters = extra.filters.filter(f => f.id !== b.dataset.id); store.saveExtra('filters').catch(writeFailed); renderFilterSheet(); render(); return; }
  activeFilter = b.dataset.id; closeSheets(); render();
});
$('#openFilters').addEventListener('click', () => { renderFilterSheet(); openSheet('#filterSheet'); });
// ---------- Bandeja rápida: apuntar en dos segundos y organizarlo luego ----------
function inboxHTML() {
  const items = tasks.filter(t => t.inbox && !t.done).sort((a, b) => (a.created || 0) - (b.created || 0));
  return `<form class="quick" id="quickForm"><input class="inp" type="text" id="quickInput" placeholder="Apuntar rápido…" aria-label="Apuntar rápido" enterkeyhint="done" autocomplete="off"><button class="btn primary" type="submit">+</button></form>
    ${items.length ? `<section class="now"><span class="lbl">Bandeja · ${items.length}</span>${items.map(t => `<div class="nowrow"><div><div class="t" data-act="edit" data-id="${t.id}">${esc(t.title)}</div></div>
      <div class="acts"><button class="chip" data-act="inbox" data-id="${t.id}" data-to="hoy">Hoy</button><button class="chip" data-act="inbox" data-id="${t.id}" data-to="manana">Mañana</button><button class="chip" data-act="inbox" data-id="${t.id}" data-to="none">Sin fecha</button></div></div>`).join('')}</section>` : ''}`;
}
function sortInbox(id, to) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const snaps = snapshot([t]);
  t.inbox = false; t.date = targetDate(to);
  store.put(t).catch(writeFailed);
  showToast(`“${t.title}” → ${to === 'hoy' ? 'hoy' : to === 'manana' ? 'mañana' : 'sin fecha'}`, () => restore(snaps));
  render();
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'quickForm') return;
  e.preventDefault();
  const title = $('#quickInput').value.trim(); if (!title) return;
  const t = { id: uid(), title, cat: '', date: '', inbox: true, done: false, created: Date.now() };
  tasks.push(t); store.put(t).catch(writeFailed);
  $('#quickInput').value = ''; render(); $('#quickInput')?.focus();
});
const doneInView = (x, v) => x.done && (v === 'hoy' ? x.doneAt && isoDate(new Date(x.doneAt)) === todayISO() : v === 'sinfecha' ? !x.date : v === 'hechas');
const currentStreak = t => (t.date && t.date < todayISO()) ? 0 : (t.streak || 0);
// Plan de una tarea con partes: cuenta atrás hasta su fecha y si vas al día
function planHTML(x, pr) {
  const today = todayISO(), bits = [];
  if (x.date && x.date >= today) {
    const n = Math.round((parseISO(x.date) - parseISO(today)) / 864e5);
    bits.push(n === 0 ? '📅 es hoy' : n === 1 ? '📅 mañana' : `📅 faltan ${n} días`);
  }
  const due = children(x.id).filter(c => c.date && c.date < today).length; // partes que ya tocaban
  const behind = due - pr.done;
  if (behind > 0) bits.push(`<b class="late">vas ${behind} por detrás</b>`);
  else if (due && pr.done >= due) bits.push('al día');
  return bits.length ? `<span>${bits.join(' · ')}</span>` : '';
}
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
    pr.total && !x.done ? planHTML(x, pr) : '',
    parent ? `<span class="prog">▦ ${esc(parent.title)} · ${ppr.done}/${ppr.total} (${pct(ppr)}%)</span>` : '',
    !x.date && x.minutes && !x.done ? `<span>${x.minutes} min</span>` : '',
    x.focus ? `<span>⏱ ${fmtDur(x.focus)}</span>` : '',
    x.done && x.pts ? `<span>+${x.pts} ⭐</span>` : '',
    x.prio === 'alta' && !x.done ? `<span class="prio">Alta</span>` : '',
    ...(x.tags || []).map(t => `<span class="tagchip">@${esc(t)}</span>`),
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
const groupedOrFlat = list => {
  const dated = list.filter(x => x.date), undated = list.filter(x => !x.date);
  return (dated.length ? groupedHTML(dated) : '') + (undated.length ? `<h2 class="group"><span>Sin fecha</span><span>${undated.length}</span></h2><ul class="list">${undated.map(taskHTML).join('')}</ul>` : '');
};
const EMPTY = {
  someday: ['Nada para algún día', 'Guarda aquí ideas y cosas sin prisa: al crear una tarea, pulsa “Sin fecha” y luego “Algún día”.'],
  hoy: ['Nada pendiente para hoy', 'Pulsa + para apuntar algo.'],
  proximas: ['Nada programado', 'Escribe “mañana” o una fecha al crear una tarea.'],
  sinfecha: ['No hay tareas sin fecha', 'Úsalo para ideas y cosas sin día fijo.'],
  hechas: ['', ''],
};
const groupedHTML = list => {
  const t = todayISO(), groups = new Map();
  const gname = x => x.date < t ? 'Atrasadas' : x.date === t && x.tonight ? 'Esta noche' : friendlyDate(x.date);
  // "Esta noche" va después de lo de hoy
  [...list].sort((a, b) => (gname(a) === 'Esta noche') - (gname(b) === 'Esta noche')).forEach(x => { const g = gname(x); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); });
  return [...groups].map(([g, items]) => `<h2 class="group ${g === 'Atrasadas' ? 'late' : ''}"><span>${g}</span><span>${items.length}</span></h2>`
    + (g === 'Atrasadas' ? `<div class="latebar"><button class="chip" data-act="mvlate" data-to="hoy">Todas a hoy</button><button class="chip" data-act="mvlate" data-to="manana">A mañana</button><button class="chip" data-act="mvlate" data-to="none">Sin fecha</button></div>` : '')
    + `<ul class="list">${items.map(taskHTML).join('')}</ul>`).join('');
};
// ---------- Replanificar ----------
const targetDate = to => to === 'hoy' ? todayISO() : to === 'manana' ? addDays(todayISO(), 1) : to === 'lunes' ? addDays(mondayOf(todayISO()), 7) : '';
function moveTasks(list, to) {
  if (!list.length) return;
  const snaps = snapshot(list), d = targetDate(to);
  list.forEach(t => { t.date = d; if (!d) { t.time = ''; t.endTime = ''; t.repeat = ''; } });
  store.putMany(list).catch(writeFailed);
  const where = to === 'hoy' ? 'a hoy' : to === 'manana' ? 'a mañana' : to === 'lunes' ? 'al lunes' : 'a sin fecha';
  showToast(`${list.length === 1 ? `“${list[0].title}” movida` : `${list.length} tareas movidas`} ${where}`, () => restore(snaps));
  render(); if (!$('#reviewSheet').hidden) renderReview();
}
const lateTasks = () => tasks.filter(isLate).sort(sortTasks);
const byCatNow = x => catFilter === null || (x.cat || '') === catFilter;
// Repaso de la semana: cómo ha ido, qué quedó pendiente y qué viene
function renderReview() {
  const today = todayISO(), mon = mondayOf(today), week = [...Array(7)].map((_, i) => addDays(mon, i));
  const pts = week.reduce((s, d) => s + pointsOn(d), 0);
  const done = tasks.filter(t => t.done && t.doneAt && isoDate(new Date(t.doneAt)) >= mon).length;
  const p = buildProgress(); const past = week.filter(d => d <= today && p.tot[d]?.due);
  const avg = past.length ? Math.round(past.reduce((s, d) => s + Math.min(1, p.tot[d].done / p.tot[d].due), 0) / past.length * 100) : 0;
  const late = lateTasks();
  const nextMon = addDays(mon, 7), next = [...Array(7)].map((_, i) => addDays(nextMon, i));
  const ghosts = {};
  tasks.filter(t => t.repeat && !t.done && t.date).forEach(t => { let d = t.date, n = 0; while (n++ < 400) { d = stepDate(t, d); if (d > next[6] || (t.until && d > t.until)) break; if (d >= nextMon) ghosts[d] = (ghosts[d] || 0) + 1; } });
  const exams = tasks.filter(t => !t.done && t.date && t.date >= today && t.date <= next[6] && (t.prio === 'alta' || children(t.id).length));
  $('#reviewBody').innerHTML = `<div class="sheet-head"><h3>Repaso de la semana</h3><button type="button" class="btn ghost" data-close-review>Cerrar</button></div>
    <div class="kpis"><div class="kpi"><b>${pts}</b><span>puntos</span></div><div class="kpi"><b>${done}</b><span>tareas hechas</span></div><div class="kpi"><b>${avg}%</b><span>de lo que tocaba</span></div></div>
    <h4>Pendiente (${late.length})</h4>
    ${late.length ? `<div class="latebar"><button class="chip" data-rv="all" data-to="manana">Todas a mañana</button><button class="chip" data-rv="all" data-to="lunes">Todas al lunes</button></div>
      <div class="sublist">${late.map(t => `<div class="revrow"><div class="n">${esc(t.title)}</div><div class="m">${esc(catOf(t.cat).name)} · era ${friendlyDate(t.date).toLowerCase()}</div>
        <div class="chips">${[['hoy', 'Hoy'], ['manana', 'Mañana'], ['lunes', 'Lunes'], ['none', 'Sin fecha']].map(([v, l]) => `<button class="chip" data-rv="one" data-id="${t.id}" data-to="${v}">${l}</button>`).join('')}</div></div>`).join('')}</div>`
      : '<p class="hint">Nada atrasado. ¡Bien!</p>'}
    <h4>La semana que viene</h4>
    <div class="nextweek">${next.map(d => { const n = tasks.filter(t => !t.done && t.date === d).length + (ghosts[d] || 0); return `<div><span>${DAY_LETTER[parseISO(d).getDay()]} ${parseISO(d).getDate()}</span><b>${n}</b></div>`; }).join('')}</div>
    ${exams.length ? `<div class="sublist">${exams.map(t => `<div class="revrow"><div class="n">${esc(t.title)}</div><div class="m">${friendlyDate(t.date)}${children(t.id).length ? ` · ${progressOf(t.id).done}/${progressOf(t.id).total} partes` : ''}</div></div>`).join('')}</div>` : ''}`;
  $('#reviewBody [data-close-review]').addEventListener('click', () => closeSheets());
}
$('#reviewBody').addEventListener('click', e => {
  const b = e.target.closest('[data-rv]'); if (!b) return;
  moveTasks(b.dataset.rv === 'all' ? lateTasks() : tasks.filter(t => t.id === b.dataset.id), b.dataset.to);
});
function openReview() { renderReview(); openSheet('#reviewSheet'); try { localStorage.setItem('review-' + mondayOf(todayISO()), '1'); } catch {} render(); }
// Los domingos (y lunes si no se hizo) Hoy te recuerda hacer el repaso
function reviewBannerHTML() {
  const wd = new Date().getDay(); if (wd !== 0) return '';
  let seen = false; try { seen = localStorage.getItem('review-' + mondayOf(todayISO())) === '1'; } catch {}
  return seen ? '' : `<div class="banner"><span>Es domingo: repasa tu semana y planea la siguiente</span><button class="btn primary small" data-act="review">Repasar</button></div>`;
}
function render() {
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#viewTitle').textContent = query ? 'Buscar' : VIEWS[view];
  $('#ptsToday').textContent = `⭐ ${pointsOn(todayISO())}`;
  $('#filters').hidden = (view === 'habitos' || view === 'hoy') && !query;
  if (view !== 'hoy') hoyEdit = false;
  $('#openRewards').hidden = !on('recompensas');
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
    extra.filters.map(f => `<button class="chip" data-sfilter="${f.id}" aria-pressed="${activeFilter === f.id}">⚑ ${esc(f.name)}</button>`).join('') +
    `<button class="chip edit" data-filter="edit">Editar</button>`;
  const af = activeFilter ? extra.filters.find(f => f.id === activeFilter) : null;
  if (!af) activeFilter = null;
  if (af && !query) $('#viewTitle').textContent = '⚑ ' + af.name;
  $('#showDoneBtn').hidden = true; $('#clearDone').hidden = true;
  if (!loaded) { $('#list').innerHTML = `<div class="empty"><strong>Cargando tus tareas…</strong></div>`; $('#stats').textContent = ''; return; }

  let html = '', count = 0, doneCount = 0;
  if (query) {
    const list = tasks.filter(x => byCat(x) && matches(x, query)).sort((a, b) => (a.done - b.done) || sortTasks(a, b));
    count = list.length;
    html = list.length ? `<ul class="list">${list.map(taskHTML).join('')}</ul>` : `<div class="empty"><strong>Nada con “${esc(query)}”</strong><span>Busca por título, notas o @etiqueta.</span></div>`;
  } else if (af) {
    const list = tasks.filter(x => filterMatch(af, x)).sort(sortTasks);
    count = list.length;
    html = `<div class="chips" style="margin:0 0 8px"><button class="chip" data-act="unfilter">✕ Quitar filtro</button></div>` + (list.length ? groupedOrFlat(list) : '<div class="empty"><strong>Nada con este filtro</strong></div>');
  } else if (view === 'hoy') {
    html = hoyHTML(); count = 0;
  } else if (view === 'semana') {
    html = monthCalHTML(byCat); count = 0;
    doneCount = tasks.filter(t => t.done && t.date === (calSel || todayISO())).length;
  } else if (view === 'habitos') {
    html = habitsViewHTML();
  } else if (view === 'semana' && ['dia', 'mes', 'matriz'].includes(agendaMode === 'matriz' && !on('matriz') ? (agendaMode = 'semana') : agendaMode)) {
    html = agendaSwitchHTML() + (agendaMode === 'dia' ? dayHTML(byCat) : agendaMode === 'mes' ? monthCalHTML(byCat) : matrixHTML(byCat)); count = 1;
    doneCount = agendaMode === 'matriz' ? 0 : tasks.filter(t => t.done && t.date === (agendaMode === 'dia' ? addDays(todayISO(), dayOffset) : calSel || todayISO())).length;
  } else if (view === 'semana' && agendaMode === 'semana') {
    const w = weekHTML(byCat); html = agendaSwitchHTML() + w.html; doneCount = w.nDone; count = 1;
  } else {
    const v = view === 'semana' ? 'proximas' : view === 'sinfecha' && sinfechaMode === 'someday' ? 'someday' : view;
    if (view === 'sinfecha') { const ns = tasks.filter(x => byCat(x) && inView(x, 'someday')).length;
      html += `<div class="chips" style="margin:0 0 8px"><button class="chip" data-act="sfmode" data-m="sinfecha" aria-pressed="${sinfechaMode === 'sinfecha'}">Sin fecha</button><button class="chip" data-act="sfmode" data-m="someday" aria-pressed="${sinfechaMode === 'someday'}">💭 Algún día${ns ? ' · ' + ns : ''}</button></div>`; }
    const list = tasks.filter(x => byCat(x) && inView(x, v) && v !== 'hechas').sort(sortTasks);
    const done = tasks.filter(x => byCat(x) && doneInView(x, v)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    count = list.length; doneCount = v === 'proximas' ? 0 : done.length;
    if (v === 'hechas') html += (on('logros') ? levelHTML() : '') + summaryHTML()
      // Ánimo y sueño: aquí se corrigen los valores de hoy y se ven las estadísticas
      + (on('animo') ? moodProgHTML() : '') + habits.filter(h => h.kind === 'sleep').map(sleepProgHTML).join('') + (on('concentracion') ? focusHTML() : '')
      + (on('estimado') ? estimateHTML() : '') + (on('jardin') ? gardenHTML() : '') + (() => { const p = buildProgress(); return monthHTML(p) + yearHTML(p) + areasHTML(p); })();
    if (v === 'hoy') html += (on('bandeja') ? inboxHTML() : '') + (on('ahora') ? nowHTML() : '');
    if (view === 'semana') html += agendaSwitchHTML();
    if (v === 'hoy') html += timerBannerHTML() + (on('planificar') ? planBannerHTML() : '') + (on('animo') ? moodBannerHTML() : '') + (on('repaso') ? reviewBannerHTML() : '') + backupBannerHTML()
      + (on('planificar') ? `<div class="chips" style="margin:2px 0 4px"><button class="chip" data-act="plan">📝 Planificar hoy</button></div>` : '');
    if (v !== 'hechas') {
      if (!list.length) { const [h, p] = EMPTY[v]; html += `<div class="empty"><strong>${h}</strong><span>${p}</span></div>`; }
      else html += v === 'sinfecha' || v === 'someday' ? `<ul class="list">${list.map(taskHTML).join('')}</ul>` : groupedHTML(list);
    }
    if (showDone && done.length) html += `<h2 class="group"><span>${v === 'hoy' ? 'Hechas hoy' : 'Hechas'}</span><span>${done.length}</span></h2><ul class="list">${done.map(taskHTML).join('')}</ul>`;
    $('#clearDone').hidden = !(v === 'hechas' && showDone && done.length);
  }
  // Si estabas escribiendo en la bandeja, no se pierde lo escrito al refrescar
  const qi = document.activeElement?.id === 'quickInput' ? $('#quickInput').value : null;
  $('#list').innerHTML = html;
  if (qi !== null && $('#quickInput')) { $('#quickInput').value = qi; $('#quickInput').focus(); }
  if (doneCount && !query && view !== 'habitos') {
    $('#showDoneBtn').hidden = false;
    $('#showDoneBtn').textContent = showDone ? 'Ocultar las hechas' : `Ver las hechas (${doneCount})`;
  }
  const pending = tasks.filter(x => !x.done).length;
  const doneToday = tasks.filter(x => x.done && x.doneAt && isoDate(new Date(x.doneAt)) === todayISO()).length;
  $('#stats').textContent = view === 'habitos' || view === 'hoy' ? '' : `${pending} pendiente${pending === 1 ? '' : 's'} · ${doneToday} hecha${doneToday === 1 ? '' : 's'} hoy`;
  let tipSeen = false; try { tipSeen = localStorage.getItem('tip-swipe') === '1'; } catch {}
  $('#tip').hidden = tipSeen || !count || view === 'habitos';
  if (!clearArmed) $('#clearDone').textContent = 'Borrar las hechas';
  checkAchievements(); publishSummary(); autoGcal();
}
$('#showDoneBtn').addEventListener('click', () => { showDone = !showDone; render(); });
// Las horas del registro de sueño se ven en el botón al elegirlas
$('#list').addEventListener('change', e => { if (e.target.dataset.sl) e.target.previousElementSibling.textContent = e.target.value || '—'; });
$('#list').addEventListener('click', e => {
  if (suppressClick) return;
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id } = el.dataset;
  if (act === 'toggle' || act === 'tltoggle') toggle(id);
  else if (act === 'hoyedit') { hoyEdit = true; $('#scroller').scrollTop = 0; render(); }
  else if (act === 'hoysave') { hoyEdit = false; $('#scroller').scrollTop = 0; render(); }
  else if (act === 'wprev' || act === 'wnext') { weekOffset += act === 'wnext' ? 1 : -1; render(); }
  else if (act === 'wtoday') { weekOffset = 0; render(); }
  else if (act === 'dprev' || act === 'dnext') { dayOffset += act === 'dnext' ? 1 : -1; render(); }
  else if (act === 'dtoday') { dayOffset = 0; render(); }
  else if (act === 'plan') openPlan();
  else if (act === 'unfilter') { activeFilter = null; render(); }
  else if (act === 'mood') setMood(el.dataset.k, Number(el.dataset.v));
  else if (act === 'sfmode') { sinfechaMode = el.dataset.m; render(); }
  else if (act === 'mprev' || act === 'mnext') { monthOffset += act === 'mnext' ? 1 : -1; calSel = null; render(); }
  else if (act === 'calday') { calSel = el.dataset.d; const y = $('#scroller').scrollTop; render(); $('#scroller').scrollTop = y; }
  else if (act === 'someday') { const t = tasks.find(x => x.id === id); if (t) { const s = snapshot([t]); t.someday = true; t.date = ''; store.put(t).catch(writeFailed); showToast(`“${t.title}” → Algún día`, () => restore(s)); render(); } }
  else if (act === 'amode') { agendaMode = el.dataset.m; render(); }
  else if (act === 'hok') setHabit(id, 1);
  else if (act === 'hbad') setHabit(id, -1);
  else if (act === 'hedit') openHabit(id);
  else if (act === 'hnew') openHabit(null);
  else if (act === 'hseed') seedHabits();
  else if (act === 'rstep') toggleStep(id, el.dataset.step);
  else if (act === 'inbox') sortInbox(id, el.dataset.to);
  else if (act === 'backup') exportBackup();
  else if (act === 'nowdone') toggle(id);
  else if (act === 'hsleep') { const h = { id: 'h' + uid(), ...cleanHabit({ ...SLEEP_DEFAULT, order: Date.now() }) }; habits.push(h); store.putHabit(h).catch(writeFailed); render(); }
  else if (act === 'slsave') { const box = el.closest('.sleeplog'); saveSleep(id, box.querySelector('[data-sl=bed]').value, box.querySelector('[data-sl=wake]').value); }
  else if (act === 'slclear') clearSleep(id);
  else if (act === 'sledit') { sleepEdit = sleepEdit === id ? null : id; render(); }
  else if (act === 'moodedit') { moodEdit = !moodEdit; render(); }
  else if (act === 'moodday') { moodSel = moodSel === el.dataset.d ? null : el.dataset.d; render(); }
  else if (act === 'areasedit') { areasEdit = !areasEdit; render(); }
  else if (act === 'goal') openGoal();
  else if (act === 'mvlate') moveTasks(lateTasks().filter(byCatNow), el.dataset.to);
  else if (act === 'review') openReview();
  else if (act === 'rewards') { rwArmed = null; renderRewards(); openSheet('#rewardSheet'); }
  else if (act === 'timer') openTimer(id);
  else if (act === 'yday') { selectedDay = selectedDay === el.dataset.d ? null : el.dataset.d; const y = $('#scroller').scrollTop; render(); $('#scroller').scrollTop = y; }
  else if (act === 'edit') openForm(id);
});
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  if (query) { query = ''; $('#searchInput').value = ''; $('#searchBar').hidden = true; $('#searchBtn').setAttribute('aria-pressed', 'false'); }
  else if (view === b.dataset.view) { $('#scroller').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  view = b.dataset.view; showDone = false; activeFilter = null; $('#scroller').scrollTop = 0; render();
});
$('#filters').addEventListener('click', e => {
  const sf = e.target.closest('[data-sfilter]');
  if (sf) { activeFilter = activeFilter === sf.dataset.sfilter ? null : sf.dataset.sfilter; render(); return; }
  const b = e.target.closest('[data-filter]'); if (!b) return;
  activeFilter = null;
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
