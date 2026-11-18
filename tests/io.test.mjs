import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, icsDate, parseCSV, rowsToTasks, linesToTitles, toCSV } from '../io.js';

test('ics: eventos, todo el día, repeticiones y tareas', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:a1', 'SUMMARY:Dentista', 'DTSTART:20261120T100000', 'DTEND:20261120T110000', 'LOCATION:Calle Mayor\\, 3', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a2', 'SUMMARY:Vacaciones', 'DTSTART;VALUE=DATE:20261222', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a3', 'SUMMARY:Gym', 'DTSTART:20261116T180000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a4', 'SUMMARY:Viejo', 'DTSTART:20200101T100000', 'END:VEVENT',
    'BEGIN:VTODO', 'UID:a5', 'SUMMARY:Comprar pan', 'STATUS:COMPLETED', 'END:VTODO',
    'BEGIN:VEVENT', 'UID:a6', 'SUMMARY:Reunión con un ', ' título largo', 'DTSTART:20261121T090000', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const l = parseICS(ics, { since: '2026-10-01' });
  assert.equal(l.length, 5);
  assert.deepEqual([l[0].title, l[0].date, l[0].time, l[0].endTime, l[0].loc], ['Dentista', '2026-11-20', '10:00', '11:00', 'Calle Mayor, 3']);
  assert.deepEqual([l[1].date, l[1].time], ['2026-12-22', '']);
  assert.equal(l[2].repeat, 'dias'); assert.deepEqual(l[2].days, [1, 4]);
  assert.equal(l[3].done, true);
  assert.equal(l[4].title, 'Reunión con un título largo');
  assert.equal(icsDate('20261118').time, '');
});

test('csv de Todoist y tablas', () => {
  const todoist = 'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\nsection,Casa,,,,,,,,\ntask,"Limpiar, baño",,4,1,,,2026-11-20,es,Europe/Madrid\ntask,Llamar a mamá,,1,1,,,every monday,en,\nnote,una nota,,,,,,,,';
  const t = rowsToTasks(parseCSV(todoist));
  assert.equal(t.length, 2);
  assert.deepEqual([t[0].title, t[0].date, t[0].flag, t[0].tags[0]], ['Limpiar, baño', '2026-11-20', true, 'Casa']);
  assert.equal(t[1].when, 'every monday');
  const excel = '﻿Título;Fecha;Notas\nComprar leche;20/11/2026;Sin lactosa\n';
  const e = rowsToTasks(parseCSV(excel));
  assert.deepEqual([e[0].title, e[0].date, e[0].notes], ['Comprar leche', '2026-11-20', 'Sin lactosa']);
  const plain = rowsToTasks(parseCSV('Una cosa\nOtra cosa\n'));
  assert.deepEqual(plain.map(x => x.title), ['Una cosa', 'Otra cosa']);
});

test('listas de texto y CSV para Excel', () => {
  assert.deepEqual(linesToTitles('- Leche\n• Pan\n\n[x] Huevos\n1. Fruta\n☐ Agua'), ['Leche', 'Pan', 'Huevos', 'Fruta', 'Agua']);
  assert.equal(toCSV([['a', 'b;c'], ['d "e"', '']]), '﻿a;"b;c"\r\n"d ""e""";');
});
