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
let progressSeeking = false;
let playbackTimer = null;
let highlightedChordIndex = null;
let chordDiagramRequest = 0;
let requestedAccompanimentChord = "";
const chordDiagramCache = new Map();

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

function updatePlaybackButton(section) {
  const button = section?.closest(".song-card")?.querySelector("[data-youtube-play]");
  if (!button) return;
  const ready = Boolean(player?.getPlayerState && window.YT?.PlayerState);
  const playing = ready && player.getPlayerState() === window.YT.PlayerState.PLAYING;
  button.disabled = !ready;
  button.setAttribute("aria-label", playing ? "Pausar audio" : "Reproducir audio");
  button.innerHTML = playing
    ? 'Ⅱ <span>Pausar audio</span>'
    : '▶ <span>Reproducir audio</span>';
}

function getProgressParts(section) {
  const songCard = section?.closest(".song-card");
  return {
    slider: songCard?.querySelector("[data-youtube-progress]"),
    current: songCard?.querySelector("[data-youtube-progress-current]"),
    duration: songCard?.querySelector("[data-youtube-progress-duration]"),
    marks: songCard?.querySelector("[data-youtube-progress-marks]"),
    hint: songCard?.querySelector("[data-youtube-progress-hint]"),
  };
}

function updateProgress(section) {
  if (!section) return;
  const { slider, current, duration, marks, hint } = getProgressParts(section);
  if (!slider || !current || !duration) return;
  const video = preferences.get(section.dataset.youtubeSong);
  const ready = Boolean(player?.getCurrentTime && player?.getDuration);
  const total = ready ? player.getDuration() : 0;
  const position = ready ? player.getCurrentTime() : 0;
  const hasDuration = Number.isFinite(total) && total > 0;
  slider.disabled = !hasDuration;
  if (hasDuration) {
    slider.max = String(total);
    if (!progressSeeking) slider.value = String(Math.min(position, total));
    duration.textContent = formatTimestamp(Math.floor(total));
  } else if (!progressSeeking) {
    slider.max = "0";
    slider.value = "0";
    duration.textContent = "0:00";
  }
  if (!progressSeeking) {
    current.textContent = formatTimestamp(
      Number.isFinite(position) ? Math.max(0, Math.floor(position)) : 0,
    );
  }
  const timestamps = updateProgressMarks(section, video, hasDuration ? total : 0, marks);
  if (hint) {
    hint.hidden = !video || timestamps > 0;
    hint.textContent = video
      ? "Marca los acordes para saltar a sus tiempos."
      : "Vincula un video para escuchar y moverte por la canción.";
  }
}

function updateProgressMarks(section, video, total, container) {
  if (!container) return 0;
  const timestamps = video?.chordTimestamps ?? [];
  const valid = timestamps
    .map((timestamp, index) => ({ timestamp, index }))
    .filter(({ timestamp }) =>
      Number.isSafeInteger(timestamp)
      && timestamp >= 0
      && total > 0
      && timestamp <= total,
    );
  const signature = `${Math.round(total)}:${valid.map(({ timestamp, index }) => `${index}-${timestamp}`).join(",")}`;
  if (container.dataset.signature !== signature) {
    container.dataset.signature = signature;
    container.replaceChildren();
    valid.forEach(({ timestamp, index }) => {
      const mark = document.createElement("button");
      mark.type = "button";
      mark.className = "youtube-progress-mark";
      mark.dataset.youtubeProgressMark = String(timestamp);
      mark.dataset.chordMarkIndex = String(index);
      mark.style.left = `${Math.min(100, Math.max(0, (timestamp / total) * 100))}%`;
      mark.title = `Ir a ${formatTimestamp(timestamp)}`;
      mark.setAttribute("aria-label", `Ir a ${formatTimestamp(timestamp)}`);
      container.append(mark);
    });
  }
  container.querySelectorAll("[data-chord-mark-index]").forEach((mark) => {
    mark.classList.toggle("is-current", Number(mark.dataset.chordMarkIndex) === highlightedChordIndex);
  });
  return valid.length;
}

