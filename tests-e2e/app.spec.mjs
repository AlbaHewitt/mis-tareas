// Pruebas de pantallas: usan la app como una persona, en un navegador como el del iPhone.
// La app arranca vacía y sin cuenta ("solo en este dispositivo"); cada prueba empieza de cero.
import { test, expect } from '@playwright/test';

const tab = (page, view) => page.locator(`#tabs button[data-view="${view}"]`);
// Escribe una tarea en el formulario rápido y la guarda con Intro
async function addTask(page, text) {
  await page.locator('#fab').click();
  await expect(page.locator('#taskSheet')).toHaveClass(/show/);
  await page.locator('#title').fill(text);
  await page.locator('#title').press('Enter');
  await expect(page.locator('#taskSheet')).not.toHaveClass(/show/);
}
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('mis-tareas-v1') || '[]'));

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#syncText')).toHaveText('Solo en este dispositivo');
});
test.afterEach(() => { expect(errors, 'errores de JavaScript en la página').toEqual([]); });

test('la primera vez, Hoy explica qué hacer y no enseña botones que no sirven', async ({ page }) => {
  await expect(page.locator('#list')).toContainText('Nada para hoy');
  await expect(page.locator('[data-act="organize"]')).toHaveCount(0);
  await expect(page.locator('[data-act="hoyedit"]')).toHaveCount(0);
});

test('añadir escribiendo como hablas: enseña lo que entiende, avisa y se puede deshacer', async ({ page }) => {
  await page.locator('#fab').click();
  await page.locator('#title').fill('mañana a las 8 correr');
  await expect(page.locator('#detected')).toContainText('Mañana');
  await expect(page.locator('#detected')).toContainText('08:00');
  await expect(page.locator('#detected')).toContainText('#Entreno');
  await expect(page.locator('#quickRow [data-q="manana"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#formFull')).toBeHidden();
  await page.locator('#title').press('Enter');
  await expect(page.locator('#toastText')).toHaveText('Añadida: mañana, 08:00');
  const [t] = await saved(page);
  expect(t).toMatchObject({ title: 'Correr', time: '08:00', cat: 'entreno' });
  await page.locator('#toastUndo').click();
  expect(await saved(page)).toEqual([]);
});

test('"Más detalles…" coloca lo escrito en los campos para que no se contradigan', async ({ page }) => {
  await page.locator('#fab').click();
  await page.locator('#title').fill('estudiar tema 3 !');
  await page.locator('#quickRow [data-q="more"]').click();
  await expect(page.locator('#formFull')).toBeVisible();
  await expect(page.locator('#title')).toHaveValue('Estudiar tema 3');
  await expect(page.locator('#catChips [data-cat="estudio"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#flagBtn')).toHaveAttribute('aria-pressed', 'true');
});

test('lo que lleva bandera se ve siempre en Hoy y se completa con un toque', async ({ page }) => {
  await addTask(page, 'llamar al dentista a las 17');
  await addTask(page, 'estudiar tema 3 !');
  const row = page.locator('.xlist.flagged');
  await expect(row).toContainText('🚩');
  await expect(row).toContainText('Estudiar tema 3');
  await expect(tab(page, 'hoy').locator('.badge')).toBeHidden();
  await page.getByRole('button', { name: 'Completar: Estudiar tema 3' }).click();
  await expect(page.locator('#toastText')).toContainText('Hecha: Estudiar tema 3');
  expect((await saved(page)).find(t => t.title === 'Estudiar tema 3').done).toBe(true);
});

test('Agenda → Año: las flechas cambian de año', async ({ page }) => {
  await tab(page, 'semana').click();
  await page.locator('[data-act="calmode"][data-m="ano"]').click();
  const title = page.locator('.weeknav strong'), year = Number(await title.textContent());
  await page.locator('[data-act="calnext"]').click();
  await expect(title).toHaveText(String(year + 1));
  await page.locator('[data-act="calprev"]').click();
  await page.locator('[data-act="calprev"]').click();
  await expect(title).toHaveText(String(year - 1));
});

test('Progreso: vacío al empezar, con datos al completar algo y sin el juego encendido', async ({ page }) => {
  await tab(page, 'hechas').click();
  await expect(page.locator('#list')).toContainText('Aquí verás tu progreso');
  await tab(page, 'hoy').click();
  await addTask(page, 'leer un rato');
  await page.getByRole('button', { name: 'Completar: Leer un rato' }).click();
  await tab(page, 'hechas').click();
  await expect(page.locator('#list')).toContainText('Resumen del mes');
  await expect(page.locator('#list')).not.toContainText('Nivel 1');
});

test('Hábitos: los de ejemplo se crean y se marcan', async ({ page }) => {
  await tab(page, 'habitos').click();
  await page.locator('[data-act="hseed"]').click();
  const first = page.locator('#list [data-act="hok"]').first();
  await first.click();
  await expect(page.locator('#toastText')).toContainText('⭐');
});

test('Compra: varias cosas con comas se ordenan por secciones', async ({ page }) => {
  await tab(page, 'sinfecha').click();
  await page.locator('[data-act="lsel"][data-k="compra"]').click();
  await page.locator('#shopInput').fill('leche, pan, manzanas');
  await page.locator('#shopInput').press('Enter');
  await expect(page.locator('.shoplist')).toHaveCount(3);
  // Sin cuenta no se puede compartir, así que el botón no sale
  await expect(page.locator('[data-act="shopshare"]')).toHaveCount(0);
});

test('todas las pestañas se abren sin errores', async ({ page }) => {
  for (const v of ['semana', 'habitos', 'sinfecha', 'notas', 'hechas', 'hoy']) {
    await tab(page, v).click();
    await expect(tab(page, v)).toHaveAttribute('aria-selected', 'true');
  }
});

test('la hoja de Siri, Atajos y Salud tiene sus seis textos para copiar, numerados', async ({ page }) => {
  const labels = await page.locator('#siriSetup .copyrow .label').allTextContents();
  expect(labels.map(l => l.match(/^Texto (\d)/)?.[1])).toEqual(['1', '2', '3', '4', '5', '6']);
  for (const id of ['siriUrl', 'siriBody', 'siriReadUrl', 'siriShareBody', 'saludUrl', 'saludBody']) await expect(page.locator(`#siriSetup #${id}`)).toHaveCount(1);
});
