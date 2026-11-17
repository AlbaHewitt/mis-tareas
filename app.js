import { firebaseConfig } from './config.js';
import { parseQuick, fold } from './parse.js';
import { toICS, googleURL } from './cal.js';
import { DAY_ORDER, DAY_LETTER, MONTHS_SHORT, normTag, pad, isoDate, todayISO, parseISO, addDays, dim, mondayOf, toMin, uid, esc, cap, monthDate, stepDate, nextDate, alignStart, friendlyDate, longDate, repeatLabel, durationMin, autoPoints, taskPoints, isLate, habitPoints, habitOK, weekCount, PERIODIC, periodStart, periodCount, prevPeriod, applies, WD_NAME, habitStreak, habitBest, wakeTarget, bedMin, fmtDur, judgeSleep, nowHM, LEVEL_NAMES, levelStart, levelOf, isoWeek, SHOP_SECS, shopSection, shopKey } from './logic.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLORS = ['violeta', 'naranja', 'verde', 'azul', 'gris', 'rosa', 'rojo', 'amarillo', 'turquesa', 'marron'];
const DEFAULT_CATS = [
  { id: 'evento', name: 'Evento', color: 'violeta' }, { id: 'entreno', name: 'Entreno', color: 'naranja' },
  { id: 'casa', name: 'Casa', color: 'verde' }, { id: 'estudio', name: 'Estudio', color: 'azul' },
  { id: 'trabajo', name: 'Trabajo', color: 'gris' }, { id: 'personal', name: 'Personal', color: 'rosa' },
  { id: 'cumple', name: 'Cumpleaños', color: 'amarillo' },
];
const NO_CAT = { id: '', name: 'Sin categoría', color: 'gris' };
const VIEWS = { hoy: 'Hoy', semana: 'Agenda', habitos: 'Hábitos', proximas: 'Próximas', sinfecha: 'Listas', notas: 'Notas', hechas: 'Progreso' };
const TICK = c => `<svg viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>`;
const $ = s => document.querySelector(s);

