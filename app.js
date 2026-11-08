import { firebaseConfig } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CATS = [
  { id: 'evento', name: 'Evento' }, { id: 'entreno', name: 'Entreno' }, { id: 'casa', name: 'Casa' },
  { id: 'estudio', name: 'Estudio' }, { id: 'trabajo', name: 'Trabajo' }, { id: 'personal', name: 'Personal' },
];
const VIEWS = { hoy: 'Hoy', proximas: 'Próximas', sinfecha: 'Sin fecha', hechas: 'Hechas' };
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="var(--surface)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>';
const $ = s => document.querySelector(s);

let tasks = [];
let loaded = false;
let view = 'hoy';
let catFilter = null;
let editingId = null;
let formCat = 'personal';

// ---------- Que no parezca una web ----------
document.addEventListener('gesturestart', e => e.preventDefault());          // pellizcar para zoom (iOS)
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

// ---------- Fechas ----------
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
  const step = x => t.repeat === 'diario' ? addDays(x, 1) : t.repeat === 'semanal' ? addDays(x, 7) : addMonths(x, 1);
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
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function clean(t) {
  return { title: String(t.title || '').slice(0, 300), cat: CATS.some(c => c.id === t.cat) ? t.cat : 'personal',
    date: t.date || '', time: t.time || '', prio: t.prio || 'normal', repeat: t.repeat || '', notes: String(t.notes || ''),
    done: !!t.done, doneAt: t.doneAt || null, created: t.created || Date.now(), spawned: !!t.spawned };
}

// ---------- Almacenamiento ----------
// Con Firebase configurado: base de datos en la nube (sincroniza). Si no, se guarda en este dispositivo.
const LKEY = 'mis-tareas-v1';
const store = {
  fb: null, uid: null,
  async put(t) {
    if (!this.fb) return saveLocal();
    const { doc, setDoc } = this.fb;
    return setDoc(doc(this.fb.db, 'users', this.uid, 'tasks', t.id), clean(t));
  },
  async remove(id) {
    if (!this.fb) return saveLocal();
    const { doc, deleteDoc } = this.fb;
    return deleteDoc(doc(this.fb.db, 'users', this.uid, 'tasks', id));
  },
  async putMany(list) {
    if (!this.fb) { list.forEach(t => { const i = tasks.findIndex(x => x.id === t.id); if (i >= 0) tasks[i] = t; else tasks.push(t); }); return saveLocal(); }
    const { doc, writeBatch } = this.fb;
    for (let i = 0; i < list.length; i += 400) {
      const b = writeBatch(this.fb.db);
      list.slice(i, i + 400).forEach(t => b.set(doc(this.fb.db, 'users', this.uid, 'tasks', t.id), clean(t)));
      await b.commit();
    }
  },
};
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(tasks)); } catch {} }
function setSync(kind, text) { $('#sync').className = 'sync ' + kind; $('#syncText').textContent = text; }
function writeFailed() { setSync('warn', 'No se guardó el último cambio'); }

const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PEGA');

