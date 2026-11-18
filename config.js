// Configuración de Firebase (proyecto tareasmis-tareas).
// Estos valores no son secretos: la seguridad la ponen las reglas de firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyDJXIZVtgxXJBDXUw2U0CUPyJk_xO3zjlY',
  authDomain: 'tareasmis-tareas.firebaseapp.com',
  projectId: 'tareasmis-tareas',
  storageBucket: 'tareasmis-tareas.firebasestorage.app',
  messagingSenderId: '193462600208',
  appId: '1:193462600208:web:7cf1ceeb8cc84d5f030095',
  // Permiso de Google (OAuth) para sincronizar con Google Calendar
  // Clave pública de los avisos (la privada no está aquí: va en los secretos de GitHub)
  vapidPublicKey: 'BEk1C1hOJI50zL5SUvgRdsWv4DOJYf2eU7v6-eUYzO7JlFYAaxyR1O5y5bGUJPmxG3sjZf21agMG8f2zTqHcN2M',
  googleClientId: '193462600208-g9su001bib1joj8fmkbqsnaa3gfb0a8m.apps.googleusercontent.com',
};
