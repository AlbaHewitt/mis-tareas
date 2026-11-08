// Lógica pura de la app (sin pantalla ni base de datos): fechas, repeticiones, puntos,
// hábitos, sueño y niveles. Se usa en app.js y se prueba en tests/.

export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_LETTER = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };
export const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export const normTag = s => String(s || '').trim().toLowerCase().replace(/^[@#]/, '').replace(/\s+/g, '-').slice(0, 30);

export const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => isoDate(new Date());
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); };
export const dim = (y, m) => new Date(y, m + 1, 0).getDate();
export const mondayOf = iso => addDays(iso, -((parseISO(iso).getDay() + 6) % 7));
export const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Día concreto del mes (1–31, o -1 = último día) en el mes de "iso" + n meses
export function monthDate(iso, n, md) {
  const d = parseISO(iso), y = d.getFullYear(), m = d.getMonth() + n;
  const last = dim(y, m);
  return isoDate(new Date(y, m, md === -1 ? last : Math.min(md || d.getDate(), last)));
}
export function stepDate(t, x) {
  const days = Array.isArray(t.days) && t.days.length ? t.days : null;
  if (t.repeat === 'diario') return addDays(x, 1);
  if (t.repeat === 'mensual') return monthDate(x, 1, t.monthDay);
  if (t.repeat === 'dias' && days) { let y = x; do { y = addDays(y, 1); } while (!days.includes(parseISO(y).getDay())); return y; }
  return addDays(x, 7);
}
// Siguiente repetición (nunca en el pasado); null si ya ha pasado la fecha de fin
export function nextDate(t) {
  let d = t.date || todayISO(), n = 0;
  do { d = stepDate(t, d); } while (d <= todayISO() && n++ < 1000);
  return t.until && d > t.until ? null : d;
}
// Coloca la primera fecha en un día válido de la repetición (hoy incluido)
export function alignStart(t) {
  if (!t.date) return;
  if (t.repeat === 'dias' && t.days.length) { for (let i = 0; i < 7 && !t.days.includes(parseISO(t.date).getDay()); i++) t.date = addDays(t.date, 1); }
  if (t.repeat === 'mensual' && t.monthDay) { const c = monthDate(t.date, 0, t.monthDay); t.date = c >= t.date ? c : monthDate(t.date, 1, t.monthDay); }
}
export function friendlyDate(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoy';
  if (iso === addDays(t, 1)) return 'Mañana';
  if (iso === addDays(t, -1)) return 'Ayer';
  const d = parseISO(iso), o = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return cap(d.toLocaleDateString('es-ES', o));
}
export function longDate(iso) {
  const f = friendlyDate(iso), d = parseISO(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  return ['Hoy', 'Mañana', 'Ayer'].includes(f) ? `${f} · ${d}` : f;
}
export const repeatLabel = t => t.repeat === 'diario' ? 'Cada día' : t.repeat === 'semanal' ? 'Cada semana'
  : t.repeat === 'mensual' ? (t.monthDay === -1 ? 'Último día de cada mes' : `El ${t.monthDay || parseISO(t.date || todayISO()).getDate()} de cada mes`)
  : t.repeat === 'dias' ? DAY_ORDER.filter(d => (t.days || []).includes(d)).map(d => DAY_LETTER[d]).join(' ') : '';

export const durationMin = t => t.date && t.time && t.endTime ? ((toMin(t.endTime) - toMin(t.time) + 1440) % 1440) || null : null;
// Puntos: los que pongas a mano; si no, la duración (hora inicio–fin) o los minutos; si no hay nada, 10
export const autoPoints = t => durationMin(t) || (Number(t.minutes) > 0 ? Math.round(Number(t.minutes)) : 10);
export const taskPoints = t => t.points !== null && t.points !== undefined && t.points !== '' ? Number(t.points) : autoPoints(t);
export const isLate = x => !x.done && x.date && x.date < todayISO();

export const habitPoints = h => Number(h.minutes) > 0 ? Math.round(Number(h.minutes)) : 10;
export const habitOK = (h, d) => (h.log[d] || 0) === 1;
export const weekCount = (h, mon) => { let n = 0; for (let i = 0; i < 7; i++) if (habitOK(h, addDays(mon, i))) n++; return n; };
// Una rutina solo cuenta los días de la semana que le tocan
export const applies = (h, d) => h.kind !== 'routine' || !h.days?.length || h.days.includes(parseISO(d).getDay());
export function habitStreak(h) {
  const today = todayISO();
  if (h.kind === 'routine') {
    let d = habitOK(h, today) || !applies(h, today) ? today : addDays(today, -1), n = 0, g = 0;
    while (g++ < 1000) { if (!applies(h, d)) { d = addDays(d, -1); continue; } if (!habitOK(h, d)) break; n++; d = addDays(d, -1); }
    return n;
  }
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
export function habitBest(h) {
  const ok = Object.keys(h.log).filter(d => h.log[d] === 1).sort();
  let best = 0, run = 0, prev = null;
  ok.forEach(d => { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  return best;
}

export const wakeTarget = (h, day) => [0, 6].includes(parseISO(day).getDay()) ? h.wakeWe : h.wakeWk;
// Hora de acostarse en minutos, contando las horas de madrugada como "después de medianoche"
export const bedMin = hm => { const m = toMin(hm); return m < 12 * 60 ? m + 1440 : m; };
export const fmtDur = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
export function judgeSleep(h, day, bed, wake) {
  const slept = (toMin(wake) + 1440 - bedMin(bed)) % 1440 || 1440;
  const bedOK = bedMin(bed) <= bedMin(h.bed) + h.tol;
  const wakeOK = toMin(wake) <= toMin(wakeTarget(h, day)) + h.tol;
  const hoursOK = slept >= h.hours * 60 - h.tol;
  const fails = [!bedOK && 'te acostaste tarde', !wakeOK && 'te levantaste tarde', !hoursOK && `dormiste ${fmtDur(slept)}`].filter(Boolean);
  return { ok: bedOK && wakeOK && hoursOK, slept, fails };
}

export const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const LEVEL_NAMES = ['Principiante', 'Aprendiz', 'Constante', 'Organizada', 'Enfocada', 'Disciplinada', 'Imparable', 'Experta', 'Maestra', 'Leyenda'];
export const levelStart = L => 50 * L * (L - 1);
export function levelOf(xp) { let L = 1; while (levelStart(L + 1) <= xp) L++; return L; }
