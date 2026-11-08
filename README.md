# Acordes — transpositor

Aplicación web personal para buscar canciones, mostrar sus letras con los acordes alineados y transponerlos a notación latina (Do, Re, Mi, Fa, Sol, La, Si).

## Requisitos

- [Bun](https://bun.sh/) 1.x
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) para generar marcas de tiempo desde los subtítulos de YouTube (opcional; se puede desactivar con `TIMESTAMPS_ENABLED=false`).

## Ejecución local

```sh
bun install --frozen-lockfile
bun run dev
```

Abre <http://localhost:4173>. Para ejecutar el servidor sin modo de desarrollo:

```sh
bun run start
```

El servidor lee `HOST`, `PORT`, `DB_PATH`, `VIDEO_SEARCH_ENABLED`, `VIDEO_MAX_CANDIDATES`, `TIMESTAMPS_ENABLED`, `TIMESTAMPS_MAX_ATTEMPTS` y `YTDLP_PATH` del entorno; los valores de ejemplo están en `.env.example`. La base SQLite se crea en `data/app.sqlite` por defecto.

> **Entorno de producción (POC):** la aplicación desplegada vive en <https://acordes.ingeniar.online/> (Docker + Cloudflare Tunnel). El desarrollo se hace por SSH sobre el servidor, así que `localhost` no es el entorno de validación: cada cambio se publica reconstruyendo el contenedor y se comprueba en esa URL. No hay separación entre dev y prod; todo es producción y, al ser una POC, está permitido romperla durante la iteración.

## Uso

Busca por nombre de canción o de artista y pulsa **Reproducir** en el resultado. La vista de reproducción ocupa la pantalla: el diagrama y el video quedan visibles y la letra se desplaza dentro de su propio panel, centrando automáticamente la línea activa. **Busca** vuelve al buscador. En la vista de reproducción, marca con el corazón las canciones que te gustan; quedan guardadas en el almacenamiento local de tu navegador. En **Acompañamiento** se busca automáticamente un video en YouTube y puedes cambiar el enlace o elegir otro candidato; al cambiar de video se borran las marcas actuales. Usa **Reproducir audio** para iniciar o pausar el video. Activa las marcas de acordes y pulsa cada acorde para guardar el tiempo; el acorde que corresponde al punto actual se resalta y la letra acompaña el avance. Las marcas se guardan en la base de datos del servidor por canción y sobreviven a recargas y a otros navegadores. **Generar marcas automáticas** transcribe el video con `yt-dlp` y alinea la letra para asignar tiempos; si la cobertura es baja no se aplican y se avisa. Las marcas manuales nunca se sobrescriben al regenerar. El botón **Editar** abre el editor para corregir título, artista, líneas y acordes; al guardar se recarga el reproductor. El diagrama de digitación del acorde actual se muestra junto al video y cambia al avanzar la canción. La preferencia de transposición se restaura al volver a reproducir la canción; **Original** la elimina. Selecciona cualquier acorde de la letra para ver una digitación para guitarra.

El buscador enlaza cada resultado con la canción correspondiente. Si la búsqueda de canciones no encuentra resultados, cambia el selector a **Artistas** para localizar el artista y ver su listado de canciones.

## Pruebas y tipos

```sh
bun run test
bun run typecheck
```

## Docker Compose

Crea el archivo de entorno requerido y levanta el servicio:

```sh
cp .env.example .env
docker compose up --build
```

La base de datos se guarda en `./data/app.sqlite` mediante un volumen de Compose. La imagen instala la última versión de `yt-dlp` para las marcas automáticas.

Copias de seguridad y reinicio de la base:

```sh
bun run db:backup   # crea data/backup-AAAAMMDDTHHMMSS.sqlite con VACUUM INTO
bun run db:reset    # elimina la base local (no la copia)
```

La aplicación quedará disponible en <http://127.0.0.1:4173>. Compose publica el puerto solo en la interfaz local; el túnel de Cloudflare es quien la expone públicamente en <https://acordes.ingeniar.online/>.

Para publicar cambios en el servidor y validarlos:

```sh
bun run test && bun run typecheck
docker compose config -q && docker compose up -d --build
curl -sS -m 5 https://acordes.ingeniar.online/
```

El contenedor `acordes-app-c` se reconstruye con el código actual y el túnel reutiliza el puerto local `127.0.0.1:4173`. La verificación funcional y visual se hace en <https://acordes.ingeniar.online/>, no en `localhost`. Cada cambio que se publique queda disponible en esa URL; no hay entorno de desarrollo separado.

## Estructura

- `src/parser/`: descarga y parsea canciones y resultados de búsqueda.
- `src/transpose/`: transposición de acordes.
- `src/guitar/`: generación de diagramas de digitación para guitarra.
- `src/render/`: renderizado de HTML.
- `src/songs/`: modelo, repositorio SQLite, rutas de canción y enriquecimiento (búsqueda de video, transcripción y alineación).
- `src/routes/`: rutas HTTP y respuestas HTMX.
- `src/db.ts`: conexión SQLite (WAL) y utilidades de transacción.
- `public/`: estilos y lógica del cliente.
- `tests/`: pruebas del parser, transposición, repositorio, rutas y alineación.
- `data/`: base de datos local (ignorada por Git).

Las digitaciones conocidas se basan en una selección de [tombatossals/chords-db](https://github.com/tombatossals/chords-db) (commit `df06fa7`), distribuida bajo MIT. Se conservan sus posiciones y atribución en `src/guitar/`; cuando no hay una forma en la base no se inventa una digitación. Las variantes disponibles se ordenan priorizando posiciones abiertas, cejillas parciales y trastes bajos.

La interfaz carga HTMX desde un CDN. La aplicación no incluye autenticación; no la expongas a redes públicas sin añadir controles de acceso.
