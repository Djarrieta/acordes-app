export function homePage(): Response {
  return new Response(
    `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Acordes — transpositor</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/public/styles.css?v=editor-7">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="/public/youtube.js?v=24" defer></script>
  <script src="/public/audio.js?v=14" defer></script>
  <script src="/public/editor.js?v=2" defer></script>
  <script>
    let likedSourceKeys = new Set();
    let onlyFavorites = false;
    let previousView = null;
    window.setSongView = (view) => {
      const card = document.querySelector("#song-container .song-card");
      if (card) card.dataset.view = view;
    };
    htmx.config.responseHandling = [
      { code: "204", swap: false },
      { code: "[23]..", swap: true },
      { code: "[45]..", swap: true, error: true },
      { code: ".", swap: false }
    ];
    document.addEventListener("htmx:afterSwap", (event) => {
      const target = event.detail.target;
      if (target?.id === "search-results" || target?.id === "song-container") applyFavoriteState();
      if (target?.id === "chord-viewer") {
        const dialog = document.getElementById("chord-modal");
        if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
      }
      if (target?.id !== "song-container" || !target.querySelector(".song-card")) return;
      const card = target.querySelector(".song-card");
      const requestPath = event.detail.requestConfig?.path ?? "";
      if (card.dataset.view !== "loader") {
        card.dataset.view = requestPath === "/load" ? "player" : (previousView !== "loader" && previousView ? previousView : "player");
      }
      previousView = null;
      updateWizard(2);
      document.getElementById("search-panel").hidden = true;
      target.hidden = false;
      document.body.classList.add("is-song-view");
      if (event.detail.requestConfig?.path !== "/load") return;
      const title = target.querySelector("#selected-song-title");
      if (title instanceof HTMLElement) title.focus({ preventScroll: true });
    });
    document.addEventListener("htmx:beforeSwap", (event) => {
      if (event.detail.target?.id !== "song-container") return;
      previousView = document.querySelector("#song-container .song-card")?.dataset.view ?? null;
    });
    document.addEventListener("htmx:beforeRequest", (event) => {
      const requestPath = event.detail?.requestConfig?.path ?? "";
      // Solo se muestra el cargador de página al cargar una canción nueva;
      // al transponer (modificar el tono) se mantiene el contenido actual
      // y el botón pulsado muestra su propio indicador, evitando el parpadeo.
      if (event.detail?.target?.id === "song-container" && requestPath === "/load") {
        document.getElementById("song-loader")?.removeAttribute("hidden");
      }
      if (event.detail.target?.id === "search-results") {
        if (!document.getElementById("search-query").value.trim()) {
          event.preventDefault();
          if (onlyFavorites) showFavoriteSongs();
          else document.getElementById("search-results").replaceChildren();
          return;
        }
        updateWizard(1);
      }
    });
    document.addEventListener("htmx:afterSettle", (event) => {
      if (event.detail?.target?.id === "song-container") {
        document.getElementById("song-loader")?.setAttribute("hidden", "");
      }
    });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-song-view]")) {
        const view = event.target.closest("[data-song-view]").dataset.songView;
        if (view === "options") window.pauseAcordesPlayer?.();
        window.setSongView?.(view);
        return;
      }
      if (event.target instanceof Element && event.target.closest("[data-wizard-search]")) {
        const card = document.getElementById("song-container").querySelector(".song-card");
        const view = card?.dataset.view ?? "player";
        if (view === "editor") {
          window.setSongView?.("options");
        } else if (view === "options") {
          window.setSongView?.("player");
        } else {
          const searchPanel = document.getElementById("search-panel");
          const songContainer = document.getElementById("song-container");
          if (searchPanel) searchPanel.hidden = false;
          if (songContainer) songContainer.hidden = true;
          document.body.classList.remove("is-song-view");
          updateWizard(1);
          document.getElementById("search-query")?.focus();
        }
      }
      const dialog = document.getElementById("chord-modal");
      if (event.target === dialog && dialog instanceof HTMLDialogElement) dialog.close();
      const favoriteButton = event.target instanceof Element
        ? event.target.closest("[data-favorite-toggle], [data-favorite-filter]")
        : null;
      if (favoriteButton?.hasAttribute("data-favorite-toggle")) {
        toggleFavorite(favoriteButton);
      } else if (favoriteButton?.hasAttribute("data-favorite-filter")) {
        onlyFavorites = !onlyFavorites;
        applyFavoriteState();
        if (!document.getElementById("search-query").value.trim()) {
          if (onlyFavorites) showFavoriteSongs();
          else document.getElementById("search-results").replaceChildren();
        }
      }
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
    async function loadPreferences() {
      try {
        const response = await fetch("/favorites/state");
        if (!response.ok) return;
        const data = await response.json();
        likedSourceKeys = new Set(Array.isArray(data.liked) ? data.liked : []);
        applyFavoriteState();
      } catch (error) {
        console.error("No se pudieron cargar las canciones que me gustan:", error);
      }
    }
    async function showFavoriteSongs() {
      const results = document.getElementById("search-results");
      try {
        const response = await fetch("/favorites");
        if (!response.ok) return;
        const html = await response.text();
        results.innerHTML = html;
        htmx.process(results);
        applyFavoriteState();
      } catch (error) {
        console.error("No se pudieron cargar las canciones que me gustan:", error);
      }
    }
    function applyFavoriteState() {
      const items = document.querySelectorAll("#search-results .result-item[data-song-id]");
      items.forEach((item) => {
        const songId = item.getAttribute("data-song-id");
        const liked = songId !== null && likedSourceKeys.has(songId);
        item.hidden = onlyFavorites && !liked;
      });
      document.querySelectorAll("[data-favorite-toggle][data-song-id]").forEach((button) => {
        const songId = button.getAttribute("data-song-id");
        const liked = songId !== null && likedSourceKeys.has(songId);
        const title = liked ? "Quitar de canciones que me gustan" : "Añadir a canciones que me gustan";
        button.setAttribute("aria-pressed", String(liked));
        button.setAttribute("aria-label", title);
        button.setAttribute("title", title);
      });
      const filter = document.getElementById("favorite-filter");
      const hasFavorites = likedSourceKeys.size > 0;
      if (!hasFavorites) onlyFavorites = false;
      filter.disabled = !hasFavorites;
      filter.setAttribute("aria-pressed", String(onlyFavorites && hasFavorites));
      const filterLabel = onlyFavorites ? "Dejar de mostrar canciones que me gustan" : "Mostrar canciones que me gustan";
      filter.setAttribute("aria-label", filterLabel);
      filter.setAttribute("title", filterLabel);
      filter.classList.toggle("is-active", onlyFavorites && hasFavorites);
    }
    async function toggleFavorite(button) {
      const songId = button.getAttribute("data-song-id");
      if (!songId) return;
      try {
        const body = new URLSearchParams({ sourceKey: songId });
        const response = await fetch("/favorites/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.liked) likedSourceKeys.add(songId);
        else likedSourceKeys.delete(songId);
        applyFavoriteState();
        if (onlyFavorites && !document.getElementById("search-query").value.trim()) showFavoriteSongs();
      } catch (error) {
        console.error("No se pudo guardar la canción que me gusta:", error);
      }
    }
    document.addEventListener("DOMContentLoaded", () => {
      loadPreferences();
    });
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
          <input id="search-query" name="q" type="search" placeholder="Nombre de canción o artista" maxlength="100">
          <select id="search-mode" name="mode" aria-label="Tipo de búsqueda">
            <option value="songs" selected>Canciones</option>
            <option value="artists">Artistas</option>
          </select>
          <button id="favorite-filter" class="favorite-toggle favorite-filter-toggle" type="button" data-favorite-filter aria-label="Mostrar canciones que me gustan" title="Mostrar canciones que me gustan" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg></button>
          <button type="submit"><span>Buscar</span></button>
        </div>
      </form>
      <div id="search-results" aria-live="polite"></div>
    </section>
    <div id="song-loader" class="song-loader song-loader--page" role="status" aria-live="polite" hidden><span class="song-loader-spinner" aria-hidden="true"></span><span>Cargando…</span></div>
    <div id="song-container" aria-live="polite" hidden></div>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
