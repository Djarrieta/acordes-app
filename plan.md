# Plan: App de acordes con transposición (Bun + HTMX)

## Objetivo

App web personal (uso local) que toma una URL de `acordes.lacuerda.net`,
descarga la página, muestra la letra con los acordes alineados encima de la
palabra (como en la fuente) y permite transponer por semitonos (+1, +½, -½,
-1) y resetear a la tonalidad original. Notación de salida: **latina**
(Do, Re, Mi, Fa, Sol, La, Si). Solo letra + acordes (sin riffs/tabs ni
afinación).

## Stack

- **Runtime/servidor:** Bun (TypeScript)
- **Interactividad:** HTMX (vía CDN)
- **Tests:** `bun:test`
- **Persistencia:** ninguna (estado en memoria del servidor)
- **Auth:** ninguna (uso personal)

## Arquitectura de alto nivel

```
Browser (HTMX) ──► Bun HTTP server ──► fetch lacuerda.net (server-side)
                          │
                          ├── parser/lacuerda.ts   (HTML → ParsedSong)
                          ├── transpose/chords.ts  (acorde → acorde transpuesto)
                          ├── render/song.ts       (ParsedSong → HTML parcial)
                          └── state.ts             (Map en memoria: id → SongState)
```

Flujo:
1. Usuario pega URL en el form → `POST /load`.
2. Servidor fetcha la URL (con UA de navegador), parsea el `<PRE>` del body,
   guarda `SongState` (id, parsed, offset=0) en memoria, devuelve parcial HTMX
   con la canción renderizada + controles.
3. Botones de transposición → `POST /transpose` con `{id, delta}`; el servidor
   actualiza `offset += delta`, re-renderiza y devuelve el parcial.
4. "Original" → `POST /reset` (offset=0).

## Parsing de lacuerda.net (ingeniería inversa)

Fuente: `https://acordes.lacuerda.net/<artista>/<cancion>.shtml`

Estructura relevante dentro del HTML:
- El bloque de la canción está en `<div id=t_body><PRE> ... </PRE></div>`.
  (Excluir `<pre id='tCode'>` que contiene el código de la canción.)
- Dentro del PRE:
  - Líneas de acordes contienen tags `<A>...</A>` (cada acorde es un `<A>`).
  - La línea de letra va inmediatamente debajo, sin tags (texto plano).
  - Riffs/tabs usan `<em>` (ignorar según requisito).
  - Afinación al final (`<A>E</A>-1` etc.) (ignorar).
  - Separadores `<div></div>`.

**Alineación (acordes encima de la palabra):** la fuente mantiene posiciones
por columnas en fuente monoespacio. Cada línea de acordes es una cadena donde
los `<A>chord</A>` están separados por espacios para quedar encima de la
palabra correspondiente en la línea de letra.

Algoritmo de parseo (`parser/lacuerda.ts`):
1. `fetch(url, {headers: {User-Agent: ...}})`.
2. Extraer con regex `/<div id=t_body><PRE>([\s\S]*?)<\/PRE><\/div>/`.
3. Decodificar HTML entities.
4. `split('\n')`.
5. Para cada línea clasificar:
   - `trim() === ''` → línea vacía (salto).
   - contiene `<A>` → línea de acordes. Parsear tokens `{chord, column}`.
   - contiene `<em>` → tablatura (descartar).
   - solo `<div></div>` → separador (descartar).
   - else → línea de letra.
6. Para líneas de acordes, recorrer la cadena original manteniendo un cursor
   de columna: texto literal suma su longitud; cada `<A>chord</A>` registra
   `{chord, column: cursor}` y suma `chord.length` al cursor. Los tags no
   aportan longitud.
7. Emparejar cada línea de acordes con la siguiente línea de letra.

Modelo resultante:
```ts
type ChordToken = { chord: string; column: number };
type SongLine = { chords: ChordToken[]; lyric: string };
type ParsedSong = { title: string; artist: string; lines: SongLine[] };
```

Renderizado de una línea de acordes transpuesta:
- Transponer cada `chord` → `newChord`.
- Reconstruir la cadena con colocación por columna:
  ```
  let out = ''; let pos = 0;
  for ({newChord, column} of tokens) {
    const target = Math.max(column, pos);
    if (target > pos) out += ' '.repeat(target - pos);
    out += newChord;
    pos = out.length;
  }
  ```
- Mostrar en `<pre>` monoespacio: línea de acordes arriba, línea de letra
  abajo. La línea de letra se mantiene intacta.

## Transposición de acordes (`transpose/chords.ts`)

