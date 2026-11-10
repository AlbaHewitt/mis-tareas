// Entiende frases como "mañana a las 8 correr #entreno" o "los lunes y jueves gym".
// Devuelve el título limpio y lo que haya detectado (fecha, hora, categoría, prioridad, repetición).

const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Quita tildes sin cambiar la longitud (para poder recortar el texto original en las mismas posiciones)
export const fold = s => [...s].map(c => c.normalize('NFD')[0]).join('').toLowerCase();

const WD = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const WD_RE = '(lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const wdNum = w => WD[w.replace(/^(sabado|domingo)s$/, '$1')];

export function parseQuick(text, cats = [], now = new Date()) {
  let src = String(text || '');
  const out = { };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Busca en la versión sin tildes y recorta del original
  const take = re => {
    const m = re.exec(fold(src));
    if (!m) return null;
    src = (src.slice(0, m.index) + ' ' + src.slice(m.index + m[0].length));
    return m;
  };

  // Etiquetas: @cálculo @urgente (puede haber varias)
  const tagRe = /(?:^|\s)@([\p{L}\p{N}_-]+)/u;
  for (let tm; (tm = tagRe.exec(src));) { (out.tags ||= []).push(tm[1].toLowerCase()); src = src.slice(0, tm.index) + ' ' + src.slice(tm.index + tm[0].length); }
  // Categoría: #casa, #Estudio…
  let m = take(/(?:^|\s)#([\p{L}\p{N}_-]+)/u);
  if (m) {
    const key = m[1].replace(/[-_]/g, '');
    const c = cats.find(c => fold(c.name).replace(/[\s-_]/g, '') === key || c.id === m[1]);
    if (c) out.cat = c.id;
  }

  // Prioridad
  if (take(/(?:^|\s)(!+|urgente|importante)(?=\s|$|[,.])/)) out.prio = 'alta';

  // Repetición (con "cada N…", "el primer domingo de cada mes", "una semana sí y otra no"…)
  const NUM = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
  const N_RE = '(\\d{1,3}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)';
  const num = x => NUM[x] || +x;
  const ORD_RE = '(primer|primero|primeros|primera|segundo|segundos|tercer|tercero|terceros|cuarto|cuartos|ultimo|ultimos)';
  const ordN = o => o.startsWith('prim') ? 1 : o.startsWith('seg') ? 2 : o.startsWith('terc') ? 3 : o.startsWith('cuart') ? 4 : -1;
  const alt = take(/\b(?:una semana si y (?:otra|la otra) no|semanas alternas)\b/);
  if ((m = take(new RegExp(`\\b(?:el|los)\\s+${ORD_RE}\\s+${WD_RE}\\s+de\\s+(?:cada\\s+)?mes\\b`)))) {
    out.repeat = 'mensual'; out.nth = ordN(m[1]); out.nthDay = wdNum(m[2]);
  } else if ((m = take(new RegExp(`\\bcada\\s+${N_RE}\\s+${WD_RE}((?:\\s*(?:,|y)\\s*${WD_RE})*)`)))) {
    out.repeat = 'dias'; out.days = [...new Set((m[0].match(new RegExp(WD_RE, 'g')) || []).map(wdNum))].sort(); out.every = num(m[1]);
  } else if ((m = take(new RegExp(`\\bcada\\s+${N_RE}\\s+(dias|semanas|meses|anos)\\b`)))) {
    out.repeat = { dias: 'diario', semanas: 'semanal', meses: 'mensual', anos: 'anual' }[m[2]]; out.every = num(m[1]);
  } else if (take(/\b(?:cada ano|una vez al ano|anualmente|todos los anos)\b/)) out.repeat = 'anual';
  else if (take(/\b(?:una vez al mes)\b/)) out.repeat = 'mensual';
  else if ((m = take(new RegExp(`\\b(?:cada|todos los|los)\\s+${WD_RE}((?:\\s*(?:,|y)\\s*${WD_RE})*)`)))) {
    const names = (m[0].match(new RegExp(WD_RE, 'g')) || []);
    out.repeat = 'dias'; out.days = [...new Set(names.map(wdNum))].sort();
  } else if (take(/\b(?:cada dia|todos los dias|a diario|diariamente)\b/)) out.repeat = 'diario';
  else if (take(/\b(?:cada semana|semanalmente|todas las semanas)\b/)) out.repeat = 'semanal';
  else if (take(/\b(?:cada mes|mensualmente|todos los meses)\b/)) out.repeat = 'mensual';
  else if (take(/\b(?:entre semana|de lunes a viernes)\b/)) { out.repeat = 'dias'; out.days = [1, 2, 3, 4, 5]; }
  if (alt) { if (!out.repeat) out.repeat = 'semanal'; if (out.repeat === 'dias' || out.repeat === 'semanal') out.every = 2; }
  if (out.every === 1) delete out.every;

  // Franja horaria: "de 10 a 12", "de 5 a 7 de la tarde", "10:00-12:00"
  const hm = (h, mi, part) => { h = +h; mi = +(mi || 0); if ((part === 'tarde' || part === 'noche') && h < 12) h += 12; return h <= 23 && mi <= 59 ? `${pad(h)}:${pad(mi)}` : null; };
  if ((m = take(/\b(?:de|desde las?)\s+(\d{1,2})(?:[:.h](\d{2}))?\s+(?:a|hasta)\s+(?:las?\s+)?(\d{1,2})(?:[:.h](\d{2}))?(?:\s*(?:h|horas)\b)?(?:\s+(?:de la|por la)\s+(manana|tarde|noche))?\b/))
    || (m = take(/\b(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\b/))) {
    const a = hm(m[1], m[2], m[5]), b = hm(m[3], m[4], m[5]);
    if (a && b) { out.time = a; out.endTime = b; }
  }
  // Hora
  if (out.time) { /* ya hay franja */ }
  else if ((m = take(/\b(?:a las?|sobre las?|hacia las?)\s+(\d{1,2})(?:[:.h](\d{2}))?(?:\s*(?:h|horas)\b)?(?:\s+(?:de la|por la)\s+(manana|tarde|noche|madrugada))?\b/))) {
    let h = +m[1]; const mi = +(m[2] || 0);
    if ((m[3] === 'tarde' || m[3] === 'noche') && h < 12) h += 12;
    if (h <= 23 && mi <= 59) out.time = `${pad(h)}:${pad(mi)}`;
  } else if ((m = take(/\b(\d{1,2})[:.](\d{2})\s*h?\b/))) {
    if (+m[1] <= 23 && +m[2] <= 59) out.time = `${pad(+m[1])}:${m[2]}`;
  } else if (take(/\ba mediodia\b/)) out.time = '12:00';
  else if (take(/\besta noche\b/)) { out.time = '21:00'; out.date = isoDate(today); }

  // Fecha
  if (!out.date) {
    if (take(/\bpasado manana\b/)) out.date = isoDate(addDays(today, 2));
    else if (take(/(?<!la )\bmanana\b(?! (?:por la|de la))/) || take(/^\s*manana\b/)) out.date = isoDate(addDays(today, 1));
    else if (take(/\bhoy\b/)) out.date = isoDate(today);
    else if ((m = take(new RegExp(`\\b(?:el\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?\\b`)))) {
      const mo = MONTHS.indexOf(m[2]); let y = m[3] ? +m[3] : today.getFullYear();
      let d = new Date(y, mo, +m[1]);
      if (!m[3] && d < today) d = new Date(y + 1, mo, +m[1]);
      if (d.getMonth() === mo) out.date = isoDate(d);
    } else if ((m = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
      let d = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && d < today) d = new Date(y + 1, +m[2] - 1, +m[1]);
      if (d.getMonth() === +m[2] - 1) out.date = isoDate(d);
    } else if (!out.repeat && (m = take(new RegExp(`\\b(?:el\\s+)?(?:proximo\\s+|este\\s+)?${WD_RE}(?:\\s+que viene)?\\b`)))) {
      const w = wdNum(m[1]); let n = (w - today.getDay() + 7) % 7; if (n === 0) n = 7;
      out.date = isoDate(addDays(today, n));
    } else if ((m = take(/\bel(?: dia)? (\d{1,2})\b/))) {
      let d = new Date(today.getFullYear(), today.getMonth(), +m[1]);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, +m[1]);
      if (d.getDate() === +m[1]) out.date = isoDate(d);
    }
  }

  // Limpia el título
  let title = src.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim()
    .replace(/^(?:y|,|de|el|a|que)\s+/i, '').replace(/[\s,;:]+(?:y|de|el|a)?$/i, '').trim();
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  out.title = title || String(text || '').trim();
  return out;
}
