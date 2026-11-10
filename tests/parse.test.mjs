import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from '../parse.js';

const cats = [{ id: 'entreno', name: 'Entreno' }, { id: 'casa', name: 'Casa' }, { id: 'estudio', name: 'Estudio' }];
const now = new Date(2026, 10, 8, 10, 0); // domingo 8 nov 2026
const p = s => parseQuick(s, cats, now);

test('fecha, hora y categoría', () => {
  assert.deepEqual(p('mañana a las 8 correr #entreno'), { cat: 'entreno', time: '08:00', date: '2026-11-09', title: 'Correr' });
  assert.equal(p('pasado mañana dentista a las 11:30').date, '2026-11-10');
  assert.equal(p('llamar a mamá el viernes a las 5 de la tarde').time, '17:00');
  assert.equal(p('llamar a mamá el viernes a las 5 de la tarde').date, '2026-11-13');
  assert.equal(p('examen de inglés el 3 de diciembre').date, '2026-12-03');
  assert.equal(p('entregar práctica 15/12').date, '2026-12-15');
  assert.equal(p('reunión el 20').date, '2026-11-20');
});

test('franjas horarias', () => {
  const a = p('estudiar de 10 a 12 #estudio');
  assert.equal(a.time, '10:00'); assert.equal(a.endTime, '12:00'); assert.equal(a.title, 'Estudiar');
  const b = p('reunión 10:00-11:30 mañana');
  assert.equal(b.endTime, '11:30'); assert.equal(b.date, '2026-11-09');
});

test('repeticiones', () => {
  assert.deepEqual(p('los lunes y jueves gym').days, [1, 4]);
  assert.equal(p('regar las plantas cada día').repeat, 'diario');
  assert.deepEqual(p('repasar entre semana').days, [1, 2, 3, 4, 5]);
});

test('prioridad y etiquetas', () => {
  assert.equal(p('pagar recibo !').prio, 'alta');
  const t = p('repasar tema 3 @cálculo @urgente');
  assert.deepEqual(t.tags, ['cálculo', 'urgente']);
  assert.equal(t.title, 'Repasar tema 3');
});

test('un título sin nada especial no cambia', () => {
  assert.deepEqual(p('Comprar leche'), { title: 'Comprar leche' });
});

test('repeticiones flexibles', () => {
  assert.deepEqual([p('regar cada 4 días').repeat, p('regar cada 4 días').every], ['diario', 4]);
  assert.deepEqual([p('pagar alquiler cada quince días').repeat, p('pagar alquiler cada quince días').every], ['diario', 15]);
  const a = p('yoga cada dos martes'); assert.equal(a.repeat, 'dias'); assert.deepEqual(a.days, [2]); assert.equal(a.every, 2); assert.equal(a.title, 'Yoga');
  const b = p('misa el primer domingo de cada mes'); assert.equal(b.repeat, 'mensual'); assert.equal(b.nth, 1); assert.equal(b.nthDay, 0);
  const c = p('limpiar radiadores una vez al mes'); assert.equal(c.repeat, 'mensual'); assert.equal(c.title, 'Limpiar radiadores');
  assert.equal(p('revisión del coche una vez al año').repeat, 'anual');
  const e = p('turno de oficina entre semana una semana sí y otra no'); assert.deepEqual(e.days, [1, 2, 3, 4, 5]); assert.equal(e.every, 2);
  assert.equal(p('reunión el último viernes de cada mes').nth, -1);
});