Parser de un acorde (inglés, entrada):
- Raíz: una letra (A-G) + alteración opcional (# o b, o doble).
- Calidad: sufijo (`m`, `maj7`, `7`, `sus4`, `dim`, `aug`, `add9`, `9`, etc.)
  — se preserva tal cual.
- Bajo opcional tras `/` (slash chord) — se transpone también.

Cromático (inglés): C=0 C#=1 D=2 D#=3 E=4 F=5 F#=6 G=7 G#=8 A=9 A#=10 B=11
(bemoles mapeados: Cb=11, Db=1, Eb=3, Fb=4, Gb=6, Ab=8, Bb=10).

Transposición: `newRoot = (rootIndex + offset) mod 12`, con offset en semitonos
(entero; +½ = +1 semitono). Nota: lacuerda ofrece ±½ y ±1 tono (= ±1 y ±2
semitonos). Nuestros botones: +1 (tono) = +2 semitonos, +½ = +1, -½ = -1,
-1 = -2. Coincide con lacuerda.

Salida en notación **latina**:
- 0=Do, 1=Do#, 2=Re, 3=Re#, 4=Mi, 5=Fa, 6=Fa#, 7=Sol, 8=Sol#, 9=La,
  10=La#, 11=Si.
- Al transponer, usar sostenidos por defecto. Si el acorde original era bemol y
  offset=0, conservar bemol (Do→? no, solo cuando no se transpone). Simplificación
  aceptada: transpuesto siempre con sostenidos.

Casos especiales:
- Acordes sin raíz reconocible (ej. `N.C.`, riffs entre paréntesis como `(B1)`,
  `(A#m)(B)`) → no transponer, dejar tal cual. Los riffs entre paréntesis se
  mantienen como texto.
- Calidad vacía → acorde mayor.

## Estado en memoria (`state.ts`)

```ts
type SongState = {
  id: string;            // uuid
  parsed: ParsedSong;
  offset: number;        // semitonos acumulados
  url: string;
};
const songs = new Map<string, SongState>();
```
Sin persistencia: se pierde al reiniciar (aceptable, uso personal).

## Servidor (`src/index.ts`)

Bun.serve con router manual:
- `GET /` → página principal (form + contenedor HTMX).
- `POST /load` → body `{url}`. Valida que sea de acordes.lacuerda.net. Fetch +
  parse + store. Devuelve parcial `renderSong(state)`.
- `POST /transpose` → body `{id, delta}`. Actualiza offset, devuelve parcial.
- `POST /reset` → body `{id}`. offset=0, devuelve parcial.
- `GET /public/*` → archivos estáticos (CSS).

HTMX: incluido vía CDN en el HTML base. Los parciales se insertan en
`#song-container`.

## Renderizado (`render/song.ts`)

Devuelve HTML:
- Encabezado: título + artista.
- Controles: botones +1 / +½ / -½ / -1 / Original (con `hx-post`).
- Indicador de transposición actual (ej. "+2 semitonos").
- Bloque `<pre class="song">` con líneas: acordes arriba, letra abajo.
- Manejo de errores (URL inválida, fetch fallido, parse fallido) con mensaje.

## Estilos (`public/styles.css`)

- `pre.song { font-family: monospace; }`
- Acordes en negrita/color para distinguir.
- Responsive: scroll horizontal en móvil.

## Estructura de archivos

```
acordesApp/
├── plan.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── routes/
│   │   ├── home.ts
│   │   ├── load.ts
│   │   └── transpose.ts
│   ├── parser/
│   │   └── lacuerda.ts
│   ├── transpose/
│   │   └── chords.ts
│   ├── render/
│   │   └── song.ts
│   └── state.ts
├── public/
│   └── styles.css
└── tests/
    ├── chords.test.ts
    └── lacuerda.test.ts   (con fixture HTML guardado)
```

## Tests

- `chords.test.ts`: transposición de raíces, calidades preservadas, slash chords,
  bemoles, offset negativo, notación latina, casos no-acorde (N.C., riffs).
- `lacuerda.test.ts`: parseo sobre un fixture HTML guardado (la página de
  Tierra Mala), verificando número de líneas, posiciones de acordes, letra.

## Riesgos / edge cases

- Parseo frágil ante cambios de HTML de lacuerda. Mitigación: tests con fixture;
  si falla, mostrar error claro y permitir pegado manual (fuera de alcance v1).
- Alineación se desplaza si un acorde transpuesto es más largo que el original.
  Mitigación: algoritmo de colocación con `Math.max(column, pos)`; aceptable.
- Acordes complejos (maj7, sus, dim, aug, add9, 9, slash) deben preservar
  calidad y transponer raíz + bajo.
- Riffs entre paréntesis `(B1)` se mantienen sin transponer.
- lacuerda puede bloquear por User-Agent → enviar UA de navegador.
- Sin persistencia: recargar pierde la canción (aceptable, uso personal).

## Pasos de implementación (orden sugerido)

1. Scaffold: `bun init`, tsconfig, package.json scripts.
2. `transpose/chords.ts` + tests.
3. `parser/lacuerda.ts` + fixture + tests.
4. `state.ts`.
5. `render/song.ts`.
6. `src/index.ts` + routes + HTMX.
7. `public/styles.css`.
8. Prueba end-to-end con la URL de Tierra Mala.
9. Lint + typecheck (`tsc --noEmit`).

## Fuera de alcance (v1)

- Persistencia/BD, auth, multi-usuario.
- Otros instrumentos/afinaciones (bajo, ukulele, drop D).
- Tablaturas/riffs y afinación.
- Notación inglesa (solo latina).
- Importar por texto pegado o archivo.
- URLs en inglés/portugués (solo acordes.lacuerda.net).
- Deploy a producción (solo local).
- Transposición por tono destino (solo semitonos ±).
```

Write the plan.md file.<|end|><|start|>-assistant to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="filePath">
/var/home/djarrieta/Documentos/dario/acordesApp/plan.md