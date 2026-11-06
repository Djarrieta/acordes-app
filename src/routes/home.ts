export function homePage(): Response {
  return new Response(
    `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Acordes — transpositor</title>
  <link rel="stylesheet" href="/public/styles.css?v=wizard-5">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script>
    const FAVORITES_KEY = "acordes-liked-songs";
    const SONG_ID = /^\\/([a-z0-9_-]+)\\/([a-z0-9_.-]+)\\.shtml$/i;
    let favoriteSongs = new Map();
    let onlyFavorites = false;
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
      if (event.detail.target?.id === "search-results") {
        if (!document.getElementById("search-query").value.trim()) {
          event.preventDefault();
          if (onlyFavorites) renderFavoriteSongs();
          else document.getElementById("search-results").replaceChildren();
          return;
        }
        updateWizard(1);
      }
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
      const favoriteButton = event.target instanceof Element
        ? event.target.closest("[data-favorite-toggle], [data-favorite-filter]")
        : null;
      if (favoriteButton?.hasAttribute("data-favorite-toggle")) {
        toggleFavorite(favoriteButton);
      } else if (favoriteButton?.hasAttribute("data-favorite-filter")) {
        onlyFavorites = !onlyFavorites;
        applyFavoriteState();
        if (!document.getElementById("search-query").value.trim()) {
          if (onlyFavorites) renderFavoriteSongs();
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
    function showFavoriteStorageError(message) {
      const status = document.getElementById("favorites-status");
      if (status) {
        status.textContent = message;
        status.hidden = false;
      }
    }
    function favoriteFromId(id, title = "", artist = "") {
      if (typeof id !== "string" || !SONG_ID.test(id)) return null;
      const [, artistSlug, fileSlug] = id.match(SONG_ID) || [];
      return {
        id,
        title: title || fileSlug.replace(/\.shtml$/i, "").replace(/[_-]+/g, " "),
        artist: artist || artistSlug.replace(/[_-]+/g, " "),
        url: "https://acordes.lacuerda.net" + id,
        legacy: !title || !artist
      };
    }
    function readFavoriteSongs() {
      try {
        const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
        if (!Array.isArray(stored)) {
          throw new TypeError("El formato de canciones favoritas no es válido.");
        }
        const songs = new Map();
        stored.forEach((value) => {
          const song = typeof value === "string"
            ? favoriteFromId(value)
            : value && typeof value === "object"
              ? favoriteFromId(value.id, value.title, value.artist)
              : null;
          if (song) songs.set(song.id, song);
        });
        return songs;
      } catch (error) {
        console.error("No se pudieron cargar las canciones que te gustan:", error);
        showFavoriteStorageError("No se pudieron cargar tus canciones que te gustan desde este navegador.");
        return new Map();
      }
    }
    function persistFavoriteSongs() {
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteSongs.values()]));
      } catch (error) {
        console.error("No se pudieron guardar las canciones que te gustan:", error);
        showFavoriteStorageError("No se pudieron guardar tus canciones que te gustan en este navegador.");
      }
    }
    function createSongListItem(song) {
      const item = document.createElement("li");
      item.className = "result-item";
      item.dataset.songId = song.id;
      item.dataset.songTitle = song.title;
      item.dataset.songArtist = song.artist;
      const copy = document.createElement("div");
      copy.className = "result-copy";
      const title = document.createElement("strong");
      title.textContent = song.title;
      const artist = document.createElement("span");
      artist.className = "result-detail";
      artist.textContent = song.artist;
      copy.append(title, artist);
      const button = document.createElement("button");
      button.className = "result-action";
      button.type = "button";
      button.textContent = "Reproducir";
      button.setAttribute("aria-label", "Reproducir " + song.title);
      button.setAttribute("hx-post", "/load");
      button.setAttribute("hx-vals", JSON.stringify({ url: song.url }));
      button.setAttribute("hx-target", "#song-container");
      button.setAttribute("hx-swap", "innerHTML");
      item.append(copy, button);
      return item;
    }
    function renderFavoriteSongs() {
      const results = document.getElementById("search-results");
      if (!onlyFavorites || favoriteSongs.size === 0) {
        results.replaceChildren();
        return;
      }
      const section = document.createElement("section");
      section.className = "search-results";
      section.setAttribute("aria-label", "Canciones que me gustan");
      const summary = document.createElement("p");
      summary.className = "search-summary";
      const count = document.createElement("strong");
      count.textContent = favoriteSongs.size + (favoriteSongs.size === 1 ? " canción que te gusta" : " canciones que te gustan");
      summary.append(count);
      const list = document.createElement("ul");
      list.className = "result-list";
      favoriteSongs.forEach((song) => list.append(createSongListItem(song)));
      section.append(summary, list);
      results.replaceChildren(section);
      htmx.process(section);
    }
    async function hydrateLegacyFavorites() {
      const unresolved = [...favoriteSongs.values()].filter((song) => song.legacy);
      const artistSlugs = new Set(unresolved.map((song) => song.id.split("/")[1]));
      let updated = false;
      for (const slug of artistSlugs) {
        try {
          const response = await fetch("/artist?slug=" + encodeURIComponent(slug));
          if (!response.ok) throw new Error("HTTP " + response.status);
          const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
          parsed.querySelectorAll(".result-item[data-song-id]").forEach((item) => {
            const id = item.getAttribute("data-song-id");
            const saved = favoriteSongs.get(id);
            if (!saved) return;
            const song = favoriteFromId(id, item.getAttribute("data-song-title"), item.getAttribute("data-song-artist"));
            if (song) {
              song.legacy = false;
              favoriteSongs.set(id, song);
              updated = true;
            }
          });
        } catch (error) {
          console.error("No se pudieron actualizar los datos de canciones favoritas:", error);
          showFavoriteStorageError("No se pudieron actualizar los datos de algunas canciones favoritas.");
        }
      }
      if (updated) persistFavoriteSongs();
      renderFavoriteSongs();
    }
    function applyFavoriteState() {
      const items = document.querySelectorAll("#search-results .result-item[data-song-id]");
      items.forEach((item) => {
        const songId = item.getAttribute("data-song-id");
        const liked = songId !== null && favoriteSongs.has(songId);
        item.hidden = onlyFavorites && !liked;
      });
      document.querySelectorAll("[data-favorite-toggle][data-song-id]").forEach((button) => {
        const songId = button.getAttribute("data-song-id");
        const liked = songId !== null && favoriteSongs.has(songId);
        const title = liked ? "Quitar de canciones que me gustan" : "Añadir a canciones que me gustan";
        button.setAttribute("aria-pressed", String(liked));
        button.setAttribute("aria-label", title);
        button.setAttribute("title", title);
      });
      const filter = document.getElementById("favorite-filter");
      filter.disabled = favoriteSongs.size === 0;
      filter.setAttribute("aria-pressed", String(onlyFavorites && favoriteSongs.size > 0));
      const filterLabel = onlyFavorites ? "Dejar de mostrar canciones que me gustan" : "Mostrar canciones que me gustan";
      filter.setAttribute("aria-label", filterLabel);
      filter.setAttribute("title", filterLabel);
      filter.classList.toggle("is-active", onlyFavorites && favoriteSongs.size > 0);
    }
    function toggleFavorite(button) {
      const songId = button.getAttribute("data-song-id");
      if (!songId) return;
      if (favoriteSongs.has(songId)) {
        favoriteSongs.delete(songId);
      } else {
        const song = favoriteFromId(
          songId,
          button.getAttribute("data-song-title"),
          button.getAttribute("data-song-artist"),
        );
        if (song) {
          song.legacy = false;
          favoriteSongs.set(songId, song);
        }
      }
      onlyFavorites = favoriteSongs.size > 0;
      persistFavoriteSongs();
      applyFavoriteState();
      if (!document.getElementById("search-query").value.trim()) renderFavoriteSongs();
    }
    window.addEventListener("storage", (event) => {
      if (event.key === FAVORITES_KEY) {
        favoriteSongs = readFavoriteSongs();
        onlyFavorites = favoriteSongs.size > 0;
        applyFavoriteState();
        if (!document.getElementById("search-query").value.trim()) renderFavoriteSongs();
      }
    });
    document.addEventListener("DOMContentLoaded", () => {
      favoriteSongs = readFavoriteSongs();
      onlyFavorites = favoriteSongs.size > 0;
      applyFavoriteState();
      renderFavoriteSongs();
      void hydrateLegacyFavorites();
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
      <p class="visually-hidden" id="favorites-status" role="status" aria-live="polite" hidden></p>
    </section>
    <div id="song-container" aria-live="polite" hidden></div>
  </main>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