async function initStore() {
  if (!configured) {
    try { tasks = JSON.parse(localStorage.getItem(LKEY)) || []; } catch { tasks = []; }
    loaded = true;
    setSync('warn', 'Solo en este dispositivo');
    $('#accountInfo').textContent = 'La sincronización todavía no está configurada. Las tareas se guardan solo en este dispositivo.';
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
  let unsub = null;

  setupLogin(a, auth);

  auth.onAuthStateChanged(a, user => {
    if (unsub) { unsub(); unsub = null; }
    if (!user) {
      store.fb = null; tasks = []; loaded = false;
      $('#login').hidden = false; $('#logoutBtn').hidden = true;
      render(); return;
    }
    $('#login').hidden = true; $('#logoutBtn').hidden = false;
    $('#accountInfo').textContent = 'Sesión iniciada como ' + user.email;
    store.fb = { db, ...fs }; store.uid = user.uid;
    setSync('', 'Conectando…');
    const slow = setTimeout(() => { if (!loaded) setSync('warn', 'Sin conexión'); }, 10000);
    unsub = fs.onSnapshot(fs.collection(db, 'users', user.uid, 'tasks'), { includeMetadataChanges: true }, snap => {
      tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      loaded = true; clearTimeout(slow);
      if (snap.metadata.fromCache) setSync('warn', 'Sin conexión · se sincroniza al volver');
      else setSync('ok', snap.metadata.hasPendingWrites ? 'Guardando…' : 'Sincronizado');
      render();
    }, () => { clearTimeout(slow); loaded = true; setSync('warn', 'No se pudo sincronizar'); render(); });
  });
  $('#logoutBtn').addEventListener('click', () => { closeSheets(); auth.signOut(a); });
}

function setupLogin(a, auth) {
  const err = m => { $('#loginErr').textContent = m; $('#loginErr').hidden = !m; };
  const msg = e => ({
    'auth/invalid-credential': 'Correo o contraseña incorrectos.', 'auth/wrong-password': 'Correo o contraseña incorrectos.',
    'auth/user-not-found': 'No hay ninguna cuenta con ese correo. Pulsa “Crear cuenta”.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Pulsa “Entrar”.',
    'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
    'auth/invalid-email': 'Ese correo no parece válido.', 'auth/network-request-failed': 'No hay conexión. Prueba otra vez cuando tengas internet.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento y vuelve a probar.',
  })[e.code] || 'No se pudo completar. Inténtalo otra vez.';
  const creds = () => [$('#email').value.trim(), $('#password').value];
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); err('');
    try { await auth.signInWithEmailAndPassword(a, ...creds()); } catch (x) { err(msg(x)); }
  });
  $('#signupBtn').addEventListener('click', async () => {
    err('');
    if (!$('#loginForm').reportValidity()) return;
    try { await auth.createUserWithEmailAndPassword(a, ...creds()); } catch (x) { err(msg(x)); }
  });
  $('#resetBtn').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) return err('Escribe tu correo y vuelve a pulsar.');
    try { await auth.sendPasswordResetEmail(a, email); err(''); $('#loginErr').hidden = false; $('#loginErr').textContent = 'Te he enviado un correo para cambiar la contraseña.'; }
    catch (x) { err(msg(x)); }
  });
}

