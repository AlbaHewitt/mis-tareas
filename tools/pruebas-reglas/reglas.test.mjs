// Prueba firestore.rules en el emulador de Firebase: qué se puede y qué no.
// Se ejecuta con "npm run test:reglas" desde la raíz (necesita Java instalado).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-tareas',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8089 },
});
const A = env.authenticatedContext('alba').firestore(), B = env.authenticatedContext('dylan').firestore();
const C = env.authenticatedContext('otra').firestore(), N = env.unauthenticatedContext().firestore();
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'users/alba/settings/siri'), { key: 'clave123' }); });

let ok = 0, bad = 0;
const t = async (name, p) => { try { await p; ok++; console.log('✔', name); } catch (e) { bad++; console.log('✘', name, '·', e.message.slice(0, 160)); } };

// Tareas desde Siri y Atajos (sin iniciar sesión, con la clave)
await t('siri: tarea con clave', assertSucceeds(setDoc(doc(N, 'users/alba/tasks/t1'), { title: 'Hola', siriKey: 'clave123' })));
await t('siri: tarea con nota (desde Compartir)', assertSucceeds(setDoc(doc(N, 'users/alba/tasks/t2'), { title: 'Leer esto', notes: 'https://example.com', siriKey: 'clave123' })));
await t('siri: nota demasiado larga no', assertFails(setDoc(doc(N, 'users/alba/tasks/t3'), { title: 'x', notes: 'a'.repeat(2001), siriKey: 'clave123' })));
await t('siri: clave mala no', assertFails(setDoc(doc(N, 'users/alba/tasks/t4'), { title: 'x', siriKey: 'mala' })));
await t('siri: campos extra no', assertFails(setDoc(doc(N, 'users/alba/tasks/t5'), { title: 'x', siriKey: 'clave123', done: true })));
await t('siri: sin sesión no lee tareas', assertFails(getDoc(doc(N, 'users/alba/tasks/t1'))));
await t('tareas: dueña lee', assertSucceeds(getDoc(doc(A, 'users/alba/tasks/t1'))));
await t('tareas: otra cuenta no lee', assertFails(getDoc(doc(C, 'users/alba/tasks/t1'))));

// Salud
await t('salud: atajo con clave crea', assertSucceeds(setDoc(doc(N, 'users/alba/salud/2026-11-25'), { pasos: '8234', acostarse: '23:40', levantarse: '07:15', siriKey: 'clave123' })));
await t('salud: atajo actualiza', assertSucceeds(setDoc(doc(N, 'users/alba/salud/2026-11-25'), { pasos: '9000', acostarse: '', levantarse: '', siriKey: 'clave123' })));
await t('salud: clave mala no', assertFails(setDoc(doc(N, 'users/alba/salud/2026-11-26'), { pasos: '1', siriKey: 'otra' })));
await t('salud: campos extra no', assertFails(setDoc(doc(N, 'users/alba/salud/2026-11-26'), { pasos: '1', siriKey: 'clave123', x: 'y' })));
await t('salud: id que no es fecha no', assertFails(setDoc(doc(N, 'users/alba/salud/hola'), { pasos: '1', siriKey: 'clave123' })));
await t('salud: sin sesión no lee', assertFails(getDoc(doc(N, 'users/alba/salud/2026-11-25'))));
await t('salud: dueña lee', assertSucceeds(getDoc(doc(A, 'users/alba/salud/2026-11-25'))));
await t('salud: otra cuenta no lee', assertFails(getDoc(doc(C, 'users/alba/salud/2026-11-25'))));

// Compra compartida
const code = 'abcdefghij0123456789xyz1';
await t('compartir: crear', assertSucceeds(setDoc(doc(A, 'shared', code), { owner: 'alba', members: ['alba'], creada: 'x' })));
await t('compartir: crear a nombre de otra no', assertFails(setDoc(doc(B, 'shared', 'zzzzzzzzzzzzzzzzzzzzzzzz'), { owner: 'alba', members: ['alba'], creada: 'x' })));
await t('compartir: código corto no', assertFails(setDoc(doc(A, 'shared', 'corto'), { owner: 'alba', members: ['alba'], creada: 'x' })));
await t('compartir: dueña escribe cosa', assertSucceeds(setDoc(doc(A, 'shared', code, 'shop', 's1'), { name: 'Leche', sec: 'lacteos', done: false, order: 1 })));
await t('compartir: no miembro no lee', assertFails(getDoc(doc(B, 'shared', code, 'shop', 's1'))));
await t('compartir: no miembro no lee la lista', assertFails(getDoc(doc(B, 'shared', code))));
await t('compartir: unirse con el código', assertSucceeds(updateDoc(doc(B, 'shared', code), { members: arrayUnion('dylan') })));
await t('compartir: miembro lee', assertSucceeds(getDoc(doc(B, 'shared', code, 'shop', 's1'))));
await t('compartir: miembro marca', assertSucceeds(setDoc(doc(B, 'shared', code, 'shop', 's1'), { name: 'Leche', sec: 'lacteos', done: true, order: 1 })));
await t('compartir: miembro borra', assertSucceeds(deleteDoc(doc(B, 'shared', code, 'shop', 's1'))));
await t('compartir: no puede meter a otra persona', assertFails(updateDoc(doc(C, 'shared', code), { members: arrayUnion('otra', 'cuarta') })));
await t('compartir: no puede echar a otra', assertFails(updateDoc(doc(B, 'shared', code), { members: arrayRemove('alba') })));
await t('compartir: no puede cambiar dueña', assertFails(updateDoc(doc(B, 'shared', code), { owner: 'dylan' })));
await t('compartir: unirse a lista inexistente no', assertFails(updateDoc(doc(C, 'shared', 'noexiste0000000000000000'), { members: arrayUnion('otra') })));
await t('compartir: salir', assertSucceeds(updateDoc(doc(B, 'shared', code), { members: arrayRemove('dylan') })));
await t('compartir: tras salir no lee', assertFails(getDoc(doc(B, 'shared', code, 'shop', 's1'))));

// Lo demás de la cuenta: solo la dueña
await t('hábitos: dueña escribe', assertSucceeds(setDoc(doc(A, 'users/alba/habits/h1'), { name: 'x' })));
await t('hábitos: otra no', assertFails(setDoc(doc(C, 'users/alba/habits/h1'), { name: 'x' })));
await t('resumen de Siri: se lee con la clave', assertSucceeds(getDoc(doc(N, 'siri/clave123'))));

console.log(`\n${ok} bien, ${bad} mal`);
await env.cleanup();
process.exit(bad ? 1 : 0);
