# Plan: persistencia de letras, acordes y timestamps

Estado: **fase 0 (spikes) completada con GO y fase 1 implementada y desplegada**. Pendiente: fase 2 (Google OAuth) y decisiones opcionales de la sección 13.

Objetivo: dejar de depender del estado en memoria y de `localStorage` para el
contenido de la canción. Guardar en SQLite la letra, los acordes y los tiempos,
permitir que el usuario los edite, enlazar automáticamente un video de YouTube y
generar una primera versión de los timestamps alineando la letra con la
transcripción del video. El login con Google queda para la fase 2.

---

## 1. Situación actual (verificada en el código)

> Contexto pre-fase 1: este análisis describe el estado antes de la persistencia.
> Hoy la app persiste en SQLite; ver secciones 9 y 13.

### 1.1 Posición sobre la letra

- `src/parser/lacuerda.ts:103` (`parseLacuerdaHtml`) recorre el bloque `#t_body`
  y produce `SongLine[]` con `{ chords: { chord, column }[], lyric }`.
- `parseChordLine` (`src/parser/lacuerda.ts:52`) calcula la columna visible de
  cada acorde contando el texto que lo precede. No hay coordenadas de pantalla.
- `src/render/song.ts:45` (`assignChords`) asigna cada acorde a la palabra cuya
  columna cae dentro del rango, o a la siguiente, o a la última.
- El índice global del acorde (`firstChordIndex`) se calcula por orden de
  aparición en el DOM (`src/render/song.ts:108-116`). Es la clave que hoy usan
  los timestamps.

### 1.2 Timestamps

- `public/youtube.js:1` usa `localStorage["acordes-youtube-videos"]`.
- El tiempo se guarda como un arreglo plano `chordTimestamps[index]`, donde
  `index` es el orden del acorde en la letra (`public/youtube.js:564`).
- La reproducción resalta el acorde con la marca más reciente anterior al
  tiempo actual (`public/youtube.js:180`).

### 1.3 Persistencia actual

- `src/state.ts:10`: `Map<string, SongState>` en memoria del servidor.
- `POST /transpose` y `POST /reset` mutan `state.offset` en ese `Map`
  (`src/routes/transpose.ts`). Se pierde al reiniciar y no es multiusuario.
- La letra se vuelve a descargar de LaCuerda en cada `POST /load`
  (`src/routes/load.ts:41`).
- Favoritos y preferencia de transposición viven en `localStorage`.
- `Dockerfile` no incluye volumen de datos: hoy no hay nada que persistir.

### 1.4 Consecuencias

- Reiniciar el proceso invalida los `id` de canción y los POST de transposición.
- Editar la letra o los acordes rompería los timestamps porque estos se indexan
  por posición consecutiva.
- No hay una fuente de verdad editable: LaCuerda manda siempre.
- El video/timestamps de un navegador no se comparten ni sobreviven a la
  limpieza de `localStorage`.

---

## 2. Investigación realizada (evidencia)

### 2.1 LaCuerda

- El parser funciona contra páginas reales. Probado con
  `https://acordes.lacuerda.net/chalchaleros/debajo_de_la_morera.shtml`:
  29 líneas, 23 acordes, título/artista correctos.
- Probado con `https://acordes.lacuerda.net/diego_torres/color_esperanza.shtml`:
  52 líneas, 40 acordes.
- Desde la IP local, `busca.php` devuelve HTTP 500 (bloqueo/limitación), pero
  **desde el servidor de producción sí funciona**: `GET /search?q=color%20esperanza`
  devolvió 50 resultados y `POST /load` renderizó la canción. La app puede seguir
  usando LaCuerda desde el servidor.
- Hallazgo de calidad: LaCuerda incluye líneas que no son letra (p. ej.
  `"Corrección"`) y separa versos en varias líneas. El pipeline de alineación
  debe filtrar ruido y alinear por palabra, no por línea.

### 2.2 Búsqueda en YouTube

- La búsqueda interna (`POST https://www.youtube.com/youtubei/v1/search`, cliente
  `WEB`) funciona sin API key y devuelve `videoId`, título, canal y duración.
  Probado con "Los Chalchaleros Debajo de la morera" y "Color Esperanza Diego
  Torres".
- Riesgo: es un endpoint no oficial. Puede cambiar o bloquear por IP.

### 2.3 Transcripciones

- `https://www.youtube.com/api/timedtext` devuelve HTTP 200 con cuerpo vacío
  actualmente (requiere prueba de origen / `pot`). No es viable directamente.
- `get_transcript` de innertube devuelve `400 FAILED_PRECONDITION` sin tokens
  válidos. No es viable directamente.
- **`yt-dlp` sí funciona**: `yt-dlp --skip-download --write-auto-subs
  --sub-langs "es-orig" --sub-format json3` descargó la transcripción automática
  de YouTube con marcas de tiempo (`events[].tStartMs`).
- Se detectó HTTP 429 al pedir muchas variantes de idioma. Solución: pedir **un
  solo idioma** por ejecución, con caché y backoff.
- `yt-dlp` advierte que necesita un runtime JS (`deno`) para algunos formatos;
  para subtítulos funcionó sin él, pero conviene instalar `deno` en la imagen como
  red de seguridad.

### 2.4 Alineación letra ↔ transcripción (prueba de concepto)

Se alinearon dos canciones reales (LaCuerda) contra transcripciones automáticas
en español descargadas con `yt-dlp` desde el host de producción:

- **Color Esperanza** (`ibmowkf0gkM`, video "Letra"):
  - 159 palabras de letra, 226 palabras de transcripción tras deduplicar el
    modo "rolling".
  - Coincidencia exacta: 83,0 % de palabras; 38/40 líneas con letra.
  - Con tolerancia fuzzy (prefijo + Levenshtein): **87,4 % de palabras; 39/40
    líneas (97,5 %)**.
  - Tiempos coherentes: "Se que hay en tus ojos" ≈ 5,6 s; "con solo mirar" ≈
    8,1 s; "Que estas cansado de andar" ≈ 10,9 s.
