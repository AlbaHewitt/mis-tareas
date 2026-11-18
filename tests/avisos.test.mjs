import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, due } from '../tools/avisos/plan.mjs';

const tasks = [
  { id: 'a', title: 'Gym', date: '2026-11-18', time: '18:00', endTime: '19:00' },
  { id: 'b', title: 'Dentista', date: '2026-11-18', time: '18:30', remind: 30, loc: 'Calle Mayor' },
  { id: 'c', title: 'Examen', date: '2026-11-19', time: '17:55', remind: 1440 },
  { id: 'd', title: 'Hecha', date: '2026-11-18', time: '17:50', done: true },
  { id: 'e', title: 'Ana', cat: 'cumple', date: '2026-11-19', born: 1996 },
];
const habits = [
  { id: 'h1', name: 'Leer', kind: 'build', freq: 'daily', log: {} },
  { id: 'h2', name: 'Agua', kind: 'build', freq: 'daily', log: { '2026-11-18': 1 } },
  { id: 'h3', name: 'Uñas', kind: 'quit', log: {} },
  { id: 'h4', name: 'Limpiar', kind: 'build', freq: 'weekly', log: {} },
];

test('ventana de envío', () => {
  assert.equal(due(600, 597), true); assert.equal(due(600, 595), false); assert.equal(due(600, 640), true); assert.equal(due(600, 646), false);
});

test('tareas: minutos antes, a su hora y el día antes', () => {
  const m = plan({ now: { date: '2026-11-18', min: 17 * 60 + 52 }, tasks, habits: [] }).map(x => x.title + ' | ' + x.body);
  assert.deepEqual(m.sort(), ['⏰ Examen | Mañana a las 17:55', '⏰ Gym | A las 18:00–19:00'].sort());
  const at6 = plan({ now: { date: '2026-11-18', min: 18 * 60 }, tasks, habits: [] }).map(x => x.title + ' | ' + x.body);
  assert.ok(at6.includes('⏰ Dentista | A las 18:30 · 📍 Calle Mayor'));
  const none = plan({ now: { date: '2026-11-18', min: 12 * 60 }, tasks, habits: [] });
  assert.equal(none.length, 0);
});

test('no repite lo ya enviado y respeta lo apagado', () => {
  const now = { date: '2026-11-18', min: 17 * 60 + 52 };
  const first = plan({ now, tasks, habits: [] }), sent = Object.fromEntries(first.map(x => [x.key, 1]));
  assert.equal(plan({ now, tasks, habits: [], sent }).length, 0);
  assert.equal(plan({ now, tasks, habits: [], prefs: { tasks: false } }).length, 0);
});

test('cumpleaños, hábitos, mañana y prueba', () => {
  const b = plan({ now: { date: '2026-11-18', min: 20 * 60 + 1 }, tasks, habits: [] });
  assert.deepEqual(b.map(x => x.body), ['Ana (30)']);
  const h = plan({ now: { date: '2026-11-18', min: 21 * 60 }, tasks: [], habits });
  assert.equal(h[0].title, '🔥 Te quedan 2 hábitos hoy'); assert.equal(h[0].body, 'Leer, Uñas');
  const m = plan({ now: { date: '2026-11-18', min: 8 * 60 }, tasks, habits: [], prefs: { morning: true } });
  assert.match(m[0].body, /Hoy tienes 2 cosas: 18:00 Gym · 18:30 Dentista/);
  const t = plan({ now: { date: '2026-11-18', min: 3 }, tasks: [], habits: [], prefs: { test: 123 } });
  assert.equal(t[0].key, 'test:123');
});
