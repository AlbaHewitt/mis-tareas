# Mis Tareas

App de tareas para iPhone y ordenador: eventos, entrenos, casa, estudio… Se instala en la pantalla de inicio, funciona sin conexión y sincroniza con Firebase.

## Archivos

- `index.html`, `app.js`: la app.
- `config.js`: la configuración de tu proyecto de Firebase.
- `sw.js`: hace que abra sin conexión. **Sube `VERSION` cada vez que publiques cambios.**
- `manifest.webmanifest`, `icons/`: nombre e icono al instalarla.
- `firestore.rules`: reglas de seguridad (cada persona solo ve sus tareas).
- `mis-tareas-importar.json`: tus tareas de la versión anterior. No se sube a GitHub.

## Pruebas

- `npm test`: los cálculos (fechas, repeticiones, puntos, avisos…).
- `npm run test:pantallas`: la app en un navegador como el del iPhone, sin cuenta: añadir, completar, Agenda, Progreso, Hábitos y Compra. La primera vez: `npm install` y `npx playwright install webkit`.
- `npm run test:reglas`: las reglas de `firestore.rules` en el emulador de Firebase (necesita Java). Pásalas siempre antes de publicar reglas nuevas en la consola.

GitHub pasa las dos primeras antes de publicar; si fallan, no se publica.

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

## Avisos en el móvil (configurar una vez)

Los avisos los manda GitHub cada 5 minutos (`.github/workflows/avisos.yml` y `tools/avisos/`). Necesita dos secretos del repositorio (Settings → Secrets and variables → Actions → New repository secret):

1. `FIREBASE_SERVICE_ACCOUNT`: en la consola de Firebase → ⚙️ Configuración del proyecto → Cuentas de servicio → “Generar nueva clave privada”. Pega el contenido entero del archivo .json que se descarga (y después borra ese archivo).
2. `VAPID_PRIVATE_KEY`: el texto de `claves-privadas/VAPID_PRIVATE_KEY.txt` (esa carpeta no se sube a GitHub). La clave pública ya está en `config.js`.

### Que lleguen a su hora (despertador en Cloudflare)

GitHub no cumple el “cada 5 minutos”: a veces pasa horas sin ejecutar el workflow. Por eso un Worker de Cloudflare (`tools/despertador/`) le pide a GitHub cada 5 minutos que lo ejecute ya. Se configura una vez:

1. En GitHub → tu foto → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token. Repositorio: solo `mis-tareas`. Permiso: **Actions: Read and write**. Copia el token.
2. En la carpeta `tools/despertador`: `npx wrangler deploy` y después `npx wrangler secret put GITHUB_TOKEN` (pega el token).
3. Comprueba en la pestaña Actions de GitHub que “Avisos” se ejecuta cada 5 minutos.

El cron de GitHub sigue de reserva; si coinciden dos ejecuciones no se repiten avisos.

Luego, en el iPhone, abre la app desde su icono de la pantalla de inicio → ⋯ → Avisos → Activar. GitHub pausa las tareas programadas si el repositorio pasa 60 días sin cambios; si dejan de llegar, en la pestaña Actions → Avisos → “Enable workflow”.

## Funciones

