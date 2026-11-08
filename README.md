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
- **Repetir**: cada día, días de la semana, cada semana o un día concreto de cada mes, con fecha de inicio y de fin.
- **Partes**: divide una tarea en partes (p. ej. 20 temas repartidos de lunes a viernes); cada parte sale en su día y la tarea grande muestra 3/20 · 15 %. **Buscador** con la lupa.
- **Categorías** editables en ⋯ → Categorías (nombre, color, orden, borrar).
- **Cuenta**: nombre, correo y contraseña en ⋯ → Cuenta.
- **Calendario**: al editar una tarea con fecha, “Calendario iPhone” (archivo .ics con aviso) o “Google Calendar”.
- **Agenda**: semana a semana (con las repeticiones) o todo lo próximo.
- **Hábitos**: para hacer (cada día o X veces por semana), para dejar, y rutina de sueño (hora de acostarse, de levantarse y horas dormidas), con rachas.
- **Puntos**: cada tarea da su duración (hora de inicio a fin) o sus minutos, o los puntos que le pongas a mano; objetivo diario en ⋯ → Puntos.
- **Progreso**: resumen de la semana, gráfico del mes, el año en cuadraditos (una fila por mes) y cuadraditos por apartado.
- **Plan de examen**: en una tarea con fecha, “Repartir en varias partes” propone acabar el día antes y reparte las partes hasta ahí; la tarea muestra “faltan 16 días · vas 1 por detrás”.
- **Recompensas**: ⋯ → Recompensas. Premios con su precio en ⭐ que canjeas con tu saldo (ganados − gastados).
- **Replanificar**: en Hoy, el grupo Atrasadas tiene “Todas a hoy / A mañana / Sin fecha”. Los domingos aparece el Repaso de la semana (también en Agenda).
- **Temporizador**: al editar una tarea, “Empezar a concentrarme”: pomodoro 25/5, 50/10 o libre. Cada minuto concentrada suma 1 ⭐ y se guarda en la tarea.
- **Rutinas con horario**: un tipo de hábito con pasos a su hora (p. ej. rutina de noche). Se marcan paso a paso; cada paso puntúa los minutos hasta el siguiente.
- **Ahora toca**: en Hoy, lo que está pasando según las horas (tareas y pasos de rutinas) y lo siguiente.
- **Concentración por asignatura**: en Progreso, minutos de temporizador por tarea grande, semana y mes.
- **Apariencia**: ⋯ → Apariencia, modo claro/oscuro/automático y color principal.
- **Importar rutinas**: ⋯ → Importar copia admite un archivo `{"habits": [...]}` (como `mis-tareas-rutinas.json`, que no se sube a GitHub).
- **Bandeja rápida**: arriba en Hoy, “Apuntar rápido…”; luego cada cosa se manda a hoy, mañana o sin fecha.
- **Plantillas**: al editar una tarea, “Guardar como plantilla” (con sus partes en días relativos); al crear una tarea, se elige arriba. Se gestionan en ⋯ → Plantillas.
- **Estadísticas de sueño**: en la rutina de sueño, las últimas 2 semanas (media dormida, hora media de acostarse, % de noches cumplidas y barras).
- **Copia de seguridad**: ⋯ → Guardar copia guarda todo (tareas, hábitos, categorías, recompensas, plantillas). Si pasan 7 días sin copia, Hoy lo recuerda. En el iPhone se puede guardar en Archivos o en Google Drive desde el menú Compartir.
- **Siri**: ⋯ → Siri y Atajos genera una clave personal y explica cómo crear el atajo “Añade tarea”. La clave solo permite añadir tareas, no leerlas.

## Pasar tus tareas antiguas

En el ordenador, abre la app, crea tu cuenta y ve a **⋯ → Importar copia** → elige `mis-tareas-importar.json`.
