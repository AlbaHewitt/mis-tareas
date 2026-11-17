import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, shopSection } from '../logic.js';

test('número de semana ISO', () => {
  assert.equal(isoWeek('2026-11-17'), 47);
  assert.equal(isoWeek('2026-01-01'), 1);
  assert.equal(isoWeek('2027-01-01'), 53);
  assert.equal(isoWeek('2025-12-29'), 1);
  assert.equal(isoWeek('2024-12-30'), 1);
});

test('compra: cada cosa a su sección', () => {
  const s = shopSection;
  assert.equal(s('Leche'), 'lacteos');
  assert.equal(s('bebida de avena'), 'lacteos');
  assert.equal(s('Tomate frito'), 'despensa');
  assert.equal(s('tomates'), 'fruta');
  assert.equal(s('plátanos'), 'fruta');
  assert.equal(s('Pan de molde'), 'pan');
  assert.equal(s('atún'), 'despensa');
  assert.equal(s('pechuga de pollo'), 'carne');
  assert.equal(s('Agua con gas'), 'bebidas');
  assert.equal(s('helado de vainilla'), 'congelados');
  assert.equal(s('jabón de lavadora'), 'limpieza');
  assert.equal(s('papel higiénico'), 'higiene');
  assert.equal(s('pañuelos'), 'higiene');
  assert.equal(s('pilas'), 'otros');
  assert.equal(s('pilas', { pilas: 'limpieza' }), 'limpieza');
});
