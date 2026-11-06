const YOUTUBE_PREFERENCES_KEY = "acordes-youtube-videos";
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const SONG_ID_PATTERN = /^\/[a-z0-9_-]+\/[a-z0-9_.-]+\.shtml$/i;

let preferences = new Map();
let activeSection = null;
let player = null;
let playerVideoId = null;
let apiLoading = false;
let pendingPlayback = null;
let storageError = "";
let markMode = false;
let playbackTimer = null;
let highlightedChordIndex = null;

function readPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(YOUTUBE_PREFERENCES_KEY) || "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      throw new TypeError("El formato de videos vinculados no es válido.");
    }
    return new Map(
      Object.entries(stored).filter(([songId, value]) =>
        SONG_ID_PATTERN.test(songId)
        && value
        && typeof value === "object"
        && VIDEO_ID_PATTERN.test(value.videoId)
        && (Array.isArray(value.chordTimestamps) || Array.isArray(value.timestamps)),
      ).map(([songId, value]) => [
        songId,
        {
          videoId: value.videoId,
          url: typeof value.url === "string" ? value.url : "",
          chordTimestamps: (Array.isArray(value.chordTimestamps) ? value.chordTimestamps : []).map((time) =>
            Number.isSafeInteger(time) && time >= 0 ? time : null,
          ),
        },
      ]),
    );
  } catch (error) {
    console.error("No se pudieron cargar los videos vinculados:", error);
    storageError = "No se pudieron cargar los videos guardados en este navegador.";
    return new Map();
  }
}

function savePreferences() {
  try {
    localStorage.setItem(YOUTUBE_PREFERENCES_KEY, JSON.stringify(Object.fromEntries(preferences)));
    storageError = "";
    return true;
  } catch (error) {
    console.error("No se pudieron guardar los videos vinculados:", error);
    storageError = "No se pudo guardar el video en este navegador.";
    if (activeSection) setStatus(activeSection, storageError);
    return false;
  }
}

function setStatus(section, message) {
  const status = section?.querySelector("[data-youtube-status]");
  if (status) status.textContent = message;
}

function updateChordControls(section, video) {
  const ready = Boolean(video && player && player.getPlayerState);
  const toggle = section.querySelector("[data-chord-mark-toggle]");
  const songCard = section.closest(".song-card");
  if (toggle) toggle.disabled = !ready || !section.open;
  songCard?.querySelectorAll("[data-chord-index]").forEach((chord) => {
    const index = Number(chord.dataset.chordIndex);
    const timestamp = video?.chordTimestamps[index];
    const marker = chord.querySelector(".chord-time-marker");
    if (Number.isSafeInteger(timestamp)) {
      chord.dataset.chordTime = formatTimestamp(timestamp);
      chord.title = `Marca de reproducción: ${formatTimestamp(timestamp)}`;
      if (marker) marker.textContent = formatTimestamp(timestamp);
    } else {
      delete chord.dataset.chordTime;
      chord.removeAttribute("title");
      if (marker) marker.textContent = "";
    }
    const chordName = chord.dataset.chordName;
    chord.setAttribute(
      "aria-label",
      markMode
        ? Number.isSafeInteger(timestamp)
          ? `Actualizar la marca de ${chordName}, actualmente en ${formatTimestamp(timestamp)}`
          : `Marcar el tiempo de ${chordName}`
        : Number.isSafeInteger(timestamp)
          ? `Ver diagrama de ${chordName}. Marca de reproducción en ${formatTimestamp(timestamp)}`
          : `Ver diagrama de ${chordName}`,
    );
    chord.classList.toggle("is-marking", markMode && section.open);
  });
}

function setMarkMode(section, enabled) {
  markMode = Boolean(enabled && section?.open && player?.getCurrentTime && preferences.has(section.dataset.youtubeSong));
  section?.classList.toggle("is-marking", markMode);
  const toggle = section?.querySelector("[data-chord-mark-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(markMode));
    toggle.textContent = markMode ? "Desactivar marcas de acordes" : "Activar marcas de acordes";
  }
  const video = section ? preferences.get(section.dataset.youtubeSong) : null;
  if (section) updateChordControls(section, video);
}

function formatTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateCurrentChord(section, video) {
  if (!player?.getCurrentTime || activeSection !== section) return;
  const currentTime = player.getCurrentTime();
  let activeIndex = null;
  let activeTimestamp = -1;
  video.chordTimestamps.forEach((timestamp, index) => {
    if (Number.isSafeInteger(timestamp) && timestamp <= currentTime && timestamp >= activeTimestamp) {
      activeIndex = index;
      activeTimestamp = timestamp;
    }
  });
  if (activeIndex === highlightedChordIndex) return;
  highlightedChordIndex = activeIndex;
  const songCard = section.closest(".song-card");
  songCard?.querySelectorAll("[data-chord-index]").forEach((chord) => {
    const current = Number(chord.dataset.chordIndex) === activeIndex;
    chord.classList.toggle("is-current", current);
    chord.closest(".song-line")?.classList.remove("is-current");
  });
  const activeChord = songCard?.querySelector(`[data-chord-index="${activeIndex}"]`);
  const activeLine = activeChord?.closest(".song-line");
  activeLine?.classList.add("is-current");
  activeLine?.scrollIntoView({
    block: "nearest",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

function initializePlayer(section, video) {
  if (activeSection !== section || !video || !window.YT?.Player) return;
  if (player && playerVideoId === video.videoId && player.getPlayerState) {
    updateChordControls(section, video);
    return;
  }
  if (player) {
    setMarkMode(section, false);
    player.destroy();
    player = null;
    playerVideoId = null;
    highlightedChordIndex = null;
    if (playbackTimer !== null) {
      window.clearInterval(playbackTimer);
      playbackTimer = null;
    }
  }
  const host = section.closest(".song-card")?.querySelector("[data-youtube-player]");
  if (!host) return;
  host.replaceChildren();
  const element = document.createElement("div");
  host.append(element);
  setStatus(section, "Cargando el reproductor de YouTube…");
  player = new window.YT.Player(element, {
    width: "100%",
    videoId: video.videoId,
    playerVars: { playsinline: 1, origin: window.location.origin },
    events: {
      onReady(event) {
        if (
          activeSection !== section
          || preferences.get(section.dataset.youtubeSong)?.videoId !== video.videoId
        ) {
          event.target.destroy();
          return;
        }
        player = event.target;
        updateChordControls(section, video);
        setMarkMode(section, false);
        const restore = pendingPlayback;
        pendingPlayback = null;
        if (restore?.songId === section.dataset.youtubeSong && restore.videoId === video.videoId) {
          player.seekTo(restore.seconds, true);
          if (restore.wasPlaying) player.playVideo();
        }
        setStatus(section, "Video listo. Reprodúcelo y activa las marcas para sincronizar los acordes.");
      },
      onStateChange(event) {
        if (
          activeSection !== section
          || preferences.get(section.dataset.youtubeSong)?.videoId !== video.videoId
        ) return;
        if (event.data === window.YT.PlayerState.PLAYING) {
          setStatus(section, markMode
            ? "Marcas activadas: pulsa el acorde que está sonando para guardar su tiempo."
            : "Reproduciendo. Abre este panel para activar las marcas de acordes.");
          if (playbackTimer !== null) window.clearInterval(playbackTimer);
          updateCurrentChord(section, video);
          playbackTimer = window.setInterval(() => updateCurrentChord(section, video), 250);
        } else if (playbackTimer !== null) {
          window.clearInterval(playbackTimer);
          playbackTimer = null;
        }
      },
      onError(event) {
        if (
          activeSection !== section
          || preferences.get(section.dataset.youtubeSong)?.videoId !== video.videoId
        ) return;
        console.error("Error del reproductor de YouTube:", event.data);
        setStatus(section, "No se pudo reproducir este video. Prueba con otro enlace.");
        if (playbackTimer !== null) {
          window.clearInterval(playbackTimer);
          playbackTimer = null;
        }
        updateChordControls(section, null);
      },
    },
  });
  playerVideoId = video.videoId;
}

function initializeSection(section) {
  if (!section) return;
  activeSection = section;
  const songId = section.dataset.youtubeSong;
  const video = preferences.get(songId);
  const input = section.querySelector('input[name="url"]');
  const unlinkButton = section.querySelector("[data-youtube-unlink]");
  const summaryState = section.querySelector("[data-youtube-summary-state]");
  const host = section.closest(".song-card")?.querySelector("[data-youtube-player]");
  if (input) input.value = video?.url ?? "";
  if (unlinkButton) unlinkButton.hidden = !video;
  if (summaryState) summaryState.textContent = video ? "Video vinculado" : "Configurar audio y marcas";
  updateChordControls(section, video);
  if (host) host.hidden = !video;
  if (!video) {
    setMarkMode(section, false);
    if (player) {
      if (player.destroy) player.destroy();
      player = null;
      playerVideoId = null;
      if (playbackTimer !== null) {
        window.clearInterval(playbackTimer);
        playbackTimer = null;
      }
      highlightedChordIndex = null;
    }
    setStatus(section, storageError || "Busca un video, copia su enlace y pégalo aquí.");
    return;
  }

  if (!window.YT?.Player) {
    setStatus(section, storageError || "Preparando el reproductor de YouTube…");
    loadYoutubeApi();
  } else {
    initializePlayer(section, video);
  }
  if (!section.open) {
    setStatus(section, "Video vinculado. Reprodúcelo y abre Acompañamiento para marcar acordes.");
  }
}

function loadYoutubeApi() {
  if (apiLoading) return;
  apiLoading = true;
  window.onYouTubeIframeAPIReady = () => {
    apiLoading = false;
    if (activeSection) initializeSection(activeSection);
  };
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.onerror = () => {
    apiLoading = false;
    if (activeSection) {
      setStatus(activeSection, "No se pudo cargar YouTube. Revisa tu conexión e inténtalo de nuevo.");
    }
  };
  document.head.append(script);
}

document.addEventListener("htmx:beforeSwap", (event) => {
  if (event.detail.target?.id !== "song-container") return;
  markMode = false;
  highlightedChordIndex = null;
  if (playbackTimer !== null) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  if (player && activeSection) {
    try {
      const video = preferences.get(activeSection.dataset.youtubeSong);
      if (video && player.getCurrentTime) {
        pendingPlayback = {
          songId: activeSection.dataset.youtubeSong,
          videoId: video.videoId,
          seconds: player.getCurrentTime(),
          wasPlaying: player.getPlayerState() === window.YT?.PlayerState.PLAYING,
        };
      }
      if (player.destroy) player.destroy();
    } catch (error) {
      console.error("No se pudo conservar la posición del video:", error);
    }
    player = null;
    playerVideoId = null;
  }
});

document.addEventListener("htmx:afterSwap", (event) => {
  if (event.detail.target?.id !== "song-container") return;
  initializeSection(event.detail.target.querySelector("[data-youtube-song]"));
});

document.addEventListener("toggle", (event) => {
  const section = event.target;
  if (!(section instanceof HTMLDetailsElement) || !section.matches("[data-youtube-song]")) return;
  if (!section.open) {
    setMarkMode(section, false);
    updateChordControls(section, preferences.get(section.dataset.youtubeSong));
    setStatus(section, "Panel cerrado. Las marcas están bloqueadas; los acordes abren sus diagramas.");
    return;
  }
  initializeSection(section);
}, true);

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".youtube-link-form");
  if (!form) return;
  event.preventDefault();
  const section = form.closest("[data-youtube-song]");
  const input = form.querySelector('input[name="url"]');
  const url = input.value.trim();
  setStatus(section, "Validando el enlace…");
  try {
    const response = await fetch("/youtube/video-id", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo validar el enlace.");
    const songId = section.dataset.youtubeSong;
    const previous = preferences.get(songId);
    preferences.set(songId, {
      videoId: result.videoId,
      url,
      chordTimestamps: previous?.videoId === result.videoId ? previous.chordTimestamps : [],
    });
    const saved = savePreferences();
    setMarkMode(section, false);
    if (playbackTimer !== null) {
      window.clearInterval(playbackTimer);
      playbackTimer = null;
    }
    if (player?.destroy) player.destroy();
    player = null;
    playerVideoId = null;
    highlightedChordIndex = null;
    initializeSection(section);
    if (!saved) setStatus(section, storageError);
  } catch (error) {
    console.error("No se pudo vincular el video de YouTube:", error);
    setStatus(section, error instanceof Error ? error.message : "No se pudo vincular el video.");
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const toggle = target.closest("[data-chord-mark-toggle]");
  if (!toggle) return;
  const section = toggle.closest("[data-youtube-song]");
  if (!section?.open || toggle.disabled) return;
  setMarkMode(section, !markMode);
  setStatus(section, markMode
    ? "Marcas activadas: pulsa el acorde que está sonando para guardar su tiempo."
    : "Marcas desactivadas. Los acordes vuelven a abrir sus diagramas.");
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const chord = target.closest("[data-chord-index]");
  if (
    !chord
    || !markMode
    || !activeSection?.open
    || !player?.getCurrentTime
  ) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const video = preferences.get(activeSection.dataset.youtubeSong);
  if (!video) return;
  const index = Number(chord.dataset.chordIndex);
  video.chordTimestamps[index] = Math.floor(player.getCurrentTime());
  preferences.set(activeSection.dataset.youtubeSong, video);
  const saved = savePreferences();
  updateChordControls(activeSection, video);
  setStatus(activeSection, saved
    ? `Marca guardada en ${formatTimestamp(video.chordTimestamps[index])} para ${chord.dataset.chordName}.`
    : storageError);
}, true);

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const unlink = target.closest("[data-youtube-unlink]");
  if (unlink) {
    const section = unlink.closest("[data-youtube-song]");
    setMarkMode(section, false);
    if (playbackTimer !== null) {
      window.clearInterval(playbackTimer);
      playbackTimer = null;
    }
    if (player?.destroy) player.destroy();
    player = null;
    playerVideoId = null;
    highlightedChordIndex = null;
    preferences.delete(section.dataset.youtubeSong);
    const saved = savePreferences();
    initializeSection(section);
    if (!saved) setStatus(section, storageError);
    return;
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== YOUTUBE_PREFERENCES_KEY) return;
  preferences = readPreferences();
  if (activeSection) initializeSection(activeSection);
});

document.addEventListener("DOMContentLoaded", () => {
  preferences = readPreferences();
  initializeSection(document.querySelector("[data-youtube-song]"));
});
