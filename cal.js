// Convierte una tarea en un evento de calendario: archivo .ics (Calendario del iPhone) o enlace de Google Calendar.

const pad = n => String(n).padStart(2, '0');
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parts(t) {
  const [y, m, d] = t.date.split('-').map(Number);
  if (!t.time) {
    const end = new Date(y, m - 1, d + 1);
    return { allDay: true, start: `${y}${pad(m)}${pad(d)}`, end: `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}` };
  }
  const [hh, mm] = t.time.split(':').map(Number);
  const s = new Date(y, m - 1, d, hh, mm);
  const e = new Date(s.getTime() + (Number(t.minutes) > 0 ? Number(t.minutes) : 60) * 60000);
  const f = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  return { allDay: false, start: f(s), end: f(e) };
}

export function rrule(t) {
  if (t.repeat === 'diario') return 'FREQ=DAILY';
  if (t.repeat === 'semanal') return 'FREQ=WEEKLY';
  if (t.repeat === 'mensual') return 'FREQ=MONTHLY';
  if (t.repeat === 'dias' && t.days?.length) return 'FREQ=WEEKLY;BYDAY=' + t.days.map(d => BYDAY[d]).join(',');
  return '';
}

function details(t) {
  const steps = (t.subtasks || []).map(s => `${s.done ? '☑' : '☐'} ${s.text}`).join('\n');
  return [t.notes, steps].filter(Boolean).join('\n\n');
}

const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
// Las líneas de un .ics no deben pasar de 75 bytes
function fold(line) {
  const out = []; let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur); return out.join('\r\n');
}

export function toICS(t) {
  const p = parts(t), now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mis Tareas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${t.id}@mis-tareas`, `DTSTAMP:${stamp}`,
    p.allDay ? `DTSTART;VALUE=DATE:${p.start}` : `DTSTART:${p.start}`,
    p.allDay ? `DTEND;VALUE=DATE:${p.end}` : `DTEND:${p.end}`,
    `SUMMARY:${icsText(t.title)}`,
  ];
  const d = details(t); if (d) lines.push(`DESCRIPTION:${icsText(d)}`);
  const r = rrule(t); if (r) lines.push(`RRULE:${r}`);
  if (t.remind !== null && t.remind !== undefined && t.remind !== '') {
    const min = Number(t.remind);
    // Sin hora: el aviso de "a la hora" sale a las 9:00 del día
    const trig = p.allDay ? (min >= 1440 ? '-PT15H' : 'PT9H') : (min === 0 ? 'PT0M' : `-PT${min}M`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(t.title)}`, `TRIGGER:${trig}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleURL(t) {
  const p = parts(t);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: t.title, dates: `${p.start}/${p.end}`, ctz: 'Europe/Madrid' });
  const d = details(t); if (d) q.set('details', d);
  const r = rrule(t); if (r) q.set('recur', 'RRULE:' + r);
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
