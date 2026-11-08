import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toICS, googleURL, rrule } from '../cal.js';

test('evento con hora de inicio y fin y aviso', () => {
  const ics = toICS({ id: 'a', title: 'Examen, aula 3', date: '2026-11-24', time: '12:00', endTime: '14:00', remind: 1440 });
  assert.match(ics, /DTSTART:20261124T120000/);
  assert.match(ics, /DTEND:20261124T140000/);
  assert.match(ics, /SUMMARY:Examen\\, aula 3/);
  assert.match(ics, /TRIGGER:-PT1440M/);
});

test('evento que pasa de medianoche termina al día siguiente', () => {
  assert.match(toICS({ id: 'b', title: 'Fiesta', date: '2026-12-01', time: '22:00', endTime: '02:00' }), /DTEND:20261202T020000/);
});

test('repeticiones en formato de calendario', () => {
  assert.equal(rrule({ repeat: 'dias', days: [1, 4] }), 'FREQ=WEEKLY;BYDAY=MO,TH');
  assert.equal(rrule({ repeat: 'mensual', monthDay: 1, until: '2027-06-30' }), 'FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20270630T235959');
  assert.equal(rrule({}), '');
});

test('enlace de Google Calendar', () => {
  const u = new URL(googleURL({ id: 'c', title: 'Gym', date: '2026-11-10', time: '', repeat: 'diario' }));
  assert.equal(u.searchParams.get('dates'), '20261110/20261111');
  assert.equal(u.searchParams.get('recur'), 'RRULE:FREQ=DAILY');
});