let tasks = [];
// Proyectos, lista de la compra y notas
let projects = [], shop = [], notes = [];
let cats = DEFAULT_CATS;
let habits = [];
let stats = { goal: 100, days: {}, focus: {} };
let rewards = { list: [], redeemed: [] };
let templates = [];
// Ajustes extra guardados en la nube: ánimo, filtros y jardín
let extra = { mood: {}, filters: [], garden: [], prefs: {} };
// Secciones que se pueden apagar en ⋯ → Ayuda y secciones
const SECTIONS = [
  ['bandeja', 'Bandeja rápida', 'Campo “Apuntar rápido…” arriba en Hoy'],
  ['planificar', 'Planificar mi día', 'Aviso por la mañana en Hoy'],
  ['repaso', 'Repaso de la semana', 'Aviso de los domingos'],
  ['temporizador', 'Temporizador', 'Botón para concentrarte en una tarea'],
  ['jardin', 'Jardín', 'La planta del temporizador y tu jardín en Progreso'],
  ['recompensas', 'Recompensas', 'Canjear puntos por premios'],
  ['logros', 'Niveles y logros', 'En Progreso'],
  ['animo', 'Ánimo y energía', 'Pregunta en Hoy y estadísticas en Progreso'],
  ['estimado', 'Estimado vs real', 'En Progreso'],
  ['concentracion', 'Concentración por asignatura', 'En Progreso'],
  ['diario', 'Diario', 'En Notas y un botón en Hoy'],
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
let formFlag = false;
let editingId = null, formCat = 'personal', formDays = [], formParts = [], formNoDate = false, splitDays = [1, 2, 3, 4, 5], formSomeday = false, formTonight = false;

document.documentElement.dataset.v = '26';
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
const colorVar = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : `var(--k-${COLORS.includes(c) ? c : 'gris'})`;
const children = id => tasks.filter(x => x.parentId === id);
const progressOf = id => { const ch = children(id); return { done: ch.filter(c => c.done).length, total: ch.length }; };

function clean(t) {
  const num = v => v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
  return {
    title: String(t.title || '').slice(0, 300), cat: String(t.cat ?? 'personal'),
    date: t.date || '', time: t.date ? (t.time || '') : '', endTime: t.date && t.time ? (t.endTime || '') : '',
    prio: t.prio || 'normal', repeat: t.date ? (t.repeat || '') : '',
    days: Array.isArray(t.days) ? [...new Set(t.days.filter(d => d >= 0 && d <= 6))].sort() : [],
    monthDay: num(t.monthDay), until: t.until || '',
    every: Math.max(1, Math.min(365, Math.round(Number(t.every)) || 1)), nth: [1, 2, 3, 4, -1].includes(Number(t.nth)) ? Number(t.nth) : null,
    nthDay: t.nthDay === null || t.nthDay === undefined || t.nthDay === '' ? null : Math.max(0, Math.min(6, Number(t.nthDay))), anchor: /^\d{4}-\d{2}-\d{2}$/.test(t.anchor || '') ? t.anchor : '',
    notes: String(t.notes || ''), done: !!t.done, doneAt: t.doneAt || null, created: t.created || Date.now(), spawned: !!t.spawned,
    remind: num(t.remind), minutes: Number(t.minutes) > 0 ? Math.min(480, Math.round(Number(t.minutes))) : null,
    points: num(t.points) === null ? null : Math.max(0, Math.min(1000, Math.round(num(t.points)))),
    parentId: t.parentId || '', order: Number(t.order) || 0, loc: String(t.loc || '').slice(0, 200), inbox: !!t.inbox && !t.date,
    someday: !!t.someday && !t.date, tonight: !!t.tonight && !!t.date,
    tags: Array.isArray(t.tags) ? [...new Set(t.tags.map(normTag).filter(Boolean))].slice(0, 10) : [],
    flag: !!t.flag, project: String(t.project || '').slice(0, 60), status: t.status === 'doing' && !t.done ? 'doing' : '',
    born: Number(t.born) >= 1900 && Number(t.born) <= 2100 ? Math.round(Number(t.born)) : null,
    links: cleanLinks(t.links), photos: Array.isArray(t.photos) ? t.photos.map(String).slice(0, 20) : [],
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
    freq: kind === 'build' && PERIODIC.includes(h.freq) ? h.freq : 'daily',
    target: Math.min(h.freq === 'yearly' ? 366 : h.freq === 'monthly' ? 31 : 7, Math.max(1, Number(h.target) || (h.freq === 'weekly' ? 3 : 1))),
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
// Estanterías: libros y películas comparten forma (título, autor o dirección, categoría, estado, nota…)
const SHELF = {
  books: { coll: 'books', lkey: 'mis-tareas-libros', sheet: '#booksSheet', body: '#booksBody', who: 'Autor', whoPh: 'Autor', num: 'pages', numLabel: 'Páginas', numPh: 'Páginas', unit: 'págs.',
    st: { want: 'Quiero leer', reading: 'Leyendo ahora', read: 'Leídos' }, addSt: [['want', 'Quiero leer'], ['reading', 'Lo estoy leyendo'], ['read', 'Ya lo leí']],
    editSt: [['want', 'Quiero leer'], ['reading', 'Leyendo'], ['read', 'Leído']], one: 'libro', add: 'Añadir un libro', emptyWant: 'Apunta aquí los libros que te apetece leer.',
    numF: { '': 'Todas', s: 'Menos de 200', m: '200 a 400', l: 'Más de 400', x: 'Sin páginas' }, genrePh: 'Categoría (novela, ensayo, fantasía…)' },
  movies: { coll: 'movies', lkey: 'mis-tareas-pelis', sheet: '#moviesSheet', body: '#moviesBody', who: 'Dirección', whoPh: 'Dirección', num: 'year', numLabel: 'Año', numPh: 'Año', unit: '',
    st: { want: 'Quiero ver', read: 'Vistas' }, addSt: [['want', 'Quiero verla'], ['read', 'Ya la vi']],
    editSt: [['want', 'Quiero verla'], ['read', 'Vista']], one: 'película', add: 'Añadir una película', emptyWant: 'Apunta aquí las películas que te apetece ver.',
    numF: { '': 'Todos', old: 'Antes de 1970', '1970': 'Años 70', '1980': 'Años 80', '1990': 'Años 90', '2000': 'Años 2000', '2010': 'Años 2010', '2020': 'Desde 2020', x: 'Sin año' }, genrePh: 'Categoría (drama, ciencia ficción, terror…)' },
};
const shelfView = k => { try { return localStorage.getItem('shelf-view-' + k) || 'list'; } catch { return 'list'; } };
const shelf = { books: { items: [], f: { q: '', author: '', genre: '', num: '', sort: 'title' }, open: null, addSt: 'want' },
  movies: { items: [], f: { q: '', author: '', genre: '', num: '', sort: 'title' }, open: null, addSt: 'want' } };
function cleanItem(kind, b) {
  const n = (v, max) => Number(v) > 0 ? Math.min(max, Math.round(Number(v))) : null;
  const sts = Object.keys(SHELF[kind].st), day = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';
  const out = { title: String(b.title || '').slice(0, 200), author: String(b.author || '').slice(0, 120), genre: String(b.genre || '').slice(0, 60),
    status: sts.includes(b.status) ? b.status : 'want', rating: [1, 2, 3, 4, 5].includes(Number(b.rating)) ? Number(b.rating) : null,
    notes: String(b.notes || '').slice(0, 1000), started: day(b.started), finished: day(b.finished), order: Number(b.order) || Date.now() };
  if (kind === 'books') { out.pages = n(b.pages, 20000); out.page = out.pages ? Math.min(out.pages, n(b.page, 20000) || 0) : (n(b.page, 20000) || 0); }
  out.year = n(b.year, 2100) >= (kind === 'books' ? 1 : 1880) ? n(b.year, 2100) : null;
  out.looked = !!b.looked;
  out.cover = /^https:\/\/(covers\.openlibrary\.org|upload\.wikimedia\.org)\//.test(b.cover || '') ? String(b.cover).slice(0, 400) : '';
  out.cl = !!b.cl;
  return out;
}
// --- Proyectos, compra y notas ---
const LINK_KINDS = ['note', 'task', 'proj', 'books', 'movies'];
function cleanLinks(l) { return (Array.isArray(l) ? l : []).filter(x => x && LINK_KINDS.includes(x.k) && x.id).map(x => ({ k: x.k, id: String(x.id).slice(0, 80) })).slice(0, 30); }
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const cleanProject = p => ({ name: String(p.name || '').slice(0, 80), color: COLORS.includes(p.color) ? p.color : 'azul', notes: String(p.notes || '').slice(0, 4000), due: isDay(p.due) ? p.due : '', done: !!p.done, order: Number(p.order) || Date.now(), created: Number(p.created) || Date.now() });
const cleanShop = s => ({ name: String(s.name || '').slice(0, 100), sec: SHOP_SECS.some(x => x[0] === s.sec) ? s.sec : 'otros', done: !!s.done, order: Number(s.order) || Date.now() });
const cleanNote = n => ({ title: String(n.title || '').slice(0, 200), body: String(n.body || '').slice(0, 20000), folder: String(n.folder || '').slice(0, 40), pinned: !!n.pinned,
  created: Number(n.created) || Date.now(), updated: Number(n.updated) || Date.now(), photos: (Array.isArray(n.photos) ? n.photos : []).map(String).slice(0, 30),
  project: String(n.project || '').slice(0, 60), links: cleanLinks(n.links), journal: isDay(n.journal) ? n.journal : '' });
const ROWS = { projects: [() => projects, v => { projects = v; }, cleanProject], shop: [() => shop, v => { shop = v; }, cleanShop], notes: [() => notes, v => { notes = v; }, cleanNote] };
function saveRow(coll, row) {
  const [get, , cl] = ROWS[coll], l = get(), i = l.findIndex(x => x.id === row.id), { id, ...rest } = row, clean = { id, ...cl(rest) };
  if (i >= 0) l[i] = clean; else l.push(clean);
  (store.fb ? store.fb.setDoc(store.ref(coll, id), cl(rest)) : Promise.resolve(local('mis-tareas-' + coll, l))).catch(writeFailed);
}
function dropRow(coll, id) {
  const [get, set] = ROWS[coll]; set(get().filter(x => x.id !== id));
  (store.fb ? store.fb.deleteDoc(store.ref(coll, id)) : Promise.resolve(local('mis-tareas-' + coll, get()))).catch(writeFailed);
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
  async saveCats(list) { cats = list; if (!this.fb) return local(LCATS, list); return this.fb.setDoc(this.ref('settings', 'categories'), { list, urg: true, v2: true }); },
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
  async putItem(kind, b) { if (!this.fb) return local(SHELF[kind].lkey, shelf[kind].items); const { id, ...rest } = b; return this.fb.setDoc(this.ref(SHELF[kind].coll, id), cleanItem(kind, rest)); },
  async removeItem(kind, id) { if (!this.fb) return local(SHELF[kind].lkey, shelf[kind].items); return this.fb.deleteDoc(this.ref(SHELF[kind].coll, id)); },
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
    for (const k in SHELF) shelf[k].items = get(SHELF[k].lkey, []).map(b => ({ id: b.id, ...cleanItem(k, b) }));
    extra = { mood: get('mis-tareas-mood', {}), filters: get('mis-tareas-filters', []), garden: get('mis-tareas-garden', []), prefs: get('mis-tareas-prefs', {}) };
    for (const k in ROWS) ROWS[k][1](get('mis-tareas-' + k, []).map(r => ({ id: r.id, ...ROWS[k][2](r) })));
    loaded = true;
    setSync('warn', 'Solo en este dispositivo');
    $('#accountInfo').textContent = 'La sincronización no está configurada. Las tareas se guardan solo en este dispositivo.';
    document.querySelectorAll('[data-cloud]').forEach(b => b.hidden = true);
    migrate(); rollRepeats(); render();
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
      store.fb = null; store.user = null; tasks = []; for (const k in shelf) shelf[k].items = []; cats = DEFAULT_CATS; habits = []; stats = { goal: 100, days: {}, focus: {} }; rewards = { list: [], redeemed: [] }; extra = { mood: {}, filters: [], garden: [], prefs: {} }; projects = []; shop = []; notes = []; fileCache.clear(); loaded = false;
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
      adoptSiriTasks(); migrate(); if (!snap.metadata.fromCache) rollRepeats();
      render();
    }, () => { clearTimeout(slow); loaded = true; setSync('warn', 'No se pudo sincronizar'); render(); }));
    unsubs.push(fs.onSnapshot(store.ref('settings', 'categories'), snap => {
      const list = snap.exists() ? snap.data().list : null;
      cats = Array.isArray(list) ? list : DEFAULT_CATS;
      // Una sola vez: "Urgente" pasa a ser la bandera 🚩 (las tareas se marcan solas) y llega la categoría Cumpleaños
      if (Array.isArray(list) && !snap.data().v2 && !snap.metadata.fromCache) {
        let l = list.filter(c => c.id !== 'urgente'); if (!l.some(c => c.id === 'cumple')) l = [...l, { id: 'cumple', name: 'Cumpleaños', color: 'amarillo' }];
        store.saveCats(l).catch(() => {});
      }
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
    for (const k in SHELF) unsubs.push(fs.onSnapshot(fs.collection(db, 'users', user.uid, SHELF[k].coll), snap => {
      shelf[k].items = snap.docs.map(d => ({ id: d.id, ...cleanItem(k, d.data()) }));
      if (!$(SHELF[k].sheet).hidden && !document.activeElement?.closest?.(SHELF[k].sheet)) renderShelf(k);
    }, () => {}));
    for (const k in ROWS) unsubs.push(fs.onSnapshot(fs.collection(db, 'users', user.uid, k), snap => {
      ROWS[k][1](snap.docs.map(d => ({ id: d.id, ...ROWS[k][2](d.data()) })));
      if (k !== 'notes' || !$('#noteSheet').classList.contains('show')) render();
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
    const full = { id: t.id, title: p.title, cat: p.cat || guessCat(p.title) || (cats[0]?.id ?? ''), flag: !!p.prio, date: p.date ?? todayISO(), time: p.time || '', endTime: p.endTime || '',
      prio: p.prio || 'normal', repeat: p.repeat || '', days: p.days || [], every: p.every || 1, nth: p.nth || null, nthDay: p.nthDay ?? null, notes: '', done: false, created: Date.now() };
    alignStart(full);
    Object.keys(t).forEach(k => delete t[k]); Object.assign(t, full);
    store.put(full).catch(writeFailed);
  });
}

// Repeticiones: si una tarea que se repite se quedó sin hacer, se mueve al siguiente día que le toca (hoy o después)
function rollRepeats() {
  const today = todayISO(), fixes = [];
  tasks.forEach(t => {
    if (!t.repeat || t.done || !t.date || t.date >= today || t.parentId || t.siriKey !== undefined) return;
    if (t.date === addDays(today, -1) && new Date().getHours() < 6) return; // de madrugada aún puedes marcar lo de ayer
    let d = t.date, g = 0;
    while (d < today && g++ < 2000) d = stepDate(t, d);
    if (t.until && d > t.until) return;
    t.date = d; t.streak = 0; fixes.push(t);
  });
  if (fixes.length) store.putMany(fixes).catch(writeFailed);
}
setInterval(() => { if (loaded) rollRepeats(); }, 10 * 60000);
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
    if (t.cat === 'urgente') { const par = t.parentId ? tasks.find(p => p.id === t.parentId) : null; ch = { ...(ch || {}), flag: !t.parentId, cat: guessCat(par ? par.title : t.title) || '' }; }
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
  if (noteDraft && $('#noteSheet').classList.contains('show')) saveNote(true);
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
$('#openBooks').addEventListener('click', () => { shelf.books.open = null; shelf.books.adding = false; renderShelf('books'); openSheet('#booksSheet'); });
$('#openMovies').addEventListener('click', () => { shelf.movies.open = null; shelf.movies.adding = false; renderShelf('movies'); openSheet('#moviesSheet'); });
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
  $('#flagBtn').setAttribute('aria-pressed', formFlag);
  $('#bornField').hidden = formCat !== 'cumple';
}
// Etiquetas que ya usas, para añadirlas con un toque
function renderTagSugs() {
  const have = new Set(readTags()), all = [...new Set(tasks.flatMap(t => t.tags || []))].filter(g => !have.has(g)).sort((x, y) => x.localeCompare(y, 'es')).slice(0, 14);
  $('#tagSugs').innerHTML = all.map(g => `<button type="button" class="chip" data-tagadd="${esc(g)}">@${esc(g)}</button>`).join('');
  $('#tagSugs').hidden = !all.length;
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
  ['#repeatField', '#remindField'].forEach(x => $(x).hidden = formNoDate);
  $('#repeat').disabled = formNoDate || formParts.length > 0;
  if (formNoDate || formParts.length) $('#repeat').value = '';
  const r = $('#repeat').value;
  $('#repeatOpts').hidden = !r;
  const n = Math.max(1, Number($('#every').value) || 1), U = { diario: ['día', 'días'], dias: ['semana', 'semanas'], semanal: ['semana', 'semanas'], mensual: ['mes', 'meses'], anual: ['año', 'años'] }[r] || ['', ''];
  $('#everyUnit').textContent = n === 1 ? U[0] : U[1];
  $('#everyHint').textContent = r === 'dias' ? (n === 2 ? 'Una semana sí y otra no.' : n === 1 ? 'Pon 2 para una semana sí y otra no.' : '') : '';
  $('#mMode').hidden = r !== 'mensual';
  document.querySelectorAll('#mMode [data-mm]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mm === formMonthMode));
  $('#nthField').hidden = r !== 'mensual' || formMonthMode !== 'nth';
  $('#daysRow').hidden = r !== 'dias';
  if (r === 'dias') $('#daysRow').innerHTML = dayChips(formDays, 'data-day');
  $('#monthDayField').hidden = r !== 'mensual' || formMonthMode !== 'day';
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
  else if (!formCatTouched && guessCat(p.title || '')) bits.push('#' + catOf(guessCat(p.title)).name);
  if (p.prio) bits.push('🚩');
  (p.tags || []).forEach(t => bits.push('@' + t));
  if (p.repeat) bits.push('↻ ' + repeatLabel({ ...p, date: p.date || $('#date').value }));
  $('#detected').innerHTML = bits.map(b => `<span>${esc(b)}</span>`).join('');
  $('#detected').hidden = !bits.length;
}
let formCatTouched = false;
// Si no eliges categoría, se adivina por las palabras (gym → Entreno, estudiar → Estudio, limpiar → Casa…)
const CAT_WORDS = [['cumple', /\bcumple/i], ['entreno', /\b(gym|gimnasio|entren|correr|running|pesas|yoga|pilates|nadar|piscina|crossfit|spinning|bici|futbol|fútbol|padel|pádel|caminar)/i],
  ['estudio', /\b(estudi|examen|repas|tema \d|apuntes|deberes|practica|práctica|entrega|clase de|leer el tema|ejercicios)/i],
  ['casa', /\b(limpi|lavar|lavadora|tender|planchar|cocinar|compra|super|barrer|fregar|aspir|ordenar|regar|basura|cama|baño)/i],
  ['evento', /\b(cumple|boda|cena con|comida con|quedar|quedada|concierto|cine|fiesta|viaje|vuelo|reuni)/i]];
const guessCat = title => { const c = CAT_WORDS.find(([id, rx]) => rx.test(title) && cats.some(x => x.id === id)); return c ? c[0] : ''; };
$('#catChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; formCat = b.dataset.cat; formCatTouched = true; if (formCat === 'cumple' && !formNoDate && !$('#repeat').value) { $('#repeat').value = 'anual'; } renderCatChips(); renderWhen(); });
$('#flagBtn').addEventListener('click', () => { formFlag = !formFlag; renderCatChips(); });
$('#date').addEventListener('change', () => { if ($('#date').value) formNoDate = false; renderMonthDay(); renderWhen(); });
$('#noDateBtn').addEventListener('click', () => {
  formNoDate = !formNoDate;
  if (!formNoDate && !$('#date').value) $('#date').value = todayISO();
  renderWhen();
});
let formPrevStart = '';
$('#time').addEventListener('focus', () => { formPrevStart = $('#time').value; });
$('#time').addEventListener('change', () => {
  // La hora de fin, por defecto una hora después; si ya había una, se mueve con el inicio
  const s = $('#time').value, en = $('#endTime').value;
  if (s && (!en || toMin(en) <= toMin(s))) $('#endTime').value = hhmm(toMin(s) + (en && formPrevStart && toMin(en) > toMin(formPrevStart) ? toMin(en) - toMin(formPrevStart) : 60));
  else if (s && en && formPrevStart && toMin(en) > toMin(formPrevStart)) $('#endTime').value = hhmm(toMin(en) + toMin(s) - toMin(formPrevStart));
  formPrevStart = s; renderWhen();
});
$('#somedayBtn').addEventListener('click', () => { formSomeday = !formSomeday; renderWhen(); });
$('#tonightBtn').addEventListener('click', () => { formTonight = !formTonight; renderWhen(); });
const readTags = () => $('#tags').value.split(/[,\s]+/).map(normTag).filter(Boolean);
$('#tags').addEventListener('input', renderTagSugs);
$('#tagSugs').addEventListener('click', e => { const b = e.target.closest('[data-tagadd]'); if (!b) return; $('#tags').value = [...readTags(), b.dataset.tagadd].join(', '); renderTagSugs(); });
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
let formMonthMode = 'day';
$('#every').addEventListener('input', renderWhen);
$('#mMode').addEventListener('click', e => { const b = e.target.closest('[data-mm]'); if (b) { formMonthMode = b.dataset.mm; renderWhen(); } });
$('#clearUntil').addEventListener('click', () => { $('#until').value = ''; renderWhen(); });
$('#minutes').addEventListener('input', renderPointsHint);
$('#points').addEventListener('input', () => { renderPointsHint(); refreshShares(); });
$('#title').addEventListener('input', renderDetected);

// --- Partes ---
function renderParts() {
  const done = formParts.filter(p => p.done).length;
  $('#partsCount').textContent = formParts.length ? `· ${done}/${formParts.length} (${Math.round(done / formParts.length * 100)}%)` : '';
  const sh = formShares();
  $('#partList').innerHTML = formParts.map((p, i) => `<div class="partrow" data-i="${i}">
    <span class="grip" data-pact="grip" aria-label="Arrastra para cambiar el orden">⋮⋮</span>
    <button type="button" class="box" data-pact="toggle" aria-pressed="${p.done}" aria-label="Hecha">${TICK('var(--accent-ink)')}</button>
    <input class="inp" type="text" value="${esc(p.title)}" data-pact="title" aria-label="Parte">
    <label class="pickbtn"><span>${p.date ? friendlyDate(p.date) : 'Sin fecha'}</span><input type="date" value="${p.date}" data-pact="date" aria-label="Día de la parte"></label>
    <input class="inp pts" type="number" inputmode="numeric" min="0" data-pact="pts" value="${p.points ?? ''}" placeholder="${sh[i]}" aria-label="Puntos de la parte">
    <button type="button" class="x" data-pact="del" aria-label="Quitar parte">✕</button></div>`).join('');
  $('#partsHint').hidden = !formParts.length;
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
// Puntos por parte: por defecto, lo proporcional al total de la tarea (el campo ⭐ de abajo)
const formShares = () => partShares($('#points').value === '' ? null : $('#points').value, formParts.map(p => ({ points: p.points, date: p.date })));
function refreshShares() { const sh = formShares(); document.querySelectorAll('#partList [data-pact=pts]').forEach((el, i) => { el.placeholder = sh[i]; }); }
// Arrastrar las partes por el asa para cambiar el orden
let partDrag = null;
$('#partList').addEventListener('pointerdown', e => {
  const g = e.target.closest('[data-pact=grip]'); if (!g) return;
  e.preventDefault(); partDrag = { i: +g.closest('.partrow').dataset.i };
  g.closest('.partrow').classList.add('dragging');
  try { $('#partList').setPointerCapture(e.pointerId); } catch {}
});
$('#partList').addEventListener('pointermove', e => {
  if (!partDrag) return; e.preventDefault();
  const rows = [...$('#partList').querySelectorAll('.partrow')];
  const j = rows.filter((r, k) => k !== partDrag.i && e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2).length;
  if (j !== partDrag.i) { const [it] = formParts.splice(partDrag.i, 1); formParts.splice(j, 0, it); partDrag.i = j; renderParts(); $('#partList').querySelectorAll('.partrow')[j]?.classList.add('dragging'); }
});
const endPartDrag = () => { if (partDrag) { partDrag = null; renderParts(); } };
$('#partList').addEventListener('pointerup', endPartDrag);
$('#partList').addEventListener('pointercancel', endPartDrag);
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
$('#partList').addEventListener('input', e => {
  const i = +e.target.closest('.partrow')?.dataset.i;
  if (e.target.dataset.pact === 'title') formParts[i].title = e.target.value;
  if (e.target.dataset.pact === 'pts') { formParts[i].points = e.target.value === '' ? null : Math.max(0, Number(e.target.value)); refreshShares(); }
});
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

function openForm(id, preset) {
  const t = id ? tasks.find(x => x.id === id) : null;
  editingId = t ? t.id : null; tplParts = null; formCatTouched = !!t;
  $('#title').value = t ? t.title : '';
  formCat = t ? (t.cat ?? '') : (catFilter || cats[cats.length - 1]?.id || '');
  if (!t && !cats.some(c => c.id === formCat)) formCat = cats[0]?.id || '';
  const inLists = !t && view === 'sinfecha' && !query, lk = inLists ? (listSel || '') : '';
  formNoDate = t ? !t.date : inLists;
  formSomeday = t ? !!t.someday : lk === 'someday';
  formFlag = t ? !!t.flag : (lk === 'flag' || !!preset?.flag);
  formTonight = t ? !!t.tonight : false;
  $('#tags').value = t ? (t.tags || []).join(', ') : lk.startsWith('t:') ? lk.slice(2) : '';
  $('#proj').innerHTML = projOptions(t ? t.project : lk.startsWith('p:') ? lk.slice(2) : (preset?.project || ''));
  $('#born').value = t && t.born ? t.born : '';
  $('#date').value = t ? (t.date || todayISO()) : preset?.date || (view === 'semana' ? (calMode === 'mes' ? agendaSel : calSel) || todayISO() : todayISO());
  if (!t && (preset?.date || view === 'semana')) formNoDate = false;
  $('#time').value = t ? (t.time || '') : (preset?.time || '');
  $('#endTime').value = t ? (t.endTime || '') : (preset?.end || (preset?.time ? hhmm(toMin(preset.time) + 60) : ''));
  $('#loc').value = t ? (t.loc || '') : '';
  $('#prio').value = t ? (t.prio || 'normal') : 'normal';
  $('#repeat').value = t ? (t.repeat || '') : '';
  formDays = t && Array.isArray(t.days) ? [...t.days] : [];
  $('#monthDay').value = '';
  renderMonthDay();
  if (t && t.monthDay) $('#monthDay').value = String(t.monthDay);
  $('#until').value = t ? (t.until || '') : '';
  $('#every').value = t && t.every > 1 ? t.every : 1;
  formMonthMode = t && t.nth ? 'nth' : 'day';
  { const base = parseISO((t && t.date) || todayISO()); $('#nth').value = String(t && t.nth ? t.nth : Math.min(4, Math.ceil(base.getDate() / 7))); $('#nthDay').value = String(t && t.nthDay !== null && t.nthDay !== undefined ? t.nthDay : base.getDay()); }
  $('#minutes').value = t && t.minutes ? t.minutes : '';
  $('#points').value = t && t.points !== null && t.points !== undefined ? t.points : '';
  $('#remind').value = t && t.remind !== null && t.remind !== undefined ? String(t.remind) : '';
  $('#notes').value = t ? (t.notes || '') : '';
  formParts = t ? children(t.id).sort(sortParts).map(c => ({ id: c.id, title: c.title, date: c.date || '', done: !!c.done, points: c.points ?? null, time: c.time || '', endTime: c.endTime || '' })) : [];
  formPrevStart = t ? (t.time || '') : '';
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
  renderCatChips(); renderParts(); renderDetected(); renderTagSugs();
  openSheet('#taskSheet');
  if (!t) setTimeout(() => $('#title').focus(), 60);
}
$('#fab').addEventListener('click', () => {
  if (query) return openForm(null);
  if (view === 'habitos') return openHabit(null);
  if (view === 'notas') return openNote(null);
  if (view === 'sinfecha' && listSel === 'compra') { $('#shopInput')?.focus(); return; }
  openForm(null);
});
$('#taskSheet').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#title').value.trim();
  if (!title) { $('#title').focus(); return; }
  const pend = $('#partNew').value.trim(); if (pend) addPart(pend, '');
  const data = {
    title, cat: formCat, date: formNoDate ? '' : ($('#date').value || todayISO()),
    time: $('#time').value, endTime: $('#time').value ? $('#endTime').value : '',
    prio: $('#prio').value, repeat: $('#repeat').value, days: $('#repeat').value === 'dias' ? formDays : [],
    monthDay: $('#repeat').value === 'mensual' && formMonthMode === 'day' ? Number($('#monthDay').value) : null, until: $('#repeat').value ? $('#until').value : '',
    every: $('#repeat').value ? Math.max(1, Number($('#every').value) || 1) : 1,
    nth: $('#repeat').value === 'mensual' && formMonthMode === 'nth' ? Number($('#nth').value) : null,
    nthDay: $('#repeat').value === 'mensual' && formMonthMode === 'nth' ? Number($('#nthDay').value) : null,
    minutes: formNoDate && Number($('#minutes').value) > 0 ? Number($('#minutes').value) : null,
    points: $('#points').value === '' ? null : Number($('#points').value),
    remind: formNoDate || $('#remind').value === '' ? null : Number($('#remind').value), notes: $('#notes').value.trim(), inbox: false, loc: $('#loc').value.trim(),
    tags: readTags(), someday: formNoDate && formSomeday, tonight: !formNoDate && formTonight,
    flag: formFlag, project: $('#proj').value, born: formCat === 'cumple' && $('#born').value ? Number($('#born').value) : null,
  };
  if (!editingId) {
    const p = parseQuick(title, cats);
    data.title = p.title;
    if (p.date) { data.date = p.date; formNoDate = false; }
    if (p.time) { data.time = p.time; data.endTime = p.endTime || data.endTime || $('#endTime').value; if (!data.date) data.date = todayISO(); }
    if (p.cat) data.cat = p.cat;
    else if (!formCatTouched) { const g = guessCat(p.title); if (g) data.cat = g; }
    if (p.prio) data.flag = true;
    if (p.tags) data.tags = [...new Set([...data.tags, ...p.tags.map(normTag)])];
    if (p.repeat && !formParts.length) { data.repeat = p.repeat; data.days = p.days || []; data.every = p.every || 1; data.nth = p.nth || null; data.nthDay = p.nthDay ?? null; data.monthDay = null; }
  }
  if (data.cat === 'cumple' && data.date && !data.repeat && !formParts.length) data.repeat = 'anual';
  if (!data.date) { data.time = ''; data.endTime = ''; data.repeat = ''; }
  if (data.time && !data.endTime) data.endTime = hhmm(toMin(data.time) + 60);
  if (data.repeat === 'dias' && !data.days.length) data.repeat = 'semanal';
  // La semana de referencia (para "una semana sí y otra no") se mantiene si no cambias la repetición
  { const old = editingId && tasks.find(x => x.id === editingId); data.anchor = old && old.anchor && old.repeat === data.repeat && (old.every || 1) === data.every && String(old.days) === String(data.days) ? old.anchor : ''; }
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
    Object.assign(c, { title: p.title.trim() || `Parte ${i + 1}`, date: p.date, cat: parent.cat, parentId: parent.id, prio: parent.prio, project: parent.project || '', order: i, points: p.points ?? null });
    if (!p.date) { c.time = ''; c.endTime = ''; }
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
      repeat: $('#repeat').value, days: formDays, monthDay: $('#repeat').value === 'mensual' && formMonthMode === 'day' ? Number($('#monthDay').value) : null,
      every: Math.max(1, Number($('#every').value) || 1), nth: $('#repeat').value === 'mensual' && formMonthMode === 'nth' ? Number($('#nth').value) : null, nthDay: $('#repeat').value === 'mensual' && formMonthMode === 'nth' ? Number($('#nthDay').value) : null,
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
  $('#every').value = t.every || 1; formMonthMode = t.nth ? 'nth' : 'day'; if (t.nth) { $('#nth').value = String(t.nth); $('#nthDay').value = String(t.nthDay ?? 0); }
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
// Una tarea de un día pasado (p. ej. de ayer, marcada pasada la medianoche) cuenta como hecha en su día.
// Si la hiciste de verdad hoy, muévela antes a hoy.
const doneDayOf = t => t.date && t.date < todayISO() ? t.date : todayISO();
// Para deshacer: los puntos de los días que puede tocar (hoy y los de las tareas) antes del cambio
const ptsSnap = list => { const days = new Set([todayISO()]); list.forEach(t => { days.add(doneDayOf(t)); if (t.ptsDay) days.add(t.ptsDay); }); return Object.fromEntries([...days].map(d => [d, pointsOn(d)])); };
const ptsRestore = snap => Object.entries(snap).forEach(([d, v]) => { const diff = pointsOn(d) - v; if (diff) addPoints(-diff, d); });
function setDone(t, done) {
  if (!!t.done === done) return;
  const day = doneDayOf(t);
  t.done = done; t.doneAt = done ? (day === todayISO() ? Date.now() : parseISO(day).getTime() + (23 * 60 + 59) * 60000) : null;
  if (done) { t.pts = t.parentId ? partPoints(t) : children(t.id).length ? 0 : taskPoints(t); t.ptsDay = day; addPoints(t.pts, day); }
  else if (t.pts) { addPoints(-t.pts, t.ptsDay || todayISO()); t.pts = 0; t.ptsDay = ''; }
}
let undoAction = null, toastTimer = null;
function showToast(text, action) {
  undoAction = action || null;
  $('#toastText').textContent = text;
  $('#toastUndo').hidden = !action;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; undoAction = null; }, 4500);
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
  const ptsBefore = ptsSnap([t, ...(parent ? [parent] : [])]);
  const created = [];
  const nowDone = !t.done;
  setDone(t, nowDone);
  let msg = nowDone ? `Hecha${t.ptsDay && t.ptsDay !== todayISO() ? ` (${friendlyDate(t.ptsDay).toLowerCase()})` : ''}: ${t.title} · +${t.pts} ⭐` : `Pendiente otra vez: ${t.title}`;
  if (nowDone && t.repeat && !t.spawned) {
    t.spawned = true;
    t.streak = (t.streak || 0) + 1; t.best = Math.max(t.best || 0, t.streak);
    t.history = [...(t.history || []), t.ptsDay || todayISO()].slice(-120);
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
    if (pr.total && pr.done === pr.total && !parent.done) { setDone(parent, true); store.put(parent).catch(writeFailed); msg = `¡Terminaste ${parent.title}! ${pr.done}/${pr.total} · +${t.pts} ⭐`; }
    else if (!nowDone && parent.done) { setDone(parent, false); store.put(parent).catch(writeFailed); }
    else if (nowDone) msg = `${t.title} · ${pr.done}/${pr.total} de ${parent.title} · +${t.pts} ⭐`;
  }
  store.put(t).catch(writeFailed);
  navigator.vibrate?.(10);
  showToast(msg, () => {
    // Deshacer: vuelve todo como estaba (incluida la siguiente repetición y los puntos)
    created.forEach(cid => { tasks = tasks.filter(x => x.id !== cid); store.remove(cid).catch(writeFailed); });
    restore(before);
    ptsRestore(ptsBefore);
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
  const li = e.target.closest('li.task'); if (!li || !li.dataset.id || e.button > 0) return;
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
    tasks: tasks.map(t => ({ id: t.id, ...clean(t) })), habits, cats, stats, rewards, templates, books: shelf.books.items, movies: shelf.movies.items, projects, shop, notes };
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
      let nShelf = 0;
      for (const k in SHELF) (data[k] || []).forEach(b => { if (!b?.id || !b.title) return; nShelf++; saveItem(k, { id: String(b.id).replace(/[^\w.~:@+-]/g, '_'), ...cleanItem(k, b) }); });
      for (const k in ROWS) (Array.isArray(data[k]) ? data[k] : []).forEach(r => { if (r?.id) saveRow(k, { ...r, id: String(r.id).replace(/[^\w.~:@+-]/g, '_') }); });
      info.textContent = list.length || (data.habits || []).length || !nShelf ? `Copia restaurada: ${list.length} tareas y ${(data.habits || []).length} hábitos${nShelf ? `, y ${nShelf} libros y películas` : ''}. Los puntos no se tocan para no sumarlos dos veces.` : `Listo: ${(data.books || []).length} libros y ${(data.movies || []).length} películas añadidos.`;
      render(); return;
    }
    // Un archivo de hábitos o rutinas: {"habits":[…]}
    if (data && !Array.isArray(data) && Array.isArray(data.habits)) {
      const base = Date.now(), list = data.habits.filter(h => h && h.name && (habits.some(x => x.id === h.id) || !habits.some(x => fold(x.name) === fold(h.name)))).map((h, i) => ({ id: String(h.id || 'h' + uid()).replace(/[^\w.~:@+-]/g, '_'), ...cleanHabit({ ...h, order: h.order || base + i }) }));
      list.forEach(h => { const i = habits.findIndex(x => x.id === h.id); if (i >= 0) habits[i] = h; else habits.push(h); store.putHabit(h).catch(writeFailed); });
      const skipped = data.habits.length - list.length;
      info.textContent = `Listo: ${list.length} ${list.length === 1 ? 'hábito importado' : 'hábitos o rutinas importados'}${skipped ? ` (${skipped} ya los tenías)` : ''}. Míralos en la pestaña Hábitos.`;
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
const hm2 = m => m == null ? '—' : `${Math.floor(m / 60)}h${pad(m % 60)}m`;
// El gráfico del sueño empieza mostrando lo último; al deslizar, la media es la de las noches que se ven
let sFromRight = 0; // se mantiene dónde lo dejaste al volver a pintar
let wFromRight = 0;
function fitSleepCharts() {
  document.querySelectorAll('#list .sscroll').forEach(sc => { sc.scrollLeft = sc.scrollWidth - sc.clientWidth - sFromRight; sleepMedia(sc); });
  document.querySelectorAll('#list .wkscroll').forEach(sc => { sc.style.scrollSnapType = 'none'; sc.scrollLeft = sc.scrollWidth - sc.clientWidth - wFromRight; sc.style.scrollSnapType = ''; });
}
function sleepMedia(sc) {
  const a = sc.scrollLeft - 6, b = sc.scrollLeft + sc.clientWidth + 6;
  const v = [...sc.querySelectorAll('circle[data-m]')].filter(c => { const x = +c.getAttribute('cx'); return x >= a && x <= b; }).map(c => +c.dataset.m);
  const out = sc.closest('.summary')?.querySelector('[data-smedia]');
  if (out && v.length) out.textContent = hm2(Math.round(v.reduce((t, x) => t + x, 0) / v.length));
}
$('#list').addEventListener('toggle', e => { const r = e.target.dataset?.r; if (r && e.target.classList.contains('rsteps')) { try { localStorage.setItem('rt-' + r, e.target.open ? '1' : '0'); } catch {} const sm = e.target.querySelector('summary'); if (sm) sm.textContent = e.target.open ? 'Ocultar pasos' : `Ver los ${e.target.querySelectorAll('li').length} pasos`; } }, true);
$('#list').addEventListener('toggle', e => { const g = e.target.dataset?.g; if (g && e.target.classList.contains('hgroup')) { try { localStorage.setItem('hg-' + g, e.target.open ? '1' : '0'); } catch {} } }, true);
$('#list').addEventListener('scroll', e => { if (e.target.classList?.contains('wkscroll')) wFromRight = e.target.scrollWidth - e.target.clientWidth - e.target.scrollLeft; }, true);
$('#list').addEventListener('scroll', e => { const sc = e.target; if (!sc.classList?.contains('sscroll')) return; sFromRight = sc.scrollWidth - sc.clientWidth - sc.scrollLeft; sleepMedia(sc); }, true);
function sleepProgHTML(h) {
  const d = todayISO(), n = h.nights[d], s = habitStreak(h), b = habitBest(h);
  const r = n ? judgeSleep(h, d, n.bed, n.wake) : null, open = sleepEdit === h.id;
  // Desde la primera noche apuntada (como poco 2 semanas, como mucho un año); se desliza hacia atrás
  const first = Object.keys(h.nights).sort()[0] || d;
  let n0 = Math.round((parseISO(d) - parseISO(first)) / 864e5); n0 = Math.max(13, Math.min(365, n0));
  const days = [...Array(n0 + 1)].map((_, i) => addDays(d, i - n0));
  const nights = days.map(x => { const v = h.nights[x]; return v ? { d: x, ...v, ...judgeSleep(h, x, v.bed, v.wake) } : { d: x }; });
  const logged = nights.filter(x => x.bed), min = h.hours * 60;
  let body = '';
  if (logged.length) {
    const last14 = logged.filter(x => x.d > addDays(d, -14)), avg = l => l.length ? Math.round(l.reduce((t, x) => t + x.slept, 0) / l.length) : null;
    // Gráfico: un punto por noche (verde si llegaste a tu mínimo, rojo si no), unidos en orden
    const STEP = 22, PADL = 12, H = 160, T = 10, B = 34, W = PADL * 2 + (days.length - 1) * STEP;
    const lo = Math.floor(Math.min(min - 60, ...logged.map(x => x.slept)) / 60) * 60, hi = Math.ceil(Math.max(min + 60, ...logged.map(x => x.slept)) / 60) * 60;
    const X = k => PADL + k * STEP, Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const pts = nights.map((x, k) => x.bed ? { x: X(k), y: Y(x.slept), x0: x } : null).filter(Boolean);
    let grid = '', axis = '';
    for (let v = lo; v <= hi; v += 60) { grid += `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="sg"/>`; axis += `<text x="26" y="${Y(v) + 3.5}" text-anchor="end" class="st">${v / 60}h</text>`; }
    const labels = nights.map((x, k) => { const dt = parseISO(x.d), day = dt.getDate(); return `<text x="${X(k)}" y="${H - 20}" text-anchor="middle" class="st${x.d === d ? ' today' : ''}">${DAY_LETTER[dt.getDay()]}</text><text x="${X(k)}" y="${H - 6}" text-anchor="middle" class="st sm${x.d === d ? ' today' : ''}">${day === 1 ? MONTHS_SHORT[dt.getMonth()].toLowerCase() : day}</text>`; }).join('');
    body = `<p class="smedia">Media: <b data-smedia>${hm2(avg(last14) ?? avg(logged))}</b></p>
      <div class="swrap"><svg class="saxis" width="30" height="${H}" viewBox="0 0 30 ${H}" aria-hidden="true">${axis}</svg>
      <div class="sscroll"><svg class="schart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas dormidas cada noche">${grid}
        <line x1="0" x2="${W}" y1="${Y(min)}" y2="${Y(min)}" class="smin"/>
        ${pts.length > 1 ? `<polyline points="${pts.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}" class="sl"/>` : ''}
        ${pts.map(q => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="4.5" class="${q.x0.slept >= min ? 'ok' : 'bad'}" data-m="${q.x0.slept}"><title>${q.x0.bed}–${q.x0.wake} · ${fmtDur(q.x0.slept)}</title></circle>`).join('')}
        ${labels}</svg></div></div>`;
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
const rtOpen = id => { try { return localStorage.getItem('rt-' + id) === '1'; } catch { return false; } };
let habOrdering = false;
const habGroup = h => h.kind === 'build' ? 'b:' + h.freq : h.kind;
const moveBtns = h => `<span class="hmove"><button type="button" class="iconbtn sm" data-act="hmove" data-id="${h.id}" data-dir="-1" aria-label="Subir ${esc(h.name)}">↑</button><button type="button" class="iconbtn sm" data-act="hmove" data-id="${h.id}" data-dir="1" aria-label="Bajar ${esc(h.name)}">↓</button></span>`;
function moveHabit(id, dir) {
  const h = habits.find(x => x.id === id); if (!h) return;
  const group = sortedHabits().filter(x => habGroup(x) === habGroup(h)), i = group.indexOf(h), j = i + dir;
  if (j < 0 || j >= group.length) return;
  [group[i], group[j]] = [group[j], group[i]];
  // Reparte los números de orden del grupo en el nuevo orden y guarda los que cambian
  const slots = group.map(x => x.order).sort((p, q) => p - q);
  group.forEach((x, k) => { const o = slots[k] === slots[k - 1] ? slots[k - 1] + 1 : slots[k]; slots[k] = o; if (x.order !== o) { x.order = o; store.putHabit(x).catch(writeFailed); } });
  render();
}
function routineRowHTML(h) {
  const today = todayISO(), done = new Set(stepsToday(h)), s = habitStreak(h), b = habitBest(h), now = toMin(nowHM());
  const on = applies(h, today);
  const daysTxt = h.days?.length && h.days.length < 7 ? DAY_ORDER.filter(d => h.days.includes(d)).map(d => DAY_LETTER[d]).join(' ') : 'Todos los días';
  return `<div class="hab routine" style="--c:var(--accent)">
    <div class="hb"><div class="n">🕘 ${esc(h.name)} <span class="m">· ${done.size}/${h.steps.length}</span>${habOrdering ? moveBtns(h) : editBtn('hedit', 'Editar rutina', h.id)}</div>
      <div class="m">${daysTxt} · ${h.steps[0]?.time || ''}–${h.steps[h.steps.length - 1]?.time || ''} · ${s ? `🔥 ${s} ${s === 1 ? 'día' : 'días'}` : 'Sin racha todavía'}${b > s ? ` · récord ${b}` : ''}</div>
      ${on ? `<details class="rsteps" data-r="${h.id}"${rtOpen(h.id) ? ' open' : ''}><summary>${rtOpen(h.id) ? 'Ocultar pasos' : `Ver los ${h.steps.length} pasos`}</summary><ul class="steps-list">${h.steps.map((st, i) => {
        const next = h.steps[i + 1], cur = toMin(st.time) <= now && (!next || now < toMin(next.time));
        return `<li><button class="${done.has(st.id) ? 'on' : ''} ${cur ? 'cur' : ''}" data-act="rstep" data-id="${h.id}" data-step="${st.id}"><span class="box">${TICK('var(--surface)')}</span><span class="tm">${st.time}</span><span>${esc(st.text)}</span></button></li>`;
      }).join('')}</ul></details>` : '<p class="hint">Hoy no toca.</p>'}
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
  : PERIODIC.includes(h.freq) ? (habitOK(h, todayISO()) || periodCount(h, periodStart(h, todayISO())) >= h.target) : habitOK(h, todayISO());
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
    showToast(`+${habitPoints(h)} ⭐ · ${h.name}${s >= 2 ? ` · 🔥 ${s} ${PUNIT[h.freq]?.[1] || 'días'}` : ''}`, () => setHabit(id, 1));
  }
  render();
}
function dotsHTML(h) {
  const mon = mondayOf(todayISO()), today = todayISO();
  return `<div class="dots">${DAY_ORDER.map((wd, i) => { const d = addDays(mon, i), v = h.log[d]; return `<i class="${v === 1 ? 'on' : v === -1 ? 'bad' : d > today ? 'off' : d < today ? 'past' : ''}">${DAY_LETTER[wd]}</i>`; }).join('')}</div>`;
}
const PUNIT = { weekly: ['semana', 'semanas', 'esta semana'], monthly: ['mes', 'meses', 'este mes'], yearly: ['año', 'años', 'este año'] };
// Para los de cada mes o cada año: los últimos meses o años, en verde los cumplidos
function periodDotsHTML(h) {
  let st = periodStart(h, todayISO()); const list = [];
  for (let i = 0; i < (h.freq === 'yearly' ? 4 : 6); i++) { list.unshift(st); st = prevPeriod(h, st); }
  return `<div class="dots pdots">${list.map((p, i) => `<i class="${periodCount(h, p) >= h.target ? 'on' : i === list.length - 1 ? '' : 'past'}">${h.freq === 'yearly' ? p.slice(0, 4) : MONTHS_SHORT[+p.slice(5, 7) - 1]}</i>`).join('')}</div>`;
}
function habitRowHTML(h) {
  const s = habitStreak(h), today = todayISO(), v = h.log[today];
  const unit = PUNIT[h.freq] ? PUNIT[h.freq][s === 1 ? 0 : 1] : (s === 1 ? 'día' : 'días');
  let meta = h.kind === 'quit' ? (s ? `🔥 ${s} ${unit} sin caer` : 'Empieza hoy')
    : PUNIT[h.freq] ? `${periodCount(h, periodStart(h, today))}/${h.target} ${PUNIT[h.freq][2]}${s ? ` · 🔥 ${s} ${unit}` : ''}`
    : (s ? `🔥 ${s} ${unit}` : 'Sin racha todavía');
  const b = habitBest(h); if (b > s && !PUNIT[h.freq]) meta += ` · récord ${b}`;
  meta += ` · +${habitPoints(h)} ⭐`;
  const actions = h.kind === 'quit'
    ? `<div class="qbtns"><button class="qb ok ${v === 1 ? 'on' : ''}" data-act="hok" data-id="${h.id}" aria-label="Lo he evitado hoy">✓</button><button class="qb bad ${v === -1 ? 'on' : ''}" data-act="hbad" data-id="${h.id}" aria-label="Hoy he caído">✗</button></div>`
    : `<button class="hcheck ${v === 1 ? 'on' : ''}" data-act="hok" data-id="${h.id}" aria-label="Hecho hoy: ${esc(h.name)}">${TICK('var(--surface)')}</button>`;
  return `<div class="hab ${h.kind}" style="--c:${h.kind === 'quit' ? 'var(--k-turquesa)' : 'var(--k-verde)'}">
    <div class="hb"><div class="n">${esc(h.name)}${habOrdering ? moveBtns(h) : editBtn('hedit', 'Editar hábito', h.id)}</div><div class="m">${meta}</div>${h.freq === 'monthly' || h.freq === 'yearly' ? periodDotsHTML(h) : dotsHTML(h)}</div>${actions}</div>`;
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
  const gOpen = k => { try { return localStorage.getItem('hg-' + k) !== '0'; } catch { return true; } };
  const fold2 = (k, title, n, inner) => `<details class="hgroup" data-g="${k}"${gOpen(k) ? ' open' : ''}><summary class="group"><span>${title}</span><span>${n}</span></summary>${inner}</details>`;
  let showHabDone = false; try { showHabDone = localStorage.getItem('hab-done') === '1'; } catch {}
  const isDone = h => h.kind === 'routine' ? applies(h, today) && h.steps.length && stepsToday(h).length === h.steps.length : (h.kind === 'build' || h.kind === 'quit') && habitDoneToday(h);
  const nDone = all.filter(isDone).length, vis = l => showHabDone || habOrdering ? l : l.filter(h => !isDone(h));
  html += `<div class="hbar"><button class="btn ${habOrdering ? 'primary' : 'ghost'} small" data-act="horder">${habOrdering ? 'Listo' : '↕ Ordenar'}</button>${nDone && !habOrdering ? `<button class="btn ghost small" data-act="habdone">${showHabDone ? `Ocultar los hechos (${nDone})` : `👁 Mostrar los hechos (${nDone})`}</button>` : ''}</div>`;
  if (habOrdering) html += '<p class="hint" style="margin:0 2px 6px">Usa las flechas para cambiar el orden dentro de cada grupo.</p>';
  const sec = (title, list, k) => (list = vis(list)).length ? fold2(k, title, list.length, `<div class="habs">${list.map(habitRowHTML).join('')}</div>`) : '';
  const routines = vis(all.filter(h => h.kind === 'routine'));
  if (routines.length) html += fold2('rutinas', 'Rutinas', routines.length, `<div class="habs">${routines.map(routineRowHTML).join('')}</div>`);
  const sleep = all.filter(h => h.kind === 'sleep');
  // Aquí solo se configura; se apunta en Hoy y se ve y corrige en Progreso
  html += sleep.length ? fold2('sueno', 'Sueño', sleep.length, `<div class="habs">${sleep.map(h => { const s = habitStreak(h); return `<div class="hab sleep" style="--c:var(--k-violeta)"><div class="hb"><div class="n">🌙 ${esc(h.name)}${habOrdering ? moveBtns(h) : editBtn('hedit', 'Editar rutina de sueño', h.id)}</div>
      <div class="m">Luz apagada ${h.bed} · despertar ${h.wakeWk} (L–V), ${h.wakeWe} (S–D) · ${fmtDur(h.hours * 60)}${s ? ` · 🔥 ${s} ${s === 1 ? 'noche' : 'noches'}` : ''}</div>${dotsHTML(h)}</div></div>`; }).join('')}</div>`)
    : `<button class="btn block" data-act="hsleep" style="margin-top:10px">🌙 Añadir mi rutina de sueño (23:30 · 7:15)</button>`;
  html += sec('Cada día', all.filter(h => h.kind === 'build' && h.freq === 'daily'), 'dia');
  html += sec('Cada semana', all.filter(h => h.kind === 'build' && h.freq === 'weekly'), 'semana');
  html += sec('Cada mes', all.filter(h => h.kind === 'build' && h.freq === 'monthly'), 'mes');
  html += sec('Cada año', all.filter(h => h.kind === 'build' && h.freq === 'yearly'), 'ano');
  html += sec('Para dejar', all.filter(h => h.kind === 'quit'), 'dejar');
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
  $('#hTargetField').hidden = hKind !== 'build' || !PERIODIC.includes(hFreq);
  $('#hTargetLabel').textContent = `Veces ${hFreq === 'monthly' ? 'al mes' : hFreq === 'yearly' ? 'al año' : 'por semana'}`;
  $('#hTarget').max = hFreq === 'yearly' ? 366 : hFreq === 'monthly' ? 31 : 7;
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
  $('#hSuggest').hidden = true; // sin sugerencias: cada uno apunta sus propios hábitos
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
  const data = { name, kind: hKind, freq: hFreq, target: Number($('#hTarget').value) || (hFreq === 'weekly' ? 3 : 1), minutes: Number($('#hMin').value) || 10 };
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
    const key = 'c:' + (t.cat || ''), w = Math.max(1, t.parentId ? partPoints(t) : taskPoints(t));
    if (t.date && t.date <= today) add(key, t.date, w, t.done ? w : 0);
    else if (t.done && t.doneAt) add(key, isoDate(new Date(t.doneAt)), w, w);
  });
  habits.forEach(h => {
    const key = 'h:' + h.id;
    const w = Math.max(1, habitPoints(h));
    if (PERIODIC.includes(h.freq)) { Object.keys(h.log).forEach(d => { if (h.log[d] === 1 && d <= today) add(key, d, w, w); }); return; }
    if (h.kind === 'routine') {
      // Cada paso cuenta: hacer 6 de 8 pasos ese día = 75 %
      let d = isoDate(new Date(h.order)), n = 0;
      const sp = h.steps.map((_, i) => stepPoints(h, i)), tot = sp.reduce((s, v) => s + v, 0);
      while (d <= today && n++ < 800) { if (applies(h, d) && h.steps.length) { const dn = new Set(h.stepsDone[d] || []); add(key, d, tot, h.steps.reduce((s, st, i) => s + (dn.has(st.id) ? sp[i] : 0), 0)); } d = addDays(d, 1); }
      return;
    }
    const start = isoDate(new Date(h.order)), first = Object.keys(h.log).sort()[0];
    let d = first && first < start ? first : start, n = 0;
    while (d <= today && n++ < 800) { add(key, d, w, h.log[d] === 1 ? w : 0); d = addDays(d, 1); }
  });
  // El mes y el año van por tu objetivo de puntos diario: cada día, los puntos que ganaste frente al objetivo
  const goalD = {}, goal = Math.max(1, stats.goal || 100);
  const first = [...Object.keys(stats.days || {}).filter(d => stats.days[d] > 0), ...tasks.map(t => t.created ? isoDate(new Date(t.created)) : '').filter(Boolean), ...habits.map(h => isoDate(new Date(h.order)))].sort()[0];
  if (first) for (let d = first, g = 0; d <= today && g < 800; d = addDays(d, 1), g++) goalD[d] = { due: goal, done: Math.min(goal, pointsOn(d)) };
  return { tot, area, goalD };
}
const level = e => { if (!e || !e.due) return -1; const r = Math.min(1, e.done / e.due); return r === 0 ? 0 : r <= .25 ? 1 : r <= .5 ? 2 : r < 1 ? 3 : 4; };
const cell = (e, d, today) => `<i class="lv${level(e)}${d > today ? ' fut' : ''}${d === selectedDay ? ' sel' : ''}" data-act="yday" data-d="${d}"></i>`;
function weekPanelHTML(mon) {
  const today = todayISO(), week = [...Array(7)].map((_, i) => addDays(mon, i)), sun = addDays(mon, 6), cur = mon === mondayOf(today);
  const ptsWeek = week.reduce((s, d) => s + pointsOn(d), 0);
  const doneWeek = tasks.filter(t => t.done && t.doneAt && (d => d >= mon && d <= sun)(isoDate(new Date(t.doneAt))));
  const maxP = Math.max(stats.goal, ...week.map(pointsOn));
  const byCatCount = {}; doneWeek.forEach(t => { byCatCount[t.cat || ''] = (byCatCount[t.cat || ''] || 0) + 1; });
  const maxC = Math.max(1, ...Object.values(byCatCount));
  const f = d => parseISO(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const focus = week.reduce((s, d) => s + (Number(stats.focus?.[d]) || 0), 0);
  return `<div class="wkpanel"><p class="wktitle">${cur ? 'Esta semana' : `Semana del ${f(mon)} al ${f(sun)}`}</p>
    <div class="kpis"><div class="kpi"><b>${cur ? pointsOn(today) : Math.round(ptsWeek / 7)}</b><span>${cur ? 'puntos hoy' : 'media al día'}</span></div><div class="kpi"><b>${ptsWeek}</b><span>puntos semana</span></div><div class="kpi"><b>${doneWeek.length}</b><span>tareas hechas</span></div></div>
    <div class="weekbars">${week.map((d, i) => { const p = pointsOn(d); return `<div class="wb ${d === today ? 'today' : ''}"><span class="v">${p || ''}</span><div class="col"><i style="height:${p / maxP * 100}%"></i><b style="bottom:${stats.goal / maxP * 100}%"></b></div><span>${DAY_LETTER[DAY_ORDER[i]]}</span></div>`; }).join('')}</div>
    ${focus ? `<p class="hint">⏱ ${fmtDur(focus)} de concentración</p>` : ''}
    ${Object.keys(byCatCount).length ? `<div class="catbars">${Object.entries(byCatCount).sort((a, b) => b[1] - a[1]).map(([id, n]) => { const c = catOf(id); return `<div class="catbar" style="--c:${colorVar(c.color)}"><span>${esc(c.name)}</span><div class="bar"><i style="width:${n / maxC * 100}%"></i></div><span>${n}</span></div>`; }).join('')}</div>` : ''}
  </div>`;
}
function summaryHTML() {
  // Desde la primera semana con puntos o tareas hechas (como mucho un año); la última, a la vista
  const today = todayISO(), mon = mondayOf(today);
  const first = [...Object.keys(stats.days || {}).filter(d => stats.days[d] > 0), ...tasks.filter(t => t.done && t.doneAt).map(t => isoDate(new Date(t.doneAt)))].sort()[0] || today;
  const n = Math.min(52, Math.max(0, Math.round((parseISO(mon) - parseISO(mondayOf(first))) / 6048e5)));
  const weeks = [...Array(n + 1)].map((_, i) => addDays(mon, (i - n) * 7));
  return `<section class="summary">
    <div class="rato-head wkhead"><h2>Semana</h2>${on('recompensas') ? `<button class="btn ghost small" data-act="rewards">🎁 ${balance()} ⭐</button>` : ''}</div>
    <div class="wkscroll">${weeks.map(weekPanelHTML).join('')}</div>
    ${n ? '<p class="hint wkhint">← Desliza para ver las semanas anteriores</p>' : ''}
  </section>`;
}
function monthHTML(p) {
  const today = todayISO(), now = parseISO(today), y = now.getFullYear(), m = now.getMonth(), n = dim(y, m);
  const days = [...Array(n)].map((_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
  const G = p.goalD, past = days.filter(d => d <= today && G[d]?.due);
  const full = past.filter(d => level(G[d]) === 4).length;
  const avg = past.length ? Math.round(past.reduce((s, d) => s + Math.min(1, G[d].done / G[d].due), 0) / past.length * 100) : 0;
  let streak = 0; for (let d = level(G[today]) === 4 ? today : addDays(today, -1); level(G[d]) === 4 && streak < 400; d = addDays(d, -1)) streak++;
  return `<section class="summary"><div class="rato-head"><h2>${cap(now.toLocaleDateString('es-ES', { month: 'long' }))}</h2><span class="hint">${avg}% del objetivo de media</span></div>
    <div class="kpis"><div class="kpi"><b>${full}</b><span>días con tu objetivo</span></div><div class="kpi"><b>${streak}</b><span>días seguidos con él</span></div><div class="kpi"><b>${days.reduce((s, d) => s + pointsOn(d), 0)}</b><span>puntos del mes</span></div></div>
    <div class="mchart" style="--n:${n}">${days.map(d => { const e = G[d], r = e && e.due ? Math.min(1, e.done / e.due) : 0;
      return `<div class="mc ${d === today ? 'today' : ''} ${d > today ? 'fut' : ''}" data-act="yday" data-d="${d}"><i class="lv${level(e)}" style="height:${d > today ? 0 : Math.max(e?.due ? 6 : 0, r * 100)}%"></i></div>`; }).join('')}</div>
    <div class="mticks"><span>1</span><span>${Math.ceil(n / 2)}</span><span>${n}</span></div></section>`;
}
function yearHTML(p) {
  const today = todayISO(), y = parseISO(today).getFullYear();
  let rows = '';
  for (let m = 0; m < 12; m++) {
    rows += `<span class="ml">${MONTHS_SHORT[m]}</span>`;
    for (let day = 1; day <= 31; day++) { if (day > dim(y, m)) { rows += '<i class="na"></i>'; continue; } const d = `${y}-${pad(m + 1)}-${pad(day)}`; rows += cell(p.goalD[d], d, today); }
  }
  let detail = 'Toca un cuadrado para ver ese día.';
  if (selectedDay) { const pts = pointsOn(selectedDay), g = stats.goal || 100; detail = `${cap(parseISO(selectedDay).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}: ⭐ ${pts} de ${g}${pts >= g ? ' · ¡objetivo cumplido!' : ` · ${Math.round(pts / g * 100)}% del objetivo`}`; }
  return `<section class="summary"><div class="rato-head"><h2>${y}</h2><span class="legend">0 <i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i> Objetivo</span></div>
    <div class="year">${rows}</div><p class="hint" id="dayDetail">${detail}</p></section>`;
}
let areasEdit = false;
function areasHTML(p) {
  const today = todayISO(), now = parseISO(today), y = now.getFullYear(), m = now.getMonth(), n = dim(y, m);
  const days = [...Array(n)].map((_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`);
  const off = new Set(extra.prefs?.areasOff || []);
  const AC = progPrefs().areaColor;
  const row = (key, label, color, map) => {
    if (off.has(key)) return '';
    if (AC[key]) color = colorVar(AC[key]);
    const past = days.filter(d => d <= today && map?.[d]?.due); if (!past.length) return '';
    const pct = Math.round(past.reduce((s, d) => s + Math.min(1, map[d].done / map[d].due), 0) / past.length * 100);
    return `<div class="area" style="--g:${color}"><div class="an"><span>${esc(label)}</span><span>${pct}%</span></div><div class="acells" style="--n:${n}">${days.map(d => cell(map?.[d], d, today)).join('')}</div></div>`;
  };
  const allH = {};
  habits.forEach(h => Object.entries(p.area['h:' + h.id] || {}).forEach(([d, e]) => { const a = (allH[d] ||= { due: 0, done: 0 }); a.due += e.due; a.done += e.done; }));
  const rows = [['all', 'Todos los hábitos', 'var(--k-verde)', allH],
    ...cats.map(c => ['c:' + c.id, c.name, colorVar(c.color), p.area['c:' + c.id]])];
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
// ---------- Progreso a tu gusto: orden, qué apartados se ven y su color ----------
const PCARDS = [
  ['nivel', 'Nivel y logros', 'logros', () => levelHTML()],
  ['semana', 'Esta semana', null, () => summaryHTML()],
  ['animo', '¿Qué tal hoy?', 'animo', () => moodProgHTML()],
  ['sueno', 'Rutina de sueño', null, () => habits.filter(h => h.kind === 'sleep').map(sleepProgHTML).join('')],
  ['concentracion', 'Concentración', 'concentracion', () => focusHTML()],
  ['estimado', 'Estimado vs real', 'estimado', () => estimateHTML()],
  ['jardin', 'Tu jardín', 'jardin', () => gardenHTML()],
  ['mes', 'El mes', null, p => monthHTML(p)],
  ['ano', 'El año en cuadraditos', null, p => yearHTML(p)],
  ['apartados', 'Por apartado', null, p => areasHTML(p)],
];
const progPrefs = () => ({ order: [], off: [], color: {}, mode: {}, areaColor: {}, levels: {}, ...(extra.prefs?.prog || {}) });
// Qué apartados tienen escala de colores (pueden ir en tonos o en arcoíris)
const PMODES = ['semana', 'animo', 'mes', 'ano', 'apartados'];
const RAINBOW = ['#e03131', '#f76707', '#f59f00', '#37b24d', '#1c7ed6', '#4263eb', '#ae3ec9'];
// Qué es cada nivel en cada apartado (para elegir su color uno a uno)
const LEVELS = { semana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], animo: ['Muy mal', 'Regular', 'Normal', 'Bien', 'Genial'], mes: ['Nada', 'Poco', 'La mitad', 'Casi todo', 'Todo'], ano: ['Nada', 'Poco', 'La mitad', 'Casi todo', 'Todo'], apartados: ['Nada', 'Poco', 'La mitad', 'Casi todo', 'Todo'] };
const levelCols = (P, id) => LEVELS[id].map((_, i) => (P.levels?.[id] || [])[i] || RAINBOW[i]);
function progOrder() {
  const o = progPrefs().order.filter(id => PCARDS.some(c => c[0] === id));
  return [...o, ...PCARDS.map(c => c[0]).filter(id => !o.includes(id))].map(id => PCARDS.find(c => c[0] === id));
}
const cardOn = c => !progPrefs().off.includes(c[0]) && (!c[2] || on(c[2]));
function saveProg(p) { extra.prefs = { ...extra.prefs, prog: p }; store.saveExtra('prefs').catch(writeFailed); render(); if (!$('#progSheet').hidden) renderProgSheet(); }
function progresoHTML() {
  const P = progPrefs(), p = buildProgress();
  return progOrder().filter(cardOn).map(c => {
    const col = c[0] === 'apartados' ? '' : P.color[c[0]], mode = P.mode[c[0]] || 'shade', inner = c[3](p); if (!inner) return '';
    const vars = [col ? `--pc:${colorVar(col)};--g:${colorVar(col)};--accent:${colorVar(col)}` : '', mode === 'custom' && LEVELS[c[0]] ? levelCols(P, c[0]).map((v, i) => `--l${i}:${v}`).join(';') : ''].filter(Boolean).join(';');
    return `<div class="pcard" data-pc="${c[0]}" data-mode="${mode}"${vars ? ` style="${vars}"` : ''}>${inner}</div>`;
  }).join('');
}
const MORE_COLORS = ['#000000', '#495057', '#adb5bd', '#ffc9c9', '#ff8787', '#c92a2a', '#ffd8a8', '#e8590c', '#ffec99', '#f08c00', '#d8f5a2', '#5c940d', '#96f2d7', '#087f5b', '#a5d8ff', '#1864ab', '#bac8ff', '#364fc7', '#eebefa', '#862e9c', '#fcc2d7', '#a61e4d'];
const palette = (sel, attr) => `<div class="pcols"><button type="button" class="pcol auto${sel ? '' : ' on'}" ${attr}="" aria-label="Color normal">A</button>${[...COLORS, ...MORE_COLORS].map(k => `<button type="button" class="pcol${sel === k ? ' on' : ''}" ${attr}="${k}" style="background:${colorVar(k)}" aria-label="${k}"></button>`).join('')}<label class="pcol pick${sel && /^#/.test(sel) && !MORE_COLORS.includes(sel) ? ' on' : ''}" title="Otro color" style="${sel && /^#/.test(sel) ? `background:${sel}` : ''}">＋<input type="color" ${attr}-x value="${/^#/.test(sel || '') ? sel : '#4263eb'}" aria-label="Elegir otro color"></label></div>`;
// Las filas de "Por apartado" (todos los hábitos, cada categoría y cada hábito), cada una con su color
const areaRows = () => [['all', 'Todos los hábitos', 'verde'], ...cats.map(c => ['c:' + c.id, c.name, c.color])];
function renderProgSheet() {
  const P = progPrefs(), list = progOrder();
  $('#progBody').innerHTML = `<p class="hint">Arrastra ⋮⋮ para ordenar, apaga lo que no quieras ver y elige cómo se colorea cada apartado.</p>
    <div class="plist">${list.map(c => { const id = c[0], mode = P.mode[id] || 'shade';
      return `<div class="prow${cardOn(c) ? '' : ' off'}" data-pc="${id}">
        <div class="prow1"><span class="grip" data-pgrip aria-label="Arrastra para ordenar">⋮⋮</span><b>${c[1]}</b><button type="button" class="iconbtn sm" data-pmove="-1" aria-label="Subir">↑</button><button type="button" class="iconbtn sm" data-pmove="1" aria-label="Bajar">↓</button><button type="button" class="switch" role="switch" aria-checked="${cardOn(c)}" data-ptog="${id}" aria-label="Ver ${c[1]}"></button></div>
        ${PMODES.includes(id) ? `<div class="chips pmodes">${[['shade', 'Claro → oscuro'], ['rev', 'Oscuro → claro'], ['rainbow', '🌈 Arcoíris'], ['custom', '🎨 A mi gusto']].map(([v, l]) => `<button type="button" class="chip" aria-pressed="${mode === v}" data-pmode="${v}">${l}</button>`).join('')}</div>
          ${mode === 'custom' ? `<div class="plevels">${LEVELS[id].map((l, i) => `<label class="plev"><input type="color" data-plev="${i}" value="${levelCols(P, id)[i]}" aria-label="Color de ${l}"><span>${l}</span></label>`).join('')}</div>` : ''}` : ''}
        ${id === 'apartados' ? `<details class="arow-cols"><summary>Color de cada apartado</summary>${areaRows().map(([k, label, def]) => `<div class="arowc" data-ak="${esc(k)}"><span class="dot" style="background:${colorVar(P.areaColor[k] || def)}"></span><span>${esc(label)}</span>${palette(P.areaColor[k] || '', 'data-acol')}</div>`).join('')}</details>`
          : (mode === 'rainbow' || mode === 'custom') && PMODES.includes(id) ? '' : palette(P.color[id] || '', 'data-pcol')}</div>`; }).join('')}</div>`;
}
$('#openProg').addEventListener('click', () => { renderProgSheet(); openSheet('#progSheet'); });
$('#progBody').addEventListener('click', e => {
  const t = e.target.closest('[data-ptog]'), c = e.target.closest('button[data-pcol]'), m = e.target.closest('[data-pmode]'), ac = e.target.closest('button[data-acol]'), mv = e.target.closest('[data-pmove]');
  if (!t && !c && !m && !ac && !mv) return;
  const P = progPrefs(), id = e.target.closest('[data-pc]').dataset.pc;
  if (mv) { const ids = progOrder().map(x => x[0]), i = ids.indexOf(id), j = Math.max(0, Math.min(ids.length - 1, i + Number(mv.dataset.pmove))); ids.splice(i, 1); ids.splice(j, 0, id); P.order = ids; saveProg(P); return; }
  if (t) {
    const card = PCARDS.find(x => x[0] === id), vis = cardOn(card);
    P.off = vis ? [...new Set([...P.off, id])] : P.off.filter(x => x !== id);
    // Si estaba apagado en Secciones, encenderlo aquí también lo enciende allí
    if (!vis && card[2] && !on(card[2])) extra.prefs = { ...extra.prefs, off: (extra.prefs.off || []).filter(x => x !== card[2]) };
  } else if (m) P.mode = { ...P.mode, [id]: m.dataset.pmode };
  else if (ac) { const k = ac.closest('[data-ak]').dataset.ak; P.areaColor = { ...P.areaColor }; if (ac.dataset.acol) P.areaColor[k] = ac.dataset.acol; else delete P.areaColor[k]; }
  else { P.color = { ...P.color }; if (c.dataset.pcol) P.color[id] = c.dataset.pcol; else delete P.color[id]; }
  P.order = progOrder().map(x => x[0]);
  const open = !!$('#progBody .arow-cols')?.open;
  saveProg(P);
  if (open) $('#progBody .arow-cols').open = true;
});
// Ordenar arrastrando el asa
let progDrag = null;
// Colores elegidos con el selector del sistema (cualquier color) y colores de cada nivel
$('#progBody').addEventListener('change', e => {
  const el = e.target, row = el.closest('[data-pc]'); if (!row) return;
  const P = progPrefs(), id = row.dataset.pc;
  if (el.dataset.plev !== undefined) { const l = levelCols(P, id); l[+el.dataset.plev] = el.value; P.levels = { ...P.levels, [id]: l }; }
  else if (el.hasAttribute('data-pcol-x')) P.color = { ...P.color, [id]: el.value };
  else if (el.hasAttribute('data-acol-x')) { const k = el.closest('[data-ak]').dataset.ak; P.areaColor = { ...P.areaColor, [k]: el.value }; }
  else return;
  const open = !!$('#progBody .arow-cols')?.open; saveProg(P); if (open) $('#progBody .arow-cols').open = true;
});
$('#progBody').addEventListener('pointerdown', e => {
  const g = e.target.closest('[data-pgrip]'); if (!g) return;
  e.preventDefault(); progDrag = { id: g.closest('[data-pc]').dataset.pc };
  g.closest('.prow').classList.add('dragging');
  try { $('#progBody').setPointerCapture(e.pointerId); } catch {}
});
$('#progBody').addEventListener('pointermove', e => {
  if (!progDrag) return; e.preventDefault();
  const rows = [...$('#progBody').querySelectorAll('.prow')], me = rows.find(r => r.dataset.pc === progDrag.id);
  const j = rows.filter(r => r !== me && e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2).length, i = rows.indexOf(me);
  if (j !== i) { const ids = rows.map(r => r.dataset.pc); ids.splice(i, 1); ids.splice(j, 0, progDrag.id); const box = $('#progBody .plist'); ids.forEach(id => box.append(rows.find(r => r.dataset.pc === id))); }
});
const endProgDrag = () => { if (!progDrag) return; progDrag = null; const P = progPrefs(); P.order = [...$('#progBody').querySelectorAll('.prow')].map(r => r.dataset.pc); saveProg(P); };
$('#progBody').addEventListener('pointerup', endProgDrag);
$('#progBody').addEventListener('pointercancel', endProgDrag);
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
    ['Días con tu objetivo', d => pointsOn(d) >= (stats.goal || 100)],
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
  const alive = list.filter(p => p.ok).length;
  return `<section class="summary"><div class="rato-head"><h2>Tu jardín</h2><span class="hint">este mes · ${alive} 🌱${list.length - alive ? ` · ${list.length - alive} 🥀` : ''}</span></div>
    <div class="garden">${list.length ? list.map(p => `<span title="${esc(p.t)} · ${p.min} min">${plantEmoji(p)}</span>`).join('') : '<p class="hint">Este mes aún no has plantado nada. Toca una tarea y pulsa ⏱ Concentrarme: cada sesión planta algo aquí.</p>'}</div>
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
        if (!t) { t = { id, cat: exam ? 'estudio' : 'evento', prio: exam ? 'alta' : 'normal', flag: !!exam, notes: '', loc: ev.location || '', done: false, created: Date.now(), ...data }; tasks.push(t); }
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

// ---------- Libros y películas: lo que quiero leer o ver, lo que estoy leyendo y lo terminado ----------
// Por defecto, orden alfabético por título; se busca y se filtra por autor (o dirección), categoría y páginas (o año)
const sortKey = v => (v || '').replace(/^[^\p{L}\p{N}]+/u, '');
const bcmp = (x, z) => sortKey(x).localeCompare(sortKey(z), 'es', { sensitivity: 'base', numeric: true });
const STAR = n => '★'.repeat(n) + '☆'.repeat(5 - n);
function saveItem(kind, b) {
  const l = shelf[kind].items, i = l.findIndex(x => x.id === b.id); if (i >= 0) l[i] = b; else l.push(b);
  store.putItem(kind, b).catch(writeFailed);
}
function numOK(kind, b, f) {
  if (!f) return true;
  if (kind === 'books') return f === 'x' ? !b.pages : !b.pages ? false : f === 's' ? b.pages < 200 : f === 'm' ? b.pages <= 400 : b.pages > 400;
  if (f === 'x') return !b.year; if (!b.year) return false;
  return f === 'old' ? b.year < 1970 : f === '2020' ? b.year >= 2020 : b.year >= +f && b.year < +f + 10;
}
function itemMatch(kind, b) {
  const F = shelf[kind].f, q = fold(F.q.trim());
  return (!q || fold(`${b.title} ${b.author} ${b.genre} ${b.notes} ${b.year || ''}`).includes(q))
    && (!F.author || b.author === F.author) && (!F.genre || b.genre === F.genre) && numOK(kind, b, F.num);
}
function itemSort(kind, list) {
  const s = shelf[kind].f.sort, k = SHELF[kind].num;
  return list.sort((x, z) => s === 'author' ? bcmp(x.author || '￿', z.author || '￿') || bcmp(x.title, z.title)
    : s === 'num' ? (x[k] || 1e9) - (z[k] || 1e9) || bcmp(x.title, z.title)
    : s === 'recent' ? z.order - x.order : bcmp(x.title, z.title));
}
const itemSub = (kind, b) => [b.author, b.genre, kind === 'books' && b.year ? b.year : '', b[SHELF[kind].num] ? `${b[SHELF[kind].num]}${SHELF[kind].unit ? ' ' + SHELF[kind].unit : ''}` : ''].filter(Boolean).join(' · ');
function itemEditHTML(kind, b) {
  const C = SHELF[kind];
  return `<div class="editbox" data-bid="${b.id}">
    <input class="inp" type="text" data-bf="title" value="${esc(b.title)}" placeholder="Título" aria-label="Título">
    <div class="grid2"><input class="inp" type="text" data-bf="author" value="${esc(b.author)}" placeholder="${C.whoPh}" aria-label="${C.who}" list="${kind}Who"><input class="inp" type="number" inputmode="numeric" data-bf="${C.num}" value="${b[C.num] || ''}" placeholder="${C.numPh}" aria-label="${C.numLabel}"></div>
    <div class="${kind === 'books' ? 'grid2' : ''}"><input class="inp" type="text" data-bf="genre" value="${esc(b.genre)}" placeholder="${C.genrePh}" aria-label="Categoría" list="${kind}Genres">${kind === 'books' ? `<input class="inp" type="number" inputmode="numeric" data-bf="year" value="${b.year || ''}" placeholder="Año" aria-label="Año">` : ''}</div>
    <button type="button" class="btn ghost small" data-bact="lookup">✨ Buscar los datos que faltan</button>
    <div class="chips">${C.editSt.map(([v, l]) => `<button type="button" class="chip ${b.status === v ? 'on' : ''}" data-bact="status" data-v="${v}">${l}</button>`).join('')}</div>
    ${b.status === 'read' ? `<div class="stars" aria-label="Valoración">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${(b.rating || 0) >= n ? 'on' : ''}" data-bact="rate" data-v="${n}" aria-label="${n} estrellas">★</button>`).join('')}</div>` : ''}
    <textarea class="inp" data-bf="notes" placeholder="Notas, citas, quién te lo recomendó…" aria-label="Notas">${esc(b.notes)}</textarea>
    ${linksHTML([], { k: kind, id: b.id }).replace(/data-unlink[^>]*>✕<\/button>/g, '>')}
    <div class="grid2"><button type="button" class="btn danger small" data-bact="del">Borrar</button><button type="button" class="btn primary small" data-bact="close">Listo</button></div></div>`;
}
function renderShelf(kind) {
  const C = SHELF[kind], S = shelf[kind], F = S.f, items = S.items;
  if (!S.tab || !C.st[S.tab]) S.tab = 'want';
  const uniq = k => [...new Set(items.map(b => b[k]).filter(Boolean))].sort(bcmp);
  const authors = uniq('author'), genres = uniq('genre');
  if (F.author && !authors.includes(F.author)) F.author = '';
  if (F.genre && !genres.includes(F.genre)) F.genre = '';
  const sel = (k, label, opts) => `<label class="field"><span class="label">${label}</span><select class="inp" data-bfil="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${F[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const active = ['author', 'genre', 'num'].filter(k => F[k]).length;
  const missing = items.filter(b => needsLookup(kind, b)).length;
  const tabs = Object.entries(C.st).map(([st, label]) => `<button type="button" class="seg ${S.tab === st ? 'on' : ''}" data-bact="tab" data-v="${st}">${label}<span>${items.filter(b => b.status === st).length}</span></button>`).join('');
  $(C.body).innerHTML = `${S.adding ? `<form class="box-card" data-shelfadd autocomplete="off">
      <input class="inp" type="text" data-add="title" placeholder="${C.add}" aria-label="Título" maxlength="200">
      <div class="grid2"><input class="inp" type="text" data-add="author" placeholder="${C.whoPh} (opcional)" aria-label="${C.who}" list="${kind}Who"><input class="inp" type="number" inputmode="numeric" data-add="${C.num}" placeholder="${C.numPh} (opcional)" aria-label="${C.numLabel}"></div>
      <input class="inp" type="text" data-add="genre" placeholder="Categoría (opcional)" aria-label="Categoría" list="${kind}Genres">
      <div class="chips">${C.addSt.map(([v, l]) => `<button type="button" class="chip ${S.addSt === v ? 'on' : ''}" data-bact="addst" data-v="${v}">${l}</button>`).join('')}</div>
      <p class="hint">Lo que dejes vacío (${C.who.toLowerCase()}, año y categoría) lo busco yo.</p>
      <div class="grid2"><button class="btn" type="button" data-bact="canceladd">Cancelar</button><button class="btn primary" type="submit">Añadir</button></div></form>` : ''}
    <datalist id="${kind}Who">${authors.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="${kind}Genres">${genres.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="segs">${tabs}</div>
    ${items.length && S.tab !== 'reading' ? `<div class="segs mini shelfview"><button type="button" class="seg ${shelfView(kind) === 'list' ? 'on' : ''}" data-bact="view" data-v="list">☰ Lista</button><button type="button" class="seg ${shelfView(kind) === 'covers' ? 'on' : ''}" data-bact="view" data-v="covers">▦ Portadas</button></div>` : ''}
    ${items.length && shelfView(kind) === 'covers' && items.some(needsCover) ? `<button type="button" class="btn ghost small" data-bact="fillcovers" ${lookupRun[kind] ? 'disabled' : ''}>${lookupRun[kind] ? `🖼 Buscando… ${lookupRun[kind]}` : `🖼 Buscar las portadas que faltan (${items.filter(needsCover).length})`}</button>` : ''}
    ${items.length ? `<div class="bfilter">
      <input class="inp" type="search" data-search value="${esc(F.q)}" placeholder="🔍 Buscar por título, ${C.who.toLowerCase()} o categoría" aria-label="Buscar">
      <details class="box-card"${active ? ' open' : ''}><summary>Filtros y orden${active ? ` · ${active}` : ''}</summary>
        <div class="grid2">${sel('author', C.who, [['', 'Todos'], ...authors.map(x => [x, x])])}${sel('genre', 'Categoría', [['', 'Todas'], ...genres.map(x => [x, x])])}</div>
        <div class="grid2">${sel('num', C.numLabel, Object.entries(C.numF))}${sel('sort', 'Ordenar por', [['title', 'Título (A–Z)'], ['author', C.who], ['num', C.numLabel], ['recent', 'Añadidos hace poco']])}</div>
        ${active ? '<button type="button" class="btn ghost small" data-bact="clearf">Quitar filtros</button>' : ''}
      </details>
      ${missing ? `<button type="button" class="btn ghost small" data-bact="fillall" ${lookupRun[kind] ? 'disabled' : ''}>${lookupRun[kind] ? `✨ Buscando… ${lookupRun[kind]}` : `✨ Completar los datos que faltan (${missing})`}</button>` : ''}</div>` : ''}
    <div class="shelflists"></div>
    <button type="button" class="shelffab" data-bact="fab" aria-label="${C.add}">+</button>`;
  renderShelfLists(kind);
  if (S.adding) $(C.body).querySelector('[data-add=title]')?.focus();
}
function renderShelfLists(kind) {
  const C = SHELF[kind], S = shelf[kind], F = S.f, y = todayISO().slice(0, 4);
  const filtering = F.q.trim() || F.author || F.genre || F.num;
  const list = itemSort(kind, S.items.filter(b => b.status === S.tab && itemMatch(kind, b)));
  const box = $(C.body).querySelector('.shelflists');
  if (!list.length) { box.innerHTML = `<p class="hint">${filtering ? 'Nada coincide con la búsqueda.' : S.tab === 'want' ? C.emptyWant : S.tab === 'reading' ? 'Nada ahora mismo. Empieza uno de “Quiero leer”.' : 'Todavía nada. Cuando termines uno, aparecerá aquí.'}</p>`; return; }
  let h = '';
  if (S.tab !== 'reading' && shelfView(kind) === 'covers') {
    const ob = S.open ? S.items.find(b => b.id === S.open) : null;
    box.innerHTML = (ob ? `<div class="covedit">${itemEditHTML(kind, ob)}</div>` : '') + `<div class="covers">${list.map(b => `<button type="button" class="cov${S.open === b.id ? ' on' : ''}" data-bid="${b.id}" data-bact="edit">${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span class="cph">${esc(b.title)}</span><b>${esc(b.title)}</b><small>${esc(b.author || '')}${b.rating ? ' · ' + '★'.repeat(b.rating) : ''}</small></button>`).join('')}</div>`;
    return;
  }
  if (S.tab === 'reading') h = `<div class="books">${list.map(b => {
    const pct = b.pages ? Math.round(b.page / b.pages * 100) : null;
    return `<div class="book reading" data-bid="${b.id}">
      <div class="bhead"><span><b>${esc(b.title)}</b><small>${esc(itemSub(kind, b))}${b.started ? ` · desde ${friendlyDate(b.started).toLowerCase()}` : ''}</small></span><button type="button" class="iconbtn" data-bact="edit" aria-label="Editar ${esc(b.title)}">${PENCIL}</button></div>
      ${b.pages ? `<div class="bbar"><i style="width:${pct}%"></i></div>` : ''}
      <div class="bpage"><span>Página</span><input class="inp" type="number" inputmode="numeric" data-bf="page" value="${b.page || ''}" placeholder="0" aria-label="Página por la que vas"><span>${b.pages ? `de ${b.pages} · ${pct}%` : ''}</span><button type="button" class="btn small" data-bact="plus">+10</button></div>
      <button type="button" class="btn primary small" data-bact="finish">✓ Lo he terminado</button>
      ${S.open === b.id ? itemEditHTML(kind, b) : ''}</div>`;
  }).join('')}</div>`;
  else if (S.tab === 'want') {
    const btn = kind === 'books' ? '<button type="button" class="btn small" data-bact="start">Empezar</button>' : '<button type="button" class="btn small" data-bact="finish">✓ Vista</button>';
    h = `<div class="books">${list.map(b => `<div data-bid="${b.id}"><div class="brow"><span data-bact="edit"><b>${esc(b.title)}</b><small>${esc(itemSub(kind, b)) || '&nbsp;'}</small></span>${btn}</div>${S.open === b.id ? itemEditHTML(kind, b) : ''}</div>`).join('')}</div>`;
  } else {
    const thisYear = S.items.filter(b => b.status === 'read' && (b.finished || '').startsWith(y)).length;
    h = `${thisYear && !filtering ? `<p class="hint">${thisYear} en ${y}</p>` : ''}<div class="books">${list.map(b => `<div data-bid="${b.id}"><div class="brow"><span data-bact="edit"><b>${esc(b.title)}</b><small>${esc(itemSub(kind, b))}${b.finished ? `${itemSub(kind, b) ? ' · ' : ''}${parseISO(b.finished).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}` : ''}</small></span>${b.rating ? `<span class="stars ro" aria-label="${b.rating} de 5">${STAR(b.rating)}</span>` : '<span></span>'}</div>${S.open === b.id ? itemEditHTML(kind, b) : ''}</div>`).join('')}</div>`;
  }
  box.innerHTML = h;
}
// --- Buscar los datos que faltan: libros en Open Library y películas en Wikidata (solo se envía el título) ---
const BOOK_G = [[/science fiction|ciencia ficci|dystopi/i, 'Ciencia ficción'], [/classic|cl[aá]sic|nobel|literatura (espa|latino|rusa|francesa)|spanish literature|colombian|russian literature/i, 'Clásicos'], [/fantasy fiction|epic fantasy|romance fiction|love stor|romantasy/i, 'Fantasía y romance'], [/poetry|poes|poemas/i, 'Poesía'],
  [/\bplays?\b|teatro|drama \(/i, 'Teatro'], [/mytholog|mitolog/i, 'Mitología'], [/autobiograph|biograph|memoir|biograf/i, 'Biografías y autobiografías'],
  [/invest|finance|financ|money|dinero|wealth|stock|bolsa/i, 'Inversión y finanzas'], [/business|management|leadership|negocio|liderazgo|sales|selling|negotiat|marketing/i, 'Negocios y liderazgo'],
  [/psycholog|psicolog/i, 'Psicología'], [/self-help|self help|success|personal development|autoayuda|motivation|habit|superaci/i, 'Desarrollo personal'],
  [/philosoph|filosof|stoic/i, 'Filosofía'], [/spiritual|religio|meditat|espiritual|mystic|esoter/i, 'Espiritualidad'], [/mathemat|matem/i, 'Matemáticas'],
  [/physics|astronom|science|cosmolog|biolog|ciencia|f[ií]sica/i, 'Ciencia'], [/history|histor/i, 'Historia'], [/politic|pol[ií]tica|sociolog/i, 'Política y sociedad'],
  [/health|nutrition|fitness|diet|salud|bodybuild/i, 'Salud y deporte'], [/fiction|novel|ficci/i, 'Novela']];
const MOVIE_G = [[/animaci|animat|anime/i, 'Animación'], [/ciencia ficci|science fiction/i, 'Ciencia ficción'], [/terror|horror/i, 'Terror'], [/b[eé]lic|war film|guerra/i, 'Bélica'],
  [/musical/i, 'Musical'], [/comedia rom|romantic comedy/i, 'Comedia romántica'], [/rom[aá]ntic|romance/i, 'Romance'], [/thriller|suspense|suspens/i, 'Thriller'],
  [/crim|gangster|g[aá]ngster|mafia|polic/i, 'Crimen'], [/hist[oó]ric|biogr|biopic|[eé]poca/i, 'Histórica'], [/fantas/i, 'Fantasía'], [/aventura|adventure/i, 'Aventuras'],
  [/acci[oó]n|action|superh/i, 'Acción'], [/comedia|comedy/i, 'Comedia'], [/drama/i, 'Drama']];
const pickGenre = (map, texts) => { const all = texts.join(' | '); for (const [rx, g] of map) if (rx.test(all)) return g; return ''; };
const needsLookup = (kind, b) => !b.looked && (!b.author || !b.year || !b.genre || (kind === 'books' && !b.pages));
const lookupRun = {};
async function findBook(b) {
  const q = new URLSearchParams({ q: `${b.title} ${b.author || ''}`.trim(), fields: 'title,author_name,first_publish_year,subject,number_of_pages_median,cover_i', limit: '5' });
  const r = await fetch('https://openlibrary.org/search.json?' + q); if (!r.ok) throw new Error('openlibrary ' + r.status);
  const docs = (await r.json()).docs || [], d = docs.find(x => x.author_name?.length) || docs[0]; if (!d) return {};
  const cv = (d.cover_i ? d : docs.find(x => x.cover_i))?.cover_i;
  return { author: d.author_name?.[0] || '', year: d.first_publish_year || null, pages: d.number_of_pages_median || null, genre: pickGenre(BOOK_G, d.subject || []), cover: cv ? `https://covers.openlibrary.org/b/id/${cv}-M.jpg` : '' };
}
async function wdApi(p) { const r = await fetch('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...p })); if (!r.ok) throw new Error('wikidata ' + r.status); return r.json(); }
async function findMovie(b) {
  const s = await wdApi({ action: 'wbsearchentities', search: b.title.replace(/\s*\(saga\)\s*$/i, ''), language: 'es', uselang: 'es', type: 'item', limit: '8' });
  const hit = (s.search || []).find(x => /pel[ií]cula|film/i.test(x.description || '')); if (!hit) return {};
  const ent = (await wdApi({ action: 'wbgetentities', ids: hit.id, props: 'claims|sitelinks' })).entities[hit.id], e = ent.claims || {};
  const ids = k => (e[k] || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const years = (e.P577 || []).map(c => parseInt(String(c.mainsnak?.datavalue?.value?.time || '').slice(1, 5))).filter(Boolean);
  const dir = ids('P57').slice(0, 2), gen = ids('P136').slice(0, 8), want = [...dir, ...gen];
  const lab = want.length ? (await wdApi({ action: 'wbgetentities', ids: want.join('|'), props: 'labels', languages: 'es|mul|en' })).entities : {};
  const L = id => lab[id]?.labels?.es?.value || lab[id]?.labels?.mul?.value || lab[id]?.labels?.en?.value || '';
  let cover = '';
  for (const lang of ['en', 'es']) { const t = ent.sitelinks?.[lang + 'wiki']?.title; if (t && !cover) cover = await wikiThumb(t, lang).catch(() => ''); }
  return { author: dir.map(L).filter(Boolean).join(' y '), year: years.length ? Math.min(...years) : null, genre: pickGenre(MOVIE_G, gen.map(L)), cover };
}
async function wikiThumb(title, lang) {
  const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({ action: 'query', titles: title, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '320', pilicense: 'any', format: 'json', origin: '*' }));
  if (!r.ok) return '';
  const p = Object.values((await r.json()).query?.pages || {})[0];
  return /^https:\/\/upload\.wikimedia\.org\//.test(p?.thumbnail?.source || '') ? p.thumbnail.source : '';
}
// Portadas que faltan (para lo que ya tenías apuntado)
const needsCover = b => !b.cover && !b.cl;
async function fillCovers(kind) {
  if (lookupRun[kind]) return;
  const list = shelf[kind].items.filter(needsCover); let n = 0, got = 0, fails = 0;
  for (const b of list) {
    lookupRun[kind] = `${++n}/${list.length}`; if (!$(SHELF[kind].sheet).hidden) renderShelf(kind);
    try { const f = await (kind === 'books' ? findBook(b) : findMovie(b)), cur = shelf[kind].items.find(x => x.id === b.id) || b; if (f.cover) got++; saveItem(kind, { ...cur, cover: cur.cover || f.cover || '', cl: true }); }
    catch (e) { fails++; logError(e.message, 'portadas'); if (fails > 4) break; }
    await new Promise(r => setTimeout(r, 300));
  }
  lookupRun[kind] = ''; if (!$(SHELF[kind].sheet).hidden) renderShelf(kind);
  showToast(fails > 4 ? 'No se pudo buscar ahora (¿sin conexión?). Prueba más tarde.' : `Portadas encontradas: ${got} de ${n}`);
}
// Rellena solo lo que está vacío; devuelve qué ha completado
async function lookupItem(kind, b) {
  const found = await (kind === 'books' ? findBook(b) : findMovie(b));
  const cur = shelf[kind].items.find(x => x.id === b.id) || b, upd = { ...cur, looked: true }, got = [];
  if (!cur.author && found.author) { upd.author = found.author; got.push(SHELF[kind].who.toLowerCase()); }
  if (!cur.year && found.year) { upd.year = found.year; got.push('año'); }
  if (!cur.genre && found.genre) { upd.genre = found.genre; got.push('categoría'); }
  if (kind === 'books' && !cur.pages && found.pages) { upd.pages = found.pages; got.push('páginas'); }
  if (!cur.cover && found.cover) { upd.cover = found.cover; got.push('portada'); }
  upd.cl = true;
  saveItem(kind, upd);
  return got;
}
async function fillAll(kind) {
  if (lookupRun[kind]) return;
  const list = shelf[kind].items.filter(b => needsLookup(kind, b)); let n = 0, fails = 0;
  for (const b of list) {
    lookupRun[kind] = `${++n}/${list.length}`; if (!$(SHELF[kind].sheet).hidden) renderShelf(kind);
    try { await lookupItem(kind, b); } catch (e) { fails++; logError(e.message, 'buscar datos'); if (fails > 4) break; }
    await new Promise(r => setTimeout(r, 350));
  }
  lookupRun[kind] = ''; if (!$(SHELF[kind].sheet).hidden) renderShelf(kind);
  showToast(fails > 4 ? 'No se pudo buscar ahora (¿sin conexión?). Prueba más tarde.' : `Datos buscados para ${n} ${kind === 'books' ? 'libros' : 'películas'}`);
}
for (const kind in SHELF) {
  const body = $(SHELF[kind].body), S = shelf[kind];
  body.addEventListener('input', e => { if (e.target.matches('[data-search]')) { S.f.q = e.target.value; renderShelfLists(kind); } });
  body.addEventListener('change', e => {
    const k = e.target.dataset.bfil; if (k) { S.f[k] = e.target.value; renderShelf(kind); return; }
    const f = e.target.dataset.bf; if (!f) return;
    const b = S.items.find(x => x.id === e.target.closest('[data-bid]')?.dataset.bid); if (!b) return;
    const v = e.target.value.trim();
    if (f === 'title' && !v) { e.target.value = b.title; return; }
    saveItem(kind, { ...b, [f]: ['pages', 'page', 'year'].includes(f) ? Number(v) || 0 : v });
    if (['page', 'pages', 'year', 'author', 'genre', 'title'].includes(f)) renderShelf(kind);
  });
  body.addEventListener('click', e => {
    const el = e.target.closest('[data-bact]'); if (!el) return;
    const act = el.dataset.bact;
    if (act === 'clearf') { S.f = { ...S.f, author: '', genre: '', num: '' }; renderShelf(kind); return; }
    if (act === 'tab') { S.tab = el.dataset.v; S.open = null; renderShelf(kind); return; }
    if (act === 'fab') { S.adding = true; S.addSt = S.tab; renderShelf(kind); $(SHELF[kind].sheet).scrollTop = 0; return; }
    if (act === 'canceladd') { S.adding = false; renderShelf(kind); return; }
    if (act === 'fillall') { fillAll(kind); return; }
    if (act === 'fillcovers') { fillCovers(kind); return; }
    if (act === 'view') { lsSet('shelf-view-' + kind, el.dataset.v); S.open = null; renderShelf(kind); return; }
    if (act === 'addst') { S.addSt = el.dataset.v; body.querySelectorAll('[data-bact=addst]').forEach(c => c.classList.toggle('on', c === el)); return; }
    const b = S.items.find(x => x.id === el.closest('[data-bid]')?.dataset.bid); if (!b) return;
    const today = todayISO();
    if (act === 'edit') { S.open = S.open === b.id ? null : b.id; if (S.open && shelfView(kind) === 'covers') setTimeout(() => $(SHELF[kind].body).querySelector('.covedit')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30); }
    else if (act === 'close') S.open = null;
    else if (act === 'lookup') { el.disabled = true; el.textContent = '✨ Buscando…'; lookupItem(kind, { ...b, looked: false }).then(got => { showToast(got.length ? `Completado: ${got.join(', ')}` : 'No he encontrado más datos'); renderShelf(kind); }).catch(() => { showToast('No se pudo buscar ahora. Prueba más tarde.'); renderShelf(kind); }); return; }
    else if (act === 'start') { saveItem(kind, { ...b, status: 'reading', started: today }); showToast(`📖 Empiezas “${b.title}”`); }
    else if (act === 'plus') saveItem(kind, { ...b, page: b.pages ? Math.min(b.pages, (b.page || 0) + 10) : (b.page || 0) + 10 });
    else if (act === 'finish') { saveItem(kind, { ...b, status: 'read', finished: today, ...(kind === 'books' ? { page: b.pages || b.page } : {}) }); S.open = b.id; showToast(kind === 'books' ? '🎉 ¡Terminado! Ponle nota si quieres' : '🍿 ¡Vista! Ponle nota si quieres'); }
    else if (act === 'status') { const st = el.dataset.v; saveItem(kind, { ...b, status: st, started: st !== 'want' ? (b.started || today) : b.started, finished: st === 'read' ? (b.finished || today) : '' }); }
    else if (act === 'rate') saveItem(kind, { ...b, rating: b.rating === Number(el.dataset.v) ? null : Number(el.dataset.v) });
    else if (act === 'del') { S.items = S.items.filter(x => x.id !== b.id); store.removeItem(kind, b.id).catch(writeFailed); S.open = null; showToast(`Borrado “${b.title}”`, () => { saveItem(kind, b); renderShelf(kind); }); }
    renderShelf(kind);
  });
  body.addEventListener('submit', e => {
    if (!e.target.matches('[data-shelfadd]')) return;
    e.preventDefault();
    const val = k => e.target.querySelector(`[data-add=${k}]`)?.value.trim() || '';
    const title = val('title'); if (!title) { e.target.querySelector('[data-add=title]').focus(); return; }
    const today = todayISO(), st = S.addSt, C = SHELF[kind];
    const item = { id: kind[0] + uid(), ...cleanItem(kind, { title, author: val('author'), genre: val('genre'), [C.num]: val(C.num), status: st, started: st !== 'want' ? today : '', finished: st === 'read' ? today : '', order: Date.now() }) };
    saveItem(kind, item);
    S.adding = false; S.tab = st; renderShelf(kind);
    // Lo que no has rellenado lo busco
    if (needsLookup(kind, item)) lookupItem(kind, item).then(got => { if (got.length) showToast(`“${title}”: completado ${got.join(', ')}`); if (!$(C.sheet).hidden) renderShelf(kind); }).catch(() => {});
  });
}

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
// ---------- Calendario: día, varios días, mes, año y lista (como un calendario de verdad) ----------
let calMode = (() => { try { return localStorage.getItem('cal-mode') || (innerWidth >= 820 ? 'semana' : 'mes'); } catch { return 'mes'; } })();
const CAL_MODES = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['ano', 'Año'], ['lista', 'Lista']];
const lsNum = (k, d) => { try { const v = Number(localStorage.getItem(k)); return v > 0 ? v : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// Cuántos días se ven (pellizcando a lo ancho) y lo que mide cada hora (pellizcando a lo alto)
let calN = Math.min(7, Math.max(2, lsNum('cal-n', innerWidth >= 820 ? 7 : 3))), calPX = Math.min(160, Math.max(24, lsNum('cal-px', 56)));
let listDays = 30;
const calDate = () => calSel || (monthOffset ? monthDate(todayISO(), monthOffset, 1) : todayISO());
const calPrefs = () => ({ weekNums: true, noWeekend: false, ...(extra.prefs?.cal || {}) });
const isWE = d => [0, 6].includes(parseISO(d).getDay());
function gridDays() {
  if (calMode === 'dia') return [calDate()];
  if (calN >= 7) { const mon = mondayOf(calDate()), w = [...Array(7)].map((_, i) => addDays(mon, i)); return calPrefs().noWeekend ? w.filter(d => !isWE(d)) : w; }
  return [...Array(calN)].map((_, i) => addDays(calDate(), i));
}
const ageOn = (t, d) => t.born && d ? Number(d.slice(0, 4)) - t.born : null;
// Lo de un día: tareas (sin las grandes con partes), repeticiones futuras y rutinas
function calDayItems(byCat, d) {
  const today = todayISO(), gh = ghostsIn(byCat, d, d)[d] || [];
  const list = [...tasks.filter(t => byCat(t) && t.date === d && !children(t.id).length), ...gh.map(t => ({ ...t, ghost: true }))];
  const timed = [], allDay = [];
  list.forEach(t => {
    const par = t.parentId ? tasks.find(p => p.id === t.parentId) : null, age = ageOn(t, d);
    const it = { id: t.id, title: (t.cat === 'cumple' ? '🎂 ' : '') + (par ? par.title : t.title) + (age ? ` (${age})` : ''), sub: par ? t.title : '', color: colorVar(catOf(t.cat).color), done: !!t.done && !t.ghost, ghost: !!t.ghost, loc: t.loc || '', flag: !!t.flag };
    if (!t.time) { allDay.push(it); return; }
    const s = toMin(t.time); let e = t.endTime ? toMin(t.endTime) : s + 60; if (e <= s) e += 1440;
    timed.push({ ...it, s, e });
  });
  habits.filter(h => h.kind === 'routine' && applies(h, d) && h.steps.length).forEach(h => {
    const s = toMin(h.steps[0].time), last = toMin(h.steps[h.steps.length - 1].time);
    timed.push({ id: h.id, routine: true, title: h.name, sub: '', color: 'var(--accent)', s, e: Math.max(s + 30, last + 30), done: d === today && stepsToday(h).length === h.steps.length });
  });
  return { timed: timed.sort((a, b) => a.s - b.s || a.e - b.e), allDay };
}
const laneIt = items => { const lanes = []; items.forEach(i => { let l = lanes.findIndex(end => end <= i.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = i.e; i.lane = l; }); return Math.max(1, lanes.length); };
const calBlock = (i, top, nl, compact) => { const drag = !i.ghost && !i.routine;
  return `<button class="cblk${i.done ? ' done' : ''}${i.ghost ? ' ghost' : ''}" style="top:${top(i.s)}px;height:${Math.max(18, (i.e - i.s) / 60 * calPX - 2)}px;left:calc(100% * ${i.lane / nl});width:calc(100% / ${nl} - 2px);--c:${i.color}" data-act="${i.routine ? 'rdetails' : 'details'}" data-id="${i.id}"${drag ? ` data-cdrag="${i.id}" data-s="${i.s}" data-e="${i.e}"` : ''}>
  ${drag ? '<i class="cres t" data-ch="t"></i>' : ''}<b>${i.flag ? '🚩 ' : ''}${esc(i.title)}</b>${!compact && i.sub ? `<small>${esc(i.sub)}</small>` : ''}<small class="ctime">${hhmm(i.s)}${!compact && i.loc ? ' · 📍 ' + esc(i.loc) : ''}</small>${drag ? '<i class="cres b" data-ch="b"></i>' : ''}</button>`; };
const wxTxt = (w, short) => w ? `<small class="wx" title="${w.max}° / ${w.min}°">${w.i}${short ? '' : ` ${w.max}°<span>/${w.min}°</span>`}</small>` : '';
// Lista de lo que viene: día a día, sin rutinas
function listCalHTML(byCat) {
  const today = todayISO(); let html = '', n = 0;
  for (let k = 0; k < listDays; k++) {
    const d = addDays(today, k), x = calDayItems(byCat, d), items = [...x.allDay.map(i => ({ ...i, s: -1 })), ...x.timed.filter(i => !i.routine)];
    if (!items.length) continue; n += items.length;
    const lbl = k === 0 ? 'Hoy' : k === 1 ? 'Mañana' : cap(parseISO(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
    html += `<h2 class="group lday"><button type="button" data-act="calgo" data-d="${d}">${lbl}${wxTxt(wxOf(d))}</button><span>${items.length}</span></h2><div class="clist">${items.map(i => `<button class="crow${i.done ? ' done' : ''}${i.ghost ? ' ghost' : ''}" style="--c:${i.color}" data-act="details" data-id="${i.id}"><span class="cwhen">${i.s < 0 ? 'todo el día' : `${hhmm(i.s)}<br><small>${hhmm(i.e % 1440)}</small>`}</span><span class="cwhat"><b>${i.flag ? '🚩 ' : ''}${esc(i.title)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}${i.loc ? `<small>📍 ${esc(i.loc)}</small>` : ''}</span>${i.ghost ? '<small class="crep">↻</small>' : ''}</button>`).join('')}</div>`;
  }
  if (!n) html = `<p class="empty">No tienes nada apuntado en los próximos ${listDays} días.</p>`;
  return html + `<button class="btn ghost block" data-act="calmore" style="margin-top:10px">Ver ${listDays + 30 > 365 ? 'más' : '30 días más'}</button>`;
}
// Rejilla de horas (arriba lo que tiene hora; debajo, lo que no)
function calGridHTML(byCat, days) {
  const today = todayISO(), now = toMin(nowHM()), data = days.map(d => calDayItems(byCat, d)), all = data.flatMap(x => x.timed), PX = calPX;
  const startH = Math.min(7, ...all.map(i => Math.floor(i.s / 60))), endH = Math.min(24, Math.max(23, ...all.map(i => Math.ceil(i.e / 60))));
  const top = m => (m - startH * 60) / 60 * PX, H = (endH - startH) * PX, multi = days.length > 1, compact = days.length > 3;
  const head = multi ? `<div class="cg-head"><span></span>${days.map(d => { const x = parseISO(d); return `<button class="cg-day${d === today ? ' today' : ''}" data-act="calgo" data-d="${d}"><span>${DAY_LETTER[x.getDay()]}</span><b>${x.getDate()}</b>${wxTxt(wxOf(d), compact)}</button>`; }).join('')}</div>` : '';
  const allDay = `<div class="cg-all"><span class="cg-lbl">Sin hora</span>${data.map((x, k) => `<div class="cg-allcol" data-d="${days[k]}">${x.allDay.map(i => `<button class="cchip${i.done ? ' done' : ''}${i.ghost ? ' ghost' : ''}" style="--c:${i.color}" data-act="details" data-id="${i.id}"${i.ghost ? '' : ` data-cdrag="${i.id}" data-allday="1"`}>${i.flag ? '🚩 ' : ''}${esc(i.title)}${!multi && i.sub ? ` · <small>${esc(i.sub)}</small>` : ''}</button>`).join('')}</div>`).join('')}</div>`;
  let hours = ''; for (let h = startH; h <= endH; h++) hours += `<div class="tl2h" style="top:${(h - startH) * PX}px"><span>${pad(h % 24)}:00</span></div>`;
  const cols = days.map((d, k) => { const t = data[k].timed, nl = laneIt(t);
    return `<div class="cg-col${d === today ? ' today' : ''}" data-d="${d}" data-sh="${startH}">${d === today && now >= startH * 60 && now <= endH * 60 ? `<div class="tl2now" style="top:${top(now)}px;left:0"></div>` : ''}${t.map(i => calBlock(i, top, nl, compact)).join('')}</div>`; }).join('');
  return `<div class="cgrid${multi ? ' week' : ''}${compact ? ' compact' : ''}" style="--n:${days.length}">${head}<div class="cg-body" style="height:${H}px">${hours}<div class="cg-cols">${cols}</div></div>${allDay}</div>`;
}
function yearCalHTML(byCat) {
  const base = parseISO(calDate()), y = base.getFullYear(), today = todayISO(), from = `${y}-01-01`, to = `${y}-12-31`;
  const busy = new Set(tasks.filter(t => byCat(t) && t.date >= from && t.date <= to).map(t => t.date)); Object.keys(ghostsIn(byCat, from, to)).forEach(d => busy.add(d));
  return `<div class="ycal">${[...Array(12)].map((_, m) => { const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, n = dim(y, m);
    let cells = '<span></span>'.repeat(lead);
    for (let day = 1; day <= n; day++) { const d = `${y}-${pad(m + 1)}-${pad(day)}`; cells += `<button class="${d === today ? 'today' : ''}${busy.has(d) ? ' busy' : ''}" data-act="calgo" data-d="${d}">${day}</button>`; }
    return `<div class="ymonth"><button class="ymt" data-act="calmonth" data-d="${y}-${pad(m + 1)}-01">${cap(first.toLocaleDateString('es-ES', { month: 'long' }))}</button><div class="ygrid">${cells}</div></div>`; }).join('')}</div>`;
}
const gridLabel = () => calN >= 7 ? 'Semana' : `${calN} días`;
function calendarHTML(byCat) {
  const d = calDate(), x = parseISO(d), days = calMode === 'dia' || calMode === 'semana' ? gridDays() : [];
  const fmt = (v, o) => parseISO(v).toLocaleDateString('es-ES', o), wk = calPrefs().weekNums;
  const title = calMode === 'dia' ? `${cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${wxTxt(wxOf(d))}`
    : calMode === 'semana' ? `${fmt(days[0], { day: 'numeric', month: 'short' })} – ${fmt(days[days.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}${wk && calN >= 7 ? ` <small class="wkn">S${isoWeek(days[0])}</small>` : ''}`
    : calMode === 'ano' ? String(x.getFullYear()) : '';
  let html = `<div class="calbar"><div class="segs">${CAL_MODES.map(([m, l]) => `<button type="button" class="seg ${calMode === m ? 'on' : ''}" data-act="calmode" data-m="${m}">${m === 'semana' ? gridLabel() : l}</button>`).join('')}</div><button class="btn small" data-act="caltoday">Hoy</button></div>`;
  if (calMode === 'mes') return html + monthCalHTML(byCat);
  if (calMode === 'lista') return html + listCalHTML(byCat);
  html += `<div class="weeknav"><button class="iconbtn" data-act="calprev" aria-label="Anterior">‹</button><strong>${title}</strong><button class="iconbtn" data-act="calnext" aria-label="Siguiente">›</button></div>`;
  if (calMode === 'ano') return html + yearCalHTML(byCat);
  return html + calGridHTML(byCat, days) + `<p class="hint" style="text-align:center">Toca un hueco para apuntar algo, o mantén pulsado y arrastra para elegir las horas · mantén pulsada una tarea para moverla (o suéltala sin moverla para ver más opciones) · pellizca para ver más o menos ${calMode === 'dia' ? 'días' : 'días u horas'}</p>`;
}
function calNav(n) {
  const d = calDate();
  if (calMode === 'mes') { monthOffset += n; calSel = null; }
  else if (calMode === 'dia') calSel = addDays(d, n);
  else if (calMode === 'semana') calSel = addDays(d, (calN >= 7 ? 7 : calN) * n);
  else calSel = yearDate(d, n);
  if (calMode !== 'mes') syncMonth();
  render();
}
// El mes que se ve sigue al día elegido
function syncMonth() { const a = parseISO(calSel || todayISO()), t = parseISO(todayISO()); monthOffset = (a.getFullYear() - t.getFullYear()) * 12 + a.getMonth() - t.getMonth(); }
function setCalN(n) {
  const was = calMode === 'dia' ? 1 : calN;
  if (n === was) return false;
  if (n <= 1) calMode = 'dia'; else { calMode = 'semana'; calN = n; }
  lsSet('cal-mode', calMode); lsSet('cal-n', calN);
  return true;
}
// Zoom de las horas, dejando quieto lo que está bajo los dedos
function zoomHours(px, y) {
  px = Math.round(Math.min(160, Math.max(24, px))); if (px === calPX) return;
  const body = $('#list .cg-body'), yy = y ?? innerHeight / 2, off = body ? (yy - body.getBoundingClientRect().top) / calPX : 0;
  calPX = px; lsSet('cal-px', px); render();
  const nb = $('#list .cg-body'); if (nb) $('#scroller').scrollTop += nb.getBoundingClientRect().top + off * calPX - yy;
}
// Tocar un hueco del día o de la semana: nueva tarea a esa hora
$('#list').addEventListener('click', e => {
  if (suppressClick) return;
  const col = e.target.closest('.cg-col'); if (!col || e.target.closest('.cblk')) return;
  const r = col.getBoundingClientRect(), m = Math.floor((+col.dataset.sh * 60 + (e.clientY - r.top) / calPX * 60) / 30) * 30;
  openForm(null, { date: col.dataset.d, time: hhmm(Math.max(0, Math.min(1410, m))) });
});
// --- Mantener pulsado en la Agenda ---
// · Una tarea con hora: se mueve (de hora y de día; o abajo, a "Sin hora"). Sus bordes cambian lo que dura.
// · Una tarea sin hora: se arrastra a la rejilla para darle hora.
// · Un hueco: se arrastra para elegir de qué hora a qué hora es lo nuevo.
// · Si sueltas sin mover: menú con más opciones.
let cDrag = null, cPress = null, cMoved = false, cSel = null, pinch = null, pinchEnd = 0;
const CSNAP = 15;
const minAt = (col, y) => +col.dataset.sh * 60 + (y - col.getBoundingClientRect().top) / calPX * 60;
const snapM = m => Math.round(m / CSNAP) * CSNAP;
const colAt = (x, y) => [...document.querySelectorAll('#list .cg-col')].find(c => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right && (y === undefined || (y >= r.top && y <= r.bottom)); });
const allColAt = (x, y) => [...document.querySelectorAll('#list .cg-allcol')].find(c => { const r = c.closest('.cg-all').getBoundingClientRect(), rc = c.getBoundingClientRect(); return x >= rc.left - 1 && x < rc.right + 1 && y >= r.top && y <= r.bottom; });
function cBegin(p) {
  const el = p.blk || p.chip, t = tasks.find(x => x.id === el.dataset.cdrag); if (!t) return;
  navigator.vibrate?.(12); calSwipe = null;
  if (p.chip) {
    const r = el.getBoundingClientRect(), ghost = el.cloneNode(true);
    ghost.classList.add('cfloat'); ghost.style.cssText += `;left:${r.left}px;top:${r.top}px;width:${Math.max(120, r.width)}px`;
    document.body.append(ghost); el.classList.add('lifted');
    cDrag = { chip: el, ghost, t, mode: 'new', x0: p.x, y0: p.y, dx: p.x - r.left, dy: p.y - r.top, held: p.held };
    return;
  }
  const col = el.closest('.cg-col');
  cDrag = { el, t, mode: p.mode || 'm', x0: p.x, y0: p.y, s0: +el.dataset.s, e0: +el.dataset.e, col, d0: col.dataset.d, sh: +col.dataset.sh, held: p.held };
  el.classList.add('dragging'); el.style.left = '0'; el.style.width = 'calc(100% - 2px)';
}
function selBegin(p) {
  navigator.vibrate?.(12); calSwipe = null;
  const m0 = Math.max(0, Math.min(1425, Math.floor(minAt(p.col, p.y) / CSNAP) * CSNAP)), el = document.createElement('div');
  el.className = 'csel'; p.col.append(el);
  cSel = { col: p.col, m0, s: m0, e: Math.min(1440, m0 + 60), el, moved: false };
  selPaint();
}
function selPaint() { const c = cSel, sh = +c.col.dataset.sh; c.el.style.top = (c.s - sh * 60) / 60 * calPX + 'px'; c.el.style.height = (c.e - c.s) / 60 * calPX + 'px'; c.el.textContent = `${hhmm(c.s)}–${hhmm(c.e % 1440)}`; }
$('#list').addEventListener('pointerdown', e => {
  if (view !== 'semana' || e.button > 0 || pinch || !e.isPrimary) return;
  const blk = e.target.closest('.cblk[data-cdrag]'), chip = e.target.closest('.cchip[data-cdrag]'), col = !blk && !chip && e.target.closest('.cg-col');
  if (blk && e.target.dataset.ch) { e.preventDefault(); cBegin({ blk, mode: e.target.dataset.ch, x: e.clientX, y: e.clientY }); return; }
  if (!blk && !chip && !col) return;
  const p = { blk, chip, col, x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
  p.timer = setTimeout(() => { if (cPress !== p) return; cPress = null; p.held = true; col ? selBegin(p) : cBegin(p); }, HOLD_MS);
  cPress = p;
});
document.addEventListener('touchmove', e => { if (cDrag || cSel || pinch) e.preventDefault(); }, { passive: false });
document.addEventListener('pointermove', e => {
  if (cPress && Math.hypot(e.clientX - cPress.x, e.clientY - cPress.y) > 8) {
    const p = cPress; clearTimeout(p.timer); cPress = null;
    // Con ratón no hace falta mantener: arrastrar ya mueve o elige las horas
    if (p.mouse) p.col ? selBegin(p) : cBegin(p);
  }
  if (cSel) {
    e.preventDefault(); tlAutoScroll(e.clientY);
    const c = cSel, m = Math.max(0, Math.min(1440, snapM(minAt(c.col, e.clientY))));
    if (Math.abs(m - c.m0) >= CSNAP) c.moved = true;
    if (c.moved) { c.s = Math.min(c.m0, m); c.e = Math.max(c.m0 + CSNAP, m); }
    selPaint(); return;
  }
  const d = cDrag; if (!d) return;
  e.preventDefault(); tlAutoScroll(e.clientY);
  if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) d.moved = true;
  const all = $('#list .cg-all');
  if (d.mode === 'new') {
    d.ghost.style.left = e.clientX - d.dx + 'px'; d.ghost.style.top = e.clientY - d.dy + 'px';
    const c = colAt(e.clientX, e.clientY);
    document.querySelectorAll('#list .cg-col.drop').forEach(x => x !== c && x.classList.remove('drop')); c?.classList.add('drop');
    d.ghost.dataset.t = c ? hhmm(Math.max(0, Math.min(1380, snapM(minAt(c, e.clientY))))) : '';
    return;
  }
  const toAll = d.mode === 'm' ? allColAt(e.clientX, e.clientY) : null;
  all?.classList.toggle('drop', !!toAll); d.toAll = toAll || null;
  const dm = Math.round((e.clientY - d.y0) / calPX * 60 / CSNAP) * CSNAP, len = d.e0 - d.s0;
  let s = d.s0, en = d.e0;
  if (d.mode === 'm') {
    s = Math.max(0, Math.min(1440 - len, d.s0 + dm)); en = s + len;
    const c = colAt(e.clientX); if (c && c !== d.col) { c.append(d.el); d.col = c; }
  } else if (d.mode === 't') s = Math.max(0, Math.min(d.e0 - CSNAP, d.s0 + dm));
  else en = Math.min(1440, Math.max(d.s0 + CSNAP, d.e0 + dm));
  d.s = s; d.e = en;
  d.el.style.top = (s - d.sh * 60) / 60 * calPX + 'px';
  d.el.style.height = Math.max(18, (en - s) / 60 * calPX - 2) + 'px';
  d.el.classList.toggle('leaving', !!toAll);
  const tm = d.el.querySelector('.ctime'); if (tm) tm.textContent = toAll ? 'Sin hora' : `${hhmm(s)}–${hhmm(en % 1440)}`;
}, { passive: false });
const quiet = () => { cMoved = true; suppressClick = true; setTimeout(() => { cMoved = false; suppressClick = false; }, 90); };
function moveTaskTo(t, ch) {
  const prev = { date: t.date, time: t.time, endTime: t.endTime };
  Object.assign(t, ch); if (t.date) { t.inbox = false; t.someday = false; }
  store.put(t).catch(writeFailed);
  const dl = t.date !== prev.date ? ` · ${cap(parseISO(t.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }))}` : '';
  showToast(`${t.title}: ${t.time ? `${t.time}–${t.endTime}` : 'sin hora'}${dl}`, () => { const cur = tasks.find(x => x.id === t.id) || t; Object.assign(cur, prev); store.put(cur).catch(writeFailed); });
  render();
}
function cDrop(e, cancel) {
  if (cPress) { clearTimeout(cPress.timer); cPress = null; return; } // toque corto: detalles (o nueva tarea en un hueco)
  if (cSel) {
    const c = cSel; cSel = null; c.el.remove(); quiet();
    if (!cancel) openForm(null, { date: c.col.dataset.d, time: hhmm(c.s), end: hhmm(c.e % 1440 || 1439) });
    return;
  }
  const d = cDrag; if (!d) return; cDrag = null; quiet();
  $('#list .cg-all')?.classList.remove('drop');
  if (d.mode === 'new') {
    d.ghost.remove(); d.chip.classList.remove('lifted'); document.querySelectorAll('#list .cg-col.drop').forEach(x => x.classList.remove('drop'));
    if (cancel) return;
    if (!d.moved) { if (d.held) setTimeout(() => openCtx(d.t.id), 60); return; }
    const c = colAt(e.clientX, e.clientY), a = !c && allColAt(e.clientX, e.clientY);
    if (c) { const s = Math.max(0, Math.min(1380, snapM(minAt(c, e.clientY)))); moveTaskTo(d.t, { date: c.dataset.d, time: hhmm(s), endTime: hhmm(s + 60) }); }
    else if (a && a.dataset.d !== d.t.date) moveTaskTo(d.t, { date: a.dataset.d });
    return;
  }
  d.el.classList.remove('dragging', 'leaving');
  if (cancel) { render(); return; }
  if (!d.moved) { render(); if (d.held && d.mode === 'm') setTimeout(() => openCtx(d.t.id), 60); return; }
  if (d.toAll) { moveTaskTo(d.t, { date: d.toAll.dataset.d, time: '', endTime: '' }); return; }
  const date = d.col.dataset.d;
  if (d.s === undefined || (d.s === d.s0 && d.e === d.e0 && date === d.d0)) { render(); return; }
  moveTaskTo(d.t, { date, time: hhmm(d.s), endTime: d.e >= 1440 ? '23:59' : hhmm(d.e) });
}
document.addEventListener('pointerup', e => cDrop(e, false));
document.addEventListener('pointercancel', e => cDrop(e, true));
// Pellizcar: a lo ancho cambia cuántos días se ven; a lo alto, lo que mide cada hora
$('#list').addEventListener('touchstart', e => {
  if (view !== 'semana' || !['dia', 'semana'].includes(calMode) || e.touches.length !== 2 || !e.target.closest('.cgrid')) return;
  const [a, b] = e.touches;
  if (cPress) { clearTimeout(cPress.timer); cPress = null; }
  if (cSel) { cSel.el.remove(); cSel = null; }
  calSwipe = null;
  pinch = { dx: Math.max(40, Math.abs(a.clientX - b.clientX)), dy: Math.max(40, Math.abs(a.clientY - b.clientY)), n: calMode === 'dia' ? 1 : calN, px: calPX, axis: null, tgts: [...new Set([...e.touches].map(t => t.target).concat(e.target))] };
  // Los dedos siguen mandando sus eventos al elemento donde empezaron, aunque se repinte la Agenda: se escuchan ahí
  pinch.tgts.forEach(t => { t.addEventListener('touchmove', pinchMove, { passive: false }); t.addEventListener('touchend', pinchStop); t.addEventListener('touchcancel', pinchStop); });
}, { passive: true });
let pinchTimer = 0, pinchNext = null;
function pinchMove(e) {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const [a, b] = e.touches, rx = Math.abs(a.clientX - b.clientX) / pinch.dx, ry = Math.abs(a.clientY - b.clientY) / pinch.dy;
  if (!pinch.axis) { const lx = Math.abs(Math.log(rx || 1)), ly = Math.abs(Math.log(ry || 1)); if (Math.max(lx, ly) < 0.12) return; pinch.axis = lx >= ly ? 'x' : 'y'; }
  pinchNext = { rx, ry, my: (a.clientY + b.clientY) / 2 };
  if (!pinchTimer) pinchTimer = setTimeout(pinchApply, 30);
}
function pinchApply() {
  pinchTimer = 0; const q = pinchNext; if (!pinch || !q) return;
  if (pinch.axis === 'x') { if (setCalN(Math.max(1, Math.min(7, Math.round(pinch.n / Math.max(0.1, q.rx)))))) render(); }
  else if (pinch.axis === 'y') zoomHours(pinch.px * q.ry, q.my);
}
function pinchStop(e) {
  if (!pinch || e.touches.length >= 2) return;
  if (pinchTimer) { clearTimeout(pinchTimer); pinchApply(); }
  pinch.tgts.forEach(t => { t.removeEventListener('touchmove', pinchMove); t.removeEventListener('touchend', pinchStop); t.removeEventListener('touchcancel', pinchStop); });
  pinch = null; pinchNext = null; pinchEnd = Date.now(); quiet();
}
// En el ordenador (o con el trackpad del iPad): pellizcar en el trackpad = Ctrl + rueda
$('#list').addEventListener('wheel', e => {
  if (!e.ctrlKey || view !== 'semana' || !e.target.closest('.cgrid')) return;
  e.preventDefault(); zoomHours(calPX * Math.exp(Math.max(-0.25, Math.min(0.25, -e.deltaY / 150))), e.clientY);
}, { passive: false });
// Deslizar a los lados para cambiar de día, semana, mes o año
let calSwipe = null;
$('#list').addEventListener('pointerdown', e => { if (view === 'semana' && calMode !== 'lista' && e.isPrimary && !e.target.closest('li.task, input, .wkscroll, .sscroll, .cres')) calSwipe = { x: e.clientX, y: e.clientY, t: Date.now() }; });
$('#list').addEventListener('pointerup', e => {
  const s = calSwipe; calSwipe = null; if (!s || view !== 'semana' || cDrag || cSel || cMoved || pinch || Date.now() - pinchEnd < 400) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 800) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); calNav(dx < 0 ? 1 : -1); }
});


let agendaSel = null;
function monthCalHTML(byCat) {
  const today = todayISO(), base = parseISO(today), y = base.getFullYear(), m = base.getMonth() + monthOffset;
  const first = new Date(y, m, 1), n = dim(first.getFullYear(), first.getMonth());
  const ym = `${first.getFullYear()}-${pad(first.getMonth() + 1)}`, from = `${ym}-01`, to = `${ym}-${pad(n)}`;
  const gh = ghostsIn(byCat, from, to), lead = (first.getDay() + 6) % 7;
  const sel = calSel && calSel.startsWith(ym) ? calSel : (monthOffset === 0 ? today : from);
  agendaSel = sel;
  const dayTasks = d => tasks.filter(t => byCat(t) && t.date === d).concat(gh[d] || []);
  const cellL = [], wk = calPrefs().weekNums;
  for (let i = 0; i < lead; i++) cellL.push('<span></span>');
  for (let day = 1; day <= n; day++) {
    const d = `${ym}-${pad(day)}`, list = dayTasks(d), late = list.some(t => !t.done && d < today), w = wxOf(d);
    const dots = [...new Set(list.map(t => catOf(t.cat).color))].slice(0, 4).map(c => `<i style="background:${colorVar(c)}"></i>`).join('');
    cellL.push(`<button class="mcell ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${late ? 'late' : ''}" data-act="calday" data-d="${d}"><span>${day}</span>${w ? `<span class="mwx">${w.i}</span>` : ''}<span class="mdots">${dots}</span>${list.length > 4 ? `<em>${list.length}</em>` : ''}</button>`);
  }
  let cells = '';
  for (let i = 0; i < cellL.length; i += 7) cells += (wk ? `<i class="wn">${isoWeek(addDays(from, i - lead))}</i>` : '') + cellL.slice(i, i + 7).join('');
  const selReal = tasks.filter(t => byCat(t) && t.date === sel && (!t.done || showDone)).sort(sortTasks), selGh = gh[sel] || [];
  const title = cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
  return `<div class="weeknav"><button class="iconbtn" data-act="mprev" aria-label="Mes anterior">‹</button><strong>${title}</strong><button class="iconbtn" data-act="mnext" aria-label="Mes siguiente">›</button></div>
    <div class="mcal${calPrefs().weekNums ? ' wk' : ''}">${calPrefs().weekNums ? '<b></b>' : ''}<b>L</b><b>M</b><b>X</b><b>J</b><b>V</b><b>S</b><b>D</b>${cells}</div>
    <h2 class="group"><span>${cap(parseISO(sel).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}${wxTxt(wxOf(sel))}</span><button class="btn ghost small" data-act="calgo" data-d="${sel}">Ver el día ›</button></h2>
    ${selReal.length ? `<ul class="list">${listItemsHTML(selReal)}</ul>` : ''}
    ${selGh.length ? `<div style="display:grid;gap:6px;margin-top:6px">${selGh.map(t => `<button class="ghost" data-act="edit" data-id="${t.id}"><span class="dot" style="background:${colorVar(catOf(t.cat).color)}"></span><span><b>${esc(t.title)}</b>${t.time ? ' · ' + t.time : ''}</span><span>↻</span></button>`).join('')}</div>` : ''}
    ${!selReal.length && !selGh.length ? '<p class="free">Nada este día</p>' : ''}`;
}
// --- Matriz de prioridades (urgente = vence en 2 días o antes; importante = prioridad alta) ---
function matrixHTML(byCat) {
  const lim = addDays(todayISO(), 2);
  const list = tasks.filter(t => byCat(t) && !t.done && !t.someday && !children(t.id).length);
  const urgent = t => t.date && t.date <= lim, imp = t => t.flag || t.prio === 'alta';
  const Q = [
    ['Hazlo ya', 'Urgente e importante', list.filter(t => urgent(t) && imp(t)), 'q1'],
    ['Prográmalo', 'Importante, sin prisa', list.filter(t => !urgent(t) && imp(t)), 'q2'],
    ['Hazlo rápido', 'Urgente, poco importante', list.filter(t => urgent(t) && !imp(t)), 'q3'],
    ['Suéltalo', 'Ni urgente ni importante', list.filter(t => !urgent(t) && !imp(t)), 'q4'],
  ];
  return `<p class="hint" style="margin:0 2px 8px">Importante = con bandera 🚩. Urgente = vence en los próximos 2 días o está atrasada.</p><div class="matrix">${Q.map(([t, s, items, k]) => `<section class="mq ${k}"><h3>${t} <span>${items.length}</span></h3><p>${s}</p>
    ${items.sort(sortTasks).slice(0, 12).map(x => `<div class="mqi"><button data-act="edit" data-id="${x.id}"><span class="dot" style="background:${colorVar(catOf(x.cat).color)}"></span>${esc(x.title)}${x.date ? `<em>${friendlyDate(x.date)}</em>` : ''}</button>${k === 'q4' && !x.date ? `<button class="chip" data-act="someday" data-id="${x.id}">Algún día</button>` : ''}</div>`).join('') || '<p class="free">Nada</p>'}
    ${items.length > 12 ? `<p class="free">y ${items.length - 12} más</p>` : ''}</section>`).join('')}</div>`;
}

// ---------- Detalles: al tocar una tarea se ve; con el lápiz se edita ----------
let detailId = null, detailRoutine = null;
function openDetails(id) { detailId = id; detailRoutine = null; renderDetails(); openSheet('#detailSheet'); }
function openRoutineDetails(hid) { detailRoutine = hid; detailId = null; renderDetails(); openSheet('#detailSheet'); }
function renderDetails() {
  const body = $('#detailBody'); if (!body) return;
  if (detailRoutine) {
    const h = habits.find(x => x.id === detailRoutine); if (!h) return closeSheets();
    const done = new Set(stepsToday(h)), now = toMin(nowHM());
    $('#detailTitle').textContent = h.name;
    body.innerHTML = `<p class="hint">${done.size}/${h.steps.length} pasos hoy</p>
      <ul class="steps-list">${h.steps.map((st, i) => { const nx = h.steps[i + 1], cur = toMin(st.time) <= now && (!nx || now < toMin(nx.time));
        return `<li><button class="${done.has(st.id) ? 'on' : ''} ${cur ? 'cur' : ''}" data-dact="rstep" data-id="${h.id}" data-step="${st.id}"><span class="box">${TICK('var(--surface)')}</span><span class="tm">${st.time}</span><span>${esc(st.text)}</span></button></li>`; }).join('')}</ul>
      <button class="btn block" type="button" data-dact="hedit" data-id="${h.id}">${PENCIL} Editar rutina</button>`;
    return;
  }
  const t = tasks.find(x => x.id === detailId); if (!t) return closeSheets();
  const root = detailRoot(), parts = children(root.id).sort(sortParts), proj = root.project ? projects.find(p => p.id === root.project) : null;
  const c = catOf(root.cat), pr = progressOf(root.id);
  $('#detailTitle').textContent = root.title;
  const when = t.date ? `${longDate(t.date)}${t.time ? ` · ${t.time}${t.endTime ? '–' + t.endTime : ''}` : ''}` : 'Sin fecha';
  const facts = [
    `<span class="catn"><span class="dot" style="background:${colorVar(c.color)}"></span>${esc(c.name)}</span>`,
    parts.length ? '' : `<span>📅 ${esc(when)}</span>`,
    root.flag ? '<span class="flag">🚩 Con bandera</span>' : '',
    t.status === 'doing' && !t.done ? '<span class="doing">▶ Haciendo</span>' : '',
    root.repeat ? `<span>↻ ${repeatLabel(root)}</span>` : '',
    ageOn(root, t.date) ? `<span>🎂 cumple ${ageOn(root, t.date)}</span>` : '',
    proj ? `<button type="button" class="projchip" data-golink="proj" data-id="${proj.id}">📁 ${esc(proj.name)}</button>` : '',
    (t.loc || root.loc) ? `<a class="dloc" href="https://maps.apple.com/?q=${encodeURIComponent(t.loc || root.loc)}" target="_blank" rel="noopener">📍 ${esc(t.loc || root.loc)}</a>` : '',
    parts.length ? '' : `<span>⭐ ${t.parentId ? partPoints(t) : taskPoints(t)}</span>`,
    ...(root.tags || []).map(x => `<button type="button" class="tagchip" data-dact="tag" data-t="${esc(x)}">@${esc(x)}</button>`),
  ].filter(Boolean).join('');
  body.innerHTML = `<div class="dfacts">${facts}</div>
    ${root.notes ? `<p class="dnotes">${esc(root.notes)}</p>` : ''}
    ${parts.length ? `<div class="dprog"><span class="pbar"><i style="width:${pr.total ? pr.done / pr.total * 100 : 0}%"></i></span>${pr.done}/${pr.total} partes</div>
      <ul class="dparts">${parts.map(p => `<li class="${p.done ? 'done' : ''} ${p.id === t.id && t.parentId ? 'me' : ''}" style="--c:${colorVar(c.color)}"><button class="check" data-dact="toggle" data-id="${p.id}" aria-label="${p.done ? 'Marcar como pendiente' : 'Completar'}: ${esc(p.title)}">${TICK('var(--surface)')}</button>
        <span><b>${esc(p.title)}</b><small>${p.date ? friendlyDate(p.date) : 'Sin fecha'}${p.time ? ' · ' + p.time : ''} · ⭐ ${partPoints(p)}</small></span></li>`).join('')}</ul>`
      : `<button class="btn primary block" type="button" data-dact="toggle" data-id="${t.id}">${t.done ? 'Marcar como pendiente' : '✓ Hecha'}</button>`}
    ${!t.done && !parts.length ? `<div class="chips dmove"><span class="label">Mover a</span>${t.date !== todayISO() ? `<button type="button" class="chip" data-dact="move" data-to="hoy" data-id="${t.id}">Hoy</button>` : ''}<button type="button" class="chip" data-dact="move" data-to="manana" data-id="${t.id}">Mañana</button><button type="button" class="chip" data-dact="move" data-to="lunes" data-id="${t.id}">El lunes</button>${t.date ? `<button type="button" class="chip" data-dact="move" data-to="none" data-id="${t.id}">Sin fecha</button>` : ''}</div>` : ''}
    <div class="chips dmove"><button type="button" class="chip${root.flag ? ' on' : ''}" data-dact="flag" data-id="${root.id}">🚩 ${root.flag ? 'Quitar bandera' : 'Bandera'}</button>${!t.done && !parts.length ? `<button type="button" class="chip${t.status === 'doing' ? ' on' : ''}" data-dact="doing" data-id="${t.id}">${t.status === 'doing' ? '⏸ Ya no la hago' : '▶ La estoy haciendo'}</button>` : ''}<button type="button" class="chip" data-dact="dup" data-id="${t.id}">⧉ Duplicar</button></div>
    ${photosHTML(root.photos || [], `data-ptask="${root.id}"`)}
    ${linksHTML(root.links, { k: 'task', id: root.id })}
    <div class="chips dmove"><label class="chip">📷 Foto<input type="file" accept="image/*" multiple hidden data-dphoto="${root.id}"></label><button type="button" class="chip" data-dact="draw" data-id="${root.id}">✏️ Dibujo</button><button type="button" class="chip" data-dact="link" data-id="${root.id}">🔗 Enlazar</button></div>
    <div class="grid2"><button class="btn" type="button" data-dact="edit" data-id="${root.id}">${PENCIL} Editar</button>${on('temporizador') && !t.done && !parts.length ? `<button class="btn" type="button" data-dact="timer" data-id="${t.id}">⏱ Concentrarme</button>` : '<span></span>'}</div>`;
  hydrateImgs(body);
}
const detailRoot = () => { const t = tasks.find(x => x.id === detailId); return t ? (t.parentId ? tasks.find(p => p.id === t.parentId) || t : t) : null; };
$('#detailBody').addEventListener('change', e => { const id = e.target.dataset.dphoto; if (id) { addPhotos(e.target.files, { kind: 'task', id }); e.target.value = ''; } });
$('#detailBody').addEventListener('click', e => {
  const el = e.target.closest('[data-dact]'); if (!el) return;
  const { dact, id } = el.dataset;
  if (dact === 'toggle') { toggle(id); renderDetails(); }
  else if (dact === 'rstep') { toggleStep(id, el.dataset.step); renderDetails(); }
  else if (dact === 'edit') openForm(id);
  else if (dact === 'hedit') openHabit(id);
  else if (dact === 'move') { const t = tasks.find(x => x.id === id); if (t) { closeSheets(); moveTasks([t], el.dataset.to); } }
  else if (dact === 'timer') { closeSheets(); openTimer(id); }
  else if (dact === 'flag') { const t = tasks.find(x => x.id === id); if (t) { setFlag(t, !t.flag); renderDetails(); } }
  else if (dact === 'doing') { const t = tasks.find(x => x.id === id); if (t) { setStatus(t, t.status === 'doing' ? '' : 'doing'); renderDetails(); } }
  else if (dact === 'dup') { closeSheets(); duplicateTask(id); }
  else if (dact === 'draw') openDraw(null, async data => { const fid = await putFile(data, 'draw'); setPhotoList({ kind: 'task', id }, [...photoList({ kind: 'task', id }), fid]); renderDetails(); });
  else if (dact === 'link') openLinkPicker({ k: 'task', id });
  else if (dact === 'tag') { closeSheets(); searchTag(el.dataset.t); }
});
// Marcar varias partes a la vez (el círculo de un grupo): si están todas hechas, vuelven a pendientes
function toggleMany(ids) {
  const list = ids.map(id => tasks.find(x => x.id === id)).filter(Boolean); if (!list.length) return;
  if (list.length === 1) return toggle(list[0].id);
  const parent = list[0].parentId ? tasks.find(x => x.id === list[0].parentId) : null;
  const before = snapshot([...list, ...(parent ? [parent] : [])]), ptsBefore = ptsSnap([...list, ...(parent ? [parent] : [])]);
  const allDone = list.every(t => t.done);
  list.forEach(t => setDone(t, !allDone));
  let msg = allDone ? `${list.length} partes pendientes otra vez` : `Hechas ${list.length} partes · +${list.reduce((s, t) => s + (t.pts || 0), 0)} ⭐`;
  if (parent) {
    const pr = progressOf(parent.id);
    if (pr.total && pr.done === pr.total && !parent.done) { setDone(parent, true); msg = `¡Terminaste ${parent.title}! ${pr.done}/${pr.total}`; }
    else if (allDone && parent.done) setDone(parent, false);
  }
  store.putMany([...list, ...(parent ? [parent] : [])]).catch(writeFailed);
  navigator.vibrate?.(10);
  showToast(msg, () => { restore(before); ptsRestore(ptsBefore); });
  render();
}
// Rutina: el círculo marca todos los pasos (o los desmarca si ya estaban todos)
function toggleRoutineAll(hid) {
  const h = habits.find(x => x.id === hid); if (!h) return;
  const done = new Set(stepsToday(h)), all = done.size === h.steps.length;
  h.steps.forEach(st => { if (all ? done.has(st.id) : !done.has(st.id)) toggleStep(hid, st.id); });
}
// Puntos de una parte: los suyos si los pones; si no, su parte proporcional del total de la tarea
function partShares(total, list) {
  const auto = list.map(p => autoPoints(p)), fixed = list.map(p => p.points === null || p.points === undefined || p.points === '' ? null : Number(p.points));
  if (total === null || total === undefined || total === '') return list.map((_, i) => fixed[i] ?? auto[i]);
  const rest = Math.max(0, Number(total) - fixed.reduce((s, v) => s + (v || 0), 0)), w = auto.reduce((s, v, i) => s + (fixed[i] === null ? v : 0), 0) || 1;
  return list.map((_, i) => fixed[i] ?? Math.round(rest * auto[i] / w));
}
function partPoints(c) {
  const parent = tasks.find(x => x.id === c.parentId); if (!parent) return taskPoints(c);
  const sibs = children(parent.id).sort(sortParts), i = sibs.findIndex(x => x.id === c.id);
  return partShares(parent.points, sibs)[i] ?? taskPoints(c);
}
// --- Listas: las partes de una misma tarea en un mismo día salen juntas y se despliegan ---
function listItemsHTML(list) {
  const seen = new Set(), out = [];
  list.forEach(x => {
    if (!x.parentId) { out.push(taskHTML(x)); return; }
    const k = x.parentId + '|' + (x.date || '');
    if (seen.has(k)) return; seen.add(k);
    const ms = list.filter(y => y.parentId === x.parentId && (y.date || '') === (x.date || ''));
    out.push(ms.length > 1 ? groupHTML(tasks.find(p => p.id === x.parentId), ms.sort(sortParts), k) : taskHTML(x));
  });
  return out.join('');
}
function groupHTML(parent, ms, k) {
  if (!parent) return ms.map(taskHTML).join('');
  const c = colorVar(catOf(parent.cat).color), key = 'l' + k, open = openGroups.has(key), allDone = ms.every(m => m.done), pr = progressOf(parent.id);
  const pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
  return `<li class="task tgroup ${allDone ? 'done' : ''}" style="--c:${c}">
    <div class="row">
      <button class="check" data-act="gtoggle" data-ids="${ms.map(m => m.id).join(',')}" aria-label="Completar las ${ms.length} partes">${TICK('var(--surface)')}</button>
      <div class="body" data-act="gopen" data-key="${key}"><div class="t">${esc(parent.title)}</div><div class="meta"><span class="catn" title="${esc(catOf(parent.cat).name)}"><span class="dot" style="background:${c}"></span></span><span>${ms.filter(m => m.done).length}/${ms.length} partes hoy</span><span class="prog"><span class="pbar"><i style="width:${pct}%"></i></span>${pr.done}/${pr.total} · ${pct}%</span></div></div>
      <button class="more chev${open ? ' open' : ''}" data-act="gopen" data-key="${key}" aria-label="Ver las partes" aria-expanded="${open}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    ${open ? `<ul class="gparts">${ms.map(m => `<li class="${m.done ? 'done' : ''}"><button class="check" data-act="toggle" data-id="${m.id}" aria-label="Completar: ${esc(m.title)}">${TICK('var(--surface)')}</button><span data-act="details" data-id="${m.id}">${esc(m.title)}${m.time ? `<small>${m.time}${m.endTime ? '–' + m.endTime : ''}</small>` : ''}</span></li>`).join('')}</ul>` : ''}
  </li>`;
}

// ---------- Hoy: línea de horas ----------
let hoyEdit = false;
const HOUR_PX = 56;
const openGroups = new Set(); // grupos de partes desplegados (como en Recordatorios)
const sortParts = (a, b) => (a.order || 0) - (b.order || 0) || (a.date || '9999').localeCompare(b.date || '9999') || (a.created || 0) - (b.created || 0);
// Lo de hoy: las partes de una misma tarea a la misma hora (o sin hora) salen juntas como una sola
function hoyItems(edit) {
  const today = todayISO(), items = [], extras = [], units = new Map();
  tasks.filter(t => t.date === today && !children(t.id).length && !(edit && t.done)).sort(sortParts).forEach(t => {
    const k = t.parentId ? `p|${t.parentId}|${t.time || ''}|${t.endTime || ''}` : 't|' + t.id;
    if (!units.has(k)) units.set(k, []); units.get(k).push(t);
  });
  units.forEach((ms, k) => {
    const t = ms[0], par = t.parentId ? tasks.find(p => p.id === t.parentId) : null, multi = ms.length > 1;
    const it = { key: 'h' + k, ids: ms.map(x => x.id), id: t.id, members: ms, multi, color: colorVar(catOf(t.cat).color),
      title: par ? par.title : t.title, sub: par ? (multi ? `${ms.filter(x => x.done).length}/${ms.length} partes` : t.title) : '', done: ms.every(x => x.done) };
    if (!t.time) { extras.push(it); return; }
    const s = toMin(t.time); let e = t.endTime ? toMin(t.endTime) : s + 60; if (e <= s) e += 1440;
    items.push({ ...it, s, e });
  });
  // Cada rutina es un solo bloque con su nombre; sus pasos se ven al tocarla
  habits.filter(h => h.kind === 'routine' && applies(h, today) && h.steps.length).forEach(h => {
    const done = new Set(stepsToday(h)), s = toMin(h.steps[0].time), last = toMin(h.steps[h.steps.length - 1].time);
    let e = last + 30; if (e <= s) e += 1440;
    items.push({ s, e, routine: h.id, id: h.id, title: h.name, sub: `${done.size}/${h.steps.length} pasos`, color: 'var(--accent)', done: done.size === h.steps.length });
  });
  return { items: items.sort((a, b) => a.s - b.s || a.e - b.e), extras, late: tasks.filter(t => isLate(t) && !children(t.id).length).sort(sortTasks) };
}
const ckBtn = it => `<button class="ck${it.done ? ' on' : ''}" style="--c:${it.color}" ${it.routine ? `data-act="rall" data-id="${it.routine}"` : `data-act="gtoggle" data-ids="${it.ids.join(',')}"`} aria-label="${it.done ? 'Marcar como pendiente' : 'Completar'}: ${esc(it.title)}">${TICK('var(--surface)')}</button>`;
const itemText = it => `<b>${esc(it.title)}${it.sub ? `<small class="tsub">${esc(it.sub)}</small>` : ''}</b>`;
function hoyHTML() {
  const now = toMin(nowHM()), { items, extras, late } = hoyItems(hoyEdit);
  const w = wxOf(todayISO());
  let html = (w && !hoyEdit ? `<div class="wxline">${w.i} <b>${w.max}°</b> / ${w.min}° · ${esc(calPrefs().wx.name)}</div>` : '') + timerBannerHTML() + backupBannerHTML() + (hoyEdit ? '' : birthdayHTML()) + (on('repaso') ? reviewBannerHTML() : '') + (on('planificar') && !hoyEdit ? planBannerHTML() : '') + sleepPromptHTML() + moodPromptHTML();
  if (hoyEdit) return html + hoyEditHTML(items, extras);
  const pending = items.filter(i => !i.done).length + extras.filter(i => !i.done).length;
  if (on('bandeja')) html += inboxHTML();
  const habLeft = habits.filter(h => (h.kind === 'quit' || (h.kind === 'build' && h.freq === 'daily')) && !habitDoneToday(h));
  if (habLeft.length) { const names = habLeft.slice(0, 2).map(h => h.name).join(', ') + (habLeft.length > 2 ? ` y ${habLeft.length - 2} más` : '');
    html += `<button class="hableft" data-act="gohabits"><span>🔥</span><span><b>${habLeft.length} ${habLeft.length === 1 ? 'hábito' : 'hábitos'} por hacer hoy</b><small>${esc(names)}</small></span><span class="go">›</span></button>`; }
  let side = '';
  html += `<div class="hoygrid"><div class="hoymain"><div class="hoyhead"><span>${pending ? `${pending} por hacer` : items.length + extras.length ? '¡Todo hecho! 🎉' : 'Nada para hoy'}</span><button class="btn small" data-act="hoyedit">✏️ Editar</button></div>`;
  if (items.length) html += timelineHTML(items, now, false);
  else html += `<p class="hint" style="margin:8px 2px">${extras.length ? 'No tienes nada con hora hoy. Pulsa “Editar” para ponerle hora a tus tareas.' : 'Nada apuntado para hoy. Pulsa + para añadir algo.'}</p>`;
  const row = (it, cls) => {
    const open = it.multi && openGroups.has(it.key);
    return `<div class="xrow ${cls}">${ckBtn(it)}<span class="xb" data-act="${it.multi ? 'gopen' : 'details'}" data-id="${it.id}" data-key="${it.key || ''}">${itemText(it)}</span>${it.multi ? `<button class="chev${open ? ' open' : ''}" data-act="gopen" data-key="${it.key}" aria-label="Ver las partes" aria-expanded="${open}">›</button>` : ''}</div>
      ${open ? `<div class="xsub">${it.members.map(m => `<div class="xrow sub ${m.done ? 'done' : ''}">${ckBtn({ ids: [m.id], color: it.color, done: m.done, title: m.title })}<span class="xb" data-act="details" data-id="${m.id}"><b>${esc(m.title)}</b></span></div>`).join('')}</div>` : ''}`;
  };
  html += '</div><div class="hoyside">';
  if (extras.length) html += `<h2 class="group"><span>Extra</span><span>${extras.length}</span></h2><div class="xlist">${extras.sort((a, b) => a.done - b.done).map(x => row(x, x.done ? 'done' : '')).join('')}</div>`;
  if (late.length) html += `<h2 class="group late"><span>De otros días</span><span>${late.length}</span></h2><div class="latebar"><button class="chip" data-act="mvlate" data-to="hoy">Todas a hoy</button><button class="chip" data-act="mvlate" data-to="manana">A mañana</button><button class="chip" data-act="mvlate" data-to="none">Sin fecha</button></div><div class="xlist">${late.map(t => { const par = t.parentId ? tasks.find(p => p.id === t.parentId) : null; return row({ ids: [t.id], id: t.id, title: par ? par.title : t.title, sub: `${par ? t.title + ' · ' : ''}${friendlyDate(t.date).toLowerCase()}`, color: colorVar(catOf(t.cat).color), done: false }, 'late'); }).join('')}</div>`;
  if (on('diario')) { const j = journalOf(todayISO()); html += `<button class="hableft" data-act="journal" data-d="${todayISO()}"><span>📓</span><span><b>Diario de hoy</b><small>${j && !journalEmpty(j) ? 'Ya has escrito · toca para seguir' : '¿Qué tal ha ido el día?'}</small></span><span class="go">›</span></button>`; }
  return html + '</div></div>';
}
// La línea de horas: cada hora mide lo mismo. En modo editar: tocar = cambiar la hora; mantener = arrastrar.
let tlStartH = 7;
function timelineHTML(items, now, edit) {
  const nowH = Math.max(0, Math.floor(now / 60) - 1);
  const startH = edit ? Math.min(7, ...items.map(i => Math.floor(i.s / 60))) : Math.min(nowH, ...items.map(i => Math.floor(i.s / 60)));
  const endH = Math.min(26, Math.max(edit ? 23 : Math.max(Math.floor(now / 60) + 2, 21), ...items.map(i => Math.ceil(i.e / 60))));
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
    const pos = `top:${top(i.s) + 1}px;height:${h}px;left:calc(3.4em + (100% - 3.4em) * ${i.lane / nl});width:calc((100% - 3.4em) / ${nl} - 4px)`;
    if (edit) {
      const drag = !i.routine;
      return `<div class="tl2i ${drag ? 'drag' : 'fixed'}" style="${pos}"${drag ? ` data-drag="${i.ids.join(',')}" data-s="${i.s}" data-e="${i.e}"` : ''}>
        ${drag ? '<span class="hdl t" data-h="t"></span>' : ''}<span class="dot" style="background:${i.color}"></span>${itemText(i)}<small class="tlt">${hhmm(i.s)}–${hhmm(i.e)}</small>${drag ? '<span class="hdl b" data-h="b"></span>' : ''}</div>`;
    }
    return `<div class="tl2i ${st}" style="${pos}">${ckBtn(i)}<span class="tlb" data-act="${i.routine ? 'rdetails' : 'details'}" data-id="${i.id}">${itemText(i)}</span></div>`;
  }).join('') + '</div>';
  return html;
}
const hhmm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
// Modo editar: solo lo que falta por hacer. Arriba, traer tareas sin fecha; las que no tienen hora, para arrastrar a la línea.
function hoyEditHTML(items, extras) {
  const loose = extras.filter(x => !x.done);
  return `<div class="hoyhead"><b>Editar hoy</b><button class="btn primary small" data-act="hoysave">Guardar</button></div>
    <button class="btn block" type="button" data-act="plan" style="margin-bottom:8px">📝 Traer tareas sin fecha a hoy</button>
    <p class="hint" style="margin:0 2px 8px">Toca una tarea para cambiar su hora. Mantén pulsado y arrastra para moverla; tira de su borde de arriba o de abajo para alargarla o acortarla. Para quitarle la hora, arrástrala a “Quitar hora”.</p>
    ${loose.length ? `<h2 class="group"><span>Sin hora</span><span>${loose.length}</span></h2><div class="xchips">${loose.map(x => `<span class="xchip" data-xdrag="${x.ids.join(',')}"><span class="dot" style="background:${x.color}"></span>${esc(x.title)}${x.sub ? ` · <small>${esc(x.sub)}</small>` : ''}</span>`).join('')}</div>` : ''}
    ${timelineHTML(items, toMin(nowHM()), true)}`;
}
// --- Arrastrar (manteniendo pulsado) y tocar para cambiar la hora ---
let tlDrag = null, tlPress = null;
const SNAP = 5, HOLD_MS = 380;
const idsOf = s => String(s || '').split(',').filter(Boolean);
function setTimes(ids, time, end) {
  const list = ids.map(id => tasks.find(x => x.id === id)).filter(Boolean);
  list.forEach(t => { t.time = time; t.endTime = time ? end : ''; });
  if (list.length) store.putMany(list).catch(writeFailed);
}
function outZone(show) {
  let z = $('#tlOut');
  if (show && !z) { z = document.createElement('div'); z.id = 'tlOut'; z.textContent = '⤒ Suelta aquí para quitar la hora'; document.body.append(z); }
  if (!show && z) z.remove();
}
const overOut = (x, y) => { const z = $('#tlOut'); if (!z) return false; const r = z.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
function beginDrag(p) {
  const line = $('#list .tl2'); if (!line) return;
  navigator.vibrate?.(12);
  if (p.blk) {
    tlDrag = { el: p.blk, ids: idsOf(p.blk.dataset.drag), mode: p.mode || 'm', y0: p.y, s0: +p.blk.dataset.s, e0: +p.blk.dataset.e, line };
    p.blk.classList.add('dragging');
  } else {
    const r = p.chip.getBoundingClientRect(), ghost = p.chip.cloneNode(true);
    ghost.className = 'xchip ghost'; ghost.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px`;
    document.body.append(ghost);
    tlDrag = { chip: p.chip, ghost, ids: idsOf(p.chip.dataset.xdrag), mode: 'new', dx: p.x - r.left, dy: p.y - r.top, line };
    p.chip.classList.add('lifted');
  }
  outZone(tlDrag.mode === 'm');
}
$('#list').addEventListener('pointerdown', e => {
  if (!hoyEdit || e.button > 0) return;
  const blk = e.target.closest('.tl2i[data-drag]'), chip = e.target.closest('[data-xdrag]');
  if (!blk && !chip) return;
  // Los bordes se arrastran al momento; el resto, manteniendo pulsado
  if (blk && e.target.dataset.h) { e.preventDefault(); beginDrag({ blk, mode: e.target.dataset.h, x: e.clientX, y: e.clientY }); return; }
  const p = { blk, chip, x: e.clientX, y: e.clientY };
  p.timer = setTimeout(() => { if (tlPress === p) { tlPress = null; beginDrag(p); } }, HOLD_MS);
  tlPress = p;
});
function tlMinuteAt(y, line) {
  const r = line.getBoundingClientRect();
  return Math.round((tlStartH * 60 + (y - r.top) / HOUR_PX * 60) / SNAP) * SNAP;
}
function tlAutoScroll(y) {
  const sc = $('#scroller') || document.scrollingElement;
  if (y < 90) sc.scrollBy(0, -12); else if (y > innerHeight - 110) sc.scrollBy(0, 12);
}
document.addEventListener('touchmove', e => { if (tlDrag || progDrag || partDrag) e.preventDefault(); }, { passive: false });
document.addEventListener('pointermove', e => {
  if (tlPress && Math.hypot(e.clientX - tlPress.x, e.clientY - tlPress.y) > 8) { clearTimeout(tlPress.timer); tlPress = null; }
  const d = tlDrag; if (!d) return;
  e.preventDefault(); tlAutoScroll(e.clientY);
  const out = overOut(e.clientX, e.clientY); $('#tlOut')?.classList.toggle('hot', out);
  if (d.mode === 'new') {
    d.ghost.style.left = e.clientX - d.dx + 'px'; d.ghost.style.top = e.clientY - d.dy + 'px';
    const r = d.line.getBoundingClientRect(), over = e.clientY >= r.top && e.clientY <= r.bottom;
    d.line.classList.toggle('drop', over);
    d.ghost.dataset.t = over ? hhmm(Math.max(0, tlMinuteAt(e.clientY - d.dy, d.line))) : '';
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
  d.el.classList.toggle('leaving', out);
}, { passive: false });
function tlDrop(e, cancel) {
  if (tlPress) {
    // Toque corto: cambiar la hora a mano
    const p = tlPress; tlPress = null; clearTimeout(p.timer);
    if (!cancel) openTimeSheet(idsOf((p.blk || p.chip).dataset.drag || (p.blk || p.chip).dataset.xdrag));
    return;
  }
  const d = tlDrag; if (!d) return; tlDrag = null;
  const out = !cancel && overOut(e.clientX, e.clientY); outZone(false);
  if (d.mode === 'new') {
    d.ghost.remove(); d.chip.classList.remove('lifted'); d.line.classList.remove('drop');
    const r = d.line.getBoundingClientRect();
    if (cancel || e.clientY < r.top || e.clientY > r.bottom) return;
    const s = Math.max(0, Math.min(1380, tlMinuteAt(e.clientY - d.dy, d.line)));
    setTimes(d.ids, hhmm(s), hhmm(s + 60));
  } else {
    d.el.classList.remove('dragging', 'leaving');
    if (out) { setTimes(d.ids, '', ''); showToast('Hora quitada: vuelve a “Sin hora”'); render(); return; }
    if (cancel || d.s === undefined || (d.s === d.s0 && d.e === d.e0)) return;
    setTimes(d.ids, hhmm(d.s), d.e >= 1440 ? '23:59' : hhmm(d.e));
  }
  render();
}
document.addEventListener('pointerup', e => tlDrop(e, false));
document.addEventListener('pointercancel', e => tlDrop(e, true));
// Hoja para la hora: solo se guarda al pulsar ✓
let tsIds = [];
function openTimeSheet(ids) {
  const list = ids.map(id => tasks.find(x => x.id === id)).filter(Boolean); if (!list.length) return;
  tsIds = ids; const t = list[0], par = t.parentId ? tasks.find(p => p.id === t.parentId) : null;
  $('#tsTitle').textContent = par ? `${par.title} · ${list.length > 1 ? list.length + ' partes' : t.title}` : t.title;
  $('#tsStart').value = t.time || ''; $('#tsEnd').value = t.endTime || (t.time ? hhmm(toMin(t.time) + 60) : '');
  $('#tsOut').hidden = !t.time; renderTimeSheet(); openSheet('#timeSheet');
}
function renderTimeSheet() { $('#tsStartT').textContent = $('#tsStart').value || '—'; $('#tsEndT').textContent = $('#tsEnd').value || '—'; }
let tsPrev = '';
$('#tsStart').addEventListener('focus', () => { tsPrev = $('#tsStart').value; });
$('#tsStart').addEventListener('change', () => {
  const s = $('#tsStart').value, en = $('#tsEnd').value;
  if (s && (!en || (tsPrev && toMin(en) <= toMin(tsPrev)) || toMin(en) <= toMin(s))) $('#tsEnd').value = hhmm(toMin(s) + 60);
  else if (s && tsPrev && en) $('#tsEnd').value = hhmm(toMin(en) + toMin(s) - toMin(tsPrev));
  tsPrev = s; renderTimeSheet();
});
$('#tsEnd').addEventListener('change', renderTimeSheet);
$('#tsOK').addEventListener('click', () => {
  const s = $('#tsStart').value; setTimes(tsIds, s, s ? ($('#tsEnd').value || hhmm(toMin(s) + 60)) : '');
  closeSheets(); render();
});
$('#tsOut').addEventListener('click', () => { setTimes(tsIds, '', ''); closeSheets(); render(); });

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

// ---------- El tiempo (Open-Meteo: sin cuenta; solo se envía la ciudad elegida o unas coordenadas aproximadas) ----------
const WX_ICON = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 57 ? '🌦️' : c <= 67 ? '🌧️' : c <= 77 ? '🌨️' : c <= 82 ? '🌧️' : c <= 86 ? '🌨️' : '⛈️';
let wx = (() => { try { return JSON.parse(localStorage.getItem('mis-tareas-wx')) || null; } catch { return null; } })(), wxBusy = false;
function wxOf(d) {
  const p = calPrefs().wx; if (!p || !wx || wx.key !== `${p.lat},${p.lon}`) return null;
  const v = wx.days?.[d]; return v ? { i: WX_ICON(v[0]), max: Math.round(v[1]), min: Math.round(v[2]) } : null;
}
async function wxRefresh(force) {
  const p = calPrefs().wx; if (!p || wxBusy || !navigator.onLine) return;
  const key = `${p.lat},${p.lon}`;
  if (!force && wx && wx.key === key && Date.now() - wx.at < 3 * 3600e3) return;
  wxBusy = true;
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({ latitude: p.lat, longitude: p.lon, daily: 'weather_code,temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '16' }));
    if (!r.ok) throw new Error('tiempo ' + r.status);
    const j = await r.json(), days = {};
    (j.daily?.time || []).forEach((d, i) => { days[d] = [j.daily.weather_code[i], j.daily.temperature_2m_max[i], j.daily.temperature_2m_min[i]]; });
    wx = { key, at: Date.now(), days }; lsSet('mis-tareas-wx', JSON.stringify(wx));
    render();
  } catch (e) { logError(e.message, 'tiempo'); } finally { wxBusy = false; }
}
function setCalPref(ch) { extra.prefs = { ...extra.prefs, cal: { ...calPrefs(), ...ch } }; store.saveExtra('prefs').catch(writeFailed); }
// Ajustes del calendario: números de semana, fin de semana y el tiempo
let wxFound = [], wxMsg = '';
function renderCalPrefs() {
  const P = calPrefs(), sw = (k, name, desc) => `<div class="secrow"><span><b>${name}</b><small>${desc}</small></span><button type="button" class="switch" role="switch" aria-checked="${!!P[k]}" data-cp="${k}" aria-label="${name}"></button></div>`;
  $('#calPrefBody').innerHTML = `${sw('weekNums', 'Números de semana', 'En la Semana y en el Mes (S47…)')}${sw('noWeekend', 'Ocultar el fin de semana', 'La vista Semana enseña de lunes a viernes')}
    <h4>El tiempo</h4>
    ${P.wx ? `<div class="secrow"><span><b>📍 ${esc(P.wx.name)}</b><small>Sale en Hoy y en la Agenda (16 días)</small></span><button type="button" class="btn ghost small" data-cp="wxdel">Quitar</button></div>` : '<p class="hint">Elige tu ciudad y verás el tiempo de cada día en Hoy y en la Agenda. Solo se envía la ciudad (o tu zona aproximada) a Open-Meteo.</p>'}
    <form class="partadd" id="wxForm"><input class="inp" type="search" id="wxCity" placeholder="Ciudad, p. ej. Madrid" autocomplete="off" enterkeyhint="search"><button class="btn" type="submit">Buscar</button></form>
    ${wxFound.map((c, i) => `<button type="button" class="btn ghost block" data-cp="wxpick" data-i="${i}">${esc([c.name, c.admin1, c.country].filter(Boolean).join(', '))}</button>`).join('')}
    ${wxMsg ? `<p class="hint">${esc(wxMsg)}</p>` : ''}
    <button type="button" class="btn ghost block" data-cp="wxgeo">📍 Usar mi ubicación</button>
    <h4>Atajos de teclado</h4>
    <p class="hint">Con un teclado (iPad u ordenador): <b>T</b> hoy · <b>← →</b> antes / después · <b>N</b> nueva · <b>D S M A L</b> día, semana, mes, año, lista · <b>+ −</b> horas más grandes o más pequeñas · <b>1–6</b> pestañas · <b>/</b> buscar · <b>Esc</b> cerrar.</p>`;
}
$('#calPrefBody').addEventListener('click', e => {
  const b = e.target.closest('[data-cp]'); if (!b) return;
  const k = b.dataset.cp, P = calPrefs();
  if (k === 'weekNums' || k === 'noWeekend') setCalPref({ [k]: !P[k] });
  else if (k === 'wxdel') { setCalPref({ wx: null }); wx = null; }
  else if (k === 'wxpick') { const c = wxFound[+b.dataset.i]; if (c) { setCalPref({ wx: { name: c.name, lat: +c.latitude.toFixed(2), lon: +c.longitude.toFixed(2) } }); wxFound = []; wxMsg = ''; wxRefresh(true); } }
  else if (k === 'wxgeo') {
    if (!navigator.geolocation) { wxMsg = 'Este dispositivo no deja usar la ubicación.'; renderCalPrefs(); return; }
    wxMsg = 'Buscando dónde estás…'; renderCalPrefs();
    navigator.geolocation.getCurrentPosition(pos => { setCalPref({ wx: { name: 'Mi zona', lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) } }); wxMsg = ''; wxRefresh(true); renderCalPrefs(); render(); },
      () => { wxMsg = 'No se pudo usar la ubicación. Escribe tu ciudad.'; renderCalPrefs(); }, { maximumAge: 3600e3, timeout: 15000 });
    return;
  }
  renderCalPrefs(); render();
});
$('#calPrefBody').addEventListener('submit', async e => {
  if (e.target.id !== 'wxForm') return; e.preventDefault();
  const q = $('#wxCity').value.trim(); if (!q) return;
  wxMsg = 'Buscando…'; renderCalPrefs();
  try {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: '5', language: 'es', format: 'json' }));
    wxFound = r.ok ? ((await r.json()).results || []) : []; wxMsg = wxFound.length ? 'Elige la tuya:' : 'No la encuentro. Prueba con otro nombre.';
  } catch { wxFound = []; wxMsg = 'Sin conexión. Prueba más tarde.'; }
  renderCalPrefs();
});
$('#openCalPrefs').addEventListener('click', () => { wxFound = []; wxMsg = ''; renderCalPrefs(); openSheet('#calPrefSheet'); });

// ---------- Mini calendario del menú lateral (iPad y ordenador) ----------
let miniOff = 0;
function miniCalHTML() {
  const t = parseISO(todayISO()), first = new Date(t.getFullYear(), t.getMonth() + miniOff, 1), y = first.getFullYear(), m = first.getMonth(), n = dim(y, m), lead = (first.getDay() + 6) % 7;
  const today = todayISO(), sel = view === 'semana' && !query ? calDate() : '', ym = `${y}-${pad(m + 1)}`;
  const busy = new Set(tasks.filter(x => !x.done && x.date && x.date.startsWith(ym)).map(x => x.date));
  let cells = '<span></span>'.repeat(lead);
  for (let day = 1; day <= n; day++) { const d = `${ym}-${pad(day)}`; cells += `<button type="button" class="${d === today ? 'today' : ''}${d === sel ? ' sel' : ''}${busy.has(d) ? ' busy' : ''}" data-mini="${d}">${day}</button>`; }
  return `<div class="mmhead"><button type="button" data-mini="prev" aria-label="Mes anterior">‹</button><b>${cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}</b><button type="button" data-mini="next" aria-label="Mes siguiente">›</button></div><div class="mmgrid">${'LMXJVSD'.split('').map(c => `<i>${c}</i>`).join('')}${cells}</div>`;
}
$('#miniCal').addEventListener('click', e => {
  const b = e.target.closest('[data-mini]'); if (!b) return;
  const v = b.dataset.mini;
  if (v === 'prev' || v === 'next') { miniOff += v === 'next' ? 1 : -1; $('#miniCal').innerHTML = miniCalHTML(); return; }
  if (query) { query = ''; $('#searchInput').value = ''; $('#searchBar').hidden = true; $('#searchBtn').setAttribute('aria-pressed', 'false'); }
  view = 'semana'; activeFilter = null; calSel = v; if (['ano', 'lista'].includes(calMode)) calMode = 'dia'; syncMonth(); $('#scroller').scrollTop = 0; render();
});

// ---------- Atajos de teclado (iPad con teclado u ordenador) ----------
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tg = e.target;
  if (tg.closest?.('input, textarea, select, [contenteditable]')) { if (e.key === 'Escape') tg.blur(); return; }
  if (!$('#drawPad').hidden) return;
  if (!$('#photoView').hidden) { if (e.key === 'Escape') closeViewer(); return; }
  const sheetOpen = document.querySelector('.sheet.show');
  if (e.key === 'Escape') { if (sheetOpen) closeSheets(); return; }
  if (sheetOpen || !$('#login').hidden || !loaded) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const go = v => { if (query) { query = ''; $('#searchInput').value = ''; $('#searchBar').hidden = true; } view = v; activeFilter = null; showDone = false; $('#scroller').scrollTop = 0; render(); };
  const agenda = m => { view = 'semana'; activeFilter = null; calMode = m; lsSet('cal-mode', m); if (m === 'mes') syncMonth(); render(); };
  if (k === 't') { if (view === 'semana') { calSel = null; monthOffset = 0; render(); } else go('hoy'); }
  else if (k === 'ArrowLeft' || k === 'ArrowRight') { if (view !== 'semana' || calMode === 'lista') return; calNav(k === 'ArrowRight' ? 1 : -1); }
  else if (k === 'n') { view === 'habitos' ? openHabit(null) : view === 'notas' ? openNote(null) : $('#fab').click(); }
  else if ('dsmal'.includes(k) && k.length === 1) agenda({ d: 'dia', s: 'semana', m: 'mes', a: 'ano', l: 'lista' }[k]);
  else if (/^[1-6]$/.test(k)) go(['hoy', 'semana', 'habitos', 'sinfecha', 'notas', 'hechas'][+k - 1]);
  else if (k === '/') $('#searchBtn').click();
  else if (k === '+' || k === '=') { if (view === 'semana') zoomHours(calPX * 1.2); }
  else if (k === '-') { if (view === 'semana') zoomHours(calPX / 1.2); }
  else return;
  e.preventDefault();
});

// ---------- Cumpleaños: la edad y el aviso del día antes ----------
function birthdayHTML() {
  const today = todayISO(), tm = addDays(today, 1), out = [], seen = new Set(), isB = t => t.cat === 'cumple';
  [today, tm].forEach(d => {
    [...tasks.filter(t => isB(t) && t.date === d), ...(ghostsIn(isB, d, d)[d] || [])].forEach(t => {
      const k = t.id + d; if (seen.has(k)) return; seen.add(k);
      const age = ageOn(t, d); out.push(`${d === today ? 'Hoy' : 'Mañana'}: ${t.title}${age ? ` (${age})` : ''}`);
    });
  });
  return out.length ? `<div class="banner bday"><span>🎂 ${out.map(esc).join(' · ')}</span></div>` : '';
}

// ---------- Bandera y "Haciendo" ----------
function setFlag(t, v) {
  const s = snapshot([t]); t.flag = v; store.put(t).catch(writeFailed);
  showToast(v ? `🚩 ${t.title}` : `Sin bandera: ${t.title}`, () => restore(s)); render();
}
function setStatus(t, st) {
  if (st === 'done') { if (!t.done) { t.status = ''; toggle(t.id); } return; }
  if (t.done) { t.status = st; toggle(t.id); return; }
  const s = snapshot([t]); t.status = st; store.put(t).catch(writeFailed);
  showToast(st === 'doing' ? `▶ Haciendo: ${t.title}` : `Por hacer: ${t.title}`, () => restore(s)); render();
}

// ---------- Duplicar y copiar a otro día ----------
function duplicateTask(id, date) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const base = ({ id: _i, done, doneAt, spawned, pts, ptsDay, history, streak, best, gcal, focus, focusLog, siriKey, ...rest }) => structuredClone(rest);
  const shift = date && t.date ? Math.round((parseISO(date) - parseISO(t.date)) / 864e5) : 0;
  const copy = { ...base(t), id: uid(), done: false, created: Date.now(), date: date || t.date, status: '', photos: [] };
  if (!copy.date) { copy.time = ''; copy.endTime = ''; copy.repeat = ''; }
  else { copy.inbox = false; copy.someday = false; }
  alignStart(copy);
  const made = [copy];
  if (!t.parentId) children(t.id).forEach((c, i) => made.push({ ...base(c), id: copy.id + '-' + uid(), parentId: copy.id, done: false, created: Date.now() + i + 1, date: c.date ? addDays(c.date, shift) : '', photos: [] }));
  tasks.push(...made); store.putMany(made).catch(writeFailed);
  showToast(`Copiada: ${t.title}${copy.date && copy.date !== t.date ? ' → ' + friendlyDate(copy.date).toLowerCase() : ''}`, () => {
    const ids = new Set(made.map(m => m.id)); tasks = tasks.filter(x => !ids.has(x.id)); made.forEach(m => store.remove(m.id).catch(writeFailed));
  });
  render();
}

// ---------- Menú al mantener pulsada una tarea ----------
let ctxId = null;
function openCtx(id) { if (!tasks.some(x => x.id === id)) return; ctxId = id; renderCtx(); openSheet('#ctxSheet'); }
function renderCtx() {
  const t = tasks.find(x => x.id === ctxId); if (!t) return closeSheets();
  const parts = children(t.id).length, b = (a, icon, label, cls = '') => `<button type="button" class="${cls}" data-ctx="${a}"><span class="mi">${icon}</span>${label}</button>`;
  $('#ctxTitle').textContent = t.title;
  $('#ctxBody').innerHTML = [
    parts ? '' : b('done', '✓', t.done ? 'Marcar como pendiente' : 'Marcar como hecha'),
    b('flag', '🚩', t.flag ? 'Quitar la bandera' : 'Poner bandera'),
    !t.done && !parts ? b('doing', t.status === 'doing' ? '⏸' : '▶', t.status === 'doing' ? 'Ya no la estoy haciendo' : 'La estoy haciendo') : '',
    b('dup', '⧉', 'Duplicar'),
    `<label class="ctxdate"><span class="mi">📅</span>Copiar a otro día…<input type="date" data-ctxd="copy" aria-label="Copiar a otro día"></label>`,
    `<label class="ctxdate"><span class="mi">↪</span>Mover a otro día…<input type="date" data-ctxd="move" value="${t.date || ''}" aria-label="Mover a otro día"></label>`,
    b('edit', '✎', 'Editar'),
    b('del', '🗑', 'Borrar', 'danger'),
  ].join('');
}
$('#ctxBody').addEventListener('click', e => {
  const lab = e.target.closest('.ctxdate');
  if (lab) { if (e.target.tagName !== 'INPUT') { const i = lab.querySelector('input'); try { i.showPicker(); } catch { i.focus(); } } return; }
  const b = e.target.closest('[data-ctx]'); if (!b) return;
  const t = tasks.find(x => x.id === ctxId); if (!t) return;
  const a = b.dataset.ctx;
  if (a === 'edit') { openForm(t.parentId && !children(t.id).length ? t.id : t.id); return; }
  closeSheets();
  if (a === 'done') toggle(t.id);
  else if (a === 'flag') setFlag(t, !t.flag);
  else if (a === 'doing') setStatus(t, t.status === 'doing' ? '' : 'doing');
  else if (a === 'dup') duplicateTask(t.id);
  else if (a === 'del') remove(t.id);
});
$('#ctxBody').addEventListener('change', e => {
  const k = e.target.dataset.ctxd; if (!k || !e.target.value) return;
  const t = tasks.find(x => x.id === ctxId); if (!t) return;
  closeSheets();
  if (k === 'copy') duplicateTask(t.id, e.target.value);
  else if (e.target.value !== t.date) moveTaskTo(t, { date: e.target.value });
});

// ---------- Mantener pulsado en las listas: menú; en el Mes y en el Tablero, además, arrastrar ----------
let lpPress = null, lift = null;
$('#list').addEventListener('pointerdown', e => {
  if (e.button > 0 || hoyEdit || !e.isPrimary) return;
  const el = e.target.closest('li.task[data-id], .kcard[data-id]'); if (!el || e.target.closest('.check, input')) return;
  const p = { el, id: el.dataset.id, x: e.clientX, y: e.clientY, card: el.classList.contains('kcard') };
  p.timer = setTimeout(() => { if (lpPress === p) { lpPress = null; liftBegin(p); } }, HOLD_MS + 60);
  lpPress = p;
});
function liftBegin(p) {
  swipe = null; navigator.vibrate?.(12);
  p.el.classList.add('held');
  const drag = p.card || (view === 'semana' && calMode === 'mes');
  lift = { ...p, moved: false };
  if (drag) {
    const r = p.el.getBoundingClientRect(), g = document.createElement('div');
    g.className = 'liftghost'; g.textContent = tasks.find(x => x.id === p.id)?.title || '';
    g.style.cssText = `left:${r.left}px;top:${r.top}px;width:${Math.min(r.width, 280)}px`;
    document.body.append(g); lift.ghost = g; lift.dx = p.x - r.left; lift.dy = p.y - r.top;
  }
}
const liftTarget = (x, y, card) => { const el = document.elementFromPoint(x, y); return el?.closest(card ? '.kcol' : '.mcell'); };
document.addEventListener('touchmove', e => { if (lift?.ghost) e.preventDefault(); }, { passive: false });
document.addEventListener('pointermove', e => {
  if (lpPress && Math.hypot(e.clientX - lpPress.x, e.clientY - lpPress.y) > 8) { clearTimeout(lpPress.timer); lpPress = null; }
  if (!lift?.ghost) return;
  e.preventDefault();
  if (Math.hypot(e.clientX - lift.x, e.clientY - lift.y) > 6) lift.moved = true;
  lift.ghost.style.left = e.clientX - lift.dx + 'px'; lift.ghost.style.top = e.clientY - lift.dy + 'px';
  tlAutoScroll(e.clientY);
  const bd = $('#list .board'); if (bd && lift.card) { if (e.clientX < 40) bd.scrollBy(-14, 0); else if (e.clientX > innerWidth - 40) bd.scrollBy(14, 0); }
  const tg = liftTarget(e.clientX, e.clientY, lift.card);
  document.querySelectorAll('#list .drop').forEach(x => x !== tg && x.classList.remove('drop')); tg?.classList.add('drop');
}, { passive: false });
function liftEnd(e, cancel) {
  if (lpPress) { clearTimeout(lpPress.timer); lpPress = null; return; }
  const L = lift; if (!L) return; lift = null;
  L.el.classList.remove('held'); L.ghost?.remove(); document.querySelectorAll('#list .drop').forEach(x => x.classList.remove('drop'));
  quiet(); if (cancel) return;
  const t = tasks.find(x => x.id === L.id); if (!t) return;
  if (!L.moved) { setTimeout(() => openCtx(t.id), 60); return; }
  const tg = liftTarget(e.clientX, e.clientY, L.card); if (!tg) return;
  if (L.card) { const st = tg.dataset.st; if (st && st !== (t.done ? 'done' : t.status === 'doing' ? 'doing' : 'todo')) setStatus(t, st === 'todo' ? '' : st); }
  else if (tg.dataset.d && tg.dataset.d !== t.date) { calSel = tg.dataset.d; moveTaskTo(t, { date: tg.dataset.d }); }
}
document.addEventListener('pointerup', e => liftEnd(e, false));
document.addEventListener('pointercancel', e => liftEnd(e, true));

// ---------- Listas: sin fecha, con bandera, algún día, compra, proyectos, listas inteligentes y etiquetas ----------
let listSel = null;
const boards = (() => { try { return new Set(JSON.parse(localStorage.getItem('mis-tareas-boards') || '[]')); } catch { return new Set(); } })();
const saveBoards = () => lsSet('mis-tareas-boards', JSON.stringify([...boards]));
function listHit(k, t) {
  if (k === 'sinfecha') return !t.date && !t.inbox && !t.someday;
  if (k === 'someday') return !t.date && !!t.someday;
  if (k === 'flag') return !!t.flag;
  if (k.startsWith('p:')) return t.project === k.slice(2);
  if (k.startsWith('t:')) return (t.tags || []).includes(k.slice(2));
  if (k.startsWith('f:')) { const f = extra.filters.find(x => x.id === k.slice(2)); return !!f && filterHit(f, t); }
  return false;
}
function listTitle(k) {
  if (!k) return 'Listas';
  if (k === 'sinfecha') return 'Sin fecha'; if (k === 'someday') return 'Algún día'; if (k === 'flag') return 'Con bandera'; if (k === 'compra') return 'Compra';
  if (k.startsWith('p:')) return projects.find(p => p.id === k.slice(2))?.name || 'Proyecto';
  if (k.startsWith('t:')) return '@' + k.slice(2);
  if (k.startsWith('f:')) return extra.filters.find(x => x.id === k.slice(2))?.name || 'Lista';
  return 'Listas';
}
const projStats = id => { const r = tasks.filter(t => t.project === id && !t.parentId); return { done: r.filter(t => t.done).length, total: r.length }; };
const dueTxt = d => { const n = Math.round((parseISO(d) - parseISO(todayISO())) / 864e5); return n === 0 ? 'es hoy' : n === 1 ? 'mañana' : n > 0 ? `faltan ${n} días` : `hace ${-n} días`; };
function projCardHTML(p) {
  const s = projStats(p.id), pct = s.total ? Math.round(s.done / s.total * 100) : 0, nn = notes.filter(n => n.project === p.id).length;
  return `<button class="pcard2${p.done ? ' done' : ''}" data-act="lsel" data-k="p:${p.id}" style="--c:${colorVar(p.color)}"><b>${esc(p.name)}</b>
    <small>${[p.due && !p.done ? `📅 ${dueTxt(p.due)}` : '', `${s.done}/${s.total} tareas`, nn ? `${nn} ${nn === 1 ? 'nota' : 'notas'}` : ''].filter(Boolean).join(' · ')}</small>
    <span class="pbar"><i style="width:${pct}%"></i></span></button>`;
}
function listasHubHTML(byCat) {
  const n = k => tasks.filter(t => !t.done && byCat(t) && listHit(k, t)).length;
  const card = (k, icon, name, cnt, cls = '') => `<button class="lcard ${cls}" data-act="lsel" data-k="${k}"><span class="li">${icon}</span><b>${cnt}</b><span>${name}</span></button>`;
  let h = `<div class="lcards">${card('sinfecha', '📥', 'Sin fecha', n('sinfecha'))}${card('flag', '🚩', 'Con bandera', n('flag'), 'red')}${card('someday', '💭', 'Algún día', n('someday'))}${card('compra', '🛒', 'Compra', shop.filter(s => !s.done).length)}</div>`;
  const ps = projects.filter(p => !p.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.order - b.order), doneP = projects.filter(p => p.done);
  h += `<h2 class="group"><span>Proyectos</span><button class="btn ghost small" data-act="pnew">+ Nuevo</button></h2>`;
  h += ps.length ? `<div class="plist">${ps.map(projCardHTML).join('')}</div>` : '<p class="hint" style="margin:0 2px 8px">Un proyecto junta las tareas y notas de algo grande: un trabajo, una mudanza, un viaje…</p>';
  if (doneP.length) h += `<details class="box-card"><summary>Terminados (${doneP.length})</summary><div class="plist">${doneP.map(projCardHTML).join('')}</div></details>`;
  h += `<h2 class="group"><span>Mis listas</span><button class="btn ghost small" data-act="fnew">+ Nueva</button></h2>`;
  h += extra.filters.length ? `<div class="lrows">${extra.filters.map(f => `<button class="lrow" data-act="lsel" data-k="f:${f.id}"><span class="li">☰</span><span>${esc(f.name)}</span><b>${tasks.filter(t => filterMatch(f, t)).length}</b><span class="go">›</span></button>`).join('')}</div>`
    : '<p class="hint" style="margin:0 2px 8px">Una lista inteligente se rellena sola: por ejemplo, lo de Estudio con bandera, o todo lo que tiene ubicación.</p>';
  const tagc = {}; tasks.filter(t => !t.done).forEach(t => (t.tags || []).forEach(g => { tagc[g] = (tagc[g] || 0) + 1; }));
  const tags = Object.keys(tagc).sort((a, b) => a.localeCompare(b, 'es'));
  h += `<h2 class="group"><span>Etiquetas</span></h2>` + (tags.length ? `<div class="chips wrap">${tags.map(g => `<button class="chip" data-act="lsel" data-k="t:${esc(g)}">@${esc(g)} <small>${tagc[g]}</small></button>`).join('')}</div>`
    : '<p class="hint" style="margin:0 2px 8px">Escribe @algo en una tarea (p. ej. @ordenador o @llamar) para agruparlas aquí.</p>');
  return h;
}
function listViewHTML(byCat) {
  const k = listSel;
  const head = (board) => `<div class="lhead"><button class="btn ghost small" data-act="lback">‹ Listas</button>${board !== undefined ? `<div class="segs mini"><button type="button" class="seg ${board ? '' : 'on'}" data-act="lboard" data-v="0">Lista</button><button type="button" class="seg ${board ? 'on' : ''}" data-act="lboard" data-v="1">Tablero</button></div>` : ''}</div>`;
  if (k === 'compra') return { html: head() + shopHTML(), count: 0, doneCount: 0 };
  const p = k.startsWith('p:') ? projects.find(x => x.id === k.slice(2)) : null;
  if (k.startsWith('p:') && !p) { listSel = null; return { html: listasHubHTML(byCat), count: 0, doneCount: 0 }; }
  const board = boards.has(k), hit = tasks.filter(t => byCat(t) && listHit(k, t));
  const pend = hit.filter(t => !t.done).sort(sortTasks), done = hit.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  let html = head(board) + (p ? projHeadHTML(p) : '');
  if (board) html += boardHTML(pend, done);
  else {
    if (!pend.length) html += `<div class="empty"><strong>${p ? 'Sin tareas pendientes' : 'Nada por aquí'}</strong><span>Pulsa + para añadir una.</span></div>`;
    else html += k === 'sinfecha' || k === 'someday' ? `<ul class="list">${listItemsHTML(pend)}</ul>` : groupedOrFlat(pend);
    if (showDone && done.length) html += `<h2 class="group"><span>Hechas</span><span>${done.length}</span></h2><ul class="list">${done.slice(0, 50).map(taskHTML).join('')}</ul>`;
  }
  if (p) {
    const pn = notes.filter(n => n.project === p.id).sort((a, b) => b.updated - a.updated);
    html += `<h2 class="group"><span>Notas del proyecto</span><button class="btn ghost small" data-act="pnote" data-id="${p.id}">+ Nota</button></h2>${pn.length ? `<div class="ngrid">${pn.map(noteCardHTML).join('')}</div>` : '<p class="hint" style="margin:0 2px">Apuntes, ideas, fotos… todo lo del proyecto en un sitio.</p>'}`;
  }
  return { html, count: pend.length, doneCount: board ? 0 : done.length };
}
function projHeadHTML(p) {
  const s = projStats(p.id), pct = s.total ? Math.round(s.done / s.total * 100) : 0;
  return `<div class="phead" style="--c:${colorVar(p.color)}"><div class="pht"><b>${p.done ? '✓ ' : ''}${esc(p.name)}</b><button class="iconbtn" data-act="pedit" data-id="${p.id}" aria-label="Editar proyecto">${PENCIL}</button></div>
    ${p.due ? `<small>📅 ${longDate(p.due)}${p.done ? '' : ' · ' + dueTxt(p.due)}</small>` : ''}
    <div class="dprog"><span class="pbar"><i style="width:${pct}%"></i></span>${s.done}/${s.total} tareas · ${pct}%</div>
    ${p.notes ? `<p class="dnotes">${esc(p.notes)}</p>` : ''}</div>`;
}
// --- Tablero: Por hacer · Haciendo · Hecho ---
function boardHTML(pend, done) {
  const ids = new Set(pend.map(t => t.id)), roots = l => l.filter(t => !t.parentId || !ids.has(t.parentId));
  const todo = roots(pend).filter(t => t.status !== 'doing'), doing = roots(pend).filter(t => t.status === 'doing'), fin = roots(done).slice(0, 30);
  const card = t => {
    const par = t.parentId ? tasks.find(x => x.id === t.parentId) : null, pr = progressOf(t.id);
    const meta = [t.date ? friendlyDate(t.date) : '', t.time || '', pr.total ? `${pr.done}/${pr.total}` : '', ...(t.tags || []).map(g => '@' + g)].filter(Boolean).join(' · ');
    return `<div class="kcard${t.done ? ' done' : ''}" data-act="details" data-id="${t.id}" style="--c:${colorVar(catOf(t.cat).color)}"><b>${t.flag ? '🚩 ' : ''}${esc(par ? par.title : t.title)}</b>${par ? `<small>${esc(t.title)}</small>` : ''}${meta ? `<small>${esc(meta)}</small>` : ''}</div>`;
  };
  return `<div class="board">${[['todo', 'Por hacer', todo], ['doing', 'Haciendo', doing], ['done', 'Hecho', fin]].map(([st, name, l]) =>
    `<section class="kcol" data-st="${st}"><h3>${name} <span>${l.length}</span></h3>${l.map(card).join('') || '<p class="free">Nada</p>'}</section>`).join('')}</div>
    <p class="hint" style="text-align:center">Mantén pulsada una tarjeta y llévala a otra columna (o suéltala sin moverla para ver más opciones).</p>`;
}
// --- Proyectos ---
let projId = null, projColor = 'azul', projDelArmed = false;
function openProject(id) {
  const p = id ? projects.find(x => x.id === id) : null;
  projId = p ? p.id : null; projColor = p ? p.color : COLORS[projects.length % COLORS.length]; projDelArmed = false;
  $('#projTitle').textContent = p ? 'Editar proyecto' : 'Nuevo proyecto';
  $('#projName').value = p ? p.name : ''; $('#projDue').value = p ? p.due : ''; $('#projNotes').value = p ? p.notes : '';
  $('#projDone').hidden = !p; $('#projDone').textContent = p?.done ? 'Volver a abrirlo' : '✓ Proyecto terminado';
  $('#projDel').hidden = !p; $('#projDel').textContent = 'Borrar proyecto';
  renderProjForm(); openSheet('#projSheet');
  if (!p) setTimeout(() => $('#projName').focus(), 60);
}
function renderProjForm() {
  $('#projColors').innerHTML = COLORS.map(c => `<button type="button" class="swatch${projColor === c ? ' on' : ''}" data-pc="${c}" style="background:${colorVar(c)}" aria-label="${c}"></button>`).join('');
  $('#projDueText').textContent = $('#projDue').value ? longDate($('#projDue').value) : 'Sin fecha límite';
}
$('#projColors').addEventListener('click', e => { const b = e.target.closest('[data-pc]'); if (b) { projColor = b.dataset.pc; renderProjForm(); } });
$('#projDue').addEventListener('change', renderProjForm);
$('#projSheet').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#projName').value.trim(); if (!name) { $('#projName').focus(); return; }
  const old = projId ? projects.find(x => x.id === projId) : null;
  const p = { ...(old || { id: 'p' + uid(), created: Date.now(), order: Date.now(), done: false }), name, color: projColor, due: $('#projDue').value, notes: $('#projNotes').value.trim() };
  saveRow('projects', p); closeSheets();
  if (!old) { view = 'sinfecha'; listSel = 'p:' + p.id; $('#scroller').scrollTop = 0; }
  render();
});
$('#projDone').addEventListener('click', () => { const p = projects.find(x => x.id === projId); if (!p) return; saveRow('projects', { ...p, done: !p.done }); closeSheets(); showToast(p.done ? `Abierto otra vez: ${p.name}` : `🎉 ¡Proyecto terminado! ${p.name}`); render(); });
$('#projDel').addEventListener('click', () => {
  const p = projects.find(x => x.id === projId); if (!p) return;
  if (!projDelArmed) { projDelArmed = true; $('#projDel').textContent = 'Toca otra vez: las tareas y notas se quedan, solo sin proyecto'; return; }
  const tl = tasks.filter(t => t.project === p.id), nl = notes.filter(n => n.project === p.id), ts = snapshot(tl);
  tl.forEach(t => { t.project = ''; }); if (tl.length) store.putMany(tl).catch(writeFailed);
  nl.forEach(n => saveRow('notes', { ...n, project: '' }));
  dropRow('projects', p.id); closeSheets(); if (listSel === 'p:' + p.id) listSel = null;
  showToast(`Proyecto borrado: ${p.name}`, () => { saveRow('projects', p); restore(ts); nl.forEach(n => saveRow('notes', n)); });
  render();
});
function projOptions(sel) { return `<option value="">Sin proyecto</option>` + projects.filter(p => !p.done || p.id === sel).map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>📁 ${esc(p.name)}</option>`).join(''); }

// --- Compra ---
let shopEdit = null;
const shopRowHTML = s => `<div class="shoprow${s.done ? ' done' : ''}" style="--c:var(--accent)"><button class="check" data-act="shoptoggle" data-id="${s.id}" aria-label="${s.done ? 'Sacar del carro' : 'Al carro'}: ${esc(s.name)}">${TICK('var(--surface)')}</button><span class="sn" data-act="shopedit" data-id="${s.id}">${esc(s.name)}</span></div>`
  + (shopEdit === s.id ? `<div class="shopedit"><span class="label">¿En qué sección va?</span><div class="chips wrap">${SHOP_SECS.map(([k, i, n]) => `<button type="button" class="chip ${s.sec === k ? 'on' : ''}" data-act="shopsec" data-id="${s.id}" data-sec="${k}">${i} ${n}</button>`).join('')}</div><button type="button" class="btn danger small" data-act="shopdel" data-id="${s.id}">Quitar de la lista</button></div>` : '');
function shopHTML() {
  const pend = shop.filter(s => !s.done), done = shop.filter(s => s.done);
  let h = `<form class="quick" id="shopForm"><input class="inp" type="text" id="shopInput" placeholder="Añadir… (varias con comas: leche, pan, huevos)" aria-label="Añadir a la compra" autocomplete="off" enterkeyhint="done"><button class="btn primary" type="submit">+</button></form>`;
  if (!shop.length) return h + '<div class="empty"><strong>La lista está vacía</strong><span>Escribe lo que necesitas y lo ordeno por secciones del súper. Toca una cosa para cambiarla de sección.</span></div>';
  SHOP_SECS.forEach(([sec, icon, name]) => {
    const l = pend.filter(s => s.sec === sec).sort((a, b) => a.order - b.order); if (!l.length) return;
    h += `<h2 class="group"><span>${icon} ${name}</span><span>${l.length}</span></h2><div class="shoplist">${l.map(shopRowHTML).join('')}</div>`;
  });
  if (!pend.length) h += '<p class="hint" style="text-align:center;margin:10px 0">¡Lo tienes todo! 🛒</p>';
  if (done.length) h += `<h2 class="group"><span>🛒 En el carro</span><button class="btn ghost small" data-act="shopclear">Vaciar (${done.length})</button></h2><div class="shoplist">${done.sort((a, b) => a.order - b.order).map(shopRowHTML).join('')}</div>`;
  return h;
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'shopForm') return;
  e.preventDefault();
  const names = $('#shopInput').value.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean); if (!names.length) return;
  const learned = extra.prefs.shopMap || {}, have = new Set(shop.filter(s => !s.done).map(s => shopKey(s.name))); let added = 0;
  names.forEach((name, i) => {
    const old = shop.find(s => s.done && shopKey(s.name) === shopKey(name));
    if (have.has(shopKey(name))) return;
    if (old) { saveRow('shop', { ...old, done: false, order: Date.now() + i }); added++; return; }
    saveRow('shop', { id: 's' + uid(), name: cap(name), sec: shopSection(name, learned), done: false, order: Date.now() + i }); added++;
  });
  $('#shopInput').value = ''; if (!added) showToast('Ya estaba en la lista');
  render(); $('#shopInput')?.focus();
});

// ---------- Tarjeta de nota (en Notas y en los proyectos) ----------
const noteLines = body => String(body || '').split('\n').map(l => l.replace(/^\[ \] ?/, '☐ ').replace(/^\[x\] ?/i, '☑ ')).filter(l => l.trim());
const noteName = n => n.journal ? `Diario · ${cap(parseISO(n.journal).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}` : (n.title || noteLines(n.body)[0] || 'Nota sin título');
function noteCardHTML(n) {
  const lines = noteLines(n.body).slice(n.title || n.journal ? 0 : 1, (n.title || n.journal ? 0 : 1) + 4), p = n.project ? projects.find(x => x.id === n.project) : null;
  const when = new Date(n.updated).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `<button class="ncard${n.journal ? ' journal' : ''}" data-act="nopen" data-id="${n.id}">${n.photos[0] ? `<img data-file="${n.photos[0]}" alt="">` : ''}
    <b>${n.pinned ? '📌 ' : n.journal ? '📓 ' : ''}${esc(noteName(n))}</b>${lines.length ? `<span class="nprev">${lines.map(esc).join('<br>')}</span>` : ''}
    <small>${[when, n.folder ? '📁 ' + esc(n.folder) : '', p ? esc(p.name) : '', n.photos.length > 1 ? `🖼 ${n.photos.length}` : ''].filter(Boolean).join(' · ')}</small></button>`;
}

// ---------- Fotos y dibujos: se guardan aparte (en "files") y se cargan cuando hacen falta ----------
const fileCache = new Map();
async function putFile(data, kind) {
  const id = 'f' + uid(); fileCache.set(id, data);
  if (store.fb) await store.fb.setDoc(store.ref('files', id), { data, kind, created: Date.now() });
  else { try { localStorage.setItem('mis-tareas-file-' + id, data); } catch {} }
  return id;
}
async function getFile(id) {
  if (fileCache.has(id)) return fileCache.get(id);
  let d = null;
  try { if (store.fb) { const s = await store.fb.getDoc(store.ref('files', id)); d = s.exists() ? s.data().data : null; } else d = localStorage.getItem('mis-tareas-file-' + id); }
  catch (e) { logError(e.message, 'foto'); }
  if (d) fileCache.set(id, d);
  return d;
}
function delFile(id) { fileCache.delete(id); (store.fb ? store.fb.deleteDoc(store.ref('files', id)) : Promise.resolve(localStorage.removeItem('mis-tareas-file-' + id))).catch(() => {}); }
function hydrateImgs(root) { (root || document).querySelectorAll('img[data-file]:not([src])').forEach(async img => { const d = await getFile(img.dataset.file); if (d) img.src = d; else img.classList.add('missing'); }); }
// Achica la foto (máx. 1400 px) para que quepa y cargue rápido
async function imageToData(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo abrir la foto')); i.src = url; });
    let s = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight)), q = 0.78;
    for (let k = 0; k < 7; k++) {
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL('image/jpeg', q); if (d.length < 900000) return d;
      s *= 0.8; q = Math.max(0.5, q - 0.07);
    }
    throw new Error('La foto es demasiado grande');
  } finally { URL.revokeObjectURL(url); }
}
// Dónde van las fotos: la nota que estás editando o una tarea
function photoList(ctx) { return ctx.kind === 'note' ? (noteDraft?.photos || []) : (tasks.find(t => t.id === ctx.id)?.photos || []); }
function setPhotoList(ctx, list) {
  if (ctx.kind === 'note') { if (!noteDraft) return; noteDraft.photos = list; renderNotePhotos(); saveNote(); }
  else { const t = tasks.find(x => x.id === ctx.id); if (!t) return; t.photos = list; store.put(t).catch(writeFailed); render(); }
}
async function addPhotos(files, ctx) {
  const list = [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)); if (!list.length) return;
  showToast(list.length > 1 ? `Guardando ${list.length} fotos…` : 'Guardando la foto…');
  for (const f of list) {
    try { const data = await imageToData(f), id = await putFile(data, 'photo'); setPhotoList(ctx, [...photoList(ctx), id]); }
    catch (e) { logError(e.message, 'foto'); showToast(e.message || 'No se pudo guardar la foto'); return; }
  }
  showToast(list.length > 1 ? `${list.length} fotos guardadas` : 'Foto guardada');
}
const photosHTML = (ids, ctxAttr) => ids.length ? `<div class="nphotos">${ids.map(id => `<button type="button" class="nphoto" data-photo="${id}" ${ctxAttr}><img data-file="${id}" alt="Foto"></button>`).join('')}</div>` : '';
// --- Ver una foto en grande ---
let viewer = null;
async function openViewer(id, ctx) {
  viewer = { id, ctx }; const v = $('#photoView');
  $('#pvImg').removeAttribute('src'); v.hidden = false; $('#pvDel').textContent = 'Borrar';
  const d = await getFile(id); if (viewer?.id === id && d) $('#pvImg').src = d;
}
function closeViewer() { $('#photoView').hidden = true; viewer = null; }
$('#pvClose').addEventListener('click', closeViewer);
$('#pvDel').addEventListener('click', () => {
  if (!viewer) return;
  if ($('#pvDel').textContent === 'Borrar') { $('#pvDel').textContent = '¿Seguro? Toca otra vez'; return; }
  const { id, ctx } = viewer; setPhotoList(ctx, photoList(ctx).filter(x => x !== id)); delFile(id); closeViewer();
});
$('#pvDraw').addEventListener('click', async () => {
  if (!viewer) return; const { id, ctx } = viewer, d = await getFile(id); closeViewer();
  openDraw(d, async nd => { const nid = await putFile(nd, 'draw'); setPhotoList(ctx, photoList(ctx).map(x => x === id ? nid : x)); delFile(id); });
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-photo]'); if (!b) return;
  openViewer(b.dataset.photo, b.dataset.ptask ? { kind: 'task', id: b.dataset.ptask } : { kind: 'note' });
});

// ---------- Dibujar (con el Apple Pencil o con el dedo) ----------
const DRAW_COLORS = ['#1b1e1c', '#2747c9', '#c92a2a', '#2b8a3e', '#e8590c', 'rgba(255,212,59,.45)'];
const DRAW_SIZES = [2, 4, 8];
let draw = null;
function openDraw(bgData, onSave) {
  draw = { strokes: [], cur: null, color: DRAW_COLORS[0], size: 4, eraser: false, bg: null, onSave, pen: false };
  $('#drawPad').hidden = false; document.body.classList.add('drawing');
  sizeCanvas();
  if (bgData) { const i = new Image(); i.onload = () => { if (draw) { draw.bg = i; redraw(); } }; i.src = bgData; }
  renderDrawTools(); redraw();
}
function closeDraw() { $('#drawPad').hidden = true; document.body.classList.remove('drawing'); draw = null; }
function sizeCanvas() {
  const c = $('#drawCanvas'), r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); Object.assign(draw, { dpr, w: r.width, h: r.height });
}
function renderDrawTools() {
  $('#drawColors').innerHTML = DRAW_COLORS.map((c, i) => `<button type="button" class="dcol${!draw.eraser && draw.color === c ? ' on' : ''}" data-dc="${i}" style="background:${c}" aria-label="${i === 5 ? 'Rotulador' : 'Color'}"></button>`).join('');
  $('#drawSizes').innerHTML = DRAW_SIZES.map(s => `<button type="button" class="dsz${draw.size === s ? ' on' : ''}" data-ds="${s}" aria-label="Grosor ${s}"><i style="width:${s + 3}px;height:${s + 3}px"></i></button>`).join('');
  $('#drawEraser').setAttribute('aria-pressed', draw.eraser);
}
function paintStroke(g, s) {
  const p = s.pts; if (!p.length) return;
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = s.color;
  if (p.length === 1) { g.fillStyle = s.color; g.beginPath(); g.arc(p[0].x, p[0].y, s.size * (0.5 + p[0].p) / 2, 0, 7); g.fill(); return; }
  for (let i = 1; i < p.length; i++) { g.lineWidth = s.size * (0.5 + p[i].p); g.beginPath(); g.moveTo(p[i - 1].x, p[i - 1].y); g.lineTo(p[i].x, p[i].y); g.stroke(); }
}
function redraw() {
  if (!draw) return;
  const g = $('#drawCanvas').getContext('2d');
  g.setTransform(draw.dpr, 0, 0, draw.dpr, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, draw.w, draw.h);
  if (draw.bg) { const b = draw.bg, s = Math.min(draw.w / b.naturalWidth, draw.h / b.naturalHeight); g.drawImage(b, (draw.w - b.naturalWidth * s) / 2, (draw.h - b.naturalHeight * s) / 2, b.naturalWidth * s, b.naturalHeight * s); }
  draw.strokes.forEach(s => paintStroke(g, s)); if (draw.cur) paintStroke(g, draw.cur);
}
const drawPt = e => { const r = $('#drawCanvas').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pointerType === 'pen' ? Math.max(0.1, e.pressure || 0.5) : 0.5 }; };
// La goma borra trazos enteros (la foto de debajo no se toca)
function eraseAt(pt) { const r = 12; const n = draw.strokes.length; draw.strokes = draw.strokes.filter(s => !s.pts.some(q => Math.hypot(q.x - pt.x, q.y - pt.y) < r + s.size)); if (draw.strokes.length !== n) redraw(); }
$('#drawCanvas').addEventListener('pointerdown', e => {
  if (!draw) return;
  if (e.pointerType === 'pen') draw.pen = true; else if (draw.pen && e.pointerType === 'touch') return; // con el Pencil, la mano no pinta
  e.preventDefault(); try { e.target.setPointerCapture(e.pointerId); } catch {}
  const pt = drawPt(e);
  if (draw.eraser) { draw.erasing = e.pointerId; eraseAt(pt); return; }
  draw.cur = { color: draw.color, size: draw.size, pts: [pt], id: e.pointerId }; redraw();
});
$('#drawCanvas').addEventListener('pointermove', e => {
  if (!draw) return;
  if (draw.erasing === e.pointerId) { (e.getCoalescedEvents?.() || [e]).forEach(x => eraseAt(drawPt(x))); return; }
  const s = draw.cur; if (!s || s.id !== e.pointerId) return;
  const g = $('#drawCanvas').getContext('2d'); g.setTransform(draw.dpr, 0, 0, draw.dpr, 0, 0);
  (e.getCoalescedEvents?.() || [e]).forEach(x => { s.pts.push(drawPt(x)); paintStroke(g, { ...s, pts: s.pts.slice(-2) }); });
});
const drawUp = e => { if (!draw) return; if (draw.erasing === e.pointerId) { draw.erasing = null; return; } if (draw.cur && draw.cur.id === e.pointerId) { draw.strokes.push(draw.cur); draw.cur = null; } };
$('#drawCanvas').addEventListener('pointerup', drawUp);
$('#drawCanvas').addEventListener('pointercancel', drawUp);
$('#drawColors').addEventListener('click', e => { const b = e.target.closest('[data-dc]'); if (!b) return; draw.color = DRAW_COLORS[+b.dataset.dc]; draw.eraser = false; if (+b.dataset.dc === 5 && draw.size < 8) draw.size = 8; renderDrawTools(); });
$('#drawSizes').addEventListener('click', e => { const b = e.target.closest('[data-ds]'); if (!b) return; draw.size = +b.dataset.ds; renderDrawTools(); });
$('#drawEraser').addEventListener('click', () => { draw.eraser = !draw.eraser; renderDrawTools(); });
$('#drawUndo').addEventListener('click', () => { draw.strokes.pop(); redraw(); });
$('#drawClear').addEventListener('click', () => { if (!draw.strokes.length) return; draw.cleared = draw.strokes; draw.strokes = []; redraw(); });
$('#drawCancel').addEventListener('click', () => { if (draw && draw.strokes.length && $('#drawCancel').textContent === 'Cancelar') { $('#drawCancel').textContent = '¿Descartar?'; setTimeout(() => { $('#drawCancel').textContent = 'Cancelar'; }, 2500); return; } $('#drawCancel').textContent = 'Cancelar'; closeDraw(); });
$('#drawSave').addEventListener('click', async () => {
  if (!draw) return;
  if (!draw.strokes.length && !draw.bg) { closeDraw(); return; }
  // Sin foto debajo, se recorta a lo dibujado (con un poco de margen)
  const src = $('#drawCanvas'), D = draw.dpr; let bx = 0, by = 0, bw = src.width, bh = src.height;
  if (!draw.bg) {
    const pts = draw.strokes.flatMap(st => st.pts.map(q => [q.x, q.y, st.size])), pad = 24;
    const x0 = Math.max(0, Math.min(...pts.map(q => q[0] - q[2])) - pad), y0 = Math.max(0, Math.min(...pts.map(q => q[1] - q[2])) - pad);
    const x1 = Math.min(draw.w, Math.max(...pts.map(q => q[0] + q[2])) + pad), y1 = Math.min(draw.h, Math.max(...pts.map(q => q[1] + q[2])) + pad);
    const cw = Math.max(200, x1 - x0), ch = Math.max(160, y1 - y0);
    bx = Math.round(Math.max(0, Math.min(x0, draw.w - cw)) * D); by = Math.round(Math.max(0, Math.min(y0, draw.h - ch)) * D); bw = Math.round(Math.min(cw, draw.w) * D); bh = Math.round(Math.min(ch, draw.h) * D);
  }
  const s = Math.min(1, 1600 / bw), c = document.createElement('canvas');
  c.width = Math.round(bw * s); c.height = Math.round(bh * s); c.getContext('2d').drawImage(src, bx, by, bw, bh, 0, 0, c.width, c.height);
  let data = c.toDataURL('image/png'); if (data.length > 900000) data = c.toDataURL('image/jpeg', 0.85);
  const cb = draw.onSave; closeDraw();
  try { await cb(data); showToast('Dibujo guardado'); } catch (e) { logError(e.message, 'dibujo'); showToast('No se pudo guardar el dibujo'); }
});
addEventListener('resize', () => { if (draw) { sizeCanvas(); redraw(); } });

// ---------- Notas ----------
let noteFolder = '', noteQuery = '', folderAdding = false;
const noteFolders = () => [...new Set([...(extra.prefs.noteFolders || []), ...notes.map(n => n.folder).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'es'));
const journalOf = d => notes.find(n => n.journal === d);
const JOURNAL_TPL = '¿Qué ha ido bien hoy?\n\n\n¿Qué podría haber ido mejor?\n\n\nAlgo que agradezco:\n\n\nMañana quiero:\n';
const journalEmpty = n => n.journal && n.body.trim() === JOURNAL_TPL.trim();
function openJournal(d) { const n = journalOf(d); if (n) openNote(n.id); else openNote(null, { id: 'j' + d, journal: d, body: JOURNAL_TPL }); }
function notesViewHTML() {
  const today = todayISO(), jt = journalOf(today), folders = noteFolders(), q = fold(noteQuery.trim());
  let h = `<div class="nbar"><input class="inp" type="search" id="noteSearch" placeholder="🔍 Buscar en las notas" value="${esc(noteQuery)}" autocomplete="off" aria-label="Buscar en las notas"></div>`;
  if (on('diario') && !q) h += `<button class="hableft" data-act="journal" data-d="${today}"><span>📓</span><span><b>Diario de hoy</b><small>${jt && !journalEmpty(jt) ? 'Ya has escrito hoy · toca para seguir' : '¿Qué tal ha ido el día?'}</small></span><span class="go">›</span></button>`;
  h += `<div class="chips nfold">${[['', 'Todas'], ['📌', '📌 Fijadas'], ...(on('diario') ? [['📓', '📓 Diario']] : []), ...folders.map(f => [f, '📁 ' + f])].map(([v, l]) => `<button class="chip" data-act="nfolder" data-v="${esc(v)}" aria-pressed="${noteFolder === v}">${esc(l)}</button>`).join('')}<button class="chip edit" data-act="nnewfolder">+ Carpeta</button></div>`;
  if (folderAdding) h += `<form class="partadd" id="folderForm"><input class="inp" type="text" id="folderInput" placeholder="Nombre de la carpeta" maxlength="40" autocomplete="off"><button class="btn primary" type="submit">Crear</button></form>`;
  let list = notes.filter(n => noteFolder === '📓' ? n.journal : noteFolder === '📌' ? n.pinned : noteFolder ? n.folder === noteFolder : true)
    .filter(n => !q || fold(`${n.title} ${n.body} ${n.folder}`).includes(q))
    .filter(n => !journalEmpty(n));
  list.sort(noteFolder === '📓' ? (a, b) => b.journal.localeCompare(a.journal) : (a, b) => (b.pinned - a.pinned) || b.updated - a.updated);
  if (!list.length) h += `<div class="empty"><strong>${q ? `Nada con “${esc(noteQuery)}”` : noteFolder === '📓' ? 'Aún no has escrito en el diario' : 'Aún no hay notas'}</strong><span>${q ? '' : 'Pulsa + para escribir una. Puedes poner listas con casillas, fotos y dibujos.'}</span></div>`;
  else h += `<div class="ngrid">${list.map(noteCardHTML).join('')}</div>`;
  if (noteFolder && !'📌📓'.includes(noteFolder) && !list.length) h += `<button class="btn ghost block" data-act="ndelfolder">Quitar la carpeta “${esc(noteFolder)}”</button>`;
  return h;
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'folderForm') return; e.preventDefault();
  const name = $('#folderInput').value.trim().slice(0, 40); folderAdding = false;
  if (name) { extra.prefs = { ...extra.prefs, noteFolders: [...new Set([...(extra.prefs.noteFolders || []), name])] }; store.saveExtra('prefs').catch(writeFailed); noteFolder = name; }
  render();
});
document.addEventListener('input', e => { if (e.target.id === 'noteSearch') { noteQuery = e.target.value; render(); } });
// --- Editor: bloques de texto y casillas ---
let noteDraft = null, nBlocks = [], noteTimer = null, nFocus = 0, noteDelArmed = false;
const parseBlocks = body => {
  const out = [];
  String(body || '').split('\n').forEach(line => {
    const m = line.match(/^\[( |x)\] ?(.*)$/i);
    if (m) out.push({ t: 'check', on: m[1].toLowerCase() === 'x', v: m[2] });
    else { const last = out[out.length - 1]; if (last && last.t === 'text') last.v += '\n' + line; else out.push({ t: 'text', v: line }); }
  });
  if (!out.length || out[out.length - 1].t === 'check') out.push({ t: 'text', v: '' });
  return out;
};
const serializeBlocks = bl => bl.map(b => b.t === 'check' ? `[${b.on ? 'x' : ' '}] ${b.v.replace(/\n/g, ' ')}` : b.v).join('\n');
function openNote(id, preset = {}) {
  let n = id ? notes.find(x => x.id === id) : null;
  if (!n) n = { id: preset.id || 'n' + uid(), ...cleanNote({ folder: preset.journal ? '' : preset.folder ?? (noteFolder && !'📌📓'.includes(noteFolder) && view === 'notas' ? noteFolder : ''), project: preset.project || '', journal: preset.journal || '', body: preset.body || '', title: '' }) };
  noteDraft = structuredClone(n); nBlocks = parseBlocks(n.body); nFocus = 0; noteDelArmed = false;
  $('#noteTitle').value = n.title; $('#noteTitle').hidden = !!n.journal;
  const folders = noteFolders();
  $('#noteFolder').innerHTML = `<option value="">Sin carpeta</option>${folders.map(f => `<option value="${esc(f)}">📁 ${esc(f)}</option>`).join('')}`; $('#noteFolder').value = n.folder;
  $('#noteProj').innerHTML = projOptions(n.project);
  $('#noteFolder').closest('.grid2').hidden = !!n.journal;
  renderNoteMeta(); renderNoteBlocks(); renderNotePhotos(); renderNoteLinks();
  openSheet('#noteSheet');
  if (!id && !n.journal) setTimeout(() => $('#noteTitle').focus(), 80);
}
function renderNoteMeta() {
  const n = noteDraft, md = n.journal ? extra.mood[n.journal] : null;
  $('#noteMeta').innerHTML = n.journal ? `📓 <b>${cap(parseISO(n.journal).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</b>${md?.m ? ` · ánimo ${'●'.repeat(md.m)}${'○'.repeat(Math.max(0, 5 - md.m))}` : ''}` : (notes.some(x => x.id === n.id) ? `Editada ${new Date(n.updated).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Nota nueva');
  $('#notePin').setAttribute('aria-pressed', !!n.pinned); $('#notePin').classList.toggle('on', !!n.pinned);
  $('#noteDel').textContent = noteDelArmed ? '¿Borrar?' : '🗑';
}
const autosize = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
function renderNoteBlocks(focusI, atEnd = true) {
  $('#noteBlocks').innerHTML = nBlocks.map((b, i) => b.t === 'check'
    ? `<div class="nb-c${b.on ? ' on' : ''}" data-i="${i}"><button type="button" class="nbx" data-nb="tick" aria-pressed="${b.on}" aria-label="Hecho">${TICK('var(--surface)')}</button><input class="nb-ci" data-nb="v" value="${esc(b.v)}" enterkeyhint="next" aria-label="Elemento de la lista"></div>`
    : `<textarea class="nb-t" data-nb="v" data-i="${i}" rows="1" placeholder="${nBlocks.length === 1 ? 'Escribe aquí…' : ''}" aria-label="Texto">${esc(b.v)}</textarea>`).join('');
  $('#noteBlocks').querySelectorAll('textarea').forEach(autosize);
  if (focusI !== undefined) { const el = $('#noteBlocks').querySelector(`[data-i="${focusI}"]`); const f = el?.matches('textarea') ? el : el?.querySelector('input'); if (f) { f.focus(); const L = atEnd ? f.value.length : 0; try { f.setSelectionRange(L, L); } catch {} } }
}
const blockI = el => +el.closest('[data-i]').dataset.i;
$('#noteBlocks').addEventListener('focusin', e => { if (e.target.closest('[data-i]')) nFocus = blockI(e.target); });
$('#noteBlocks').addEventListener('input', e => { if (e.target.dataset.nb !== 'v') return; nBlocks[blockI(e.target)].v = e.target.value; if (e.target.matches('textarea')) autosize(e.target); scheduleNoteSave(); });
$('#noteBlocks').addEventListener('click', e => { const b = e.target.closest('[data-nb=tick]'); if (!b) return; const i = blockI(b); nBlocks[i].on = !nBlocks[i].on; renderNoteBlocks(); scheduleNoteSave(); });
$('#noteBlocks').addEventListener('keydown', e => {
  const el = e.target; if (el.dataset.nb !== 'v') return;
  const i = blockI(el), b = nBlocks[i];
  if (b.t === 'check' && e.key === 'Enter') {
    e.preventDefault();
    if (!b.v.trim()) { nBlocks[i] = { t: 'text', v: '' }; if (nBlocks[i + 1]?.t === 'text' && !nBlocks[i + 1].v) nBlocks.splice(i + 1, 1); renderNoteBlocks(i); }
    else { nBlocks.splice(i + 1, 0, { t: 'check', on: false, v: '' }); renderNoteBlocks(i + 1); }
    scheduleNoteSave();
  } else if (e.key === 'Backspace' && !el.value && i > 0) {
    e.preventDefault(); nBlocks.splice(i, 1); renderNoteBlocks(i - 1); scheduleNoteSave();
  }
});
$('#noteCheck').addEventListener('click', () => {
  const i = Math.min(nFocus, nBlocks.length - 1), b = nBlocks[i];
  if (b && b.t === 'text' && !b.v.trim()) { nBlocks[i] = { t: 'check', on: false, v: '' }; if (i === nBlocks.length - 1) nBlocks.push({ t: 'text', v: '' }); renderNoteBlocks(i); }
  else { nBlocks.splice(i + 1, 0, { t: 'check', on: false, v: '' }); renderNoteBlocks(i + 1); }
  scheduleNoteSave();
});
function renderNotePhotos() { $('#notePhotos').innerHTML = photosHTML(noteDraft?.photos || [], ''); hydrateImgs($('#notePhotos')); }
function scheduleNoteSave() { clearTimeout(noteTimer); noteTimer = setTimeout(() => saveNote(), 700); }
function saveNote(final) {
  clearTimeout(noteTimer); if (!noteDraft) return;
  const n = noteDraft;
  n.title = $('#noteTitle').value.trim(); n.body = serializeBlocks(nBlocks).replace(/\n+$/, '\n'); n.folder = $('#noteFolder').value; n.project = $('#noteProj').value;
  const exists = notes.find(x => x.id === n.id);
  const empty = !n.title && !n.body.trim() && !n.photos.length && !n.links.length;
  if (empty || (journalEmpty(n) && !n.photos.length && !n.links.length)) { if (final && exists) dropRow('notes', n.id); return; }
  const same = exists && ['title', 'body', 'folder', 'project', 'pinned'].every(k => exists[k] === n[k]) && String(exists.photos) === String(n.photos) && JSON.stringify(exists.links) === JSON.stringify(n.links);
  if (same) return;
  n.updated = Date.now(); saveRow('notes', structuredClone(n));
}
$('#noteTitle').addEventListener('input', scheduleNoteSave);
$('#noteFolder').addEventListener('change', () => saveNote());
$('#noteProj').addEventListener('change', () => saveNote());
$('#noteDone').addEventListener('click', () => { closeSheets(); render(); });
$('#notePin').addEventListener('click', () => { noteDraft.pinned = !noteDraft.pinned; renderNoteMeta(); saveNote(); });
$('#noteDel').addEventListener('click', () => {
  if (!noteDelArmed) { noteDelArmed = true; renderNoteMeta(); setTimeout(() => { noteDelArmed = false; if (noteDraft) renderNoteMeta(); }, 3000); return; }
  const n = notes.find(x => x.id === noteDraft.id), files = [...noteDraft.photos]; noteDraft = null; closeSheets();
  if (!n) { files.forEach(delFile); render(); return; }
  dropRow('notes', n.id); let undone = false;
  showToast(`Nota borrada: ${noteName(n)}`, () => { undone = true; saveRow('notes', n); });
  setTimeout(() => { if (!undone && !notes.some(x => x.id === n.id)) files.forEach(delFile); }, 6000);
  render();
});
$('#notePhotoIn').addEventListener('change', e => { addPhotos(e.target.files, { kind: 'note' }); e.target.value = ''; });
$('#noteDraw').addEventListener('click', () => openDraw(null, async data => { const id = await putFile(data, 'draw'); setPhotoList({ kind: 'note' }, [...photoList({ kind: 'note' }), id]); }));
$('#noteLink').addEventListener('click', () => { saveNote(); openLinkPicker({ k: 'note', id: noteDraft.id }); });
function renderNoteLinks() { $('#noteLinks').innerHTML = linksHTML(noteDraft.links, { k: 'note', id: noteDraft.id }); }

// ---------- Enlaces entre notas, tareas, proyectos, libros y películas ----------
const LINK_ICON = { note: '📝', task: '☑️', proj: '📁', books: '📚', movies: '🎬' };
function linkTarget(k, id) {
  if (k === 'note') { const n = notes.find(x => x.id === id); return n && noteName(n); }
  if (k === 'task') return tasks.find(x => x.id === id)?.title;
  if (k === 'proj') return projects.find(x => x.id === id)?.name;
  return shelf[k]?.items.find(x => x.id === id)?.title;
}
const backlinks = (k, id) => [...notes.filter(n => n.links.some(l => l.k === k && l.id === id)).map(n => ({ k: 'note', id: n.id })), ...tasks.filter(t => (t.links || []).some(l => l.k === k && l.id === id)).map(t => ({ k: 'task', id: t.id }))];
function linksHTML(links, src) {
  const out = (links || []).map(l => ({ ...l, t: linkTarget(l.k, l.id) })).filter(l => l.t), back = src ? backlinks(src.k, src.id).map(l => ({ ...l, t: linkTarget(l.k, l.id) })).filter(l => l.t && !out.some(o => o.k === l.k && o.id === l.id)) : [];
  if (!out.length && !back.length) return '';
  const chip = (l, rm) => `<span class="lchip"><button type="button" data-golink="${l.k}" data-id="${l.id}">${LINK_ICON[l.k]} ${esc(l.t)}</button>${rm ? `<button type="button" class="x" data-unlink="${l.k}" data-id="${l.id}" aria-label="Quitar enlace">✕</button>` : ''}</span>`;
  return `${out.length ? `<div class="links"><span class="label">🔗 Enlaces</span>${out.map(l => chip(l, !!src)).join('')}</div>` : ''}${back.length ? `<div class="links"><span class="label">Enlazado desde</span>${back.map(l => chip(l, false)).join('')}</div>` : ''}`;
}
let linkSrc = null;
function openLinkPicker(src) { linkSrc = src; $('#linkSearch').value = ''; renderLinkResults(); openSheet('#linkSheet'); setTimeout(() => $('#linkSearch').focus(), 80); }
function linkCands(q) {
  const f = s => !q || fold(s || '').includes(fold(q)), out = [], cur = linkSrc ? (linkSrc.k === 'note' ? noteDraft?.links : tasks.find(t => t.id === linkSrc.id)?.links) || [] : [];
  const add = (k, id, t, sub) => { if (linkSrc && k === linkSrc.k && id === linkSrc.id) return; if (cur.some(l => l.k === k && l.id === id)) return; out.push({ k, id, t, sub }); };
  notes.filter(n => !journalEmpty(n) && f(noteName(n) + ' ' + n.body)).sort((a, b) => b.updated - a.updated).forEach(n => add('note', n.id, noteName(n), n.folder));
  projects.filter(p => f(p.name)).forEach(p => add('proj', p.id, p.name, p.done ? 'terminado' : 'proyecto'));
  tasks.filter(t => !t.parentId && (!t.done || q) && f(t.title)).sort(sortTasks).forEach(t => add('task', t.id, t.title, t.date ? friendlyDate(t.date) : 'sin fecha'));
  for (const k of ['books', 'movies']) shelf[k].items.filter(b => f(`${b.title} ${b.author}`)).forEach(b => add(k, b.id, b.title, b.author));
  return out.slice(0, 40);
}
function renderLinkResults() {
  const l = linkCands($('#linkSearch').value.trim());
  $('#linkResults').innerHTML = l.length ? l.map(x => `<button type="button" class="lrow" data-pick="${x.k}" data-id="${x.id}"><span class="li">${LINK_ICON[x.k]}</span><span>${esc(x.t)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></button>`).join('') : '<p class="hint">No encuentro nada con eso.</p>';
}
$('#linkSearch').addEventListener('input', renderLinkResults);
function backFromLinks() { if (linkSrc?.k === 'note' && noteDraft) { openSheet('#noteSheet'); renderNoteLinks(); } else if (linkSrc?.k === 'task') openDetails(linkSrc.id); else closeSheets(); }
$('#linkBack').addEventListener('click', backFromLinks);
$('#linkResults').addEventListener('click', e => {
  const b = e.target.closest('[data-pick]'); if (!b || !linkSrc) return;
  const l = { k: b.dataset.pick, id: b.dataset.id };
  if (linkSrc.k === 'note') { noteDraft.links = [...noteDraft.links, l]; saveNote(); }
  else { const t = tasks.find(x => x.id === linkSrc.id); if (t) { t.links = [...(t.links || []), l]; store.put(t).catch(writeFailed); } }
  backFromLinks();
});
function openLink(k, id) {
  if (k === 'note') { if (noteDraft && $('#noteSheet').classList.contains('show')) saveNote(); openNote(id); }
  else if (k === 'task') openDetails(id);
  else if (k === 'proj') { closeSheets(); if (query) { query = ''; $('#searchInput').value = ''; $('#searchBar').hidden = true; } view = 'sinfecha'; listSel = 'p:' + id; $('#scroller').scrollTop = 0; render(); }
  else { const S = shelf[k], b = S.items.find(x => x.id === id); if (!b) return; S.tab = b.status; S.open = id; S.adding = false; renderShelf(k); openSheet(SHELF[k].sheet); }
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-golink]'); if (g) { e.stopPropagation(); openLink(g.dataset.golink, g.dataset.id); return; }
  const u = e.target.closest('[data-unlink]'); if (!u) return;
  const k = u.dataset.unlink, id = u.dataset.id, keep = l => !(l.k === k && l.id === id);
  if (u.closest('#noteSheet')) { noteDraft.links = noteDraft.links.filter(keep); renderNoteLinks(); saveNote(); }
  else if (u.closest('#detailSheet')) { const t = tasks.find(x => x.id === (detailRoot()?.id)); if (t) { t.links = (t.links || []).filter(keep); store.put(t).catch(writeFailed); renderDetails(); } }
}, true);

// ---------- Pintar ----------
const prioRank = { alta: 0, normal: 1, baja: 2 };
const sortTasks = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99')
  || (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || prioRank[a.prio || 'normal'] - prioRank[b.prio || 'normal'] || (a.created || 0) - (b.created || 0);
function inView(x, v) {
  const t = todayISO();
  if (v === 'hoy') return !x.done && x.date && x.date <= t;
  if (v === 'proximas') return !x.done && x.date && x.date > t;
  if (v === 'sinfecha') return !x.done && !x.date && !x.inbox && !x.someday;
  if (v === 'someday') return !x.done && !x.date && x.someday;
  return x.done;
}
// ---------- Filtros guardados ----------
function filterHit(f, t) {
  const today = todayISO();
  if (f.tags?.length && !f.tags.every(g => (t.tags || []).includes(g))) return false;
  if (f.cat && (t.cat || '') !== f.cat) return false;
  if ((f.flag || f.prio) && !(t.flag || t.prio === 'alta')) return false;
  if (f.loc && !t.loc) return false;
  if (f.proj && t.project !== f.proj) return false;
  if (f.when === 'hoy' && !(t.date && t.date <= today)) return false;
  if (f.when === 'semana' && !(t.date && t.date <= addDays(today, 7))) return false;
  if (f.when === 'atrasadas' && !(t.date && t.date < today)) return false;
  if (f.when === 'confecha' && !t.date) return false;
  if (f.when === 'sinfecha' && t.date) return false;
  return true;
}
const filterMatch = (f, t) => filterHit(f, t) && !t.done;
function renderFilterSheet() {
  $('#fCat').innerHTML = '<option value="">Cualquiera</option>' + cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('#fProj').innerHTML = projOptions('').replace('Sin proyecto', 'Cualquiera');
  const whenTxt = { todo: '', hoy: 'hoy', semana: '7 días', sinfecha: 'sin fecha', atrasadas: 'atrasadas', confecha: 'con fecha' };
  $('#filterList').innerHTML = extra.filters.length ? extra.filters.map(f => `<div class="rwrow"><div><div class="n">☰ ${esc(f.name)}</div><div class="c">${[...(f.tags || []).map(t => '@' + t), f.cat ? catOf(f.cat).name : '', f.flag || f.prio ? '🚩' : '', f.loc ? '📍' : '', f.proj ? '📁 ' + (projects.find(p => p.id === f.proj)?.name || '') : '', whenTxt[f.when] || ''].filter(Boolean).map(esc).join(' · ') || 'todo'} · ${tasks.filter(t => filterMatch(f, t)).length} tareas</div></div>
    <button type="button" class="btn small" data-fl="use" data-id="${f.id}">Ver</button><button type="button" class="x" data-fl="del" data-id="${f.id}" aria-label="Borrar filtro">✕</button></div>`).join('') : '<p class="hint">Aún no tienes filtros.</p>';
}
$('#filterForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#fName').value.trim(); if (!name) { $('#fName').focus(); return; }
  extra.filters.push({ id: 'f' + uid(), name, tags: $('#fTags').value.split(/[,\s]+/).map(normTag).filter(Boolean), cat: $('#fCat').value, flag: $('#fFlag').checked, loc: $('#fLoc').checked, proj: $('#fProj').value, when: $('#fWhen').value });
  store.saveExtra('filters').catch(writeFailed); $('#filterForm').reset(); renderFilterSheet(); render();
});
$('#filterList').addEventListener('click', e => {
  const b = e.target.closest('[data-fl]'); if (!b) return;
  if (b.dataset.fl === 'del') { extra.filters = extra.filters.filter(f => f.id !== b.dataset.id); store.saveExtra('filters').catch(writeFailed); renderFilterSheet(); render(); return; }
  closeSheets(); activeFilter = null; view = 'sinfecha'; listSel = 'f:' + b.dataset.id; $('#scroller').scrollTop = 0; render();
});
$('#openFilters').addEventListener('click', () => { renderFilterSheet(); openSheet('#filterSheet'); });
// ---------- Bandeja rápida: apuntar en dos segundos y organizarlo luego ----------
function inboxHTML() {
  const items = tasks.filter(t => t.inbox && !t.done).sort((a, b) => (a.created || 0) - (b.created || 0));
  return `<form class="quick" id="quickForm"><input class="inp" type="text" id="quickInput" placeholder="Apuntar rápido…" aria-label="Apuntar rápido" enterkeyhint="done" autocomplete="off"><button class="btn primary" type="submit">+</button></form>
    ${items.length ? `<section class="now"><span class="lbl">Bandeja · ${items.length}</span>${items.map(t => `<div class="nowrow"><div><div class="t" data-act="details" data-id="${t.id}">${esc(t.title)}</div></div>
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
  const p = parseQuick(title, cats), dated = p.date || p.time || p.repeat;
  const t = { id: uid(), title: p.title || title, cat: p.cat || guessCat(p.title || title) || '', flag: !!p.prio, date: dated ? (p.date || todayISO()) : '', time: p.time || '', endTime: p.time ? (p.endTime || hhmm(toMin(p.time) + 60)) : '',
    repeat: p.repeat || '', days: p.days || [], every: p.every || 1, nth: p.nth || null, nthDay: p.nthDay ?? null, tags: (p.tags || []).map(normTag), inbox: !dated, done: false, created: Date.now() };
  if (t.cat === 'cumple' && t.date && !t.repeat) t.repeat = 'anual';
  alignStart(t);
  tasks.push(t); store.put(t).catch(writeFailed);
  if (dated) showToast(`Apuntada: ${t.title} · ${friendlyDate(t.date).toLowerCase()}${t.time ? ' ' + t.time : ''}`);
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
  const proj = x.project && view !== 'sinfecha' ? projects.find(p => p.id === x.project) : null, age = ageOn(x, x.date);
  const meta = [
    `<span class="catn" title="${esc(cat.name)}"><span class="dot" style="background:${c}"></span></span>`,
    x.flag ? '<span class="flag" title="Con bandera">🚩</span>' : '',
    x.status === 'doing' && !x.done ? '<span class="doing">▶ Haciendo</span>' : '',
    age ? `<span>🎂 ${age}</span>` : '',
    x.time ? `<span>${x.time}${x.endTime ? '–' + x.endTime : ''}</span>` : '',
    showDate ? `<span class="${late ? 'late' : ''}">${friendlyDate(x.date)}</span>` : '',
    x.repeat ? `<span>↻ ${repeatLabel(x)}${x.until ? ' hasta ' + friendlyDate(x.until).toLowerCase() : ''}</span>` : '',
    x.repeat && !x.done && currentStreak(x) >= 2 ? `<span class="streak">🔥 ${currentStreak(x)}</span>` : '',
    pr.total ? `<span class="prog"><span class="pbar"><i style="width:${pct(pr)}%"></i></span>${pr.done}/${pr.total} · ${pct(pr)}%</span>` : '',
    pr.total && !x.done ? planHTML(x, pr) : '',
    parent ? `<span class="prog"><span class="pbar"><i style="width:${pct(ppr)}%"></i></span>${ppr.done}/${ppr.total} · ${pct(ppr)}%</span>` : '',
    !x.date && x.minutes && !x.done ? `<span>${x.minutes} min</span>` : '',
    x.focus ? `<span>⏱ ${fmtDur(x.focus)}</span>` : '',
    x.done && x.pts ? `<span>+${x.pts} ⭐</span>` : '',
    ...(x.tags || []).map(t => `<span class="tagchip" data-act="tag" data-t="${esc(t)}">@${esc(t)}</span>`),
    proj ? `<span class="projchip">📁 ${esc(proj.name)}</span>` : '',
    (x.photos || []).length ? `<span>🖼 ${x.photos.length}</span>` : '',
    (x.links || []).length ? `<span>🔗 ${x.links.length}</span>` : '',
  ].join('');
  return `<li class="task ${x.done ? 'done' : ''}" data-id="${x.id}" style="--c:${c}">
    <div class="swipe-bg" aria-hidden="true">
      <span class="l"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>${x.done ? 'Pendiente' : 'Hecha'}</span>
      <span class="r">Borrar<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span>
    </div>
    <div class="row">
      <button class="check" data-act="toggle" data-id="${x.id}" aria-label="${x.done ? 'Marcar como pendiente' : 'Completar'}: ${esc(x.title)}">${TICK('var(--surface)')}</button>
      <div class="body" data-act="details" data-id="${x.id}"><div class="t">${parent ? `${esc(parent.title)}<small class="tsub">${esc(x.title)}</small>` : esc(x.title)}</div><div class="meta">${meta}</div>${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ''}</div>
      <button class="more" data-act="details" data-id="${x.id}" aria-label="Ver ${esc(x.title)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
    </div></li>`;
}
const groupedOrFlat = list => {
  const dated = list.filter(x => x.date), undated = list.filter(x => !x.date);
  return (dated.length ? groupedHTML(dated) : '') + (undated.length ? `<h2 class="group"><span>Sin fecha</span><span>${undated.length}</span></h2><ul class="list">${listItemsHTML(undated)}</ul>` : '');
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
    + `<ul class="list">${listItemsHTML(items)}</ul>`).join('');
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
  const exams = tasks.filter(t => !t.done && t.date && t.date >= today && t.date <= next[6] && (t.flag || t.prio === 'alta' || children(t.id).length));
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
let hoyScrolled = '';
function render() {
  renderMain(); fitSleepCharts(); if (!$('#detailSheet').hidden) renderDetails();
  // Al abrir Hoy, la línea de "ahora" queda arriba (una vez por visita)
  const key = view + (hoyEdit ? 'e' : '');
  if (view === 'hoy' && !hoyEdit && hoyScrolled !== key) { const n = $('#list .tl2now'); if (n) { hoyScrolled = key; const sc = $('#scroller'); sc.scrollTop += n.getBoundingClientRect().top - sc.getBoundingClientRect().top - 140; } }
  if (view !== 'hoy' || hoyEdit) hoyScrolled = '';
}
function renderMain() {
  document.body.dataset.view = view;
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#viewTitle').textContent = query ? 'Buscar' : VIEWS[view];
  $('#ptsToday').textContent = `⭐ ${pointsOn(todayISO())}`;
  $('#filters').hidden = (view === 'habitos' || view === 'hoy' || view === 'notas' || (view === 'sinfecha' && (!listSel || listSel === 'compra'))) && !query;
  if (view !== 'hoy') hoyEdit = false;
  $('#openRewards').hidden = !on('recompensas');
  $('#fab').setAttribute('aria-label', view === 'habitos' && !query ? 'Nuevo hábito' : view === 'notas' && !query ? 'Nueva nota' : 'Nueva tarea');
  if (innerWidth >= 820) $('#miniCal').innerHTML = miniCalHTML();
  wxRefresh();
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
    extra.filters.map(f => `<button class="chip" data-sfilter="${f.id}" aria-pressed="${activeFilter === f.id}">☰ ${esc(f.name)}</button>`).join('') +
    `<button class="chip edit" data-filter="edit">Editar</button>`;
  const af = activeFilter ? extra.filters.find(f => f.id === activeFilter) : null;
  if (!af) activeFilter = null;
  if (af && !query) $('#viewTitle').textContent = '☰ ' + af.name;
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
    html = calendarHTML(byCat); count = 0;
    doneCount = tasks.filter(t => t.done && t.date === (calSel || todayISO())).length;
  } else if (view === 'habitos') {
    html = habitsViewHTML();
  } else if (view === 'sinfecha') {
    if (!listSel) html = listasHubHTML(byCat);
    else { const r = listViewHTML(byCat); html = r.html; count = r.count; doneCount = r.doneCount; }
    $('#viewTitle').textContent = listTitle(listSel);
  } else if (view === 'notas') {
    html = notesViewHTML();
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
    if (v === 'hechas') html += progresoHTML();
    if (v === 'hoy') html += (on('bandeja') ? inboxHTML() : '') + (on('ahora') ? nowHTML() : '');
    if (view === 'semana') html += agendaSwitchHTML();
    if (v === 'hoy') html += timerBannerHTML() + (on('planificar') ? planBannerHTML() : '') + (on('animo') ? moodBannerHTML() : '') + (on('repaso') ? reviewBannerHTML() : '') + backupBannerHTML()
      + (on('planificar') ? `<div class="chips" style="margin:2px 0 4px"><button class="chip" data-act="plan">📝 Planificar hoy</button></div>` : '');
    if (v !== 'hechas') {
      if (!list.length) { const [h, p] = EMPTY[v]; html += `<div class="empty"><strong>${h}</strong><span>${p}</span></div>`; }
      else html += v === 'sinfecha' || v === 'someday' ? `<ul class="list">${listItemsHTML(list)}</ul>` : groupedHTML(list);
    }
    if (showDone && done.length) html += `<h2 class="group"><span>${v === 'hoy' ? 'Hechas hoy' : 'Hechas'}</span><span>${done.length}</span></h2><ul class="list">${done.map(taskHTML).join('')}</ul>`;
    $('#clearDone').hidden = !(v === 'hechas' && showDone && done.length);
  }
  // Si estabas escribiendo en la bandeja, no se pierde lo escrito al refrescar
  const ae = document.activeElement, keep = ['quickInput', 'shopInput', 'noteSearch', 'folderInput'].includes(ae?.id) ? { id: ae.id, v: ae.value, s: ae.selectionStart } : null;
  $('#list').innerHTML = html;
  if (keep) { const el = $('#' + keep.id); if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch {} } }
  hydrateImgs($('#list'));
  if (doneCount && !query && view !== 'habitos') {
    $('#showDoneBtn').hidden = false;
    $('#showDoneBtn').textContent = showDone ? 'Ocultar las hechas' : `Ver las hechas (${doneCount})`;
  }
  const pending = tasks.filter(x => !x.done).length;
  const doneToday = tasks.filter(x => x.done && x.doneAt && isoDate(new Date(x.doneAt)) === todayISO()).length;
  $('#stats').textContent = view === 'habitos' || view === 'hoy' || view === 'notas' || (view === 'sinfecha' && (!listSel || listSel === 'compra')) ? '' : `${pending} pendiente${pending === 1 ? '' : 's'} · ${doneToday} hecha${doneToday === 1 ? '' : 's'} hoy`;
  let tipSeen = false; try { tipSeen = localStorage.getItem('tip-swipe') === '1'; } catch {}
  $('#tip').hidden = tipSeen || !count || view === 'habitos' || view === 'notas';
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
  else if (act === 'gtoggle') toggleMany(idsOf(el.dataset.ids));
  else if (act === 'gopen') { const k = el.dataset.key; openGroups.has(k) ? openGroups.delete(k) : openGroups.add(k); const y = $('#scroller').scrollTop; render(); $('#scroller').scrollTop = y; }
  else if (act === 'details') openDetails(id);
  else if (act === 'rall') toggleRoutineAll(id);
  else if (act === 'rdetails') openRoutineDetails(id);
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
  else if (act === 'mvlate') moveTasks(lateTasks().filter(t => (view === 'hoy' || byCatNow(t)) && !children(t.id).length), el.dataset.to);
  else if (act === 'calmore') { listDays = Math.min(366, listDays + 30); render(); }
  else if (act === 'horder') { habOrdering = !habOrdering; render(); }
  else if (act === 'hmove') moveHabit(id, Number(el.dataset.dir));
  else if (act === 'habdone') { try { localStorage.setItem('hab-done', localStorage.getItem('hab-done') === '1' ? '0' : '1'); } catch {} render(); }
  else if (act === 'calmode') { calMode = el.dataset.m; try { localStorage.setItem('cal-mode', calMode); } catch {} if (calMode === 'mes') syncMonth(); render(); }
  else if (act === 'caltoday') { calSel = null; monthOffset = 0; render(); }
  else if (act === 'calprev' || act === 'calnext') calNav(act === 'calnext' ? 1 : -1);
  else if (act === 'calgo') { calSel = el.dataset.d; calMode = 'dia'; syncMonth(); $('#scroller').scrollTop = 0; render(); }
  else if (act === 'calmonth') { calSel = el.dataset.d; calMode = 'mes'; syncMonth(); $('#scroller').scrollTop = 0; render(); }
  else if (act === 'gohabits') { view = 'habitos'; $('#scroller').scrollTop = 0; render(); }
  else if (act === 'move') { const t = tasks.find(x => x.id === id); if (t) moveTasks([t], el.dataset.to); }
  else if (act === 'review') openReview();
  else if (act === 'rewards') { rwArmed = null; renderRewards(); openSheet('#rewardSheet'); }
  else if (act === 'timer') openTimer(id);
  else if (act === 'yday') { selectedDay = selectedDay === el.dataset.d ? null : el.dataset.d; const y = $('#scroller').scrollTop; render(); $('#scroller').scrollTop = y; }
  else if (act === 'edit') openDetails(id);
  else if (act === 'lsel') { listSel = el.dataset.k; showDone = false; $('#scroller').scrollTop = 0; render(); }
  else if (act === 'lback') { listSel = null; showDone = false; $('#scroller').scrollTop = 0; render(); }
  else if (act === 'lboard') { el.dataset.v === '1' ? boards.add(listSel) : boards.delete(listSel); saveBoards(); render(); }
  else if (act === 'pnew') openProject(null);
  else if (act === 'pedit') openProject(id);
  else if (act === 'pnote') openNote(null, { project: id });
  else if (act === 'fnew') { renderFilterSheet(); openSheet('#filterSheet'); setTimeout(() => $('#fName').focus(), 80); }
  else if (act === 'tag') searchTag(el.dataset.t);
  else if (act === 'shoptoggle') { const s = shop.find(x => x.id === id); if (s) { saveRow('shop', { ...s, done: !s.done }); navigator.vibrate?.(8); render(); } }
  else if (act === 'shopedit') { shopEdit = shopEdit === id ? null : id; render(); }
  else if (act === 'shopsec') { const s = shop.find(x => x.id === id); if (s) { saveRow('shop', { ...s, sec: el.dataset.sec }); extra.prefs = { ...extra.prefs, shopMap: { ...(extra.prefs.shopMap || {}), [shopKey(s.name)]: el.dataset.sec } }; store.saveExtra('prefs').catch(writeFailed); shopEdit = null; render(); } }
  else if (act === 'shopdel') { const s = shop.find(x => x.id === id); if (s) { dropRow('shop', id); shopEdit = null; showToast(`Quitado: ${s.name}`, () => saveRow('shop', s)); render(); } }
  else if (act === 'shopclear') { const gone = shop.filter(s => s.done); gone.forEach(s => dropRow('shop', s.id)); showToast(`Carro vaciado (${gone.length})`, () => gone.forEach(s => saveRow('shop', s))); render(); }
  else if (act === 'nfolder') { noteFolder = el.dataset.v; folderAdding = false; render(); }
  else if (act === 'nnewfolder') { folderAdding = !folderAdding; render(); setTimeout(() => $('#folderInput')?.focus(), 30); }
  else if (act === 'ndelfolder') { extra.prefs = { ...extra.prefs, noteFolders: (extra.prefs.noteFolders || []).filter(f => f !== noteFolder) }; store.saveExtra('prefs').catch(writeFailed); noteFolder = ''; render(); }
  else if (act === 'nopen') openNote(id);
  else if (act === 'journal') openJournal(el.dataset.d || todayISO());
});
function searchTag(tag) {
  query = '@' + tag; $('#searchBar').hidden = false; $('#searchBtn').setAttribute('aria-pressed', 'true'); $('#searchInput').value = query; $('#scroller').scrollTop = 0; render();
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  if (query) { query = ''; $('#searchInput').value = ''; $('#searchBar').hidden = true; $('#searchBtn').setAttribute('aria-pressed', 'false'); }
  else if (view === b.dataset.view) { if (view === 'sinfecha' && listSel) { listSel = null; showDone = false; render(); } $('#scroller').scrollTo({ top: 0, behavior: 'smooth' }); return; }
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
