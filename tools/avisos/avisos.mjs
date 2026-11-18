// Manda los avisos que tocan ahora. Lo ejecuta GitHub cada 5 minutos (.github/workflows/avisos.yml).
// Necesita dos secretos del repositorio: FIREBASE_SERVICE_ACCOUNT y VAPID_PRIVATE_KEY.
import admin from 'firebase-admin';
import webpush from 'web-push';
import { firebaseConfig } from '../../config.js';
import { plan, addDays } from './plan.mjs';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT, VAPID = process.env.VAPID_PRIVATE_KEY;
if (!SA || !VAPID) { console.log('Faltan los secretos FIREBASE_SERVICE_ACCOUNT y VAPID_PRIVATE_KEY: no se envía nada.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
webpush.setVapidDetails('https://albahewitt.github.io/mis-tareas/', firebaseConfig.vapidPublicKey, VAPID.trim());
const db = admin.firestore();

// Fecha y minuto actuales en la zona horaria de cada persona
function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

const subs = await db.collectionGroup('push').get();
const byUser = new Map();
subs.docs.forEach(d => { const uid = d.ref.parent.parent?.id; if (uid) (byUser.get(uid) || byUser.set(uid, []).get(uid)).push(d); });
let sentTotal = 0;
for (const [uid, devices] of byUser) {
  try {
    const prefs = (await db.doc(`users/${uid}/settings/prefs`).get()).data()?.value?.push || {};
    if (prefs.off) continue;
    let tz = prefs.tz || 'Europe/Madrid'; try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = 'Europe/Madrid'; }
    const now = localNow(tz), tomorrow = addDays(now.date, 1);
    const logRef = db.doc(`users/${uid}/settings/pushlog`), sent = (await logRef.get()).data()?.sent || {};
    const tasks = (await db.collection(`users/${uid}/tasks`).where('date', 'in', [now.date, tomorrow]).get()).docs.map(d => ({ id: d.id, ...d.data() }));
    // Los hábitos solo se leen a la hora del aviso de hábitos (así se gastan menos lecturas)
    const habitHour = (prefs.habitHour ?? 21) * 60, wantHabits = prefs.habits !== false && Math.abs(now.min - habitHour) <= 45 && !sent[`h:${now.date}`];
    const habits = wantHabits ? (await db.collection(`users/${uid}/habits`).get()).docs.map(d => ({ id: d.id, ...d.data() })) : [];
    const msgs = plan({ now, prefs, tasks, habits, sent });
    if (!msgs.length) continue;
    for (const m of msgs) {
      for (const dev of devices) {
        const sub = dev.data().sub; if (!sub?.endpoint) continue;
        try { await webpush.sendNotification(sub, JSON.stringify(m), { TTL: 3600, urgency: 'high' }); sentTotal++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await dev.ref.delete(); else console.log('Error al enviar', e.statusCode || e.message); }
      }
      sent[m.key] = Date.now();
    }
    // Se guarda lo enviado (y se olvida lo de hace más de 3 días)
    const lim = Date.now() - 3 * 864e5;
    await logRef.set({ sent: Object.fromEntries(Object.entries(sent).filter(([, v]) => v > lim)) });
  } catch (e) { console.log('Error con una cuenta:', e.message); }
}
console.log(`Avisos enviados: ${sentTotal} (${byUser.size} cuentas con avisos)`);
process.exit(0);
