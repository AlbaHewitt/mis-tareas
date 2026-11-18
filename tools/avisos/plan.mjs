// Qué avisos tocan ahora para una persona. Función pura: no lee ni escribe nada.
// now = { date: 'AAAA-MM-DD', min: minutos desde medianoche } en SU hora local.
const toMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const pad = n => String(n).padStart(2, '0');
const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// Se manda si la hora del aviso está entre hace 45 min (por si el envío va con retraso) y dentro de 4 min
export const due = (at, now) => at <= now + 4 && at > now - 45;

export function plan({ now, prefs = {}, tasks = [], habits = [], sent = {} }) {
  const P = { tasks: true, lead: 10, bday: true, bdayHour: 20, habits: true, habitHour: 21, morning: false, morningHour: 8, ...prefs };
  const today = now.date, tomorrow = addDays(today, 1), out = [];
  const push = (key, title, body, tag) => { if (!sent[key]) out.push({ key, title, body, tag: tag || key, url: './' }); };
  const live = tasks.filter(t => !t.done && t.title);
  // Tareas con hora: X minutos antes (los de la tarea, o los de tus ajustes); "1 día antes" llega el día anterior a esa hora
  if (P.tasks) live.forEach(t => {
    if (!t.time || (t.date !== today && t.date !== tomorrow)) return;
    const lead = t.remind === null || t.remind === undefined || t.remind === '' ? Number(P.lead) || 0 : Number(t.remind);
    const start = toMin(t.time), dayBefore = lead >= 1440;
    if (dayBefore ? t.date !== tomorrow : t.date !== today) return;
    const at = dayBefore ? start : start - lead;
    if (!due(at, now.min)) return;
    const body = `${dayBefore ? 'Mañana a las ' : lead > 0 ? 'A las ' : 'Ahora · '}${t.time}${t.endTime ? '–' + t.endTime : ''}${t.loc ? ' · 📍 ' + t.loc : ''}`;
    push(`t:${t.id}:${t.date}:${t.time}`, `⏰ ${t.title}`, body);
  });
  // Cumpleaños: la víspera y el mismo día por la mañana
  if (P.bday) live.filter(t => t.cat === 'cumple').forEach(t => {
    const age = t.born ? ` (${Number(t.date.slice(0, 4)) - t.born})` : '';
    if (t.date === tomorrow && due(P.bdayHour * 60, now.min)) push(`b:${t.id}:${t.date}:pre`, '🎂 Mañana es un cumpleaños', `${t.title}${age}`);
    if (t.date === today && due(9 * 60, now.min)) push(`b:${t.id}:${t.date}:day`, '🎂 Hoy es un cumpleaños', `${t.title}${age}`);
  });
  // Hábitos de hoy que faltan
  if (P.habits && due(P.habitHour * 60, now.min)) {
    const left = habits.filter(h => {
      if (h.kind === 'quit') return h.log?.[today] === undefined;
      if (h.kind !== 'build' || (h.freq && h.freq !== 'daily')) return false;
      return h.log?.[today] !== 1;
    }).map(h => h.name);
    if (left.length) push(`h:${today}`, `🔥 Te ${left.length === 1 ? 'queda 1 hábito' : `quedan ${left.length} hábitos`} hoy`, left.slice(0, 4).join(', ') + (left.length > 4 ? ` y ${left.length - 4} más` : ''));
  }
  // Resumen de la mañana
  if (P.morning && due(P.morningHour * 60, now.min)) {
    const l = live.filter(t => t.date === today).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    push(`m:${today}`, '☀️ Buenos días', l.length ? `Hoy tienes ${l.length} ${l.length === 1 ? 'cosa' : 'cosas'}: ${l.slice(0, 3).map(t => (t.time ? t.time + ' ' : '') + t.title).join(' · ')}${l.length > 3 ? '…' : ''}` : 'Hoy no tienes nada apuntado.');
  }
  // Aviso de prueba (desde Ajustes → Avisos)
  if (P.test && !sent['test:' + P.test]) push('test:' + P.test, '🔔 ¡Los avisos funcionan!', 'Así te llegarán los avisos de Mis Tareas.', 'test');
  return out;
}
export { hhmm };