function seekToTimestamp(seconds) {
  if (!activeSection || !player?.seekTo || !Number.isFinite(seconds)) return;
  player.seekTo(seconds, true);
  updateProgress(activeSection);
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
  const lyrics = songCard?.querySelector(".song-lyrics");
  if (activeLine instanceof HTMLElement && lyrics instanceof HTMLElement) {
    const lineTop = activeLine.getBoundingClientRect().top
      - lyrics.getBoundingClientRect().top
      + lyrics.scrollTop;
    lyrics.scrollTo({
      top: lineTop - (lyrics.clientHeight - activeLine.offsetHeight) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  void updateAccompanimentChord(section, activeChord);
}

async function updateAccompanimentChord(section, chord) {
  const target = section.closest(".song-card")?.querySelector("#accompaniment-chord-viewer");
  if (!target) return;
  if (!chord) {
    chordDiagramRequest += 1;
    requestedAccompanimentChord = "";
    target.innerHTML = '<p class="accompaniment-chord-placeholder">Aún no hay un acorde marcado en este punto del video.</p>';
    return;
  }
  const chordName = chord.dataset.chordName;
  const displayedChord = target.querySelector(".chord-diagram h3")?.textContent;
  if (displayedChord === chordName) {
    chordDiagramRequest += 1;
    requestedAccompanimentChord = "";
    return;
  }
  if (requestedAccompanimentChord === chordName) return;
  const requestId = ++chordDiagramRequest;
  requestedAccompanimentChord = chordName;
  try {
    let html = chordDiagramCache.get(chordName);
    if (!html) {
      const url = new URL("/chord-diagram", window.location.origin);
      url.searchParams.set("chord", chordName);
      url.searchParams.set("target", "accompaniment-chord-viewer");
      const response = await fetch(url);
      html = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${html}`);
      chordDiagramCache.set(chordName, html);
    }
    if (requestId !== chordDiagramRequest || activeSection !== section) return;
    target.innerHTML = html;
    requestedAccompanimentChord = "";
    window.htmx?.process(target);
  } catch (error) {
    if (requestId !== chordDiagramRequest || activeSection !== section) return;
    console.error("No se pudo actualizar el diagrama del acorde actual:", error);
    requestedAccompanimentChord = "";
    target.innerHTML = '<p class="accompaniment-chord-placeholder">No se pudo mostrar la digitación de este acorde.</p>';
  }
}

function initializePlayer(section, video) {
  if (activeSection !== section || !video || !window.YT?.Player) return;
  if (player && playerVideoId === video.videoId && player.getPlayerState) {
    updateChordControls(section, video);
    updateProgress(section);
    return;
  }
  if (player) {
    setMarkMode(section, false);
    player.destroy();
    player = null;
    playerVideoId = null;
    section.classList.remove("is-playing");
    highlightedChordIndex = null;
    if (playbackTimer !== null) {
      window.clearInterval(playbackTimer);
      playbackTimer = null;
    }
  }
  const host = section.closest(".song-card")?.querySelector("[data-youtube-player]");
  section.classList.toggle("has-video", Boolean(video));
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
        updatePlaybackButton(section);
        updateProgress(section);
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
          section.classList.add("is-playing");
          setStatus(section, markMode
            ? "Marcas activadas: pulsa el acorde que está sonando para guardar su tiempo."
            : "Reproduciendo. Abre este panel para activar las marcas de acordes.");
          if (playbackTimer !== null) window.clearInterval(playbackTimer);
          updateCurrentChord(section, video);
          playbackTimer = window.setInterval(() => {
            updateCurrentChord(section, video);
            updateProgress(section);
          }, 250);
          updatePlaybackButton(section);
          updateProgress(section);
        } else {
          section.classList.remove("is-playing");
          updatePlaybackButton(section);
          updateProgress(section);
          if (playbackTimer !== null) {
            window.clearInterval(playbackTimer);
            playbackTimer = null;
          }
        }
      },
      onError(event) {
        if (
          activeSection !== section
          || preferences.get(section.dataset.youtubeSong)?.videoId !== video.videoId
        ) return;
        console.error("Error del reproductor de YouTube:", event.data);
        section.classList.remove("is-playing");
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
  const media = section.closest(".song-card")?.querySelector("[data-youtube-media]");
  const playbackControls = section.closest(".song-card")?.querySelector("[data-youtube-playback-controls]");
  const host = section.closest(".song-card")?.querySelector("[data-youtube-player]");
  if (input) input.value = video?.url ?? "";
  if (unlinkButton) unlinkButton.hidden = !video;
  if (summaryState) summaryState.textContent = video ? "Video vinculado" : "Configurar audio y marcas";
  updateChordControls(section, video);
  if (media) media.hidden = !video;
  if (playbackControls) playbackControls.hidden = !video;
  if (host) host.hidden = false;
  updatePlaybackButton(section);
  updateProgress(section);
  if (!video) {
    setMarkMode(section, false);
    section.classList.remove("is-playing");
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
    updatePlaybackButton(section);
    updateProgress(section);
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
  progressSeeking = false;
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
    section.classList.remove("is-playing");
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
  const playButton = target.closest("[data-youtube-play]");
  if (playButton) {
    if (!player?.getPlayerState || !window.YT?.PlayerState) return;
    if (player.getPlayerState() === window.YT.PlayerState.PLAYING) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
    updatePlaybackButton(activeSection);
    return;
  }
  const progressMark = target.closest("[data-youtube-progress-mark]");
  if (progressMark) {
    seekToTimestamp(Number(progressMark.dataset.youtubeProgressMark));
    return;
  }
  const toggle = target.closest("[data-chord-mark-toggle]");
  if (!toggle) return;
  const section = toggle.closest("[data-youtube-song]");
  if (!section?.open || toggle.disabled) return;
  setMarkMode(section, !markMode);
  setStatus(section, markMode
    ? "Marcas activadas: pulsa el acorde que está sonando para guardar su tiempo."
    : "Marcas desactivadas. Los acordes vuelven a abrir sus diagramas.");
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches("[data-youtube-progress]")) return;
  const seconds = Number(target.value);
  if (!Number.isFinite(seconds)) return;
  progressSeeking = true;
  const { current } = getProgressParts(activeSection);
  if (current) current.textContent = formatTimestamp(Math.max(0, Math.floor(seconds)));
  seekToTimestamp(seconds);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches("[data-youtube-progress]")) return;
  progressSeeking = false;
  seekToTimestamp(Number(target.value));
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
  updateProgress(activeSection);
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
    section.classList.remove("is-playing");
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
