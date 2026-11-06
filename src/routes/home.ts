export function homePage(): Response {
  return new Response(
    `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Acordes — transpositor</title>
  <link rel="stylesheet" href="/public/styles.css?v=wizard-2">
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
      if (target?.id === "chord-viewer") {
        const dialog = document.getElementById("chord-modal");
        if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
      }
      if (target?.id !== "song-container" || !target.querySelector(".song-card")) return;
      updateWizard(2);
      document.getElementById("search-panel").hidden = true;
      target.hidden = false;
      if (event.detail.requestConfig?.path !== "/load") return;
      const title = target.querySelector("#selected-song-title");
      document.querySelector(".song-wizard")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
      if (title instanceof HTMLElement) title.focus({ preventScroll: true });
    });
    document.addEventListener("htmx:beforeRequest", (event) => {
      if (event.detail.target?.id === "search-results") updateWizard(1);
    });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-wizard-search]")) {
        const searchPanel = document.getElementById("search-panel");
        const songContainer = document.getElementById("song-container");
        if (searchPanel) searchPanel.hidden = false;
        if (songContainer) songContainer.hidden = true;
        updateWizard(1);
        document.getElementById("search-query")?.focus();
      }
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
        "Paso 1 de 2: busca y elige una canción.",
        "Paso 2 de 2: reproduce la canción y ajusta sus acordes."
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
      <p>Encuentra una canción y ajusta sus acordes a tu tono.</p>
    </header>
    <nav class="song-wizard" aria-label="Pasos de la canción">
      <ol class="wizard-steps">
        <li class="is-current" data-wizard-step="1" aria-current="step"><button type="button" class="wizard-step-button" data-wizard-search><span class="wizard-number">1</span><span>Busca</span></button></li>
        <li data-wizard-step="2"><span class="wizard-step-label"><span class="wizard-number">2</span><span>Reproducir</span></span></li>
      </ol>
      <p class="visually-hidden" id="wizard-status" aria-live="polite">Paso 1 de 2: busca y elige una canción.</p>
    </nav>
    <section id="search-panel">
      <form class="load-form search-form" role="search" hx-get="/search" hx-target="#search-results" hx-swap="innerHTML">
        <label for="search-query">Busca una canción</label>
        <div class="form-row">
          <input id="search-query" name="q" type="search" value="De música ligera" placeholder="Nombre de canción o artista" maxlength="100" required>
          <select id="search-mode" name="mode" aria-label="Tipo de búsqueda">
            <option value="songs" selected>Canciones</option>
            <option value="artists">Artistas</option>
          </select>
          <button type="submit"><span>Buscar</span></button>
        </div>
      </form>
      <div id="search-results" aria-live="polite" hx-get="/search?q=De%20m%C3%BAsica%20ligera&amp;mode=songs" hx-trigger="load" hx-swap="innerHTML"></div>
    </section>
    <div id="song-container" aria-live="polite" hidden></div>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
