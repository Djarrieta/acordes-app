# Acordes — transpositor

Aplicación web personal para buscar canciones, mostrar sus letras con los acordes alineados y transponerlos a notación latina (Do, Re, Mi, Fa, Sol, La, Si).

## Requisitos

- [Bun](https://bun.sh/) 1.x

## Ejecución local

```sh
bun install --frozen-lockfile
bun run dev
```

Abre <http://localhost:4173>. Para ejecutar el servidor sin modo de desarrollo:

```sh
bun run start
```

El servidor lee `HOST` y `PORT` del entorno; sus valores predeterminados son `0.0.0.0` y `4173`. Puedes copiarlos desde `.env.example` si necesitas configurar esos valores.

## Uso

Busca por nombre de canción o de artista y pulsa **Reproducir** en el resultado. La búsqueda inicial muestra canciones para “De música ligera”. Selecciona cualquier acorde de la letra para ver una digitación para guitarra. Usa los controles para transponer los acordes por semitonos o restaurar la tonalidad original. Pulsa **Busca** para volver al buscador. El estado de las canciones se conserva solo en memoria mientras el proceso está activo.

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

La aplicación quedará disponible en <http://127.0.0.1:4173>. Compose publica el puerto solo en la interfaz local.

## Estructura

- `src/parser/`: descarga y parsea canciones y resultados de búsqueda.
- `src/transpose/`: transposición de acordes.
- `src/guitar/`: generación de diagramas de digitación para guitarra.
- `src/render/`: renderizado de HTML.
- `src/routes/`: rutas HTTP y respuestas HTMX.
- `src/state.ts`: estado de canciones en memoria.
- `public/`: estilos de la interfaz.
- `tests/`: pruebas del parser y la transposición.

Las digitaciones conocidas se basan en una selección de [tombatossals/chords-db](https://github.com/tombatossals/chords-db) (commit `df06fa7`), distribuida bajo MIT. Se conservan sus posiciones y atribución en `src/guitar/`; cuando no hay una forma en la base no se inventa una digitación. Las variantes disponibles se ordenan priorizando posiciones abiertas, cejillas parciales y trastes bajos.

La interfaz carga HTMX desde un CDN. La aplicación no incluye autenticación; no la expongas a redes públicas sin añadir controles de acceso.