- **Escritura rápida**: “mañana a las 8 correr #entreno”, “los lunes y jueves gym”, “examen el 3 de diciembre !” (la `!` es prioridad alta). Lo entiende `parse.js`.
- **Deslizar**: a la derecha completa, a la izquierda borra (con Deshacer).
- **Repetir**: cada día, días de la semana, cada semana o un día concreto de cada mes, con fecha de inicio y de fin.
- **Partes**: divide una tarea en partes (p. ej. 20 temas repartidos de lunes a viernes); cada parte sale en su día y la tarea grande muestra 3/20 · 15 %. **Buscador** con la lupa.
- **Categorías** editables en ⋯ → Categorías (nombre, color, orden, borrar).
- **Cuenta**: nombre, correo y contraseña en ⋯ → Cuenta.
- **Calendario**: al editar una tarea con fecha, “Calendario iPhone” (archivo .ics con aviso) o “Google Calendar”.
- **Hoy**: una línea con las horas (todas del mismo alto) y cada tarea a su hora, solo con su nombre y un punto de color. Lo hecho se aclara y lo que se ha pasado sin hacer sale en rojo. Lo que no tiene hora sale al final como “Extra”. Con ✏️ Editar arrastras una tarea para moverla, tiras de su borde de arriba o de abajo para cambiar cuándo empieza o acaba, y arrastras las que no tienen hora a la línea (1 h por defecto). También cambias nombres, quitas o añades; Guardar vuelve a la línea.
- **Agenda**: el mes; tocas un día y ves sus tareas, y con las flechas pasas de mes.
- **Hábitos**: para hacer (cada día o X veces por semana), para dejar, y rutina de sueño (hora de acostarse, de levantarse y horas dormidas), con rachas. Al añadir uno no se sugieren los que ya tienes.
- **¿Qué tal hoy? y ¿Cómo has dormido?**: salen en Hoy hasta que los apuntas. En Progreso solo salen sus estadísticas: el ánimo en cuadraditos del año (más claro, mejor día) y el sueño con su media y un gráfico de líneas que se desliza hacia atrás (punto verde si llegaste a tu mínimo, rojo si no). El lápiz junto al título cambia lo de hoy.
- **Por apartado**: en Progreso, el lápiz elige qué apartados ver.
- **Ajustes**: Cuenta (nombre, correo y contraseña; Google Calendar y Siri), Avisos, Personalizar (apariencia, puntos, calendario y tiempo, categorías, Qué se ve, plantillas y recompensas), Traer y llevar, la papelera y Ayuda.
- **Libros**: los que quieres leer, el que estás leyendo con su página y su progreso, y los leídos (plegados) con su nota. Por defecto van por orden alfabético del título; se puede buscar y filtrar por autor, categoría y páginas, y ordenar por autor, páginas o los añadidos hace poco.
- **Películas**: igual que Libros: quiero ver y vistas (plegadas) con su nota; se busca y filtra por dirección, categoría y año (por décadas).
- **Partes**: en las listas y en Hoy, el título es la tarea grande y la parte sale en pequeño. La categoría se ve solo por su color.
- **Tocar y completar**: el círculo completa; tocar la tarea abre sus detalles (con sus partes para marcarlas una a una) y el lápiz la edita.
- **Partes agrupadas**: las partes de una misma tarea en un mismo día salen como una sola fila que se despliega. Cada parte da su parte proporcional de los puntos de la tarea (se puede cambiar) y se ordenan arrastrando ⋮⋮.
- **Bandera 🚩**: en vez de prioridad o de la antigua categoría Urgente, las tareas importantes llevan bandera (también con “!” o “urgente” al escribir); van primero y tienen su lista “Con bandera”. Las tareas que estaban en Urgente pasaron solas a tener bandera y su categoría se adivinó. Si no eliges categoría, se adivina por las palabras (gym → Entreno, estudiar → Estudio, limpiar → Casa, cumple → Cumpleaños…).
- **Repeticiones flexibles**: cada N días, semanas, meses o años; días de la semana cada N semanas (“una semana sí y otra no”); el primer/segundo/tercer/cuarto/último lunes… de cada mes; y una vez al año. También escritas: “cada 15 días”, “cada dos martes”, “el primer domingo de cada mes”, “una vez al mes”, “entre semana una semana sí y otra no”.
- **Hábitos por mes y por año** (p. ej. limpiar radiadores una vez al mes), y los grupos de Hábitos se pliegan y despliegan.
- **Repetir**: si una tarea que se repite se queda sin hacer, pasa sola al siguiente día que le toca. La hora de fin es, por defecto, una hora después del inicio.
- **Editar Hoy**: tocar una tarea cambia su hora (se guarda con ✓); mantener pulsado la arrastra; “Quitar hora” la devuelve a Sin hora. Las rutinas salen como un solo bloque; sus pasos se ven al tocarlas.
- **Libros y películas**: pestañas por estado, botón + para añadir y búsqueda automática de lo que falte (autor o dirección, año, categoría y páginas) en Open Library y Wikidata (solo se envía el título).
- **En Hoy**: cuántos hábitos de hoy te quedan (toca para ir a Hábitos) y, en “De otros días”, mover todas las atrasadas a hoy, a mañana o a sin fecha. En los detalles de una tarea, moverla a hoy, mañana, el lunes o sin fecha.
- **Agenda (calendario)**: vistas Día, Semana, Mes, Año y Lista (lo que viene, día a día), botón Hoy y deslizar a los lados para cambiar. En Día y Semana, arriba las horas y debajo “Sin hora”. Pellizcar a lo ancho enseña más o menos días (de 1 a 7; en el iPhone empieza en 3) y a lo alto hace las horas más grandes o más pequeñas. Tocar un hueco apunta algo a esa hora; mantener pulsado un hueco y arrastrar elige de qué hora a qué hora. Mantener pulsada una tarea la mueve de hora o de día (o abajo, a Sin hora); las de Sin hora se arrastran a la rejilla para darles hora; tirando del borde cambia lo que dura (todo con Deshacer). En el Mes, se mantiene pulsada una tarea de la lista y se suelta en otro día. Números de semana (S47) y el tiempo de cada día (⋯ → Personalizar → Calendario y tiempo). Las tareas pueden tener ubicación (📍, se abre en Mapas y va al calendario del iPhone y a Google).
- **Menú al mantener pulsado**: en cualquier lista o en la Agenda, mantener pulsada una tarea y soltar sin moverla abre: hecha, bandera, “la estoy haciendo”, duplicar, copiar a otro día, mover a otro día, editar y borrar.
- **Cumpleaños**: categoría propia que se repite cada año; con el año de nacimiento sale la edad (🎂 Ana (30)) y Hoy avisa el día antes.
- **Listas**: la pestaña Listas tiene Sin fecha, Con bandera, la Compra, los Proyectos, tus listas inteligentes (se rellenan solas según categoría, etiquetas, bandera, ubicación, proyecto o fecha) y las etiquetas. Cada lista y cada proyecto se ve como lista o como Tablero (Por hacer · Haciendo · Hecho, arrastrando las tarjetas).
- **Proyectos**: nombre, color, fecha límite y notas; juntan sus tareas (con su progreso) y sus notas.
- **Compra**: escribe varias cosas separadas por comas y se ordenan solas por secciones del súper; tocando una se cambia de sección (y lo recuerda). Al marcarla va al carro; “Vaciar” limpia el carro.
- **Notas**: con carpetas, fijadas arriba, búsqueda, listas con casillas, fotos, dibujos (con el Apple Pencil la mano no pinta; la goma borra trazos enteros) y enlaces. El **Diario** es una nota por día con unas preguntas (botón en Hoy y en Notas).
- **Enlaces**: una tarea o una nota se puede enlazar con notas, tareas, proyectos, libros o películas; en cada cosa se ve también lo que la enlaza.
- **Organizar mi día**: en Hoy, ✨ Organizar coloca lo que no tiene hora en tus huecos libres (primero lo que lleva 🚩 y lo atrasado), sin pisar lo que ya tiene hora ni las rutinas. Si ya es tarde, organiza mañana desde que te levantas. Lo que no cabe puede pasar al día siguiente.
- **Cerrar el día**: por la noche (o con 🌙 en Hoy): lo que has hecho, lo que queda (hecha, mañana, otro día o sin fecha), los hábitos que faltan, el ánimo y el diario.
- **Pasos y sueño desde Salud**: un atajo de Atajos (⋯ → Cuenta → Siri, Atajos y Salud) manda cada día tus pasos y a qué hora te acostaste y te levantaste. Se marcan solos los hábitos de pasos y la rutina de sueño, y en Progreso salen tus pasos de la semana.
- **Sin abrir la app**: atajo para añadir desde el botón Compartir (con el enlace en las notas), y widget, Centro de control y botón de Acción con los atajos de Siri. Las instrucciones están en ⋯ → Cuenta → Siri, Atajos y Salud.
- **Compra compartida**: en Listas → Compra → 👥 Compartir. Quien abra el enlace con su cuenta ve y marca la misma lista al momento.
- **Para empezar**: al añadir una tarea sale solo la línea de texto (con Hoy, Mañana, Sin fecha y 🚩); “Más detalles…” abre el resto con lo escrito ya colocado. Niveles, logros, premios y jardín empiezan apagados (⋯ → Personalizar → Qué se ve).
- **Papelera**: ⋯ → Borrado recientemente. Las tareas, notas, proyectos y hábitos borrados se guardan 30 días.
- **Hábitos que se cuentan**: “Cuántos al día” (8 vasos, 10.000 pasos…) con + y −, o escribiendo el número; se cumple al llegar.
- **Metas del año**: en Progreso. A mano (con + y −) o automáticas: libros leídos, películas vistas, días de un hábito, tareas con una etiqueta o proyectos terminados. La rayita marca dónde deberías ir.
- **Cuentas atrás**: en una tarea con fecha futura (o un proyecto con fecha límite), “⏳ Cuenta atrás en Hoy”.
- **Tiempo dedicado**: en Progreso, por categoría y por proyecto (semana o mes), con las horas de lo que completas y el temporizador.
- **Búsqueda en todo**: la lupa busca en tareas, notas, proyectos, libros, películas, la compra y los hábitos.
- **Notas privadas**: el candado 🔓 de una nota hace que solo se abra con Face ID (o Touch ID o el código del dispositivo). Es un candado en el dispositivo: la nota sigue guardada en tu cuenta y en la copia de seguridad.
- **Listas reutilizables**: en una nota con casillas, “↺ Desmarcar todo” o “⧉ Hacer una copia”. En la Compra, “Añadir desde una lista de Notas”.
- **Hoy, sin ruido**: arriba, “Tareas sin hora” y “De otros días” plegadas (se despliegan al tocarlas); la línea de horas empieza cerca de lo siguiente (“Libre hasta las 9:00”). Para apuntar, el botón +.
- **Progreso más corto**: “Tu progreso” junta el año (toca un mes), ese mes y sus semanas (deslizando). “Concentración” va dentro de “Tiempo dedicado”.
- **Filtro de categorías**: con el embudo de arriba, solo cuando lo necesitas. “Sincronizado” solo sale si hay algún problema.
- **Detalles de una tarea**: lo que es, ✓ Hecha, Editar y ⋯ Más (mover, bandera, haciendo, duplicar, copiar, foto, dibujo, enlazar, concentrarme y borrar; es el mismo menú que al mantenerla pulsada).
- **Qué se ve**: ⋯ → Personalizar → Qué se ve: el modo sencillo, las secciones y los apartados de Progreso, todo en un sitio.
- **Por la noche**: en Hoy solo sale “¿Cerramos el día?”; el ánimo y el diario van dentro (el diario también está en Notas).
- **Libros y Películas**: en Listas, junto a la Compra.
- **Progreso para empezar**: las tarjetas sin datos (tiempo, ánimo, jardín, por apartado) no salen hasta que tengas algo.
- **Avisos**: ⋯ → Avisos. Tareas con hora (X minutos antes, o lo que pongas en “Aviso” de la tarea), cumpleaños (la víspera y el día), hábitos que faltan por la noche y un resumen por la mañana. Pueden llegar con unos minutos de diferencia.
- **Modo sencillo**: ⋯ → Personalizar. Abajo solo Hoy, Agenda, Hábitos y Listas; Notas y Progreso pasan al menú ⋯.
- **Traer y llevar tus cosas**: ⋯ → Traer y llevar. Importa calendarios (.ics), Todoist o Excel (.csv), texto o una lista pegada (por ejemplo, tus Recordatorios copiados), sin duplicar. Exporta a Excel (tareas, hábitos, libros y películas), al calendario (.ics), imprime la semana (o la guarda en PDF) y hace la copia de seguridad, también la completa con fotos.
- **Resumen del mes**: en Progreso (y en Hoy la primera semana de cada mes): puntos, tareas, tiempo por categoría, hábitos, libros, películas y ánimo, y se guarda como imagen.
- **Más rápida**: abre al instante con lo guardado; las versiones nuevas se instalan aparte y se ponen al volver a la app (o con “Actualizar”).
- **Fotos en las tareas**: en los detalles, 📷 Foto o ✏️ Dibujo. Las fotos se guardan achicadas y aparte (no van en la copia de seguridad).
- **iPad**: el menú pasa a la izquierda con un mini calendario del mes debajo, la Agenda empieza en Semana y Hoy se ve en dos columnas (la línea de horas y, al lado, Extra y lo atrasado). Con teclado: T hoy, ← → antes/después, N nueva, D S M A L vistas, + − tamaño de las horas, 1–6 pestañas, / buscar, Esc cerrar.
- **Libros y películas en portadas**: “▦ Portadas” los enseña como una galería; las portadas se buscan solas (Open Library y Wikipedia).
- **Hecha en su día**: una tarea de un día pasado (p. ej. de ayer, marcada pasada la medianoche) cuenta como hecha ese día, con sus puntos. Si la hiciste hoy, muévela antes a hoy. Las que se repiten no se mueven solas hasta las 6 de la mañana.
- **Hábitos hechos ocultos**: al cumplir un hábito desaparece de la lista; “Mostrar los hechos” los enseña. Cada rutina se pliega y despliega.
- **Progreso a tu gusto**: en ⋯ → Personalizar → Progreso ordenas los apartados arrastrando ⋮⋮, apagas o enciendes cada uno, eliges su color y si va en tonos (claro → oscuro u oscuro → claro) o en arcoíris. También “🎨 A mi gusto”, con un color para cada nivel (o cada día de la semana), y una paleta amplia con cualquier color. En “Por apartado”, cada categoría puede tener su color y los hábitos van juntos en “Todos los hábitos”. El mes y el año van según tu objetivo de puntos diario: cada día se colorea por los puntos que ganaste frente al objetivo (lleno = objetivo cumplido); así cada cosa pesa lo que valen sus puntos.
- **Ordenar hábitos**: en Hábitos, “↕ Ordenar” y las flechas de cada uno. “Esta semana” se desliza para ver las semanas anteriores.
- **Tareas sin fecha**: no llevan prioridad, repetición ni aviso; esas casillas salen al ponerles un día.
- **Puntos**: cada tarea da su duración (hora de inicio a fin) o sus minutos, o los puntos que le pongas a mano; objetivo diario en ⋯ → Puntos.
- **Progreso**: resumen de la semana, gráfico del mes, el año en cuadraditos (una fila por mes) y cuadraditos por apartado.
- **Plan de examen**: en una tarea con fecha, “Repartir en varias partes” propone acabar el día antes y reparte las partes hasta ahí; la tarea muestra “faltan 16 días · vas 1 por detrás”.
- **Recompensas**: ⋯ → Recompensas. Premios con su precio en ⭐ que canjeas con tu saldo (ganados − gastados).
- **Replanificar**: en Hoy, “De otros días” tiene “Todas a hoy / A mañana / Sin fecha”. Los domingos, Cerrar el día enseña también la semana que viene.
- **Temporizador**: al editar una tarea, “Empezar a concentrarme”: pomodoro 25/5, 50/10 o libre. Cada minuto concentrada suma 1 ⭐ y se guarda en la tarea.
- **Rutinas con horario**: un tipo de hábito con pasos a su hora (p. ej. rutina de noche). Se marcan paso a paso; cada paso puntúa los minutos hasta el siguiente.
- **Ahora toca**: en Hoy, lo que está pasando según las horas (tareas y pasos de rutinas) y lo siguiente.
- **Concentración por asignatura**: en Progreso, minutos de temporizador por tarea grande, semana y mes.
- **Apariencia**: ⋯ → Apariencia, modo claro/oscuro/automático y color principal.
- **Importar rutinas**: ⋯ → Importar copia admite un archivo `{"habits": [...]}` (como `mis-tareas-rutinas.json`, que no se sube a GitHub).
- **Plantillas**: al editar una tarea, “Guardar como plantilla” (con sus partes en días relativos); al crear una tarea, se elige arriba. Se gestionan en ⋯ → Plantillas.
- **Estadísticas de sueño**: en Progreso, la media de lo que duermes (la de las noches que se ven en el gráfico) y el gráfico de cada noche.
- **Copia de seguridad**: ⋯ → Guardar copia guarda todo (tareas, hábitos, categorías, recompensas, plantillas, libros, películas, proyectos, compra, notas y metas; las fotos no). Si pasan 7 días sin copia, Hoy lo recuerda. En el iPhone se puede guardar en Archivos o en Google Drive desde el menú Compartir.
- **Etiquetas y listas inteligentes**: escribe @etiqueta en el título o en el campo Etiquetas (salen las que ya usas para tocarlas); tocar una etiqueta busca todo lo que la lleva; las listas inteligentes se crean en Listas → Mis listas.
- **Esta noche**: las tareas de hoy marcadas “Esta noche” salen aparte.
- **Niveles y logros**: subes de nivel con tus puntos y desbloqueas logros (en Progreso).
- **Ánimo y energía**: cada día en Hábitos; en Progreso ves cómo cambia con el sueño, el entreno y lo que cumples.
- **Estimado vs real** y **jardín de concentración** (cada sesión del temporizador planta algo) en Progreso.
- **Google Calendar**: ⋯ → Google Calendar trae tus eventos (sin los de color Grafito) y lleva tus tareas con hora a un calendario “Mis Tareas”, con aviso.
- **Siri “¿Qué tengo hoy?”**: segundo atajo en ⋯ → Siri y Atajos; lee el resumen del día.
- **Ayuda y secciones**: guía, interruptores para ocultar secciones y registro de errores.
- **Cuenta**: verificar el correo y vincular Google para entrar con él.

## Para desarrollar

- logic.js tiene la lógica pura (fechas, repeticiones, puntos, hábitos, sueño, niveles); pp.js, la pantalla y los datos.
- Pruebas: `npm test` (Node 20, sin dependencias). En GitHub, el flujo **Probar y publicar** las pasa y solo publica si van bien.
- **Siri**: ⋯ → Siri y Atajos genera una clave personal y explica cómo crear el atajo “Añade tarea”. La clave solo permite añadir tareas, no leerlas.

## Pasar tus tareas antiguas

En el ordenador, abre la app, crea tu cuenta y ve a **⋯ → Importar copia** → elige `mis-tareas-importar.json`.
