export function homePage(): Response {
  return new Response(
    `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Acordes — transpositor</title>
  <link rel="stylesheet" href="/public/styles.css">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script>
    htmx.config.responseHandling = [
      { code: "204", swap: false },
      { code: "[23]..", swap: true },
      { code: "[45]..", swap: true, error: true },
      { code: ".", swap: false }
    ];
  </script>
</head>
<body>
  <main class="page">
    <header class="intro">
      <p class="eyebrow">Herramienta personal</p>
      <h1>Acordes a tu tono</h1>
      <p>Pega el enlace de una canción de LaCuerda para ver su letra y transponer sus acordes.</p>
    </header>
    <form class="load-form" hx-post="/load" hx-target="#song-container" hx-swap="innerHTML">
      <label for="song-url">Enlace de acordes.lacuerda.net</label>
      <div class="form-row">
        <input id="song-url" name="url" type="url" placeholder="https://acordes.lacuerda.net/artista/cancion.shtml" required>
        <button type="submit">Cargar canción</button>
      </div>
    </form>
    <div id="song-container" aria-live="polite"></div>
    <footer>La letra y los acordes se obtienen directamente de LaCuerda.</footer>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