- **Debajo de la Morera** (`bt139Dqt1Q4`):
  - 110 palabras de letra, 195 de transcripción.
  - Exacta: 44,5 % / 19 de 25 líneas. Fuzzy: **56,4 % / 22 de 25 líneas**.
  - La transcripción automática es muy mala ("a pedaz cielo", "guo de los
    paisan", "hbu de los tucumá"), por debajo del umbral del 60 % → `partial`.
  - Los otros candidatos del top-5 (`2P_VRceaGBk`, `cpIY-s3-n0w`,
    `-2DOMR2nDoc`) no tienen subtítulos en español.
- Limitación: los subtítulos automáticos son **por segmento de caption
  (2–5 s)**, no por palabra. Varios acordes de una misma línea comparten el
  tiempo del segmento. Sirven como punto de partida, no como sincronización
  exacta.

Conclusión: **sí es posible** generar timestamps automáticos como borrador. La
cobertura depende de la calidad del ASR del video; el umbral + la corrección
manual siguen siendo obligatorios.

### 2.5 Spike en el servidor (go/no-go) — hecho

Ejecutado el 2026-11-08 directamente en el host de producción (`bazzite`,
IP pública `206.62.143.32`), que es la misma salida del contenedor
(`acordes-app-c` en Docker). No hizo falta desplegar un endpoint temporal.

- **Innertube**: 2 consultas (`Diego Torres Color Esperanza`, `Los Chalchaleros
  Debajo de la Morera`), HTTP 200, 5 resultados cada una con `videoId`, título y
  duración.
- **`yt-dlp` 2026.10.26**: 6 ejecuciones, código de salida 0, 3,5–5,9 s por
  video, sin HTTP 429. Descargó `es.json3` y `es-orig.json3` (28 KB / 25 KB).
- **Videos sin subtítulos**: el top-1 de Color Esperanza (video oficial
  `Nb1VOQRs-Vs`) no tiene subtítulos; el video "Letra" sí. Esto confirma que hay
  que validar el transcript y ofrecer candidatos, no asumir que el top-1 sirve.
- `deno` no está instalado; `yt-dlp` solo avisa. Los subtítulos funcionaron
  igualmente, pero se instalará `deno` en la imagen como red de seguridad.

Comandos reproducibles (desde el host de producción):

```bash
# Búsqueda (POST JSON con client WEB; ver 2.2)
# Transcripción:
/tmp/yt-dlp --skip-download --write-auto-subs --write-subs \
  --sub-langs "es,es-orig" --sub-format json3 \
  -o "/tmp/opencode/sub/%(id)s.%(ext)s" \
  "https://www.youtube.com/watch?v=ibmowkf0gkM"
```

**Resultado: GO** para búsqueda + transcripción desde producción. Riesgos
abiertos: el top-1 puede no tener subtítulos, el ASR puede ser malo y YouTube
puede cambiar. Mitigaciones: probar candidatos, umbral de cobertura, caché,
backoff y marcas manuales.

---

## 3. Arquitectura propuesta

### 3.1 Principios

- SQLite es la fuente de verdad del contenido de la canción.
- **Modelo compartido**: una sola fila por canción de LaCuerda. Cualquier
  visitante anónimo edita la misma letra, acordes y marcas. En fase 2 el login
  solo identifica al autor; no hay copias por invitado.
- LaCuerda es solo el origen inicial; YouTube es el origen del audio y, si se
  puede, de la transcripción.
- IDs estables (UUID) para canciones, líneas y acordes. Los timestamps se
  guardan **por acorde**, no por índice consecutivo.
- Renderizado sin estado en memoria: cada request lee de SQLite y recibe la
  transposición como parámetro (no se muta estado del servidor).
- Todo cambio de contenido pasa por validación y queda auditado.
- Fase 1 sin login; fase 2 añade Google OAuth reutilizando el patrón Bun +
  SQLite + sesiones de `store-bun-sqlite-htmx` / `modulador-formwork`.

### 3.2 Estructura de carpetas propuesta

```
src/
  db.ts                      # conexión SQLite, PRAGMAs, newId(), now(), transaction()
  config.ts                  # PORT, HOST, DB_PATH, YOUTUBE_API_KEY, YTDLP_*, límites
  core/
    http.ts                  # html(), json(), redirect(), cookies, escapeHtml()
    router.ts                # router con :params (adaptado de store-bun-sqlite-htmx)
    ratelimit.ts             # límite en memoria para escrituras y generación de marcas
  songs/
    songs.db.ts              # tablas + repositorio (songs, lines, chords, transcripts...)
    songs.model.ts           # tipos de dominio y mapeo fila -> modelo
    songs.service.ts         # cargar/crear/actualizar/editar/refrescar
    songs.routes.ts          # /load, /songs/:id, edición, timestamps, refresh
    songs.views.ts           # render del reproductor y del editor
    enrichment/
      youtube.search.ts      # búsqueda + ranking de candidatos
      youtube.transcript.ts  # wrapper de yt-dlp + parseo json3
      align.ts               # alineación letra/transcripción -> timestamps
      enrichment.service.ts  # orquestación, estado, reintentos
      enrichment.routes.ts   # estado/retry/elegir video
  auth/                      # fase 2
  parser/                    # se mantiene (LaCuerda)
  transpose/                 # se mantiene
  render/                    # se adapta al modelo de canción
  routes/                    # se reduce a search/artist/chord-diagram/home
public/
  youtube.js                 # sin localStorage; usa data-* y endpoints
  editor.js                  # ayudas del editor (si hacen falta)
data/
  app.sqlite                 # volumen persistente, ignorado por git
tests/
  fixtures/transcripts/*.json3
  fixtures/lyrics/*.json
```

### 3.3 Modelo de dominio

```ts
type Song = {
  id: string;
  source: "lacuerda";
  sourceKey: string;          // /artista/cancion.shtml
  sourceUrl: string;
  title: string;
  artist: string;
  video: { id: string; url: string; title: string | null; channel: string | null } | null;
  timestamps: {
    source: "none" | "auto" | "manual" | "mixed";
    confidence: number | null;
  };
  videoStatus: "none" | "searching" | "ready" | "failed" | "skipped";
  videoError: string | null;
  timestampsStatus:
    | "none" | "pending" | "transcribing" | "aligning"
    | "ready" | "partial" | "failed";
  timestampsError: string | null;
  version: number;            // concurrencia optimista del editor
  lines: SongLine[];
};

type SongLine = {
  id: string;
  position: number;
  lyric: string;
  chords: SongChord[];
};

type SongChord = {
  id: string;
  position: number;
  name: string;
  column: number;
  timestampMs: number | null;
  timestampSource: "none" | "auto" | "manual";
};
```

El renderer deja de recibir `SongState` y recibe `Song` + `offset`. Cada botón de
acorde incluye `data-chord-id`, `data-chord-index` (orden DOM, solo para el
resaltado) y `data-chord-time` (ms). El JavaScript no necesita un arreglo aparte.

---

## 4. Esquema SQLite

Convenciones tomadas de `store-bun-sqlite-htmx/docs/schema.md`: IDs `TEXT`
(UUID), fechas ISO-8601, `TEXT` con JSON cuando aplica, `CREATE TABLE IF NOT
EXISTS` y base descartable pre-1.0. Añadir `PRAGMA user_version` desde el día uno
para poder migrar más adelante.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
  id                  TEXT PRIMARY KEY,
  source              TEXT NOT NULL DEFAULT 'lacuerda',
  source_key          TEXT NOT NULL,
  source_url          TEXT NOT NULL,
  title               TEXT NOT NULL,
  artist              TEXT NOT NULL,
  artist_slug         TEXT,
  song_slug           TEXT,
  video_id            TEXT,
  video_url           TEXT,
  video_title         TEXT,
  video_channel       TEXT,
  video_duration_ms   INTEGER,
  transcript_lang     TEXT,
  transcript_kind     TEXT,              -- manual | asr
  timestamp_source    TEXT NOT NULL DEFAULT 'none',
  timestamp_confidence REAL,
  video_status        TEXT NOT NULL DEFAULT 'none',  -- none|searching|ready|failed|skipped
  video_error         TEXT,
  video_searched_at   TEXT,
  timestamps_status   TEXT NOT NULL DEFAULT 'none',  -- none|pending|transcribing|aligning|ready|partial|failed
  timestamps_error    TEXT,
  timestamps_attempts INTEGER NOT NULL DEFAULT 0,
  timestamps_generated_at TEXT,
  created_by          TEXT,              -- user_id (fase 2); NULL = anónimo
  updated_by          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  UNIQUE (source, source_key)
);

CREATE TABLE IF NOT EXISTS song_lines (
  id          TEXT PRIMARY KEY,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  lyric       TEXT NOT NULL DEFAULT '',
  is_manual   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (song_id, position)
);
CREATE INDEX IF NOT EXISTS idx_song_lines_song ON song_lines(song_id, position);

