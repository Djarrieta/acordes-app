const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

let activeSection = null;
let player = null;
let playerVideoId = null;
let playerMuted = null;
let apiLoading = false;
let pendingPlayback = null;
let markMode = false;
let progressSeeking = false;
let playbackTimer = null;
let pollTimer = null;
let highlightedLineIndex = null;
let shownChordKey = null;
let chordDiagramRequest = 0;
let requestedAccompanimentChord = "";
const chordDiagramCache = new Map();

function songCard(section) {
  return section?.closest(".song-card") ?? null;
}

function songId(section) {
  return songCard(section)?.dataset.songId ?? "";
}

function songView(section) {
  return songCard(section)?.dataset.view ?? "player";
}

window.pauseAcordesPlayer = () => {
  if (!player?.pauseVideo || !window.YT?.PlayerState) return;
  if (player.getPlayerState() === window.YT.PlayerState.PLAYING) {
    player.pauseVideo();
  }
};

function togglePlayback() {
  if (!player?.getPlayerState || !window.YT?.PlayerState) return;
  if (player.getPlayerState() === window.YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
  updatePlaybackButton(activeSection);
}

const MEDIA_COLLAPSED_KEY = "acordes.mediaCollapsed";

function isMediaCollapsed() {
  try {
    return window.localStorage.getItem(MEDIA_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setMediaCollapsed(collapsed) {
  try {
    window.localStorage.setItem(MEDIA_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Sin almacenamiento: el estado solo dura mientras la tarjeta esté en pantalla.
  }
}

// El video sigue montado (solo se oculta visualmente) para que el audio no se interrumpa.
function applyMediaCollapsed(card) {
  if (!card) return;
  const collapsed = isMediaCollapsed();
  card.classList.toggle("is-media-collapsed", collapsed);
  const button = card.querySelector("[data-media-toggle]");
  if (!button) return;
  button.setAttribute("aria-pressed", String(!collapsed));
  const label = collapsed ? "Mostrar acorde y video" : "Ocultar acorde y video";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
}

function setStatus(section, message) {
  const status = section?.querySelector("[data-youtube-status]");
  if (status) status.textContent = message;
}

function formatTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function lineElements(section) {
  return [...(songCard(section)?.querySelectorAll(".song-lyrics .song-line") ?? [])];
}

function lineTime(line) {
  const raw = line.dataset.lineStart;
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function setLineMarker(line, ms) {
  const marker = line.querySelector(".song-line-time");
  if (ms === null) {
    line.removeAttribute("data-line-start");
    line.removeAttribute("title");
    if (marker) marker.textContent = "";
    return;
  }
  line.dataset.lineStart = String(ms);
  line.title = `Marca de línea: ${formatTimestamp(ms / 1000)}`;
  if (marker) marker.textContent = formatTimestamp(ms / 1000);
}

function updatePlaybackButton(section) {
  const button = songCard(section)?.querySelector("[data-youtube-play]");
  if (!button) return;
  const ready = Boolean(player?.getPlayerState && window.YT?.PlayerState);
  const playing = ready && player.getPlayerState() === window.YT.PlayerState.PLAYING;
  button.disabled = !ready;
  button.setAttribute("aria-label", playing ? "Pausar audio" : "Reproducir");
  button.innerHTML = playing
    ? 'Ⅱ <span>Pausar audio</span>'
    : '▶ <span>Reproducir</span>';
}

function getProgressParts(section) {
  const card = songCard(section);
  return {
    slider: card?.querySelector("[data-youtube-progress]"),
    current: card?.querySelector("[data-youtube-progress-current]"),
    duration: card?.querySelector("[data-youtube-progress-duration]"),
  };
}

function updateProgress(section) {
  if (!section) return;
  const { slider, current, duration } = getProgressParts(section);
  if (!slider || !current || !duration) return;
  const ready = Boolean(player?.getCurrentTime && player?.getDuration);
  const total = ready ? player.getDuration() : 0;
  const position = ready ? player.getCurrentTime() : 0;
  const hasDuration = Number.isFinite(total) && total > 0;
  slider.disabled = !hasDuration;
  if (hasDuration) {
    slider.max = String(total);
    if (!progressSeeking) slider.value = String(Math.min(position, total));
    duration.textContent = formatTimestamp(total);
  } else if (!progressSeeking) {
    slider.max = "0";
    slider.value = "0";
    duration.textContent = "0:00";
  }
  if (!progressSeeking) {
    current.textContent = formatTimestamp(Number.isFinite(position) ? Math.max(0, position) : 0);
  }
}

function seekToTimestamp(seconds) {
  if (!activeSection || !player?.seekTo || !Number.isFinite(seconds)) return;
  player.seekTo(seconds, true);
  window.AcordesAudio?.seek(seconds);
  updateProgress(activeSection);
}

function updateChordControls(section) {
  const ready = Boolean(section?.dataset.videoId && player && player.getPlayerState);
  const toggle = section?.querySelector("[data-chord-mark-toggle]");
  if (toggle) toggle.disabled = !ready;
  const card = songCard(section);
  const timestampsAuto = card?.querySelector("[data-timestamps-auto]");
  const timestampsRetry = card?.querySelector("[data-timestamps-retry]");
  const busy = ["pending", "transcribing", "aligning"].includes(card?.dataset.timestampsStatus);
  if (timestampsAuto) timestampsAuto.disabled = !section?.dataset.videoId || busy;
  if (timestampsRetry) timestampsRetry.disabled = !section?.dataset.videoId;

}

function setMarkMode(section, enabled) {
  markMode = Boolean(
    enabled
    && section
    && section.dataset.videoId
    && player?.getCurrentTime,
  );
  section?.classList.toggle("is-marking", markMode);
  const toggle = section?.querySelector("[data-chord-mark-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(markMode));
    toggle.textContent = markMode ? "Desactivar marcas de líneas" : "Activar marcas de líneas";
  }
  if (section) updateChordControls(section);
}

// Una línea canta como mucho a ~700 ms por palabra (mín. 2,5 s); el resto hasta la
// siguiente marca se considera pausa instrumental y no se reparte entre acordes.
function estimatedLineDurationMs(line, nextStart, start) {
  const words = [...line.querySelectorAll(".song-word-text")]
    .flatMap((node) => (node.textContent ?? "").trim().split(/\s+/))
    .filter(Boolean).length;
  const cap = Math.max(2500, words * 700);
  return nextStart === null ? cap : Math.max(1, Math.min(nextStart - start, cap));
}

// Estima el acorde sonando dentro de la línea según la posición de su columna
// entre el inicio de la línea y su duración estimada. Es una aproximación.
function estimateChord(line, nextStart, start, currentMs) {
  const chords = [...line.querySelectorAll("[data-chord-index]")];
  if (chords.length === 0) return null;
  const duration = estimatedLineDurationMs(line, nextStart, start);
  const fraction = Math.min(1, Math.max(0, (currentMs - start) / duration));
  const length = Number(line.dataset.lyricLength) || 0;
  let chosen = chords[0];
  chords.forEach((chord, index) => {
    const position = length > 0
      ? Math.min(1, Number(chord.dataset.chordColumn) / length)
      : index / chords.length;
    if (position <= fraction) chosen = chord;
  });
  return chosen;
}

function updateCurrentLine(section) {
  if (!player?.getCurrentTime || activeSection !== section) return;
  const currentMs = player.getCurrentTime() * 1000;
  const lines = lineElements(section);
  let activeIndex = null;
  let activeStart = -1;
  lines.forEach((line, index) => {
    const time = lineTime(line);
    if (time !== null && time <= currentMs && time >= activeStart) {
      activeIndex = index;
      activeStart = time;
    }
  });

  const card = songCard(section);
  if (activeIndex !== highlightedLineIndex) {
    highlightedLineIndex = activeIndex;
    lines.forEach((line, index) => line.classList.toggle("is-current", index === activeIndex));
    const activeLine = activeIndex === null ? null : lines[activeIndex];
    const lyrics = card?.querySelector(".song-lyrics");
    if (activeLine instanceof HTMLElement && lyrics instanceof HTMLElement) {
      const lineTop = activeLine.getBoundingClientRect().top
        - lyrics.getBoundingClientRect().top
        + lyrics.scrollTop;
      lyrics.scrollTo({
        top: lineTop - (lyrics.clientHeight - activeLine.offsetHeight) / 2,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }

  let chord = null;
  if (activeIndex !== null) {
    let nextStart = null;
    for (let index = activeIndex + 1; index < lines.length; index += 1) {
      const time = lineTime(lines[index]);
      if (time !== null && time > activeStart) {
        nextStart = time;
        break;
      }
    }
    chord = estimateChord(lines[activeIndex], nextStart, activeStart, currentMs);
    // Líneas sin acordes: conserva el último acorde de las líneas anteriores.
    for (let index = activeIndex - 1; !chord && index >= 0; index -= 1) {
      const previous = [...lines[index].querySelectorAll("[data-chord-index]")];
      chord = previous.at(-1) ?? null;
    }
  }
  const key = chord ? `${chord.dataset.chordId}|${chord.dataset.chordName}` : null;
  if (key === shownChordKey) return;
  shownChordKey = key;
  void updateAccompanimentChord(section, chord);
}

async function updateAccompanimentChord(section, chord) {
  const target = songCard(section)?.querySelector("#accompaniment-chord-viewer");
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

function destroyPlayer(section) {
  setMarkMode(section, false);
  if (playbackTimer !== null) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  if (player?.destroy) {
    try {
      player.destroy();
    } catch (error) {
      console.error("No se pudo destruir el reproductor:", error);
    }
  }
  player = null;
  playerVideoId = null;
  highlightedLineIndex = null;
  shownChordKey = null;
  section?.classList.remove("is-playing");
  songCard(section)?.classList.remove("is-playing");
}

function wantsMutedVideo() {
  return Boolean(window.AcordesAudio?.videoShouldBeMuted?.());
}

function syncVideoMute() {
  if (!activeSection || !player || !playerVideoId || !window.YT?.Player) return;
  if (playerMuted === wantsMutedVideo()) return;
  const section = activeSection;
  const videoId = playerVideoId;
  try {
    pendingPlayback = {
      songId: songId(section),
      videoId,
      seconds: player.getCurrentTime ? player.getCurrentTime() : 0,
      wasPlaying: player.getPlayerState?.() === window.YT.PlayerState.PLAYING,
    };
  } catch (error) {
    console.error("No se pudo conservar la posición del video:", error);
  }
  destroyPlayer(section);
  initializePlayer(section, videoId);
}

window.addEventListener("acordes:audio-mode", syncVideoMute);

function initializePlayer(section, videoId) {
  if (activeSection !== section || !VIDEO_ID_PATTERN.test(videoId) || !window.YT?.Player) return;
  const muted = wantsMutedVideo();
  if (player && playerVideoId === videoId && player.getPlayerState && playerMuted === muted) {
    updateChordControls(section);
    updateProgress(section);
    return;
  }
  if (player) destroyPlayer(section);
  const host = songCard(section)?.querySelector("[data-youtube-player]");
  if (!host) return;
  host.replaceChildren();
  const element = document.createElement("div");
  host.append(element);
  setStatus(section, "");
  // En iOS/Safari la API no puede silenciar el video (mute/setVolume no tienen efecto),
  // por eso el silencio se decide al crear el iframe con mute=1.
  playerMuted = muted;
  player = new window.YT.Player(element, {
    width: "100%",
    videoId,
    playerVars: { playsinline: 1, origin: window.location.origin, mute: muted ? 1 : 0 },
    events: {
      onReady(event) {
        if (activeSection !== section || section.dataset.videoId !== videoId) {
          event.target.destroy();
          return;
        }
        player = event.target;
        window.AcordesAudio?.onPlayerReady(player);
        updateChordControls(section);
        updatePlaybackButton(section);
        updateProgress(section);
        setMarkMode(section, false);
        const restore = pendingPlayback;
        pendingPlayback = null;
        if (restore?.songId === songId(section) && restore.videoId === videoId) {
          // seekTo() sobre un reproductor sin iniciar puede arrancar la reproducción; cargar en el punto evita eso.
          if (restore.wasPlaying) player.loadVideoById({ videoId, startSeconds: restore.seconds });
          else player.cueVideoById({ videoId, startSeconds: restore.seconds });
        }
        setStatus(section, "Listo.");
      },
      onStateChange(event) {
        if (activeSection !== section || section.dataset.videoId !== videoId) return;
        if (event.data === window.YT.PlayerState.PLAYING) {
          section.classList.add("is-playing");
          songCard(section)?.classList.add("is-playing");
          window.setSongView?.("player");
          window.AcordesAudio?.onYoutubePlaying(event.target, event.target.getCurrentTime ? event.target.getCurrentTime() : 0);
          updateChordControls(section);
          setStatus(section, markMode ? "Marcas activadas." : "");
          if (playbackTimer !== null) window.clearInterval(playbackTimer);
          updateCurrentLine(section);
          playbackTimer = window.setInterval(() => {
            updateCurrentLine(section);
            updateProgress(section);
            window.AcordesAudio?.syncDrift(player?.getCurrentTime ? player.getCurrentTime() : 0);
          }, 250);
          updatePlaybackButton(section);
          updateProgress(section);
        } else {
          section.classList.remove("is-playing");
          songCard(section)?.classList.remove("is-playing");
          if (
            event.data === window.YT.PlayerState.PAUSED
            || event.data === window.YT.PlayerState.ENDED
          ) {
            window.AcordesAudio?.onYoutubePaused(event.target);
          }
          updatePlaybackButton(section);
          updateProgress(section);
          updateChordControls(section);
          if (playbackTimer !== null) {
            window.clearInterval(playbackTimer);
            playbackTimer = null;
          }
        }
      },
      onError(event) {
        if (activeSection !== section || section.dataset.videoId !== videoId) return;
        console.error("Error del reproductor de YouTube:", event.data);
        section.classList.remove("is-playing");
        songCard(section)?.classList.remove("is-playing");
        setStatus(section, "No se pudo reproducir.");
        if (playbackTimer !== null) {
          window.clearInterval(playbackTimer);
          playbackTimer = null;
        }
        updateChordControls(section);
      },
    },
  });
  playerVideoId = videoId;
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function renderLoaderSteps(card, steps) {
  const list = card?.querySelector("[data-loader-steps]");
  if (!list || !Array.isArray(steps)) return;
  const signature = steps.map((step) => `${step.key}:${step.state}:${step.label}`).join("|");
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  list.replaceChildren(
    ...steps.map((step) => {
      const item = document.createElement("li");
      item.className = `loader-step is-${step.state}`;
      item.dataset.loaderStep = step.key;
      const icon = document.createElement("span");
      icon.className = "loader-step-icon";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "loader-step-label";
      label.textContent = step.label;
      item.append(icon, label);
      return item;
    }),
  );
}

function startPolling(section) {
  stopPolling();
  const card = songCard(section);
  if (!card) return;
  const busy = () =>
    card.dataset.view === "loader"
    || card.dataset.videoStatus === "searching"
    || ["pending", "transcribing", "aligning"].includes(card.dataset.timestampsStatus);
  if (!busy()) return;
  const id = card.dataset.songId;
  const interval = card.dataset.view === "loader" ? 1000 : 2000;
  pollTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/songs/${id}/status`, { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const status = await response.json();
      if (status.busy) {
        renderLoaderSteps(card, status.steps);
        return;
      }
      stopPolling();
      reloadPlayer();
    } catch (error) {
      console.error("No se pudo consultar el estado de la canción:", error);
    }
  }, interval);
}

function reloadPlayer() {
  const card = document.querySelector(".song-card");
  if (!card || !window.htmx) return;
  const id = card.dataset.songId;
  const offset = card.dataset.offset ?? "0";
  if (!id) return;
  window.htmx.ajax("GET", `/songs/${encodeURIComponent(id)}/player?offset=${encodeURIComponent(offset)}`, {
    target: "#song-container",
    swap: "innerHTML",
  });
}

function initializeSection(section) {
  if (!section) return;
  activeSection = section;
  const card = songCard(section);
  const videoId = section.dataset.videoId || "";
  const videoUrl = section.dataset.videoUrl || "";
  const input = section.querySelector('input[name="url"]');
  const media = card?.querySelector("[data-youtube-media]");
  const playbackControls = card?.querySelector("[data-youtube-playback-controls]");
  const host = card?.querySelector("[data-youtube-player]");
  if (input) input.value = videoUrl;
  applyMediaCollapsed(card);
  if (card?.dataset.view === "loader") {
    // Mientras se prepara la canción solo se muestra el cargador; el reproductor se crea al terminar.
    startPolling(section);
    return;
  }
  updateChordControls(section);
  const hasVideo = VIDEO_ID_PATTERN.test(videoId);
  if (media) media.hidden = !hasVideo;
  if (playbackControls) playbackControls.hidden = !hasVideo;
  if (host) host.hidden = !hasVideo;
  updatePlaybackButton(section);
  updateProgress(section);

  if (!hasVideo) {
    destroyPlayer(section);
    setStatus(section, "");
    startPolling(section);
    return;
  }

  if (!window.YT?.Player) {
    setStatus(section, "");
    loadYoutubeApi();
  } else {
    initializePlayer(section, videoId);
  }
  window.AcordesAudio?.init(section);
  startPolling(section);
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
      setStatus(activeSection, "");
    }
  };
  document.head.append(script);
}

async function postForm(url, data) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
  });
}

async function linkVideo(section, videoId, url) {
  const id = songId(section);
  const response = await postForm(`/songs/${encodeURIComponent(id)}/video`, {
    videoId,
    url,
    confirm: "1",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "No se pudo vincular el video.");
  }
  return true;
}

document.addEventListener("htmx:beforeSwap", (event) => {
  if (event.detail.target?.id !== "song-container") return;
  window.AcordesAudio?.preserve(event.detail.requestConfig?.path);
  stopPolling();
  markMode = false;
  highlightedLineIndex = null;
  shownChordKey = null;
  progressSeeking = false;
  if (playbackTimer !== null) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  if (player && activeSection && activeSection.dataset.videoId) {
    try {
      if (player.getCurrentTime) {
        pendingPlayback = {
          songId: songId(activeSection),
          videoId: activeSection.dataset.videoId,
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

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".youtube-link-form");
  if (!form) return;
  event.preventDefault();
  const section = form.closest("[data-youtube-song]");
  const input = form.querySelector('input[name="url"]');
  const url = input.value.trim();
  const match = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/.exec(url);
  if (!match) {
    setStatus(section, "Enlace no válido.");
    return;
  }
  setStatus(section, "");
  try {
    const linked = await linkVideo(section, match[1], url);
    if (!linked) return;
    reloadPlayer();
  } catch (error) {
    console.error("No se pudo vincular el video de YouTube:", error);
    setStatus(section, error instanceof Error ? error.message : "No se pudo vincular.");
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const playButton = target.closest("[data-youtube-play]");
  if (playButton) {
    togglePlayback();
    return;
  }

  const mediaToggle = target.closest("[data-media-toggle]");
  if (mediaToggle) {
    setMediaCollapsed(!isMediaCollapsed());
    applyMediaCollapsed(mediaToggle.closest(".song-card"));
    return;
  }

  const toggle = target.closest("[data-chord-mark-toggle]");
  if (toggle) {
    const section = toggle.closest("[data-youtube-song]");
    if (!section || toggle.disabled) return;
    if (songView(section) !== "player") window.setSongView?.("player");
    setMarkMode(section, !markMode);
    setStatus(section, markMode ? "Marcas activadas." : "");
    return;
  }

  const generate = target.closest("[data-timestamps-auto], [data-timestamps-retry]");
  if (generate) {
    const section = generate.closest("[data-youtube-song]");
    const card = songCard(section);
    const id = card?.dataset.songId;
    if (!section || !id) return;
    const retry = generate.matches("[data-timestamps-retry]");
    setStatus(section, "");
    card.dataset.timestampsStatus = "pending";
    const loader = section?.querySelector(".song-loader");
    if (loader) loader.hidden = false;
    fetch(`/songs/${encodeURIComponent(id)}/timestamps/${retry ? "retry" : "auto"}`, {
      method: "POST",
    })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudieron iniciar las marcas.");
        startPolling(section);
      })
      .catch((error) => {
        console.error(error);
        setStatus(section, "");
        card.dataset.timestampsStatus = "none";
      });
    return;
  }

  const retryVideo = target.closest("[data-video-retry]");
  if (retryVideo) {
    const section = retryVideo.closest("[data-youtube-song]");
    const card = songCard(section);
    const id = card?.dataset.songId;
    if (!section || !id) return;
    card.dataset.videoStatus = "searching";
    setStatus(section, "");
    const loader = section?.querySelector(".song-loader");
    if (loader) loader.hidden = false;
    fetch(`/songs/${encodeURIComponent(id)}/video/retry`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo buscar el video.");
        startPolling(section);
      })
      .catch((error) => {
        console.error(error);
        setStatus(section, "");
        card.dataset.videoStatus = "failed";
      });
    return;
  }

  const candidatesToggle = target.closest("[data-video-candidates-toggle]");
  if (candidatesToggle) {
    const section = candidatesToggle.closest("[data-youtube-song]");
    const container = section?.querySelector("[data-video-candidates]");
    if (!container) return;
    container.hidden = !container.hidden;
    if (container.hidden || container.dataset.loaded) return;
    container.dataset.loaded = "1";
    const id = songId(section);
    const body = container.querySelector(".video-candidates-body");
    fetch(`/songs/${encodeURIComponent(id)}/videos`, { headers: { Accept: "text/html" } })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudieron cargar los candidatos.");
        return response.text();
      })
      .then((html) => {
        if (body) body.innerHTML = html;
      })
      .catch((error) => {
        console.error(error);
        if (body) body.textContent = "No se pudieron cargar los candidatos.";
      });
    return;
  }

  const candidate = target.closest("[data-video-select]");
  if (candidate) {
    const section = candidate.closest("[data-youtube-song]") ?? activeSection;
    const id = candidate.dataset.songId || songId(section);
    const videoId = candidate.dataset.videoSelect;
    if (!id || !VIDEO_ID_PATTERN.test(videoId)) return;
    linkVideo(section, videoId, "")
      .then((linked) => {
        if (linked) reloadPlayer();
      })
      .catch((error) => {
        console.error(error);
        setStatus(section, error instanceof Error ? error.message : "No se pudo cambiar el video.");
      });
    return;
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches("[data-youtube-progress]")) return;
  const seconds = Number(target.value);
  if (!Number.isFinite(seconds)) return;
  progressSeeking = true;
  const { current } = getProgressParts(activeSection);
  if (current) current.textContent = formatTimestamp(Math.max(0, seconds));
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
  const line = target.closest(".song-lyrics .song-line");
  if (!line || !markMode) return;
  if (songView(activeSection) !== "player") return;
  if (!player?.getCurrentTime) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const ms = Math.floor(player.getCurrentTime() * 1000);
  const id = songId(activeSection);
  const lineId = line.dataset.lineId;
  if (!id || !lineId) return;
  const previous = lineTime(line);
  setLineMarker(line, ms);
  postForm(`/songs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/timestamp`, {
    ms: String(ms),
  })
    .then((response) => {
      if (!response.ok) throw new Error("No se pudo guardar la marca.");
      setStatus(activeSection, `Marca guardada en ${formatTimestamp(ms / 1000)}.`);
    })
    .catch((error) => {
      console.error(error);
      setStatus(activeSection, "No se pudo guardar.");
      setLineMarker(line, previous);
    });
}, true);

document.addEventListener("contextmenu", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const line = target.closest(".song-lyrics .song-line");
  if (!line || !markMode) return;
  if (songView(activeSection) !== "player") return;
  if (lineTime(line) === null) return;
  event.preventDefault();
  const id = songId(activeSection);
  const lineId = line.dataset.lineId;
  if (!id || !lineId) return;
  const previous = lineTime(line);
  setLineMarker(line, null);
  postForm(`/songs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/timestamp/clear`, {})
    .then((response) => {
      if (!response.ok) throw new Error("No se pudo borrar la marca.");
      setStatus(activeSection, "Marca eliminada.");
    })
    .catch((error) => {
      console.error(error);
      setStatus(activeSection, "No se pudo borrar.");
      setLineMarker(line, previous);
    });
}, true);

document.body.addEventListener("song-updated", () => {
  reloadPlayer();
});

document.addEventListener("DOMContentLoaded", () => {
  initializeSection(document.querySelector("[data-youtube-song]"));
});

function isTextEntry(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(element.type);
}

let spaceHandled = false;

// La barra espaciadora hace play/pausa solo en la vista del reproductor.
function spaceShouldTogglePlayback(event) {
  if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isTextEntry(event.target)) return false;
  const card = document.querySelector("#song-container .song-card");
  if (!card || card.dataset.view !== "player") return false;
  if (document.querySelector("dialog[open]")) return false;
  return Boolean(player?.getPlayerState);
}

document.addEventListener("keydown", (event) => {
  if (!spaceShouldTogglePlayback(event)) return;
  event.preventDefault();
  if (event.repeat) return;
  spaceHandled = true;
  togglePlayback();
});

// Firefox activa el botón enfocado al soltar la barra; se cancela para no pulsarlo dos veces.
document.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || !spaceHandled) return;
  spaceHandled = false;
  event.preventDefault();
});
