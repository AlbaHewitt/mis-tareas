# Mis Tareas

App de tareas para iPhone y ordenador: eventos, entrenos, casa, estudio… Se instala en la pantalla de inicio, funciona sin conexión y sincroniza con Firebase.

## Archivos

- `index.html`, `app.js`: la app.
- `config.js`: la configuración de tu proyecto de Firebase.
- `sw.js`: hace que abra sin conexión. **Sube `VERSION` cada vez que publiques cambios.**
- `manifest.webmanifest`, `icons/`: nombre e icono al instalarla.
- `firestore.rules`: reglas de seguridad (cada persona solo ve sus tareas).
- `mis-tareas-importar.json`: tus tareas de la versión anterior. No se sube a GitHub.

## Configurar Firebase (una vez)

1. Entra en <https://console.firebase.google.com> → **Crear un proyecto** → nombre `mis-tareas` → desactiva Google Analytics → Crear.
2. **Compilación → Authentication → Comenzar** → pestaña *Método de acceso* → **Correo electrónico/contraseña** → Habilitar → Guardar.
3. **Compilación → Firestore Database → Crear base de datos** → ubicación `eur3 (Europe)` → *Iniciar en modo de producción* → Crear.
   Luego pestaña **Reglas**: borra lo que haya, pega el contenido de `firestore.rules` y pulsa **Publicar**.
4. ⚙️ **Configuración del proyecto → General → Tus apps → icono `</>`** (Web) → apodo `mis-tareas` → *Registrar app*.
   Copia el bloque `firebaseConfig` y ponlo en `config.js`.
5. **Authentication → Configuración → Dominios autorizados → Agregar dominio** → `TUUSUARIO.github.io`.

## Publicar en GitHub Pages

1. En <https://github.com/new> crea un repositorio **público** llamado `mis-tareas` (sin README).
2. Sube estos archivos (`git push`).
3. En el repositorio: **Settings → Pages → Branch: `main` / `(root)` → Save**. En un par de minutos estará en `https://TUUSUARIO.github.io/mis-tareas/`.

## Instalar en el iPhone

Abre la dirección en **Safari** → botón Compartir → **Añadir a pantalla de inicio**. Ábrela siempre desde el icono: así sale a pantalla completa, sin barras de navegador ni zoom.

## Funciones

- **Escritura rápida**: “mañana a las 8 correr #entreno”, “los lunes y jueves gym”, “examen el 3 de diciembre !” (la `!` es prioridad alta). Lo entiende `parse.js`.
- **Deslizar**: a la derecha completa, a la izquierda borra (con Deshacer).
- **Repetir**: cada día, días concretos (L M X J V S D), cada semana o cada mes.
- **Pasos** dentro de cada tarea y **buscador** (lupa arriba).
- **Categorías** editables en ⋯ → Categorías (nombre, color, orden, borrar).
- **Cuenta**: nombre, correo y contraseña en ⋯ → Cuenta.
- **Siri**: ⋯ → Siri y Atajos genera una clave personal y explica cómo crear el atajo “Añade tarea”. La clave solo permite añadir tareas, no leerlas.

## Pasar tus tareas antiguas

En el ordenador, abre la app, crea tu cuenta y ve a **⋯ → Importar copia** → elige `mis-tareas-importar.json`.