CREATE TABLE IF NOT EXISTS song_chords (
  id               TEXT PRIMARY KEY,
  line_id          TEXT NOT NULL REFERENCES song_lines(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  name             TEXT NOT NULL,
  column           INTEGER NOT NULL,
  timestamp_ms     INTEGER,
  timestamp_source TEXT NOT NULL DEFAULT 'none',
  confidence       REAL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (line_id, position)
);
CREATE INDEX IF NOT EXISTS idx_song_chords_line ON song_chords(line_id, position);

CREATE TABLE IF NOT EXISTS song_transcripts (
  id          TEXT PRIMARY KEY,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  video_id    TEXT NOT NULL,
  lang        TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- manual | asr
  source      TEXT NOT NULL DEFAULT 'ytdlp',
  raw         TEXT NOT NULL,             -- json3 crudo
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (song_id, video_id, lang, kind)
);

CREATE TABLE IF NOT EXISTS song_video_candidates (
  id              TEXT PRIMARY KEY,
  song_id         TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  video_id        TEXT NOT NULL,
  title           TEXT,
  channel         TEXT,
  duration_ms     INTEGER,
  rank            INTEGER NOT NULL,
  has_transcript  INTEGER,
  transcript_lang TEXT,
  coverage        REAL,
  created_at      TEXT NOT NULL,
  UNIQUE (song_id, video_id)
);

CREATE TABLE IF NOT EXISTS song_edits (
  id         TEXT PRIMARY KEY,
  song_id    TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  actor      TEXT,                       -- user_id (fase 2); NULL = anónimo
  action     TEXT NOT NULL,
  payload    TEXT,                       -- JSON con el cambio
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_edits_song ON song_edits(song_id, created_at);
```

En fase 2 se añaden `users`, `sessions` y `oauth_identities` (modelo compartido:
no hay `guest_migrations`).

---

## 5. Flujos

### 5.1 Cargar una canción (`POST /load`)

1. Validar la URL de LaCuerda (se conserva `validateSongUrl`). Nota: hoy exige
   `.shtml`; conviene aceptar también rutas canónicas sin extensión y ajustar
   las regex `SONG_ID` del cliente, sin relajar el host ni el protocolo.
2. Buscar `songs` por `(source, source_key)`.
3. Si no existe:
   - Descargar y parsear con `fetchLacuerdaSong`.
   - Insertar `songs` + `song_lines` + `song_chords` en una transacción.
   - Lanzar en segundo plano solo la **búsqueda de video** (top-1). La
     transcripción y la alineación no se ejecutan al cargar: quedan disponibles
     con el botón **Generar marcas**.
4. Si existe:
   - Leer de SQLite (no se vuelve a descargar LaCuerda).
   - Si está incompleto o el usuario pide refrescar, encolar/ejecutar refresco.
5. Renderizar el reproductor desde SQLite con el `offset` recibido.

Latencia: la respuesta no debe esperar a YouTube. La búsqueda de video corre en
segundo plano y la vista muestra su estado (`Buscando video…`, `Listo`). La
generación de marcas es explícita y muestra `Generando marcas…` mientras dura. El
cliente hace polling de un fragmento HTMX solo mientras hay un trabajo activo.

### 5.2 Búsqueda de video (automática)

Estados en `songs.video_status`: `none → searching → ready | failed | skipped`.
Guardar `video_error` y `video_searched_at`.

1. Query `${artist} ${title}` contra innertube (cliente `WEB`).
2. Rankear y guardar los N mejores candidatos (título, canal, duración, rank) en
   `song_video_candidates`.
3. Elegir el top-1 (preferir título/canal que contenga artista y título;
   descartar covers/live si hay alternativa; a igualdad, preferir títulos con
   "letra"/"lyrics", que suelen traer subtítulos) y guardar `video_id`/
   `video_url`/metadatos en `songs`.
4. Si no hay resultados, `video_status='failed'` (o `skipped` si no se quiere
   buscar) y la UI ofrece "Buscar video" / "Vincular enlace".
5. El usuario puede cambiar el video desde la lista de candidatos o pegando una
   URL. Un video distinto limpia los timestamps (ver 5.8).

### 5.3 Alineación (bajo demanda)

Se dispara con **Generar marcas** (`POST /songs/:id/timestamps/auto`). Estados en
`songs.timestamps_status`: `none → pending → transcribing → aligning → ready |
partial | failed`. Guardar `timestamps_error` y `timestamps_attempts`.

1. Verificar que hay `video_id`; si no, pedir que se elija un video.
2. **Transcripción**: `yt-dlp --skip-download --write-auto-subs --write-subs
   --sub-langs "es,es-orig" --sub-format json3`, en un directorio temporal que se
   borra al terminar. Preferir subtítulo manual sobre automático. Pedir solo `es`
   y `es-orig`, no toda la familia `es.*`. Timeout y backoff ante 429. Si el video
   no tiene subtítulos en español, `timestamps_status='failed'`,
   `has_transcript=0` y se muestran los candidatos para elegir otro (no se prueba
   el siguiente automáticamente).
3. **Parseo**: leer `events[].tStartMs` + `segs[].tOffsetMs` (cuando exista),
   `segs[].utf8`; descartar eventos vacíos, `[Música]` y duplicados por
   "rolling" (deduplicar por evento, no solo por palabra/tiempo).
4. **Alineación**: normalizar (minúsculas, sin acentos ni puntuación), filtrar
   líneas de ruido, alinear secuencia de palabras de la letra contra la
   transcripción (Needleman-Wunsch con similitud exacta + Levenshtein para
   tolerancia). Devolver para cada palabra de la letra un tiempo (o `null`).
5. **Asignación a acordes**: para cada acorde, buscar la primera palabra de su
   línea en o después de su columna que tenga tiempo; si no hay, interpolar
   entre el inicio/fin de la línea o entre líneas vecinas. Guardar
   `timestamp_ms` con `timestamp_source='auto'`.
6. **No pisar lo manual**: solo rellena acordes con `timestamp_source IN
   ('none','auto')`. Las marcas `manual` se conservan salvo que el usuario pida
   "re-alinear todo" explícitamente.
7. **Umbral**: si la cobertura de palabras < 60 % o las líneas alineadas < 50 %,
   no reemplazar los timestamps existentes; dejar `partial` para revisión manual.
8. Guardar transcripción cruda y métricas (`word_count`, `coverage`).

### 5.4 Reproducción

- El reproductor se inicializa con `data-video-id` si existe.
- Los acordes llevan `data-chord-time`; el JS resalta el acorde con el tiempo más
  reciente ≤ `currentTime` (misma lógica actual, sin `localStorage`).
- Si no hay video, se muestra "Buscar video" / "Vincular enlace" (se conserva el
  formulario actual).
- Si hay video pero no timestamps, se muestra **Generar marcas**.
- "Cambiar video" muestra los candidatos guardados y permite pegar una URL.

### 5.5 Modo marcas (timestamps manuales)

- Al pulsar un acorde con las marcas activas, `POST
  /songs/:id/chords/:chordId/timestamp` con el segundo actual.
- El servidor valida que el acorde pertenezca a la canción, guarda
  `timestamp_ms`, `timestamp_source='manual'`, actualiza `timestamp_source` de la
  canción a `manual`/`mixed` y registra en `song_edits`.
- La UI actualiza el `data-chord-time` local sin recargar.
- "Borrar marca" pone `NULL` y `timestamp_source='none'`.
- Tras guardar o borrar una marca, recalcular `songs.timestamp_source`
  (`none|auto|manual|mixed`) según las marcas restantes.
- No se permite escribir timestamps anónimos sin límite: rate limit por
  IP/canción.

### 5.6 Edición de letra y acordes

Se abre con un botón **Editar** en la cabecera de la canción (panel o diálogo).
El editor estructurado es por línea:

- Texto de la línea (`lyric`).
- Lista de acordes: nombre y columna; añadir/eliminar; mover posición.
- Añadir/eliminar líneas; reordenar.
- Metadatos: título y artista (opcional).

Reglas:

- Validar longitudes (p. ej. línea ≤ 2000 caracteres, ≤ 500 líneas, ≤ 20 acordes
  por línea) y nombres de acorde con un patrón que acepte notación latina e
  inglesa (`DO`, `LA`, `C`, `G7`, `Am/F#`, `B7`, `Em/F`, `LA*`...).
- `column` entero entre 0 y longitud de la línea (se permite pasado el final
  para acordes instrumentales; se normaliza).
- Al borrar una línea se borran sus acordes en cascada.
- Reordenar líneas mueve los acordes y sus timestamps con ellas, pero eso puede
  dejar de coincidir con el audio. Se avisa y se ofrece limpiar o re-alinear.
- Reordenar se hace en una transacción con posiciones temporales (p. ej.
  negativas) para no violar `UNIQUE(song_id, position)` ni
  `UNIQUE(line_id, position)`.
- Al cambiar el texto de una línea, las columnas existentes se conservan; si
  alguna queda fuera del nuevo largo, se muestra una advertencia y se permite
  ajustarla. No se reubican acordes automáticamente para no alterar la intención
  del usuario.
- Cada edición estructural sube `songs.version` y `updated_at`; si el cliente
  envía una versión vieja, responder `409` con aviso de recarga (concurrencia
  optimista).
- Las marcas de tiempo no suben `version` (sí `updated_at`), para que marcar
  acordes no invalide un editor abierto en otro navegador.
- Todo cambio queda en `song_edits` con actor y payload.

Seguridad de escrituras:

- Consultas parametrizadas (nunca interpolar SQL).
- Validar `Origin`/`Referer` en POST (o token CSRF) para evitar escrituras
  cruzadas desde otros sitios, especialmente en fase 2.
- Límites de tamaño del cuerpo y de longitud de campos.
- Rate limit por IP para edición, timestamps, búsqueda de video y alineación.
- Escapar todo el contenido editable al renderizar (`escapeHtml`).

La edición se hace **sobre la tonalidad original**. La transposición sigue siendo
una preferencia de vista (no se guarda en la letra). En fase 2, la preferencia
puede pasar a la cuenta.

### 5.7 Refrescar desde LaCuerda

- Acción explícita con confirmación.
- Re-descarga y re-parsea.
- Estrategia recomendada: actualizar solo líneas/acordes no editados
  manualmente (`song_lines.is_manual = 0`), preservar timestamps de acordes cuya
  letra y columna no cambiaron, y limpiar (`timestamp_source='none'`) los que ya
  no coincidan.
- Registrar en `song_edits` y ofrecer deshacer (a nivel de POC, basta con
  conservar el snapshot anterior en `payload`).

### 5.8 Cambio de video

- Cambiar el video invalida las marcas: los tiempos son relativos al audio
  anterior. Al vincular un video distinto se pide confirmación y se limpian
  `timestamp_ms`/`timestamp_source`, y `timestamps_status` vuelve a `none`.
- Después del cambio se puede relanzar la transcripción + alineación o dejar
  que el usuario marque a mano.
- Si se vuelve al mismo `videoId`, se conservan las marcas existentes.

### 5.9 Concurrencia y reanudación

- Dos `POST /load` simultáneos de la misma canción: `UNIQUE(source, source_key)`
  + reintento de lectura tras conflicto.
- Los trabajos viven en el proceso. Al arrancar, reanudar búsquedas de video con
  `video_status='searching'` y alineaciones con `timestamps_status IN
  ('pending','transcribing','aligning')`, siempre que
  `timestamps_attempts < límite`.
- Una sola alineación/transcripción a la vez (cola global con concurrencia 1)
  para no disparar 429 de YouTube; la búsqueda de video es más liviana y puede ir
  con concurrencia 2.
- Límite de intentos y cooldown por canción; endpoint de reintento manual.

### 5.10 Identidad de favoritos y enlaces

- `songs.id` (UUID) es la identidad interna y la que usan las rutas.
- `source_key` se conserva como clave estable de la canción en LaCuerda y para
  detectar duplicados.
- Los favoritos y la transposición viven en la tabla `songs` (`liked`,
  `liked_at`, `preferred_offset`) compartidos por todos los visitantes; el
  cliente no usa `localStorage`.

### 5.11 Autenticación (fase 2)

Reutilizar el patrón de `store-bun-sqlite-htmx/src/auth/`:

- `users`, `oauth_identities`, `sessions`.
- Google OAuth 2.0 Authorization Code + PKCE con `fetch`, sin SDK.
- Cookie de sesión opaca; en DB solo el SHA-256 del token.
- Validar `state`, `nonce`, `iss`, `aud`, `exp`, `email_verified` y `sub`
  (como en `modulador-formwork/src/app/google_oauth.py`).
- Rutas `/login`, `/auth/google`, `/auth/callback`, `/logout`, `/account`.
- Sin roles en esta app: cualquier usuario Google autenticado puede editar.
- Modelo compartido: no hay migración invitado → usuario. Las ediciones
  anónimas previas quedan con `actor = NULL`.
- Los favoritos y la transposición ya están en la base compartida (sin auth);
  en fase 2 solo se decidirá si se quedan compartidos o se mueven a la cuenta.

---

## 6. API propuesta

| Método | Ruta | Uso |
|---|---|---|
| POST | `/load` | Carga/crea canción y devuelve el reproductor |
| GET | `/songs/:id/player` | Re-render del reproductor (polling/estado) |
| GET | `/songs/:id/status` | Estado de video y timestamps (polling) |
| POST | `/songs/:id/timestamps/auto` | Generar marcas automáticas (bajo demanda) |
| POST | `/songs/:id/chords/:chordId/timestamp` | Guardar marca manual |
| POST | `/songs/:id/chords/:chordId/timestamp/clear` | Borrar marca |
| GET | `/songs/:id/videos` | Lista de candidatos de video |
| POST | `/songs/:id/video` | Vincular/cambiar video |
| POST | `/songs/:id/video/retry` | Reintentar búsqueda de video |
| POST | `/songs/:id/timestamps/retry` | Reintentar transcripción/alineación |
| POST | `/songs/:id/refresh` | Re-descargar de LaCuerda |
| GET | `/songs/:id/edit` | Fragmento del editor |
| POST | `/songs/:id/lines` | Añadir línea |
| POST | `/songs/:id/lines/:lineId` | Editar texto/posición |
| POST | `/songs/:id/lines/:lineId/delete` | Eliminar línea |
| POST | `/songs/:id/lines/:lineId/chords` | Añadir acorde |
| POST | `/songs/:id/chords/:chordId` | Editar nombre/columna |
| POST | `/songs/:id/chords/:chordId/delete` | Eliminar acorde |
| POST | `/songs/:id/meta` | Título/artista |
| POST | `/songs/:id/transpose` | Render con offset y persiste la preferencia en `songs.preferred_offset` |
| GET | `/favorites` | Fragmento con las canciones marcadas como favoritas |
| GET | `/favorites/state` | JSON `{ liked: source_key[], offsets: Record<source_key, offset> }` |
| POST | `/favorites/toggle` | Alterna el favorito de una canción (form `sourceKey`) |

HTMX devuelve fragmentos HTML. Para timestamps se puede devolver `204` o un
fragmento pequeño con el estado. Cada POST de edición incluye la `version`
actual en un campo oculto; si no coincide con `songs.version`, se responde `409`
y el cliente recarga el editor.

---

## 7. Cambios en el cliente

- `public/youtube.js`:
  - Eliminar `YOUTUBE_PREFERENCES_KEY`, `readPreferences`, `savePreferences` y
    `preferences`.
  - Leer `videoId`/`videoUrl` de `data-*` del `.song-card`.
  - Leer tiempos de `data-chord-time` (ms).
  - Guardar marcas con `fetch` al endpoint; actualizar el DOM de forma optimista.
  - Polling de `/songs/:id/status` solo mientras `video_status='searching'` o
    `timestamps_status` esté en curso; al terminar, recargar el reproductor.
  - Botón **Generar marcas** que llama a `/songs/:id/timestamps/auto`.
  - Favoritos y transposición vía la base de datos (`/favorites/toggle`,
    `/favorites/state`); el cliente no usa `localStorage`.
  - Editor inline en una vista propia de la canción (sin modal).
- `src/routes/home.ts`: mover el JS inline a `public/` si crece; el editor
  necesita su propio archivo. No es obligatorio en la primera iteración.
- Renderer: quitar `data-song-id` basado solo en URL y usar `data-song-id` (UUID)
  + `data-source-key` para favoritos/migración.

---

## 8. Migración de datos existentes

- `localStorage["acordes-youtube-videos"]`: importado a la base (ya no se usa).
- `localStorage["acordes-liked-songs"]`: los favoritos ya viven en
  `songs.liked` (base compartida); ya no se migra desde el navegador.
- Transposición: se guarda en `songs.preferred_offset` y se aplica al cargar
  la canción (`/load` y `/transpose`).
- No hay datos en servidor que migrar (el `Map` es efímero).

---

## 9. Fases de implementación

### Fase 0 — Spikes (sin código de producción)

- 0.1 Parser contra páginas reales (hecho).
- 0.2 Búsqueda innertube + `yt-dlp` + alineación (hecho; fuzzy 87,4 % en Color
  Esperanza y 56,4 % en Debajo de la Morera).
- 0.3 **Go/no-go en el servidor** (hecho el 2026-11-08): **GO**. Innertube 200,
  `yt-dlp` 6/6 sin 429; el top-1 puede no tener subtítulos.
- 0.4 Cerrar las decisiones de la sección 13 (hecho; ver sección 13).

### Fase 1 — Persistencia y edición sin auth (completada y desplegada)

- 1.1 `db.ts`, `config.ts`, esquema, volumen Docker, `.gitignore`, backup.
   (Scripts `db:backup`/`db:reset` disponibles; sin cron programado todavía.)
- 1.2 Repositorio de canciones; `POST /load` con upsert; render desde DB;
   eliminado el estado mutable en memoria de transposición.
- 1.3 Búsqueda de video automática (top-1) + estado + polling + selección de
   video con candidatos («Usar otro video»).
- 1.4 Alineación automática al encontrar video: transcribe y alinea probando
   los candidatos en orden; si falla, error visible y reintento manual;
   timestamps manuales persistidos y `public/youtube.js` sin `localStorage`.
   Los botones «Generar marcas»/«Reintentar marcas» siguen como reintento
   manual.
- 1.5 Editor inline (vista propia, sin modal) de letra y acordes con validación,
   concurrencia y auditoría.
- 1.6 Refresco desde LaCuerda.
- 1.7 Pruebas, documentación, despliegue y verificación en la URL pública.
- Favoritos y transposición en la base compartida (`songs.liked`,
  `songs.preferred_offset`) sin `localStorage`, con endpoints `/favorites`,
  `/favorites/state` y `/favorites/toggle` (desviación acordada: el plan
  original los dejaba en `localStorage` hasta fase 2).

### Fase 2 — Google OAuth

- 2.1 Tablas y flujo OAuth (PKCE) según `store-bun-sqlite-htmx`.
- 2.2 Exigir login para editar; las ediciones anónimas previas se conservan con
  `actor = NULL`.
- 2.3 Favoritos y transposición en la cuenta (ya están en la base compartida;
  queda decidir si se quedan compartidos o se mueven a la cuenta).

---

## 10. Estrategia de pruebas

- **Parser** (`tests/lacuerda.test.ts`): se mantiene con fixtures. Añadir casos
  de líneas de ruido ("Corrección") y de acordes con notación latina.
- **Alineación** (`tests/align.test.ts`): fixtures de letra (JSON) y de
  transcripción (`json3` recortado) con resultados esperados; probar cobertura,
  líneas partidas, estribillos repetidos y umbral bajo.
- **Asignación de acordes**: columnas antes de la primera palabra, entre
  palabras, después de la última y líneas sin letra.
- **Repositorio** (`tests/songs.test.ts`): DB temporal (`DB_PATH` apuntando a un
  archivo temporal o `:memory:`), upsert idempotente, cascada, versión
  optimista, timestamps manuales, auditoría.
- **Rutas** (`tests/routes.test.ts`): `POST /load` con canción cacheada (sin red),
  validaciones, 400/404/409, edición de líneas/acordes, timestamp.
- **Video y timestamps** (`tests/video.test.ts`, `tests/timestamps.test.ts`):
  inyectar proveedores falsos de búsqueda/transcripción; probar transiciones de
  estado, reintentos, no sobrescribir manuales y fallback sin transcript.
- **yt-dlp**: envolver la ejecución en una función inyectable; en pruebas usar un
  runner falso, nunca la red.
- **Transposición**: se mantienen las pruebas existentes.
- **Manual/E2E**: verificar en <https://acordes.ingeniar.online/> tras desplegar.
- Comandos obligatorios: `bun run test` y `bun run typecheck`.

---

## 11. Cambios de despliegue

- `Dockerfile`:
  - En una etapa de build, descargar el binario standalone de `yt-dlp` con
    versión fijada y verificar su checksum; copiarlo a `/usr/local/bin/yt-dlp`.
    No hace falta Python (el binario ya lo incluye).
  - Instalar `deno` (binario) como runtime JS de respaldo para `yt-dlp`.
  - Crear `/app/data` en runtime; no copiar datos de build.
- `docker-compose.yml`:
  - Añadir volumen `./data:/app/data` para SQLite.
  - Mantener `./deploy` del túnel como está.
- `.gitignore`: añadir `data/` (y `data/*.sqlite*`).
- `.env.example`: añadir `DB_PATH`, `YOUTUBE_API_KEY` (opcional, no usada por
  defecto), `YTDLP_PATH`, `VIDEO_SEARCH_ENABLED`, `VIDEO_MAX_CANDIDATES`,
  `TIMESTAMPS_ENABLED`, `TIMESTAMPS_MAX_ATTEMPTS`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI` (fase 2). El token del spike 0.3
  no se documenta ni se commitea.
- Backup: cron diario con `VACUUM INTO 'data/backup-AAAAMMDD.sqlite'` desde un
  script Bun (o el CLI `sqlite3` si se instala en la imagen) y retención corta.
  Documentar en README.
- Scripts: `bun run db:reset` (borra el archivo) y `bun run db:backup`.
- Seguridad: si se añaden cabeceras CSP, incluir `https://unpkg.com` (HTMX),
  `https://www.youtube.com` y los estilos/scripts inline actuales; de lo
  contrario la app deja de funcionar. Se puede posponer.

---

## 12. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| YouTube bloquea la IP del servidor | Sin timestamps automáticos | Spike hecho (GO); caché, backoff y fallback a marcas manuales/video manual |
| 429 de `yt-dlp` | Alineación falla | Un idioma por ejecución, caché, backoff, límite de concurrencia, reintento manual |
| Video top-1 equivocado | Marcas sobre otro audio | Cambiar video con candidatos; limpiar marcas al cambiar; validar cobertura de la letra |
| `yt-dlp`/innertube cambian | Se rompe la búsqueda | Abstraer proveedor; permitir API key oficial; actualizar binario |
| Subtítulos de baja cobertura o versión distinta | Timestamps incorrectos | Umbral de confianza; no aplicar si < 60 %; marcar `partial`; corregir a mano |
| Ediciones anónimas destructivas (modelo compartido) | Datos corruptos para todos | Auditoría `song_edits`, snapshot en refresh, rate limit, restauración desde LaCuerda; en fase 2, login para editar |
| Concurrencia de ediciones | Pérdida de cambios | `version` + `409` + recarga |
| Copyright / ToS | Riesgo legal | Uso personal/POC; no publicitar; valorar noindex; no distribuir la DB |
| Pérdida de SQLite en Docker | Pérdida total | Volumen `./data:/app/data` + backup diario |
| Bloqueo de LaCuerda | No se pueden añadir canciones nuevas | Canciones ya guardadas siguen funcionando desde SQLite |
| Complejidad del editor | Retraso | Editor por fases: timestamps → letra → acordes |

---

## 13. Decisiones cerradas y pendientes

### Cerradas (confirmadas)

1. **Modelo de propiedad**: canción compartida. Una fila por `(source,
   source_key)`; cualquier visitante anónimo edita la misma. En fase 2 el login
   solo identifica al autor. Sin `guest_ref` ni migración de invitado.
2. **Timestamps**: automáticos al encontrar video (incluido al vincular uno
   manualmente); si ningún candidato tiene subtítulos utilizables, error visible
   con opción manual. Los botones «Generar marcas»/«Reintentar marcas» quedan
   como reintento.
3. **Selección de video**: top-1 automático con opción de cambiarlo; si falla la
   transcripción, se muestran los candidatos.
4. **Fuente de transcripción**: `yt-dlp` + innertube, sin API key.
   `YOUTUBE_API_KEY` queda como variable opcional no usada por defecto.
5. **Refresco desde LaCuerda**: preservar ediciones y timestamps manuales;
   actualizar el resto.
6. **Spike 0.3**: hecho el 2026-11-08 en el host de producción: **GO**. No hizo
   falta endpoint temporal; el contenedor sale por la misma IP.

### Pendientes (valores por defecto si no dices lo contrario)

7. **Precisión**: se aceptan timestamps automáticos aproximados (segmento de
   caption, ~2–5 s) + corrección manual. No se usa Whisper.
8. **Alcance del editor**: fase 1.4 timestamps + texto; fase 1.5 acordes
   completos. Si prefieres todo de una vez, se puede, pero aumenta el riesgo.
9. **Edición y transposición**: siempre en tonalidad original.
10. **Favoritos**: base de datos compartida (`songs.liked`) sin `localStorage`,
    a petición expresa (cambia el plan original de dejarlos en el navegador
    hasta fase 2).
11. **Listado de canciones**: no se hace en fase 1; se puede añadir después.
12. **Backup**: base descartable pre-1.0 + backup diario; sin migraciones
    versionadas todavía.
13. **Autorización fase 2**: cualquier usuario Google autenticado puede editar,
    sin roles. Si quieres admin/moderación, dilo.
14. **Google Cloud**: falta decidir si se reutiliza un proyecto existente o se
    crea uno para `acordes.ingeniar.online`. Solo se necesita al llegar a fase 2.
15. **Editor y columnas**: conservar columnas y avisar si un acorde queda fuera
    de la línea; no reubicar automáticamente.
16. **Cambio de video**: borrar timestamps y volver a `timestamps_status='none'`
    (con confirmación).

Si alguna de las pendientes te importa, dímelo; si no, las tomo como cerradas con
esos valores.

---

## 14. Criterios de aceptación

- Al recargar el proceso, una canción guardada sigue disponible con sus
  ediciones y timestamps.
- Editar una línea o un acorde no desplaza ni invalida los timestamps de los
  demás acordes.
- Las marcas manuales y las ediciones se guardan en SQLite y se ven desde otro
  navegador (modelo compartido).
- La búsqueda de video no bloquea la carga de la letra; la alineación es
  automática y muestra su estado.
- "Generar marcas" produce timestamps `ready`, `partial` o un error visible; no
  pisa marcas manuales.
- Cambiar de video limpia las marcas anteriores y permite volver a generarlas.
- Si YouTube falla o no hay transcripción, la app sigue funcionando con video
  manual y marcas manuales.
- No hay dependencia de red en las pruebas: `bun run test` usa fixtures.
- `bun run typecheck` pasa.
- El despliegue conserva la DB en un volumen y sobrevive a `docker compose up
  --build`.

---

## 15. No objetivos (por ahora)

- Reproducir audio propio o alojar archivos de audio.
- Transcripción con Whisper/ASR propio.
- Biblioteca personal multiusuario con permisos finos.
- Edición colaborativa en tiempo real.
- Migraciones versionadas y compatibilidad hacia atrás antes de 1.0.
- Sustituir LaCuerda como fuente de búsqueda.

---

## 16. Próximo paso

Fase 1 completada y desplegada. Siguiente: fase 2 (Google OAuth), cuando lo
decidas; queda por decidir si favoritos/transposición se quedan compartidos o
se mueven a la cuenta. Propuesta abierta: sección 17 (edición manual de
acordes con formato inline tipo ChordPro). Sin implementar.

---

## 17. Propuesta: edición manual de acordes con texto inline (ChordPro)

Estado: **implementado**. Objetivo: que corregir un acorde
equivocado o añadir uno que falta en LaCuerda sea tan fácil como editar una
frase, en vez de adivinar una columna numérica. Se acepta complicar el código
de importación/traducción LaCuerda → base de datos.

### 17.1 Por qué hoy editar acordes es difícil (evidencia en el código)

1. **La posición es un entero invisible.** Cada acorde se guarda como
   `song_chords(name, column)` (`src/songs/songs.schema.ts:52-65`), donde
   `column` es el desplazamiento en caracteres dentro de la línea. El editor
   (`src/songs/songs.views.ts:8-36`) pide ese número a mano: «Columna
   `<input type="number" value="0">`». Nada en pantalla dice qué palabra es la
   columna 12, así que mover un acorde 3 caracteres a la derecha exige
   contar a ojo y guardar para ver el resultado.
2. **Un formulario HTMX por acorde.** Añadir/editar/borrar cada acorde es un
   POST independiente (`src/songs/songs.routes.ts:314-394`) que re-renderiza
   todo el editor y sube `songs.version`. Corregir 5 acordes de una línea =
   5 guardados, 5 recargas del editor y 5 conflictos potenciales de versión.
3. **La columna no sobrevive a editar la letra.** Al cambiar `lyric` las
   columnas se conservan tal cual (`plan.md` §5.6, decisión 15): si se inserta
   una palabra al principio, todos los acordes quedan desplazados en
   silencio y hay que reajustarlos uno a uno.
4. **El render redondea a palabra, pero el dato no lo sabe.**
   `assignChords` (`src/render/song.ts:70-77`) asigna cada acorde a la
   palabra que contiene su columna (o a la siguiente). Es decir: la
   presentación ya es «acorde sobre palabra», pero el almacenamiento sigue
   siendo «acorde en carácter N». El usuario edita caracteres y el sistema
   muestra palabras.
5. **Refrescar desde LaCuerda es frágil por posición.** `refreshNonManualLines`
   (`src/songs/songs.db.ts:668-758`) compara línea por línea según `position`
   y conserva timestamps solo si coinciden `position + name + column`
   exactos. Un acorde movido a mano hace que su marca se pierda al refrescar.
6. **LaCuerda llega en dos líneas** (`src/parser/lacuerda.ts:109-139`): una de
   acordes y otra de letra, unidas por el parser con columnas calculadas en
   `parseChordLine` (`lacuerda.ts:52-72`). Ese formato también es incómodo
   de editar a mano (espacios monoespaciados invisibles), pero al menos es
   *visible*: el acorde está físicamente sobre su palabra.

### 17.2 Opciones consideradas

| Opción | Forma de edición | Pros | Contras | Veredicto |
|---|---|---|---|---|
| A. Columna (actual) | Número de carácter | Sin cambios | Invisible, frágil ante edición de letra | Descartar |
| B. Índice de palabra (`word_index` + orden) | «Acorde en la palabra 7» | Estable al editar caracteres dentro de la palabra; coincide con el render actual | Sigue siendo un número: hay que contar palabras; no muestra el acorde en contexto | Insuficiente por sí sola |
| C. Texto inline tipo ChordPro: `[Am]Pa-ra [C]pobrecito` | Editar una frase, el acorde va pegado a su sílaba | Visible, local, copiable, estándar (ChordPro, ver 17.3) | Requiere parser/serializador propio y conversión de LaCuerda | **Recomendada** |
| D. Dos líneas monoespaciadas (formato LaCuerda crudo) | Editar el bloque tal cual llega | Cero traducción | Espacios invisibles, se rompe al pegar en HTML; es el problema de origen, no la solución | Descartar |
| E. Arrastrar y soltar sobre palabras (solo UI) | Clic en palabra → escribir acorde | Muy intuitivo | Sin cambio de modelo, la columna se sigue calculando en cliente y puede derivar; no resuelve el guardado por acorde ni el refresco | Complemento de C, no alternativa |

La recomendación es **C como fuente de verdad editable + E como ayuda
visual opcional encima**. B puede vivir como campo derivado (útil para
alineación y auditoría), pero no como forma de entrada.

### 17.3 Referencia: formato ChordPro

ChordPro es el estándar de facto para letra con acordes inline: la letra va
intercalada con acordes entre corchetes justo delante de la sílaba donde
cambia el acorde, y las directivas (`{title: ...}`, `{start_of_chorus}`) van
entre llaves (<https://chordpro.org/chordpro/chordpro-introduction/>):

```text
{title: Debajo de la morera}
[Am@12.3]Debajo de la [G]morera, [F@15.0]debajo de la [E7]cruz
```

- Los corchetes delimitan el acorde; ChordPro lo imprime encima de la
  sílaba, exactamente como ya hace `src/render/song.ts`.
- Empieza con `*` (`[*Coda]`) para anotaciones que no son acordes.
- Es texto plano: se puede pegar, versionar y revisar a ojo el diff.
- No se adoptan las directivas de ChordPro en v1 (solo título/artista
  pueden expresarse); solo se toma la convención `[Acorde]texto`, que es
  todo lo que necesita el modelo actual. Si mañana se quieren secciones
  (verso/estribillo), las directivas ya existen como extensión natural.
- **Extensión propia: timestamp dentro del token.** `[Am@12.3]` significa
  acorde `Am` con marca a los 12,3 s del video (`12300 ms`). Sin `@` no hay
  marca. El `@` y los segundos van dentro de los corchetes para que la
  marca viaje con el acorde al moverlo/copiarlo, sin tabla aparte que
  sincronizar. El renderer muestra el acorde como hoy y usa el `@` como
  `data-chord-time`; el usuario nunca tiene que escribirlo a mano
  (lo escribe el modo marcas y la alineación automática).

### 17.4 Modelo propuesto

**Fuente única de verdad: una columna de texto por línea.** Cada línea
guarda su letra *con* acordes y timestamps inline, p. ej. en
`song_lines.text TEXT`:

```text
[Am@12.3]Debajo de la [G]morera, [F@15.0]debajo de la [E7]cruz
```

- **No hay tabla `song_chords`.** Letra, acorde, posición y timestamp
  viven en el mismo texto; el parser de ChordPro (17.6) lo convierte al
  leer en la estructura que ya consumen renderer, alineación y
  reproductor (`{lyric, chords[{name, column, wordIndex, timestampMs}]}`).
  Nada que sincronizar: si el usuario mueve `[Am@12.3]`, su marca se mueve
  con él. En una POC el coste de parsear el texto por request es
  despreciable frente a la complejidad de mantener una proyección.
- Alternativa equivalente: tabla nueva `song_line_texts(line_id, text,
  updated_at)` y dejar `song_lines.lyric` como letra limpia derivada. Es
  más limpio si se espera multi-idioma o varias representaciones; si no,
  la columna en `song_lines` basta. Preferir la tabla si se prevé guardar
  también el texto fuente crudo de LaCuerda para depurar importaciones.
- **Sintaxis del token:** `[Nombre]` o `[Nombre@segundos]`.
  - `Nombre`: mismo patrón actual (`validateChordName`,
    `songs.service.ts:82-89`).
  - `segundos`: decimal con punto, p. ej. `12.3` = `12300 ms`. Se valida
    rango (0 a 24 h, como hoy en `songs.routes.ts:289`) y se redondea a ms
    al derivar. Una fracción de segundo basta para el resaltado actual.
  - Sin `@`, `timestampMs = null`. El origen de la marca (`auto`/`manual`)
    no necesita guardarse por acorde si se acepta perder esa distinción
    (ver decisión 17.8.4); el estado global de la canción
    (`songs.timestamp_source`, cobertura) se mantiene.
- **La UI sigue mostrando varias líneas.** El texto se guarda por línea
  (una fila de `song_lines` = una línea visible, con su `position` como
  hoy); el renderer parsea cada línea y dibuja acorde sobre palabra
  exactamente como ahora (`src/render/song.ts`). Lo que cambia es solo el
  formato de edición, no la presentación.
- **Marcar timestamps sin editor de texto.** El modo marcas actual pulsa
  un acorde en el reproductor (`POST /chords/:chordId/timestamp`). Con el
  texto como fuente, ese endpoint pasa a reescribir el token en el texto
  de la línea (`[Am]` → `[Am@12.3]`) en vez de actualizar una fila de
  `song_chords`. El `chordId` puede seguir siendo un índice derivado
  estable en el render (`línea + orden del acorde`), no una fila en DB.
  Borrar marca = quitar el `@12.3` del token. La alineación automática
  escribe los `@` directamente en el texto.

### 17.5 Flujo de edición (UX)

1. **Un textarea por línea** (o uno por canción) con el texto ChordPro.
   Editar `[G]` por `[C]`, moverlo de sitio o añadir `[Em]nuevo` delante de
   una palabra son operaciones de texto normales; vista previa del
   reproductor al guardar, sin numeritos.
2. **Guardado por línea, no por acorde**: un POST por línea con
   `version`, validación servidor (nombres de acorde con el patrón actual
   `validateChordName`, `songs.service.ts:82-89`; longitud máxima;
   corchetes balanceados; `@segundos` con formato y rango válidos) y
   escritura del texto completo en `song_lines.text`. Corregir 5 acordes =
   1 guardado. No hay nada que re-derivar ni persistir aparte: el texto
   *es* el dato.
3. **Ayuda visual opcional** (opción E, fase posterior): clic sobre una
   palabra del reproductor en modo edición inserta `[?]`/`[Acorde]` en esa
   posición del texto; arrastrar un acorde entre palabras reescribe el
   texto. El texto sigue siendo la fuente de verdad; la UI solo lo edita.
4. **Errores visibles**: acorde con nombre inválido o corchete sin cerrar
   → `400` señalando la línea y el fragmento, sin guardar nada.

### 17.6 Traducción LaCuerda → ChordPro (el coste asumido)

El parser actual ya produce `SongLine[]` con `lyric` + `chords[{chord,
column}]` (`src/parser/lacuerda.ts:103-149`). La traducción es un
serializador nuevo (p. ej. `src/parser/chordpro.ts`, simétrico al parser,
siguiendo la separación parser/transpose/render de `AGENTS.md`):

1. Ordenar acordes de la línea por `column`.
2. Recorrer la letra insertando `[nombre]` en cada columna. Casos a cubrir:
   - columna 0 (acorde antes de la primera palabra),
   - varios acordes en la misma columna (`[F][C]texto`),
   - columna dentro de una palabra (acorde en mitad de sílaba:
     `Pa[Am]ra` — ChordPro lo soporta; el render actual ya lo asigna a esa
     palabra),
   - columna más allá del final de la letra (acordes instrumentales):
     se añaden al final de la línea, p. ej. `[A]  `; documentar que el
     render los muestra tras la última palabra,
   - línea vacía con solo acordes: la línea es solo tokens `[A][E]`,
   - letra que contiene `[` o `]` literales: escapar (p. ej. `\[`) o
     rechazar en la importación si aparece (hoy no ocurre en LaCuerda;
     dejar test con fixture).
3. **Columnas en caracteres, no bytes**: `parseChordLine` cuenta
   `string.length` (UTF-16). Con acentos/ñ el conteo visual coincide por
   carácter; añadir tests con letra acentuada para fijar el comportamiento.

La ruta inversa (leer → estructura de render) es el parser ChordPro:
extrae tokens `[nombre]` o `[nombre@segundos]`, calcula `column` sobre la
letra resultante, `timestampMs = round(segundos * 1000)` cuando hay `@` y
`word_index` reaprovechando `splitWords`/`assignChords` de
`src/render/song.ts:62-77`. La serialización inversa (marcas/alineación →
texto) inserta o actualiza el `@segundos` del token correspondiente.

### 17.7 Sin retrocompatibilidad: base limpia, sin migraciones

Decisión: **no hay datos reales de producción que preservar** (POC en
desarrollo). No se escribe código de migración, backfill ni rollback.

1. Esquema nuevo desde cero con `SCHEMA_VERSION = 1`: `song_lines.text`
   guarda el formato inline; la tabla `song_chords` desaparece del esquema
   (y con ella `timestamp_ms`/`timestamp_source`/`confidence` por acorde,
   que ahora viven como `@segundos` en el texto).
2. Se borra `data/app.sqlite` y se regenera al arrancar con el esquema
   nuevo. Las canciones se reimportan desde LaCuerda al cargarlas
   (`POST /load` ya existe) y el video/marcas se regeneran con la
   búsqueda y alineación actuales.
3. **Refresco desde LaCuerda** (§5.7): re-importa a texto ChordPro
   directamente (sin `@`, porque LaCuerda no trae tiempos) y solo
   actualiza las líneas con `is_manual = 0` (criterio actual). Las líneas
   editadas a mano se preservan enteras, incluidos sus `@`; ya no depende
   de que coincidan `position/name/column` en ninguna tabla.
4. Pruebas con fixtures (prohibida red en tests, `AGENTS.md`): HTML de
   LaCuerda → texto ChordPro esperado; texto ChordPro → estructura de
   render esperada (letra, columnas, `timestampMs`); ida y vuelta sin
   cambios; casos de 17.6.2; marca que viaja con el acorde al moverlo;
   `@` inválido rechazado.

### 17.8 Decisiones abiertas

1. **Granularidad del texto**: ¿un textarea por línea o uno por canción
   completa? Por canción es más cómodo para pegar/reordenar versos; por
   línea encaja con la API actual (`/lines/:lineId`). Recomendación: por
   línea en v1, unificar después si se pide.
2. **Columna en `song_lines` vs tabla nueva** (17.4). Recomendación:
   columna si no se necesita multi-idioma; tabla si se quiere guardar el
   bloque crudo de LaCuerda junto al texto editable para depuración.
3. **Directivas ChordPro**: ¿se soportan `{start_of_chorus}` etc. en v1 o
   solo `[acordes]`? Recomendación: solo `[acordes]`; añadir directivas
   cuando se pida marcar secciones.
4. **Origen de la marca por acorde**: con el `@` en el texto se pierde la
   distinción `auto`/`manual` por acorde (hoy `timestamp_source` en
   `song_chords`). Implementado con la opción (b): el token admite
   `[Am@12.3!]` para marca manual (la alineación automática nunca pisa
   tokens con `!`); `[Am@12.3]` es automática. El `timestamp_source`
   global de la canción se recalcula parseando los tokens.
5. **Ayuda visual clic/arrastrar** (opción E): ¿entra en la misma
   iteración o como mejora posterior sobre el textarea? Recomendación:
   textarea primero (cero JS de editor), clic-para-insertar después.

### 17.9 Criterios de aceptación de esta propuesta

- Corregir un acorde (p. ej. `G` → `C`) o añadir uno que falta en una línea
  es una edición de texto con **un solo guardado por línea**, sin escribir
  ninguna columna numérica.
- Tras guardar, el reproductor muestra el acorde sobre la palabra esperada
  y la transposición (`src/transpose/`) sigue funcionando sin cambios.
- La UI de reproducción no cambia: varias líneas visibles, acordes sobre
  palabras, resaltado por `data-chord-time` derivado del `@segundos`.
- Las marcas viajan con el acorde: mover `[Am@12.3]` conserva su tiempo;
  quitar el `@` lo borra. Sin tablas auxiliares que sincronizar.
- Importar una canción de LaCuerda produce texto ChordPro correcto en los
  casos de 17.6.2 (fixtures, sin red).
- `bun run test` y `bun run typecheck` pasan; despliegue según `AGENTS.md`
  y verificación en <https://acordes.ingeniar.online/>.

### 17.10 Qué NO cambia

- Tabla `songs`, video, candidatos, transcripciones y `song_edits`.
- Timestamps: ya no en `song_chords` (tabla eliminada); viven como
  `@segundos` en el texto de la línea. La alineación automática (§2.4/§5.3)
  escribe `@` en el texto en vez de filas, usando la columna derivada del
  parser.
- Validaciones de escritura (mismo origen, rate limit, `version`
  optimista), transposición y renderizado `src/render/song.ts` (consume la
  estructura derivada del parser, con `timestampMs` desde el `@`).
- Fase 2 (Google OAuth) no se ve afectada: las ediciones comparten la
  misma tabla de texto.
