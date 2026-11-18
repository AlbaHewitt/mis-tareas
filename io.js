// Traer y llevar: leer calendarios (.ics), Todoist (.csv) y listas de texto, y escribir CSV para Excel.
// Funciones puras (sin pantalla ni base de datos) para poder probarlas.

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// --- Calendario (.ics) ---
const unescapeICS = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
// "20261118T093000Z" (UTC), "20261118T093000" (hora local o con TZID) o "20261118" (todo el día)
export function icsDate(v, params = '') {
  const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4] || /VALUE=DATE(?!-)/i.test(params) && !m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
  const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return { date: iso(d), time: hm(d) };
}
const FREQ = { DAILY: 'diario', WEEKLY: 'semanal', MONTHLY: 'mensual', YEARLY: 'anual' };
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
export function parseICS(text, { since = '' } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = []; let cur = null;
  for (const line of lines) {
    if (/^BEGIN:(VEVENT|VTODO)$/i.test(line)) { cur = { kind: line.slice(6).toUpperCase() }; continue; }
    if (/^END:(VEVENT|VTODO)$/i.test(line)) { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';'), val = line.slice(i + 1), key = name.toUpperCase();
    if (key === 'SUMMARY') cur.title = unescapeICS(val).trim();
    else if (key === 'DESCRIPTION') cur.notes = unescapeICS(val).trim();
    else if (key === 'LOCATION') cur.loc = unescapeICS(val).trim();
    else if (key === 'UID') cur.uid = val.trim();
    else if (key === 'DTSTART') cur.start = icsDate(val.trim(), params.join(';'));
    else if (key === 'DTEND' || key === 'DUE') cur[key === 'DUE' ? 'due' : 'end'] = icsDate(val.trim(), params.join(';'));
    else if (key === 'STATUS') cur.status = val.trim().toUpperCase();
    else if (key === 'RRULE') cur.rrule = Object.fromEntries(val.split(';').map(p => p.split('=')));
  }
  return out.map(e => {
    const s = e.start || e.due, t = { title: e.title || '(sin título)', date: s?.date || '', time: s?.time || '', endTime: '', loc: e.loc || '', notes: (e.notes || '').slice(0, 2000), done: e.status === 'COMPLETED', uid: e.uid || '' };
    if (e.end && e.end.time && s?.time && e.end.date === s.date) t.endTime = e.end.time;
    const r = e.rrule;
    if (r && FREQ[r.FREQ]) {
      t.repeat = FREQ[r.FREQ]; t.every = Math.max(1, Number(r.INTERVAL) || 1);
      const days = String(r.BYDAY || '').split(',').map(x => BYDAY[x.slice(-2)]).filter(x => x !== undefined);
      if (t.repeat === 'semanal' && days.length) { t.repeat = 'dias'; t.days = days; }
      if (r.UNTIL) t.until = icsDate(r.UNTIL)?.date || '';
    }
    return t;
  }).filter(t => t.title && (!since || !t.date || t.date >= since || t.repeat));
}

// --- CSV (Todoist, Excel o cualquier lista) ---
export function parseCSV(text) {
  const s = String(text || '').replace(/^\uFEFF/, ''), first = s.split('\n')[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// Filas → tareas. Entiende el CSV de Todoist (TYPE, CONTENT, PRIORITY, DATE…) y cualquier tabla con una columna de título
export function rowsToTasks(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(fold);
  const col = names => head.findIndex(h => names.includes(h));
  const iTitle = col(['content', 'title', 'titulo', 'tarea', 'task', 'nombre', 'name']), iType = col(['type', 'tipo']), iDate = col(['date', 'fecha', 'due date', 'deadline']),
    iPrio = col(['priority', 'prioridad']), iNotes = col(['description', 'notas', 'notes', 'descripcion']), iTime = col(['hora', 'time']);
  const hasHead = iTitle >= 0, body = hasHead ? rows.slice(1) : rows, out = []; let section = '';
  for (const r of body) {
    const type = iType >= 0 ? fold(r[iType]) : '';
    if (type === 'section') { section = (r[iTitle] || '').trim(); continue; }
    if (type && type !== 'task') continue;
    const title = String(hasHead ? r[iTitle] : r[0] || '').replace(/^\s*[-*•]\s*(\[[ x]\]\s*)?/i, '').trim(); if (!title) continue;
    const t = { title, date: '', time: '', notes: iNotes >= 0 ? (r[iNotes] || '').trim() : '', tags: section ? [section] : [] };
    const dv = iDate >= 0 ? (r[iDate] || '').trim() : '';
    let m;
    if ((m = dv.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/))) { t.date = `${m[1]}-${m[2]}-${m[3]}`; if (m[4]) t.time = `${m[4]}:${m[5]}`; }
    else if ((m = dv.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) t.date = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    else if (dv && !isNaN(Date.parse(dv))) { const d = new Date(dv); t.date = iso(d); if (/\d:\d/.test(dv)) t.time = hm(d); }
    else if (dv) t.when = dv; // fecha escrita ("every monday", "mañana"…): la intenta entender la app
    if (iTime >= 0 && /^\d{1,2}:\d{2}$/.test((r[iTime] || '').trim())) t.time = r[iTime].trim().padStart(5, '0');
    if (iPrio >= 0 && ['4', 'p1', 'alta', 'high', 'urgente'].includes(fold(r[iPrio]))) t.flag = true;
    out.push(t);
  }
  return out;
}
// Lista de texto: una tarea por línea (se quitan viñetas y casillas)
export const linesToTitles = text => String(text || '').split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•◦▪–]|\d+[.)])\s*/, '').replace(/^\[[ xX]\]\s*/, '').replace(/^[☐☑✓✔]\s*/, '').trim()).filter(Boolean);

// --- CSV para Excel (separado por ; y con BOM para que salgan bien las tildes) ---
export function toCSV(rows) {
  const cell = v => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\uFEFF' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}
