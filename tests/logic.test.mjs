import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

const today = L.todayISO();
const d = n => L.addDays(today, n);

test('fechas: sumar días, lunes de la semana y meses', () => {
  assert.equal(L.addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(L.mondayOf('2026-11-08'), '2026-11-02'); // domingo → lunes anterior
  assert.equal(L.mondayOf('2026-11-09'), '2026-11-09');
  assert.equal(L.dim(2028, 1), 29); // febrero bisiesto
  assert.equal(L.monthDate('2026-01-31', 1, 31), '2026-02-28'); // el 31 en febrero → último día
  assert.equal(L.monthDate('2026-03-10', 0, -1), '2026-03-31'); // -1 = último día del mes
  assert.equal(L.toMin('07:15'), 435);
});

test('repeticiones: siguiente fecha nunca en el pasado', () => {
  assert.equal(L.nextDate({ repeat: 'diario', date: d(-5) }), d(1));
  assert.equal(L.nextDate({ repeat: 'semanal', date: today }), d(7));
  // días concretos: el siguiente que toque, después de hoy
  const t = { repeat: 'dias', days: [1, 4], date: today };
  const n = L.nextDate(t);
  assert.ok(n > today);
  assert.ok([1, 4].includes(L.parseISO(n).getDay()));
  // con fecha de fin pasada ya no hay siguiente
  assert.equal(L.nextDate({ repeat: 'diario', date: today, until: today }), null);
});

test('repeticiones: un día concreto de cada mes', () => {
  assert.equal(L.stepDate({ repeat: 'mensual', monthDay: 1 }, '2026-11-01'), '2026-12-01');
  assert.equal(L.stepDate({ repeat: 'mensual', monthDay: -1 }, '2026-01-31'), '2026-02-28');
  const t = { repeat: 'mensual', monthDay: 15, date: '2026-11-20' };
  L.alignStart(t); assert.equal(t.date, '2026-12-15'); // el 15 ya pasó → el del mes siguiente
  const w = { repeat: 'dias', days: [1], date: '2026-11-08' }; // domingo → lunes
  L.alignStart(w); assert.equal(w.date, '2026-11-09');
});

test('puntos: a mano, duración, minutos o 10', () => {
  assert.equal(L.taskPoints({ points: 0 }), 0);
  assert.equal(L.taskPoints({ points: 7, minutes: 40 }), 7);
  assert.equal(L.taskPoints({ date: today, time: '18:00', endTime: '19:30' }), 90);
  assert.equal(L.taskPoints({ date: today, time: '23:00', endTime: '01:00' }), 120); // pasa de medianoche
  assert.equal(L.taskPoints({ minutes: 40 }), 40);
  assert.equal(L.taskPoints({}), 10);
});

test('hábitos: racha diaria, semanal y récord', () => {
  const h = { kind: 'build', freq: 'daily', log: { [d(-2)]: 1, [d(-1)]: 1, [today]: 1, [d(-5)]: 1 } };
  assert.equal(L.habitStreak(h), 3);
  // si hoy aún no lo has hecho, la racha de ayer sigue viva
  assert.equal(L.habitStreak({ ...h, log: { [d(-2)]: 1, [d(-1)]: 1 } }), 2);
  assert.equal(L.habitBest({ log: { '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1, '2026-01-10': 1 } }), 3);
  // "caer" (-1) rompe la racha de un hábito para dejar
  assert.equal(L.habitStreak({ kind: 'quit', freq: 'daily', log: { [d(-1)]: -1, [today]: 1 } }), 1);
  const mon = L.mondayOf(today);
  const wk = { kind: 'build', freq: 'weekly', target: 2, log: { [L.addDays(mon, -7)]: 1, [L.addDays(mon, -6)]: 1 } };
  assert.equal(L.habitStreak(wk), 1);
});

test('rutinas: los días que no tocan no rompen la racha', () => {
  const only = [L.parseISO(d(-1)).getDay(), L.parseISO(d(-8)).getDay()];
  const h = { kind: 'routine', days: [...new Set(only)], log: { [d(-1)]: 1, [d(-8)]: 1 } };
  assert.ok(L.habitStreak(h) >= 2);
  assert.equal(L.applies({ kind: 'routine', days: [1] }, '2026-11-09'), true);
  assert.equal(L.applies({ kind: 'routine', days: [1] }, '2026-11-08'), false);
});

test('sueño: hora de acostarse, de levantarse y horas dormidas', () => {
  const h = { bed: '23:30', wakeWk: '07:15', wakeWe: '08:15', hours: 7.5, tol: 15 };
  const lunes = '2026-11-09', sabado = '2026-11-14';
  assert.equal(L.judgeSleep(h, lunes, '23:40', '07:15').ok, true);
  const tarde = L.judgeSleep(h, lunes, '00:20', '07:10');
  assert.equal(tarde.ok, false);
  assert.equal(tarde.slept, 410);
  assert.ok(tarde.fails.includes('te acostaste tarde'));
  assert.equal(L.judgeSleep(h, sabado, '23:30', '08:10').ok, true); // fin de semana: hasta las 8:15
  assert.equal(L.judgeSleep(h, lunes, '23:30', '08:10').ok, false);
});

test('niveles: umbrales y nivel según puntos', () => {
  assert.equal(L.levelStart(2), 100);
  assert.equal(L.levelOf(0), 1);
  assert.equal(L.levelOf(99), 1);
  assert.equal(L.levelOf(100), 2);
  assert.equal(L.levelOf(1000), 5);
});

test('textos: duración, etiquetas y repetición', () => {
  assert.equal(L.fmtDur(25), '25 min');
  assert.equal(L.fmtDur(90), '1 h 30 min');
  assert.equal(L.fmtDur(120), '2 h');
  assert.equal(L.normTag(' @Cálculo Uno '), 'cálculo-uno');
  assert.equal(L.repeatLabel({ repeat: 'dias', days: [1, 3, 5] }), 'L X V');
  assert.equal(L.repeatLabel({ repeat: 'mensual', monthDay: -1 }), 'Último día de cada mes');
  assert.equal(L.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