// ---------- Hojas ----------
let sheetToken = 0;
function openSheet(id) {
  closeSheets(true);
  const s = $(id), scrim = $('#scrim'), token = ++sheetToken;
  s.hidden = false; scrim.hidden = false;
  void s.offsetHeight; // fuerza el estado inicial para que se vea la animación
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
$('#menuBtn').addEventListener('click', () => openSheet('#menuSheet'));

// ---------- Formulario ----------
function renderCatChips() {
  $('#catChips').innerHTML = CATS.map(c =>
    `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${formCat === c.id}"><span class="dot" style="background:var(--${c.id})"></span>${c.name}</button>`).join('');
}
function renderWhenChips() {
  const v = $('#date').value, t = todayISO();
  document.querySelectorAll('#whenChips .chip').forEach(b => {
    const w = b.dataset.when;
    b.setAttribute('aria-pressed', (w === 'today' && v === t) || (w === 'tomorrow' && v === addDays(t, 1)) || (w === 'none' && !v));
  });
}
$('#catChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { formCat = b.dataset.cat; renderCatChips(); } });
$('#whenChips').addEventListener('click', e => {
  const b = e.target.closest('[data-when]'); if (!b) return;
  const w = b.dataset.when;
  $('#date').value = w === 'today' ? todayISO() : w === 'tomorrow' ? addDays(todayISO(), 1) : '';
  renderWhenChips();
});
$('#date').addEventListener('input', renderWhenChips);

function openForm(id) {
  const t = id ? tasks.find(x => x.id === id) : null;
  editingId = t ? t.id : null;
  $('#title').value = t ? t.title : '';
  formCat = t ? t.cat : (catFilter || 'personal');
  $('#date').value = t ? (t.date || '') : (view === 'sinfecha' ? '' : view === 'proximas' ? addDays(todayISO(), 1) : todayISO());
  $('#time').value = t ? (t.time || '') : '';
  $('#prio').value = t ? (t.prio || 'normal') : 'normal';
  $('#repeat').value = t ? (t.repeat || '') : '';
  $('#notes').value = t ? (t.notes || '') : '';
  $('#sheetTitle').textContent = t ? 'Editar tarea' : 'Nueva tarea';
  $('#submitBtn').textContent = t ? 'Guardar' : 'Añadir';
  $('#deleteBtn').hidden = !t;
  renderCatChips(); renderWhenChips();
  openSheet('#taskSheet');
  if (!t) setTimeout(() => $('#title').focus(), 60);
}
$('#fab').addEventListener('click', () => openForm(null));
$('#taskSheet').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#title').value.trim();
  if (!title) { $('#title').focus(); return; }
  const data = { title, cat: formCat, date: $('#date').value, time: $('#time').value,
    prio: $('#prio').value, repeat: $('#repeat').value, notes: $('#notes').value.trim() };
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
    const next = { ...rest, id: uid(), done: false, created: Date.now(), date: nextDate(t) };
    tasks.push(next);
    store.put(next).catch(writeFailed);
    showToast(`Siguiente: ${friendlyDate(next.date).toLowerCase()}`, false);
  }
  navigator.vibrate?.(10);
  render();
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
    info.textContent = `Listo: ${list.length} tareas importadas. Las que ya tenías con el mismo nombre interno se han actualizado.`;
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
  const cat = CATS.find(c => c.id === x.cat) || CATS[5];
  const late = !x.done && x.date && x.date < todayISO();
  const showDate = x.date && (view === 'hechas' || late);
  const meta = [
    `<span class="catn"><span class="dot" style="background:var(--${cat.id})"></span>${cat.name}</span>`,
    x.time ? `<span>${x.time}</span>` : '',
    showDate ? `<span class="${late ? 'late' : ''}">${friendlyDate(x.date)}</span>` : '',
    x.repeat ? `<span>↻ ${({ diario: 'Cada día', semanal: 'Cada semana', mensual: 'Cada mes' })[x.repeat]}</span>` : '',
    x.prio === 'alta' && !x.done ? `<span class="prio">Alta</span>` : '',
  ].join('');
  return `<li class="task ${x.done ? 'done' : ''}" style="--c:var(--${cat.id})">
    <button class="check" data-act="toggle" data-id="${x.id}" aria-label="${x.done ? 'Marcar como pendiente' : 'Completar'}: ${esc(x.title)}">${CHECK}</button>
    <div class="body" data-act="edit" data-id="${x.id}">
      <div class="t">${esc(x.title)}</div>
      <div class="meta">${meta}</div>
      ${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ''}
    </div>
    <button class="more" data-act="edit" data-id="${x.id}" aria-label="Editar ${esc(x.title)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
  </li>`;
}
const EMPTY = {
  hoy: ['Nada pendiente para hoy', 'Pulsa + para apuntar algo.'],
  proximas: ['Nada programado', 'Elige “Mañana” o una fecha al crear una tarea.'],
  sinfecha: ['No hay tareas sin fecha', 'Úsalo para ideas y cosas sin día fijo.'],
  hechas: ['Aún no has completado nada', 'Toca el círculo de una tarea para completarla.'],
};
function render() {
  $('#todayLabel').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#viewTitle').textContent = VIEWS[view];
  const byCat = x => !catFilter || x.cat === catFilter;
  document.querySelectorAll('#tabs button').forEach(b => {
    const v = b.dataset.view;
    b.setAttribute('aria-selected', v === view);
    const badge = b.querySelector('.badge');
    const n = v === 'hoy' ? tasks.filter(x => inView(x, 'hoy')).length : 0;
    badge.hidden = !n; badge.textContent = n;
  });
  $('#filters').innerHTML = `<button class="chip" data-filter="" aria-pressed="${!catFilter}">Todas</button>` +
    CATS.map(c => `<button class="chip" data-filter="${c.id}" aria-pressed="${catFilter === c.id}"><span class="dot" style="background:var(--${c.id})"></span>${c.name}</button>`).join('');

  if (!loaded) { $('#list').innerHTML = `<div class="empty"><strong>Cargando tus tareas…</strong></div>`; $('#stats').textContent = ''; return; }
  const list = tasks.filter(x => byCat(x) && inView(x, view));
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
  const pending = tasks.filter(x => !x.done).length;
  const doneToday = tasks.filter(x => x.done && x.doneAt && isoDate(new Date(x.doneAt)) === todayISO()).length;
  $('#stats').textContent = `${pending} pendiente${pending === 1 ? '' : 's'} · ${doneToday} hecha${doneToday === 1 ? '' : 's'} hoy`;
  $('#clearDone').hidden = !(view === 'hechas' && tasks.some(x => x.done));
  if (!clearArmed) $('#clearDone').textContent = 'Borrar las hechas';
}
$('#list').addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'toggle') toggle(el.dataset.id); else openForm(el.dataset.id);
});
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  if (view === b.dataset.view) { $('#scroller').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  view = b.dataset.view; $('#scroller').scrollTop = 0; render();
});
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  catFilter = b.dataset.filter || null; render();
});
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
