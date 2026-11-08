import { firebaseConfig } from './config.js';
import { parseQuick, fold } from './parse.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLORS = ['violeta', 'naranja', 'verde', 'azul', 'gris', 'rosa', 'rojo', 'amarillo', 'turquesa', 'marron'];
const DEFAULT_CATS = [
  { id: 'evento', name: 'Evento', color: 'violeta' }, { id: 'entreno', name: 'Entreno', color: 'naranja' },
  { id: 'casa', name: 'Casa', color: 'verde' }, { id: 'estudio', name: 'Estudio', color: 'azul' },
  { id: 'trabajo', name: 'Trabajo', color: 'gris' }, { id: 'personal', name: 'Personal', color: 'rosa' },
];
const NO_CAT = { id: '', name: 'Sin categoría', color: 'gris' };
const VIEWS = { hoy: 'Hoy', proximas: 'Próximas', sinfecha: 'Sin fecha', hechas: 'Hechas' };
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
  };
}

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
};
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(tasks)); } catch {} }
function setSync(kind, text) { $('#sync').className = 'sync ' + kind; $('#syncText').textContent = text; }
function writeFailed() { setSync('warn', 'No se guardó el último cambio'); }

const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PEGA');

async function initStore() {
  if (!configured) {
    try { tasks = JSON.parse(localStorage.getItem(LKEY)) || []; } catch { tasks = []; }
    try { cats = JSON.parse(localStorage.getItem(LCATS)) || DEFAULT_CATS; } catch {}
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
      store.fb = null; store.user = null; tasks = []; cats = DEFAULT_CATS; loaded = false;
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
  $('#subNew').value = '';
  $('#sheetTitle').textContent = t ? 'Editar tarea' : 'Nueva tarea';
  $('#submitBtn').textContent = t ? 'Guardar' : 'Añadir';
  $('#deleteBtn').hidden = !t;
  renderCatChips(); renderWhenChips(); renderDays(); renderSubs(); renderDetected();
  openSheet('#taskSheet');
  if (!t) setTimeout(() => $('#title').focus(), 60);
}
$('#fab').addEventListener('click', () => openForm(null));
$('#taskSheet').addEventListener('submit', e => {
  e.preventDefault();
  let title = $('#title').value.trim();
  if (!title) { $('#title').focus(); return; }
  const pending = $('#subNew').value.trim();
  if (pending) formSubs.push({ id: uid(), text: pending, done: false });
  const data = { title, cat: formCat, date: $('#date').value, time: $('#time').value, prio: $('#prio').value,
    repeat: $('#repeat').value, days: $('#repeat').value === 'dias' ? formDays : [], notes: $('#notes').value.trim(),
    subtasks: formSubs.filter(s => s.text.trim()).map(s => ({ ...s, text: s.text.trim() })) };
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
  let t;
  if (editingId) { t = tasks.find(x => x.id === editingId); if (!t) return closeSheets(); Object.assign(t, data); }
  else { t = { id: uid(), done: false, created: Date.now(), ...data }; tasks.push(t); }
  store.put(t).catch(writeFailed);
  closeSheets(); render();
});
$('#deleteBtn').addEventListener('click', () => { const id = editingId; closeSheets(); remove(id); });

// ---------- Acciones ----------
function toggle(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  const spawn = t.done && t.repeat && !t.spawned;
  if (spawn) t.spawned = true;
  store.put(t).catch(writeFailed);
  if (spawn) {
    const { id: _i, done, doneAt, spawned, ...rest } = t;
    const next = { ...rest, id: uid(), done: false, created: Date.now(), date: nextDate(t),
      subtasks: (t.subtasks || []).map(s => ({ ...s, done: false })) };
    tasks.push(next);
    store.put(next).catch(writeFailed);
    showToast(`Siguiente: ${friendlyDate(next.date).toLowerCase()}`, false);
  }
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
function showToast(text, undo) {
  $('#toastText').textContent = text;
  $('#toastUndo').hidden = !undo;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; lastDeleted = null; }, 5000);
}
$('#toastUndo').addEventListener('click', () => {
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

// ---------- Pintar ----------
const prioRank = { alta: 0, normal: 1, baja: 2 };
const sortTasks = (a, b) => (a.date || '9999').localeCompare(b.date || '9999')
  || (a.time || '99').localeCompare(b.time || '99')
  || prioRank[a.prio || 'normal'] - prioRank[b.prio || 'normal'] || (a.created || 0) - (b.created || 0);
function inView(x, v) {
  const t = todayISO();
  if (v === 'hoy') return !x.done && x.date && x.date <= t;
  if (v === 'proximas') return !x.done && x.date && x.date > t;
  if (v === 'sinfecha') return !x.done && !x.date;
  return x.done;
}
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
  } else {
    list = tasks.filter(x => byCat(x) && inView(x, view));
    if (view === 'hechas') list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)); else list.sort(sortTasks);
    if (!list.length) {
      const [h, p] = EMPTY[view];
      $('#list').innerHTML = `<div class="empty"><strong>${h}</strong><span>${p}</span></div>`;
    } else if (view === 'hechas' || view === 'sinfecha') {
      $('#list').innerHTML = `<ul class="list">${list.map(taskHTML).join('')}</ul>`;
    } else {
      const t = todayISO(), groups = new Map();
      list.forEach(x => { const g = x.date < t ? 'Atrasadas' : friendlyDate(x.date); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); });
      $('#list').innerHTML = [...groups].map(([g, items]) =>
        `<h2 class="group ${g === 'Atrasadas' ? 'late' : ''}"><span>${g}</span><span>${items.length}</span></h2><ul class="list">${items.map(taskHTML).join('')}</ul>`).join('');
    }
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
  else openForm(id);
});
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
