import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepDate, nthDate, alignStart, repeatLabel, habitStreak } from '../logic.js';

test('cada N días, semanas, meses y años', () => {
  assert.equal(stepDate({ repeat: 'diario', every: 4 }, '2026-11-10'), '2026-11-14');
  assert.equal(stepDate({ repeat: 'diario', every: 15 }, '2026-11-10'), '2026-11-25');
  assert.equal(stepDate({ repeat: 'semanal', every: 2 }, '2026-11-10'), '2026-11-24');
  assert.equal(stepDate({ repeat: 'mensual', every: 1, monthDay: 31 }, '2026-01-31'), '2026-02-28');
  assert.equal(stepDate({ repeat: 'mensual', every: 3, monthDay: 15 }, '2026-11-15'), '2027-02-15');
  assert.equal(stepDate({ repeat: 'anual' }, '2028-02-29'), '2029-02-28');
});

test('el primer domingo y el último viernes de cada mes', () => {
  assert.equal(nthDate('2026-11-10', 0, 1, 0), '2026-11-01');
  assert.equal(nthDate('2026-11-10', 1, 1, 0), '2026-12-06');
  assert.equal(nthDate('2026-11-10', 0, -1, 5), '2026-11-27');
  assert.equal(nthDate('2026-11-10', 0, 3, 2), '2026-11-17');
  const t = { repeat: 'mensual', nth: 1, nthDay: 0, date: '2026-11-10', days: [] };
  alignStart(t); assert.equal(t.date, '2026-12-06');
  assert.equal(stepDate(t, t.date), '2027-01-03');
  assert.equal(repeatLabel(t), 'El primer domingo de cada mes');
});

test('cada dos martes y entre semana una semana sí y otra no', () => {
  const t = { repeat: 'dias', days: [2], every: 2, date: '2026-11-10', anchor: '2026-11-09' };
  assert.equal(stepDate(t, '2026-11-10'), '2026-11-24');
  const w = { repeat: 'dias', days: [1, 2, 3, 4, 5], every: 2, anchor: '2026-11-09' };
  assert.equal(stepDate(w, '2026-11-13'), '2026-11-23');
  assert.equal(stepDate(w, '2026-11-23'), '2026-11-24');
  assert.equal(repeatLabel({ ...w, date: '2026-11-09' }), 'L M X J V · una semana sí y otra no');
});

test('hábito una vez al mes: racha de meses', () => {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const iso = (yy, mm, d) => { const x = new Date(yy, mm, d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const h = { freq: 'monthly', target: 1, log: { [iso(y, m - 1, 5)]: 1, [iso(y, m - 2, 20)]: 1 } };
  assert.equal(habitStreak(h), 2);
  h.log[iso(y, m, 1)] = 1; assert.equal(habitStreak(h), 3);
});
