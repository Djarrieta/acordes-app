export function homePage(): Response {
  return new Response(
    `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Acordes — transpositor</title>
  <link rel="stylesheet" href="/public/styles.css?v=wizard-1">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script>
    htmx.config.responseHandling = [
      { code: "204", swap: false },
      { code: "[23]..", swap: true },
      { code: "[45]..", swap: true, error: true },
      { code: ".", swap: false }
    ];
    document.addEventListener("htmx:afterSwap", (event) => {
      const target = event.detail.target;
      if (target?.id === "search-results") {
        updateWizard(target.querySelector(".result-list") ? 2 : 1);
      }
      if (target?.id === "chord-viewer") {
        const dialog = document.getElementById("chord-modal");
        if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
      }
      if (target?.id !== "song-container" || !target.querySelector(".song-card")) return;
      updateWizard(3);
      if (event.detail.requestConfig?.path !== "/load") return;
      const title = target.querySelector("#selected-song-title");
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
      if (title instanceof HTMLElement) title.focus({ preventScroll: true });
    });
    document.addEventListener("htmx:beforeRequest", (event) => {
      if (event.detail.target?.id === "search-results") updateWizard(1);
    });
    document.addEventListener("click", (event) => {
      const dialog = document.getElementById("chord-modal");
      if (event.target === dialog && dialog instanceof HTMLDialogElement) dialog.close();
    });
    function updateWizard(activeStep) {
      const steps = document.querySelectorAll("[data-wizard-step]");
      steps.forEach((step) => {
        const number = Number(step.dataset.wizardStep);
        step.classList.toggle("is-current", number === activeStep);
        step.classList.toggle("is-complete", number < activeStep);
        if (number === activeStep) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
      });
      const status = document.getElementById("wizard-status");
      const messages = [
        "Paso 1 de 3: busca un artista o una canción.",
        "Paso 2 de 3: elige una canción de los resultados.",
        "Paso 3 de 3: canción cargada; puedes transponer sus acordes."
      ];
      if (status) status.textContent = messages[activeStep - 1];
    }
  </script>
</head>
<body>
  <main class="page">
    <header class="intro">
      <p class="eyebrow">Herramienta personal</p>
      <h1>Acordes a tu tono</h1>
      <p>Busca una canción o un artista de LaCuerda para ver su letra y transponer sus acordes.</p>
    </header>
    <section class="song-wizard" aria-label="Pasos para encontrar una canción">
      <ol class="wizard-steps">
        <li class="is-current" data-wizard-step="1" aria-current="step"><span class="wizard-number">1</span><span>Busca</span></li>
        <li data-wizard-step="2"><span class="wizard-number">2</span><span>Elige canción</span></li>
        <li data-wizard-step="3"><span class="wizard-number">3</span><span>Ve y transpón</span></li>
      </ol>
      <p class="visually-hidden" id="wizard-status" aria-live="polite">Paso 1 de 3: busca un artista o una canción.</p>
    </section>
    <form class="load-form search-form" role="search" hx-get="/search" hx-target="#search-results" hx-swap="innerHTML">
      <label for="search-query">Busca en el catálogo</label>
      <p class="search-description">Encuentra canciones y artistas de LaCuerda.</p>
      <div class="form-row">
        <input id="search-query" name="q" type="search" placeholder="Ej. nombre de canción o artista" maxlength="100" required>
        <select id="search-mode" name="mode" aria-label="Tipo de búsqueda">
          <option value="songs">Canciones</option>
          <option value="artists">Artistas</option>
        </select>
        <button type="submit"><span>Buscar</span></button>
      </div>
      <p class="search-hint">Busca por título o intérprete; cambia el filtro para explorar artistas.</p>
    </form>
    <div id="song-container" aria-live="polite"></div>
    <div id="search-results" aria-live="polite"></div>
    <details class="url-fallback">
      <summary>¿Tienes el enlace? Carga una canción directamente</summary>
      <form class="load-form" hx-post="/load" hx-target="#song-container" hx-swap="innerHTML">
        <label for="song-url">Enlace de acordes.lacuerda.net</label>
        <div class="form-row">
          <input id="song-url" name="url" type="url" placeholder="https://acordes.lacuerda.net/artista/cancion.shtml" required>
          <button type="submit">Cargar canción</button>
        </div>
      </form>
    </details>
    <footer>La letra y los acordes se obtienen directamente de LaCuerda.</footer>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
